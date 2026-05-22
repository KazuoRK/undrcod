/**
 * ShortcutsDialog — modal centralizado listando todos os atalhos do UNDRCOD.
 *
 * Layout:
 *   overlay (backdrop fixed)
 *     └─ modal (~720px wide, max 80vh)
 *         ├─ header (título + search + close)
 *         ├─ body scrollable
 *         │   └─ N sections (cada uma com title + lista de items)
 *         └─ footer (total + dica de fechar)
 *
 * Atalhos visuais:
 *   - Cada token de tecla vai num <kbd class="kbd"> separado, dentro de .kbd-row.
 *     Padrão UNDRCOD: NUNCA strings tipo "Ctrl+K".
 *
 * Filtro:
 *   - Case-insensitive
 *   - Match em description, context OU em qualquer key (ex: "ctrl" filtra todos os ctrl)
 *   - Mostra só seções que têm pelo menos 1 match
 *
 * Esc fecha (parent handler escuta via prop onClose).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { SHORTCUTS, TOTAL_SHORTCUTS, type ShortcutGroup } from './shortcutsData';
import './ShortcutsDialog.css';

export interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset query ao abrir/fechar pra próxima abertura começar limpa.
  useEffect(() => {
    if (open) {
      setQuery('');
      // Foca input pro user já começar a digitar
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Esc fecha
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  // Filtragem — case insensitive em description, context ou keys.
  const filtered = useMemo<ShortcutGroup[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SHORTCUTS;
    return SHORTCUTS
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          const desc = item.description.toLowerCase();
          const ctx = (item.context || '').toLowerCase();
          const keys = item.keys.join(' ').toLowerCase();
          return desc.includes(q) || ctx.includes(q) || keys.includes(q);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [query]);

  const filteredCount = useMemo(
    () => filtered.reduce((sum, g) => sum + g.items.length, 0),
    [filtered]
  );

  if (!open) return null;

  return (
    <div
      className="shortcuts-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Atalhos de teclado"
      >
        <div className="shortcuts-header">
          <h2 className="shortcuts-title">
            <i className="codicon codicon-keyboard" aria-hidden="true" />
            Atalhos de Teclado
          </h2>
          <div className="shortcuts-search">
            <i className="codicon codicon-search shortcuts-search-icon" aria-hidden="true" />
            <input
              ref={inputRef}
              className="shortcuts-search-input"
              type="text"
              placeholder="Filtrar atalhos..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filtrar atalhos"
            />
            {query && (
              <button
                type="button"
                className="shortcuts-search-clear"
                onClick={() => setQuery('')}
                title="Limpar filtro"
                aria-label="Limpar filtro"
              >
                <i className="codicon codicon-close" aria-hidden="true" />
              </button>
            )}
          </div>
          <button
            type="button"
            className="shortcuts-close"
            onClick={onClose}
            title="Fechar (Esc)"
            aria-label="Fechar"
          >
            <i className="codicon codicon-close" aria-hidden="true" />
          </button>
        </div>

        <div className="shortcuts-body">
          {filtered.length === 0 ? (
            <div className="shortcuts-empty">
              <i className="codicon codicon-search shortcuts-empty-icon" aria-hidden="true" />
              <p className="shortcuts-empty-title">Nenhum atalho encontrado</p>
              <p className="shortcuts-empty-hint">Tente outro termo ou limpe o filtro.</p>
            </div>
          ) : (
            filtered.map((group) => (
              <section key={group.id} className="shortcuts-section">
                <h3 className="shortcuts-section-title">{group.title}</h3>
                <ul className="shortcuts-list" role="list">
                  {group.items.map((item, idx) => (
                    <li key={`${group.id}-${idx}`} className="shortcuts-row">
                      <div className="shortcuts-row-text">
                        <span className="shortcuts-row-desc">{item.description}</span>
                        {item.context && (
                          <span className="shortcuts-row-context">{item.context}</span>
                        )}
                      </div>
                      <span className="kbd-row shortcuts-row-keys">
                        {item.keys.map((key, kIdx) => (
                          <kbd key={kIdx} className="kbd">{key}</kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        <div className="shortcuts-footer">
          <span className="shortcuts-footer-count">
            {query
              ? `${filteredCount} de ${TOTAL_SHORTCUTS} atalhos`
              : `${TOTAL_SHORTCUTS} atalhos`}
          </span>
          <span className="shortcuts-footer-hint">
            <kbd className="kbd">Esc</kbd>
            <span>fechar</span>
          </span>
        </div>
      </div>
    </div>
  );
}
