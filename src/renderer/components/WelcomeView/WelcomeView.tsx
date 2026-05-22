/**
 * WelcomeView — splash editorial com brand UnderCode.
 *
 * Renderizado em pane-mid-empty (quando nenhuma aba está aberta).
 *
 * Conteúdo:
 *   - Hero: logo [U] grande + título + tagline rotativa com cursor piscando
 *   - 3 cards de ação: Abrir pasta · Workspaces recentes (foco aqui) · Clonar repo (em breve)
 *   - Lista compacta de workspaces conhecidos (via claude:listKnownWorkspaces)
 *   - Footer: versão + Docs + Reportar problema
 *
 * Defensive: se `claude.listKnownWorkspaces` ausente, mostra empty state sem
 * quebrar o resto.
 */

import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, GitBranch, History, Pin } from 'lucide-react';
import { toast } from '../Toast/Toast';
import './WelcomeView.css';

const PINNED_STORAGE_KEY = 'undrcode.pinnedWorkspaces';

function loadPinnedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    const arr = JSON.parse(raw || '[]');
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set(); }
}
function savePinnedSet(set: Set<string>) {
  try {
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify([...set]));
  } catch { /* quota / disabled — silencioso */ }
}

const ICON_PROPS = { size: 14, strokeWidth: 2 } as const;

interface KnownWorkspace {
  path: string;
  sessionCount: number;
  lastUsed: string;
}

interface SessionMeta {
  sessionId: string;
  title: string;
  firstTimestamp: string;
  lastTimestamp: string;
  messageCount: number;
  cwd: string;
}

interface ResumeCandidate {
  workspacePath: string;
  sessionId: string;
  sessionTitle: string;
  lastTimestamp: string;
}

interface WelcomeViewProps {
  /** cwd atual — quando setado, ajusta copy das ações ("Trocar pasta" em vez de "Abrir pasta"). */
  cwd: string | null;
  /** Abre dialog de folder picker. */
  onOpenWorkspace: () => void;
  /** Abre um workspace recente pelo path. */
  onOpenRecent: (path: string) => void;
  /** Abre preview de dev server (opcional — mostra hint discreto se setado). */
  onOpenPreview?: () => void;
  /** Retoma a sessão mais recente do workspace mais recente, se houver. */
  onResumeLast?: (cwd: string, sessionId: string) => void;
}

/**
 * Formata diff de tempo em pt-BR relativo:
 *   < 1min: "agora"
 *   < 1h:   "há Xmin"
 *   < 24h:  "há Xh"
 *   < 7d:   "há Xd"
 *   default: "dd/mm/yyyy"
 */
function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return 'agora';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `há ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days}d`;
  return date.toLocaleDateString('pt-BR');
}

/** Extrai o nome legível do workspace do path (último segmento). */
function workspaceName(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments[segments.length - 1] || path;
}

/** Path encurtado pra exibição (substitui home por ~). */
function shortenWorkspacePath(path: string): string {
  // Heurística simples — funciona em Windows e Unix
  const homeLike = path.match(/^([A-Z]:[\\/]Users[\\/][^\\/]+|\/Users\/[^/]+|\/home\/[^/]+)/i);
  if (homeLike) {
    return '~' + path.slice(homeLike[0].length).replace(/\\/g, '/');
  }
  return path.replace(/\\/g, '/');
}

// ============================================================================
// Componente
// ============================================================================

export function WelcomeView({ cwd, onOpenWorkspace, onOpenRecent, onOpenPreview, onResumeLast }: WelcomeViewProps) {
  const [workspaces, setWorkspaces] = useState<KnownWorkspace[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [resumeCandidate, setResumeCandidate] = useState<ResumeCandidate | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(() => loadPinnedSet());

  const togglePin = (path: string) => {
    setPinned(prev => {
      const next = new Set(prev);
      let pinnedNow: boolean;
      if (next.has(path)) {
        next.delete(path);
        pinnedNow = false;
      } else {
        next.add(path);
        pinnedNow = true;
      }
      savePinnedSet(next);
      const name = workspaceName(path);
      if (pinnedNow) {
        toast.success(`${name} fixado no topo`);
      } else {
        toast.info(`${name} desafixado`);
      }
      return next;
    });
  };

  // ----- Carrega workspaces conhecidos -----
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = window.undrcodAPI?.claude?.listKnownWorkspaces;
    if (typeof fn !== 'function') {
      setWorkspaces([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    fn().then((list: KnownWorkspace[]) => {
      if (cancelled) return;
      setWorkspaces(Array.isArray(list) ? list : []);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setWorkspaces([]);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const sortedWorkspaces = useMemo(() => {
    if (!workspaces) return [];
    // Pinned primeiro (na ordem de adição ao Set), depois os não-pinned por lastUsed desc.
    const pinOrder = [...pinned];
    const pinIndex = new Map<string, number>();
    pinOrder.forEach((p, i) => pinIndex.set(p, i));

    const pinnedList = workspaces
      .filter(ws => pinned.has(ws.path))
      .sort((a, b) => (pinIndex.get(a.path) ?? 0) - (pinIndex.get(b.path) ?? 0));

    const restList = workspaces
      .filter(ws => !pinned.has(ws.path))
      .sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime());

    return [...pinnedList, ...restList].slice(0, 8);
  }, [workspaces, pinned]);

  // ----- Carrega sessão mais recente do workspace mais recente -----
  // Trigger: workspaces carregados E há prop onResumeLast (sem ela não faz sentido buscar).
  // Filtra: só mostra se a sessão for de < 7 dias (não atrapalhar reinstalls / pausas longas).
  useEffect(() => {
    if (!onResumeLast) return;
    if (!sortedWorkspaces.length) return;
    const mostRecent = sortedWorkspaces[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = window.undrcodAPI?.claude?.listProjectSessions;
    if (typeof fn !== 'function') return;
    let cancelled = false;
    fn(mostRecent.path).then((list: SessionMeta[]) => {
      if (cancelled) return;
      if (!Array.isArray(list) || list.length === 0) return;
      // Pega a sessão com lastTimestamp mais recente
      const top = [...list].sort(
        (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime(),
      )[0];
      if (!top?.lastTimestamp) return;
      const ageMs = Date.now() - new Date(top.lastTimestamp).getTime();
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      if (!Number.isFinite(ageMs) || ageMs > SEVEN_DAYS) return;
      setResumeCandidate({
        workspacePath: mostRecent.path,
        sessionId: top.sessionId,
        sessionTitle: top.title || 'conversa anterior',
        lastTimestamp: top.lastTimestamp,
      });
    }).catch(() => { /* silencioso — se falhar, banner não aparece */ });
    return () => { cancelled = true; };
  }, [sortedWorkspaces, onResumeLast]);

  // ----- Render -----

  const [showAll, setShowAll] = useState(false);
  const visibleWorkspaces = showAll ? sortedWorkspaces : sortedWorkspaces.slice(0, 3);
  const hasMore = sortedWorkspaces.length > 3;

  // Quando workspace JÁ tá aberto (cwd setado), renderiza versão MINIMAL:
  // só logo + lista de atalhos. Substitui o clutter de "Trocar pasta + Workspaces
  // list" que faz sentido apenas no estado inicial sem cwd. Match com o pattern
  // do Zed/Cursor: workspace aberto = tela limpa pra entrar no fluxo de trabalho.
  if (cwd) {
    return (
      <div className="welcome-view welcome-view-minimal" role="main" aria-label="Workspace aberto">
        <div className="welcome-minimal-stack">
          {/* Brand wordmark — mesmo elemento do modo padrão, mas escala maior */}
          <div className="welcome-minimal-logo" aria-hidden="true">
            <span className="wordmark welcome-minimal-wordmark">
              <span className="wordmark-u">_</span>UNDRCOD
            </span>
          </div>
          <div className="welcome-shortcuts" role="list" aria-label="Atalhos">
            <div className="welcome-shortcut-row" role="listitem">
              <span className="welcome-shortcut-label">Buscar arquivos</span>
              <span className="welcome-shortcut-keys">
                <kbd className="kbd">Ctrl</kbd>
                <kbd className="kbd">P</kbd>
              </span>
            </div>
            <div className="welcome-shortcut-row" role="listitem">
              <span className="welcome-shortcut-label">Comando da paleta</span>
              <span className="welcome-shortcut-keys">
                <kbd className="kbd">Ctrl</kbd>
                <kbd className="kbd">Shift</kbd>
                <kbd className="kbd">P</kbd>
              </span>
            </div>
            <div className="welcome-shortcut-row" role="listitem">
              <span className="welcome-shortcut-label">Terminal</span>
              <span className="welcome-shortcut-keys">
                <kbd className="kbd">Ctrl</kbd>
                <kbd className="kbd">`</kbd>
              </span>
            </div>
            <div className="welcome-shortcut-row" role="listitem">
              <span className="welcome-shortcut-label">Conversa com Claude</span>
              <span className="welcome-shortcut-keys">
                <kbd className="kbd">Ctrl</kbd>
                <kbd className="kbd">Alt</kbd>
                <kbd className="kbd">B</kbd>
              </span>
            </div>
            <div className="welcome-shortcut-row" role="listitem">
              <span className="welcome-shortcut-label">Trocar pasta</span>
              <span className="welcome-shortcut-keys">
                <kbd className="kbd">Ctrl</kbd>
                <kbd className="kbd">O</kbd>
              </span>
            </div>
            <div className="welcome-shortcut-row" role="listitem">
              <span className="welcome-shortcut-label">Todos atalhos</span>
              <span className="welcome-shortcut-keys">
                <kbd className="kbd">Ctrl</kbd>
                <kbd className="kbd">/</kbd>
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----- Render padrão (sem workspace aberto) -----

  return (
    <div className="welcome-view" role="main" aria-label="Tela inicial">

      {/* Hero — wordmark centralizado, sem decoração */}
      <div className="welcome-hero">
        <h1 className="welcome-title">
          <span className="wordmark"><span className="wordmark-u">_</span>UNDRCOD</span>
        </h1>
      </div>

      {/* Resume banner — só quando há sessão recente (<7d) no workspace mais recente */}
      {resumeCandidate && onResumeLast && (
        <div className="welcome-resume" role="region" aria-label="Continuar última sessão">
          <History size={20} strokeWidth={2} className="welcome-resume-icon" aria-hidden="true" />
          <div className="welcome-resume-body">
            <strong>Continuar de onde parou?</strong>
            <span>
              {workspaceName(resumeCandidate.workspacePath)} · {resumeCandidate.sessionTitle} · {formatRelative(resumeCandidate.lastTimestamp)}
            </span>
          </div>
          <button
            type="button"
            className="welcome-resume-btn"
            onClick={() => onResumeLast(resumeCandidate.workspacePath, resumeCandidate.sessionId)}
          >
            Continuar
          </button>
        </div>
      )}

      {/* CTAs — primary full-width azul + 2 secondary lado a lado */}
      <div className="welcome-cta-stack">
        <button
          type="button"
          className="welcome-cta welcome-cta-primary"
          onClick={onOpenWorkspace}
        >
          <FolderOpen {...ICON_PROPS} />
          <span>Abrir pasta</span>
        </button>

        <div className="welcome-cta-row">
          <button
            type="button"
            className="welcome-cta welcome-cta-secondary"
            onClick={onOpenPreview}
            disabled={!onOpenPreview}
            title={onOpenPreview ? 'Abrir preview de dev server' : 'Abra uma pasta primeiro'}
          >
            <span>Preview de dev</span>
          </button>
          <button
            type="button"
            className="welcome-cta welcome-cta-secondary"
            onClick={() => {
              // Prompt nativo pra URL — quando confirmar, dispara CustomEvent que o App.tsx escuta
              // pra spawnar `git clone` no terminal e abrir o destino como workspace assim que terminar.
              const url = window.prompt('URL do repositório git (https://... ou git@...):');
              if (!url?.trim()) return;
              const cleaned = url.trim();
              // extrai nome do repo da URL pra usar como folder destino default
              const repoName = (cleaned.match(/([^/:]+?)(?:\.git)?$/)?.[1] || 'repo').replace(/\.git$/, '');
              const dest = window.prompt(`Clonar em qual pasta? (default: ./${repoName})`, repoName);
              if (dest === null) return;
              const folderName = dest.trim() || repoName;
              window.dispatchEvent(new CustomEvent('undrcod:clone-repo', {
                detail: { url: cleaned, folderName },
              }));
            }}
            title="Clonar via git clone — abre o terminal e depois abre a pasta como workspace"
          >
            <GitBranch {...ICON_PROPS} />
            <span>Clonar repositório</span>
          </button>
        </div>
      </div>

      {/* Workspaces — lista vertical 2-line */}
      {!loading && sortedWorkspaces.length > 0 && (
        <div className="welcome-workspaces">
          <h2 className="welcome-section-title">Workspaces</h2>
          <div className="welcome-ws-list">
            {visibleWorkspaces.map((ws) => {
              const isPinned = pinned.has(ws.path);
              return (
                <div
                  key={ws.path}
                  className={`welcome-ws-row${isPinned ? ' welcome-ws-row-pinned' : ''}`}
                >
                  <button
                    type="button"
                    className="welcome-ws-row-main"
                    onClick={() => onOpenRecent(ws.path)}
                    title={ws.path}
                  >
                    <span className="welcome-ws-name">{workspaceName(ws.path)}</span>
                    <span className="welcome-ws-path">{shortenWorkspacePath(ws.path)}</span>
                  </button>
                  <button
                    type="button"
                    className={`welcome-workspace-pin-btn${isPinned ? ' welcome-workspace-pin-btn-active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); togglePin(ws.path); }}
                    aria-pressed={isPinned}
                    aria-label={isPinned ? `Desafixar ${workspaceName(ws.path)}` : `Fixar ${workspaceName(ws.path)} no topo`}
                    title={isPinned ? 'Desafixar' : 'Fixar no topo'}
                  >
                    <Pin
                      size={13}
                      strokeWidth={2}
                      fill={isPinned ? 'currentColor' : 'none'}
                    />
                  </button>
                </div>
              );
            })}
          </div>
          {hasMore && (
            <button
              type="button"
              className="welcome-show-more"
              onClick={() => setShowAll(v => !v)}
            >
              {showAll ? 'Mostrar menos' : `Mostrar mais (${sortedWorkspaces.length - 3})`}
            </button>
          )}
        </div>
      )}

      {/* Footer minimal */}
      <div className="welcome-footer">
        <span className="welcome-footer-version">UNDRCOD v0.0.1</span>
      </div>
    </div>
  );
}
