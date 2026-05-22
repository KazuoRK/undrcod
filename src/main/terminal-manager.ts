/**
 * TerminalManager — spawna shells interativas via node-pty.
 *
 * Diferente do PtyManager (que spawna `claude` CLI), aqui spawnamos a shell
 * default do sistema (powershell.exe no Win, bash no Unix). Usuário escreve
 * comandos via xterm.js no renderer.
 */

import * as pty from 'node-pty';
import { randomUUID } from 'crypto';

interface TerminalSession {
  pty: pty.IPty;
  cwd: string;
  startedAt: number;
}

export interface SpawnTerminalOptions {
  cwd: string;
  cols?: number;
  rows?: number;
}

class TerminalManager {
  private sessions = new Map<string, TerminalSession>();
  private dataListeners = new Set<(termId: string, data: string) => void>();
  private exitListeners = new Set<(termId: string, code: number) => void>();

  spawn(opts: SpawnTerminalOptions): { termId: string } | { error: string } {
    const { cwd, cols = 80, rows = 24 } = opts;
    const isWin = process.platform === 'win32';

    // Windows: powershell.exe (mais comum que pwsh.exe; fallback cmd.exe se não tem)
    // Unix: $SHELL ou /bin/bash
    const shellPath = isWin
      ? (process.env.SystemRoot
          ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
          : 'powershell.exe')
      : (process.env.SHELL || '/bin/bash');

    const id = randomUUID();
    let ptyProcess: pty.IPty;

    try {
      ptyProcess = pty.spawn(shellPath, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        } as Record<string, string>,
        // Desativa ConPTY no Windows — o conpty_console_list_agent crasha em loop
        // com "AttachConsole failed" quando spawn acontece de Electron renderer.
        // Winpty legacy e mais estavel pro nosso caso.
        useConpty: false,
      } as pty.IPtyForkOptions);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Failed to spawn terminal: ${msg}` };
    }

    const session: TerminalSession = {
      pty: ptyProcess,
      cwd,
      startedAt: Date.now(),
    };
    this.sessions.set(id, session);

    ptyProcess.onData((data) => {
      for (const cb of this.dataListeners) cb(id, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      for (const cb of this.exitListeners) cb(id, exitCode || 0);
      this.sessions.delete(id);
    });

    return { termId: id };
  }

  write(termId: string, data: string): boolean {
    const session = this.sessions.get(termId);
    if (!session) return false;
    session.pty.write(data);
    return true;
  }

  resize(termId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(termId);
    if (!session) return false;
    try {
      session.pty.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
  }

  kill(termId: string): boolean {
    const session = this.sessions.get(termId);
    if (!session) return false;
    try {
      session.pty.kill();
    } catch {
      // já morto, ok
    }
    this.sessions.delete(termId);
    return true;
  }

  killAll(): void {
    for (const [, session] of this.sessions) {
      try { session.pty.kill(); } catch { /* ignore */ }
    }
    this.sessions.clear();
  }

  onData(cb: (termId: string, data: string) => void): () => void {
    this.dataListeners.add(cb);
    return () => this.dataListeners.delete(cb);
  }

  onExit(cb: (termId: string, code: number) => void): () => void {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }
}

export const terminalManager = new TerminalManager();
