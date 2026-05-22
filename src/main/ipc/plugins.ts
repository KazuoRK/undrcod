/**
 * IPC bridge pro Plugin Marketplace.
 *
 * Channels (handle):
 *   - plugins:listMarketplaces()                    -> Marketplace[]
 *   - plugins:listPlugins(marketplaceId)            -> PluginMeta[]
 *   - plugins:listInstalled()                       -> InstalledPlugin[]
 *   - plugins:install(name, marketplaceId)          -> { ok, error? }
 *   - plugins:uninstall(name)                       -> { ok, error? }
 *   - plugins:setEnabled(name, enabled)             -> { ok, error? }
 *   - plugins:addMarketplace(githubRepo)            -> { ok, error? }
 *   - plugins:removeMarketplace(id)                 -> { ok, error? }
 *   - plugins:refreshMarketplace(id)                -> { ok, error? }
 *
 * Toda mutação shell-out via `claude plugin ...` CLI (single source of truth).
 * Leitura cruza JSON do filesystem com `claude plugin list --json`.
 */

import { ipcMain } from 'electron';
import {
  listMarketplaces,
  listPlugins,
  listInstalledPlugins,
  installPlugin,
  uninstallPlugin,
  setPluginEnabled,
  addMarketplace,
  removeMarketplace,
  refreshMarketplace,
  getPluginDetails,
} from '../plugin-manager';

export function registerPluginsIPC(): void {
  ipcMain.handle('plugins:listMarketplaces', () => listMarketplaces());

  ipcMain.handle('plugins:listPlugins', (_evt, marketplaceId: string) =>
    listPlugins(marketplaceId ?? ''),
  );

  ipcMain.handle('plugins:listInstalled', () => listInstalledPlugins());

  ipcMain.handle(
    'plugins:install',
    (_evt, name: string, marketplaceId: string) =>
      installPlugin(name ?? '', marketplaceId ?? ''),
  );

  ipcMain.handle('plugins:uninstall', (_evt, name: string) =>
    uninstallPlugin(name ?? ''),
  );

  ipcMain.handle(
    'plugins:setEnabled',
    (_evt, name: string, enabled: boolean) =>
      setPluginEnabled(name ?? '', !!enabled),
  );

  ipcMain.handle('plugins:addMarketplace', (_evt, githubRepo: string) =>
    addMarketplace(githubRepo ?? ''),
  );

  ipcMain.handle('plugins:removeMarketplace', (_evt, id: string) =>
    removeMarketplace(id ?? ''),
  );

  ipcMain.handle('plugins:refreshMarketplace', (_evt, id: string) =>
    refreshMarketplace(id ?? ''),
  );

  // Inventario detalhado de UM plugin (componentes que ele instalou +
  // custo de tokens always-on). Usado pelo card expandido pra responder
  // "o que esse plugin faz?".
  ipcMain.handle('plugins:getDetails', (_evt, name: string) =>
    getPluginDetails(name ?? ''),
  );
}
