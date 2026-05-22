/**
 * WorkspacesPanel — substitui a tab "Arquivos" do popover Visualizacoes.
 *
 * Lista TODOS os workspaces conhecidos pelo Claude CLI (~/.claude/projects).
 * Cada workspace expansivel mostra suas sessions salvas.
 *
 * Acoes:
 *   - Click "+ Nova conversa em <workspace>"  -> setCwd, sem resume (sessão fresh)
 *   - Click numa session antiga                -> setCwd + resume daquela session
 *
 * Match conceitual com `antigravity.openConversationWorkspaceQuickPick`.
 */

import { useEffect, useRef, useState } from 'react';
import './WorkspacesPanel.css';

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

/**
 * Module-scope cache pra workspaces/sessions. Sobrevive a mount/unmount do
 * componente (Right pane + CentralTabs montam/desmontam WorkspacesPanel quando
 * a tab muda). Sem isso, cada remount mostrava "Carregando..." mesmo com cache
 * disco completo no main process — IPC roundtrip é ~10-50ms mas o "Carregando..."
 * flash incomodava.
 *
 * Vive enquanto a janela renderer estiver aberta. Reload completo no boot.
 */
const moduleSessionsCache: Record<string, SessionMeta[]> = {};
let moduleWorkspacesCache: KnownWorkspace[] | null = null;

/**
 * Dedupe in-flight: se 2 instâncias do componente montarem em paralelo
 * (CentralViewContent + RightPane, ou StrictMode double-invoke em dev), elas
 * compartilham a MESMA Promise em vez de disparar 2 IPC calls idênticas.
 *
 * Main process já dedupa, mas isso evita 2x setState + 2x revalidação no
 * renderer — que era a causa do "Carregando..." preso no workspace atual:
 * 2 useEffect rodando paralelo, ambos pegando cwd diferentes (snapshot do
 * primeiro render onde cwd=null), e o setState do segundo sobrescrevendo
 * o do primeiro num momento ruim.
 */
let inflightWorkspacesPromise: Promise<KnownWorkspace[]> | null = null;
const inflightSessionsPromises: Record<string, Promise<SessionMeta[]>> = {};

async function fetchWorkspacesDeduped(): Promise<KnownWorkspace[] | null> {
  if (inflightWorkspacesPromise) return inflightWorkspacesPromise;
  const fn = window.undrcodAPI?.claude?.listKnownWorkspaces;
  if (typeof fn !== 'function') return null;
  inflightWorkspacesPromise = fn().then((list) => {
    moduleWorkspacesCache = list;
    return list;
  }).finally(() => {
    inflightWorkspacesPromise = null;
  });
  return inflightWorkspacesPromise;
}

async function fetchSessionsDeduped(path: string): Promise<SessionMeta[] | null> {
  if (inflightSessionsPromises[path]) return inflightSessionsPromises[path];
  const fn = window.undrcodAPI?.claude?.listProjectSessions;
  if (typeof fn !== 'function') return null;
  const p = fn(path).then((list) => {
    moduleSessionsCache[path] = list;
    return list;
  }).finally(() => {
    delete inflightSessionsPromises[path];
  });
  inflightSessionsPromises[path] = p;
  return p;
}

interface WorkspacesPanelProps {
  /** workspace atual (destaca como "atual") */
  cwd?: string;
  /** Click numa session — passa o path + sessionId pra resume */
  onResumeSession: (path: string, sessionId: string) => void;
  /** Click em "+ Nova conversa" — passa o path, sem sessionId */
  onNewConversation: (path: string) => void;
}

function formatRelativeTime(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin}min atrás`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h atrás`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d atrás`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}sem atrás`;
  return date.toLocaleDateString('pt-BR');
}

function workspaceName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function WorkspacesPanel({ cwd, onResumeSession, onNewConversation }: WorkspacesPanelProps) {
  // Inicializa direto do module-cache se já temos — evita flash de "Carregando..."
  // em remounts (tab fechou/abriu, etc).
  const [workspaces, setWorkspaces] = useState<KnownWorkspace[]>(() => moduleWorkspacesCache ?? []);
  const [sessions, setSessions] = useState<Record<string, SessionMeta[]>>(() => ({ ...moduleSessionsCache }));
  // CHEVRONS COMEÇAM FECHADOS — user clica pra expandir. Resolve o bug do
  // "Carregando..." preso: a 1ª chamada do mount entrava em algum caminho
  // que não atualizava sessions[cwd]. Toggle ativo (fechar+abrir) usa o cache
  // já populado pelo background prefetch e responde instantâneo.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set<string>());
  // Só mostra "Carregando..." se NÃO temos nada em cache. Com cache, mostra
  // dados estáveis e revalida em background.
  const [loading, setLoading] = useState(() => moduleWorkspacesCache === null);
  const [filter, setFilter] = useState('');

  // Ref pra cwd corrente — permite o useEffect[] de boot referenciar o cwd
  // ATUAL (não o snapshot do primeiro render). Sem isso, se cwd chega depois
  // do mount (boot async fetch home dir), o priorize/reload do cwd não roda.
  const cwdRef = useRef(cwd);
  useEffect(() => { cwdRef.current = cwd; }, [cwd]);

  // Carrega workspaces conhecidos no mount + dispara prefetch em background.
  // Roda 1x por instância. StrictMode chama 2x mas o dedupe in-flight
  // (fetchWorkspacesDeduped) faz a 2ª pegar a Promise da 1ª.
  useEffect(() => {
    const api = window.undrcodAPI?.claude;
    if (!api?.listKnownWorkspaces) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const tMount = Date.now();
    console.log(`[WorkspacesPanel] mount cwd=${cwd ?? '<null>'}`);

    // FASE 1 (INSTANT): se temos snapshot no main, pinta a UI ANTES de qualquer
    // streaming. Esse IPC é puro lookup em Map — retorna em <5ms.
    // Roda em paralelo com listKnownWorkspaces.
    const snapshotFn = api.getAllSessionsSnapshots;
    if (typeof snapshotFn === 'function') {
      snapshotFn().then((all) => {
        if (cancelled) return;
        if (all && Object.keys(all).length > 0) {
          // Merge com state atual — preserva qualquer load mais recente.
          setSessions((prev) => ({ ...all, ...prev }));
          for (const [k, v] of Object.entries(all)) moduleSessionsCache[k] = v;
          console.log(`[WorkspacesPanel] instant snapshot: ${Object.keys(all).length} workspaces in ${Date.now() - tMount}ms`);
        }
      }).catch(() => { /* ignora */ });
    }

    // FASE 2 (FAST): listKnownWorkspaces — readdir + 1 stream curto por workspace.
    // fetchWorkspacesDeduped garante 1 IPC mesmo com StrictMode + 2 instâncias.
    fetchWorkspacesDeduped().then((list) => {
      if (cancelled || !list) return;
      setWorkspaces(list);
      setLoading(false);
      console.log(`[WorkspacesPanel] listKnownWorkspaces: ${list.length} workspaces in ${Date.now() - tMount}ms`);

      // FASE 3 (BACKGROUND REVALIDATE): pra cada workspace, dispara
      // listProjectSessions pra revalidar (mtime-aware no main, no-op se nada
      // mudou). Priorizado: cwd ATUAL primeiro (via cwdRef), depois resto.
      const currentCwd = cwdRef.current;
      const ordered = currentCwd
        ? [...list.filter((w) => w.path === currentCwd), ...list.filter((w) => w.path !== currentCwd)]
        : list;

      (async () => {
        for (const ws of ordered) {
          if (cancelled) return;
          try {
            const result = await fetchSessionsDeduped(ws.path);
            // CRÍTICO: NÃO skip o setSessions por `cancelled`. moduleSessionsCache
            // já tá populado pelo fetchSessionsDeduped (linha 76), mas se o
            // setSessions for skipado, o componente fica com state stale e exibe
            // "Carregando..." pra sempre. Em React 18+ setState após unmount é
            // no-op silencioso (sem warning), então é seguro chamar sempre.
            if (!result) continue;
            setSessions((prev) => ({ ...prev, [ws.path]: result }));
          } catch { /* ignora workspace falho */ }
          await new Promise((r) => setTimeout(r, 50));
        }
      })();
    }).catch(() => setLoading(false));
    return () => { cancelled = true; };
  // Roda 1x no mount. cwd mudanças tratadas em useEffect separado abaixo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // useEffect[cwd] removido: era a fonte do bug do "Carregando..." preso.
  // Lazy-by-design agora — user clica pra expandir e o load acontece via
  // toggleExpand → loadSessionsFor, que sempre funciona (cache hit do
  // background prefetch).

  async function loadSessionsFor(path: string) {
    try {
      const list = await fetchSessionsDeduped(path);
      // SEMPRE seta — mesmo se vier null, usa [] como fallback pra UI escapar
      // do "Carregando..." preso.
      setSessions((prev) => ({ ...prev, [path]: list ?? moduleSessionsCache[path] ?? [] }));
    } catch {
      setSessions((prev) => ({ ...prev, [path]: [] }));
    }
  }

  function toggleExpand(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        // Carrega sessions on-demand quando expande
        if (!sessions[path]) loadSessionsFor(path);
      }
      return next;
    });
  }

  // Filter
  const filtered = filter
    ? workspaces.filter((w) =>
        w.path.toLowerCase().includes(filter.toLowerCase()) ||
        workspaceName(w.path).toLowerCase().includes(filter.toLowerCase())
      )
    : workspaces;

  if (loading) {
    return (
      <div className="workspaces-panel-empty">
        <i className="codicon codicon-sync~spin" />
        <span>Carregando workspaces...</span>
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div className="workspaces-panel-empty">
        <i className="codicon codicon-folder" />
        <span>Nenhum workspace com sessões ainda.</span>
        <span className="workspaces-panel-empty-hint">
          Quando você conversar com o Claude num projeto, ele aparece aqui pra retomar depois.
        </span>
      </div>
    );
  }

  return (
    <div className="workspaces-panel">
      <div className="workspaces-panel-search">
        <i className="codicon codicon-search" />
        <input
          type="search"
          placeholder="Filtrar workspaces..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="workspaces-panel-list">
        {filtered.map((ws) => {
          const isExpanded = expanded.has(ws.path);
          const isCurrent = ws.path === cwd;
          const wsSessions = sessions[ws.path];
          return (
            <div key={ws.path} className={`workspace-row ${isCurrent ? 'is-current' : ''}`}>
              <button
                type="button"
                className="workspace-header"
                onClick={() => toggleExpand(ws.path)}
                title={ws.path}
              >
                <i className={`codicon codicon-chevron-${isExpanded ? 'down' : 'right'} workspace-chevron`} />
                <i className="codicon codicon-folder workspace-icon" />
                <span className="workspace-name">{workspaceName(ws.path)}</span>
                <span className="workspace-meta">
                  {ws.sessionCount} {ws.sessionCount === 1 ? 'sessão' : 'sessões'}
                </span>
                {isCurrent && <span className="workspace-current-badge">atual</span>}
              </button>

              {isExpanded && (
                <div className="workspace-sessions">
                  <button
                    type="button"
                    className="workspace-new-session"
                    onClick={() => onNewConversation(ws.path)}
                  >
                    <i className="codicon codicon-add" />
                    <span>Nova conversa</span>
                  </button>

                  {wsSessions === undefined ? (
                    <div className="workspace-sessions-loading">
                      <i className="codicon codicon-sync~spin" />
                      <span>Carregando sessões...</span>
                    </div>
                  ) : wsSessions.length === 0 ? (
                    <div className="workspace-sessions-empty">Sem sessões salvas.</div>
                  ) : (
                    wsSessions.map((s) => (
                      <button
                        key={s.sessionId}
                        type="button"
                        className="workspace-session"
                        onClick={() => onResumeSession(ws.path, s.sessionId)}
                        title={`${s.title}\n\n${s.messageCount} msgs · ${s.sessionId}`}
                      >
                        <i className="codicon codicon-comment-discussion workspace-session-icon" />
                        <div className="workspace-session-body">
                          <div className="workspace-session-title">{s.title}</div>
                          <div className="workspace-session-meta">
                            {formatRelativeTime(s.lastTimestamp)} · {s.messageCount} msgs
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
