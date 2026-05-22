/**
 * AgentManager — janela chat-focused estilo Antigravity.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────┐
 *   │ topbar: brand + Open Editor + window controls   │
 *   ├──────────┬──────────────────────────────────────┤
 *   │ + New    │                                       │
 *   │ History  │       ChatView | Chat History view    │
 *   │ ─────────│                                       │
 *   │ WS       │                                       │
 *   │  · ws1   │                                       │
 *   │    s1    │                                       │
 *   │  · ws2   │                                       │
 *   │ ─────────│                                       │
 *   │ Settings │                                       │
 *   │ Feedback │                                       │
 *   │ More …   │                                       │
 *   └──────────┴──────────────────────────────────────┘
 *
 * Renderizado quando URL tem ?mode=agent.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatView } from '../ChatView/ChatView';
import { toast, ToastHost } from '../Toast/Toast';
import { ConfirmDialogHost } from '../ConfirmDialog/ConfirmDialog';
import { SettingsModal } from '../SettingsModal/SettingsModal';
import { CustomizationTabs } from '../CustomizationTabs/CustomizationTabs';
import { ComposerPopover, type PopoverItem } from '../ChatView/ComposerPopover';
import { TranscriptView, type TranscriptMode, type TranscriptFontSize } from '../TranscriptView/TranscriptView';
import type { SessionInfo } from '../StatusBar/StatusBar';
import './AgentManager.css';

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

type ViewMode = 'chat' | 'history';

function workspaceName(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments[segments.length - 1] || path;
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return 'agora';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString('pt-BR');
}

export function AgentManager() {
  const [workspaces, setWorkspaces] = useState<KnownWorkspace[]>([]);
  const [expandedWs, setExpandedWs] = useState<Set<string>>(new Set());
  const [sessionsByWs, setSessionsByWs] = useState<Record<string, SessionMeta[]>>({});
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'recent'>('all');
  const [, setSessionInfo] = useState<SessionInfo>({});
  const [, setStatus] = useState<string>('ready');

  // Sidebar toggle (Ctrl+B).
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Navigation history — back/forward (← →). Stack of {cwd, sessionId, viewMode}.
  // Cada select de session/workspace/history push um snapshot; back/forward
  // navegam sem disparar push (flag `navigatingRef` evita loop).
  interface NavSnapshot {
    cwd: string | null;
    sessionId: string | null;
    viewMode: ViewMode;
  }
  const navHistoryRef = useRef<NavSnapshot[]>([]);
  const navIndexRef = useRef<number>(-1);
  const navigatingRef = useRef<boolean>(false);
  const [navTick, setNavTick] = useState(0); // pra re-render quando index muda

  // Modais reaproveitados do App.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customizationOpen, setCustomizationOpen] = useState(false);

  // "More" menu popover.
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Transcript view + Views menu — equivalente aos botões eye/preview que
  // existiam no editor mode (foram movidos pra cá conforme decisão de UX).
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  // Default 'normal' — tools/thinking colapsados; 'detailed' é opt-in.
  const [transcriptMode, setTranscriptMode] = useState<TranscriptMode>('normal');
  const [transcriptFontSize, setTranscriptFontSize] = useState<TranscriptFontSize>('md');
  const transcriptBtnRef = useRef<HTMLButtonElement>(null);
  const [viewsMenuOpen, setViewsMenuOpen] = useState(false);
  const viewsBtnRef = useRef<HTMLButtonElement>(null);

  // Push snapshot ao navegar (chat/session change). navigatingRef pula quando
  // back/forward está restaurando estado.
  useEffect(() => {
    if (navigatingRef.current) {
      navigatingRef.current = false;
      return;
    }
    const snap: NavSnapshot = { cwd: activeCwd, sessionId: activeSessionId, viewMode };
    const stack = navHistoryRef.current;
    // Trunca tudo após o índice atual (perde "forward" se navegou nova rota)
    const trimmed = stack.slice(0, navIndexRef.current + 1);
    // Evita push duplicado de snapshot idêntico ao último
    const last = trimmed[trimmed.length - 1];
    if (last && last.cwd === snap.cwd && last.sessionId === snap.sessionId && last.viewMode === snap.viewMode) {
      return;
    }
    trimmed.push(snap);
    navHistoryRef.current = trimmed;
    navIndexRef.current = trimmed.length - 1;
    setNavTick((t) => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCwd, activeSessionId, viewMode]);

  const goBack = useCallback(() => {
    const idx = navIndexRef.current;
    if (idx <= 0) return;
    const target = navHistoryRef.current[idx - 1];
    navigatingRef.current = true;
    navIndexRef.current = idx - 1;
    setActiveCwd(target.cwd);
    setActiveSessionId(target.sessionId);
    setViewMode(target.viewMode);
    setNavTick((t) => t + 1);
  }, []);

  const goForward = useCallback(() => {
    const idx = navIndexRef.current;
    const stack = navHistoryRef.current;
    if (idx >= stack.length - 1) return;
    const target = stack[idx + 1];
    navigatingRef.current = true;
    navIndexRef.current = idx + 1;
    setActiveCwd(target.cwd);
    setActiveSessionId(target.sessionId);
    setViewMode(target.viewMode);
    setNavTick((t) => t + 1);
  }, []);

  const canGoBack = navIndexRef.current > 0;
  const canGoForward = navIndexRef.current < navHistoryRef.current.length - 1;
  // navTick é só pra forçar re-render quando index muda; React precisa "ver" a leitura
  void navTick;

  // Ctrl+B — toggle sidebar (atalho do Antigravity).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
        const activeEl = document.activeElement;
        if (
          activeEl?.tagName === 'INPUT' ||
          activeEl?.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement)?.isContentEditable
        ) return;
        e.preventDefault();
        setSidebarOpen((p) => !p);
      }
      // Alt+← / Alt+→ — back/forward (padrão browser/IDE)
      if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        goBack();
      }
      if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 'ArrowRight') {
        e.preventDefault();
        goForward();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goBack, goForward]);

  // Boot — carrega workspaces conhecidos.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = window.undrcodAPI?.claude?.listKnownWorkspaces;
    if (typeof fn !== 'function') return;
    fn().then((list: KnownWorkspace[]) => {
      const sorted = [...list].sort(
        (a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime()
      );
      setWorkspaces(sorted);
      if (sorted.length > 0) {
        const first = sorted[0].path;
        setActiveCwd(first);
        // CHEVRONS FECHADOS NO BOOT — usuário clica pra expandir. Sem isso, o
        // workspace mais recente (Claude com 138MB files) começava expanded
        // disparando load lento → "Carregando..." preso. Lazy on expand
        // garante UI responsiva imediato + load via cache hit quando user clica.
      }
    }).catch(() => { /* ignore */ });
  }, []);

  const loadSessionsFor = useCallback((cwd: string) => {
    if (sessionsByWs[cwd]) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = window.undrcodAPI?.claude?.listProjectSessions;
    if (typeof fn !== 'function') return;
    fn(cwd).then((list: SessionMeta[]) => {
      const sorted = [...list].sort(
        (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
      );
      setSessionsByWs((prev) => ({ ...prev, [cwd]: sorted }));
    }).catch(() => { /* ignore */ });
  }, [sessionsByWs]);

  const toggleExpand = useCallback((cwd: string) => {
    setExpandedWs((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) {
        next.delete(cwd);
      } else {
        next.add(cwd);
        loadSessionsFor(cwd);
      }
      return next;
    });
  }, [loadSessionsFor]);

  const handleSelectSession = useCallback((cwd: string, sessionId: string) => {
    setActiveCwd(cwd);
    setActiveSessionId(sessionId);
    setViewMode('chat');
  }, []);

  const handleNewConversation = useCallback((cwd?: string) => {
    const target = cwd || activeCwd;
    if (!target) {
      toast.warn('Selecione um workspace primeiro');
      return;
    }
    setActiveCwd(target);
    setActiveSessionId(null);
    setViewMode('chat');
  }, [activeCwd]);

  const handleOpenHistory = useCallback(() => {
    setViewMode('history');
    // Carrega sessions de todos workspaces conhecidos pra a view global.
    workspaces.forEach((ws) => loadSessionsFor(ws.path));
  }, [workspaces, loadSessionsFor]);

  const handleAddWorkspace = useCallback(async () => {
    const fn = window.undrcodAPI?.dialog?.openFolder;
    if (typeof fn !== 'function') {
      toast.warn('Diálogo de pasta indisponível');
      return;
    }
    try {
      const res = await fn();
      if (res.canceled === true) return;
      const picked = res.path;
      // Adiciona localmente (não persiste — listKnownWorkspaces recarrega
      // quando uma session for criada no diretório).
      setWorkspaces((prev) => {
        if (prev.some((w) => w.path === picked)) return prev;
        return [{ path: picked, sessionCount: 0, lastUsed: new Date().toISOString() }, ...prev];
      });
      setActiveCwd(picked);
      setExpandedWs((prev) => new Set([...prev, picked]));
      setActiveSessionId(null);
      setViewMode('chat');
    } catch { /* ignore */ }
  }, []);

  const handleOpenEditor = useCallback(() => {
    // Persiste o cwd ativo em localStorage ANTES de abrir a nova janela.
    // O boot do App lê `undrcode.lastWorkspace` e usa esse path (com
    // fallback pra home se inválido). Como localStorage é compartilhado
    // entre BrowserWindows da mesma session, a nova janela já abre no
    // workspace que estava ativo no Agent Manager.
    if (activeCwd) {
      try {
        localStorage.setItem('undrcode.lastWorkspace', activeCwd);
      } catch { /* ignore */ }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = window.undrcodAPI?.window;
    if (api?.openNew) {
      void api.openNew().then(() => {
        toast.success(
          activeCwd ? `Editor aberto em ${workspaceName(activeCwd)}` : 'Editor aberto',
        );
      });
    }
  }, [activeCwd]);

  // Lista global de sessions (todos workspaces) — usada na view "Chat History".
  const allSessions = useMemo(() => {
    const out: Array<SessionMeta & { wsName: string }> = [];
    for (const ws of workspaces) {
      const list = sessionsByWs[ws.path];
      if (!list) continue;
      for (const s of list) {
        out.push({ ...s, wsName: workspaceName(ws.path) });
      }
    }
    out.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());
    return out;
  }, [workspaces, sessionsByWs]);

  const filteredHistory = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    let list = allSessions;
    if (historyFilter === 'recent') {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      list = list.filter((s) => new Date(s.lastTimestamp).getTime() >= weekAgo);
    }
    if (q) {
      list = list.filter(
        (s) => (s.title || '').toLowerCase().includes(q) || s.wsName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allSessions, historyQuery, historyFilter]);

  const moreMenuItems: PopoverItem[] = [
    {
      kind: 'item',
      icon: 'book',
      label: 'Knowledge',
      onClick: () => { setMoreMenuOpen(false); setCustomizationOpen(true); },
    },
    {
      kind: 'item',
      icon: 'symbol-keyword',
      label: 'Shortcuts',
      onClick: () => {
        setMoreMenuOpen(false);
        toast.info('Atalhos: Ctrl+Shift+M abre Agent Manager · Ctrl+N nova conversa');
      },
    },
  ];

  // Views menu — Conversation History já vive no sidebar, então o menu aqui
  // foca nas visualizações auxiliares (Plan / Background Tasks). Stubs com
  // toast por enquanto — a state mgmt completa fica pra quando os views forem
  // implementados na main area.
  const viewsMenuItems: PopoverItem[] = [
    {
      kind: 'item',
      icon: 'comment-discussion',
      label: 'Histórico de conversas',
      shortcut: '⇧ Ctrl F',
      onClick: () => {
        setViewsMenuOpen(false);
        handleOpenHistory();
      },
    },
    {
      kind: 'item',
      icon: 'list-ordered',
      label: 'Plano',
      onClick: () => {
        setViewsMenuOpen(false);
        toast.info('View "Plano" ainda não disponível no Agent Manager');
      },
    },
    {
      kind: 'item',
      icon: 'tasklist',
      label: 'Tarefas em segundo plano',
      onClick: () => {
        setViewsMenuOpen(false);
        toast.info('View "Tarefas em segundo plano" ainda não disponível');
      },
    },
  ];

  return (
    <div className="agent-manager">
      <div className="agent-mgr-topbar">
        <div className="agent-mgr-topbar-left">
          <span className="agent-mgr-brand">
            <span className="wordmark"><span className="wordmark-u">_</span>UNDRCOD</span>
          </span>
        </div>

        {/* Center cluster — nav arrows + sidebar toggle + workspace name (Antigravity style) */}
        <div className="agent-mgr-topbar-center">
          <button
            type="button"
            className="agent-mgr-topbar-btn agent-mgr-nav-arrow"
            onClick={goBack}
            disabled={!canGoBack}
            title="Voltar (Alt+←)"
          >
            <i className="codicon codicon-arrow-left" />
          </button>
          <button
            type="button"
            className="agent-mgr-topbar-btn agent-mgr-nav-arrow"
            onClick={goForward}
            disabled={!canGoForward}
            title="Avançar (Alt+→)"
          >
            <i className="codicon codicon-arrow-right" />
          </button>
          <button
            type="button"
            className={`agent-mgr-topbar-btn ${sidebarOpen ? 'is-active' : ''}`}
            onClick={() => setSidebarOpen((p) => !p)}
            title="Toggle Sidebar (Ctrl+B)"
          >
            <i className="codicon codicon-layout-sidebar-left" />
          </button>
        </div>

        <div className="agent-mgr-topbar-right">
          <button
            type="button"
            className="agent-mgr-topbar-btn"
            onClick={handleOpenEditor}
            title="Abrir editor em nova janela"
          >
            <i className="codicon codicon-code" /> Open Editor
          </button>
          <button
            type="button"
            className="agent-mgr-topbar-btn"
            onClick={() => window.undrcodAPI?.window?.minimize?.()}
            title="Minimizar"
          >
            <i className="codicon codicon-chrome-minimize" />
          </button>
          <button
            type="button"
            className="agent-mgr-topbar-btn"
            onClick={() => window.undrcodAPI?.window?.maximize?.()}
            title="Maximizar"
          >
            <i className="codicon codicon-chrome-maximize" />
          </button>
          <button
            type="button"
            className="agent-mgr-topbar-btn agent-mgr-topbar-close"
            onClick={() => window.undrcodAPI?.window?.close?.()}
            title="Fechar"
          >
            <i className="codicon codicon-chrome-close" />
          </button>
        </div>
      </div>

      <div className="agent-mgr-body">
        {sidebarOpen && (
        <aside className="agent-mgr-sidebar">
          {/* Top actions — estilo Antigravity: clean, sem cor de destaque. */}
          <div className="agent-mgr-top-actions">
            <button
              type="button"
              className="agent-mgr-nav-btn"
              onClick={() => handleNewConversation()}
            >
              <i className="codicon codicon-add" />
              <span>New Conversation</span>
            </button>
            <button
              type="button"
              className={`agent-mgr-nav-btn ${viewMode === 'history' ? 'is-active' : ''}`}
              onClick={handleOpenHistory}
            >
              <i className="codicon codicon-history" />
              <span>Conversation History</span>
            </button>
          </div>

          <div className="agent-mgr-section-header">
            <span className="agent-mgr-section-title">Workspaces</span>
            <button
              type="button"
              className="agent-mgr-section-action"
              title="Adicionar workspace"
              onClick={handleAddWorkspace}
            >
              <i className="codicon codicon-new-folder" />
            </button>
          </div>

          <div className="agent-mgr-ws-list">
            {workspaces.length === 0 && (
              <div className="agent-mgr-empty">Nenhum workspace encontrado</div>
            )}
            {workspaces.map((ws) => {
              const expanded = expandedWs.has(ws.path);
              const sessions = sessionsByWs[ws.path] || [];
              const isActiveWs = activeCwd === ws.path && viewMode === 'chat';
              return (
                <div key={ws.path} className="agent-mgr-ws">
                  <button
                    type="button"
                    className={`agent-mgr-ws-header ${isActiveWs ? 'is-active' : ''}`}
                    onClick={() => toggleExpand(ws.path)}
                  >
                    <i className={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`} />
                    <span className="agent-mgr-ws-name">{workspaceName(ws.path)}</span>
                  </button>
                  {expanded && (
                    <div className="agent-mgr-sessions">
                      {sessions.length === 0 && (
                        <div className="agent-mgr-empty agent-mgr-empty-sub">
                          {sessionsByWs[ws.path] === undefined ? 'Carregando...' : 'Sem conversas'}
                        </div>
                      )}
                      {sessions.slice(0, 10).map((s) => {
                        const isActive =
                          activeSessionId === s.sessionId &&
                          activeCwd === ws.path &&
                          viewMode === 'chat';
                        return (
                          <button
                            key={s.sessionId}
                            type="button"
                            className={`agent-mgr-session ${isActive ? 'is-active' : ''}`}
                            onClick={() => handleSelectSession(ws.path, s.sessionId)}
                            title={s.title}
                          >
                            <span className="agent-mgr-session-title">
                              {s.title || '(sem título)'}
                            </span>
                            <span className="agent-mgr-session-time">
                              {formatRelative(s.lastTimestamp)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bottom items — Settings, Feedback, More. */}
          <div className="agent-mgr-bottom-actions">
            <button
              type="button"
              className="agent-mgr-nav-btn"
              onClick={() => setSettingsOpen(true)}
            >
              <i className="codicon codicon-settings-gear" />
              <span>Settings</span>
            </button>
            <button
              type="button"
              className="agent-mgr-nav-btn"
              onClick={() => {
                const fn = window.undrcodAPI?.openExternal;
                if (typeof fn === 'function') {
                  void fn('https://github.com/anthropics/claude-code/issues');
                } else {
                  toast.info('Abra um issue em github.com/anthropics/claude-code');
                }
              }}
            >
              <i className="codicon codicon-feedback" />
              <span>Provide Feedback</span>
            </button>
            <button
              ref={moreBtnRef}
              type="button"
              className={`agent-mgr-nav-btn ${moreMenuOpen ? 'is-active' : ''}`}
              onClick={() => setMoreMenuOpen((p) => !p)}
            >
              <i className="codicon codicon-more" />
              <span>More</span>
            </button>
          </div>
        </aside>
        )}

        <main className="agent-mgr-main">
          {viewMode === 'history' ? (
            <div className="agent-mgr-history">
              <h1 className="agent-mgr-history-title">Chat History</h1>
              <div className="agent-mgr-history-controls">
                <div className="agent-mgr-history-search">
                  <i className="codicon codicon-search" />
                  <input
                    type="text"
                    placeholder="Search"
                    value={historyQuery}
                    onChange={(e) => setHistoryQuery(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="agent-mgr-history-filter"
                  onClick={() =>
                    setHistoryFilter((prev) => (prev === 'all' ? 'recent' : 'all'))
                  }
                  title="Alternar filtro"
                >
                  <i className="codicon codicon-filter" />
                  <span>{historyFilter === 'recent' ? 'Últimos 7d' : 'Filter'}</span>
                </button>
              </div>
              <div className="agent-mgr-history-list">
                {filteredHistory.length === 0 && (
                  <div className="agent-mgr-empty">Nenhuma conversa encontrada</div>
                )}
                {filteredHistory.map((s) => (
                  <button
                    key={`${s.cwd}|${s.sessionId}`}
                    type="button"
                    className="agent-mgr-history-row"
                    onClick={() => handleSelectSession(s.cwd, s.sessionId)}
                  >
                    <i className="codicon codicon-check agent-mgr-history-icon" />
                    <div className="agent-mgr-history-row-text">
                      <span className="agent-mgr-history-row-title">
                        {s.title || '(sem título)'}
                      </span>
                      <span className="agent-mgr-history-row-ws">{s.wsName}</span>
                    </div>
                    <span className="agent-mgr-history-row-time">
                      {formatRelative(s.lastTimestamp)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : activeCwd ? (
            <>
              {/* Toolbar FORA do chat-card — fica sobre o canvas bg-base
                  (mesma cor da topbar), só os ícones flutuando. */}
              <div className="agent-mgr-chat-toolbar">
                <button
                  ref={transcriptBtnRef}
                  type="button"
                  className={`agent-mgr-chat-toolbar-btn ${transcriptOpen ? 'is-active' : ''}`}
                  title="Visualização de transcrição (Ctrl+O)"
                  onClick={() => setTranscriptOpen((prev) => !prev)}
                >
                  <i className="codicon codicon-eye" />
                </button>
                <button
                  ref={viewsBtnRef}
                  type="button"
                  className={`agent-mgr-chat-toolbar-btn agent-mgr-views-btn ${viewsMenuOpen ? 'is-active' : ''}`}
                  title="Visualizações"
                  onClick={() => setViewsMenuOpen((p) => !p)}
                >
                  <i className="codicon codicon-preview" />
                  <i className="codicon codicon-chevron-down agent-mgr-views-chevron" />
                </button>
              </div>
              <div
                className="agent-mgr-chat-wrap"
                data-chat-font={transcriptFontSize}
                data-chat-mode={transcriptMode}
              >
                <ChatView
                  key={`${activeCwd}|${activeSessionId || 'new'}`}
                  cwd={activeCwd}
                  onStatusChange={setStatus}
                  onSessionInfoChange={setSessionInfo}
                  resumeSessionId={activeSessionId}
                  transcriptMode={transcriptMode}
                  transcriptFontSize={transcriptFontSize}
                  onTranscriptFontSizeChange={setTranscriptFontSize}
                />
              </div>
            </>
          ) : (
            <div className="agent-mgr-empty-state">
              <h2>Agent Manager</h2>
              <p>Selecione um workspace na lateral ou abra uma nova conversa.</p>
            </div>
          )}
        </main>
      </div>

      {/* More menu popover. */}
      <ComposerPopover
        open={moreMenuOpen}
        onClose={() => setMoreMenuOpen(false)}
        anchorRef={moreBtnRef}
        items={moreMenuItems}
        placement="top"
        align="left"
        minWidth={180}
      />

      {/* Transcript view popover — controles de mode/fontSize do chat. */}
      <TranscriptView
        open={transcriptOpen}
        onClose={() => setTranscriptOpen(false)}
        anchorRef={transcriptBtnRef}
        mode={transcriptMode}
        fontSize={transcriptFontSize}
        onModeChange={setTranscriptMode}
        onFontSizeChange={setTranscriptFontSize}
      />

      {/* Views menu popover. */}
      <ComposerPopover
        open={viewsMenuOpen}
        onClose={() => setViewsMenuOpen(false)}
        anchorRef={viewsBtnRef}
        items={viewsMenuItems}
        title="Visualizações"
        placement="bottom"
        align="right"
        minWidth={260}
      />

      {/* Modais. */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {activeCwd && (
        <CustomizationTabs
          open={customizationOpen}
          cwd={activeCwd}
          onClose={() => setCustomizationOpen(false)}
        />
      )}

      {/* Toast + ConfirmDialog hosts (cada janela tem os seus). */}
      <ToastHost />
      <ConfirmDialogHost />
    </div>
  );
}
