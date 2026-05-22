/**
 * TimelineSection — section colapsável inline na sidebar (estilo VS Code/Cursor).
 *
 * Mostra commits que tocaram o arquivo central ativo (via `git log --follow`).
 * Click num commit dispara CustomEvent('undrcod:show-commit-diff', { detail: { hash, filePath } })
 * — App.tsx pode wirar futuramente pra abrir o diff daquele commit.
 *
 * - Refetch automático quando filePath ou cwd muda.
 * - Empty state quando não há histórico (file untracked ou cwd não-git).
 * - Estado collapsed persiste em localStorage ('undrcod:timeline-collapsed').
 */

import { useEffect, useRef, useState } from 'react';
import './TimelineSection.css';

interface Commit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  timestamp: number;
}

interface TimelineSectionProps {
  cwd: string | null;
  filePath: string | null;
}

// Bumped pra v2 quando mudamos default de expanded → collapsed. v1 estava
// sendo gravado automaticamente no mount sem o user ter tocado, então users
// existentes ficavam com expanded persistido eternamente.
const STORAGE_KEY = 'undrcod:timeline-collapsed.v2';

/**
 * "há 2h", "há 3d", "há 1mes" — formato compacto pra row densa.
 * Não usa Intl.RelativeTimeFormat pq queremos abreviar mais agressivo que o default.
 */
function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return 'agora';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mes`;
  const yr = Math.floor(day / 365);
  return `${yr}a`;
}

export function TimelineSection({ cwd, filePath }: TimelineSectionProps) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    // Default colapsado — sidebar fica menos ruidosa quando workspace não é git
    // ou ainda não tem commits. User expande quando precisa.
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === null ? true : v === '1';
    } catch {
      return true;
    }
  });

  // Skip o primeiro run — useEffect rodava no mount e gravava o default no
  // localStorage MESMO sem user ter tocado. Resultado: mudar o default depois
  // não afetava users existentes (já tinham valor "antigo" gravado). Agora só
  // grava em mudanças reais (user toggle).
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* noop */
    }
  }, [collapsed]);

  useEffect(() => {
    let cancelled = false;
    if (!cwd || !filePath) {
      setCommits([]);
      return;
    }
    setLoading(true);
    window.undrcodAPI?.git
      .fileHistory(cwd, filePath)
      .then((r) => {
        if (cancelled) return;
        setCommits(r.commits || []);
      })
      .catch(() => {
        if (!cancelled) setCommits([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, filePath]);

  const handleCommitClick = (hash: string) => {
    if (!filePath) return;
    window.dispatchEvent(
      new CustomEvent('undrcod:show-commit-diff', { detail: { hash, filePath } }),
    );
  };

  // Sempre renderiza — quando sem filePath, mostra empty state (descoberta).
  // Idem OUTLINE: section persistente abaixo do FileTree, igual VS Code/Cursor.

  return (
    <div className="timeline-section">
      <button
        className="timeline-header"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        type="button"
        title="Toggle timeline"
      >
        <i
          className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'} timeline-chevron`}
        />
        <span className="timeline-title">TIMELINE</span>
        {!loading && commits.length > 0 && (
          <span className="timeline-count">{commits.length}</span>
        )}
      </button>
      {!collapsed && (
        <div className="timeline-body">
          {!filePath ? (
            <div className="timeline-empty">Sem arquivo ativo</div>
          ) : loading ? (
            <div className="timeline-empty">Carregando...</div>
          ) : commits.length === 0 ? (
            <div className="timeline-empty">Sem histórico git</div>
          ) : (
            <ul className="timeline-list">
              {commits.map((c) => (
                <li
                  key={c.hash}
                  className="timeline-row"
                  onClick={() => handleCommitClick(c.hash)}
                  title={`${c.subject}\n${c.author} · ${new Date(c.timestamp).toLocaleString()}`}
                >
                  <i className="codicon codicon-git-commit timeline-row-icon" />
                  <span className="timeline-row-subject">{c.subject || '(sem mensagem)'}</span>
                  <span className="timeline-row-meta">
                    <span className="timeline-row-author">{c.author}</span>
                    <span className="timeline-row-time">{formatRelative(c.timestamp)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
