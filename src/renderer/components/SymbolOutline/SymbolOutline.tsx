/**
 * SymbolOutline — modal centralizado tipo Ctrl+Shift+O do VS Code.
 *
 * Mostra funções/classes/types do arquivo central ativo. Parser regex-based
 * (utils/symbolParser.ts) — não AST. Click numa entrada dispara
 * CustomEvent('undrcod:goto-line', { detail: { path, line } }) e fecha.
 *
 * Conteúdo do arquivo:
 * - Se houver `dirtyContent` (edit unsaved no Monaco), usa esse.
 * - Senão, lê via window.undrcodAPI?.fs.readFile(path) ao abrir.
 *
 * Reusa o design system de HistoryPanel — mesmo backdrop, mesmo card.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  parseSymbols,
  iconForKind,
  detectLang,
  type ParsedSymbol,
} from '../../utils/symbolParser';
import './SymbolOutline.css';

interface SymbolOutlineProps {
  open: boolean;
  filePath: string | null;
  /** Conteúdo dirty do arquivo (se editado no Monaco). Senão lê via fs. */
  dirtyContent?: string;
  onClose: () => void;
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function SymbolOutline({ open, filePath, dirtyContent, onClose }: SymbolOutlineProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Carrega conteúdo ao abrir. Prioridade: dirty > fs.readFile.
  useEffect(() => {
    if (!open || !filePath) {
      setContent(null);
      return;
    }
    setFilter('');
    setActiveIdx(0);
    if (typeof dirtyContent === 'string') {
      setContent(dirtyContent);
      return;
    }
    setLoading(true);
    window.undrcodAPI?.fs.readFile(filePath).then((r) => {
      if ('error' in r) setContent('');
      else setContent(r.content);
      setLoading(false);
    }).catch(() => {
      setContent('');
      setLoading(false);
    });
  }, [open, filePath, dirtyContent]);

  // Foco no search ao abrir
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // Parser memoizado (não re-roda em cada filter change)
  const symbols: ParsedSymbol[] = useMemo(() => {
    if (!content || !filePath) return [];
    return parseSymbols(content, filePath);
  }, [content, filePath]);

  // Filtro fuzzy básico (tokens, case-insensitive, todos precisam estar no name)
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return symbols;
    const tokens = q.split(/\s+/);
    return symbols.filter((s) => {
      const hay = s.name.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [symbols, filter]);

  // Reset activeIdx quando lista muda
  useEffect(() => {
    setActiveIdx(0);
  }, [filter, symbols.length]);

  function jumpTo(sym: ParsedSymbol) {
    if (!filePath) return;
    window.dispatchEvent(
      new CustomEvent('undrcod:goto-line', { detail: { path: filePath, line: sym.line } }),
    );
    onClose();
  }

  // Teclado: Esc fecha, Up/Down navega, Enter confirma
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const sym = filtered[activeIdx];
        if (sym) jumpTo(sym);
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // jumpTo depende de filePath/onClose, mas escopo é seguro porque ambos vêm como props
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filtered, activeIdx, onClose, filePath]);

  // Scroll do item ativo into view
  useEffect(() => {
    if (!listRef.current) return;
    const node = listRef.current.querySelector(`[data-idx="${activeIdx}"]`) as HTMLElement | null;
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return null;

  const fileLabel = filePath ? basename(filePath) : '(sem arquivo)';
  const langLabel = filePath ? detectLang(filePath) : '';

  return (
    <div className="symboloutline-backdrop" onClick={onClose}>
      <div
        className="symboloutline-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Outline de símbolos"
      >
        <div className="symboloutline-header">
          <div className="symboloutline-header-title">
            <i className="codicon codicon-symbol-class symboloutline-header-icon" aria-hidden />
            <span className="symboloutline-title">Símbolos</span>
            <span className="symboloutline-file" title={filePath ?? undefined}>{fileLabel}</span>
            {langLabel && langLabel !== 'plain' && (
              <span className="symboloutline-lang">{langLabel}</span>
            )}
          </div>
          <button
            type="button"
            className="symboloutline-close"
            onClick={onClose}
            title="Fechar (Esc)"
          >
            <i className="codicon codicon-close" />
          </button>
        </div>

        <div className="symboloutline-search">
          <i className="codicon codicon-search symboloutline-search-icon" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            className="symboloutline-search-input"
            placeholder="Filtrar símbolos..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <div className="symboloutline-body">
          {!filePath ? (
            <div className="symboloutline-empty">
              <i className="codicon codicon-file symboloutline-empty-icon" />
              <div className="symboloutline-empty-title">Nenhum arquivo ativo</div>
              <div className="symboloutline-empty-hint">
                Abra um arquivo na tab central pra ver seus símbolos.
              </div>
            </div>
          ) : loading ? (
            <div className="symboloutline-empty">
              <i className="codicon codicon-sync~spin" />
              <span>Lendo arquivo...</span>
            </div>
          ) : symbols.length === 0 ? (
            <div className="symboloutline-empty">
              <i className="codicon codicon-symbol-misc symboloutline-empty-icon" />
              <div className="symboloutline-empty-title">Nenhum símbolo encontrado</div>
              <div className="symboloutline-empty-hint">
                Linguagem não suportada ou arquivo sem funções/classes top-level.
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="symboloutline-empty">
              <i className="codicon codicon-search symboloutline-empty-icon" />
              <div className="symboloutline-empty-title">Nada encontrado</div>
              <div className="symboloutline-empty-hint">Tente outro termo no filtro.</div>
            </div>
          ) : (
            <ul className="symboloutline-list" ref={listRef}>
              {filtered.map((s, idx) => (
                <li key={`${s.name}-${s.line}`}>
                  <button
                    type="button"
                    data-idx={idx}
                    className={
                      'symboloutline-item' + (idx === activeIdx ? ' symboloutline-item-active' : '')
                    }
                    onClick={() => jumpTo(s)}
                    onMouseEnter={() => setActiveIdx(idx)}
                    title={`${s.name} (linha ${s.line})`}
                  >
                    <i
                      className={`codicon ${iconForKind(s.kind)} symboloutline-item-icon`}
                      aria-hidden
                    />
                    <span className="symboloutline-item-name">{s.name}</span>
                    <span className={`symboloutline-item-kind kind-${s.kind}`}>{s.kind}</span>
                    <span className="symboloutline-item-line">L{s.line}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="symboloutline-footer">
          <span className="symboloutline-footer-hint">
            {symbols.length > 0 && (
              <>
                {filtered.length === symbols.length
                  ? `${symbols.length} ${symbols.length === 1 ? 'símbolo' : 'símbolos'}`
                  : `${filtered.length} de ${symbols.length}`}
              </>
            )}
          </span>
          <span className="symboloutline-footer-keys">
            <kbd>↑↓</kbd> nav <kbd>Enter</kbd> ir <kbd>Esc</kbd> fechar
          </span>
        </div>
      </div>
    </div>
  );
}
