/**
 * HistoryPanel — modal centralizado pra revisar e retomar conversas
 * passadas do workspace ATUAL. Foco numa única lista filtrável.
 *
 * Difere do WorkspacesPanel: aquele lista TODOS os workspaces; este
 * mostra só as sessões do `cwd` em uso, num modal acessível por
 * comando/atalho (Ctrl+Shift+H).
 *
 * IPC: window.undrcodAPI?.claude.listProjectSessions(cwd).
 * Resume: parent (App.tsx) recebe o sessionId e chama handleResumeSession.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import './HistoryPanel.css';

interface SessionMeta {
  sessionId: string;
  title: string;
  firstTimestamp: string;
  lastTimestamp: string;
  messageCount: number;
  cwd: string;
}

interface HistoryPanelProps {
  open: boolean;
  cwd: string | null;
  onClose: () => void;
  /** Click numa session — parent decide o que fazer (geralmente resume). */
  onResume: (sessionId: string) => void;
}

function formatRelativeTime(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
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
  return date.toLocaleDateString('pt-BR');
}

function workspaceName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function HistoryPanel({ open, cwd, onClose, onResume }: HistoryPanelProps) {
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Carrega sessions ao abrir (re-fetch sempre que abrir pra refletir conversas novas)
  useEffect(() => {
    if (!open || !cwd) return;
    const fn = window.undrcodAPI?.claude?.listProjectSessions;
    if (typeof fn !== 'function') {
      setSessions([]);
      return;
    }
    setLoading(true);
    setFilter('');
    fn(cwd).then((list) => {
      setSessions(list || []);
      setLoading(false);
    }).catch(() => {
      setSessions([]);
      setLoading(false);
    });
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

  // Fuzzy básico: split em tokens, todos precisam estar no title (case-insensitive)
  const filtered = useMemo(() => {
    if (!sessions) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return sessions;
    const tokens = q.split(/\s+/);
    return sessions.filter((s) => {
      const hay = `${s.title} ${s.sessionId}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [sessions, filter]);

  if (!open) return null;

  const cwdLabel = cwd ? workspaceName(cwd) : '(sem workspace)';

  return (
    <div className="history-backdrop" onClick={onClose}>
      <div
        className="history-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Histórico de conversas"
      >
        <div className="history-header">
          <div className="history-header-title">
            <i className="codicon codicon-history history-header-icon" aria-hidden />
            <span className="history-title">Histórico de conversas</span>
            <span className="history-cwd" title={cwd ?? undefined}>{cwdLabel}</span>
          </div>
          <button
            type="button"
            className="history-close"
            onClick={onClose}
            title="Fechar (Esc)"
          >
            <i className="codicon codicon-close" />
          </button>
        </div>

        <div className="history-search">
          <i className="codicon codicon-search history-search-icon" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            className="history-search-input"
            placeholder="Filtrar por título..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <div className="history-body">
          {loading ? (
            <div className="history-empty">
              <i className="codicon codicon-sync~spin" />
              <span>Carregando histórico...</span>
            </div>
          ) : !sessions || sessions.length === 0 ? (
            <div className="history-empty">
              <i className="codicon codicon-comment-discussion history-empty-icon" />
              <div className="history-empty-title">Sem conversas neste workspace</div>
              <div className="history-empty-hint">
                Quando você conversar com o Claude aqui, as sessões aparecerão pra retomar depois.
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="history-empty">
              <i className="codicon codicon-search history-empty-icon" />
              <div className="history-empty-title">Nada encontrado</div>
              <div className="history-empty-hint">Tente outro termo no filtro.</div>
            </div>
          ) : (
            <ul className="history-list">
              {filtered.map((s) => (
                <li key={s.sessionId}>
                  <button
                    type="button"
                    className="history-item"
                    onClick={() => onResume(s.sessionId)}
                    title={`${s.title}\n\n${s.messageCount} msgs · ${s.sessionId}`}
                  >
                    <i className="codicon codicon-comment-discussion history-item-icon" aria-hidden />
                    <div className="history-item-body">
                      <div className="history-item-title">{s.title || 'Conversa sem título'}</div>
                      <div className="history-item-meta">
                        <span className="history-item-time">
                          <i className="codicon codicon-calendar" aria-hidden />
                          {formatRelativeTime(s.lastTimestamp)}
                        </span>
                        <span className="history-item-badge">
                          {s.messageCount} {s.messageCount === 1 ? 'msg' : 'msgs'}
                        </span>
                      </div>
                    </div>
                    <i className="codicon codicon-chevron-right history-item-chevron" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="history-footer">
          <span className="history-footer-hint">
            {sessions && sessions.length > 0 && (
              <>
                {filtered.length === sessions.length
                  ? `${sessions.length} ${sessions.length === 1 ? 'conversa' : 'conversas'}`
                  : `${filtered.length} de ${sessions.length}`}
              </>
            )}
          </span>
          <button type="button" className="history-btn" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
