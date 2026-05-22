/**
 * settings IPC — bridge entre renderer e settings-store.
 *
 * Canais:
 *   - settings:get(key)         -> value (typed)
 *   - settings:set(key, value)  -> { ok: true, value } | { error }
 *   - settings:reset(key?)      -> snapshot completo (ou value se key dada)
 *   - settings:all()            -> UndrSettings completo
 *
 * Broadcasts:
 *   - settings:changed(key, value)  -> renderer reage (ex: theme, zoom)
 *   - settings:reset-all(snapshot)  -> reset global
 */

import { ipcMain, BrowserWindow } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  readAllSettings,
  readSetting,
  writeSetting,
  resetAllSettings,
  resetSetting,
} from '../settings-store';
import type { UndrSettings } from '../../shared/settings-types';

function broadcastChanged<K extends keyof UndrSettings>(key: K, value: UndrSettings[K]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('settings:changed', key, value);
    }
  }
}

function broadcastResetAll(snapshot: UndrSettings): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('settings:reset-all', snapshot);
    }
  }
}

export function registerSettingsIPC(): void {
  ipcMain.handle('settings:get', async (_evt, key: keyof UndrSettings) => {
    try {
      return await readSetting(key);
    } catch (err: any) {
      console.warn('[settings:get] erro:', err?.message);
      return undefined;
    }
  });

  ipcMain.handle('settings:all', async () => {
    try {
      return await readAllSettings();
    } catch (err: any) {
      console.error('[settings:all] erro:', err?.message);
      return null;
    }
  });

  ipcMain.handle('settings:set', async (_evt, key: keyof UndrSettings, value: unknown) => {
    try {
      const saved = await writeSetting(key, value);
      broadcastChanged(key, saved);
      return { ok: true as const, value: saved };
    } catch (err: any) {
      return { ok: false as const, error: err?.message ?? 'erro desconhecido' };
    }
  });

  ipcMain.handle('settings:importFromVSCode', async () => {
    // Procura settings.json do VS Code nos paths conhecidos por OS.
    const home = homedir();
    const candidates = [
      path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'settings.json'),       // Windows
      path.join(home, '.config', 'Code', 'User', 'settings.json'),                  // Linux
      path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json'), // Mac
    ];
    let found: string | null = null;
    for (const c of candidates) {
      try {
        await stat(c);
        found = c;
        break;
      } catch {
        // skip
      }
    }
    if (!found) {
      return { ok: false as const, error: 'VS Code settings.json não encontrado' };
    }

    let vscode: Record<string, unknown>;
    try {
      const raw = await readFile(found, 'utf-8');
      // VS Code aceita comments + trailing commas — strip antes de JSON.parse.
      // Remove // line comments e /* block */ comments, depois trailing commas.
      const clean = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/,(\s*[}\]])/g, '$1');
      vscode = JSON.parse(clean);
    } catch (err: any) {
      return { ok: false as const, error: `Falha ao ler/parsear: ${err?.message ?? 'erro desconhecido'}` };
    }

    // Mapeia keys VS Code -> UNDRCOD.
    const imported: Partial<UndrSettings> = {};
    if (typeof vscode['editor.fontSize'] === 'number') {
      imported.editorFontSize = vscode['editor.fontSize'] as number;
    }
    if (vscode['editor.tabSize'] === 2 || vscode['editor.tabSize'] === 4) {
      imported.editorTabWidth = vscode['editor.tabSize'] as 2 | 4;
    }
    if (typeof vscode['editor.wordWrap'] === 'string') {
      imported.editorWordWrap = vscode['editor.wordWrap'] !== 'off';
    }
    if (typeof vscode['editor.formatOnSave'] === 'boolean') {
      imported.formatOnSave = vscode['editor.formatOnSave'] as boolean;
    }
    if (typeof vscode['editor.formatOnPaste'] === 'boolean') {
      imported.formatOnPaste = vscode['editor.formatOnPaste'] as boolean;
    }
    if (typeof vscode['editor.bracketPairColorization.enabled'] === 'boolean') {
      imported.bracketPairColorization = vscode['editor.bracketPairColorization.enabled'] as boolean;
    }
    if (typeof vscode['editor.stickyScroll.enabled'] === 'boolean') {
      imported.stickyScroll = vscode['editor.stickyScroll.enabled'] as boolean;
    }
    if (
      vscode['files.autoSave'] === 'afterDelay' ||
      vscode['files.autoSave'] === 'onFocusChange' ||
      vscode['files.autoSave'] === 'off'
    ) {
      imported.autoSave = vscode['files.autoSave'] as 'afterDelay' | 'onFocusChange' | 'off';
    }
    if (typeof vscode['files.autoSaveDelay'] === 'number') {
      imported.autoSaveDelay = vscode['files.autoSaveDelay'] as number;
    }
    if (typeof vscode['window.zoomLevel'] === 'number') {
      // VS Code usa zoom em incrementos de 0.1 a partir do 1.0
      imported.zoomFactor = 1 + (vscode['window.zoomLevel'] as number) * 0.1;
    }

    return { ok: true as const, source: found, imported };
  });

  ipcMain.handle('settings:reset', async (_evt, key?: keyof UndrSettings) => {
    try {
      if (key) {
        const value = await resetSetting(key);
        broadcastChanged(key, value);
        return { ok: true as const, value };
      }
      const snapshot = await resetAllSettings();
      broadcastResetAll(snapshot);
      return { ok: true as const, snapshot };
    } catch (err: any) {
      return { ok: false as const, error: err?.message ?? 'erro desconhecido' };
    }
  });
}
