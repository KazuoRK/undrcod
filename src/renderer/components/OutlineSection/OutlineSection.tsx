/**
 * OutlineSection — versão inline (sempre visível) do outline de símbolos.
 *
 * Diferente do SymbolOutline modal (Ctrl+Shift+O), este componente fica
 * persistente abaixo do FileTree na pane-left, estilo VSCode/Cursor.
 *
 * Comportamento:
 * - Header collapsible (click no chevron/título).
 * - Body lista símbolos do arquivo ativo. Click dispara
 *   CustomEvent('undrcod:goto-line', { detail: { path, line } }).
 * - Filter input (ícone de busca no header) — quando ativo, mostra input.
 * - Sem leitura própria de fs: o pai injeta `content` (dirty ou lido).
 *   Se content for null e filePath não null, lê via window.undrcodAPI?.fs.readFile.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  parseSymbols,
  iconForKind,
  type ParsedSymbol,
} from '../../utils/symbolParser';
import './OutlineSection.css';

interface OutlineSectionProps {
  filePath: string | null;
  /** Conteúdo do arquivo. Se null/undefined e filePath presente, lê via fs. */
  content: string | null;
}

const OUTLINE_COLLAPSED_KEY = 'undrcod:outline-collapsed';

export function OutlineSection({ filePath, content }: OutlineSectionProps) {
  // Default colapsado — sidebar fica menos ruidosa quando o arquivo não tem
  // símbolos detectáveis (HTML/CSS/Markdown). User expande quando precisa.
  // Persiste a escolha em localStorage (mesma key pattern do TimelineSection).
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(OUTLINE_COLLAPSED_KEY);
      return v === null ? true : v === '1';
    } catch {
      return true;
    }
  });
  // Skip o primeiro run — só grava em mudanças reais (user toggle).
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    try {
      localStorage.setItem(OUTLINE_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* noop */
    }
  }, [collapsed]);

  const [showFilter, setShowFilter] = useState(false);
  const [filter, setFilter] = useState('');
  const [fetchedContent, setFetchedContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Se content é null mas temos filePath, lê via fs como fallback.
  useEffect(() => {
    if (collapsed) return;
    if (!filePath) {
      setFetchedContent(null);
      return;
    }
    if (typeof content === 'string') {
      // Pai já forneceu — não precisa ler.
      setFetchedContent(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    window.undrcodAPI?.fs
      .readFile(filePath)
      .then((r) => {
        if (cancelled) return;
        if ('error' in r) setFetchedContent('');
        else setFetchedContent(r.content);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFetchedContent('');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, content, collapsed]);

  // Conteúdo efetivo
  const effectiveContent = typeof content === 'string' ? content : fetchedContent;

  // Reset filter quando troca arquivo
  useEffect(() => {
    setFilter('');
  }, [filePath]);

  const symbols: ParsedSymbol[] = useMemo(() => {
    if (!effectiveContent || !filePath) return [];
    return parseSymbols(effectiveContent, filePath);
  }, [effectiveContent, filePath]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return symbols;
    const tokens = q.split(/\s+/);
    return symbols.filter((s) => {
      const hay = s.name.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [symbols, filter]);

  function jumpTo(sym: ParsedSymbol) {
    if (!filePath) return;
    window.dispatchEvent(
      new CustomEvent('undrcod:goto-line', { detail: { path: filePath, line: sym.line } }),
    );
  }

  return (
    <div className={'outline-section' + (collapsed ? ' is-collapsed' : '')}>
      <div className="outline-section-header">
        <button
          type="button"
          className="outline-section-title-btn"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expandir outline' : 'Recolher outline'}
          aria-expanded={!collapsed}
        >
          <i
            className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'} outline-section-chevron`}
            aria-hidden
          />
          <span className="outline-section-title">OUTLINE</span>
          {!collapsed && symbols.length > 0 && (
            <span className="outline-section-count">{symbols.length}</span>
          )}
        </button>
        {!collapsed && filePath && symbols.length > 0 && (
          <button
            type="button"
            className={
              'outline-section-action' + (showFilter ? ' is-active' : '')
            }
            onClick={() => {
              setShowFilter((v) => {
                if (v) setFilter('');
                return !v;
              });
            }}
            title="Filtrar símbolos"
            aria-label="Filtrar símbolos"
          >
            <i className="codicon codicon-search" />
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          {showFilter && filePath && symbols.length > 0 && (
            <div className="outline-section-filter">
              <i className="codicon codicon-search outline-section-filter-icon" aria-hidden />
              <input
                type="search"
                className="outline-section-filter-input"
                placeholder="Filtrar símbolos..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className="outline-section-body">
            {!filePath ? (
              <div className="outline-section-empty">Sem arquivo ativo</div>
            ) : loading ? (
              <div className="outline-section-empty">Lendo arquivo...</div>
            ) : symbols.length === 0 ? (
              <div className="outline-section-empty">Sem símbolos detectados</div>
            ) : filtered.length === 0 ? (
              <div className="outline-section-empty">Nenhum símbolo bate com o filtro</div>
            ) : (
              <ul className="outline-section-list">
                {filtered.map((s) => (
                  <li key={`${s.name}-${s.line}-${s.kind}`}>
                    <button
                      type="button"
                      className="outline-section-item"
                      onClick={() => jumpTo(s)}
                      title={`${s.name} (linha ${s.line})`}
                    >
                      <i
                        className={`codicon ${iconForKind(s.kind)} outline-section-item-icon kind-${s.kind}`}
                        aria-hidden
                      />
                      <span className="outline-section-item-name">{s.name}</span>
                      <span className="outline-section-item-line">{s.line}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
