/**
 * Permission MCP bridge — main process side.
 *
 * Roda 1 TCP server local (127.0.0.1 + porta aleatoria) que recebe pedidos
 * de aprovacao do `resources/permission-mcp/server.js` (rodando como child
 * do Claude CLI via `--mcp-config` + `--permission-prompt-tool`).
 *
 * Fluxo:
 *   1. Renderer envia prompt em modo `ask`/`acceptEdits`
 *   2. AgentManager garante que esse bridge ta rodando (start() idempotente)
 *   3. AgentManager monta mcp-config.json apontando pro server.js com
 *      env vars { UNDRCODE_PERM_BRIDGE_PORT, UNDRCODE_PERM_BRIDGE_TOKEN }
 *   4. CLI spawna server.js. Quando precisa de permissao, chama o tool
 *      `approval_prompt` no MCP. server.js abre TCP pra ca e manda payload.
 *   5. Bridge gera requestId, emite evento `permission:request` pro renderer
 *      com {requestId, toolName, input, toolUseId}, retorna Promise pendente
 *   6. Renderer chama `respondPermission(requestId, decision)` via IPC.
 *      Bridge resolve a promise -> escreve resposta no socket -> server.js
 *      retorna pro CLI.
 *
 * Timeout: 5 min sem resposta = deny defensivo (evita travar CLI eternamente
 * se o user fechar a window). Configuravel via setTimeout.
 *
 * Auth: token aleatorio por boot (regenerado em cada start()). Sem isso,
 * qualquer processo local podia spammar requests no bridge.
 */

import { createServer, type Server, type Socket } from 'net';
import { randomBytes, randomUUID } from 'crypto';
import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';

const TIMEOUT_MS = 5 * 60 * 1000; // 5min

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string | null;
}

export interface PermissionDecision {
  behavior: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
  message?: string;
}

interface Pending {
  resolve: (decision: PermissionDecision) => void;
  socket: Socket;
  timeout: NodeJS.Timeout;
}

class PermissionBridge {
  private server: Server | null = null;
  private port = 0;
  private token = '';
  private pending = new Map<string, Pending>();
  private startPromise: Promise<{ port: number; token: string }> | null = null;

  /**
   * Garante que o bridge ta rodando. Idempotente — multiplas calls retornam
   * a mesma porta. Resolve com {port, token} pra agent-manager montar a
   * config MCP.
   */
  async start(): Promise<{ port: number; token: string }> {
    if (this.server && this.port && this.token) {
      return { port: this.port, token: this.token };
    }
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise((resolve, reject) => {
      this.token = randomBytes(24).toString('hex');
      const srv = createServer((sock) => this.handleConnection(sock));
      srv.on('error', (err) => {
        console.error('[permission-bridge] server error:', err.message);
      });
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (typeof addr === 'object' && addr) {
          this.port = addr.port;
          this.server = srv;
          console.log('[permission-bridge] listening on 127.0.0.1:' + this.port);
          resolve({ port: this.port, token: this.token });
        } else {
          reject(new Error('failed to resolve listen address'));
        }
      });
    });

    return this.startPromise;
  }

  /**
   * Caminho absoluto pro script JS do MCP server. Resolve dev vs packaged.
   * Em packaged build, vai pra <resourcesPath>/permission-mcp/server.js
   * (electron-builder copia resources/ pra la). Em dev, usa o path relativo
   * ao cwd do app.
   */
  getScriptPath(): string {
    const candidates = [
      join(process.resourcesPath || '', 'permission-mcp', 'server.js'),
      join(app.getAppPath(), 'resources', 'permission-mcp', 'server.js'),
      join(process.cwd(), 'resources', 'permission-mcp', 'server.js'),
    ];
    for (const p of candidates) {
      if (p && existsSync(p)) return p;
    }
    // Fallback — devolve o primeiro candidate mesmo sem existir; spawn vai
    // falhar e o erro vira no stderr do CLI.
    return candidates[2];
  }

  private handleConnection(sock: Socket): void {
    sock.setEncoding('utf-8');
    let buf = '';
    sock.on('data', (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) return;
      this.processRequest(sock, line);
    });
    sock.on('error', () => {
      // socket pode fechar abrupto se CLI matar o MCP server — silencioso
    });
  }

  private processRequest(sock: Socket, line: string): void {
    let payload: {
      token?: string;
      requestId?: string;
      toolName?: string;
      input?: Record<string, unknown>;
      toolUseId?: string | null;
    };
    try {
      payload = JSON.parse(line);
    } catch {
      sock.end(JSON.stringify({ behavior: 'deny', message: 'invalid payload' }) + '\n');
      return;
    }

    // Auth check — token tem que bater com o gerado no start()
    if (payload.token !== this.token) {
      sock.end(JSON.stringify({ behavior: 'deny', message: 'bad token' }) + '\n');
      return;
    }

    const requestId = payload.requestId || randomUUID();
    const toolName = String(payload.toolName || 'unknown');
    const input = payload.input || {};
    const toolUseId = typeof payload.toolUseId === 'string' ? payload.toolUseId : null;

    // Registra como pending — espera o renderer responder
    const timeout = setTimeout(() => {
      const p = this.pending.get(requestId);
      if (!p) return;
      this.pending.delete(requestId);
      try {
        p.socket.end(
          JSON.stringify({ behavior: 'deny', message: 'Timeout (sem resposta em 5min)' }) +
            '\n',
        );
      } catch {
        /* noop */
      }
    }, TIMEOUT_MS);

    this.pending.set(requestId, {
      resolve: (decision) => {
        const p = this.pending.get(requestId);
        if (!p) return;
        clearTimeout(p.timeout);
        this.pending.delete(requestId);
        try {
          p.socket.end(JSON.stringify(decision) + '\n');
        } catch {
          /* noop */
        }
      },
      socket: sock,
      timeout,
    });

    // Broadcast pro renderer — todas as windows assinam o evento. O ChatView
    // ativo decide se mostra o card (matching por sessao via toolUseId nao
    // funciona aqui, entao mostra em todas e quem clicar primeiro decide).
    const req: PermissionRequest = { requestId, toolName, input, toolUseId };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('agent:permission-request', req);
      }
    }
  }

  /** Renderer respondeu — resolve a promise + socket. */
  respond(requestId: string, decision: PermissionDecision): boolean {
    const p = this.pending.get(requestId);
    if (!p) return false;
    p.resolve(decision);
    return true;
  }

  /** Lista requestIds pendentes (debug). */
  pendingIds(): string[] {
    return Array.from(this.pending.keys());
  }
}

export const permissionBridge = new PermissionBridge();
