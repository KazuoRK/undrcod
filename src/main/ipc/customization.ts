/**
 * IPC bridge pra Customization Tabs UI — read-only discovery de Rules, Skills,
 * Workflows, Agents e Hooks. Tudo proxy direto pro customization-manager.
 *
 * Canais:
 *   - customization:summary (cwd)        -> CustomizationSummary
 *   - customization:listRules (cwd)      -> Rule[]
 *   - customization:listSkills (cwd)     -> Skill[]
 *   - customization:listWorkflows (cwd)  -> Workflow[]
 *   - customization:listAgents (cwd)     -> Agent[]
 *   - customization:listHooks (cwd)      -> HookEntry[]
 *
 * MCP tem canal próprio (mcp:list em ipc/mcp.ts) — não duplicamos aqui.
 */

import { ipcMain } from 'electron';
import {
  listRules,
  listSkills,
  listWorkflows,
  listAgents,
  listHooks,
  getCustomizationSummary,
} from '../customization-manager';

export function registerCustomizationIPC(): void {
  ipcMain.handle('customization:summary', (_evt, cwd: string) =>
    getCustomizationSummary(cwd ?? ''),
  );
  ipcMain.handle('customization:listRules', (_evt, cwd: string) => listRules(cwd ?? ''));
  ipcMain.handle('customization:listSkills', (_evt, cwd: string) => listSkills(cwd ?? ''));
  ipcMain.handle('customization:listWorkflows', (_evt, cwd: string) =>
    listWorkflows(cwd ?? ''),
  );
  ipcMain.handle('customization:listAgents', (_evt, cwd: string) => listAgents(cwd ?? ''));
  ipcMain.handle('customization:listHooks', (_evt, cwd: string) => listHooks(cwd ?? ''));
}
