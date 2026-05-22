import { ipcMain, BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { agentManager } from '../agent-manager';
import { permissionBridge, type PermissionDecision } from '../permission-mcp-server';

/**
 * Resolve binario do `claude` CLI (replica logica de agent-manager pra não
 * exportar internals). Preferencia: claude.exe nativo > node cli.js > claude.cmd.
 */
function resolveClaudeBin(): { command: string; prefixArgs: string[] } {
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA;
    if (appdata) {
      const base = join(appdata, 'npm', 'node_modules', '@anthropic-ai', 'claude-code');
      const exe = join(base, 'bin', 'claude.exe');
      if (existsSync(exe)) return { command: exe, prefixArgs: [] };
      const cliJs = join(base, 'cli.js');
      if (existsSync(cliJs)) return { command: 'node', prefixArgs: [cliJs] };
    }
    return { command: 'claude.cmd', prefixArgs: [] };
  }
  return { command: 'claude', prefixArgs: [] };
}

/**
 * One-shot do `claude -p "<prompt>"` — spawn, captura stdout, retorna texto.
 * Sem session, sem stream — pra uso "AI gerar coisa pequena" tipo commit message.
 * Timeout default 30s; estoura tempo → resolve com { error }.
 */
function runClaudeOneshot(
  cwd: string,
  prompt: string,
  timeoutMs = 30_000,
): Promise<{ text: string } | { error: string }> {
  return new Promise((resolve) => {
    const { command, prefixArgs } = resolveClaudeBin();
    const args = [...prefixArgs, '-p', prompt];
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (result: { text: string } | { error: string }): void => {
      if (done) return;
      done = true;
      resolve(result);
    };

    let proc;
    try {
      proc = spawn(command, args, {
        cwd,
        windowsHide: true,
        shell: command === 'claude.cmd',
      });
    } catch (err: any) {
      finish({ error: err?.message || 'spawn claude falhou' });
      return;
    }

    const timer = setTimeout(() => {
      try { proc!.kill('SIGTERM'); } catch { /* noop */ }
      finish({ error: `timeout após ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);

    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    proc.on('error', (err) => {
      clearTimeout(timer);
      finish({ error: err.message });
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        finish({ text: stdout.trim() });
      } else {
        finish({ error: stderr.trim() || `claude saiu com código ${code}` });
      }
    });
  });
}

/**
 * IPC handlers pro Agent (modo chat estruturado, não terminal).
 *
 * Channels:
 *   - agent:createSession() -> { sessionId }
 *   - agent:send({ sessionId, cwd, prompt }) -> { turnId } | { error }
 *   - agent:cancel({ sessionId }) -> boolean
 *
 * Events (main → renderer):
 *   - agent:event(sessionId, AgentEvent)
 */
export function registerAgentIPC(): void {
  ipcMain.handle('agent:createSession', () => {
    return { sessionId: agentManager.createSession() };
  });

  // Adota uma session existente (do storage do Claude CLI) — próxima send usa --resume
  ipcMain.handle('agent:adoptSession', (_, sessionId: string) => {
    agentManager.adoptSession(sessionId);
    return { sessionId };
  });

  ipcMain.handle('agent:forgetSession', (_, sessionId: string) => {
    agentManager.forgetSession(sessionId);
    return true;
  });

  ipcMain.handle(
    'agent:send',
    async (_, opts: {
      sessionId: string;
      cwd: string;
      prompt: string;
      permissionMode?: string;
      model?: string;
      effort?: string;
      preferredLanguage?: 'auto' | 'pt-BR' | 'en';
    }) => {
      return await agentManager.sendPrompt(opts);
    }
  );

  ipcMain.handle('agent:cancel', (_, sessionId: string) => {
    return agentManager.cancel(sessionId);
  });

  /**
   * Responde a um pedido de permissao pendente (gerado pelo permissionBridge
   * quando o CLI invoca o tool `approval_prompt`). decision = {behavior,
   * updatedInput?, message?}. Retorna false se requestId nao existe mais
   * (timeout/cancel).
   */
  ipcMain.handle(
    'agent:respondPermission',
    (_, requestId: string, decision: PermissionDecision) => {
      return permissionBridge.respond(requestId, decision);
    },
  );

  /**
   * One-shot: `claude -p "<prompt>"` no cwd, captura stdout até 30s.
   * Usado pelo CommitDialog pra gerar mensagem de commit a partir do diff staged.
   */
  ipcMain.handle('agent:oneshot', async (_, cwd: string, prompt: string) => {
    if (!cwd || !prompt) return { error: 'cwd ou prompt missing' };
    return runClaudeOneshot(cwd, prompt, 30_000);
  });

  // Broadcast eventos pra todas as windows
  agentManager.onEvent((sessionId, event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('agent:event', sessionId, event);
      }
    }
  });
}
