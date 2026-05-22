import * as pty from 'node-pty';
import { randomUUID } from 'crypto';

interface PtySession {
  pty: pty.IPty;
  cwd: string;
  startedAt: number;
}

export interface SpawnOptions {
  cwd: string;
  cols?: number;
  rows?: number;
}

/**
 * Gerencia múltiplos processos PTY rodando `claude` CLI.
 * Cada sessão = 1 processo PTY isolado.
 */
class PtyManager {
  private sessions = new Map<string, PtySession>();
  private dataListeners = new Set<(ptyId: string, data: string) => void>();
  private exitListeners = new Set<(ptyId: string, code: number) => void>();

  /**
   * Spawn `claude` CLI numa pasta. Retorna ID da sessão.
   */
  spawn(opts: SpawnOptions): { ptyId: string } | { error: string } {
    const { cwd, cols = 120, rows = 30 } = opts;

    // No Windows o `claude` instalado via npm vira `claude.cmd` no PATH.
    // node-pty resolve via PATH automaticamente quando comando é dado direto.
    // Em caso de falha, tenta via shell.
    const id = randomUUID();
    const isWin = process.platform === 'win32';

    let ptyProcess: pty.IPty;
    try {
      // Estratégia: spawnar shell que executa `claude`. Mais robusto que
      // tentar achar o binary diretamente.
      const shellPath = isWin
        ? process.env.COMSPEC || 'cmd.exe'
        : process.env.SHELL || '/bin/bash';

      // No Windows usamos cmd.exe pq powershell tem prompt + slower startup.
      // /K = mantém aberto após o comando rodar.
      const shellArgs = isWin ? ['/C', 'claude'] : ['-c', 'claude'];

      ptyProcess = pty.spawn(shellPath, shellArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        }
      });
    } catch (err: any) {
      return { error: `Failed to spawn claude: ${err.message}` };
    }

    const session: PtySession = {
      pty: ptyProcess,
      cwd,
      startedAt: Date.now()
    };
    this.sessions.set(id, session);

    ptyProcess.onData((data) => {
      for (const cb of this.dataListeners) cb(id, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      for (const cb of this.exitListeners) cb(id, exitCode || 0);
      this.sessions.delete(id);
    });

    return { ptyId: id };
  }

  write(ptyId: string, data: string): boolean {
    const session = this.sessions.get(ptyId);
    if (!session) return false;
    session.pty.write(data);
    return true;
  }

  resize(ptyId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(ptyId);
    if (!session) return false;
    try {
      session.pty.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
  }

  kill(ptyId: string): boolean {
    const session = this.sessions.get(ptyId);
    if (!session) return false;
    try {
      session.pty.kill();
    } catch {
      // já morto, ok
    }
    this.sessions.delete(ptyId);
    return true;
  }

  killAll(): void {
    for (const [, session] of this.sessions) {
      try {
        session.pty.kill();
      } catch {}
    }
    this.sessions.clear();
  }

  list(): Array<{ ptyId: string; cwd: string; startedAt: number }> {
    return Array.from(this.sessions.entries()).map(([ptyId, s]) => ({
      ptyId,
      cwd: s.cwd,
      startedAt: s.startedAt
    }));
  }

  onData(cb: (ptyId: string, data: string) => void): () => void {
    this.dataListeners.add(cb);
    return () => this.dataListeners.delete(cb);
  }

  onExit(cb: (ptyId: string, code: number) => void): () => void {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }
}

export const ptyManager = new PtyManager();
