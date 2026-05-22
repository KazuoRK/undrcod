/**
 * McpCatalogBrowser — sub-view do McpManager pra navegar conectores MCP
 * populares e instalar em 1 clique.
 *
 * Substitui temporariamente a lista de servers do McpManager quando ativo.
 * Tem header próprio (título + busca + filtro de categoria + "Voltar").
 *
 * Defensive: se window.undrcodAPI?.mcp.listCatalog não existe (preload antigo),
 * mostra mensagem "Catalogo indisponível — reinicie o app" com fallback pra
 * trocar pro fluxo manual.
 *
 * Backend contract (mirror exato — backend partner confirmou):
 *
 *   interface McpCatalogEntry {
 *     id, displayName, description, category, command, args,
 *     authFields[], transport, official, vendor?, homepage?,
 *     iconSlug?, keywords?
 *   }
 *
 *   window.undrcodAPI?.mcp.listCatalog(): Promise<McpCatalogEntry[]>
 *
 * Se o shape vier diferente do esperado (backend mudou sem avisar),
 * loga warning e degrada silenciosamente (entries sem campos requeridos
 * são pulados).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './McpCatalogBrowser.css';

// ============================================================================
// Tipos (mirror do backend — partner confirmou)
// ============================================================================

export type McpCatalogCategory =
  | 'database'
  | 'devtools'
  | 'productivity'
  | 'communication'
  | 'storage'
  | 'web'
  | 'automation'
  | 'design'
  | 'finance'
  | 'other';

export type McpCatalogTransport = 'stdio' | 'http' | 'sse';

export interface McpCatalogAuthField {
  /** Env var name (ex: GITHUB_TOKEN) */
  name: string;
  label: string;
  type: 'password' | 'text' | 'url';
  required: boolean;
  help?: string;
}

export interface McpCatalogEntry {
  id: string;
  displayName: string;
  description: string;
  category: McpCatalogCategory;
  command: string;
  args: string[];
  authFields: McpCatalogAuthField[];
  transport: McpCatalogTransport;
  official: boolean;
  vendor?: string;
  homepage?: string;
  /** simple-icons slug (ex: "github", "slack"). Sem extension. */
  iconSlug?: string;
  keywords?: string[];
}

// ============================================================================
// Constantes — labels pt-BR pra categorias e transports
// ============================================================================

const CATEGORY_LABELS: Record<McpCatalogCategory, string> = {
  database: 'Database',
  devtools: 'Devtools',
  productivity: 'Produtividade',
  communication: 'Comunicacao',
  storage: 'Armazenamento',
  web: 'Web',
  automation: 'Automacao',
  design: 'Design',
  finance: 'Financas',
  other: 'Outros',
};

const CATEGORY_ORDER: McpCatalogCategory[] = [
  'database',
  'devtools',
  'productivity',
  'communication',
  'storage',
  'web',
  'automation',
  'design',
  'finance',
  'other',
];

/** Mapeia categoria → codicon fallback se entry não tem iconSlug. */
function iconForCategory(category: McpCatalogCategory): string {
  switch (category) {
    case 'database': return 'database';
    case 'devtools': return 'tools';
    case 'productivity': return 'checklist';
    case 'communication': return 'comment-discussion';
    case 'storage': return 'archive';
    case 'web': return 'globe';
    case 'automation': return 'zap';
    case 'design': return 'paintcan';
    case 'finance': return 'credit-card';
    case 'other':
    default: return 'plug';
  }
}

// ============================================================================
// Validacao defensiva — entry vinda do backend pode ter campos faltando
// ============================================================================

/** Type guard pra entries. Loga warning se algum campo essencial faltar. */
function isValidEntry(raw: unknown): raw is McpCatalogEntry {
  if (!raw || typeof raw !== 'object') return false;
  const e = raw as Record<string, unknown>;
  const required =
    typeof e.id === 'string' &&
    typeof e.displayName === 'string' &&
    typeof e.description === 'string' &&
    typeof e.category === 'string' &&
    typeof e.command === 'string' &&
    Array.isArray(e.args) &&
    Array.isArray(e.authFields) &&
    typeof e.transport === 'string' &&
    typeof e.official === 'boolean';
  if (!required) {
    console.warn('[McpCatalogBrowser] entry com shape invalido, pulando:', raw);
    return false;
  }
  return true;
}

// ============================================================================
// PluginLogo-style component pra logos do catalogo
// ============================================================================

/**
 * Cache de URLs que já falharam — evita re-tentar em cada render.
 */
const failedLogoUrls = new Set<string>();

/**
 * Logo do conector. Tenta simple-icons CDN (white-tinted via filter no CSS).
 * Se falhar (404 = slug invalido ou sem internet), cai pro codicon de fallback.
 */
function CatalogLogo({
  iconSlug,
  fallbackIcon,
}: {
  iconSlug: string | undefined;
  fallbackIcon: string;
}) {
  // Constroi URL absoluta do simple-icons CDN. Slug normalizado pra lowercase.
  const url = useMemo(() => {
    if (!iconSlug) return null;
    const slug = iconSlug.trim().toLowerCase();
    if (!slug) return null;
    return `https://cdn.simpleicons.org/${encodeURIComponent(slug)}`;
  }, [iconSlug]);

  const [failed, setFailed] = useState<boolean>(() => {
    if (!url) return true;
    return failedLogoUrls.has(url);
  });

  useEffect(() => {
    // Reset quando iconSlug muda
    if (!url) {
      setFailed(true);
      return;
    }
    setFailed(failedLogoUrls.has(url));
  }, [url]);

  if (!url || failed) {
    return <i className={`codicon codicon-${fallbackIcon}`} />;
  }

  return (
    <img
      src={url}
      alt=""
      className="mcp-catalog-logo-img"
      onError={() => {
        failedLogoUrls.add(url);
        setFailed(true);
      }}
    />
  );
}

// ============================================================================
// Props
// ============================================================================

interface McpCatalogBrowserProps {
  /** Chama quando user clica num conector — fecha browser, popula form. */
  onSelect: (entry: McpCatalogEntry) => void;
  /** Chama quando user clica "Voltar a lista" ou Esc. */
  onBack: () => void;
  /** Chama quando user prefere fluxo manual (catalogo indisponível). */
  onFallbackToManual?: () => void;
}

type FilterCategory = 'all' | McpCatalogCategory;

// ============================================================================
// McpCatalogBrowser
// ============================================================================

export function McpCatalogBrowser({ onSelect, onBack, onFallbackToManual }: McpCatalogBrowserProps) {
  const [entries, setEntries] = useState<McpCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterCategory>('all');

  const searchRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // Boot: detecta se listCatalog existe e carrega entries
  // -------------------------------------------------------------------------
  useEffect(() => {
    const api = window.undrcodAPI?.mcp as
      | { listCatalog?: () => Promise<unknown[]> }
      | undefined;
    if (!api || typeof api.listCatalog !== 'function') {
      setAvailable(false);
      setLoading(false);
      return;
    }
    setAvailable(true);
    let cancelled = false;
    api
      .listCatalog()
      .then((raw) => {
        if (cancelled) return;
        if (!Array.isArray(raw)) {
          console.warn('[McpCatalogBrowser] listCatalog não retornou array:', raw);
          setEntries([]);
          return;
        }
        const valid = raw.filter(isValidEntry);
        setEntries(valid);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[McpCatalogBrowser] listCatalog falhou:', err);
        setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Foca search ao montar
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (available === true) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [available]);

  // -------------------------------------------------------------------------
  // Esc volta pra lista
  // -------------------------------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Se tem search ativo, limpa primeiro
        if (search) {
          e.preventDefault();
          e.stopPropagation();
          setSearch('');
          return;
        }
        // Senao, volta pra lista (e deixa o McpManager handler não reabir
        // outra coisa — stopPropagation evita conflito com listener pai).
        e.preventDefault();
        e.stopPropagation();
        onBack();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, search]);

  // -------------------------------------------------------------------------
  // Categorias presentes (só mostra chips de categorias que tem entries)
  // -------------------------------------------------------------------------
  const presentCategories = useMemo(() => {
    const set = new Set<McpCatalogCategory>();
    for (const e of entries) set.add(e.category);
    return CATEGORY_ORDER.filter((c) => set.has(c));
  }, [entries]);

  // -------------------------------------------------------------------------
  // Filtra entries — search + categoria
  // -------------------------------------------------------------------------
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter !== 'all' && e.category !== filter) return false;
      if (!q) return true;
      const hay = [
        e.id,
        e.displayName,
        e.description,
        e.vendor,
        ...(e.keywords ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [entries, filter, search]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // Estado indisponível — sem listCatalog no preload
  if (available === false) {
    return (
      <div className="mcp-catalog-browser">
        <div className="mcp-catalog-header">
          <button
            type="button"
            className="mcp-catalog-back"
            onClick={onBack}
            title="Voltar (Esc)"
          >
            <i className="codicon codicon-arrow-left" />
            <span>Voltar a lista</span>
          </button>
          <span className="mcp-catalog-title">Catalogo de conectores</span>
        </div>
        <div className="mcp-catalog-unavailable">
          <i className="codicon codicon-warning mcp-catalog-unavailable-icon" />
          <div className="mcp-catalog-unavailable-title">Catalogo indisponível</div>
          <div className="mcp-catalog-unavailable-msg">
            Reinicie o app pra atualizar o preload. Enquanto isso, você pode
            adicionar conectores manualmente.
          </div>
          {onFallbackToManual && (
            <button
              type="button"
              className="mcp-catalog-fallback-btn"
              onClick={onFallbackToManual}
            >
              <i className="codicon codicon-add" />
              Adicionar manualmente
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mcp-catalog-browser">
      {/* ----------------------------------------------------------------
          Header — back + title + search + chips
      ---------------------------------------------------------------- */}
      <div className="mcp-catalog-header">
        <button
          type="button"
          className="mcp-catalog-back"
          onClick={onBack}
          title="Voltar (Esc)"
        >
          <i className="codicon codicon-arrow-left" />
          <span>Voltar a lista</span>
        </button>
        <span className="mcp-catalog-title">Catalogo de conectores</span>
      </div>

      <div className="mcp-catalog-search-row">
        <div className="mcp-catalog-search">
          <i className="codicon codicon-search mcp-catalog-search-icon" />
          <input
            ref={searchRef}
            type="text"
            className="mcp-catalog-search-input"
            placeholder="Pesquisar conectores..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="mcp-catalog-search-clear"
              onClick={() => setSearch('')}
              title="Limpar busca"
            >
              <i className="codicon codicon-close" />
            </button>
          )}
        </div>
      </div>

      {presentCategories.length > 0 && (
        <div className="mcp-catalog-chips" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={`mcp-catalog-chip ${filter === 'all' ? 'is-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            Tudo
          </button>
          {presentCategories.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={filter === c}
              className={`mcp-catalog-chip ${filter === c ? 'is-active' : ''}`}
              onClick={() => setFilter(c)}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      )}

      {/* ----------------------------------------------------------------
          Grid
      ---------------------------------------------------------------- */}
      <div className="mcp-catalog-body">
        {loading ? (
          <div className="mcp-catalog-grid">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="mcp-catalog-card-skeleton">
                <div className="mcp-catalog-skeleton-icon" />
                <div className="mcp-catalog-skeleton-lines">
                  <div className="mcp-catalog-skeleton-line is-title" />
                  <div className="mcp-catalog-skeleton-line is-meta" />
                  <div className="mcp-catalog-skeleton-line" />
                  <div className="mcp-catalog-skeleton-line is-short" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mcp-catalog-empty">
            <i className="codicon codicon-search-stop mcp-catalog-empty-icon" />
            {search ? (
              <>
                <div className="mcp-catalog-empty-title">
                  Nenhum conector encontrado pra <strong>"{search}"</strong>
                </div>
                <button
                  type="button"
                  className="mcp-catalog-clear-btn"
                  onClick={() => {
                    setSearch('');
                    setFilter('all');
                  }}
                >
                  Limpar busca
                </button>
              </>
            ) : (
              <div className="mcp-catalog-empty-title">
                {filter === 'all'
                  ? 'Catalogo vazio'
                  : `Nenhum conector na categoria ${CATEGORY_LABELS[filter as McpCatalogCategory]}`}
              </div>
            )}
          </div>
        ) : (
          <div className="mcp-catalog-grid">
            {filtered.map((entry) => (
              <CatalogCard
                key={entry.id}
                entry={entry}
                onSelect={() => onSelect(entry)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// CatalogCard — um card no grid
// ============================================================================

function CatalogCard({
  entry,
  onSelect,
}: {
  entry: McpCatalogEntry;
  onSelect: () => void;
}) {
  const fallbackIcon = iconForCategory(entry.category);
  const hasAuth = entry.authFields.length > 0;
  // Vendor só mostra se for diferente do displayName (evita "GitHub by GitHub")
  const showVendor =
    entry.vendor && entry.vendor.trim().toLowerCase() !== entry.displayName.trim().toLowerCase();

  // Click no card inteiro = mesma ação do botao
  const handleCardClick = useCallback(
    (e: React.MouseEvent) => {
      // Se clicou em link externo (futuro), não dispara
      if ((e.target as HTMLElement).closest('a')) return;
      onSelect();
    },
    [onSelect],
  );

  return (
    <button
      type="button"
      className="mcp-catalog-card"
      onClick={handleCardClick}
      aria-label={`Instalar ${entry.displayName}`}
    >
      {/* Top — logo + identidade (name + oficial + vendor) */}
      <div className="mcp-catalog-card-top">
        <div className="mcp-catalog-card-icon">
          <CatalogLogo iconSlug={entry.iconSlug} fallbackIcon={fallbackIcon} />
        </div>
        <div className="mcp-catalog-card-titlewrap">
          <div className="mcp-catalog-card-titlerow">
            <span className="mcp-catalog-card-name">{entry.displayName}</span>
            {entry.official && (
              <span className="mcp-catalog-badge is-official" title="Conector oficial">
                <i className="codicon codicon-verified" />
                Oficial
              </span>
            )}
          </div>
          {showVendor && (
            <div className="mcp-catalog-card-vendor">{entry.vendor}</div>
          )}
        </div>
      </div>

      {/* Description ocupa o resto do espaco vertical (push footer pra baixo) */}
      <div className="mcp-catalog-card-description" title={entry.description}>
        {entry.description}
      </div>

      {/* Footer — meta inline com separadores + botao instalar */}
      <div className="mcp-catalog-card-footer">
        <div className="mcp-catalog-card-meta">
          <span className="mcp-catalog-meta-item">
            {CATEGORY_LABELS[entry.category] || 'Outros'}
          </span>
          <span className="mcp-catalog-meta-sep">·</span>
          <span className="mcp-catalog-meta-item is-transport">
            {entry.transport.toUpperCase()}
          </span>
          {hasAuth && (
            <>
              <span className="mcp-catalog-meta-sep">·</span>
              <span className="mcp-catalog-meta-item is-auth" title="Requer chaves de acesso">
                <i className="codicon codicon-key" />
                credenciais
              </span>
            </>
          )}
        </div>
        <span className="mcp-catalog-install-btn">
          <i className="codicon codicon-add" />
          Instalar
        </span>
      </div>
    </button>
  );
}
