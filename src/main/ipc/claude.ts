import { ipcMain, BrowserWindow } from 'electron';
import { ptyManager } from '../pty-manager';
import {
  listSessionsForWorkspace,
  listKnownWorkspaces,
  readSessionHistory,
  getCachedSessionsSnapshot,
  getAllCachedSessionsSnapshots,
} from '../claude-sessions';
import type { ReadSessionHistoryOptions } from '../../shared/agent-types';

/**
 * Registra handlers IPC pro PTY do `claude` CLI.
 * Eventos:
 *   - claude:spawn (cwd) -> { ptyId } | { error }
 *   - claude:write (ptyId, data) -> boolean
 *   - claude:resize (ptyId, cols, rows) -> boolean
 *   - claude:kill (ptyId) -> boolean
 *
 * Events fluindo main -> renderer:
 *   - claude:data (ptyId, data)
 *   - claude:exit (ptyId, code)
 */
export function registerClaudeIPC(): void {
  ipcMain.handle('claude:spawn', (_, opts: { cwd: string }) => {
    return ptyManager.spawn(opts);
  });

  ipcMain.handle('claude:write', (_, ptyId: string, data: string) => {
    return ptyManager.write(ptyId, data);
  });

  ipcMain.handle('claude:resize', (_, ptyId: string, cols: number, rows: number) => {
    return ptyManager.resize(ptyId, cols, rows);
  });

  ipcMain.handle('claude:kill', (_, ptyId: string) => {
    return ptyManager.kill(ptyId);
  });

  ipcMain.handle('claude:list', () => {
    return ptyManager.list();
  });

  // Storage local do Claude CLI — listar sessões por workspace.
  // TIMING LOG: rastreia start/end do IPC handler isolado do trabalho interno
  // (listSessionsForWorkspace tem seu próprio log). Útil pra ver overhead de
  // structured clone na response pra renderer.
  ipcMain.handle('claude:listProjectSessions', async (_, cwd: string) => {
    const t0 = Date.now();
    const result = await listSessionsForWorkspace(cwd);
    const elapsed = Date.now() - t0;
    if (elapsed > 50) {
      console.log(`[ipc] listProjectSessions ${cwd} took ${elapsed}ms (${result.length} items)`);
    }
    return result;
  });

  ipcMain.handle('claude:listKnownWorkspaces', async () => {
    const t0 = Date.now();
    const result = await listKnownWorkspaces();
    const elapsed = Date.now() - t0;
    if (elapsed > 30) {
      console.log(`[ipc] listKnownWorkspaces took ${elapsed}ms (${result.length} items)`);
    }
    return result;
  });

  // INSTANT cache snapshot — síncrono no main, retorna lista cacheada SEM
  // stat/streaming. Permite renderer pular "Carregando..." em remounts.
  // Renderer ainda deve disparar listProjectSessions em paralelo pra revalidar.
  ipcMain.handle('claude:getSessionsSnapshot', (_, cwd: string) => {
    return getCachedSessionsSnapshot(cwd);
  });

  // Retorna TODOS os snapshots de uma vez. Boot do renderer: 1 IPC popula UI inteira.
  ipcMain.handle('claude:getAllSessionsSnapshots', () => {
    const t0 = Date.now();
    const result = getAllCachedSessionsSnapshots();
    const elapsed = Date.now() - t0;
    const totalSessions = Object.values(result).reduce((sum, list) => sum + list.length, 0);
    console.log(`[ipc] getAllSessionsSnapshots took ${elapsed}ms (${Object.keys(result).length} workspaces, ${totalSessions} total sessions)`);
    return result;
  });

  // Le historico de uma sessão salva pra rehidratar UI quando o user "adopta".
  // 3º param `options` é opcional pra lazy load (limit/offset/fromEnd) — sem
  // ele retorna histórico completo (comportamento legacy).
  ipcMain.handle(
    'claude:readSessionHistory',
    async (_, sessionId: string, cwd: string, options?: ReadSessionHistoryOptions) => {
      const t0 = Date.now();
      const result = await readSessionHistory(sessionId, cwd, options);
      const elapsed = Date.now() - t0;
      if (elapsed > 100) {
        console.log(`[ipc] readSessionHistory ${sessionId.slice(0, 8)} took ${elapsed}ms (${result.events.length} events)`);
      }
      return result;
    },
  );

  // Broadcast pty data/exit pra TODAS as windows (simples por enquanto;
  // futuramente podemos targetear window específica)
  ptyManager.onData((ptyId, data) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('claude:data', ptyId, data);
      }
    }
  });

  ptyManager.onExit((ptyId, code) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('claude:exit', ptyId, code);
      }
    }
  });
}
