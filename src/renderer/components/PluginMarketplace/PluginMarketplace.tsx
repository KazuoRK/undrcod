/**
 * PluginMarketplace — modal pra navegar/instalar plugins do Claude Code.
 *
 * Layout: sidebar esquerda (lista de marketplaces) + body direita (grid de cards).
 * Header sticky com search bar, filtro de categoria, sort e refresh.
 *
 * Defensive: se window.undrcodAPI?.plugins não existe (backend ainda não
 * implementado no preload), mostra mensagem "Funcionalidade indisponível —
 * reinicie o app".
 *
 * APIs IPC esperadas:
 *   - plugins.listMarketplaces() -> Marketplace[]
 *   - plugins.listPlugins(marketplaceId?) -> PluginMeta[]
 *   - plugins.listInstalled() -> InstalledPlugin[]
 *   - plugins.install(name, marketplaceId) -> { ok } | { error }
 *   - plugins.uninstall(name) -> { ok } | { error }
 *   - plugins.setEnabled(name, enabled) -> { ok } | { error }
 *   - plugins.update(name) -> { ok } | { error }
 *   - plugins.addMarketplace(urlOrRepo) -> { ok, marketplace } | { error }
 *   - plugins.refresh() -> { ok } | { error }
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { confirmDialog } from '../ConfirmDialog/ConfirmDialog';
import './PluginMarketplace.css';

// ============================================================================
// Tipos (mirror do main process)
// ============================================================================

export interface Marketplace {
  id: string;
  name: string;
  url?: string;
  source: 'official' | 'custom';
  pluginCount: number;
  lastUpdated?: string;
}

export interface PluginMeta {
  name: string;
  description?: string;
  author?: string;
  category?: string;
  homepage?: string;
  marketplace: string;
  source?: string;
  /** Numero real de instalacoes globais (do `claude plugin list --json --available`). */
  installCount?: number;
  /** URLs de logo em ordem de preferência (backend deriva simple-icons + github avatar) */
  iconCandidates?: string[];
}

/** Inventario detalhado dum plugin instalado (Skills, Agents, etc). */
export interface PluginDetails {
  name: string;
  description?: string;
  source?: string;
  skills: string[];
  agents: string[];
  commands: string[];
  hooks: string[];
  mcpServers: string[];
  lspServers: string[];
  alwaysOnTokens?: number;
}

export interface InstalledPlugin {
  name: string;
  marketplace?: string;
  enabled: boolean;
  version?: string;
}

interface PluginsAPI {
  listMarketplaces?: () => Promise<Marketplace[]>;
  listPlugins?: (marketplaceId?: string | null) => Promise<PluginMeta[]>;
  listInstalled?: () => Promise<InstalledPlugin[]>;
  install?: (name: string, marketplaceId: string) => Promise<{ ok: true } | { error: string }>;
  uninstall?: (name: string) => Promise<{ ok: true } | { error: string }>;
  setEnabled?: (name: string, enabled: boolean) => Promise<{ ok: true } | { error: string }>;
  update?: (name: string) => Promise<{ ok: true } | { error: string }>;
  addMarketplace?: (
    urlOrRepo: string,
  ) => Promise<{ ok: true; marketplace: Marketplace } | { error: string }>;
  refresh?: () => Promise<{ ok: true } | { error: string }>;
  getDetails?: (name: string) => Promise<PluginDetails | null>;
}

// ============================================================================
// Props
// ============================================================================

interface PluginMarketplaceProps {
  open: boolean;
  onClose: () => void;
}

type SortBy = 'name' | 'category' | 'recent';

// ============================================================================
// Helpers
// ============================================================================

/** Mapeia categoria → codicon. Fallback `extensions`. */
function iconForCategory(category?: string): string {
  if (!category) return 'extensions';
  const c = category.toLowerCase();
  if (c.includes('ai') || c.includes('skill')) return 'sparkle';
  if (c.includes('git')) return 'git-merge';
  if (c.includes('test')) return 'beaker';
  if (c.includes('lint') || c.includes('format')) return 'wand';
  if (c.includes('design') || c.includes('ui')) return 'paintcan';
  if (c.includes('search')) return 'search';
  if (c.includes('debug')) return 'bug';
  if (c.includes('lang') || c.includes('language')) return 'symbol-keyword';
  if (c.includes('build')) return 'tools';
  if (c.includes('theme')) return 'color-mode';
  if (c.includes('snippet')) return 'symbol-snippet';
  if (c.includes('terminal')) return 'terminal';
  if (c.includes('cloud') || c.includes('deploy')) return 'cloud';
  if (c.includes('data') || c.includes('db')) return 'database';
  if (c.includes('doc')) return 'book';
  return 'extensions';
}

/** Safe-get da API com cast. Permite ler sem TypeScript reclamar. */
function getPluginsAPI(): PluginsAPI | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = window.undrcodAPI?.plugins as PluginsAPI | undefined;
  return api || null;
}

/**
 * PluginLogo — img com cascata de fallback.
 *
 * Tenta cada URL em ordem; se 404/erro, avança pro próximo. Se todos falharem,
 * mostra o codicon de fallback (que já vem renderizado por baixo, escondido
 * enquanto a img carrega). Memoiza "URLs que falharam" pra evitar re-tentar
 * em re-render.
 */
const failedLogoUrls = new Set<string>();

function PluginLogo({
  candidates,
  fallbackIcon,
}: {
  candidates: string[] | undefined;
  fallbackIcon: string;
}) {
  // Filtra URLs já marcadas como falhadas em prev renders
  const validCandidates = useMemo(
    () => (candidates ?? []).filter((u) => !failedLogoUrls.has(u)),
    [candidates],
  );
  const [idx, setIdx] = useState(0);
  const [showFallback, setShowFallback] = useState(validCandidates.length === 0);

  // Reset quando candidates muda
  useEffect(() => {
    setIdx(0);
    setShowFallback(validCandidates.length === 0);
  }, [validCandidates]);

  if (showFallback || idx >= validCandidates.length) {
    return <i className={`codicon codicon-${fallbackIcon}`} />;
  }

  const url = validCandidates[idx];
  return (
    <img
      src={url}
      alt=""
      className="plugin-mkt-logo-img"
      onError={() => {
        failedLogoUrls.add(url);
        if (idx + 1 < validCandidates.length) {
          setIdx(idx + 1);
        } else {
          setShowFallback(true);
        }
      }}
    />
  );
}

// ============================================================================
// PluginMarketplace
// ============================================================================

export function PluginMarketplace({ open, onClose }: PluginMarketplaceProps) {
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [activeMarketplaceId, setActiveMarketplaceId] = useState<string | null>(null);
  const [plugins, setPlugins] = useState<PluginMeta[]>([]);
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('name');

  const [installInProgress, setInstallInProgress] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<Map<string, { kind: 'success' | 'error'; msg: string }>>(
    new Map(),
  );
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [pluginActionMenu, setPluginActionMenu] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // Defensive: detecta se API ta disponível
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    const api = getPluginsAPI();
    if (!api || typeof api.listMarketplaces !== 'function') {
      setAvailable(false);
      return;
    }
    setAvailable(true);
  }, [open]);

  // -------------------------------------------------------------------------
  // Carrega marketplaces
  // -------------------------------------------------------------------------
  const refreshMarketplaces = useCallback(async () => {
    const api = getPluginsAPI();
    if (!api?.listMarketplaces) return;
    try {
      const list = await api.listMarketplaces();
      setMarketplaces(list);
      // Se não ha marketplace ativo, escolhe o primeiro
      setActiveMarketplaceId((prev) => {
        if (prev && list.some((m) => m.id === prev)) return prev;
        return list[0]?.id || null;
      });
    } catch (err) {
      console.warn('[PluginMarketplace] listMarketplaces falhou:', err);
      setMarketplaces([]);
    }
  }, []);

  const refreshInstalled = useCallback(async () => {
    const api = getPluginsAPI();
    if (!api?.listInstalled) return;
    try {
      const list = await api.listInstalled();
      setInstalled(list);
    } catch (err) {
      console.warn('[PluginMarketplace] listInstalled falhou:', err);
      setInstalled([]);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Carrega plugins do marketplace ativo
  // -------------------------------------------------------------------------
  const refreshPlugins = useCallback(async () => {
    const api = getPluginsAPI();
    if (!api?.listPlugins) return;
    setLoading(true);
    try {
      const list = await api.listPlugins(activeMarketplaceId);
      setPlugins(list);
    } catch (err) {
      console.warn('[PluginMarketplace] listPlugins falhou:', err);
      setPlugins([]);
    } finally {
      setLoading(false);
    }
  }, [activeMarketplaceId]);

  // Boot: carrega marketplaces + installed quando abre
  useEffect(() => {
    if (!open || available !== true) return;
    refreshMarketplaces();
    refreshInstalled();
  }, [open, available, refreshMarketplaces, refreshInstalled]);

  // Quando marketplace ativo muda, recarrega plugins
  useEffect(() => {
    if (!open || available !== true) return;
    if (activeMarketplaceId === null) return;
    refreshPlugins();
  }, [open, available, activeMarketplaceId, refreshPlugins]);

  // Esc fecha (ou colapsa plugin expandido se aberto)
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (pluginActionMenu) {
          setPluginActionMenu(null);
          return;
        }
        if (expandedPlugin) {
          setExpandedPlugin(null);
          return;
        }
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, expandedPlugin, pluginActionMenu]);

  // Reset state quando fecha
  useEffect(() => {
    if (!open) {
      setSearch('');
      setCategoryFilter(null);
      setSortBy('name');
      setExpandedPlugin(null);
      setPluginActionMenu(null);
      setFeedback(new Map());
    }
  }, [open]);

  // Foca search ao abrir
  useEffect(() => {
    if (open && available === true) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [open, available]);

  // -------------------------------------------------------------------------
  // Map name → installed entry (lookup rapido)
  // -------------------------------------------------------------------------
  const installedByName = useMemo(() => {
    const m = new Map<string, InstalledPlugin>();
    for (const p of installed) m.set(p.name, p);
    return m;
  }, [installed]);

  // -------------------------------------------------------------------------
  // Categorias unicas presentes no marketplace ativo
  // -------------------------------------------------------------------------
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of plugins) {
      if (p.category) set.add(p.category);
    }
    return Array.from(set).sort();
  }, [plugins]);

  // -------------------------------------------------------------------------
  // Filtra + ordena plugins
  // -------------------------------------------------------------------------
  const filteredPlugins = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = plugins.filter((p) => {
      if (categoryFilter && p.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.author?.toLowerCase().includes(q)
      );
    });
    list = [...list].sort((a, b) => {
      // Installed first, sempre — independente de sortBy. Padrão de marketplaces
      // (VS Code, Cursor, JetBrains) — usuário sempre quer ver seus instalados
      // primeiro. Disabled também conta como instalado (state, não absence).
      const aInstalled = installedByName.has(a.name);
      const bInstalled = installedByName.has(b.name);
      if (aInstalled !== bInstalled) return aInstalled ? -1 : 1;

      switch (sortBy) {
        case 'category':
          return (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name);
        case 'recent':
          // Sem timestamp no PluginMeta — fallback pra name. Backend pode
          // adicionar lastUpdated futuramente.
          return a.name.localeCompare(b.name);
        case 'name':
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return list;
  }, [plugins, search, categoryFilter, sortBy, installedByName]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const handleRefreshAll = useCallback(async () => {
    const api = getPluginsAPI();
    if (api?.refresh) {
      try {
        await api.refresh();
      } catch (err) {
        console.warn('[PluginMarketplace] refresh falhou:', err);
      }
    }
    await refreshMarketplaces();
    await refreshInstalled();
    await refreshPlugins();
  }, [refreshMarketplaces, refreshInstalled, refreshPlugins]);

  const handleInstall = useCallback(
    async (plugin: PluginMeta) => {
      const api = getPluginsAPI();
      if (!api?.install) return;
      const ok = await confirmDialog({
        title: 'Instalar plugin',
        message: `Instalar "${plugin.name}"${plugin.author ? ` de ${plugin.author}` : ''}?`,
        confirmLabel: 'Instalar',
      });
      if (!ok) return;

      setInstallInProgress((prev) => {
        const next = new Set(prev);
        next.add(plugin.name);
        return next;
      });
      try {
        const res = await api.install(plugin.name, plugin.marketplace);
        if ('error' in res) {
          setFeedback((prev) => {
            const next = new Map(prev);
            next.set(plugin.name, { kind: 'error', msg: res.error });
            return next;
          });
        } else {
          setFeedback((prev) => {
            const next = new Map(prev);
            next.set(plugin.name, { kind: 'success', msg: 'Instalado!' });
            return next;
          });
          await refreshInstalled();
          // Auto-clear feedback após 3s
          setTimeout(() => {
            setFeedback((prev) => {
              const next = new Map(prev);
              next.delete(plugin.name);
              return next;
            });
          }, 3000);
        }
      } catch (err) {
        setFeedback((prev) => {
          const next = new Map(prev);
          next.set(plugin.name, { kind: 'error', msg: (err as Error).message });
          return next;
        });
      } finally {
        setInstallInProgress((prev) => {
          const next = new Set(prev);
          next.delete(plugin.name);
          return next;
        });
      }
    },
    [refreshInstalled],
  );

  const handleUninstall = useCallback(
    async (name: string) => {
      const api = getPluginsAPI();
      if (!api?.uninstall) return;
      const ok = await confirmDialog({
        title: 'Remover plugin',
        message: `Remover "${name}"? Os arquivos do plugin serao deletados.`,
        confirmLabel: 'Remover',
        destructive: true,
      });
      if (!ok) return;
      setPluginActionMenu(null);
      try {
        const res = await api.uninstall(name);
        if ('error' in res) {
          setFeedback((prev) => {
            const next = new Map(prev);
            next.set(name, { kind: 'error', msg: res.error });
            return next;
          });
        } else {
          await refreshInstalled();
        }
      } catch (err) {
        console.warn('[PluginMarketplace] uninstall falhou:', err);
      }
    },
    [refreshInstalled],
  );

  const handleToggleEnabled = useCallback(
    async (name: string, currentEnabled: boolean) => {
      const api = getPluginsAPI();
      if (!api?.setEnabled) return;
      setPluginActionMenu(null);
      try {
        await api.setEnabled(name, !currentEnabled);
        await refreshInstalled();
      } catch (err) {
        console.warn('[PluginMarketplace] setEnabled falhou:', err);
      }
    },
    [refreshInstalled],
  );

  const handleUpdate = useCallback(
    async (name: string) => {
      const api = getPluginsAPI();
      if (!api?.update) return;
      setPluginActionMenu(null);
      try {
        const res = await api.update(name);
        if ('error' in res) {
          setFeedback((prev) => {
            const next = new Map(prev);
            next.set(name, { kind: 'error', msg: res.error });
            return next;
          });
        } else {
          setFeedback((prev) => {
            const next = new Map(prev);
            next.set(name, { kind: 'success', msg: 'Atualizado!' });
            return next;
          });
          await refreshInstalled();
          setTimeout(() => {
            setFeedback((prev) => {
              const next = new Map(prev);
              next.delete(name);
              return next;
            });
          }, 3000);
        }
      } catch (err) {
        console.warn('[PluginMarketplace] update falhou:', err);
      }
    },
    [refreshInstalled],
  );

  const handleAddMarketplace = useCallback(async () => {
    const api = getPluginsAPI();
    if (!api?.addMarketplace) return;
    const input = window.prompt(
      'Adicionar marketplace customizado\n\nDigite o repo GitHub (user/repo) ou URL completa:',
      '',
    );
    if (!input) return;
    try {
      const res = await api.addMarketplace(input.trim());
      if ('error' in res) {
        window.alert(`Erro: ${res.error}`);
        return;
      }
      await refreshMarketplaces();
      // Selecionar o novo marketplace
      setActiveMarketplaceId(res.marketplace.id);
    } catch (err) {
      window.alert(`Erro: ${(err as Error).message}`);
    }
  }, [refreshMarketplaces]);

  // -------------------------------------------------------------------------
  // Marketplaces agrupados pra sidebar
  // -------------------------------------------------------------------------
  const officialMarketplaces = useMemo(
    () => marketplaces.filter((m) => m.source === 'official'),
    [marketplaces],
  );
  const customMarketplaces = useMemo(
    () => marketplaces.filter((m) => m.source === 'custom'),
    [marketplaces],
  );

  if (!open) return null;

  return (
    <div className="plugin-mkt-backdrop" onClick={onClose}>
      <div
        className="plugin-mkt-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Plugins"
      >
        {/* ----------------------------------------------------------------
            Header
        ---------------------------------------------------------------- */}
        <div className="plugin-mkt-header">
          <div className="plugin-mkt-header-top">
            <span className="plugin-mkt-title">Plugins</span>
            <button
              type="button"
              className="plugin-mkt-close"
              onClick={onClose}
              title="Fechar (Esc)"
            >
              <i className="codicon codicon-close" />
            </button>
          </div>

          {available !== false && (
            <>
              <div className="plugin-mkt-search-row">
                <div className="plugin-mkt-search">
                  <i className="codicon codicon-search plugin-mkt-search-icon" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    className="plugin-mkt-search-input"
                    placeholder="Pesquisar plugins..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button
                      type="button"
                      className="plugin-mkt-search-clear"
                      onClick={() => setSearch('')}
                      title="Limpar"
                    >
                      <i className="codicon codicon-close" />
                    </button>
                  )}
                </div>
                <select
                  className="plugin-mkt-select"
                  value={categoryFilter || ''}
                  onChange={(e) => setCategoryFilter(e.target.value || null)}
                  title="Filtrar por categoria"
                >
                  <option value="">Todas as categorias</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select
                  className="plugin-mkt-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  title="Ordenar"
                >
                  <option value="name">Nome (A-Z)</option>
                  <option value="category">Categoria</option>
                  <option value="recent">Recentes</option>
                </select>
                <button
                  type="button"
                  className="plugin-mkt-icon-btn"
                  onClick={handleRefreshAll}
                  title="Atualizar lista"
                  disabled={loading}
                >
                  <i className={`codicon codicon-refresh ${loading ? 'is-spinning' : ''}`} />
                </button>
              </div>
            </>
          )}
        </div>

        {/* ----------------------------------------------------------------
            Unavailable state
        ---------------------------------------------------------------- */}
        {available === false ? (
          <div className="plugin-mkt-unavailable">
            <i className="codicon codicon-warning plugin-mkt-unavailable-icon" />
            <div className="plugin-mkt-unavailable-title">Funcionalidade indisponível</div>
            <div className="plugin-mkt-unavailable-msg">
              A ponte de plugins não esta carregada. Reinicie o app pra atualizar o preload.
            </div>
          </div>
        ) : (
          <div className="plugin-mkt-body">
            {/* ----------------------------------------------------------
                Sidebar — marketplaces
            ---------------------------------------------------------- */}
            <nav className="plugin-mkt-sidebar">
              <div className="plugin-mkt-sidebar-group">
                <div className="plugin-mkt-sidebar-group-label">Anthropic e Parceiros</div>
                {officialMarketplaces.length === 0 ? (
                  <div className="plugin-mkt-sidebar-empty">Nenhum marketplace oficial</div>
                ) : (
                  officialMarketplaces.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`plugin-mkt-sidebar-item ${
                        activeMarketplaceId === m.id ? 'is-active' : ''
                      }`}
                      onClick={() => setActiveMarketplaceId(m.id)}
                      title={m.url || m.name}
                    >
                      <i className="codicon codicon-verified plugin-mkt-sidebar-icon" />
                      <span className="plugin-mkt-sidebar-name">{m.name}</span>
                      <span className="plugin-mkt-sidebar-count">{m.pluginCount}</span>
                    </button>
                  ))
                )}
              </div>

              <div className="plugin-mkt-sidebar-group">
                <div className="plugin-mkt-sidebar-group-label">Seus marketplaces customizados</div>
                {customMarketplaces.length === 0 ? (
                  <div className="plugin-mkt-sidebar-empty">Nenhum adicionado</div>
                ) : (
                  customMarketplaces.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`plugin-mkt-sidebar-item ${
                        activeMarketplaceId === m.id ? 'is-active' : ''
                      }`}
                      onClick={() => setActiveMarketplaceId(m.id)}
                      title={m.url || m.name}
                    >
                      <i className="codicon codicon-github plugin-mkt-sidebar-icon" />
                      <span className="plugin-mkt-sidebar-name">{m.name}</span>
                      <span className="plugin-mkt-sidebar-count">{m.pluginCount}</span>
                    </button>
                  ))
                )}
              </div>
            </nav>

            {/* ----------------------------------------------------------
                Content — grid de cards
            ---------------------------------------------------------- */}
            <div className="plugin-mkt-content">
              {loading ? (
                <div className="plugin-mkt-loading">
                  <i className="codicon codicon-loading codicon-modifier-spin" />
                  <span>Carregando plugins...</span>
                </div>
              ) : filteredPlugins.length === 0 ? (
                <div className="plugin-mkt-empty">
                  <i className="codicon codicon-extensions plugin-mkt-empty-icon" />
                  <div className="plugin-mkt-empty-title">
                    {search || categoryFilter ? 'Nenhum plugin encontrado' : 'Marketplace vazio'}
                  </div>
                  <div className="plugin-mkt-empty-msg">
                    {search || categoryFilter
                      ? 'Tente outro termo de busca ou limpe o filtro.'
                      : 'Este marketplace não tem plugins ainda.'}
                  </div>
                </div>
              ) : (
                <div className="plugin-mkt-grid">
                  {filteredPlugins.map((plugin) => {
                    const installedEntry = installedByName.get(plugin.name);
                    const isInstalled = Boolean(installedEntry);
                    const inProgress = installInProgress.has(plugin.name);
                    const fb = feedback.get(plugin.name);
                    const isExpanded = expandedPlugin === plugin.name;
                    const showMenu = pluginActionMenu === plugin.name;
                    return (
                      <PluginCard
                        key={`${plugin.marketplace}:${plugin.name}`}
                        plugin={plugin}
                        installed={installedEntry}
                        isInstalled={isInstalled}
                        inProgress={inProgress}
                        feedback={fb}
                        expanded={isExpanded}
                        actionMenuOpen={showMenu}
                        onToggleExpand={() =>
                          setExpandedPlugin((prev) => (prev === plugin.name ? null : plugin.name))
                        }
                        onInstall={() => handleInstall(plugin)}
                        onOpenActionMenu={() =>
                          setPluginActionMenu((prev) =>
                            prev === plugin.name ? null : plugin.name,
                          )
                        }
                        onUninstall={() => handleUninstall(plugin.name)}
                        onToggleEnabled={() =>
                          handleToggleEnabled(plugin.name, installedEntry?.enabled ?? true)
                        }
                        onUpdate={() => handleUpdate(plugin.name)}
                        onOpenHomepage={() => {
                          if (plugin.homepage) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const ext = window.undrcodAPI?.openExternal;
                            if (typeof ext === 'function') ext(plugin.homepage);
                          }
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------
            Footer
        ---------------------------------------------------------------- */}
        <div className="plugin-mkt-footer">
          {available !== false ? (
            <>
              <span className="plugin-mkt-footer-stats">
                {filteredPlugins.length} {filteredPlugins.length === 1 ? 'plugin' : 'plugins'}{' '}
                {search || categoryFilter ? 'filtrado(s)' : 'disponível(eis)'}
                {installed.length > 0 && (
                  <>
                    {' · '}
                    {installed.length} instalado{installed.length !== 1 ? 's' : ''}
                  </>
                )}
              </span>
              <div className="plugin-mkt-footer-actions">
                <button
                  type="button"
                  className="plugin-mkt-link-btn"
                  onClick={handleAddMarketplace}
                >
                  <i className="codicon codicon-add" />
                  Adicionar marketplace
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="plugin-mkt-footer-hint">Backend não carregado</span>
              <button type="button" className="plugin-mkt-btn" onClick={onClose}>
                Fechar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PluginCard
// ============================================================================

interface PluginCardProps {
  plugin: PluginMeta;
  installed?: InstalledPlugin;
  isInstalled: boolean;
  inProgress: boolean;
  feedback?: { kind: 'success' | 'error'; msg: string };
  expanded: boolean;
  actionMenuOpen: boolean;
  onToggleExpand: () => void;
  onInstall: () => void;
  onOpenActionMenu: () => void;
  onUninstall: () => void;
  onToggleEnabled: () => void;
  onUpdate: () => void;
  onOpenHomepage: () => void;
}

/** Formata installCount de forma compacta (1234 -> "1.2k", 1234567 -> "1.2M"). */
function formatInstallCount(n: number | undefined): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace('.0', '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
}

/** Renderiza um chip de componente (skill/agent/etc) com icon + nome. */
function ComponentChip({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="plugin-mkt-component-chip" title={label}>
      <i className={`codicon codicon-${icon}`} />
      <span>{label}</span>
    </span>
  );
}

function PluginCard({
  plugin,
  installed,
  isInstalled,
  inProgress,
  feedback,
  expanded,
  actionMenuOpen,
  onToggleExpand,
  onInstall,
  onOpenActionMenu,
  onUninstall,
  onToggleEnabled,
  onUpdate,
  onOpenHomepage,
}: PluginCardProps) {
  const icon = iconForCategory(plugin.category);
  const installCountLabel = formatInstallCount(plugin.installCount);
  // Plugins com source local-path não tem versão real — CLI retorna "unknown".
  // Mostra "local" em vez de "vunknown" feio.
  const versionDisplay = installed?.version
    ? installed.version === 'unknown' ? 'local' : `v${installed.version}`
    : null;

  // Inventario carregado lazy quando expande pela primeira vez.
  const [details, setDetails] = useState<PluginDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  useEffect(() => {
    // Só carrega quando expande E plugin esta instalado (details só funciona pra installed)
    if (!expanded || !isInstalled || details !== null || detailsLoading) return;
    const api = getPluginsAPI();
    if (!api?.getDetails) return;
    setDetailsLoading(true);
    setDetailsError(null);
    api.getDetails(plugin.name)
      .then((res) => {
        if (res) setDetails(res);
        else setDetailsError('Detalhes indisponiveis');
      })
      .catch((err) => setDetailsError((err as Error).message))
      .finally(() => setDetailsLoading(false));
  }, [expanded, isInstalled, plugin.name, details, detailsLoading]);

  // Guarda click no card body sem propagar pros botoes
  const handleCardClick = useCallback(
    (e: React.MouseEvent) => {
      // Se clicou em botao, ignora
      if ((e.target as HTMLElement).closest('button')) return;
      onToggleExpand();
    },
    [onToggleExpand],
  );

  return (
    <div
      className={`plugin-mkt-card ${expanded ? 'is-expanded' : ''} ${
        isInstalled ? 'is-installed' : ''
      } ${installed && !installed.enabled ? 'is-disabled' : ''}`}
      onClick={handleCardClick}
    >
      <div className="plugin-mkt-card-icon">
        <PluginLogo candidates={plugin.iconCandidates} fallbackIcon={icon} />
      </div>

      <div className="plugin-mkt-card-body">
        <div className="plugin-mkt-card-header">
          <span className="plugin-mkt-card-name">{plugin.name}</span>
          {versionDisplay && (
            <span className="plugin-mkt-card-version">{versionDisplay}</span>
          )}
          {installed && !installed.enabled && (
            <span className="plugin-mkt-card-badge">desabilitado</span>
          )}
        </div>

        <div className="plugin-mkt-card-meta">
          {plugin.author && (
            <span className="plugin-mkt-card-author">
              <i className="codicon codicon-person" />
              {plugin.author}
            </span>
          )}
          {plugin.category && (
            <span className="plugin-mkt-card-category">{plugin.category}</span>
          )}
          {installCountLabel && (
            <span className="plugin-mkt-card-installs" title={`${plugin.installCount?.toLocaleString('pt-BR')} instalacoes`}>
              <i className="codicon codicon-cloud-download" />
              {installCountLabel}
            </span>
          )}
        </div>

        {plugin.description && (
          <div
            className={`plugin-mkt-card-description ${expanded ? 'is-full' : ''}`}
            title={plugin.description}
          >
            {plugin.description}
          </div>
        )}

        {expanded && (
          <div className="plugin-mkt-card-expanded">
            {/* Inventario de componentes (só pra plugins instalados) */}
            {isInstalled && (
              <div className="plugin-mkt-inventory">
                {detailsLoading && (
                  <div className="plugin-mkt-inventory-loading">
                    <i className="codicon codicon-loading codicon-modifier-spin" />
                    Carregando inventario...
                  </div>
                )}
                {detailsError && (
                  <div className="plugin-mkt-inventory-error">
                    <i className="codicon codicon-warning" />
                    {detailsError}
                  </div>
                )}
                {details && (
                  <>
                    {(details.skills.length + details.agents.length + details.commands.length + details.hooks.length + details.mcpServers.length + details.lspServers.length) > 0 ? (
                      <>
                        <div className="plugin-mkt-inventory-title">O que esse plugin traz:</div>
                        <div className="plugin-mkt-inventory-grid">
                          {details.skills.map((s) => (
                            <ComponentChip key={`s-${s}`} icon="sparkle" label={s} />
                          ))}
                          {details.agents.map((a) => (
                            <ComponentChip key={`a-${a}`} icon="person" label={a} />
                          ))}
                          {details.commands.map((c) => (
                            <ComponentChip key={`c-${c}`} icon="symbol-event" label={`/${c}`} />
                          ))}
                          {details.hooks.map((h) => (
                            <ComponentChip key={`h-${h}`} icon="bell" label={h} />
                          ))}
                          {details.mcpServers.map((m) => (
                            <ComponentChip key={`m-${m}`} icon="plug" label={m} />
                          ))}
                          {details.lspServers.map((l) => (
                            <ComponentChip key={`l-${l}`} icon="symbol-keyword" label={l} />
                          ))}
                        </div>
                        {details.alwaysOnTokens && (
                          <div className="plugin-mkt-inventory-footer">
                            <i className="codicon codicon-pulse" />
                            ~{details.alwaysOnTokens} tokens always-on por sessão
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="plugin-mkt-inventory-empty">
                        Plugin sem componentes ativos (só config/metadata).
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {plugin.homepage && (
              <button
                type="button"
                className="plugin-mkt-card-link"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenHomepage();
                }}
              >
                <i className="codicon codicon-link-external" />
                {plugin.homepage}
              </button>
            )}
          </div>
        )}

        {feedback && (
          <div className={`plugin-mkt-card-feedback is-${feedback.kind}`}>
            <i
              className={`codicon codicon-${
                feedback.kind === 'success' ? 'check' : 'warning'
              }`}
            />
            {feedback.msg}
          </div>
        )}
      </div>

      <div className="plugin-mkt-card-actions">
        {inProgress ? (
          <div className="plugin-mkt-card-spinner" title="Instalando...">
            <i className="codicon codicon-loading codicon-modifier-spin" />
          </div>
        ) : isInstalled ? (
          <div className="plugin-mkt-card-action-wrap">
            <button
              type="button"
              className="plugin-mkt-card-action plugin-mkt-card-action-installed"
              onClick={onOpenActionMenu}
              title="Configurar"
            >
              <i className="codicon codicon-settings-gear" />
            </button>
            {actionMenuOpen && (
              <div className="plugin-mkt-card-menu" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="plugin-mkt-card-menu-item"
                  onClick={onToggleEnabled}
                >
                  <i
                    className={`codicon codicon-${
                      installed?.enabled ? 'circle-slash' : 'check'
                    }`}
                  />
                  {installed?.enabled ? 'Desabilitar' : 'Habilitar'}
                </button>
                <button type="button" className="plugin-mkt-card-menu-item" onClick={onUpdate}>
                  <i className="codicon codicon-cloud-download" />
                  Atualizar
                </button>
                <div className="plugin-mkt-card-menu-divider" />
                <button
                  type="button"
                  className="plugin-mkt-card-menu-item is-danger"
                  onClick={onUninstall}
                >
                  <i className="codicon codicon-trash" />
                  Remover
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="plugin-mkt-card-action plugin-mkt-card-action-install"
            onClick={onInstall}
            title={`Instalar ${plugin.name}`}
            aria-label={`Instalar ${plugin.name}`}
          >
            <i className="codicon codicon-add" />
          </button>
        )}
      </div>
    </div>
  );
}
