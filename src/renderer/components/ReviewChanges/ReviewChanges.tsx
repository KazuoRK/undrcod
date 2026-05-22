/**
 * ReviewChanges — modal CONSOLIDADO pra revisar TODOS os edits do turn atual
 * do Agent lado-a-lado antes de aceitar/rejeitar.
 *
 * Difere da PendingChangesTab (BottomPanel): aquela é uma tab no painel inferior;
 * este é um modal centralizado (estilo HistoryPanel) ancorado pelo atalho
 * Ctrl+Shift+Enter — espelhando `antigravity.openReviewChanges` do Antigravity.
 *
 * Os dois compartilham o mesmo estado fonte (event `undrcod:pending-changes`
 * + broadcast `undrcod:pending-changes-total`), então acceptAll daqui esvazia
 * a tab também, e vice-versa.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────┐
 *   │ [icon] Review Changes  •  3 arquivos modificados     │ ← header
 *   │                            [Reject All] [Accept All] │
 *   ├──────────────────────────────────────────────────────┤
 *   │ [filter input]                                       │
 *   ├──────────────────────────────────────────────────────┤
 *   │ ▸ [file] path/a.ts        +12 -3   [Reject][Accept]  │
 *   │ ▾ [file] path/b.ts        +5  -8   [Reject][Accept]  │
 *   │     <inline diff via EditToolDiff>                   │
 *   │ ▸ [file] path/c.css       +1  -0   [Reject][Accept]  │
 *   └──────────────────────────────────────────────────────┘
 *
 * Esc fecha. Click no row expande/colapsa.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { EditToolDiff } from '../ToolCard/EditToolDiff';
import './ReviewChanges.css';

export interface ReviewEdit {
  path: string;
  oldContent: string;
  newContent: string;
}

interface ReviewChangesProps {
  open: boolean;
  edits: ReviewEdit[];
  onClose: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onAccept: (path: string) => void;
  onReject: (path: string) => void;
}

interface DiffStats {
  added: number;
  removed: number;
}

/**
 * Stat barato — mesma estratégia da PendingChangesTab (line frequency diff,
 * sem rodar Myers). Suficiente pro header "+X -Y".
 */
function computeDiffStats(oldContent: string, newContent: string): DiffStats {
  const oldLines = oldContent === '' ? [] : oldContent.split(/\r?\n/);
  const newLines = newContent === '' ? [] : newContent.split(/\r?\n/);
  const oldSet = new Map<string, number>();
  for (const l of oldLines) oldSet.set(l, (oldSet.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of newLines) {
    const c = oldSet.get(l) ?? 0;
    if (c > 0) oldSet.set(l, c - 1);
    else added += 1;
  }
  const newSet = new Map<string, number>();
  for (const l of newLines) newSet.set(l, (newSet.get(l) ?? 0) + 1);
  let removed = 0;
  for (const l of oldLines) {
    const c = newSet.get(l) ?? 0;
    if (c > 0) newSet.set(l, c - 1);
    else removed += 1;
  }
  return { added, removed };
}

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx === -1 ? p : p.slice(idx + 1);
}

function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx === -1 ? '' : p.slice(0, idx);
}

export function ReviewChanges({
  open,
  edits,
  onClose,
  onAcceptAll,
  onRejectAll,
  onAccept,
  onReject,
}: ReviewChangesProps) {
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset filter ao abrir; focus search input
  useEffect(() => {
    if (!open) return;
    setFilter('');
    const t = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // Esc fecha — sem stopPropagation pra não brigar com global listeners.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Filter por path (case-insensitive, split por whitespace — todos tokens precisam casar)
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return edits;
    const tokens = q.split(/\s+/);
    return edits.filter((e) => {
      const hay = e.path.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [edits, filter]);

  const totals = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const e of edits) {
      const s = computeDiffStats(e.oldContent, e.newContent);
      added += s.added;
      removed += s.removed;
    }
    return { added, removed };
  }, [edits]);

  const toggle = (path: string) =>
    setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));

  if (!open) return null;

  return (
    <div className="review-backdrop" onClick={onClose}>
      <div
        className="review-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Review Changes"
      >
        <div className="review-header">
          <div className="review-header-title">
            <i className="codicon codicon-git-pull-request review-header-icon" aria-hidden />
            <span className="review-title">Review Changes</span>
            {edits.length > 0 && (
              <span className="review-count">
                {edits.length} {edits.length === 1 ? 'arquivo modificado' : 'arquivos modificados'}
              </span>
            )}
            {edits.length > 0 && (
              <span className="review-totals">
                <span className="review-stat-add">+{totals.added}</span>
                <span className="review-stat-rem">−{totals.removed}</span>
              </span>
            )}
          </div>
          <div className="review-header-actions">
            {edits.length > 0 && (
              <>
                <button
                  type="button"
                  className="review-pill-btn"
                  title="Rejeita todas — descarta sem gravar"
                  onClick={onRejectAll}
                >
                  Reject All
                </button>
                <button
                  type="button"
                  className="review-pill-btn review-pill-btn-accent"
                  title="Aplica todas as alterações no disco (Ctrl+Shift+Enter)"
                  onClick={onAcceptAll}
                >
                  Accept All
                </button>
              </>
            )}
            <button
              type="button"
              className="review-close"
              onClick={onClose}
              title="Fechar (Esc)"
            >
              <i className="codicon codicon-close" />
            </button>
          </div>
        </div>

        {edits.length > 0 && (
          <div className="review-search">
            <i className="codicon codicon-search review-search-icon" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              className="review-search-input"
              placeholder="Filtrar por path..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        )}

        <div className="review-body">
          {edits.length === 0 ? (
            <div className="review-empty">
              <i className="codicon codicon-check-all review-empty-icon" />
              <div className="review-empty-title">Nada pra revisar</div>
              <div className="review-empty-hint">
                Quando o Agent propor edits via Edit/Write, eles aparecem aqui pra você
                revisar todos juntos antes de aplicar.
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="review-empty">
              <i className="codicon codicon-search review-empty-icon" />
              <div className="review-empty-title">Nada encontrado</div>
              <div className="review-empty-hint">Tente outro termo no filtro.</div>
            </div>
          ) : (
            <ul className="review-list">
              {filtered.map((edit) => {
                const stats = computeDiffStats(edit.oldContent, edit.newContent);
                const isOpen = expanded[edit.path] === true;
                return (
                  <li key={edit.path} className="review-item">
                    <div className="review-item-row">
                      <button
                        type="button"
                        className="review-item-toggle"
                        onClick={() => toggle(edit.path)}
                        title={isOpen ? 'Recolher diff' : 'Expandir diff'}
                      >
                        <i className={`codicon codicon-chevron-${isOpen ? 'down' : 'right'}`} />
                        <i className="codicon codicon-symbol-file review-item-icon" />
                        <span className="review-item-name">{basename(edit.path)}</span>
                        <span className="review-item-dim" title={edit.path}>
                          {dirname(edit.path)}
                        </span>
                        <span className="review-item-stats">
                          <span className="review-stat-add">+{stats.added}</span>
                          <span className="review-stat-rem">−{stats.removed}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="review-pill-btn"
                        onClick={() => onReject(edit.path)}
                        title="Rejeita só este arquivo"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="review-pill-btn review-pill-btn-accent"
                        onClick={() => onAccept(edit.path)}
                        title="Aplica só este arquivo no disco"
                      >
                        Accept
                      </button>
                    </div>
                    {isOpen && (
                      <div className="review-item-diff">
                        <EditToolDiff
                          filePath={edit.path}
                          oldStr={edit.oldContent}
                          newStr={edit.newContent}
                          variant={edit.oldContent === '' ? 'write' : 'edit'}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="review-footer">
          <span className="review-footer-hint">
            {edits.length > 0 && filtered.length !== edits.length
              ? `${filtered.length} de ${edits.length}`
              : edits.length > 0
                ? `${edits.length} ${edits.length === 1 ? 'edit' : 'edits'} pendente${edits.length === 1 ? '' : 's'}`
                : ''}
          </span>
          <button type="button" className="review-btn" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
