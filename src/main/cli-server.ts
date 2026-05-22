/**
 * cli-server.ts
 *
 * Servidor IPC (named pipe / UDS) que escuta comandos do binário `undrcode` CLI.
 * Quando o user roda `undrcode --goto file.ts:42:10` num terminal, o script
 * `bin/undrcode.js` conecta neste pipe e envia o comando — aí o main process
 * forwarda como CustomEvent pro renderer (`undrcod:cli-goto`, `undrcod:cli-diff`, etc).
 *
 * Protocol: line-delimited JSON. Cada mensagem é UM objeto JSON terminado em \n.
 *
 * Pipe path:
 *   Windows: \\.\pipe\undrcode
 *   Linux/macOS: /tmp/undrcode.<user>.sock  (ou ~/.undrcode.sock como fallback)
 */
import net from 'net';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir, userInfo, platform, homedir } from 'os';
import type { BrowserWindow } from 'electron';

export type CliCommand =
  | { kind: 'open'; path: string }
  | { kind: 'goto'; path: string; line: number; col?: number }
  | { kind: 'diff'; left: string; right: string }
  | { kind: 'focus' };

export function getPipePath(): string {
  if (platform() === 'win32') {
    return '\\\\.\\pipe\\undrcode';
  }
  try {
    const user = userInfo().username || 'user';
    return join(tmpdir(), `undrcode.${user}.sock`);
  } catch {
    return join(homedir(), '.undrcode.sock');
  }
}

let server: net.Server | null = null;

export function startCliServer(getMainWindow: () => BrowserWindow | null): void {
  const pipePath = getPipePath();

  // Em POSIX, se o arquivo socket sobrou de uma execução anterior, remove.
  if (platform() !== 'win32' && existsSync(pipePath)) {
    try {
      unlinkSync(pipePath);
    } catch (err) {
      console.warn('[cli-server] failed to unlink stale socket:', err);
    }
  }

  server = net.createServer((socket) => {
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as CliCommand;
          handleCliCommand(msg, getMainWindow());
          socket.write(JSON.stringify({ ok: true }) + '\n');
        } catch (err) {
          console.warn('[cli-server] bad message:', line, err);
          socket.write(JSON.stringify({ ok: false, error: String(err) }) + '\n');
        }
      }
    });
    socket.on('error', (err) => {
      console.warn('[cli-server] socket error:', err.message);
    });
  });

  server.on('error', (err) => {
    console.warn('[cli-server] server error:', err.message);
  });

  server.listen(pipePath, () => {
    console.log('[cli-server] listening on', pipePath);
  });
}

export function stopCliServer(): void {
  if (server) {
    try {
      server.close();
    } catch {
      // ignore
    }
    server = null;
  }
  if (platform() !== 'win32') {
    const p = getPipePath();
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        // ignore
      }
    }
  }
}

function handleCliCommand(msg: CliCommand, win: BrowserWindow | null): void {
  if (!win) {
    console.warn('[cli-server] no main window — discarding', msg);
    return;
  }
  // Garante que a janela tá visível e focada quando vier comando externo
  if (win.isMinimized()) win.restore();
  win.focus();

  switch (msg.kind) {
    case 'open':
      win.webContents.send('cli:command', { kind: 'open', path: msg.path });
      break;
    case 'goto':
      win.webContents.send('cli:command', {
        kind: 'goto',
        path: msg.path,
        line: msg.line,
        col: msg.col,
      });
      break;
    case 'diff':
      win.webContents.send('cli:command', {
        kind: 'diff',
        left: msg.left,
        right: msg.right,
      });
      break;
    case 'focus':
      // Só focar — já foi feito acima.
      break;
    default:
      console.warn('[cli-server] unknown kind:', (msg as { kind: string }).kind);
  }
}
