/**
 * Auth IPC — expõe status/login/logout do Claude CLI pro renderer.
 *
 * Handlers:
 *   - auth:getStatus () -> AuthStatus
 *   - auth:login    () -> { ok: boolean; error?: string }
 *   - auth:logout   () -> { ok: boolean; error?: string }
 *
 * NOTA: confirmacao do logout agora e feita no RENDERER via <ConfirmDialog>
 * (estilo UNDRCOD). O backend só executa a ação quando IPC for chamado — quem
 * pergunta "tem certeza?" e o renderer antes de invocar.
 *
 * NAO ha API pra apikey (ANTHROPIC_API_KEY) — só detect.
 */

import { ipcMain } from 'electron';
import { getAuthStatus, runLogin, runLogout } from '../auth-claude';

export function registerAuthIPC(): void {
  ipcMain.handle('auth:getStatus', () => getAuthStatus());
  ipcMain.handle('auth:login', () => runLogin());
  ipcMain.handle('auth:logout', () => runLogout());
}
