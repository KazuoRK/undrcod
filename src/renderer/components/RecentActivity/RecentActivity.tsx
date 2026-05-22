/**
 * RecentActivity — modal centralizado pra revisar arquivos abertos
 * recentemente no workspace atual. Espelha o pattern do HistoryPanel.
 *
 * Atalho global: Ctrl+E.
 * Fonte: `getRecentEntriesForWorkspace(cwd)` em utils/recentFiles.ts
 * (localStorage `undr.recentFiles`).
 *
 * Click num item chama `onOpenFile(path)` — parent (App.tsx) usa o
 * `openFileTab` existente que já dá pushRecent + ativa a tab central.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { getRecentEntriesForWorkspace } from '../../utils/recentFiles';
import './RecentActivity.css';

interface RecentActivityProps {
  open: boolean;
  cwd: string | null;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}

interface RecentItem {
  path: string;
  lastUsed: number;
}

function formatRelativeTime(ts: number): string {
  if (!ts) return '';
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return diffHour === 1 ? 'há 1 hora' : `há ${diffHour} horas`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return 'ontem';
  if (diffDay < 7) return `há ${diffDay} dias`;
  if (diffDay < 30) {
    const w = Math.floor(diffDay / 7);
    return w === 1 ? 'há 1 semana' : `há ${w} semanas`;
  }
  return new Date(ts).toLocaleDateString('pt-BR');
}

function splitPath(full: string, cwd: string | null): { filename: string; dir: string } {
  const norm = full.replace(/\\/g, '/');
  const parts = norm.split('/').filter(Boolean);
  const filename = parts[parts.length - 1] || full;
  let dir = parts.slice(0, -1).join('/');
  if (cwd) {
    const cwdNorm = cwd.replace(/\\/g, '/').replace(/\/$/, '');
    if (dir.startsWith(cwdNorm)) {
      dir = dir.slice(cwdNorm.length).replace(/^\//, '');
    }
  }
  return { filename, dir };
}

function workspaceName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function RecentActivity({ open, cwd, onClose, onOpenFile }: RecentActivityProps) {
  const [items, setItems] = useState<RecentItem[]>([]);
  const [filter, setFilter] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Reload entries cada vez que abrir — assim reflete arquivos abertos
  // entre uma abertura e outra do modal.
  useEffect(() => {
    if (!open) return;
    setFilter('');
    setItems(getRecentEntriesForWorkspace(cwd));
  }, [open, cwd]);

  // Foco no search ao abrir
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // Esc fecha
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

  // Fuzzy básico: tokens precisam estar em filename OU dir.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    const tokens = q.split(/\s+/);
    return items.filter((it) => {
      const hay = it.path.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [items, filter]);

  if (!open) return null;

  const cwdLabel = cwd ? workspaceName(cwd) : '(sem workspace)';

  return (
    <div className="recent-backdrop" onClick={onClose}>
      <div
        className="recent-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Atividade recente"
      >
        <div className="recent-header">
          <div className="recent-header-title">
            <i className="codicon codicon-clock recent-header-icon" aria-hidden />
            <span className="recent-title">Atividade recente</span>
            <span className="recent-cwd" title={cwd ?? undefined}>{cwdLabel}</span>
          </div>
          <button
            type="button"
            className="recent-close"
            onClick={onClose}
            title="Fechar (Esc)"
          >
            <i className="codicon codicon-close" />
          </button>
        </div>

        <div className="recent-search">
          <i className="codicon codicon-search recent-search-icon" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            className="recent-search-input"
            placeholder="Filtrar por nome ou caminho..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <div className="recent-body">
          {items.length === 0 ? (
            <div className="recent-empty">
              <i className="codicon codicon-history recent-empty-icon" />
              <div className="recent-empty-title">Nenhum arquivo recente</div>
              <div className="recent-empty-hint">
                Abra arquivos no workspace pra eles aparecerem aqui pra acesso rápido.
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="recent-empty">
              <i className="codicon codicon-search recent-empty-icon" />
              <div className="recent-empty-title">Nada encontrado</div>
              <div className="recent-empty-hint">Tente outro termo no filtro.</div>
            </div>
          ) : (
            <ul className="recent-list">
              {filtered.map((it) => {
                const { filename, dir } = splitPath(it.path, cwd);
                return (
                  <li key={it.path}>
                    <button
                      type="button"
                      className="recent-item"
                      onClick={() => {
                        onOpenFile(it.path);
                        onClose();
                      }}
                      title={it.path}
                    >
                      <i className="codicon codicon-file recent-item-icon" aria-hidden />
                      <div className="recent-item-body">
                        <div className="recent-item-title">{filename}</div>
                        <div className="recent-item-meta">
                          {dir && <span className="recent-item-dir">{dir}</span>}
                          <span className="recent-item-time">
                            <i className="codicon codicon-clock" aria-hidden />
                            {formatRelativeTime(it.lastUsed)}
                          </span>
                        </div>
                      </div>
                      <i className="codicon codicon-chevron-right recent-item-chevron" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="recent-footer">
          <span className="recent-footer-hint">
            {items.length > 0 && (
              filtered.length === items.length
                ? `${items.length} ${items.length === 1 ? 'arquivo' : 'arquivos'}`
                : `${filtered.length} de ${items.length}`
            )}
          </span>
          <button type="button" className="recent-btn" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
