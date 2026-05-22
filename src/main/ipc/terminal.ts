import { ipcMain, BrowserWindow } from 'electron';
import { terminalManager } from '../terminal-manager';

/**
 * Registra handlers IPC para shells interativas (powershell/bash).
 * Eventos request/response:
 *   - terminal:spawn (cwd, cols?, rows?) -> { termId } | { error }
 *   - terminal:write (termId, data)      -> boolean
 *   - terminal:resize (termId, cols, rows) -> boolean
 *   - terminal:kill (termId)             -> boolean
 *
 * Events main -> renderer:
 *   - terminal:data (termId, data)
 *   - terminal:exit (termId, code)
 */
export function registerTerminalIPC(): void {
  ipcMain.handle('terminal:spawn', (_, opts: { cwd: string; cols?: number; rows?: number }) => {
    return terminalManager.spawn(opts);
  });

  ipcMain.handle('terminal:write', (_, termId: string, data: string) => {
    return terminalManager.write(termId, data);
  });

  ipcMain.handle('terminal:resize', (_, termId: string, cols: number, rows: number) => {
    return terminalManager.resize(termId, cols, rows);
  });

  ipcMain.handle('terminal:kill', (_, termId: string) => {
    return terminalManager.kill(termId);
  });

  terminalManager.onData((termId, data) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('terminal:data', termId, data);
      }
    }
  });

  terminalManager.onExit((termId, code) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('terminal:exit', termId, code);
      }
    }
  });
}
