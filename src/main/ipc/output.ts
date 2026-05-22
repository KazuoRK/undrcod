import { ipcMain, BrowserWindow } from 'electron';

/**
 * Output channels — log streaming pro Bottom Panel tab "Output".
 *
 * Canais:
 *   - "Main process": logs do processo principal Electron (intercepta console.* + stdout)
 *   - "Renderer":     logs do renderer process (recebe via 'output:renderer-log' IPC)
 *   - "Tasks":        reservado pra runners de task (vazio por enquanto)
 *
 * Buffer FIFO max 1000 linhas por canal.
 *
 * Eventos:
 *   - output:subscribe ()              -> { channels, buffer: Record<channel, LogLine[]> }
 *   - output:renderer-log (level, text) -> registra log vindo do renderer
 *
 * Broadcasts:
 *   - output:log (channel, line)
 */

export type LogLevel = 'info' | 'warn' | 'error';
export interface LogLine {
  timestamp: string;
  level: LogLevel;
  text: string;
}

const CHANNELS = ['Main process', 'Renderer', 'Tasks'] as const;
export type OutputChannel = (typeof CHANNELS)[number];

const MAX_LINES = 1000;
const buffers: Record<OutputChannel, LogLine[]> = {
  'Main process': [],
  Renderer: [],
  Tasks: [],
};

function nowISO(): string {
  return new Date().toISOString();
}

function pushLine(channel: OutputChannel, level: LogLevel, text: string): void {
  // strip ANSI escape sequences pra render limpo na UI
  const clean = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
  if (clean.trim().length === 0) return;
  const line: LogLine = { timestamp: nowISO(), level, text: clean };
  const buf = buffers[channel];
  buf.push(line);
  if (buf.length > MAX_LINES) buf.splice(0, buf.length - MAX_LINES);

  for (const win of BrowserWindow.getAllWindows()) {
    // Check window E webContents — em shutdown/reload o webContents pode estar
    // destroyed antes da window. Sem essa verificação, `_send()` throws
    // "Object has been destroyed" → console.error → pushLine → loop crash.
    if (win.isDestroyed()) continue;
    const wc = win.webContents;
    if (!wc || wc.isDestroyed()) continue;
    try {
      wc.send('output:log', channel, line);
    } catch {
      /* race condition entre check e send — silently ignore */
    }
  }
}

let installed = false;
function installMainProcessCapture(): void {
  if (installed) return;
  installed = true;

  // Intercepta console.* mantendo comportamento original (write pro stdout nativo)
  const origLog = console.log.bind(console);
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  const fmt = (args: unknown[]): string =>
    args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.stack ?? a.message;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');

  console.log = (...args: unknown[]) => {
    pushLine('Main process', 'info', fmt(args));
    origLog(...args);
  };
  console.info = (...args: unknown[]) => {
    pushLine('Main process', 'info', fmt(args));
    origInfo(...args);
  };
  console.warn = (...args: unknown[]) => {
    pushLine('Main process', 'warn', fmt(args));
    origWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    pushLine('Main process', 'error', fmt(args));
    origError(...args);
  };
}

export function registerOutputIPC(): void {
  installMainProcessCapture();

  ipcMain.handle('output:subscribe', () => ({
    channels: [...CHANNELS],
    buffer: {
      'Main process': [...buffers['Main process']],
      Renderer: [...buffers.Renderer],
      Tasks: [...buffers.Tasks],
    },
  }));

  ipcMain.on('output:renderer-log', (_evt, level: LogLevel, text: string) => {
    const lvl: LogLevel = level === 'warn' || level === 'error' ? level : 'info';
    pushLine('Renderer', lvl, typeof text === 'string' ? text : String(text));
  });
}

/** API interna pra outros módulos do main empurrarem logs (ex: tasks runner futuro) */
export function logTo(channel: OutputChannel, level: LogLevel, text: string): void {
  pushLine(channel, level, text);
}
