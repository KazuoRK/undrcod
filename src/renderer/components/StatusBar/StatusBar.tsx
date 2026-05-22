import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { TokenUsage } from '../../../shared/agent-types';
import { Folder, Play, MessagesSquare, ListOrdered, CheckCheck, Book, GitBranch, CircleX, TriangleAlert, Activity, Save, Bell, Info, CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react';
import { Logo } from '../Logo/Logo';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu';
import {
  toast,
  getNotificationLog,
  getUnreadNotificationCount,
  subscribeNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  removeNotification,
  clearNotifications,
  type NotificationEntry,
} from '../Toast/Toast';
import './StatusBar.css';

const SB_ICON = { size: 12, strokeWidth: 2 } as const;

export interface AgentTask {
  id: string;
  name: string;
  description?: string;
  status: 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt?: number;
}

export interface BashLogEntry {
  id: string;
  command: string;
  output?: string;
  isError?: boolean;
  timestamp: number;
}

export interface SessionInfo {
  sessionId?: string;
  model?: string;
  toolsCount?: number;
  turns?: number;
  lastUsage?: TokenUsage;
  lastCostUsd?: number;
  totalCostUsd?: number;
  busy?: boolean;
  hasMemory?: boolean;
  permissionMode?: string;
  /** Lista de tool_use events da sessão (pra RightPane Tarefas) */
  tasks?: AgentTask[];
  /** Log de bash tool calls (pra RightPane Terminal) */
  bashLog?: BashLogEntry[];
  /** Mensagens de texto do assistant — pra parser de Plano detectar checklists */
  assistantMessages?: string[];
}

interface StatusBarProps {
  cwd: string;
  info: SessionInfo;
  /** Quantidade de arquivos com edições não-salvas (dirtyContents.size do App) */
  dirtyCount?: number;
}

/**
 * Status bar inferior — sempre visível.
 * Transparência radical: model, tokens, cost — sem esconder.
 */
export function StatusBar({ cwd, info, dirtyCount = 0 }: StatusBarProps) {
  const cwdShort = cwd.split(/[\\/]/).filter(Boolean).slice(-2).join('/');
  const sessionShort = info.sessionId?.slice(0, 8);

  // ====== Git branch + ahead/behind ======
  // Polling 5s + listen pra evento custom 'undrcod:git-changed' (disparado pelo
  // SourceControl após stage/unstage/commit pra refresh imediato).
  const [branch, setBranch] = useState<{ name: string; ahead: number; behind: number } | null>(null);
  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    const fetch = (): void => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = window.undrcodAPI?.git;
      if (!api?.status) return;
      api.status(cwd).then((s: { branch: string; ahead: number; behind: number; files: unknown[] }) => {
        if (cancelled || !s.branch) return;
        setBranch({ name: s.branch, ahead: s.ahead, behind: s.behind });
      }).catch(() => { /* não bloqueia se não for repo */ });
    };
    fetch();
    const interval = setInterval(fetch, 5000);
    const onGitChange = (): void => fetch();
    window.addEventListener('undrcod:git-changed', onGitChange);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('undrcod:git-changed', onGitChange);
    };
  }, [cwd]);

  // ====== Problems count (errors + warnings via tsc) ======
  // Polling 15s — tsc é mais pesado que git status. Evento 'undrcod:problems-changed'
  // pode disparar refresh imediato se algum hook editor quiser.
  const [problems, setProblems] = useState<{ errors: number; warnings: number } | null>(null);
  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    const fetch = (): void => {
      const api = window.undrcodAPI?.problems;
      if (!api?.check) return;
      api.check(cwd).then((res) => {
        if (cancelled || !res?.files) return;
        // BUG FIX descoberto pós-remoção de `as any`: o endpoint retorna
        // `file.errors[]` (sem campo severity), não `file.messages[]` com severity.
        // O código antigo iterava `file.messages ?? []` que sempre era undefined,
        // resultando em SEMPRE 0 errors / 0 warnings no statusbar.
        //
        // Backend atual (problems:check) só reporta erros do tsc — sem warnings.
        // Conta tudo como error até backend distinguir severity.
        let errors = 0;
        const warnings = 0;
        for (const file of res.files) {
          errors += (file.errors?.length ?? 0);
        }
        setProblems({ errors, warnings });
      }).catch(() => { /* silencioso */ });
    };
    fetch();
    const interval = setInterval(fetch, 15000);
    const onProblemsChange = (): void => fetch();
    window.addEventListener('undrcod:problems-changed', onProblemsChange);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('undrcod:problems-changed', onProblemsChange);
    };
  }, [cwd]);

  // ====== Memory monitor (RAM/CPU do app) ======
  // Self-contained: lê setting 'showMemoryMonitor' direto + listen onChanged.
  // Polling 2s só roda quando habilitado. Esconde silenciosamente se IPC não disponível.
  const [showMem, setShowMem] = useState<boolean>(false);
  const [mem, setMem] = useState<{ rssMb: number; cpuPercent: number; processes: number } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settingsApi = window.undrcodAPI?.settings;
    if (!settingsApi?.get) return;
    let cancelled = false;
    settingsApi.get('showMemoryMonitor').then((v: boolean | undefined) => {
      if (!cancelled) setShowMem(!!v);
    }).catch(() => { /* silencioso */ });
    const off = settingsApi.onChanged?.((key: string, value: unknown) => {
      if (key === 'showMemoryMonitor') setShowMem(!!value);
    });
    return () => {
      cancelled = true;
      if (typeof off === 'function') off();
    };
  }, []);

  useEffect(() => {
    if (!showMem) {
      setMem(null);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sysApi = window.undrcodAPI?.system;
    if (!sysApi?.getMetrics) return;
    let cancelled = false;
    const fetch = (): void => {
      sysApi.getMetrics().then((m: { rssMb: number; cpuPercent: number; processes: number }) => {
        if (!cancelled) setMem(m);
      }).catch(() => { /* silencioso — se IPC falhar, esconde */
        if (!cancelled) setMem(null);
      });
    };
    fetch();
    const interval = setInterval(fetch, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [showMem]);

  // (handleBranchClick antigo foi substituído pelo openBranchMenu abaixo —
  //  click no badge agora abre dropdown com lista de branches.)

  // === Branch switcher menu (click no badge) ===
  // Mostra lista de branches local + remote pra checkout direto. Fetch só ao abrir.
  const [branchMenuPos, setBranchMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [branchList, setBranchList] = useState<Array<{ name: string; isCurrent: boolean; isRemote: boolean }> | null>(null);
  const [branchLoading, setBranchLoading] = useState(false);

  const openBranchMenu = async (e: React.MouseEvent<HTMLButtonElement>): Promise<void> => {
    const rect = e.currentTarget.getBoundingClientRect();
    setBranchMenuPos({ x: rect.left, y: rect.top - 4 });
    setBranchLoading(true);
    setBranchList(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = window.undrcodAPI?.git;
      if (!api?.branches) return;
      const r = await api.branches(cwd);
      if ('branches' in r) {
        setBranchList(r.branches);
      } else {
        setBranchList([]);
      }
    } catch {
      setBranchList([]);
    } finally {
      setBranchLoading(false);
    }
  };

  const handleCheckout = async (branchName: string): Promise<void> => {
    setBranchMenuPos(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = window.undrcodAPI?.git;
    if (!api?.checkout) return;
    const r = await api.checkout(cwd, branchName);
    if ('error' in r) {
      toast.error('Checkout falhou', { sub: r.error });
      return;
    }
    toast.success(`Switched para ${branchName}`);
    window.dispatchEvent(new CustomEvent('undrcod:git-changed'));
  };

  const handleCreateBranch = async (): Promise<void> => {
    setBranchMenuPos(null);
    const name = window.prompt('Nome da nova branch:');
    if (!name?.trim()) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = window.undrcodAPI?.git;
    if (!api?.createBranch) return;
    const r = await api.createBranch(cwd, name.trim());
    if ('error' in r) {
      toast.error('Create branch falhou', { sub: r.error });
      return;
    }
    toast.success(`Branch ${name.trim()} criada e checked out`);
    window.dispatchEvent(new CustomEvent('undrcod:git-changed'));
  };

  const branchMenuItems = (): ContextMenuItem[] => {
    if (branchLoading) {
      return [{ kind: 'item', icon: 'loading', label: 'Carregando branches...', disabled: true }];
    }
    if (!branchList || branchList.length === 0) {
      return [{ kind: 'item', icon: 'warning', label: 'Nenhuma branch encontrada', disabled: true }];
    }
    const current = branchList.find((b) => b.isCurrent);
    const localBranches = branchList.filter((b) => !b.isRemote && !b.isCurrent);
    const remoteBranches = branchList.filter((b) => b.isRemote);
    const items: ContextMenuItem[] = [];
    if (current) {
      items.push({ kind: 'item', icon: 'git-branch', label: `${current.name} (atual)`, disabled: true });
      items.push({ kind: 'divider' });
    }
    if (localBranches.length > 0) {
      for (const b of localBranches) {
        items.push({
          kind: 'item',
          icon: 'git-branch',
          label: b.name,
          onClick: () => { void handleCheckout(b.name); },
        });
      }
      items.push({ kind: 'divider' });
    }
    if (remoteBranches.length > 0) {
      // só mostra remotes que não tem local equivalente
      const localNames = new Set(branchList.filter((b) => !b.isRemote).map((b) => b.name));
      const orphanRemotes = remoteBranches.filter((b) => {
        const stripped = b.name.replace(/^origin\//, '');
        return !localNames.has(stripped);
      });
      if (orphanRemotes.length > 0) {
        for (const b of orphanRemotes.slice(0, 8)) {
          items.push({
            kind: 'item',
            icon: 'cloud',
            label: b.name,
            onClick: () => { void handleCheckout(b.name); },
          });
        }
        items.push({ kind: 'divider' });
      }
    }
    items.push({
      kind: 'item',
      icon: 'add',
      label: 'Criar nova branch...',
      onClick: () => { void handleCreateBranch(); },
    });
    items.push({
      kind: 'item',
      icon: 'source-control',
      label: 'Abrir Source Control',
      onClick: () => {
        setBranchMenuPos(null);
        window.dispatchEvent(new CustomEvent('undrcod:focus-source-control'));
      },
    });
    return items;
  };
  // ============================================

  // ====== Editor selection (Ln X, Col Y · N sel) ======
  // Listen `undrcod:editor-selection` que MonacoEditor dispatcha onDidChangeCursorSelection.
  // Esconde quando editor perde foco por mais de 10s (timer cancelado se refoca).
  const [selection, setSelection] = useState<{ line: number; col: number; selectedChars: number; totalLines: number } | null>(null);
  const blurTimerRef = useRef<number | null>(null);
  useEffect(() => {
    const clearBlurTimer = (): void => {
      if (blurTimerRef.current !== null) {
        window.clearTimeout(blurTimerRef.current);
        blurTimerRef.current = null;
      }
    };
    const onSel = (e: Event): void => {
      const ce = e as CustomEvent<{ line: number; col: number; selectedChars: number; totalLines: number }>;
      if (!ce.detail) return;
      clearBlurTimer();
      setSelection(ce.detail);
    };
    const onFocus = (): void => { clearBlurTimer(); };
    const onBlur = (): void => {
      clearBlurTimer();
      blurTimerRef.current = window.setTimeout(() => {
        setSelection(null);
        blurTimerRef.current = null;
      }, 10000);
    };
    window.addEventListener('undrcod:editor-selection', onSel);
    window.addEventListener('undrcod:editor-focus', onFocus);
    window.addEventListener('undrcod:editor-blur', onBlur);
    return () => {
      window.removeEventListener('undrcod:editor-selection', onSel);
      window.removeEventListener('undrcod:editor-focus', onFocus);
      window.removeEventListener('undrcod:editor-blur', onBlur);
      clearBlurTimer();
    };
  }, []);

  // ====== File metadata (Indent · Encoding · LineEnding · Language) ======
  // Listen `undrcod:editor-metadata` que MonacoEditor dispatcha onMount + onDidChangeModel.
  const [meta, setMeta] = useState<{
    language: string;
    indentType: 'spaces' | 'tabs';
    indentSize: number;
    lineEnding: 'LF' | 'CRLF';
    encoding: string;
  } | null>(null);
  useEffect(() => {
    const onMeta = (e: Event): void => {
      const ce = e as CustomEvent<{
        language: string;
        indentType: 'spaces' | 'tabs';
        indentSize: number;
        lineEnding: 'LF' | 'CRLF';
        encoding: string;
      }>;
      if (!ce.detail) return;
      setMeta(ce.detail);
    };
    window.addEventListener('undrcod:editor-metadata', onMeta);
    return () => window.removeEventListener('undrcod:editor-metadata', onMeta);
  }, []);

  const handleIndentClick = (): void => {
    const answer = window.prompt('Indent (ex: "spaces 2", "spaces 4", "tabs"):', meta?.indentType === 'spaces' ? `spaces ${meta.indentSize}` : 'tabs');
    if (!answer) return;
    const lower = answer.trim().toLowerCase();
    if (lower.startsWith('tab')) {
      window.dispatchEvent(new CustomEvent('undrcod:set-indent', { detail: { indentType: 'tabs', indentSize: meta?.indentSize ?? 4 } }));
      return;
    }
    const match = lower.match(/(\d+)/);
    const size = match ? parseInt(match[1], 10) : 2;
    window.dispatchEvent(new CustomEvent('undrcod:set-indent', { detail: { indentType: 'spaces', indentSize: size } }));
  };

  const handleLineEndingClick = (): void => {
    const answer = window.prompt('Line ending (LF ou CRLF):', meta?.lineEnding ?? 'LF');
    if (!answer) return;
    const target = answer.trim().toUpperCase() === 'CRLF' ? 'CRLF' : 'LF';
    window.dispatchEvent(new CustomEvent('undrcod:set-line-ending', { detail: { lineEnding: target } }));
  };

  const handleLanguageClick = (): void => {
    const answer = window.prompt('Linguagem (typescript, javascript, python, go, rust, json, html, css, markdown...):', meta?.language ?? '');
    if (!answer?.trim()) return;
    window.dispatchEvent(new CustomEvent('undrcod:set-language', { detail: { language: answer.trim().toLowerCase() } }));
  };

  const handleEncodingClick = (): void => {
    toast.info('Apenas UTF-8 suportado nesta versão');
  };

  const handleProblemsClick = (): void => {
    // Dispara evento que App escuta pra abrir BottomPanel tab Problems
    window.dispatchEvent(new CustomEvent('undrcod:focus-problems'));
  };

  // ====== Notification bell (canto direito) ======
  // Lê log do módulo Toast via subscribe; abre dropdown ao clicar.
  const [notifications, setNotifications] = useState<NotificationEntry[]>(() => getNotificationLog());
  const [unreadCount, setUnreadCount] = useState<number>(() => getUnreadNotificationCount());
  const [bellOpen, setBellOpen] = useState<boolean>(false);
  const bellRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const refresh = (): void => {
      setNotifications(getNotificationLog());
      setUnreadCount(getUnreadNotificationCount());
    };
    const off = subscribeNotifications(refresh);
    refresh();
    return off;
  }, []);

  // Outside-click + Esc fecha dropdown
  useEffect(() => {
    if (!bellOpen) return;
    const onDocClick = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (dropdownRef.current?.contains(target)) return;
      if (bellRef.current?.contains(target)) return;
      setBellOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setBellOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [bellOpen]);

  const handleBellClick = (): void => {
    const next = !bellOpen;
    setBellOpen(next);
    if (next && unreadCount > 0) {
      // Abrir já marca como lidas (visualizou).
      markAllNotificationsRead();
    }
  };

  const formatRelativeTime = (ts: number): string => {
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 5) return 'agora';
    if (diffSec < 60) return `${diffSec}s atrás`;
    const m = Math.floor(diffSec / 60);
    if (m < 60) return `${m}min atrás`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h atrás`;
    const d = Math.floor(h / 24);
    return `${d}d atrás`;
  };

  const renderNotificationIcon = (level: NotificationEntry['level']): ReactElement => {
    const props = { size: 14, strokeWidth: 2 } as const;
    switch (level) {
      case 'info': return <Info {...props} />;
      case 'success': return <CheckCircle2 {...props} />;
      case 'warn': return <AlertTriangle {...props} />;
      case 'error': return <XCircle {...props} />;
    }
  };
  // ============================================

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <span className="statusbar-item statusbar-cwd" title={cwd}>
          <Folder {...SB_ICON} /> {cwdShort}
        </span>
        {branch && (
          <button
            type="button"
            className="statusbar-item statusbar-branch"
            title={`Branch ${branch.name}${branch.ahead || branch.behind ? ` · ↑${branch.ahead} ↓${branch.behind}` : ''} (click pra trocar)`}
            onClick={openBranchMenu}
          >
            <GitBranch {...SB_ICON} /> {branch.name}
            {(branch.ahead > 0 || branch.behind > 0) && (
              <span className="statusbar-branch-ab">
                {branch.ahead > 0 && <>↑{branch.ahead}</>}
                {branch.behind > 0 && <>↓{branch.behind}</>}
              </span>
            )}
          </button>
        )}
        {dirtyCount > 0 && (
          <button
            type="button"
            className="statusbar-item statusbar-dirty"
            title={`${dirtyCount} arquivo(s) não-salvo(s) — click pra salvar todos`}
            onClick={() => window.dispatchEvent(new CustomEvent('undrcod:save-all'))}
          >
            <Save {...SB_ICON} /> {dirtyCount} unsaved
          </button>
        )}
        {problems && (problems.errors > 0 || problems.warnings > 0) && (
          <button
            type="button"
            className="statusbar-item statusbar-problems"
            title={`${problems.errors} erro${problems.errors === 1 ? '' : 's'} · ${problems.warnings} aviso${problems.warnings === 1 ? '' : 's'} (click pra abrir Problems)`}
            onClick={handleProblemsClick}
          >
            <CircleX {...SB_ICON} /> {problems.errors}
            <TriangleAlert {...SB_ICON} /> {problems.warnings}
          </button>
        )}
        {info.sessionId && (
          <span className="statusbar-item statusbar-session" title={info.sessionId}>
            <Play {...SB_ICON} /> {sessionShort}
          </span>
        )}
        {info.turns !== undefined && info.turns > 0 && (
          <span className="statusbar-item">
            <MessagesSquare {...SB_ICON} /> {info.turns} turn{info.turns === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="statusbar-right">
        {info.permissionMode === 'plan' && (
          <span className="statusbar-item statusbar-mode-badge" title="Plan Mode ativo">
            <ListOrdered {...SB_ICON} /> plan
          </span>
        )}
        {info.permissionMode === 'acceptEdits' && (
          <span className="statusbar-item statusbar-mode-badge" title="Aceitar edições automaticamente">
            <CheckCheck {...SB_ICON} /> accept
          </span>
        )}
        {info.hasMemory && (
          <span className="statusbar-item" title="UNDERCODE.md / CLAUDE.md carregado">
            <Book {...SB_ICON} /> mem
          </span>
        )}
        {/* model + lastUsage tokens removidos do statusbar — informação fica no composer (model badge) */}
        {showMem && mem && (
          <span
            className="statusbar-item statusbar-mem"
            title={`RAM ${mem.rssMb} MB · CPU ${mem.cpuPercent}% · ${mem.processes} process${mem.processes === 1 ? '' : 'es'}`}
          >
            <Activity {...SB_ICON} /> {mem.rssMb}MB · CPU {mem.cpuPercent}%
          </span>
        )}
        {info.totalCostUsd !== undefined && info.totalCostUsd > 0 && (
          <span
            className="statusbar-item statusbar-cost"
            title="custo total acumulado (USD) desde início da sessão"
          >
            ${info.totalCostUsd.toFixed(4)}
          </span>
        )}
        {selection && (
          <span
            className="statusbar-item statusbar-selection"
            title={`${selection.totalLines} linhas no total`}
          >
            Ln {selection.line}, Col {selection.col}
            {selection.selectedChars > 0 && (
              <> · {selection.selectedChars} sel</>
            )}
          </span>
        )}
        {meta && (
          <>
            <button
              type="button"
              className="statusbar-item statusbar-meta-btn"
              title="Indent — click pra trocar"
              onClick={handleIndentClick}
            >
              {meta.indentType === 'spaces' ? `Spaces: ${meta.indentSize}` : `Tabs: ${meta.indentSize}`}
            </button>
            <button
              type="button"
              className="statusbar-item statusbar-meta-btn"
              title="Encoding — apenas UTF-8 suportado"
              onClick={handleEncodingClick}
            >
              {meta.encoding}
            </button>
            <button
              type="button"
              className="statusbar-item statusbar-meta-btn"
              title="Line ending — click pra trocar"
              onClick={handleLineEndingClick}
            >
              {meta.lineEnding}
            </button>
            <button
              type="button"
              className="statusbar-item statusbar-meta-btn statusbar-language"
              title="Language mode — click pra trocar"
              onClick={handleLanguageClick}
            >
              {meta.language}
            </button>
          </>
        )}
        <span className={`statusbar-dot ${info.busy ? 'is-busy' : 'is-idle'}`} title={info.busy ? 'trabalhando' : 'ocioso'} />
        <button
          ref={bellRef}
          type="button"
          className={`statusbar-bell${bellOpen ? ' is-open' : ''}${unreadCount > 0 ? ' has-unread' : ''}`}
          title={unreadCount > 0 ? `${unreadCount} notificação(ões) não lida(s)` : 'Notificações'}
          onClick={handleBellClick}
          aria-label="Notificações"
          aria-expanded={bellOpen}
          aria-haspopup="dialog"
        >
          <Bell {...SB_ICON} />
          {unreadCount > 0 && (
            <span className="bell-badge" aria-hidden="true">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        {bellOpen && (
          <div ref={dropdownRef} className="statusbar-bell-dropdown" role="dialog" aria-label="Notificações">
            <div className="bell-dropdown-header">
              <span className="bell-dropdown-title">Notificações</span>
              <div className="bell-dropdown-actions">
                <button
                  type="button"
                  className="bell-dropdown-action"
                  onClick={() => markAllNotificationsRead()}
                  disabled={unreadCount === 0}
                  title="Marcar todas como lidas"
                >
                  Marcar lidas
                </button>
                <button
                  type="button"
                  className="bell-dropdown-action"
                  onClick={() => clearNotifications()}
                  disabled={notifications.length === 0}
                  title="Limpar todas"
                >
                  Limpar
                </button>
              </div>
            </div>
            <div className="bell-dropdown-list">
              {notifications.length === 0 ? (
                <div className="bell-dropdown-empty">Nenhuma notificação</div>
              ) : (
                notifications.slice(0, 20).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className={`bell-entry bell-entry--${n.level}${n.read ? '' : ' is-unread'}`}
                    onClick={() => markNotificationRead(n.id)}
                  >
                    <span className={`bell-entry-icon bell-entry-icon--${n.level}`}>
                      {renderNotificationIcon(n.level)}
                    </span>
                    <span className="bell-entry-body">
                      <span className="bell-entry-text">{n.text}</span>
                      {n.sub && <span className="bell-entry-sub">{n.sub}</span>}
                      <span className="bell-entry-time">{formatRelativeTime(n.ts)}</span>
                    </span>
                    <span
                      className="bell-entry-dismiss"
                      role="button"
                      aria-label="Remover notificação"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeNotification(n.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation();
                          e.preventDefault();
                          removeNotification(n.id);
                        }
                      }}
                    >
                      <X size={11} strokeWidth={2} />
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <ContextMenu
        open={branchMenuPos !== null}
        x={branchMenuPos?.x ?? 0}
        y={branchMenuPos?.y ?? 0}
        items={branchMenuItems()}
        onClose={() => setBranchMenuPos(null)}
      />
    </div>
  );
}
