import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatView } from './components/ChatView/ChatView';
import { ChatSessionTabs, type ChatSessionTab } from './components/ChatSessionTabs/ChatSessionTabs';
import { FileTree } from './components/FileTree/FileTree';
import { FilePreview } from './components/FilePreview/FilePreview';
import { Logo } from './components/Logo/Logo';
import { StatusBar, type SessionInfo } from './components/StatusBar/StatusBar';
import { RightPane, type RightTab, type RightTabId } from './components/RightPane/RightPane';
import { TranscriptView, type TranscriptMode, type TranscriptFontSize } from './components/TranscriptView/TranscriptView';
import { ComposerPopover, type PopoverItem } from './components/ChatView/ComposerPopover';
import { Splitter } from './components/Splitter/Splitter';
import { CustomizeLayout } from './components/CustomizeLayout/CustomizeLayout';
import { PreviewView } from './components/PreviewView/PreviewView';
import { PreviewViewV2 } from './components/PreviewView/PreviewViewV2';
import { PreviewViewV3 } from './components/PreviewView/PreviewViewV3';
import { CentralTabs, type CentralTab, type CentralViewId } from './components/CentralTabs/CentralTabs';
import { CentralViewContent } from './components/CentralTabs/CentralViewContent';
import { FileCompareView } from './components/FileCompareView/FileCompareView';
import { WorkspacesPanel } from './components/WorkspacesPanel/WorkspacesPanel';
import { BottomPanel, type BottomTabId } from './components/BottomPanel/BottomPanel';
import { DiffViewer, type DiffViewerHandle } from './components/DiffViewer/DiffViewer';
import { computeDiffBetweenStrings } from './components/DiffViewer/diffParser';
import { useHunkKeyboard, type HunkNavigable } from './hooks/useHunkKeyboard';
import { Palette, type PaletteMode } from './components/Palette/Palette';
import { useAuthStatus, buildAuthMenuItems } from './components/Auth/AuthStatus';
import { SettingsModal } from './components/SettingsModal/SettingsModal';
import { McpManager } from './components/McpManager/McpManager';
import { PluginMarketplace } from './components/PluginMarketplace/PluginMarketplace';
import { CustomizationTabs } from './components/CustomizationTabs/CustomizationTabs';
import { ConfirmDialogHost, confirmDialog } from './components/ConfirmDialog/ConfirmDialog';
import { ShortcutsDialog } from './components/ShortcutsDialog/ShortcutsDialog';
import { SnippetsManager } from './components/Snippets/SnippetsManager';
import { HistoryPanel } from './components/HistoryPanel/HistoryPanel';
import { ReviewChanges, type ReviewEdit } from './components/ReviewChanges/ReviewChanges';
import { RecentActivity } from './components/RecentActivity/RecentActivity';
import { SymbolOutline } from './components/SymbolOutline/SymbolOutline';
import { OutlineSection } from './components/OutlineSection/OutlineSection';
import { TimelineSection } from './components/TimelineSection/TimelineSection';
import { CheckpointPanel } from './components/CheckpointPanel/CheckpointPanel';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu/ContextMenu';
import { ToastHost, toast } from './components/Toast/Toast';
import { DevServerBanner } from './components/DevServerBanner/DevServerBanner';
import { SourceControl } from './components/SourceControl/SourceControl';
import { SearchPanel } from './components/SearchPanel/SearchPanel';
import { CommitDialog } from './components/CommitDialog/CommitDialog';
import { WelcomeView } from './components/WelcomeView/WelcomeView';
import { Onboarding, hasCompletedTour, resetTour } from './components/Onboarding/Onboarding';
import { GlobalTooltip } from './components/Tooltip';
import './components/Tooltip/Tooltip.css';
import { pushRecent } from './utils/recentFiles';
import { saveWorkspaceState, loadWorkspaceState, clearWorkspaceState, type PersistedTab } from './utils/workspaceState';
import type { Theme } from '../shared/settings-types';

function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    // Optional chaining em TUDO — preload pode estar em race no boot.
    const w = window.akaiAPI?.window;
    if (!w) return;
    w.isMaximized?.().then(setMaximized);
    const off = w.onMaximizedChange?.(setMaximized);
    return off;
  }, []);
  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-control"
        onClick={() => window.akaiAPI?.window?.minimize?.()}
        title="Minimizar"
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button
        type="button"
        className="window-control"
        onClick={() => window.akaiAPI?.window?.maximize?.()}
        title={maximized ? 'Restaurar' : 'Maximizar'}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="1.5" y="2.5" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
            <rect x="2.5" y="1.5" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="window-control window-control-close"
        onClick={() => window.akaiAPI?.window?.close?.()}
        title="Fechar"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1" />
          <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}

export function App() {
  const [cwd, setCwd] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [sessionInfo, setSessionInfo] = useState<SessionInfo>({});
  const [chatPrefill, setChatPrefill] = useState<string | null>(null);
  // Session pra retomar (do WorkspacesPanel). Sempre limpa após ChatView usar.
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);

  // Multi-session tabs no pane-right (ChatView). agent-manager.ts já suporta N sessions
  // paralelas — aqui guardamos a lista de tabs e qual é a ativa. Cada tab `id` é o
  // sessionId real (do agent.createSession ou de uma session salva sendo retomada).
  // Persistido em localStorage por cwd (key `undrcode.chatSessions.<cwd>`).
  const [chatSessions, setChatSessions] = useState<ChatSessionTab[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);

  // Tabs centrais (pane-mid): arquivos abertos + views não-terminal (Tarefas, Plano, etc).
  const [centralTabs, setCentralTabs] = useState<CentralTab[]>([]);
  const [activeCentralTabId, setActiveCentralTabId] = useState<string | null>(null);
  // Refs sincronizados — usado pelo file watcher pra evitar stale closure.
  const centralTabsRef = useRef<CentralTab[]>([]);
  const activeCentralTabIdRef = useRef<string | null>(null);
  useEffect(() => { centralTabsRef.current = centralTabs; }, [centralTabs]);
  useEffect(() => { activeCentralTabIdRef.current = activeCentralTabId; }, [activeCentralTabId]);

  // Auto-save config — declarado cedo pq o wrapper de setActiveCentralTabId precisa.
  const [autoSaveMode, setAutoSaveMode] = useState<'off' | 'afterDelay' | 'onFocusChange'>('off');
  const [autoSaveDelay, setAutoSaveDelay] = useState<number>(1500);
  const autoSaveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Wrapper de setActiveCentralTabId — antes de mudar de tab, se autoSave=onFocusChange e
  // o arquivo atual tá dirty, salva ele. Mantém comportamento idêntico em outros modos.
  const setActiveCentralTabIdWithAutoSave = useCallback((next: string | null) => {
    setActiveCentralTabId((prev) => {
      // Captura modo/dirty no momento da chamada (sem stale closure pq leitura via getter de state)
      if (prev !== next && prev) {
        setDirtyContents((dirty) => {
          const activeTab = centralTabs.find((t) => t.id === prev);
          if (activeTab?.kind === 'file' && dirty.has(activeTab.path) && autoSaveMode === 'onFocusChange') {
            const content = dirty.get(activeTab.path)!;
            void window.akaiAPI?.fs.writeFile(activeTab.path, content).then((res) => {
              if ('ok' in res) {
                setDirtyContents((p) => {
                  if (!p.has(activeTab.path)) return p;
                  const m = new Map(p);
                  m.delete(activeTab.path);
                  return m;
                });
              }
            });
          }
          return dirty;
        });
      }
      return next;
    });
  }, [centralTabs, autoSaveMode]);

  // Dirty state pra arquivos editados no Monaco — path → conteúdo não-salvo.
  // Quando salvar via Ctrl+S, remove do map e escreve no disco.
  const [dirtyContents, setDirtyContents] = useState<Map<string, string>>(() => new Map());
  const dirtyContentsRef = useRef<Map<string, string>>(new Map());
  useEffect(() => { dirtyContentsRef.current = dirtyContents; }, [dirtyContents]);
  // Cooldown de toast por path — evita flood de "atualizado externamente"
  // durante HMR / builds que escrevem o mesmo arquivo várias vezes/seg.
  const toastCooldownRef = useRef<Map<string, number>>(new Map());

  // Crash recovery — se ErrorBoundary salvou `undrcode.lastError` no localStorage
  // recentemente (< 1min), mostra toast warn pra o usuário saber que houve crash.
  // Depois remove pra não repetir em boots futuros.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('undrcode.lastError');
      if (!raw) return;
      const parsed = JSON.parse(raw) as { message?: string; stack?: string; componentStack?: string; ts?: number };
      const ts = typeof parsed?.ts === 'number' ? parsed.ts : 0;
      if (ts && Date.now() - ts < 60_000) {
        toast.warn('App recuperou de um crash', { sub: parsed.message ?? 'Erro desconhecido', ttl: 10000 });
      }
      localStorage.removeItem('undrcode.lastError');
    } catch {
      // JSON inválido ou localStorage bloqueado — limpa silenciosamente
      try { localStorage.removeItem('undrcode.lastError'); } catch { /* ignore */ }
    }
  }, []);

  // Auto-save config (state declarado acima — modos: off / afterDelay / onFocusChange).
  // Aqui só o hydrate inicial via electron-store + listener de mudanças.
  useEffect(() => {
    const api = window.akaiAPI?.settings;
    if (!api) return;
    api.get?.('autoSave').then((v) => {
      if (v === 'off' || v === 'afterDelay' || v === 'onFocusChange') setAutoSaveMode(v);
    }).catch(() => { /* ignore */ });
    api.get?.('autoSaveDelay').then((v) => {
      if (typeof v === 'number' && Number.isFinite(v)) setAutoSaveDelay(Math.max(250, Math.min(30_000, v)));
    }).catch(() => { /* ignore */ });
    const off = api.onChanged?.((key, value) => {
      if (key === 'autoSave' && (value === 'off' || value === 'afterDelay' || value === 'onFocusChange')) {
        setAutoSaveMode(value);
      }
      if (key === 'autoSaveDelay' && typeof value === 'number') {
        setAutoSaveDelay(Math.max(250, Math.min(30_000, value)));
      }
    });
    return () => { if (off) off(); };
  }, []);

  const handleContentChange = useCallback((path: string, newContent: string) => {
    setDirtyContents((prev) => {
      const next = new Map(prev);
      next.set(path, newContent);
      return next;
    });
    // Modo afterDelay: agenda save após autoSaveDelay ms. Cada nova edição reseta o timer.
    if (autoSaveMode === 'afterDelay') {
      const timers = autoSaveTimersRef.current;
      const existing = timers.get(path);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        timers.delete(path);
        // Lê do dirtyContents no momento — sem stale closure usar setDirtyContents getter pattern
        setDirtyContents((current) => {
          const dirty = current.get(path);
          if (dirty !== undefined) {
            void window.akaiAPI?.fs.writeFile(path, dirty).then((res) => {
              if ('ok' in res) {
                setDirtyContents((prev) => {
                  if (!prev.has(path)) return prev;
                  const next = new Map(prev);
                  next.delete(path);
                  return next;
                });
              }
            });
          }
          return current;
        });
      }, autoSaveDelay);
      timers.set(path, t);
    }
  }, [autoSaveMode, autoSaveDelay]);

  // Cleanup timers no unmount
  useEffect(() => {
    return () => {
      const timers = autoSaveTimersRef.current;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const handleSave = useCallback(async (path: string, newContent: string) => {
    const result = await window.akaiAPI?.fs.writeFile(path, newContent);
    if ('error' in result) {
      // eslint-disable-next-line no-console
      console.error('[akai] save failed:', path, result.error);
      toast.error('Falha ao salvar', { sub: result.error });
      return;
    }
    setDirtyContents((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Map(prev);
      next.delete(path);
      return next;
    });
    const filename = path.split(/[\\/]/).filter(Boolean).pop() || path;
    toast.success(`${filename} salvo`);
  }, []);

  // Listener pra 'akai:save-all' — disparado pelo StatusBar (click no badge dirty)
  // pra salvar todos os arquivos com edições não-persistidas de uma vez.
  useEffect(() => {
    const saveAll = (): void => {
      for (const [path, content] of dirtyContents.entries()) {
        void handleSave(path, content);
      }
    };
    window.addEventListener('akai:save-all', saveAll);
    return () => window.removeEventListener('akai:save-all', saveAll);
  }, [dirtyContents, handleSave]);

  // === Navigation history stack (Back/Forward) ===
  // Igual browser: cada abertura de arquivo empilha em `navHistory`. Botões
  // Alt+← / Alt+→ ou os arrows no topbar percorrem a lista.
  // navIndex aponta pra posição atual; `navigatingRef` evita re-push quando
  // a navegação foi feita pelo back/forward (vs uma abertura nova).
  const [navHistory, setNavHistory] = useState<string[]>([]);
  const [navIndex, setNavIndex] = useState(-1);
  const navigatingRef = useRef(false);

  // Chord state pro atalho Ctrl+K S (Save As). 0 = nenhum chord ativo;
  // timestamp = Ctrl+K foi pressionado, esperando a segunda tecla por 1500ms.
  const ctrlKChordRef = useRef<number>(0);

  const canGoBack = navIndex > 0;
  const canGoForward = navIndex >= 0 && navIndex < navHistory.length - 1;

  const navigateBack = useCallback(() => {
    if (!canGoBack) return;
    const newIdx = navIndex - 1;
    const target = navHistory[newIdx];
    if (!target) return;
    navigatingRef.current = true;
    setNavIndex(newIdx);
    // Reabre o tab pelo path. openFileTab será chamado mas o ref ignora o push.
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    openFileTab(target);
  }, [canGoBack, navIndex, navHistory]);

  const navigateForward = useCallback(() => {
    if (!canGoForward) return;
    const newIdx = navIndex + 1;
    const target = navHistory[newIdx];
    if (!target) return;
    navigatingRef.current = true;
    setNavIndex(newIdx);
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    openFileTab(target);
  }, [canGoForward, navIndex, navHistory]);

  // Helpers pra manipular central tabs.
  // gotoLine opcional — usado pra abrir arquivo a partir de grep result (Ctrl+Shift+F).
  // Atualiza gotoLine mesmo se o tab já existe (re-navega no Monaco em vez de scroll-to-top).
  const openFileTab = useCallback((
    path: string,
    gotoLine?: number,
    matchStart?: number,
    matchEnd?: number,
  ) => {
    pushRecent(path); // registra no localStorage pra QuickOpen "Recentes"
    // Push no navigation history — só se NÃO veio de back/forward.
    if (!navigatingRef.current) {
      setNavHistory((prev) => {
        // Trunca histórico além do índice atual (igual browser)
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        const trimmed = prev.slice(0, navIndex + 1);
        // Evita push duplicado consecutivo
        if (trimmed[trimmed.length - 1] === path) return prev;
        const next = [...trimmed, path];
        // Cap em 50 entries pra não vazar memória
        const capped = next.length > 50 ? next.slice(next.length - 50) : next;
        setNavIndex(capped.length - 1);
        return capped;
      });
    } else {
      navigatingRef.current = false;
    }
    setCentralTabs((prev) => {
      const existing = prev.find((t) => t.kind === 'file' && t.path === path);
      if (existing) {
        setActiveCentralTabId(existing.id);
        if (gotoLine !== undefined) {
          return prev.map((t) =>
            t.id === existing.id && t.kind === 'file'
              ? { ...t, gotoLine, matchStart, matchEnd }
              : t,
          );
        }
        return prev;
      }
      const id = `file:${path}`;
      setActiveCentralTabId(id);
      return [...prev, { id, kind: 'file', path, gotoLine, matchStart, matchEnd }];
    });
  }, []);

  const openViewTab = useCallback((viewId: CentralViewId, title: string, icon: string) => {
    setCentralTabs((prev) => {
      const id = `view:${viewId}`;
      const existing = prev.find((t) => t.id === id);
      if (existing) {
        setActiveCentralTabId(id);
        return prev;
      }
      setActiveCentralTabId(id);
      return [...prev, { id, kind: 'view', viewId, title, icon }];
    });
  }, []);

  /** Abre tab de comparação entre 2 arquivos. Reusa se já tiver mesmo par. */
  const openCompareTab = useCallback((leftPath: string, rightPath: string) => {
    if (leftPath === rightPath) {
      toast.warn('Selecione 2 arquivos diferentes pra comparar');
      return;
    }
    const id = `compare:${leftPath}::${rightPath}`;
    setCentralTabs((prev) => {
      const existing = prev.find((t) => t.id === id);
      if (existing) {
        setActiveCentralTabId(id);
        return prev;
      }
      setActiveCentralTabId(id);
      return [...prev, { id, kind: 'compare', leftPath, rightPath }];
    });
  }, []);

  /** Pega selection + monta prompt skeleton "Sobre o trecho abaixo:\n<code>\n\n" */
  const handleAskAboutSelection = useCallback(() => {
    const active = centralTabsRef.current.find((t) => t.id === activeCentralTabIdRef.current);
    if (!active || active.kind !== 'file') {
      toast.info('Abra um arquivo e selecione um trecho primeiro');
      return;
    }
    const onResult = (ev: Event): void => {
      window.removeEventListener('akai:editor-selection-result', onResult);
      const text = ((ev as CustomEvent<{ text: string }>).detail?.text || '').trim();
      if (!text) {
        toast.info('Selecione um trecho de código primeiro');
        return;
      }
      let relPath = active.path;
      if (cwd && relPath.toLowerCase().startsWith(cwd.toLowerCase())) {
        relPath = relPath.slice(cwd.length).replace(/^[\\/]+/, '');
      }
      relPath = relPath.replace(/\\/g, '/');
      const ext = relPath.split('.').pop()?.toLowerCase() || '';
      const lang = ext === 'tsx' || ext === 'ts' ? 'tsx'
        : ext === 'jsx' || ext === 'js' ? 'jsx'
        : ext === 'css' || ext === 'scss' ? 'css'
        : ext === 'html' ? 'html'
        : ext === 'json' ? 'json'
        : ext === 'md' ? 'markdown'
        : ext === 'py' ? 'python'
        : ext === 'rs' ? 'rust'
        : ext === 'go' ? 'go'
        : '';
      setChatPaneOpen(true);
      const block = `Sobre este trecho de \`${relPath}\`:\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
      setChatPrefill(block);
      setTimeout(() => setChatPrefill(null), 0);
      toast.info('Pronto pra perguntar — digite sua dúvida no chat');
    };
    window.addEventListener('akai:editor-selection-result', onResult);
    window.dispatchEvent(new CustomEvent('akai:editor-get-selection'));
    setTimeout(() => window.removeEventListener('akai:editor-selection-result', onResult), 500);
  }, [cwd]);

  /** Envia seleção do editor ativo pro chat como code block. */
  const handleAddSelectionToChat = useCallback(() => {
    const active = centralTabsRef.current.find((t) => t.id === activeCentralTabIdRef.current);
    if (!active || active.kind !== 'file') {
      toast.info('Abra um arquivo e selecione um trecho primeiro');
      return;
    }
    const onResult = (ev: Event): void => {
      window.removeEventListener('akai:editor-selection-result', onResult);
      const text = ((ev as CustomEvent<{ text: string }>).detail?.text || '').trim();
      if (!text) {
        toast.info('Selecione um trecho de código primeiro');
        return;
      }
      let relPath = active.path;
      if (cwd && relPath.toLowerCase().startsWith(cwd.toLowerCase())) {
        relPath = relPath.slice(cwd.length).replace(/^[\\/]+/, '');
      }
      relPath = relPath.replace(/\\/g, '/');
      const ext = relPath.split('.').pop()?.toLowerCase() || '';
      const lang = ext === 'tsx' || ext === 'ts' ? 'tsx'
        : ext === 'jsx' || ext === 'js' ? 'jsx'
        : ext === 'css' || ext === 'scss' ? 'css'
        : ext === 'html' ? 'html'
        : ext === 'json' ? 'json'
        : ext === 'md' ? 'markdown'
        : ext === 'py' ? 'python'
        : ext === 'rs' ? 'rust'
        : ext === 'go' ? 'go'
        : '';
      // setChatPaneOpen(true) é idempotente — abre se fechado, no-op se já aberto.
      setChatPaneOpen(true);
      const block = `\`\`\`${lang} ${relPath}\n${text}\n\`\`\`\n\n`;
      setChatPrefill(block);
      setTimeout(() => setChatPrefill(null), 0);
      toast.success(`Selection enviada pro chat (${relPath})`);
    };
    window.addEventListener('akai:editor-selection-result', onResult);
    window.dispatchEvent(new CustomEvent('akai:editor-get-selection'));
    setTimeout(() => window.removeEventListener('akai:editor-selection-result', onResult), 500);
  }, [cwd]);

  /** Abre 2 file pickers em sequência e cria compare tab. */
  const handleCompareFiles = useCallback(async () => {
    const api = window.akaiAPI?.dialog;
    if (!api) return;
    const first = await api.openFiles();
    if (first.canceled || !('paths' in first) || first.paths.length === 0) return;
    const firstPath = first.paths[0];
    toast.info(`Selecione o segundo arquivo pra comparar com ${firstPath.split(/[\\/]/).pop()}`);
    const second = await api.openFiles();
    if (second.canceled || !('paths' in second) || second.paths.length === 0) return;
    openCompareTab(firstPath, second.paths[0]);
  }, [openCompareTab]);

  // Stack de tabs recentemente fechadas — pra Ctrl+Shift+T reabrir.
  // Limit 20 entries. Persistido in-memory por sessão (resetado em workspace switch).
  const closedTabsStackRef = useRef<Array<{ path: string; viewId?: CentralViewId; title?: string; icon?: string; kind: 'file' | 'view' }>>([]);

  const closeCentralTab = useCallback((id: string) => {
    setCentralTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const tab = prev[idx];
      // Salva no stack pra Ctrl+Shift+T reabrir (limit 20). Compare tabs
      // não vão pro stack — efêmeras, não fazem sentido restaurar.
      const stack = closedTabsStackRef.current;
      if (tab.kind === 'file') {
        stack.push({ path: tab.path, kind: 'file' });
        if (stack.length > 20) stack.shift();
      } else if (tab.kind === 'view') {
        stack.push({ kind: 'view', viewId: tab.viewId, title: tab.title, icon: tab.icon, path: '' });
        if (stack.length > 20) stack.shift();
      }

      const next = prev.filter((t) => t.id !== id);
      // Se era arquivo, descarta dirty state (caller já deu confirm() se preciso).
      if (tab.kind === 'file') {
        setDirtyContents((prevDirty) => {
          if (!prevDirty.has(tab.path)) return prevDirty;
          const nextDirty = new Map(prevDirty);
          nextDirty.delete(tab.path);
          return nextDirty;
        });
      }
      // Se fechou a ativa, seleciona vizinha
      if (id === activeCentralTabId) {
        if (next.length === 0) setActiveCentralTabId(null);
        else setActiveCentralTabId(next[Math.max(0, idx - 1)].id);
      }
      return next;
    });
  }, [activeCentralTabId]);

  // Reabre o último tab fechado (Ctrl+Shift+T).
  const reopenLastClosedTab = useCallback(() => {
    const stack = closedTabsStackRef.current;
    const last = stack.pop();
    if (!last) return;
    if (last.kind === 'file') {
      openFileTab(last.path);
    } else if (last.viewId && last.title && last.icon) {
      openViewTab(last.viewId, last.title, last.icon);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFileTab, openViewTab]);

  // Arquivo atualmente exibido (compat com handlers existentes)
  const openedFile = (() => {
    const active = centralTabs.find((t) => t.id === activeCentralTabId);
    return active?.kind === 'file' ? active.path : null;
  })();

  // === New File (Ctrl+N) ===
  // Prompt nome → cria vazio no cwd → abre tab. Falha gracefull se cwd null.
  const handleNewFile = useCallback(async () => {
    if (!cwd) {
      toast.error('Sem workspace aberto');
      return;
    }
    const name = window.prompt('Nome do novo arquivo:', 'untitled.txt');
    const trimmed = name?.trim();
    if (!trimmed) return;
    // Usa separador nativo do cwd pra evitar mismatch Win/POSIX.
    const sep = cwd.includes('\\') ? '\\' : '/';
    const target = `${cwd.replace(/[\\/]$/, '')}${sep}${trimmed.replace(/[\\/]+/g, sep)}`;
    const r = await window.akaiAPI?.fs.createFile(target);
    if ('error' in r) {
      toast.error('Falha ao criar arquivo', { sub: r.error });
      return;
    }
    toast.success('Arquivo criado');
    openFileTab(target);
    window.dispatchEvent(new CustomEvent('akai:tree-refresh', { detail: { dir: cwd } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, openFileTab]);

  // === Save As (Ctrl+K S) ===
  // Dialog nativo → escreve content novo path → fecha tab antigo, abre novo.
  // Usa content dirty se houver, senão lê do disco.
  const handleSaveAs = useCallback(async () => {
    const active = centralTabs.find((t) => t.id === activeCentralTabId);
    if (!active || active.kind !== 'file') {
      toast.error('Nenhum arquivo ativo pra "Salvar como"');
      return;
    }
    const sourcePath = active.path;
    const filename = sourcePath.split(/[\\/]/).pop() || 'untitled.txt';
    const defaultDir = sourcePath.replace(/[\\/][^\\/]*$/, '') || cwd || undefined;

    // Conteúdo: dirty se houver, senão lê do disco.
    let content = dirtyContents.get(sourcePath);
    if (content === undefined) {
      const readRes = await window.akaiAPI?.fs.readFile(sourcePath);
      if ('error' in readRes) {
        toast.error('Falha ao ler arquivo', { sub: readRes.error });
        return;
      }
      content = readRes.content;
    }

    const dlg = await window.akaiAPI?.dialog.saveFile(filename, defaultDir);
    if (dlg.canceled === true) return;
    const target = dlg.path;
    if (target === sourcePath) {
      // Mesmo path → comporta como Save normal.
      void handleSave(sourcePath, content);
      return;
    }
    const writeRes = await window.akaiAPI?.fs.writeFile(target, content);
    if ('error' in writeRes) {
      toast.error('Falha ao salvar', { sub: writeRes.error });
      return;
    }
    // Limpa dirty do source (não persistido lá, mas user escolheu novo path).
    setDirtyContents((prev) => {
      if (!prev.has(sourcePath)) return prev;
      const next = new Map(prev);
      next.delete(sourcePath);
      return next;
    });
    // Fecha tab antigo e abre novo path.
    closeCentralTab(active.id);
    openFileTab(target);
    if (cwd) {
      window.dispatchEvent(new CustomEvent('akai:tree-refresh', { detail: { dir: cwd } }));
    }
    const tgtName = target.split(/[\\/]/).pop() || target;
    toast.success(`Salvo como ${tgtName}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCentralTabId, centralTabs, dirtyContents, cwd, handleSave, closeCentralTab, openFileTab]);

  // === Reveal Active File in Explorer ===
  const handleRevealActiveFile = useCallback(() => {
    if (!openedFile) {
      toast.error('Nenhum arquivo ativo');
      return;
    }
    void window.akaiAPI?.fs.revealInOs(openedFile);
  }, [openedFile]);

  // Right pane state
  // NOTA: Removemos 'diff' e 'terminal' do RightPane pra evitar duplicação.
  //   - Diff agora vive no Monaco/DiffViewer (acessível por comando/atalho)
  //   - Terminal vive exclusivamente no BottomPanel (Ctrl+`)
  // Tab 'files' renomeada pra 'Histórico' (icon comment-discussion) — sempre foi
  // o WorkspacesPanel com sessões salvas, não a árvore de arquivos. O nome
  // "Arquivos" colidia com o FileTree do left pane e confundia o usuário.
  const ALL_RIGHT_TABS: RightTab[] = [
    { id: 'preview', title: 'Ver prévia', icon: 'play' },
    { id: 'files', title: 'Histórico', icon: 'comment-discussion' },
    { id: 'tasks', title: 'Tarefas', icon: 'tasklist' },
    { id: 'plan', title: 'Plano', icon: 'list-ordered' },
  ];
  // Bottom Panel agora tem 5 tabs fixas (Problems/Output/Debug Console/Terminal/Ports).
  // Só precisa rastrear qual está ativa.
  const [activeBottomTab, setActiveBottomTab] = useState<BottomTabId>('terminal');

  // FileTree sidebar visibility (Ctrl+B toggle)
  const [leftPaneOpen, setLeftPaneOpen] = useState(true);
  const [primarySidebarTab, setPrimarySidebarTab] = useState<'files' | 'search' | 'git'>('files');
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);

  // Eventos do StatusBar — click em branch/problems badge muda foco do app
  useEffect(() => {
    const focusGit = (): void => {
      setLeftPaneOpen(true);
      setPrimarySidebarTab('git');
    };
    const focusProblems = (): void => {
      setBottomPanelOpen(true);
      setActiveBottomTab('problems');
    };
    window.addEventListener('akai:focus-source-control', focusGit);
    window.addEventListener('akai:focus-problems', focusProblems);

    // "Mais opções" — abre menu suspenso ancorado no botão chevron da sidebar
    const openMoreMenu = (ev: Event): void => {
      const detail = (ev as CustomEvent<{ x: number; y: number }>).detail;
      if (!detail) return;
      setMoreMenuPos({ x: detail.x, y: detail.y });
    };
    window.addEventListener('akai:open-more-menu', openMoreMenu);

    return () => {
      window.removeEventListener('akai:focus-source-control', focusGit);
      window.removeEventListener('akai:focus-problems', focusProblems);
      window.removeEventListener('akai:open-more-menu', openMoreMenu);
    };
  }, []);

  // Onboarding tour — abre automático na primeira vez (sem flag undr.tour.completed).
  // Re-trigger via comando "Refazer tour" do commandRegistry (event akai:reopen-tour).
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  useEffect(() => {
    if (!hasCompletedTour()) {
      // Pequeno delay pra UI montar antes (mais bonito que abrir de cara)
      const t = setTimeout(() => setOnboardingOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, []);
  useEffect(() => {
    const reopen = (): void => {
      resetTour();
      setOnboardingOpen(true);
    };
    window.addEventListener('akai:reopen-tour', reopen);
    return () => window.removeEventListener('akai:reopen-tour', reopen);
  }, []);

  // ChatView (Secondary Side Bar) visibility (Ctrl+Alt+B toggle)
  const [chatPaneOpen, setChatPaneOpen] = useState(true);

  // Bottom Panel visibility (Ctrl+J toggle) — hospeda Tarefas/Terminal/Arquivos/etc
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  // Bottom Panel maximized? — quando true, ocupa quase a viewport inteira
  const [bottomPanelMaximized, setBottomPanelMaximized] = useState(false);

  // Customize Layout modal
  const [customizeLayoutOpen, setCustomizeLayoutOpen] = useState(false);

  // Settings modal
  const [settingsOpen, setSettingsOpen] = useState(false);

  // McpManager modal
  const [mcpManagerOpen, setMcpManagerOpen] = useState(false);

  // PluginMarketplace modal
  const [pluginMarketplaceOpen, setPluginMarketplaceOpen] = useState(false);

  // CustomizationTabs modal — inventário do .claude/ (rules/workflows/skills/hooks/mcp)
  const [customizationOpen, setCustomizationOpen] = useState(false);

  // ShortcutsDialog modal (Ctrl+/)
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // SnippetsManager modal — edita prompts pré-salvos do Ctrl+; do composer
  const [snippetsManagerOpen, setSnippetsManagerOpen] = useState(false);

  // HistoryPanel modal — histórico de conversas do workspace atual (Ctrl+Shift+H)
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);

  // ReviewChanges modal — view consolidada de TODOS os edits do turn (Ctrl+Shift+Enter).
  // Estado fica no parent pq o atalho é global e o conjunto de edits é alimentado
  // pelo mesmo event `akai:pending-changes` que a PendingChangesTab (BottomPanel) usa.
  // pendingReviewEdits: merge por path (substitui se mesmo arquivo proposto 2x).
  const [reviewChangesOpen, setReviewChangesOpen] = useState(false);
  const [pendingReviewEdits, setPendingReviewEdits] = useState<ReviewEdit[]>([]);

  // RecentActivity modal — arquivos abertos recentemente (Ctrl+E)
  const [recentActivityOpen, setRecentActivityOpen] = useState(false);

  // Workspaces recentes cacheados pra popular submenu de "Open Recent" sem
  // async no momento do click. Reload sob demanda quando File menu abre.
  const [recentWorkspaces, setRecentWorkspaces] = useState<Array<{ path: string; lastUsed: string }>>([]);

  const refreshRecentWorkspaces = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).akaiAPI?.claude;
    if (!api?.listKnownWorkspaces) return;
    api.listKnownWorkspaces().then((list: Array<{ path: string; sessionCount: number; lastUsed: string }>) => {
      const sorted = [...list].sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime());
      setRecentWorkspaces(sorted.slice(0, 8));
    }).catch(() => { /* ignore */ });
  }, []);

  useEffect(() => { refreshRecentWorkspaces(); }, [refreshRecentWorkspaces]);

  // SymbolOutline modal — outline de símbolos do arquivo central ativo (Ctrl+Shift+O)
  const [symbolOutlineOpen, setSymbolOutlineOpen] = useState(false);

  // CheckpointPanel modal — snapshots dos arquivos antes de cada agent turn
  const [checkpointPanelOpen, setCheckpointPanelOpen] = useState(false);

  // "Mais opções" menu — dropdown ancorado no botão chevron da sidebar
  const [moreMenuPos, setMoreMenuPos] = useState<{ x: number; y: number } | null>(null);

  // CommandPalette + QuickOpen (Ctrl+Shift+P + Ctrl+P)
  const [paletteMode, setPaletteMode] = useState<PaletteMode | null>(null);

  // DiffViewer overlay (Monaco DiffEditor + Alt+J/K hunk navigation)
  const [diffViewerData, setDiffViewerData] = useState<{ filePath: string; hunks: Array<{ header: string; lines: Array<{ type: '+' | '-' | ' '; text: string }> }> } | null>(null);
  // Erro inline mostrado dentro do DiffViewer (ex: git apply falhou). null = sem erro.
  const [diffError, setDiffError] = useState<string | null>(null);
  const diffViewerRef = useRef<DiffViewerHandle>(null);
  useHunkKeyboard({
    diffViewerRef: diffViewerRef as React.RefObject<HunkNavigable | null>,
    enabled: diffViewerData !== null,
  });

  // Helper pra fechar o overlay limpando erro residual junto.
  const closeDiffViewer = useCallback(() => {
    setDiffViewerData(null);
    setDiffError(null);
  }, []);

  /**
   * Accept de UM hunk — v1: working tree já tem a mudança, então só remove
   * o hunk do state local pra avançar a UI. Não toca staging area (v2:
   * `git apply --cached` pra stage o hunk).
   */
  const handleHunkAccept = useCallback(async (hunkIndex: number) => {
    if (!diffViewerData) return;
    setDiffError(null);
    setDiffViewerData((prev) => {
      if (!prev) return prev;
      const nextHunks = prev.hunks.filter((_, i) => i !== hunkIndex);
      if (nextHunks.length === 0) {
        setDiffError(null);
        return null; // fecha o modal
      }
      return { ...prev, hunks: nextHunks };
    });
  }, [diffViewerData]);

  /**
   * Reject de UM hunk — usa o novo IPC `applyHunkByIndex` que re-roda
   * `git diff HEAD -- <file>` no main process e fatia o N-ésimo hunk
   * byte-for-byte do output bruto do git, evitando bugs de roundtrip
   * (CRLF/BOM) no nosso parser de DiffLine[]. Em sucesso, remove do
   * state local (UI otimista — não re-fetch). Em erro, banner inline.
   */
  // Busy guard pra evitar dupla execução (sintoma "2 cliques pra fechar").
  const rejectInFlightRef = useRef(false);
  const handleHunkReject = useCallback(async (hunkIndex: number) => {
    if (!diffViewerData || !cwd) return;
    if (rejectInFlightRef.current) return;
    rejectInFlightRef.current = true;
    setDiffError(null);
    try {
      const git = window.akaiAPI?.git as
        | { applyHunkByIndex?: (cwd: string, file: string, idx: number, reject: boolean) => Promise<{ error?: string; ok?: true }> }
        | undefined;
      const fn = git?.applyHunkByIndex;
      if (typeof fn !== 'function') {
        setDiffError('git.applyHunkByIndex IPC not available');
        return;
      }
      const result = await fn(cwd, diffViewerData.filePath, hunkIndex, true);
      if ('error' in result) {
        setDiffError(`Reject falhou: ${result.error}`);
        return;
      }
      setDiffViewerData((prev) => {
        if (!prev) return prev;
        // Defensivo: hunkIndex fora dos bounds (race) → no-op.
        if (hunkIndex < 0 || hunkIndex >= prev.hunks.length) return prev;
        const nextHunks = prev.hunks.filter((_, i) => i !== hunkIndex);
        if (nextHunks.length === 0) {
          setDiffError(null);
          return null;
        }
        return { ...prev, hunks: nextHunks };
      });
    } finally {
      rejectInFlightRef.current = false;
    }
  }, [diffViewerData, cwd]);

  /**
   * Reject all (file) — `git checkout HEAD -- <file>`. Confirmação destrutiva
   * já foi dada dentro do DiffViewer (via confirmDialog) antes de chegar aqui.
   */
  const handleRejectAll = useCallback(async () => {
    if (!diffViewerData || !cwd) return;
    setDiffError(null);
    const git = window.akaiAPI?.git as
      | { checkoutFile?: (cwd: string, file: string) => Promise<{ error?: string; ok?: true }> }
      | undefined;
    const checkoutFn = git?.checkoutFile;
    if (typeof checkoutFn !== 'function') {
      setDiffError('git.checkoutFile IPC not available');
      return;
    }
    const result = await checkoutFn(cwd, diffViewerData.filePath);
    if ('error' in result) {
      setDiffError(`Checkout falhou: ${result.error}`);
      return;
    }
    closeDiffViewer();
  }, [diffViewerData, cwd, closeDiffViewer]);

  const openGitDiff = useCallback(async () => {
    if (!cwd) return;
    try {
      const result = await window.akaiAPI?.git.diff(cwd);
      if (!result.files || result.files.length === 0) {
        // sem diffs — open empty state pra mostrar feedback
        setDiffViewerData({ filePath: '(no changes)', hunks: [] });
        return;
      }
      // v1: pega primeiro file; TODO: file picker
      const first = result.files[0];
      setDiffViewerData({ filePath: first.path, hunks: first.hunks });
    } catch (err) {
      console.error('git diff failed:', err);
    }
  }, [cwd]);

  // Auth status do Claude CLI (lê ~/.claude/.credentials.json, ou ANTHROPIC_API_KEY)
  const auth = useAuthStatus();

  // Listeners de CustomEvents disparados por outros components:
  // - 'akai:open-file' (MCP config, etc) → abre arquivo no FilePreview central
  // - 'akai:send-to-agent' (BottomPanel Problems / FileTree AI actions) → injeta texto no chat
  // - 'akai:search-in' (FileTree "Buscar nesta pasta") → abre busca filtrada por pasta
  // - 'akai:open-terminal' (FileTree "Abrir terminal aqui") → ativa Bottom Panel terminal tab
  // - 'akai:set-workspace' (FileTree "Definir como workspace") → troca cwd
  // - 'akai:diff-files' (FileTree "Comparar com...") → abre diff entre 2 arquivos
  useEffect(() => {
    function onOpenFile(e: Event) {
      const path = (e as CustomEvent<string>).detail;
      if (typeof path === 'string' && path) openFileTab(path);
    }
    function onSendToAgent(e: Event) {
      const text = (e as CustomEvent<string>).detail;
      if (typeof text === 'string' && text) {
        setChatPrefill(text);
        setTimeout(() => setChatPrefill(null), 0);
      }
    }
    function onSearchIn(e: Event) {
      const detail = (e as CustomEvent<{ dir: string }>).detail;
      if (!detail?.dir) return;
      // Abre o SearchPanel + pré-popula includeGlob com o dir (relativo ao cwd).
      setLeftPaneOpen(true);
      setPrimarySidebarTab('search');
      // Calcula path relativo pra usar como filtro include glob.
      const sep = cwd && cwd.includes('\\') ? '\\' : '/';
      let rel = detail.dir;
      if (cwd && rel.startsWith(cwd)) {
        rel = rel.slice(cwd.length).replace(/\\/g, '/');
        if (rel.startsWith('/')) rel = rel.slice(1);
      } else {
        rel = rel.replace(/\\/g, '/');
      }
      void sep;
      // Dispatcha evento com include glob = "dirRel/**" (pega tudo dentro).
      const includeGlob = rel ? `${rel}/**` : '';
      window.dispatchEvent(
        new CustomEvent('akai:set-search-filter', { detail: { includeGlob } }),
      );
    }
    function onOpenTerminal(e: Event) {
      const detail = (e as CustomEvent<{ cwd: string }>).detail;
      if (!detail?.cwd) return;
      // Abre Bottom Panel + ativa tab Terminal. O terminal usa o cwd do workspace
      // (não o detail.cwd) porque TerminalView só rebinda em mudança de cwd prop.
      // User pode mandar `cd <path>` manualmente — log mostra o path desejado.
      // eslint-disable-next-line no-console
      console.info('[akai:open-terminal] cd', detail.cwd);
      setBottomPanelOpen(true);
      setActiveBottomTab('terminal');
    }
    function onSetWorkspace(e: Event) {
      const detail = (e as CustomEvent<{ cwd: string }>).detail;
      if (!detail?.cwd) return;
      setCwd(detail.cwd);
      setSessionInfo({});
      setCentralTabs([]);
      setActiveCentralTabId(null);
    }
    function onDiffFiles(e: Event) {
      const detail = (e as CustomEvent<{ left: string; right: string | null }>).detail;
      if (!detail?.left || !detail.right) return;
      const leftPath = detail.left;
      const rightPath = detail.right;
      Promise.all([
        window.akaiAPI?.fs.readFile(leftPath),
        window.akaiAPI?.fs.readFile(rightPath),
      ])
        .then(([l, r]) => {
          if ('error' in l) {
            toast.error(`Falha ao ler ${leftPath}: ${l.error}`);
            return;
          }
          if ('error' in r) {
            toast.error(`Falha ao ler ${rightPath}: ${r.error}`);
            return;
          }
          // computeDiffBetweenStrings só emite ' ' | '+' | '-' (nunca '\\'),
          // então o cast pro tipo do state (sem '\\') é seguro.
          const hunks = computeDiffBetweenStrings(l.content, r.content) as Array<{
            header: string;
            lines: Array<{ type: '+' | '-' | ' '; text: string }>;
          }>;
          // basename agnóstico (suporta / e \)
          const baseL = leftPath.split(/[\\/]/).pop() ?? leftPath;
          const baseR = rightPath.split(/[\\/]/).pop() ?? rightPath;
          setDiffViewerData({
            filePath: `${baseL} ↔ ${baseR}`,
            hunks,
          });
        })
        .catch((err) => {
          toast.error(`Erro ao comparar arquivos: ${(err as Error).message}`);
        });
    }
    function onCloneRepo(e: Event) {
      const detail = (e as CustomEvent<{ url: string; folderName: string }>).detail;
      if (!detail?.url || !detail.folderName) return;
      // Abre Bottom Panel terminal + dispara `git clone <url> <folder>` no PTY.
      // O usuário acompanha o output. Quando terminar, pode usar "Definir como workspace"
      // no FileTree pra abrir a pasta clonada.
      setBottomPanelOpen(true);
      setActiveBottomTab('terminal');
      // Pequeno delay pra garantir que TerminalView montou antes do run-task chegar.
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('akai:run-task', {
          detail: { script: `git clone ${detail.url} ${detail.folderName}` },
        }));
      }, 200);
    }
    // 'akai:goto-line' — dispatch do SymbolOutline (Ctrl+Shift+O) e similares.
    // Atualiza o tab existente com gotoLine pra Monaco re-navegar, ou abre novo tab.
    function onGotoLine(e: Event) {
      const detail = (e as CustomEvent<{ path: string; line: number }>).detail;
      if (!detail?.path || !detail.line) return;
      openFileTab(detail.path, detail.line);
    }
    // 'akai:diff-vs-branch' — SourceControl "vs main": flata multi-file num único
    // DiffViewer, anotando cada hunk com prefixo do path no header pra user identificar.
    function onDiffVsBranch(e: Event) {
      const detail = (e as CustomEvent<{
        branch: string;
        files: Array<{
          path: string;
          hunks: Array<{ header: string; lines: Array<{ type: '+' | '-' | ' '; text: string }> }>;
        }>;
      }>).detail;
      if (!detail) return;
      const { branch, files } = detail;
      if (!files || files.length === 0) {
        setDiffViewerData({ filePath: `(no changes vs ${branch})`, hunks: [] });
        return;
      }
      // Achata todos os hunks; reescreve cada header pra incluir o path do file
      // (formato: "@@ ... @@ [path/to/file]"). DiffViewer só renderiza o header como string.
      const flatHunks = files.flatMap((f) =>
        f.hunks.map((h) => ({
          header: `${h.header}  ◆ ${f.path}`,
          lines: h.lines,
        })),
      );
      const totalHunks = flatHunks.length;
      setDiffViewerData({
        filePath: `vs ${branch} — ${files.length} file(s), ${totalHunks} hunk(s)`,
        hunks: flatHunks,
      });
    }
    window.addEventListener('akai:open-file', onOpenFile);
    window.addEventListener('akai:send-to-agent', onSendToAgent);
    window.addEventListener('akai:search-in', onSearchIn);
    window.addEventListener('akai:open-terminal', onOpenTerminal);
    window.addEventListener('akai:set-workspace', onSetWorkspace);
    window.addEventListener('akai:diff-files', onDiffFiles);
    window.addEventListener('akai:clone-repo', onCloneRepo);
    window.addEventListener('akai:goto-line', onGotoLine);
    window.addEventListener('akai:diff-vs-branch', onDiffVsBranch);
    return () => {
      window.removeEventListener('akai:open-file', onOpenFile);
      window.removeEventListener('akai:send-to-agent', onSendToAgent);
      window.removeEventListener('akai:search-in', onSearchIn);
      window.removeEventListener('akai:open-terminal', onOpenTerminal);
      window.removeEventListener('akai:set-workspace', onSetWorkspace);
      window.removeEventListener('akai:diff-files', onDiffFiles);
      window.removeEventListener('akai:clone-repo', onCloneRepo);
      window.removeEventListener('akai:goto-line', onGotoLine);
      window.removeEventListener('akai:diff-vs-branch', onDiffVsBranch);
    };
    // openFileTab/setters são estáveis (useState/useCallback) — não precisa nas deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listener pro event `akai:pending-changes` — alimenta a fila do modal ReviewChanges.
  // Mesmo event que a PendingChangesTab (BottomPanel) consome, então as duas views
  // ficam sempre em sync. Merge por path (substitui se mesmo arquivo proposto 2x).
  // O broadcast `akai:pending-changes-total` é emitido aqui pra reconciliar o badge
  // da tab quando edits são aceitos/rejeitados via modal.
  useEffect(() => {
    function onPending(ev: Event): void {
      const detail = (ev as CustomEvent).detail;
      if (!detail || !Array.isArray(detail.files)) return;
      setPendingReviewEdits((prev) => {
        const map = new Map(prev.map((f) => [f.path, f]));
        for (const f of detail.files as ReviewEdit[]) {
          map.set(f.path, f);
        }
        return Array.from(map.values());
      });
    }
    window.addEventListener('akai:pending-changes', onPending);
    return () => window.removeEventListener('akai:pending-changes', onPending);
  }, []);

  // Broadcast total sempre que pendingReviewEdits muda — mantém o badge da tab
  // do BottomPanel em sync quando user aceita/rejeita pelo modal.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('akai:pending-changes-total', { detail: { total: pendingReviewEdits.length } }),
    );
  }, [pendingReviewEdits.length]);

  // Handlers do ReviewChanges (memoizados pra não recriar em cada render).
  const handleReviewAccept = useCallback(async (path: string) => {
    const edit = pendingReviewEdits.find((e) => e.path === path);
    if (!edit) return;
    try {
      const res = await window.akaiAPI?.fs.writeFile(edit.path, edit.newContent);
      if (res && typeof res === 'object' && 'error' in res) {
        toast.error('Falha ao aplicar', { sub: (res as { error: string }).error });
        return;
      }
      setPendingReviewEdits((prev) => prev.filter((e) => e.path !== path));
      const fname = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
      toast.success(`${fname} aplicado`);
    } catch (err) {
      toast.error('Falha ao aplicar', { sub: (err as Error).message });
    }
  }, [pendingReviewEdits]);

  const handleReviewReject = useCallback((path: string) => {
    const fname = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
    setPendingReviewEdits((prev) => prev.filter((e) => e.path !== path));
    toast.info(`${fname} rejeitado`);
  }, []);

  const handleReviewAcceptAll = useCallback(async () => {
    const snapshot = pendingReviewEdits.slice();
    if (snapshot.length === 0) return;
    let okCount = 0;
    let failCount = 0;
    for (const f of snapshot) {
      try {
        const res = await window.akaiAPI?.fs.writeFile(f.path, f.newContent);
        if (res && typeof res === 'object' && 'error' in res) failCount += 1;
        else okCount += 1;
      } catch {
        failCount += 1;
      }
    }
    setPendingReviewEdits([]);
    setReviewChangesOpen(false);
    if (failCount === 0) toast.success(`${okCount} arquivo(s) aplicado(s)`);
    else toast.warn(`${okCount} aplicado(s), ${failCount} falharam`);
  }, [pendingReviewEdits]);

  const handleReviewRejectAll = useCallback(() => {
    const n = pendingReviewEdits.length;
    setPendingReviewEdits([]);
    setReviewChangesOpen(false);
    if (n > 0) toast.info(`${n} alteração(ões) rejeitada(s)`);
  }, [pendingReviewEdits.length]);

  // Listener pra comandos vindos do binário `undrcode` CLI (via named pipe / UDS
  // → main process → preload `cli.onCommand`). Suporta:
  //   - open <path>    → abre arquivo (ou workspace se for pasta)
  //   - goto path:L:C  → abre arquivo no Monaco e navega pra linha
  //   - diff a b       → dispatcha akai:diff-files
  useEffect(() => {
    if (!window.akaiAPI?.cli) return;
    const off = window.akaiAPI?.cli.onCommand(async (cmd) => {
      try {
        if (cmd.kind === 'open' && cmd.path) {
          // Tenta detectar se é pasta — se for, trata como workspace
          const st = await window.akaiAPI?.fs.stat(cmd.path);
          if ('error' in st) {
            toast.error(`CLI: não consegui abrir ${cmd.path}: ${st.error}`);
            return;
          }
          if (st.isDirectory) {
            setCwd(cmd.path);
            setSessionInfo({});
            setCentralTabs([]);
            setActiveCentralTabId(null);
          } else {
            openFileTab(cmd.path);
          }
        } else if (cmd.kind === 'goto' && cmd.path) {
          openFileTab(cmd.path, cmd.line);
        } else if (cmd.kind === 'diff' && cmd.left && cmd.right) {
          window.dispatchEvent(
            new CustomEvent('akai:diff-files', {
              detail: { left: cmd.left, right: cmd.right },
            }),
          );
        }
      } catch (err) {
        console.error('[cli:command] handler error:', err);
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listener pra 'akai:apply-code-block' (botão "Aplicar" nos code blocks do ChatView).
  // Decide automaticamente entre:
  //   1) Substituir conteúdo do tab ativo (se houver file aberto) — entra no dirtyContents
  //      pra user ver no Monaco antes de salvar (Ctrl+S).
  //   2) Criar arquivo novo via prompt nativo de path relativo ao workspace (cwd).
  useEffect(() => {
    // Mapeia Prism language id → extensão default. Usado pra (a) sugerir extensão
    // no prompt de "novo arquivo" e (b) checar se a linguagem do bloco bate com a do tab.
    const LANG_TO_EXT: Record<string, string> = {
      typescript: 'ts', tsx: 'tsx', javascript: 'js', jsx: 'jsx',
      python: 'py', rust: 'rs', go: 'go', markup: 'html', css: 'css',
      scss: 'scss', json: 'json', markdown: 'md', yaml: 'yml',
      toml: 'toml', bash: 'sh', sql: 'sql',
    };

    async function onApplyCodeBlock(e: Event) {
      const detail = (e as CustomEvent<{ code: string; lang: string; langHint: string }>).detail;
      if (!detail?.code) return;
      const { code, lang, langHint } = detail;

      // Resolve tab ativo via getter pattern (evita stale closure sem precisar de refs).
      let activeFile: { path: string; ext: string } | null = null;
      setCentralTabs((tabs) => {
        setActiveCentralTabId((id) => {
          const t = tabs.find((x) => x.id === id);
          if (t?.kind === 'file') {
            const ext = (t.path.split('.').pop() || '').toLowerCase();
            activeFile = { path: t.path, ext };
          }
          return id;
        });
        return tabs;
      });

      // Caminho 1: tab ativo é arquivo → propõe substituir.
      if (activeFile) {
        const af = activeFile as { path: string; ext: string };
        const filename = af.path.split(/[\\/]/).pop() || af.path;
        const expectedExt = LANG_TO_EXT[lang] || langHint;
        const langMatches = !expectedExt || af.ext === expectedExt
          || (expectedExt === 'ts' && af.ext === 'tsx')
          || (expectedExt === 'js' && af.ext === 'jsx');

        const msg = langMatches
          ? `Substituir o conteúdo de ${filename} pelo código do bloco?\n\nA edição entra como "dirty" — salve com Ctrl+S pra gravar no disco.`
          : `O bloco é "${langHint || lang}" mas o arquivo aberto é .${af.ext}.\n\nSubstituir mesmo assim ${filename}?`;

        const ok = await confirmDialog({
          title: 'Aplicar no arquivo aberto',
          message: msg,
          confirmLabel: 'Substituir',
        });
        if (!ok) return;

        // Entra no dirtyContents — Monaco/FilePreview re-renderiza com o novo conteúdo.
        setDirtyContents((prev) => {
          const next = new Map(prev);
          next.set(af.path, code);
          return next;
        });
        toast.success(`Aplicado em ${filename}`, { sub: 'Ctrl+S pra salvar' });
        return;
      }

      // Caminho 2: sem tab ativo → cria arquivo novo via prompt nativo (path relativo ao cwd).
      const ext = LANG_TO_EXT[lang] || langHint || 'txt';
      const suggested = `novo.${ext}`;
      const rel = window.prompt(
        `Salvar bloco como (path relativo ao workspace):\n\n${cwd}`,
        suggested,
      );
      if (!rel) return;
      const trimmed = rel.trim().replace(/^[\\/]+/, '');
      if (!trimmed) return;
      const sep = cwd.includes('\\') ? '\\' : '/';
      const target = `${cwd.replace(/[\\/]$/, '')}${sep}${trimmed.replace(/\//g, sep)}`;
      const res = await window.akaiAPI?.fs.createFile(target, code);
      if ('error' in res) {
        toast.error('Falha ao criar arquivo', { sub: res.error });
        return;
      }
      openFileTab(target);
      window.dispatchEvent(new CustomEvent('akai:tree-refresh', { detail: { dir: cwd } }));
      toast.success(`Criado ${trimmed}`);
    }

    window.addEventListener('akai:apply-code-block', onApplyCodeBlock);
    return () => window.removeEventListener('akai:apply-code-block', onApplyCodeBlock);
    // openFileTab/setters são estáveis; cwd é a única dep relevante.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  // Preview (modo Lovable) — webview do dev server
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>(() => {
    try { return localStorage.getItem('undrcode.previewUrl') || ''; } catch { return ''; }
  });
  useEffect(() => {
    try {
      if (previewUrl) localStorage.setItem('undrcode.previewUrl', previewUrl);
    } catch { /* ignore */ }
  }, [previewUrl]);

  // Listener pro DevServerBanner — quando user clica "Abrir" no banner,
  // dispara CustomEvent `akai:open-preview` { url }. Aqui setamos url +
  // abrimos o preview pane.
  useEffect(() => {
    function handler(e: Event) {
      const ce = e as CustomEvent<{ url?: string }>;
      const url = ce.detail?.url;
      if (url) setPreviewUrl(url);
      setPreviewOpen(true);
    }
    window.addEventListener('akai:open-preview', handler as EventListener);
    return () => window.removeEventListener('akai:open-preview', handler as EventListener);
  }, []);

  // Sincroniza previewUrl com a tab ativa: quando o preview tá aberto e o user
  // troca de tab no CentralTabs, se a tab for arquivo renderizável (html/svg/
  // pdf/img/md), atualiza previewUrl pro file:// daquele arquivo. Assim cada
  // tab "abre" automaticamente o seu próprio preview sem precisar clicar em
  // "Abrir no preview" de novo.
  useEffect(() => {
    if (!previewOpen) return;
    const active = centralTabs.find((t) => t.id === activeCentralTabId);
    if (!active || active.kind !== 'file') return;
    const path = active.path;
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const renderable = new Set([
      'html', 'htm', 'svg', 'pdf',
      'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico',
      'md', 'markdown', 'txt', 'json', 'xml',
    ]);
    if (!renderable.has(ext)) return;
    // Converte path → file:// URL (Windows/Unix), encoda cada segment.
    const normalized = path.replace(/\\/g, '/');
    const driveMatch = normalized.match(/^([a-zA-Z]):\/(.*)$/);
    const fileUrl = driveMatch
      ? `file:///${driveMatch[1].toUpperCase()}:/${driveMatch[2].split('/').map((s) => encodeURIComponent(s)).join('/')}`
      : `file://${normalized.split('/').map((s) => s ? encodeURIComponent(s) : '').join('/')}`;
    setPreviewUrl(fileUrl);
  }, [activeCentralTabId, previewOpen, centralTabs]);

  // Modo Lovable: ao abrir preview, esconde FileTree e Bottom Panel pra dar
  // foco máximo ao preview + chat. Memoriza estado anterior pra restaurar.
  const layoutBeforePreviewRef = useRef<{ left: boolean; bottom: boolean } | null>(null);
  useEffect(() => {
    if (previewOpen) {
      // Salva estado atual antes de esconder
      layoutBeforePreviewRef.current = { left: leftPaneOpen, bottom: bottomPanelOpen };
      setLeftPaneOpen(false);
      setBottomPanelOpen(false);
    } else if (layoutBeforePreviewRef.current) {
      // Restaura estado anterior
      setLeftPaneOpen(layoutBeforePreviewRef.current.left);
      setBottomPanelOpen(layoutBeforePreviewRef.current.bottom);
      layoutBeforePreviewRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOpen]);
  const [bottomPanelHeight, setBottomPanelHeight] = useState<number>(() => {
    try {
      const v = localStorage.getItem('undrcode.bottomPanelHeight');
      return v ? Math.max(120, Math.min(600, parseInt(v, 10) || 240)) : 240;
    } catch { return 240; }
  });
  useEffect(() => {
    try { localStorage.setItem('undrcode.bottomPanelHeight', String(bottomPanelHeight)); } catch { /* ignore */ }
  }, [bottomPanelHeight]);

  // Widths dos panes (px). Persiste no localStorage.
  const [leftPaneWidth, setLeftPaneWidth] = useState<number>(() => {
    try {
      const v = localStorage.getItem('undrcode.leftPaneWidth');
      return v ? Math.max(180, Math.min(600, parseInt(v, 10) || 300)) : 300;
    } catch { return 300; }
  });
  const [chatPaneWidth, setChatPaneWidth] = useState<number>(() => {
    try {
      const v = localStorage.getItem('undrcode.chatPaneWidth');
      return v ? Math.max(320, Math.min(900, parseInt(v, 10) || 480)) : 480;
    } catch { return 480; }
  });

  // Persiste widths quando muda
  useEffect(() => {
    try { localStorage.setItem('undrcode.leftPaneWidth', String(leftPaneWidth)); } catch { /* ignore */ }
  }, [leftPaneWidth]);
  useEffect(() => {
    try { localStorage.setItem('undrcode.chatPaneWidth', String(chatPaneWidth)); } catch { /* ignore */ }
  }, [chatPaneWidth]);

  // System info — username pro account popover
  const [systemInfo, setSystemInfo] = useState<{ username: string; platform: string; homedir: string } | null>(null);
  useEffect(() => {
    // Defensivo: preload pode não estar carregado em race condition (HMR,
    // multi-entry build, etc). Optional chaining em TUDO pra evitar crash.
    const fn = window.akaiAPI?.getSystemInfo;
    if (typeof fn === 'function') {
      fn().then(setSystemInfo).catch(() => {/* ignore */});
    }
  }, []);

  // Theme — 3 opções (akai default, antigravity-dark, light). Persistido em
  // localStorage pra boot rápido + sync com electron-store via SettingsModal.
  // Shim de migração: valor legado 'dark' → 'akai'.
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('undrcode.theme');
      if (saved === 'akai' || saved === 'antigravity-dark' || saved === 'light') {
        return saved;
      }
      if (saved === 'dark') return 'akai'; // migration
      return 'akai';
    } catch {
      return 'akai';
    }
  });
  useEffect(() => {
    // Sempre aplica data-theme (todos os 3 valores são selectors válidos no CSS).
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('undrcode.theme', theme); } catch { /* ignore */ }
  }, [theme]);

  // Mapeamento pra boundary do MonacoEditor / DiffViewer / FilePreview
  // (esses componentes só conhecem 'dark' | 'light'). Light passa light;
  // akai e antigravity-dark mapeiam pra dark.
  const editorTheme: 'dark' | 'light' = theme === 'light' ? 'light' : 'dark';

  // Sync com electron-store: SettingsModal grava lá; aqui escutamos changes
  // pra refletir o tema mesmo quando o usuário troca via modal de configs.
  useEffect(() => {
    const api = window.akaiAPI?.settings;
    if (!api) return;
    // Hidrata do storage no boot (sobrepõe localStorage se diferente).
    api.get?.('theme').then((stored) => {
      if (
        stored === 'akai' ||
        stored === 'champagne' ||
        stored === 'antigravity-dark' ||
        stored === 'light'
      ) {
        setTheme(stored);
      } else if (stored === 'dark') {
        // Migration de instalações antigas — escreve de volta corrigido.
        setTheme('akai');
        api.set?.('theme', 'akai').catch(() => {/* ignore */});
      }
    }).catch(() => {/* ignore */});

    const offChanged = api.onChanged?.((key, value) => {
      if (key !== 'theme') return;
      if (value === 'akai' || value === 'antigravity-dark' || value === 'light') {
        setTheme(value);
      }
    });
    return () => { offChanged?.(); };
  }, []);

  // Transcript view state
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptMode, setTranscriptMode] = useState<TranscriptMode>('detailed');
  const [transcriptFontSize, setTranscriptFontSize] = useState<TranscriptFontSize>('md');
  const transcriptBtnRef = useRef<HTMLButtonElement>(null);

  // Topbar menus
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [viewsMenuOpen, setViewsMenuOpen] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [selectionMenuOpen, setSelectionMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [goMenuOpen, setGoMenuOpen] = useState(false);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [terminalMenuOpen, setTerminalMenuOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const accountBtnRef = useRef<HTMLButtonElement>(null);
  const viewsBtnRef = useRef<HTMLButtonElement>(null);
  const fileMenuBtnRef = useRef<HTMLButtonElement>(null);
  const editMenuBtnRef = useRef<HTMLButtonElement>(null);
  const selectionMenuBtnRef = useRef<HTMLButtonElement>(null);
  const viewMenuBtnRef = useRef<HTMLButtonElement>(null);
  const goMenuBtnRef = useRef<HTMLButtonElement>(null);
  const runMenuBtnRef = useRef<HTMLButtonElement>(null);
  const terminalMenuBtnRef = useRef<HTMLButtonElement>(null);
  const helpMenuBtnRef = useRef<HTMLButtonElement>(null);

  // Helpers pra popover Visualizações — checkmark se tab está visualmente aberta
  // Terminal → bottom panel aberto E tab Terminal ativa
  // Outros → tab central (presente em centralTabs)
  const isTabOpen = (id: RightTabId) => {
    if (id === 'terminal') {
      return bottomPanelOpen && activeBottomTab === 'terminal';
    }
    return centralTabs.some((t) => t.id === `view:${id}`);
  };

  // Menu "Visualizações" — EXCLUSIVO DO AGENTE DE IA.
  // Só o que NÃO tem outro lugar canônico na UI. Removido daqui:
  //   - Ver prévia     → botão dedicado no topbar
  //   - Terminal       → BottomPanel (Ctrl+`)
  //   - Diff           → Monaco/DiffViewer (contexto)
  //   - Plugins        → composer + (Plus popover)
  //   - Customizações  → composer + (Plus popover)
  const viewsMenuItems: PopoverItem[] = [
    {
      kind: 'item',
      icon: 'comment-discussion',
      label: 'Histórico de conversas',
      shortcut: '⇧ Ctrl F',
      selected: isTabOpen('files'),
      onClick: () => { handleToggleView('files'); setViewsMenuOpen(false); },
    },
    {
      kind: 'item',
      icon: 'list-ordered',
      label: 'Plano',
      selected: isTabOpen('plan'),
      onClick: () => { handleToggleView('plan'); setViewsMenuOpen(false); },
    },
    {
      kind: 'item',
      icon: 'tasklist',
      label: 'Tarefas em segundo plano',
      selected: isTabOpen('tasks'),
      onClick: () => { handleToggleView('tasks'); setViewsMenuOpen(false); },
    },
  ];

  // File menu items — só o que é implementável
  const fileMenuItems: PopoverItem[] = [
    {
      kind: 'item',
      icon: 'new-file',
      label: 'New File',
      shortcut: 'Ctrl N',
      onClick: () => { setFileMenuOpen(false); void handleNewFile(); },
    },
    {
      kind: 'item',
      icon: 'empty-window',
      label: 'New Window',
      shortcut: 'Ctrl Shift N',
      onClick: () => {
        setFileMenuOpen(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = (window as any).akaiAPI?.window;
        if (api?.openNew) {
          void api.openNew().then((r: { count: number }) => {
            toast.success(`Nova janela aberta (${r.count} no total)`);
          }).catch(() => toast.error('Falha ao abrir nova janela'));
        } else {
          toast.error('IPC indisponível — reinicie o app');
        }
      },
    },
    {
      // New Agents Window — abre Agent Manager em janela separada (Ctrl+Shift+M).
      // Espelha Cursor's "New Agents Window".
      kind: 'item',
      icon: 'comment-discussion',
      label: 'New Agents Window',
      shortcut: 'Ctrl Shift M',
      onClick: () => {
        setFileMenuOpen(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = (window as any).akaiAPI?.window;
        if (api?.openAgentManager) {
          void api.openAgentManager().then(() => toast.success('Agent Manager aberto'));
        }
      },
    },
    { kind: 'divider' },
    {
      // Open File — file picker pra arquivo único (igual Cursor Ctrl+O).
      kind: 'item',
      icon: 'go-to-file',
      label: 'Open File...',
      shortcut: 'Ctrl O',
      onClick: () => { setFileMenuOpen(false); void handleOpenFile(); },
    },
    {
      // Open Folder — folder picker (renamed de "Open Workspace").
      kind: 'item',
      icon: 'folder-opened',
      label: 'Open Folder...',
      shortcut: 'Ctrl K Ctrl O',
      onClick: () => { handleOpenWorkspace(); setFileMenuOpen(false); },
    },
    {
      // Submenu igual Cursor: Reopen Closed (Ctrl+Shift+T) + lista de
      // workspaces recentes inline + More... (modal completo) + Clear.
      kind: 'item',
      icon: 'history',
      label: 'Open Recent',
      submenu: [
        {
          kind: 'item',
          icon: 'multiple-windows',
          label: 'Reopen Closed Editor',
          shortcut: 'Ctrl Shift T',
          disabled: closedTabsStackRef.current.length === 0,
          onClick: () => { setFileMenuOpen(false); reopenLastClosedTab(); },
        },
        ...(recentWorkspaces.length > 0 ? [{ kind: 'divider' as const }] : []),
        ...recentWorkspaces.map((w): PopoverItem => ({
          kind: 'item',
          icon: 'folder',
          label: w.path.replace(/^([A-Z]:[\\/]Users[\\/][^\\/]+|\/Users\/[^/]+|\/home\/[^/]+)/i, '~'),
          onClick: () => {
            setFileMenuOpen(false);
            setCwd(w.path);
            setSessionInfo({});
            setCentralTabs([]);
            setActiveCentralTabId(null);
          },
        })),
        { kind: 'divider' },
        {
          kind: 'item',
          icon: 'ellipsis',
          label: 'More...',
          shortcut: 'Ctrl E',
          onClick: () => { setFileMenuOpen(false); setRecentActivityOpen(true); },
        },
        {
          kind: 'item',
          icon: 'clear-all',
          label: 'Clear Recently Opened...',
          onClick: () => {
            setFileMenuOpen(false);
            void confirmDialog({
              title: 'Limpar workspaces recentes?',
              message: 'Remove a lista de workspaces recentes do app. Não deleta os arquivos.',
              confirmLabel: 'Limpar',
              destructive: true,
            }).then((ok) => {
              if (!ok) return;
              // Limpa recents do localStorage E também o knownWorkspaces do main
              try { localStorage.removeItem('undr.recentFiles'); } catch { /* ignore */ }
              setRecentWorkspaces([]);
              toast.success('Lista de recentes limpa');
            });
          },
        },
      ],
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'save',
      label: 'Save',
      shortcut: 'Ctrl S',
      onClick: () => {
        setFileMenuOpen(false);
        const active = centralTabs.find((t) => t.id === activeCentralTabId);
        if (active?.kind === 'file') {
          const dirty = dirtyContents.get(active.path);
          if (dirty !== undefined) void handleSave(active.path, dirty);
        }
      },
    },
    {
      kind: 'item',
      icon: 'save-as',
      label: 'Save As...',
      shortcut: 'Ctrl K S',
      onClick: () => { setFileMenuOpen(false); void handleSaveAs(); },
    },
    {
      kind: 'item',
      icon: 'save-all',
      label: 'Save All',
      shortcut: 'Ctrl Shift S',
      onClick: () => {
        setFileMenuOpen(false);
        for (const [p, c] of dirtyContents.entries()) void handleSave(p, c);
      },
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'folder-active',
      label: 'Reveal Active File in Explorer',
      onClick: () => { setFileMenuOpen(false); handleRevealActiveFile(); },
    },
    { kind: 'divider' },
    {
      // Auto Save — toggle direto. Cicla off → afterDelay → onFocusChange → off.
      // Toast mostra o novo modo. Persiste via settings IPC.
      kind: 'item',
      icon: 'sync',
      label: `Auto Save: ${autoSaveMode === 'off' ? 'Off' : autoSaveMode === 'afterDelay' ? 'After Delay' : 'On Focus Change'}`,
      onClick: () => {
        setFileMenuOpen(false);
        const next = autoSaveMode === 'off' ? 'afterDelay' : autoSaveMode === 'afterDelay' ? 'onFocusChange' : 'off';
        setAutoSaveMode(next);
        window.akaiAPI?.settings?.set?.('autoSave', next).catch(() => { /* ignore */ });
        toast.success(`Auto Save: ${next === 'off' ? 'Off' : next === 'afterDelay' ? 'After Delay' : 'On Focus Change'}`);
      },
    },
    {
      // Preferences submenu — alinhado com Cursor (Settings/Extensions/Keyboard Shortcuts/
      // Configure Snippets/Themes ▸) + items próprios (MCP/Customizações Claude-specific).
      kind: 'item',
      icon: 'tools',
      label: 'Preferences',
      submenu: [
        { kind: 'item', icon: 'settings-gear', label: 'UNDRCode Settings', shortcut: 'Ctrl ,', onClick: () => { setFileMenuOpen(false); setSettingsOpen(true); } },
        { kind: 'item', icon: 'extensions', label: 'Extensions', shortcut: 'Ctrl Shift X', onClick: () => { setFileMenuOpen(false); setPluginMarketplaceOpen(true); } },
        { kind: 'item', icon: 'keyboard', label: 'Keyboard Shortcuts', shortcut: 'Ctrl /', onClick: () => { setFileMenuOpen(false); setShortcutsOpen(true); } },
        { kind: 'item', icon: 'symbol-snippet', label: 'Configure Snippets', shortcut: 'Ctrl ;', onClick: () => { setFileMenuOpen(false); setSnippetsManagerOpen(true); } },
        {
          // Themes submenu — picker explícito em vez de cycle. Checkmark no atual.
          kind: 'item',
          icon: 'color-mode',
          label: 'Themes',
          submenu: [
            {
              kind: 'item',
              icon: 'paintcan',
              label: theme === 'akai' ? '✓ Akai (default)' : 'Akai (default)',
              onClick: () => {
                setTheme('akai');
                window.akaiAPI?.settings?.set?.('theme', 'akai').catch(() => { /* ignore */ });
                setFileMenuOpen(false);
              },
            },
            {
              kind: 'item',
              icon: 'paintcan',
              label: theme === 'antigravity-dark' ? '✓ Antigravity Dark' : 'Antigravity Dark',
              onClick: () => {
                setTheme('antigravity-dark');
                window.akaiAPI?.settings?.set?.('theme', 'antigravity-dark').catch(() => { /* ignore */ });
                setFileMenuOpen(false);
              },
            },
            {
              kind: 'item',
              icon: 'paintcan',
              label: theme === 'light' ? '✓ Light' : 'Light',
              onClick: () => {
                setTheme('light');
                window.akaiAPI?.settings?.set?.('theme', 'light').catch(() => { /* ignore */ });
                setFileMenuOpen(false);
              },
            },
          ],
        },
        { kind: 'divider' },
        { kind: 'item', icon: 'plug', label: 'MCP Servers', onClick: () => { setFileMenuOpen(false); setMcpManagerOpen(true); } },
        { kind: 'item', icon: 'list-tree', label: 'Customizações do .claude/', onClick: () => { setFileMenuOpen(false); setCustomizationOpen(true); } },
      ],
    },
    { kind: 'divider' },
    {
      // Revert File — descarta mudanças não-salvas E recarrega do disco.
      kind: 'item',
      icon: 'discard',
      label: 'Revert File',
      onClick: () => {
        setFileMenuOpen(false);
        const active = centralTabs.find((t) => t.id === activeCentralTabId);
        if (!active || active.kind !== 'file') {
          toast.warn('Sem arquivo ativo');
          return;
        }
        if (!dirtyContents.has(active.path)) {
          toast.info('Nada pra reverter — arquivo já está sincronizado');
          return;
        }
        void confirmDialog({
          title: 'Reverter arquivo?',
          message: `Descartar mudanças não-salvas em "${active.path.split(/[\\/]/).pop()}" e recarregar do disco?`,
          confirmLabel: 'Reverter',
          destructive: true,
        }).then((ok) => {
          if (!ok) return;
          setDirtyContents((prev) => {
            const next = new Map(prev);
            next.delete(active.path);
            return next;
          });
          // Força re-load do arquivo no Monaco (key change re-monta)
          window.dispatchEvent(new CustomEvent('akai:revert-file', { detail: { path: active.path } }));
          toast.success('Arquivo revertido');
        });
      },
    },
    {
      // Close Editor — fecha o tab ativo (espelha Cursor Ctrl+F4).
      kind: 'item',
      icon: 'close',
      label: 'Close Editor',
      shortcut: 'Ctrl F4',
      onClick: () => { setFileMenuOpen(false); handleCloseEditor(); },
    },
    {
      // Close Folder — fecha workspace atual e volta pra Welcome view (sem cwd).
      kind: 'item',
      icon: 'folder',
      label: 'Close Folder',
      shortcut: 'Ctrl K F',
      onClick: () => {
        setFileMenuOpen(false);
        void confirmDialog({
          title: 'Fechar workspace?',
          message: 'Fecha o workspace atual e volta pra tela inicial. Mudanças não-salvas serão perdidas.',
          confirmLabel: 'Fechar',
          destructive: dirtyContents.size > 0,
        }).then((ok) => {
          if (!ok) return;
          setCwd('');
          setCentralTabs([]);
          setActiveCentralTabId(null);
          setDirtyContents(new Map());
          setSessionInfo({});
        });
      },
    },
    {
      kind: 'item',
      icon: 'multiple-windows',
      label: 'Close Window',
      shortcut: 'Alt F4',
      onClick: () => { window.akaiAPI?.window.close(); setFileMenuOpen(false); },
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'refresh',
      label: 'Reload Window',
      shortcut: 'Ctrl R',
      onClick: () => { window.location.reload(); setFileMenuOpen(false); },
    },
    {
      kind: 'item',
      icon: 'close',
      label: 'Exit',
      onClick: () => { window.akaiAPI?.window.close(); setFileMenuOpen(false); },
    },
  ];

  // === Edit menu ===
  // Cada item dispatcha CustomEvent que MonacoEditor escuta e roda o action
  // correspondente (`editor.getAction(...).run()`). Pra Cut/Copy/Paste usa
  // document.execCommand que cobre tanto Monaco quanto inputs HTML normais.
  const editMenuItems: PopoverItem[] = [
    {
      kind: 'item',
      icon: 'discard',
      label: 'Undo',
      shortcut: 'Ctrl Z',
      onClick: () => { setEditMenuOpen(false); window.dispatchEvent(new CustomEvent('akai:editor-undo')); },
    },
    {
      kind: 'item',
      icon: 'redo',
      label: 'Redo',
      shortcut: 'Ctrl Y',
      onClick: () => { setEditMenuOpen(false); window.dispatchEvent(new CustomEvent('akai:editor-redo')); },
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'symbol-keyword',
      label: 'Cut',
      shortcut: 'Ctrl X',
      onClick: () => { setEditMenuOpen(false); window.dispatchEvent(new CustomEvent('akai:editor-cut')); },
    },
    {
      kind: 'item',
      icon: 'copy',
      label: 'Copy',
      shortcut: 'Ctrl C',
      onClick: () => { setEditMenuOpen(false); window.dispatchEvent(new CustomEvent('akai:editor-copy')); },
    },
    {
      kind: 'item',
      icon: 'clippy',
      label: 'Paste',
      shortcut: 'Ctrl V',
      onClick: () => { setEditMenuOpen(false); window.dispatchEvent(new CustomEvent('akai:editor-paste')); },
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'search',
      label: 'Find',
      shortcut: 'Ctrl F',
      onClick: () => { setEditMenuOpen(false); window.dispatchEvent(new CustomEvent('akai:editor-find')); },
    },
    {
      kind: 'item',
      icon: 'replace',
      label: 'Replace',
      shortcut: 'Ctrl H',
      onClick: () => { setEditMenuOpen(false); window.dispatchEvent(new CustomEvent('akai:editor-replace')); },
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'search',
      label: 'Find in Files',
      shortcut: 'Ctrl Shift F',
      onClick: () => { setEditMenuOpen(false); setPaletteMode('grep'); },
    },
    {
      kind: 'item',
      icon: 'replace-all',
      label: 'Replace in Files',
      shortcut: 'Ctrl Shift H',
      onClick: () => { setEditMenuOpen(false); setPrimarySidebarTab('search'); },
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'comment',
      label: 'Toggle Line Comment',
      shortcut: 'Ctrl /',
      onClick: () => { setEditMenuOpen(false); window.dispatchEvent(new CustomEvent('akai:editor-comment-line')); },
    },
    {
      kind: 'item',
      icon: 'comment-discussion',
      label: 'Toggle Block Comment',
      shortcut: 'Shift Alt A',
      onClick: () => { setEditMenuOpen(false); window.dispatchEvent(new CustomEvent('akai:editor-comment-block')); },
    },
  ];

  // === Selection menu ===
  // Todos os items são Monaco actions via dispatch CustomEvent → MonacoEditor.
  // Helper inline: cria onClick que dispatcha + fecha menu.
  const sel = (event: string) => () => {
    setSelectionMenuOpen(false);
    window.dispatchEvent(new CustomEvent(event));
  };
  const selectionMenuItems: PopoverItem[] = [
    { kind: 'item', icon: 'list-selection', label: 'Select All', shortcut: 'Ctrl A', onClick: sel('akai:editor-select-all') },
    { kind: 'item', icon: 'symbol-array', label: 'Expand Selection', shortcut: 'Shift Alt →', onClick: sel('akai:editor-expand-selection') },
    { kind: 'item', icon: 'symbol-array', label: 'Shrink Selection', shortcut: 'Shift Alt ←', onClick: sel('akai:editor-shrink-selection') },
    { kind: 'divider' },
    { kind: 'item', icon: 'copy', label: 'Copy Line Up', shortcut: 'Shift Alt ↑', onClick: sel('akai:editor-copy-line-up') },
    { kind: 'item', icon: 'copy', label: 'Copy Line Down', shortcut: 'Shift Alt ↓', onClick: sel('akai:editor-copy-line-down') },
    { kind: 'item', icon: 'arrow-up', label: 'Move Line Up', shortcut: 'Alt ↑', onClick: sel('akai:editor-move-line-up') },
    { kind: 'item', icon: 'arrow-down', label: 'Move Line Down', shortcut: 'Alt ↓', onClick: sel('akai:editor-move-line-down') },
    { kind: 'item', icon: 'copy', label: 'Duplicate Selection', onClick: sel('akai:editor-duplicate-selection') },
    { kind: 'divider' },
    { kind: 'item', icon: 'arrow-up', label: 'Add Cursor Above', shortcut: 'Ctrl Alt ↑', onClick: sel('akai:editor-cursor-above') },
    { kind: 'item', icon: 'arrow-down', label: 'Add Cursor Below', shortcut: 'Ctrl Alt ↓', onClick: sel('akai:editor-cursor-below') },
    { kind: 'item', icon: 'list-flat', label: 'Add Cursors to Line Ends', shortcut: 'Shift Alt I', onClick: sel('akai:editor-cursors-line-ends') },
    { kind: 'item', icon: 'symbol-keyword', label: 'Add Next Occurrence', shortcut: 'Ctrl D', onClick: sel('akai:editor-add-next-occurrence') },
    { kind: 'item', icon: 'symbol-keyword', label: 'Add Previous Occurrence', onClick: sel('akai:editor-add-prev-occurrence') },
    { kind: 'item', icon: 'selection', label: 'Select All Occurrences', onClick: sel('akai:editor-select-all-occurrences') },
    { kind: 'divider' },
    { kind: 'item', icon: 'symbol-key', label: 'Toggle Column Selection Mode', onClick: sel('akai:editor-toggle-column-selection') },
  ];

  // === View menu — paridade Cursor (main + Appearance submenu) ===
  // Editor Layout submenu (Split editor) NÃO incluído — requer refactor grande
  // do pane-mid pra suportar splits. Pode ser feito em fase futura.
  const viewMenuItems: PopoverItem[] = [
    {
      kind: 'item',
      icon: 'symbol-event',
      label: 'Command Palette...',
      shortcut: 'Ctrl Shift P',
      onClick: () => { setViewMenuOpen(false); setPaletteMode('commands'); },
    },
    {
      kind: 'item',
      icon: 'go-to-file',
      label: 'Quick Open...',
      shortcut: 'Ctrl P',
      onClick: () => { setViewMenuOpen(false); setPaletteMode('files'); },
    },
    { kind: 'divider' },
    {
      // Appearance submenu — Full Screen, Sidebars (checkmarks), Render toggles, Zoom
      kind: 'item',
      icon: 'paintcan',
      label: 'Appearance',
      submenu: [
        {
          kind: 'item',
          icon: 'screen-full',
          label: 'Full Screen',
          shortcut: 'F11',
          onClick: () => {
            setViewMenuOpen(false);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).akaiAPI?.window?.toggleFullScreen?.();
          },
        },
        { kind: 'divider' },
        {
          kind: 'item',
          icon: 'layout-sidebar-left',
          label: leftPaneOpen ? '✓ Primary Side Bar' : 'Primary Side Bar',
          shortcut: 'Ctrl B',
          onClick: () => { setViewMenuOpen(false); setLeftPaneOpen((p) => !p); },
        },
        {
          kind: 'item',
          icon: 'comment-discussion',
          label: chatPaneOpen ? '✓ Secondary Side Bar (Chat)' : 'Secondary Side Bar (Chat)',
          shortcut: 'Ctrl Alt B',
          onClick: () => { setViewMenuOpen(false); setChatPaneOpen((p) => !p); },
        },
        {
          kind: 'item',
          icon: 'layout-panel',
          label: bottomPanelOpen ? '✓ Panel (Bottom)' : 'Panel (Bottom)',
          shortcut: 'Ctrl J',
          onClick: () => { setViewMenuOpen(false); setBottomPanelOpen((p) => !p); },
        },
        { kind: 'divider' },
        {
          kind: 'item',
          icon: 'eye',
          label: 'Toggle Minimap',
          onClick: () => {
            setViewMenuOpen(false);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const api = (window as any).akaiAPI?.settings;
            if (!api?.get || !api?.set) return;
            void api.get('editorMinimap').then((v: boolean) => api.set('editorMinimap', !v));
          },
        },
        {
          kind: 'item',
          icon: 'symbol-key',
          label: 'Toggle Sticky Scroll',
          onClick: () => {
            setViewMenuOpen(false);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const api = (window as any).akaiAPI?.settings;
            if (!api?.get || !api?.set) return;
            void api.get('stickyScroll').then((v: boolean) => api.set('stickyScroll', !v));
          },
        },
        {
          kind: 'item',
          icon: 'whitespace',
          label: 'Toggle Render Whitespace',
          onClick: () => {
            setViewMenuOpen(false);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const api = (window as any).akaiAPI?.settings;
            if (!api?.get || !api?.set) return;
            void api.get('editorRenderWhitespace').then((v: boolean) => api.set('editorRenderWhitespace', !v));
          },
        },
        {
          kind: 'item',
          icon: 'symbol-character',
          label: 'Toggle Render Control Characters',
          onClick: () => {
            setViewMenuOpen(false);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const api = (window as any).akaiAPI?.settings;
            if (!api?.get || !api?.set) return;
            void api.get('editorRenderControlChars').then((v: boolean) => api.set('editorRenderControlChars', !v));
          },
        },
        { kind: 'divider' },
        {
          kind: 'item',
          icon: 'zoom-in',
          label: 'Zoom In',
          shortcut: 'Ctrl =',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onClick: () => { setViewMenuOpen(false); (window as any).akaiAPI?.window?.zoomIn?.(); },
        },
        {
          kind: 'item',
          icon: 'zoom-out',
          label: 'Zoom Out',
          shortcut: 'Ctrl -',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onClick: () => { setViewMenuOpen(false); (window as any).akaiAPI?.window?.zoomOut?.(); },
        },
        {
          kind: 'item',
          icon: 'refresh',
          label: 'Reset Zoom',
          shortcut: 'Ctrl 0',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onClick: () => { setViewMenuOpen(false); (window as any).akaiAPI?.window?.zoomReset?.(); },
        },
      ],
    },
    { kind: 'divider' },
    // === Side bar tabs (Cursor "Explorer/Search/Source Control/Extensions") ===
    {
      kind: 'item',
      icon: 'files',
      label: 'Explorer',
      shortcut: 'Ctrl Shift E',
      onClick: () => { setViewMenuOpen(false); setLeftPaneOpen(true); setPrimarySidebarTab('files'); },
    },
    {
      kind: 'item',
      icon: 'search',
      label: 'Search',
      shortcut: 'Ctrl Shift F',
      onClick: () => { setViewMenuOpen(false); setLeftPaneOpen(true); setPrimarySidebarTab('search'); },
    },
    {
      kind: 'item',
      icon: 'source-control',
      label: 'Source Control',
      shortcut: 'Ctrl Shift G',
      onClick: () => { setViewMenuOpen(false); setLeftPaneOpen(true); setPrimarySidebarTab('git'); },
    },
    {
      kind: 'item',
      icon: 'extensions',
      label: 'Extensions',
      shortcut: 'Ctrl Shift X',
      onClick: () => { setViewMenuOpen(false); setPluginMarketplaceOpen(true); },
    },
    { kind: 'divider' },
    // === Bottom panel tabs (Cursor "Problems/Output/Terminal") ===
    {
      kind: 'item',
      icon: 'warning',
      label: 'Problems',
      shortcut: 'Ctrl Shift M',
      onClick: () => { setViewMenuOpen(false); setBottomPanelOpen(true); setActiveBottomTab('problems'); },
    },
    {
      kind: 'item',
      icon: 'output',
      label: 'Output',
      shortcut: 'Ctrl Shift U',
      onClick: () => { setViewMenuOpen(false); setBottomPanelOpen(true); setActiveBottomTab('output'); },
    },
    {
      kind: 'item',
      icon: 'terminal',
      label: 'Terminal',
      shortcut: "Ctrl '",
      onClick: () => { setViewMenuOpen(false); setBottomPanelOpen(true); setActiveBottomTab('terminal'); },
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'browser',
      label: 'Toggle Preview',
      shortcut: "'",
      onClick: () => { setViewMenuOpen(false); setPreviewOpen((p) => !p); },
    },
    {
      kind: 'item',
      icon: 'word-wrap',
      label: 'Word Wrap',
      shortcut: 'Alt Z',
      onClick: () => {
        setViewMenuOpen(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = (window as any).akaiAPI?.settings;
        if (!api?.get || !api?.set) return;
        void api.get('editorWordWrap').then((v: boolean) => api.set('editorWordWrap', !v));
      },
    },
  ];

  // === Go menu — paridade Cursor ===
  // LSP-dependentes (Definition/Declaration/References) usam Monaco's built-in
  // que funcionam pra TypeScript/JavaScript via @typescript/vfs. Outras linguagens
  // ficam silent fail (action.run catch swallow).
  const goAction = (event: string) => () => {
    setGoMenuOpen(false);
    window.dispatchEvent(new CustomEvent(event));
  };
  const goMenuItems: PopoverItem[] = [
    {
      kind: 'item',
      icon: 'arrow-left',
      label: 'Back',
      shortcut: 'Alt ←',
      disabled: !canGoBack,
      onClick: () => { setGoMenuOpen(false); navigateBack(); },
    },
    {
      kind: 'item',
      icon: 'arrow-right',
      label: 'Forward',
      shortcut: 'Alt →',
      disabled: !canGoForward,
      onClick: () => { setGoMenuOpen(false); navigateForward(); },
    },
    { kind: 'divider' },
    {
      // Switch Editor submenu — Next/Previous tab + cycle por tab index
      kind: 'item',
      icon: 'multiple-windows',
      label: 'Switch Editor',
      submenu: [
        {
          kind: 'item',
          icon: 'arrow-right',
          label: 'Next Editor',
          shortcut: 'Ctrl Tab',
          onClick: () => {
            setGoMenuOpen(false);
            if (centralTabs.length < 2 || !activeCentralTabId) return;
            const idx = centralTabs.findIndex((t) => t.id === activeCentralTabId);
            const next = (idx + 1) % centralTabs.length;
            setActiveCentralTabIdWithAutoSave(centralTabs[next].id);
          },
        },
        {
          kind: 'item',
          icon: 'arrow-left',
          label: 'Previous Editor',
          shortcut: 'Ctrl Shift Tab',
          onClick: () => {
            setGoMenuOpen(false);
            if (centralTabs.length < 2 || !activeCentralTabId) return;
            const idx = centralTabs.findIndex((t) => t.id === activeCentralTabId);
            const prev = (idx - 1 + centralTabs.length) % centralTabs.length;
            setActiveCentralTabIdWithAutoSave(centralTabs[prev].id);
          },
        },
      ],
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'go-to-file',
      label: 'Go to File...',
      shortcut: 'Ctrl P',
      onClick: () => { setGoMenuOpen(false); setPaletteMode('files'); },
    },
    {
      kind: 'item',
      icon: 'symbol-method',
      label: 'Go to Symbol in Workspace...',
      shortcut: 'Ctrl T',
      onClick: () => { setGoMenuOpen(false); setPaletteMode('grep'); },
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'symbol-method',
      label: 'Go to Symbol in Editor...',
      shortcut: 'Ctrl Shift O',
      onClick: () => { setGoMenuOpen(false); setSymbolOutlineOpen(true); },
    },
    {
      kind: 'item',
      icon: 'go-to-search',
      label: 'Go to Definition',
      shortcut: 'F12',
      onClick: goAction('akai:editor-goto-definition'),
    },
    {
      kind: 'item',
      icon: 'go-to-search',
      label: 'Go to Declaration',
      onClick: goAction('akai:editor-goto-declaration'),
    },
    {
      kind: 'item',
      icon: 'symbol-class',
      label: 'Go to Type Definition',
      onClick: goAction('akai:editor-goto-type-definition'),
    },
    {
      kind: 'item',
      icon: 'symbol-interface',
      label: 'Go to Implementations',
      shortcut: 'Ctrl F12',
      onClick: goAction('akai:editor-goto-implementations'),
    },
    {
      kind: 'item',
      icon: 'references',
      label: 'Go to References',
      shortcut: 'Shift F12',
      onClick: goAction('akai:editor-goto-references'),
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'list-ordered',
      label: 'Go to Line/Column...',
      shortcut: 'Ctrl G',
      onClick: goAction('akai:editor-goto-line'),
    },
    {
      kind: 'item',
      icon: 'bracket',
      label: 'Go to Bracket',
      shortcut: 'Ctrl Shift ]',
      onClick: goAction('akai:editor-goto-bracket'),
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'warning',
      label: 'Next Problem',
      shortcut: 'F8',
      onClick: goAction('akai:editor-next-problem'),
    },
    {
      kind: 'item',
      icon: 'warning',
      label: 'Previous Problem',
      shortcut: 'Shift F8',
      onClick: goAction('akai:editor-prev-problem'),
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'git-pull-request',
      label: 'Next Change',
      shortcut: 'Alt F3',
      onClick: goAction('akai:editor-next-change'),
    },
    {
      kind: 'item',
      icon: 'git-pull-request',
      label: 'Previous Change',
      shortcut: 'Shift Alt F3',
      onClick: goAction('akai:editor-prev-change'),
    },
    { kind: 'divider' },
    // === Extras úteis (não no Cursor mas vale ter) ===
    {
      kind: 'item',
      icon: 'history',
      label: 'Recent Files',
      shortcut: 'Ctrl E',
      onClick: () => { setGoMenuOpen(false); setRecentActivityOpen(true); },
    },
    {
      kind: 'item',
      icon: 'arrow-right',
      label: 'Switch Workspace...',
      shortcut: 'Ctrl Alt R',
      onClick: () => { setGoMenuOpen(false); setPaletteMode('workspaces'); },
    },
  ];

  // === Run menu — paridade VISUAL com Antigravity (full DAP UI). Debug runtime
  // não implementado — items ficam disabled com descrição. Tasks/Output/Problems
  // funcionam (não dependem de DAP).
  const runMenuItems: PopoverItem[] = [
    {
      kind: 'item',
      icon: 'debug-start',
      label: 'Start Debugging',
      shortcut: 'F5',
      disabled: true,
      description: 'Debug runtime não implementado — precisa DAP (Debug Adapter Protocol) integration',
    },
    {
      kind: 'item',
      icon: 'play',
      label: 'Run Without Debugging',
      shortcut: 'Ctrl F5',
      disabled: true,
      description: 'Use Run Tasks... abaixo enquanto não temos DAP',
    },
    {
      kind: 'item',
      icon: 'debug-stop',
      label: 'Stop Debugging',
      shortcut: 'Shift F5',
      disabled: true,
    },
    {
      kind: 'item',
      icon: 'debug-restart',
      label: 'Restart Debugging',
      shortcut: 'Ctrl Shift F5',
      disabled: true,
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'settings-gear',
      label: 'Open Configurations',
      disabled: true,
      description: 'launch.json — sem DAP',
    },
    {
      kind: 'item',
      icon: 'add',
      label: 'Add Configuration...',
      disabled: true,
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'debug-step-over',
      label: 'Step Over',
      shortcut: 'F10',
      disabled: true,
    },
    {
      kind: 'item',
      icon: 'debug-step-into',
      label: 'Step Into',
      shortcut: 'F11',
      disabled: true,
    },
    {
      kind: 'item',
      icon: 'debug-step-out',
      label: 'Step Out',
      shortcut: 'Shift F11',
      disabled: true,
    },
    {
      kind: 'item',
      icon: 'debug-continue',
      label: 'Continue',
      shortcut: 'F5',
      disabled: true,
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'debug-breakpoint',
      label: 'Toggle Breakpoint',
      shortcut: 'F9',
      disabled: true,
    },
    {
      kind: 'item',
      icon: 'debug-breakpoint-conditional',
      label: 'New Breakpoint',
      disabled: true,
      description: 'Conditional / Logpoint / Function — sem DAP',
    },
    {
      kind: 'item',
      icon: 'debug-breakpoint',
      label: 'Enable All Breakpoints',
      disabled: true,
    },
    {
      kind: 'item',
      icon: 'debug-breakpoint-unverified',
      label: 'Disable All Breakpoints',
      disabled: true,
    },
    {
      kind: 'item',
      icon: 'clear-all',
      label: 'Remove All Breakpoints',
      disabled: true,
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'cloud-download',
      label: 'Install Additional Debuggers...',
      description: 'Abre o marketplace de plugins',
      onClick: () => { setRunMenuOpen(false); setPluginMarketplaceOpen(true); },
    },
    { kind: 'divider' },
    // === Items FUNCIONAIS — não dependem de DAP ===
    {
      kind: 'item',
      icon: 'play',
      label: 'Run Tasks...',
      onClick: () => { setRunMenuOpen(false); setBottomPanelOpen(true); setActiveBottomTab('tasks'); },
    },
    {
      kind: 'item',
      icon: 'output',
      label: 'View Output',
      onClick: () => { setRunMenuOpen(false); setBottomPanelOpen(true); setActiveBottomTab('output'); },
    },
    {
      kind: 'item',
      icon: 'warning',
      label: 'View Problems',
      onClick: () => { setRunMenuOpen(false); setBottomPanelOpen(true); setActiveBottomTab('problems'); },
    },
  ];

  // === Terminal menu — paridade Cursor ===
  // Helpers: detecta linguagem do arquivo ativo + monta comando de run.
  const runCommandFor = (path: string): string | null => {
    const ext = path.split('.').pop()?.toLowerCase();
    const escaped = path.includes(' ') ? `"${path}"` : path;
    switch (ext) {
      case 'ts': case 'tsx': return `npx tsx ${escaped}`;
      case 'js': case 'mjs': case 'cjs': return `node ${escaped}`;
      case 'jsx': return `npx tsx ${escaped}`;
      case 'py': return `python ${escaped}`;
      case 'sh': case 'bash': return `bash ${escaped}`;
      case 'ps1': return `powershell -File ${escaped}`;
      case 'rb': return `ruby ${escaped}`;
      case 'go': return `go run ${escaped}`;
      case 'rs': return `cargo run --bin ${escaped}`;
      case 'java': return `java ${escaped}`;
      case 'lua': return `lua ${escaped}`;
      case 'php': return `php ${escaped}`;
      default: return null;
    }
  };

  const handleRunBuildTask = useCallback(async () => {
    if (!cwd) { toast.warn('Sem workspace ativo'); return; }
    try {
      const sep = cwd.includes('\\') ? '\\' : '/';
      const r = await window.akaiAPI?.fs.readFile(`${cwd}${sep}package.json`);
      if ('error' in r) { toast.warn('Sem package.json — abra workspace com Node project'); return; }
      const pkg = JSON.parse(r.content);
      const scripts = pkg.scripts || {};
      // Procura 'build' primeiro, depois 'dev', depois primeiro script
      const buildScript = scripts.build ? 'build' : scripts.dev ? 'dev' : Object.keys(scripts)[0];
      if (!buildScript) { toast.warn('package.json sem scripts definidos'); return; }
      setBottomPanelOpen(true);
      setActiveBottomTab('terminal');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('akai:run-task', { detail: { script: `npm run ${buildScript}` } }));
      }, 200);
      toast.info(`Build task: npm run ${buildScript}`);
    } catch (err) {
      toast.error('Falha ao ler package.json', { sub: String(err) });
    }
  }, [cwd]);

  const handleRunActiveFile = useCallback(() => {
    const active = centralTabs.find((t) => t.id === activeCentralTabId);
    if (!active || active.kind !== 'file') { toast.warn('Sem arquivo ativo'); return; }
    const cmd = runCommandFor(active.path);
    if (!cmd) { toast.warn(`Não sei rodar .${active.path.split('.').pop()} — abra um arquivo .ts/.js/.py/etc`); return; }
    setBottomPanelOpen(true);
    setActiveBottomTab('terminal');
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('akai:run-task', { detail: { script: cmd } }));
    }, 200);
    toast.info(`Rodando: ${cmd}`);
  }, [centralTabs, activeCentralTabId]);

  const handleRunSelectedText = useCallback(() => {
    // Pega selection do Monaco via dispatch event; MonacoEditor responde com `akai:editor-selection-result`
    // que escutamos uma vez. Se vazio, toast warn.
    setBottomPanelOpen(true);
    setActiveBottomTab('terminal');
    const handler = (ev: Event): void => {
      const detail = (ev as CustomEvent<{ text: string }>).detail;
      window.removeEventListener('akai:editor-selection-result', handler);
      if (!detail?.text?.trim()) { toast.warn('Nenhum texto selecionado'); return; }
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('akai:run-task', { detail: { script: detail.text } }));
      }, 200);
      toast.info(`Rodando seleção (${detail.text.length} chars)`);
    };
    window.addEventListener('akai:editor-selection-result', handler);
    window.dispatchEvent(new CustomEvent('akai:editor-get-selection'));
    // Timeout fallback se editor não responder em 500ms
    setTimeout(() => window.removeEventListener('akai:editor-selection-result', handler), 500);
  }, []);

  const terminalMenuItems: PopoverItem[] = [
    {
      kind: 'item',
      icon: 'terminal',
      label: 'New Terminal',
      shortcut: 'Ctrl Shift `',
      onClick: () => { setTerminalMenuOpen(false); setBottomPanelOpen(true); setActiveBottomTab('terminal'); },
    },
    {
      kind: 'item',
      icon: 'split-horizontal',
      label: 'Split Terminal',
      shortcut: 'Ctrl Shift 5',
      disabled: true,
      description: 'Suporte a múltiplos terminais simultâneos — pendente refactor da BottomPanel',
    },
    {
      kind: 'item',
      icon: 'empty-window',
      label: 'New Terminal Window',
      description: 'Abre nova janela do app (Ctrl+Shift+N) com Terminal aberto',
      onClick: () => {
        setTerminalMenuOpen(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = (window as any).akaiAPI?.window;
        if (api?.openNew) void api.openNew();
      },
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'play',
      label: 'Run Task...',
      onClick: () => { setTerminalMenuOpen(false); setBottomPanelOpen(true); setActiveBottomTab('tasks'); },
    },
    {
      kind: 'item',
      icon: 'tools',
      label: 'Run Build Task...',
      shortcut: 'Ctrl Shift B',
      onClick: () => { setTerminalMenuOpen(false); void handleRunBuildTask(); },
    },
    {
      kind: 'item',
      icon: 'run',
      label: 'Run Active File',
      onClick: () => { setTerminalMenuOpen(false); handleRunActiveFile(); },
    },
    {
      kind: 'item',
      icon: 'run-all',
      label: 'Run Selected Text',
      onClick: () => { setTerminalMenuOpen(false); handleRunSelectedText(); },
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'list-tree',
      label: 'Show Running Tasks...',
      disabled: true,
      description: 'Sem task management UI ainda',
    },
    {
      kind: 'item',
      icon: 'debug-restart',
      label: 'Restart Running Task...',
      disabled: true,
    },
    {
      kind: 'item',
      icon: 'debug-stop',
      label: 'Terminate Task...',
      disabled: true,
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'settings-gear',
      label: 'Configure Tasks...',
      description: 'Sem tasks.json — auto-detecta scripts de package.json',
      disabled: true,
    },
    {
      kind: 'item',
      icon: 'settings-gear',
      label: 'Configure Default Build Task...',
      description: 'Default = "build" se existir, senão "dev", senão primeiro script',
      disabled: true,
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'layout-panel',
      label: 'Toggle Terminal Panel',
      shortcut: 'Ctrl J',
      onClick: () => { setTerminalMenuOpen(false); setBottomPanelOpen((p) => !p); },
    },
    {
      kind: 'item',
      icon: 'plug',
      label: 'View Ports',
      onClick: () => { setTerminalMenuOpen(false); setBottomPanelOpen(true); setActiveBottomTab('ports'); },
    },
  ];

  // === Help menu — paridade Cursor ===
  const helpMenuItems: PopoverItem[] = [
    {
      kind: 'item',
      icon: 'compass',
      label: 'Welcome',
      description: 'Refazer tour de boas-vindas',
      onClick: () => { setHelpMenuOpen(false); resetTour(); setOnboardingOpen(true); },
    },
    {
      kind: 'item',
      icon: 'symbol-event',
      label: 'Show All Commands',
      shortcut: 'Ctrl Shift P',
      onClick: () => { setHelpMenuOpen(false); setPaletteMode('commands'); },
    },
    {
      kind: 'item',
      icon: 'keyboard',
      label: 'Keyboard Shortcuts',
      shortcut: 'Ctrl /',
      onClick: () => { setHelpMenuOpen(false); setShortcutsOpen(true); },
    },
    {
      kind: 'item',
      icon: 'beaker',
      label: 'Editor Playground',
      description: 'Cursor-specific — não implementado',
      disabled: true,
    },
    {
      kind: 'item',
      icon: 'compass-active',
      label: 'Open Walkthrough...',
      description: 'Mesmo que Welcome (reusa o Onboarding tour)',
      onClick: () => { setHelpMenuOpen(false); resetTour(); setOnboardingOpen(true); },
    },
    {
      kind: 'item',
      icon: 'feedback',
      label: 'Provide Feedback',
      onClick: () => {
        setHelpMenuOpen(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).akaiAPI?.openExternal?.('https://github.com/anthropics/claude-code/issues/new');
      },
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'book',
      label: 'Documentação Claude Code',
      onClick: () => {
        setHelpMenuOpen(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).akaiAPI?.openExternal?.('https://docs.claude.com/en/docs/claude-code');
      },
    },
    {
      kind: 'item',
      icon: 'github',
      label: 'View License',
      onClick: () => {
        setHelpMenuOpen(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).akaiAPI?.openExternal?.('https://github.com/anthropics/claude-code/blob/main/LICENSE');
      },
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'tools',
      label: 'Toggle Developer Tools',
      shortcut: 'F12',
      description: 'Abre DevTools do Chromium (Ctrl+Shift+I também funciona)',
      onClick: () => {
        setHelpMenuOpen(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).akaiAPI?.window?.toggleDevTools?.();
      },
    },
    {
      kind: 'item',
      icon: 'server-process',
      label: 'Open Process Explorer',
      description: 'Chromium task manager — pendente IPC dedicado',
      disabled: true,
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'cloud-download',
      label: 'Check for Updates...',
      description: 'Auto-updater não configurado — verifique manualmente no GitHub',
      disabled: true,
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'info',
      label: 'About UNDRCode',
      description: 'v0.0.1 — Desktop wrapper pro Claude Code CLI',
      onClick: () => {
        setHelpMenuOpen(false);
        toast.info('UNDRCode v0.0.1', { sub: 'Desktop wrapper pro Claude Code CLI · Electron + React + Vite', ttl: 10_000 });
      },
    },
  ];

  // Settings menu items — só o implementável.
  // Removidos: Editor Settings (sem editor de config), Extensions (sem sistema),
  // Configure Snippets (sem sistema).
  const settingsMenuItems: PopoverItem[] = [
    {
      kind: 'item',
      icon: 'settings-gear',
      label: 'Configurações',
      shortcut: 'Ctrl ,',
      onClick: () => {
        setSettingsOpen(true);
        setSettingsMenuOpen(false);
      },
    },
    {
      kind: 'item',
      icon: 'keyboard',
      label: 'Atalhos de Teclado',
      shortcut: 'Ctrl /',
      onClick: () => {
        setShortcutsOpen(true);
        setSettingsMenuOpen(false);
      },
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'file',
      label: 'Editar UNDERCODE.md',
      description: 'Memória do projeto carregada pelo Claude',
      onClick: () => {
        // Abre o UNDERCODE.md no FilePreview se existir no workspace
        const path = cwd ? `${cwd}/UNDERCODE.md` : null;
        if (path) openFileTab(path);
        setSettingsMenuOpen(false);
      },
    },
    {
      kind: 'item',
      icon: 'file-code',
      label: 'Editar CLAUDE.md',
      description: 'Memória global (fallback se UNDERCODE.md não existe)',
      onClick: () => {
        const path = cwd ? `${cwd}/CLAUDE.md` : null;
        if (path) openFileTab(path);
        setSettingsMenuOpen(false);
      },
    },
  ];

  // Account/User menu items — auth Claude (CLI) + ações utilitárias.
  const accountMenuItems: PopoverItem[] = [
    ...buildAuthMenuItems(auth, () => setAccountMenuOpen(false)),
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'book',
      label: 'Docs',
      onClick: () => {
        window.akaiAPI?.openExternal?.('https://docs.claude.com/en/docs/agents-and-tools/claude-code/overview');
        setAccountMenuOpen(false);
      },
    },
    {
      kind: 'item',
      icon: 'github',
      label: 'Report Issue',
      onClick: () => {
        window.akaiAPI?.openExternal?.('mailto:rfl.tkd@gmail.com?subject=UNDRCode%20issue');
        setAccountMenuOpen(false);
      },
    },
  ];

  useEffect(() => {
    // Boot — tenta restaurar último workspace usado; fallback pra home dir.
    // Cancel flag previne race: se user trocar workspace via "Open" durante
    // os ~50ms do fs.stat, o callback async não sobrescreve a escolha dele.
    // Optional chaining em TUDO — preload pode estar em race condition no boot.
    let cancelled = false;
    let lastWs: string | null = null;
    try {
      lastWs = localStorage.getItem('undrcode.lastWorkspace');
    } catch { /* ignore */ }

    const fallback = async (): Promise<void> => {
      const home = await window.akaiAPI?.getCwd?.();
      if (!cancelled && home) setCwd(home);
    };

    if (lastWs) {
      const statFn = window.akaiAPI?.fs?.stat;
      if (typeof statFn !== 'function') {
        void fallback();
      } else {
        statFn(lastWs).then((stat) => {
          if (cancelled) return;
          if (!('error' in stat) && stat.isDirectory) {
            setCwd(lastWs!);
          } else {
            void fallback();
          }
        }).catch(() => { if (!cancelled) void fallback(); });
      }
    } else {
      void fallback();
    }
    return () => { cancelled = true; };
  }, []);

  // Persiste último workspace ativo — restaurado no boot.
  useEffect(() => {
    if (!cwd) return;
    try {
      localStorage.setItem('undrcode.lastWorkspace', cwd);
    } catch { /* ignore */ }
  }, [cwd]);

  // File watcher — observa mudanças externas (Claude CLI escrevendo arquivos,
  // user editando em outro editor, git checkout, etc) e refresha FileTree +
  // recarrega buffer Monaco se o arquivo está aberto.
  //
  // FEATURE FLAG: temporariamente OFF por default enquanto investigamos
  // freezes intermitentes. Pra ligar manualmente:
  //   localStorage.setItem('undrcode.enableFileWatcher', '1') + reload
  useEffect(() => {
    if (!cwd) return;
    let enabled = false;
    try { enabled = localStorage.getItem('undrcode.enableFileWatcher') === '1'; } catch { /* ignore */ }
    if (!enabled) return;
    const api = window.akaiAPI?.fs;
    if (!api?.watchWorkspace || !api?.onWatcherEvent) return;

    let unsubscribe: (() => void) | null = null;

    // Debounce de tree-refresh — múltiplos add/unlink em sequência viram 1 refresh.
    // FileTree escuta `akai:tree-refresh` com `{ dir }` no detail.
    let treeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleTreeRefresh = (dirPath: string): void => {
      if (treeRefreshTimer) clearTimeout(treeRefreshTimer);
      treeRefreshTimer = setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('akai:tree-refresh', { detail: { dir: dirPath } }),
        );
        treeRefreshTimer = null;
      }, 150);
    };

    void api.watchWorkspace(cwd).then((res) => {
      if ('error' in res) {
        console.warn('[fs:watch] failed:', res.error);
        return;
      }
      unsubscribe = api.onWatcherEvent((data) => {
        const { event, path } = data;
        if (event === 'error') {
          console.warn('[fs:watch] event error:', path);
          return;
        }
        // Add/unlink/addDir/unlinkDir → refresh tree do parent directory.
        if (event === 'add' || event === 'unlink' || event === 'addDir' || event === 'unlinkDir') {
          const sep = path.includes('\\') ? '\\' : '/';
          const idx = path.lastIndexOf(sep);
          const parent = idx > 0 ? path.slice(0, idx) : cwd;
          scheduleTreeRefresh(parent);
          return;
        }
        // change → notifica editor pra possível reload se arquivo está aberto.
        if (event === 'change') {
          window.dispatchEvent(
            new CustomEvent('akai:file-changed-externally', { detail: { path } }),
          );
          // Toast discreto SE for o arquivo ativo + não dirty + não disparou
          // nos últimos 2s pro mesmo path. Sem dedup, build floods (HMR) =
          // toast stack overflow → main thread starva renderizando notifs.
          const active = centralTabsRef.current.find((t) => t.id === activeCentralTabIdRef.current);
          if (active?.kind === 'file' && active.path === path && !dirtyContentsRef.current.has(path)) {
            const now = Date.now();
            const lastToast = toastCooldownRef.current.get(path) || 0;
            if (now - lastToast > 2000) {
              toastCooldownRef.current.set(path, now);
              const sep = path.includes('\\') ? '\\' : '/';
              const idx = path.lastIndexOf(sep);
              const name = idx > 0 ? path.slice(idx + 1) : path;
              toast.info(`${name} atualizado externamente`);
            }
          }
        }
      });
    });

    return () => {
      if (treeRefreshTimer) clearTimeout(treeRefreshTimer);
      if (unsubscribe) unsubscribe();
      if (api?.unwatchWorkspace) void api.unwatchWorkspace();
    };
  }, [cwd]);

  // Restaura tabs centrais + dirtyContents quando cwd muda.
  // Valida via fs.stat que os paths ainda existem antes de re-abrir tabs de arquivo
  // (view tabs não precisam de stat). Roda assíncrono — tabs que sumirem ficam fora.
  // Flag prevDirtyHydrated evita o save-effect de sobrescrever com state vazio
  // antes do load completar.
  const hydratedCwdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    const targetCwd = cwd;
    hydratedCwdRef.current = null;
    const persisted = loadWorkspaceState(targetCwd);
    if (!persisted) {
      hydratedCwdRef.current = targetCwd;
      return;
    }
    (async () => {
      // Filtra tabs cujo path ainda existe no disco.
      const validTabs: PersistedTab[] = [];
      for (const t of persisted.centralTabs) {
        if (t.kind === 'view') {
          validTabs.push(t);
          continue;
        }
        if (!t.path) continue;
        try {
          const s = await window.akaiAPI?.fs.stat(t.path);
          if ('size' in s) validTabs.push(t);
        } catch { /* arquivo sumiu — skip */ }
      }
      if (cancelled) return;
      // Reconstrói CentralTab[] do shape persistido. Hidrata sem gotoLine/match*.
      const rehydrated = validTabs
        .map<CentralTab | null>((t) => {
          if (t.kind === 'file' && t.path) {
            return { id: t.id, kind: 'file', path: t.path, pinned: t.pinned };
          }
          if (t.kind === 'view' && t.viewId && t.title && t.icon) {
            return {
              id: t.id,
              kind: 'view',
              viewId: t.viewId as CentralViewId,
              title: t.title,
              icon: t.icon,
              pinned: t.pinned,
            };
          }
          return null;
        })
        .filter((t): t is CentralTab => t !== null);
      // Dirty content só pra paths que sobreviveram (evita ressuscitar editor pra arquivo deletado).
      const survivingPaths = new Set(rehydrated.filter((t) => t.kind === 'file').map((t) => (t as { path: string }).path));
      const dirtyEntries = persisted.dirtyContents.filter(([p]) => survivingPaths.has(p));
      setCentralTabs(rehydrated);
      const activeStillValid = rehydrated.some((t) => t.id === persisted.activeCentralTabId);
      setActiveCentralTabId(activeStillValid ? persisted.activeCentralTabId : (rehydrated[0]?.id ?? null));
      setDirtyContents(new Map(dirtyEntries));
      hydratedCwdRef.current = targetCwd;
    })();
    return () => { cancelled = true; };
  }, [cwd]);

  // Persiste tabs + dirtyContents com debounce de 500ms. Só salva depois do hydrate
  // pro cwd corrente — senão o primeiro render (com tabs []) sobrescreveria o storage.
  useEffect(() => {
    if (!cwd || hydratedCwdRef.current !== cwd) return;
    const t = setTimeout(() => {
      // Compare tabs são efêmeras (par leftPath+rightPath transient), não persistimos.
      const persistedTabs: PersistedTab[] = [];
      for (const tab of centralTabs) {
        if (tab.kind === 'file') {
          persistedTabs.push({ id: tab.id, kind: 'file', path: tab.path, pinned: tab.pinned });
        } else if (tab.kind === 'view') {
          persistedTabs.push({ id: tab.id, kind: 'view', viewId: tab.viewId, title: tab.title, icon: tab.icon, pinned: tab.pinned });
        }
      }
      saveWorkspaceState(cwd, {
        centralTabs: persistedTabs,
        activeCentralTabId,
        dirtyContents: Array.from(dirtyContents.entries()),
        ts: Date.now(),
      });
    }, 500);
    return () => clearTimeout(t);
  }, [cwd, centralTabs, activeCentralTabId, dirtyContents]);

  // Esc NÃO fecha mais central tab (era fechamento acidental — Rafael apertava
  // Escape achando que ia fazer outra coisa e fechava preview por engano,
  // porque Escape fica perto do ` que toggla preview).
  // Pra fechar tab: botão X no toolbar OU Ctrl+W (atalho padrão de editor).

  const handleOpenWorkspace = useCallback(async () => {
    const result = await window.akaiAPI?.dialog.openWorkspace();
    if (result.canceled === false) {
      setCwd(result.path);
      setSessionInfo({});
      setCentralTabs([]);
      setActiveCentralTabId(null);
    }
  }, []);

  /** Open File... — dialog seleciona arquivo único e abre em tab. */
  const handleOpenFile = useCallback(async () => {
    const result = await window.akaiAPI?.dialog.openFiles();
    if (result.canceled === false && result.paths.length > 0) {
      // Abre todos os arquivos selecionados
      for (const p of result.paths) openFileTab(p);
    }
  }, [openFileTab]);

  /** Close Editor — fecha tab ativo (Ctrl+F4). */
  const handleCloseEditor = useCallback(() => {
    if (activeCentralTabId) closeCentralTab(activeCentralTabId);
  }, [activeCentralTabId, closeCentralTab]);

  // Dispatcher do CommandPalette: mapeia command id → handler local.
  const handleCommandExec = useCallback((id: string) => {
    switch (id) {
      case 'workspace.open':
      case 'workspace.openFiles': handleOpenWorkspace(); break;
      case 'view.toggleSidebar': setLeftPaneOpen((p) => !p); break;
      case 'view.toggleBottomPanel': setBottomPanelOpen((p) => !p); break;
      case 'view.toggleChat': setChatPaneOpen((p) => !p); break;
      case 'view.transcript': setTranscriptOpen((p) => !p); break;
      case 'view.togglePreview': setPreviewOpen((p) => !p); break;
      case 'view.customizeLayout': setCustomizeLayoutOpen(true); break;
      case 'file.compare': void handleCompareFiles(); break;
      case 'chat.addSelection': handleAddSelectionToChat(); break;
      case 'chat.askAboutSelection': handleAskAboutSelection(); break;
      case 'git.showDiff': openGitDiff(); break;
      case 'git.commit': setCommitDialogOpen(true); break;
      case 'settings.open': setSettingsOpen(true); break;
      case 'settings.reload': window.location.reload(); break;
      case 'mcp.manage': setMcpManagerOpen(true); break;
      case 'plugins.marketplace': setPluginMarketplaceOpen(true); break;
      case 'help.shortcuts': setShortcutsOpen(true); break;
      case 'history.open': setHistoryPanelOpen(true); break;
      case 'help.onboarding':
        // Re-dispara o tour. resetTour() limpa o flag pra reabrir mesmo se já visto.
        resetTour();
        setOnboardingOpen(true);
        break;
      case 'editor.formatDocument':
        // Dispara evento que MonacoEditor escuta — roda formatDocument action.
        window.dispatchEvent(new CustomEvent('akai:editor-format'));
        break;
      case 'editor.toggleWordWrap':
        // Toggle via settings IPC; FilePreview escuta onChanged e re-renderiza Monaco.
        void (async () => {
          const api = window.akaiAPI?.settings;
          if (!api) return;
          const current = await api.get?.('editorWordWrap');
          await api.set?.('editorWordWrap', !(current === true));
        })();
        break;
      case 'editor.toggleMinimap':
        void (async () => {
          const api = window.akaiAPI?.settings;
          if (!api) return;
          const current = await api.get?.('editorMinimap');
          // Default true: undefined/null vira true → toggle pra false.
          await api.set?.('editorMinimap', !(current !== false));
        })();
        break;
      case 'editor.toggleLineNumbers':
        void (async () => {
          const api = window.akaiAPI?.settings;
          if (!api) return;
          const current = await api.get?.('editorLineNumbers');
          await api.set?.('editorLineNumbers', !(current !== false));
        })();
        break;
      default: console.warn('[palette] unknown command:', id);
    }
  }, [handleOpenWorkspace, openGitDiff, handleCompareFiles, handleAddSelectionToChat, handleAskAboutSelection]);

  // Liga os items do menu nativo (File/Edit/Selection/View/Go/Run/Terminal/Help)
  // com handlers locais. O preload expõe window.akaiAPI?.menu.onAction que retorna
  // unsubscribe. Items disabled no native (Monaco-handled, debug não impl) não
  // disparam IPC — sem case aqui. Cases espelham onClick dos arrays *MenuItems
  // no topbar custom; manter em sync.
  useEffect(() => {
    const off = window.akaiAPI?.menu?.onAction?.((action) => {
      switch (action) {
        // === File ===
        case 'openFolder': handleOpenWorkspace(); break;
        case 'openRecent': setRecentActivityOpen(true); break;
        case 'newFile': void handleNewFile(); break;
        case 'newWindow': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const api = (window as any).akaiAPI?.window;
          if (api?.openNew) {
            void api.openNew().then((r: { count: number }) => {
              toast.success(`Nova janela aberta (${r.count} no total)`);
            });
          }
          break;
        }
        case 'save': {
          const active = centralTabs.find((t) => t.id === activeCentralTabId);
          if (active?.kind === 'file') {
            const dirty = dirtyContents.get(active.path);
            if (dirty !== undefined) void handleSave(active.path, dirty);
          }
          break;
        }
        case 'saveAll':
          for (const [p, c] of dirtyContents.entries()) void handleSave(p, c);
          break;
        case 'settings': setSettingsOpen(true); break;
        case 'reloadWindow': window.location.reload(); break;
        case 'exit': window.akaiAPI?.window.close(); break;

        // === Edit ===
        case 'findInFiles': setPaletteMode('grep'); break;
        case 'replaceInFiles': setPrimarySidebarTab('search'); break;
        case 'editorUndo': window.dispatchEvent(new CustomEvent('akai:editor-undo')); break;
        case 'editorRedo': window.dispatchEvent(new CustomEvent('akai:editor-redo')); break;
        case 'editorFind': window.dispatchEvent(new CustomEvent('akai:editor-find')); break;
        case 'editorReplace': window.dispatchEvent(new CustomEvent('akai:editor-replace')); break;
        case 'editorCommentLine': window.dispatchEvent(new CustomEvent('akai:editor-comment-line')); break;
        case 'editorCommentBlock': window.dispatchEvent(new CustomEvent('akai:editor-comment-block')); break;
        // Selection menu
        case 'editorSelectAll': window.dispatchEvent(new CustomEvent('akai:editor-select-all')); break;
        case 'editorExpandSelection': window.dispatchEvent(new CustomEvent('akai:editor-expand-selection')); break;
        case 'editorShrinkSelection': window.dispatchEvent(new CustomEvent('akai:editor-shrink-selection')); break;
        case 'editorCopyLineUp': window.dispatchEvent(new CustomEvent('akai:editor-copy-line-up')); break;
        case 'editorCopyLineDown': window.dispatchEvent(new CustomEvent('akai:editor-copy-line-down')); break;
        case 'editorMoveLineUp': window.dispatchEvent(new CustomEvent('akai:editor-move-line-up')); break;
        case 'editorMoveLineDown': window.dispatchEvent(new CustomEvent('akai:editor-move-line-down')); break;
        case 'editorDuplicateSelection': window.dispatchEvent(new CustomEvent('akai:editor-duplicate-selection')); break;
        case 'editorCursorAbove': window.dispatchEvent(new CustomEvent('akai:editor-cursor-above')); break;
        case 'editorCursorBelow': window.dispatchEvent(new CustomEvent('akai:editor-cursor-below')); break;
        case 'editorCursorsLineEnds': window.dispatchEvent(new CustomEvent('akai:editor-cursors-line-ends')); break;
        case 'editorAddNextOccurrence': window.dispatchEvent(new CustomEvent('akai:editor-add-next-occurrence')); break;
        case 'editorAddPrevOccurrence': window.dispatchEvent(new CustomEvent('akai:editor-add-prev-occurrence')); break;
        case 'editorSelectAllOccurrences': window.dispatchEvent(new CustomEvent('akai:editor-select-all-occurrences')); break;
        case 'editorToggleColumnSelection': window.dispatchEvent(new CustomEvent('akai:editor-toggle-column-selection')); break;

        // === View ===
        case 'palette': setPaletteMode('commands'); break;
        case 'quickOpen': setPaletteMode('files'); break;
        case 'toggleSidebar': setLeftPaneOpen((p) => !p); break;
        case 'togglePanel': setBottomPanelOpen((p) => !p); break;
        case 'toggleChat': setChatPaneOpen((p) => !p); break;
        case 'togglePreview': setPreviewOpen((p) => !p); break;

        // === Go ===
        case 'goToSymbol': setSymbolOutlineOpen(true); break;
        case 'switchWorkspace': setPaletteMode('workspaces'); break;

        // === Run ===
        case 'runTasks': setBottomPanelOpen(true); setActiveBottomTab('tasks'); break;
        case 'viewOutput': setBottomPanelOpen(true); setActiveBottomTab('output'); break;
        case 'viewProblems': setBottomPanelOpen(true); setActiveBottomTab('problems'); break;

        // === Terminal ===
        case 'newTerminal': setBottomPanelOpen(true); setActiveBottomTab('terminal'); break;
        case 'viewPorts': setBottomPanelOpen(true); setActiveBottomTab('ports'); break;

        // === Help ===
        case 'shortcuts': setShortcutsOpen(true); break;
        case 'welcomeTour': resetTour(); setOnboardingOpen(true); break;

        // Placeholders — items que disparam IPC mas ainda sem handler dedicado.
        case 'find':
        case 'about':
          console.info('[menu] action sem handler dedicado:', action);
          break;
        default:
          console.warn('[menu] unknown action:', action);
      }
    });
    return () => { off?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleOpenWorkspace, handleNewFile, activeCentralTabId, centralTabs, dirtyContents, handleSave]);

  const handleMentionFromPreview = useCallback((relPath: string) => {
    setChatPrefill(`@${relPath} `);
    // Limpa logo no próximo tick (chat consome via useEffect)
    setTimeout(() => setChatPrefill(null), 0);
  }, []);

  // Mention vindo do FileTree (hover -> click no botão @). Recebe absolute path
  // e tipo (file/dir). Converte pra path relativo ao workspace e formata @x ou @x/.
  const handleMentionFromTree = useCallback((absolutePath: string, type: 'file' | 'dir') => {
    if (!cwd) return;
    let rel = absolutePath;
    if (absolutePath.startsWith(cwd)) {
      rel = absolutePath.substring(cwd.length).replace(/^[\\/]+/, '');
    }
    rel = rel.replace(/\\/g, '/');
    if (type === 'dir' && !rel.endsWith('/')) rel += '/';
    setChatPrefill(`@${rel} `);
    setTimeout(() => setChatPrefill(null), 0);
  }, [cwd]);

  // Resume uma session salva do Claude CLI naquele workspace.
  // Troca cwd + seta resumeSessionId pra ChatView retomar no remount.
  const handleResumeSession = useCallback((path: string, sessionId: string) => {
    setResumeSessionId(sessionId);
    setCwd(path);
    setSessionInfo({});
    setCentralTabs([]);
    setActiveCentralTabId(null);
  }, []);

  // Nova conversa naquele workspace — troca cwd, ChatView remonta com sessionId novo
  const handleNewConversation = useCallback((path: string) => {
    setResumeSessionId(null);
    setCwd(path);
    setSessionInfo({});
    setCentralTabs([]);
    setActiveCentralTabId(null);
  }, []);

  // Multi-session chat tabs (helpers).
  const chatSessionsStorageKey = useCallback((c: string | null) => {
    return `undrcode.chatSessions.${c || '__null__'}`;
  }, []);

  useEffect(() => {
    if (!cwd) return;
    const key = chatSessionsStorageKey(cwd);
    let saved: ChatSessionTab[] = [];
    let savedActive: string | null = null;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as { sessions?: ChatSessionTab[]; activeId?: string | null };
        if (Array.isArray(parsed?.sessions)) saved = parsed.sessions.filter((s) => s && typeof s.id === 'string');
        if (typeof parsed?.activeId === 'string') savedActive = parsed.activeId;
      }
    } catch { /* ignore corrupted state */ }

    if (saved.length > 0) {
      setChatSessions(saved);
      const validActive = saved.find((s) => s.id === savedActive)?.id || saved[0].id;
      setActiveChatSessionId(validActive);
      setResumeSessionId(validActive);
      return;
    }

    const bootstrap = async () => {
      if (resumeSessionId) {
        const tab: ChatSessionTab = { id: resumeSessionId, label: 'Sessão 1', createdAt: Date.now() };
        setChatSessions([tab]);
        setActiveChatSessionId(resumeSessionId);
        return;
      }
      try {
        const r = await window.akaiAPI?.agent.createSession();
        const tab: ChatSessionTab = { id: r.sessionId, label: 'Sessão 1', createdAt: Date.now() };
        setChatSessions([tab]);
        setActiveChatSessionId(r.sessionId);
        setResumeSessionId(r.sessionId);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[akai] failed to bootstrap chat session', err);
      }
    };
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  useEffect(() => {
    if (!cwd) return;
    if (chatSessions.length === 0 && !activeChatSessionId) return;
    try {
      localStorage.setItem(
        chatSessionsStorageKey(cwd),
        JSON.stringify({ sessions: chatSessions, activeId: activeChatSessionId })
      );
    } catch { /* localStorage cheio ou bloqueado — ignora */ }
  }, [cwd, chatSessions, activeChatSessionId, chatSessionsStorageKey]);

  const handleSelectChatSession = useCallback((id: string) => {
    setActiveChatSessionId(id);
    setResumeSessionId(id);
  }, []);

  const handleNewChatSession = useCallback(async () => {
    try {
      const r = await window.akaiAPI?.agent.createSession();
      setChatSessions((prev) => {
        const label = `Sessão ${prev.length + 1}`;
        const tab: ChatSessionTab = { id: r.sessionId, label, createdAt: Date.now() };
        return [...prev, tab];
      });
      setActiveChatSessionId(r.sessionId);
      setResumeSessionId(r.sessionId);
      toast.success('Nova conversa criada');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Falha ao criar conversa', { sub: msg });
    }
  }, []);

  const handleCloseChatSession = useCallback((id: string) => {
    setChatSessions((prev) => {
      if (prev.length <= 1) {
        toast.warn('Não dá pra fechar a última conversa');
        return prev;
      }
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const next = prev.filter((s) => s.id !== id);
      setActiveChatSessionId((current) => {
        if (current !== id) return current;
        const neighbor = next[Math.max(0, idx - 1)] || next[0];
        setResumeSessionId(neighbor.id);
        return neighbor.id;
      });
      toast.success('Conversa fechada');
      return next;
    });
  }, []);

  const handleRenameChatSession = useCallback((id: string, newLabel: string) => {
    setChatSessions((prev) => prev.map((s) => s.id === id ? { ...s, customLabel: newLabel || undefined } : s));
  }, []);

  const handleDuplicateChatSession = useCallback(async (id: string) => {
    try {
      const r = await window.akaiAPI?.agent.createSession();
      setChatSessions((prev) => {
        const source = prev.find((s) => s.id === id);
        const baseLabel = source ? `${source.customLabel?.trim() || source.label} (cópia)` : `Sessão ${prev.length + 1}`;
        const tab: ChatSessionTab = { id: r.sessionId, label: baseLabel, createdAt: Date.now() };
        return [...prev, tab];
      });
      setActiveChatSessionId(r.sessionId);
      setResumeSessionId(r.sessionId);
      toast.success('Conversa duplicada');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Falha ao duplicar conversa', { sub: msg });
    }
  }, []);

  // (handlers de RightPane removidos — Bottom Panel agora usa BottomPanel component dedicado)

  // Toggla view no popover Visualizações:
  // - 'terminal' → Bottom Panel (abre/fecha o panel + ativa tab Terminal)
  // - resto (Tarefas/Plano/Arquivos/Ver prévia/Diff) → tab central no pane-mid
  const handleToggleView = useCallback((id: RightTabId) => {
    // Terminal → toggla Bottom Panel ativando a tab Terminal
    if (id === 'terminal') {
      if (bottomPanelOpen && activeBottomTab === 'terminal') {
        setBottomPanelOpen(false);
      } else {
        setActiveBottomTab('terminal');
        setBottomPanelOpen(true);
      }
      return;
    }

    // Demais views → tab central
    const tabSpec = ALL_RIGHT_TABS.find((t) => t.id === id);
    if (!tabSpec) return;
    const centralId = `view:${id}`;
    const existing = centralTabs.find((t) => t.id === centralId);
    if (existing) {
      closeCentralTab(centralId);
    } else {
      openViewTab(id as CentralViewId, tabSpec.title, tabSpec.icon);
    }
  }, [bottomPanelOpen, activeBottomTab, centralTabs, closeCentralTab, openViewTab]);

  // Atalhos globais
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ctrl+O — Visualização de transcrição.
      // preventDefault() chama cedo pra impedir o dialog nativo "Open File" do
      // Electron/Chromium. stopPropagation() defensivo pra evitar Monaco ou
      // qualquer handler downstream comer o evento. Sem guard de input — o
      // toggle de transcript precisa funcionar mesmo do textarea do composer.
      if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        e.stopPropagation();
        // eslint-disable-next-line no-console
        console.log('[akai] Ctrl+O fired → toggle transcript');
        setTranscriptOpen((prev) => !prev);
        // Se o chat pane está fechado, abre-o também pro popover ter um anchor
        // válido (transcriptBtnRef). Caso contrário o popover usa fallback de
        // posição no canto top-right (ainda visível, mas sem ancoragem visual).
        setChatPaneOpen((prev) => (prev ? prev : true));
        return;
      }
      // Ctrl+Alt+B — Toggle Secondary Side Bar (ChatView)
      if (e.ctrlKey && e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setChatPaneOpen((prev) => !prev);
        return;
      }
      // Ctrl+B — Toggle Primary Side Bar (FileTree)
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
        // Só intercepta se NÃO está com foco num input editável
        const active = document.activeElement;
        if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || (active as HTMLElement)?.isContentEditable) {
          return; // deixa o Ctrl+B navegar/marcar como bold no editor
        }
        e.preventDefault();
        setLeftPaneOpen((prev) => !prev);
        return;
      }
      // Ctrl+J — Toggle Panel (bottom)
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setBottomPanelOpen((prev) => !prev);
        return;
      }
      // Ctrl+, — abre Settings modal
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      // Ctrl+/ — abre ShortcutsDialog (lista de atalhos)
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === '/') {
        // Só intercepta se NÃO está com foco num input editável
        // (em editor de código, Ctrl+/ é toggle line comment do Monaco).
        const active = document.activeElement;
        if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || (active as HTMLElement)?.isContentEditable) {
          return;
        }
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
        return;
      }
      // Ctrl+Shift+P — CommandPalette (lista de actions built-in)
      if (e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteMode('commands');
        return;
      }
      // Ctrl+P — Quick Open (abrir arquivo do workspace por nome).
      // Padrão universal de editores modernos. Palette modo 'files' faz fuzzy
      // search via workspaceFiles (already wired). Sem shift = arquivo, com = comando.
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteMode('files');
        return;
      }
      // Shift+Alt+F — Format Document (parity com VS Code/Cursor).
      // Dispara via custom event; MonacoEditor montado escuta e roda a action.
      // Sem guard de input: queremos disparar QUANDO o foco está no Monaco
      // (que tecnicamente é um contentEditable). Em outros inputs editáveis o
      // Monaco simplesmente não responde (nenhum editor montado).
      if (!e.ctrlKey && e.altKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('akai:editor-format'));
        return;
      }
      // Alt+Z — Toggle Word Wrap (parity com VS Code/Cursor).
      // Guard: NÃO dispara se foco em input/textarea fora do Monaco — só queremos
      // o toggle quando o user está no editor. Monaco é contentEditable, então
      // só blockamos os inputs/textarea genéricos do app (composer, search, etc).
      if (!e.ctrlKey && e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        const active = document.activeElement;
        if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') {
          return;
        }
        e.preventDefault();
        void (async () => {
          const api = window.akaiAPI?.settings;
          if (!api) return;
          const current = await api.get?.('editorWordWrap');
          await api.set?.('editorWordWrap', !(current === true));
        })();
        return;
      }
      // Ctrl+Shift+F — Abre painel Search no left pane (estilo VS Code/Cursor).
      // SearchPanel auto-focusa input ao mount.
      if (e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setLeftPaneOpen(true);
        setPrimarySidebarTab('search');
        // Se já estava em search, re-focusa via custom event.
        window.dispatchEvent(new CustomEvent('akai:focus-search'));
        return;
      }
      // Ctrl+Shift+G — Grep palette (overlay rápido, alternativa ao painel)
      if (e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setPaletteMode('grep');
        return;
      }
      // Ctrl+Shift+N — Nova chat session (multi-session tabs)
      if (e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        void handleNewChatSession();
        return;
      }
      // Ctrl+Shift+1..9 — Vai pra chat session N. e.key é o dígito mesmo com Shift no Windows
      // (em layouts pt-BR pode vir como '!', '@', etc — checamos e.code 'Digit1'..'Digit9' como fallback).
      if (e.ctrlKey && !e.altKey && e.shiftKey) {
        let n: number | null = null;
        if (/^[1-9]$/.test(e.key)) {
          n = parseInt(e.key, 10);
        } else if (/^Digit[1-9]$/.test(e.code)) {
          n = parseInt(e.code.slice(5), 10);
        }
        if (n !== null) {
          const target = chatSessions[n - 1];
          if (target) {
            e.preventDefault();
            handleSelectChatSession(target.id);
            return;
          }
        }
      }
      // Ctrl+Alt+R — Quick-switch workspace (lista workspaces conhecidos).
      // NOTA: Ctrl+R nativo é reload do Electron; Ctrl+Shift+R idem (hard reload).
      // Ctrl+Alt+R não conflita.
      if (e.ctrlKey && e.altKey && !e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        setPaletteMode('workspaces');
        return;
      }
      // Ctrl+Shift+H — Histórico de conversas do workspace atual
      if (e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setHistoryPanelOpen((prev) => !prev);
        return;
      }
      // Ctrl+Shift+Enter — Review Changes (espelha antigravity.openReviewChanges).
      // Só abre se houver edits pendentes; do contrário no-op pra evitar modal vazio.
      // Conflita com Cmd+Shift+Enter do composer (multi-line submit) só por uma fração
      // de UX — composer usa Shift+Enter sem Ctrl pra nova linha, então não há colisão.
      if (e.ctrlKey && !e.altKey && e.shiftKey && (e.key === 'Enter' || e.key === 'NumpadEnter')) {
        if (pendingReviewEdits.length > 0) {
          e.preventDefault();
          setReviewChangesOpen((prev) => !prev);
        }
        return;
      }
      // Ctrl+E — Atividade recente (arquivos abertos recentemente)
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setRecentActivityOpen((prev) => !prev);
        return;
      }
      // Ctrl+Shift+O — Outline de símbolos do arquivo central ativo
      if (e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        setSymbolOutlineOpen((prev) => !prev);
        return;
      }
      // Ctrl+P — QuickOpen (busca de arquivos no workspace)
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteMode('files');
        return;
      }
      // Ctrl+S — salva o arquivo da tab central ativa se for kind 'file' e estiver dirty.
      // Monaco já tem seu próprio Ctrl+S quando focado no editor; este aqui pega
      // os casos onde foco saiu (ex: usuário clicou na tab antes de salvar).
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        const active = centralTabs.find((t) => t.id === activeCentralTabId);
        if (active && active.kind === 'file') {
          const dirty = dirtyContents.get(active.path);
          if (dirty !== undefined) {
            e.preventDefault();
            void handleSave(active.path, dirty);
          }
        }
        return;
      }
      // Ctrl+Shift+S — Save All: persiste todos os dirty files de uma vez.
      if (e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 's') {
        if (dirtyContents.size > 0) {
          e.preventDefault();
          for (const [path, content] of dirtyContents.entries()) {
            void handleSave(path, content);
          }
        }
        return;
      }
      // Ctrl+1..9 — vai direto na tab N (1-indexed). Ctrl+0 → última tab.
      // Guard pra input editável (Monaco/textarea processam atalhos próprios).
      if (e.ctrlKey && !e.altKey && !e.shiftKey && /^[0-9]$/.test(e.key)) {
        const activeEl = document.activeElement;
        if (activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || (activeEl as HTMLElement)?.isContentEditable) {
          return;
        }
        if (centralTabs.length === 0) return;
        e.preventDefault();
        const n = parseInt(e.key, 10);
        const idx = n === 0 ? centralTabs.length - 1 : Math.min(n - 1, centralTabs.length - 1);
        setActiveCentralTabIdWithAutoSave(centralTabs[idx].id);
        return;
      }
      // Ctrl+Shift+T — reabre a última tab fechada (igual VS Code).
      if (e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        reopenLastClosedTab();
        return;
      }
      // Ctrl+L — Add Selection to Chat (Cursor signature).
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        handleAddSelectionToChat();
        return;
      }
      // Ctrl+I — Ask About Selection (prompt skeleton no chat).
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        handleAskAboutSelection();
        return;
      }
      // Alt+← / Alt+→ — Navigate Back / Forward (file history)
      if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 'ArrowLeft') {
        if (canGoBack) {
          e.preventDefault();
          navigateBack();
        }
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 'ArrowRight') {
        if (canGoForward) {
          e.preventDefault();
          navigateForward();
        }
        return;
      }
      // Ctrl+Tab — próxima tab; Ctrl+Shift+Tab — anterior. Wrap-around.
      if (e.ctrlKey && !e.altKey && e.key === 'Tab') {
        if (centralTabs.length < 2 || !activeCentralTabId) return;
        e.preventDefault();
        const idx = centralTabs.findIndex((t) => t.id === activeCentralTabId);
        if (idx < 0) return;
        const next = e.shiftKey
          ? (idx - 1 + centralTabs.length) % centralTabs.length
          : (idx + 1) % centralTabs.length;
        setActiveCentralTabId(centralTabs[next].id);
        return;
      }
      // Ctrl+Shift+N — New Window (multi-window). Sem guard de input — atalho global.
      if (e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = (window as any).akaiAPI?.window;
        if (api?.openNew) {
          void api.openNew().then((r: { count: number }) => {
            toast.success(`Nova janela aberta (${r.count} no total)`);
          });
        }
        return;
      }
      // Ctrl+Shift+M — Open Agent Manager (janela chat-focused estilo Antigravity).
      if (e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = (window as any).akaiAPI?.window;
        if (api?.openAgentManager) {
          void api.openAgentManager().then(() => {
            toast.success('Agent Manager aberto');
          });
        }
        return;
      }
      // Ctrl+N — New File. Guard pra input editável (Monaco/textarea).
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'n') {
        const activeEl = document.activeElement;
        if (activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || (activeEl as HTMLElement)?.isContentEditable) {
          return;
        }
        e.preventDefault();
        void handleNewFile();
        return;
      }
      // Ctrl+K S — Save As (chord). Primeira tecla Ctrl+K arma o chord
      // (ctrlKChordRef = timestamp). Segunda tecla "s" (sem Ctrl) dispara.
      // Timeout 1500ms pra cancelar chord se user não completar.
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        const activeEl = document.activeElement;
        if (activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || (activeEl as HTMLElement)?.isContentEditable) {
          return;
        }
        e.preventDefault();
        ctrlKChordRef.current = Date.now();
        return;
      }
      if (
        ctrlKChordRef.current > 0 &&
        Date.now() - ctrlKChordRef.current < 1500 &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === 's'
      ) {
        e.preventDefault();
        ctrlKChordRef.current = 0;
        void handleSaveAs();
        return;
      }
      // Qualquer outra tecla (que não seja Ctrl+K novamente) reseta chord.
      if (ctrlKChordRef.current > 0 && e.key !== 'Control' && e.key.toLowerCase() !== 'k') {
        ctrlKChordRef.current = 0;
      }
      // Ctrl+W — fecha a tab central ativa. Guard pra input editável.
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'w') {
        const activeEl = document.activeElement;
        if (activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || (activeEl as HTMLElement)?.isContentEditable) {
          return;
        }
        if (activeCentralTabId) {
          e.preventDefault();
          closeCentralTab(activeCentralTabId);
        }
        return;
      }
      // Ctrl+F4 — Close Editor (espelha Cursor). Mesmo handler do Ctrl+W,
      // sem guard de input editável (F4 é menos provável de colidir).
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === 'F4') {
        e.preventDefault();
        handleCloseEditor();
        return;
      }
      // ' (apóstrofo) — Toggle Preview (modo Lovable). Guard pra input editável.
      if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key === "'") {
        const active = document.activeElement;
        if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || (active as HTMLElement)?.isContentEditable) {
          return; // deixa digitar normalmente
        }
        e.preventDefault();
        setPreviewOpen((prev) => !prev);
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Deps: shortcuts de save/close precisam do state atualizado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCentralTabId, centralTabs, dirtyContents, handleSave, closeCentralTab, reopenLastClosedTab, setActiveCentralTabIdWithAutoSave, canGoBack, canGoForward, navigateBack, navigateForward, handleNewFile, handleSaveAs, chatSessions, handleNewChatSession, handleSelectChatSession, handleAddSelectionToChat, handleAskAboutSelection]);

  if (!cwd) {
    // Splash inicial enquanto getCwd() IPC resolve (~100-300ms no boot).
    // Sem o Logo `[U]` antigo: só o wordmark _UNDRCOD com cursor azul piscando
    // (mesmo brand do WelcomeView). Consistencia visual no app inteiro.
    return (
      <div className="app">
        <div className="splash">
          <h1 className="splash-wordmark">
            <span className="wordmark"><span className="wordmark-u">_</span>UNDRCOD</span>
          </h1>
        </div>
      </div>
    );
  }

  const openedFileName = openedFile ? openedFile.split(/[\\/]/).pop() : null;
  const cwdName = cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;

  // Bottom Panel — 5 tabs fixas estilo VS Code (Problems/Output/Debug Console/Terminal/Ports)
  const bottomPanelContent = (
    <BottomPanel
      cwd={cwd}
      activeTabId={activeBottomTab}
      onTabSelect={setActiveBottomTab}
      onClose={() => setBottomPanelOpen(false)}
      onToggleMaximize={() => setBottomPanelMaximized((m) => !m)}
      isMaximized={bottomPanelMaximized}
    />
  );

  return (
    <div className="app app-full">
      <div className="topbar">
        <div className="topbar-left">
          <nav className="topbar-menu">
            <button
              ref={fileMenuBtnRef}
              type="button"
              className={`topbar-menu-item ${fileMenuOpen ? 'is-active' : ''}`}
              onClick={() => {
                if (!fileMenuOpen) refreshRecentWorkspaces();
                setFileMenuOpen((p) => !p);
              }}
            >
              File
            </button>
            <button
              ref={editMenuBtnRef}
              type="button"
              className={`topbar-menu-item ${editMenuOpen ? 'is-active' : ''}`}
              onClick={() => setEditMenuOpen((p) => !p)}
            >
              Edit
            </button>
            <button
              ref={selectionMenuBtnRef}
              type="button"
              className={`topbar-menu-item ${selectionMenuOpen ? 'is-active' : ''}`}
              onClick={() => setSelectionMenuOpen((p) => !p)}
            >
              Selection
            </button>
            <button
              ref={viewMenuBtnRef}
              type="button"
              className={`topbar-menu-item ${viewMenuOpen ? 'is-active' : ''}`}
              onClick={() => setViewMenuOpen((p) => !p)}
            >
              View
            </button>
            <button
              ref={goMenuBtnRef}
              type="button"
              className={`topbar-menu-item ${goMenuOpen ? 'is-active' : ''}`}
              onClick={() => setGoMenuOpen((p) => !p)}
            >
              Go
            </button>
            <button
              ref={runMenuBtnRef}
              type="button"
              className={`topbar-menu-item ${runMenuOpen ? 'is-active' : ''}`}
              onClick={() => setRunMenuOpen((p) => !p)}
            >
              Run
            </button>
            <button
              ref={terminalMenuBtnRef}
              type="button"
              className={`topbar-menu-item ${terminalMenuOpen ? 'is-active' : ''}`}
              onClick={() => setTerminalMenuOpen((p) => !p)}
            >
              Terminal
            </button>
            <button
              ref={helpMenuBtnRef}
              type="button"
              className={`topbar-menu-item ${helpMenuOpen ? 'is-active' : ''}`}
              onClick={() => setHelpMenuOpen((p) => !p)}
            >
              Help
            </button>
          </nav>
          {/* Navigation history arrows — igual Cursor/browser. Empilha conforme
              user abre arquivos; back/forward percorre o histórico. */}
          <div className="topbar-nav">
            <button
              type="button"
              className="topbar-nav-btn"
              onClick={navigateBack}
              disabled={!canGoBack}
              title="Voltar (Alt+←)"
              aria-label="Voltar"
            >
              <i className="codicon codicon-arrow-left" />
            </button>
            <button
              type="button"
              className="topbar-nav-btn"
              onClick={navigateForward}
              disabled={!canGoForward}
              title="Avançar (Alt+→)"
              aria-label="Avançar"
            >
              <i className="codicon codicon-arrow-right" />
            </button>
          </div>
        </div>
        <div className="topbar-center hide-on-md">
          <span className="topbar-title-text">
            {cwdName}
            {openedFileName && <> · {openedFileName}</>}
          </span>
        </div>
        <div className="topbar-right">
          <button
            type="button"
            className="topbar-action-icon hide-on-sm"
            title="Personalizar layout..."
            onClick={() => setCustomizeLayoutOpen(true)}
          >
            <i className="codicon codicon-layout" />
          </button>
          <button
            type="button"
            className={`topbar-action-icon ${leftPaneOpen ? 'is-active' : ''}`}
            title="Alternar barra lateral (Ctrl+B)"
            onClick={() => setLeftPaneOpen((prev) => !prev)}
          >
            <i className="codicon codicon-layout-sidebar-left" />
          </button>
          <button
            type="button"
            className={`topbar-action-icon hide-on-sm ${bottomPanelOpen ? 'is-active' : ''}`}
            title="Alternar painel inferior (Ctrl+J)"
            onClick={() => setBottomPanelOpen((prev) => !prev)}
          >
            <i className="codicon codicon-layout-panel" />
          </button>
          <button
            type="button"
            className={`topbar-action-icon ${previewOpen ? 'is-active' : ''}`}
            title="Alternar preview — modo Lovable (')"
            onClick={() => setPreviewOpen((prev) => !prev)}
          >
            <i className="codicon codicon-play" />
          </button>
          <button
            type="button"
            className={`topbar-action-icon ${chatPaneOpen ? 'is-active' : ''}`}
            title="Alternar painel do chat (Ctrl+Alt+B)"
            onClick={() => setChatPaneOpen((prev) => !prev)}
          >
            <i className="codicon codicon-layout-sidebar-right" />
          </button>
          <button type="button" className="topbar-action-icon hide-on-md" title="Busca rápida (Ctrl+P)" onClick={handleOpenWorkspace}>
            <i className="codicon codicon-search" />
          </button>
          <button type="button" className="topbar-action-icon hide-on-md" title="Mostrar diff (git status)" onClick={openGitDiff}>
            <i className="codicon codicon-git-pull-request" />
          </button>
          <button
            type="button"
            className="topbar-action-icon"
            title="Abrir Agent Manager (Ctrl+Shift+M)"
            onClick={() => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const api = (window as any).akaiAPI?.window;
              if (api?.openAgentManager) {
                void api.openAgentManager().then(() => {
                  toast.success('Agent Manager aberto');
                });
              }
            }}
          >
            <i className="codicon codicon-comment-discussion" />
          </button>
          <div className="topbar-divider hide-on-md" />
          <button
            ref={settingsBtnRef}
            type="button"
            className={`topbar-action-icon ${settingsMenuOpen ? 'is-active' : ''}`}
            title="Configurações (Ctrl+,)"
            onClick={() => setSettingsMenuOpen((p) => !p)}
          >
            <i className="codicon codicon-settings-gear" />
          </button>
          <button
            ref={accountBtnRef}
            type="button"
            className={`topbar-account-btn ${accountMenuOpen ? 'is-active' : ''}`}
            title={systemInfo ? `Conta: ${systemInfo.username}` : 'Conta'}
            onClick={() => {
              setAccountMenuOpen((p) => {
                const next = !p;
                // Quando ABRE o popover, força refresh do auth pra capturar
                // mudanças recentes (login completou em outra janela, token
                // refreshed pelo CLI, .credentials.json editado manualmente).
                // window.focus event sozinho não é confiável — Electron não
                // sempre dispara quando popover do mesmo app abre.
                if (next) auth.refresh();
                return next;
              });
            }}
          >
            <span className="topbar-account-avatar">
              {systemInfo?.username?.[0]?.toUpperCase() || '?'}
            </span>
            <i className="codicon codicon-chevron-down topbar-account-chevron" />
          </button>
          <span className={`status-badge status-${status} hide-on-md`}>{statusLabel(status)}</span>
          <WindowControls />
        </div>
      </div>

      <div className="main-content main-content-resizable">
        {/* Layout horizontal: pane-left | pane-mid (com bottom-panel interno) | pane-right | pane-extra */}
        {leftPaneOpen && (
          <>
            <div className="pane-left" style={{ width: leftPaneWidth }}>
              <div className="pane-left-tabs pane-left-tabs-icons">
                <button
                  type="button"
                  className={`pane-left-tab pane-left-tab-icon ${primarySidebarTab === 'files' ? 'is-active' : ''}`}
                  onClick={() => setPrimarySidebarTab('files')}
                  title="Arquivos"
                  aria-label="Arquivos"
                >
                  <i className="codicon codicon-files" />
                </button>
                <button
                  type="button"
                  className={`pane-left-tab pane-left-tab-icon ${primarySidebarTab === 'search' ? 'is-active' : ''}`}
                  onClick={() => setPrimarySidebarTab('search')}
                  title="Pesquisar no workspace"
                  aria-label="Pesquisar no workspace"
                >
                  <i className="codicon codicon-search" />
                </button>
                <button
                  type="button"
                  className={`pane-left-tab pane-left-tab-icon ${primarySidebarTab === 'git' ? 'is-active' : ''}`}
                  onClick={() => setPrimarySidebarTab('git')}
                  title="Source Control"
                  aria-label="Source control"
                >
                  <i className="codicon codicon-source-control" />
                </button>
                <button
                  type="button"
                  className="pane-left-tab pane-left-tab-icon"
                  onClick={() => setPluginMarketplaceOpen(true)}
                  title="Extensões (plugins & MCP servers)"
                  aria-label="Extensões"
                >
                  <i className="codicon codicon-extensions" />
                </button>
                <button
                  type="button"
                  className="pane-left-tab pane-left-tab-icon"
                  onClick={(e) => {
                    // Abre menu suspenso ancorado nesse botão (more options).
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    window.dispatchEvent(new CustomEvent('akai:open-more-menu', {
                      detail: { x: rect.left, y: rect.bottom + 4 },
                    }));
                  }}
                  title="Mais opções"
                  aria-label="Mais opções"
                >
                  <i className="codicon codicon-ellipsis" />
                </button>
              </div>
              <div className="pane-left-content">
                {primarySidebarTab === 'files' ? (
                  <div className="pane-left-files-stack">
                    <div className="pane-left-files-tree">
                      <FileTree
                        workspaceRoot={cwd}
                        onOpenWorkspace={handleOpenWorkspace}
                        onFileOpen={openFileTab}
                        onMention={handleMentionFromTree}
                        activeFilePath={openedFile}
                      />
                    </div>
                    <OutlineSection
                      filePath={openedFile}
                      content={openedFile ? (dirtyContents.get(openedFile) ?? null) : null}
                    />
                    <TimelineSection cwd={cwd} filePath={openedFile} />
                  </div>
                ) : primarySidebarTab === 'search' ? (
                  <SearchPanel
                    cwd={cwd}
                    onMatchClick={(filePath, line, matchStart, matchEnd) =>
                      openFileTab(filePath, line, matchStart, matchEnd)
                    }
                  />
                ) : (
                  <SourceControl
                    cwd={cwd}
                    onOpenDiff={openGitDiff}
                    onCommit={() => setCommitDialogOpen(true)}
                  />
                )}
              </div>
            </div>
            <Splitter
              orientation="vertical"
              onResize={(dx) => setLeftPaneWidth((w) => Math.max(180, Math.min(600, w + dx)))}
            />
          </>
        )}

        <div className="pane-mid">
          <div className="pane-mid-editor">
            <CentralTabs
              tabs={centralTabs}
              activeTabId={activeCentralTabId}
              onSelect={setActiveCentralTabIdWithAutoSave}
              onClose={closeCentralTab}
              workspaceRoot={cwd || undefined}
              dirtyPaths={new Set(dirtyContents.keys())}
              onPin={(id) => {
                setCentralTabs((prev) =>
                  prev.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)),
                );
              }}
              onReorder={(newOrder) => {
                // Reordena array de tabs respeitando a nova ordem de ids do CentralTabs.
                setCentralTabs((prev) => {
                  const byId = new Map(prev.map((t) => [t.id, t]));
                  const reordered: typeof prev = [];
                  for (const id of newOrder) {
                    const t = byId.get(id);
                    if (t) reordered.push(t);
                  }
                  // Garante que nenhuma tab perdida fique fora (defensivo)
                  for (const t of prev) {
                    if (!newOrder.includes(t.id)) reordered.push(t);
                  }
                  return reordered;
                });
              }}
            />
            {previewOpen ? (() => {
              // Feature flag: undrcode.previewVersion = 'v1' | 'v2' | 'v3'.
              //   - v1 (default): <webview> tag legacy com CSS Inspector completo.
              //   - v2: WebContentsView via main process (Cursor pattern). BUG: view
              //     compositada fica visivel mesmo apos fechar tab as vezes.
              //   - v3: <iframe> puro (Cursor Simple Browser pattern). Sem CSS
              //     Inspector mas comportamento DOM normal.
              // Default V1 (<webview> tag). DESCOBERTA: Cursor Simple Browser
              // usa EXATAMENTE esse pattern — `<webview>` tag dentro de div
              // position:fixed, layouts via CSS (não setBounds nativo). V2
              // (WebContentsView) é path paralelo no Cursor mas só pra
              // headless/offscreen, NUNCA chamado pra Simple Browser visible.
              // V2 e V3 ficam acessíveis via localStorage pra debug.
              let previewVersion: 'v1' | 'v2' | 'v3' = 'v1';
              if (typeof localStorage !== 'undefined') {
                const raw = localStorage.getItem('undrcode.previewVersion');
                if (raw === 'v1' || raw === 'v2' || raw === 'v3') {
                  previewVersion = raw;
                } else if (localStorage.getItem('undrcode.previewV2') === 'true') {
                  previewVersion = 'v2';
                }
              }
              const handleNavigate = (navUrl: string) => {
                // Quando o preview navega (click em <a>, etc), se for file://
                // dentro do workspace, abre/switch pra tab daquele arquivo no
                // CentralTabs. Ignora http(s) (nao tem arquivo correspondente)
                // e file:// fora do workspace (nao polui tabs com arbitrario).
                if (!navUrl.startsWith('file:///')) return;
                try {
                  const u = new URL(navUrl);
                  let pathname = decodeURIComponent(u.pathname);
                  if (/^\/[a-zA-Z]:\//.test(pathname)) pathname = pathname.slice(1);
                  const localPath = pathname.replace(/\//g, '\\');
                  if (cwd && !localPath.toLowerCase().startsWith(cwd.toLowerCase())) return;
                  openFileTab(localPath);
                } catch { /* URL parse falhou — ignora */ }
              };
              if (previewVersion === 'v3') {
                return (
                  <PreviewViewV3
                    cwd={cwd}
                    initialUrl={previewUrl}
                    onUrlChange={setPreviewUrl}
                    onNavigate={handleNavigate}
                    onClose={() => setPreviewOpen(false)}
                    onMention={handleMentionFromPreview}
                  />
                );
              }
              if (previewVersion === 'v2') {
                return (
                  <PreviewViewV2
                    cwd={cwd}
                    initialUrl={previewUrl}
                    onUrlChange={setPreviewUrl}
                    onNavigate={handleNavigate}
                    onClose={() => setPreviewOpen(false)}
                  />
                );
              }
              return (
                <PreviewView
                  cwd={cwd}
                  initialUrl={previewUrl}
                  onUrlChange={setPreviewUrl}
                  onNavigate={handleNavigate}
                  onClose={() => setPreviewOpen(false)}
                />
              );
            })() : (() => {
              const active = centralTabs.find((t) => t.id === activeCentralTabId);
              if (!active) {
                return (
                  <WelcomeView
                    cwd={cwd}
                    onOpenWorkspace={handleOpenWorkspace}
                    onOpenRecent={(path) => setCwd(path)}
                    onOpenPreview={() => setPreviewOpen(true)}
                    onResumeLast={handleResumeSession}
                  />
                );
              }
              if (active.kind === 'file') {
                return (
                  <FilePreview
                    key={active.path}
                    path={active.path}
                    cwd={cwd}
                    onClose={() => closeCentralTab(active.id)}
                    onMention={handleMentionFromPreview}
                    dirtyContent={dirtyContents.get(active.path)}
                    onContentChange={(c) => handleContentChange(active.path, c)}
                    onSave={(c) => handleSave(active.path, c)}
                    theme={editorTheme}
                    hideHeader={true}
                    gotoLine={active.gotoLine}
                    matchStart={active.matchStart}
                    matchEnd={active.matchEnd}
                  />
                );
              }
              if (active.kind === 'compare') {
                return (
                  <FileCompareView
                    key={active.id}
                    leftPath={active.leftPath}
                    rightPath={active.rightPath}
                    theme={editorTheme}
                    cwd={cwd}
                    onClose={() => closeCentralTab(active.id)}
                  />
                );
              }
              // active.kind === 'view' — render conteudo da view
              return (
                <CentralViewContent
                  viewId={active.viewId}
                  cwd={cwd}
                  tasks={sessionInfo.tasks}
                  assistantMessages={sessionInfo.assistantMessages}
                  onResumeSession={handleResumeSession}
                  onNewConversation={handleNewConversation}
                />
              );
            })()}
          </div>

          {bottomPanelOpen && (
            <>
              {!bottomPanelMaximized && (
                <Splitter
                  orientation="horizontal"
                  onResize={(dy) => setBottomPanelHeight((h) => Math.max(120, Math.min(600, h - dy)))}
                />
              )}
              <div
                className={`bottom-panel ${bottomPanelMaximized ? 'is-maximized' : ''}`}
                style={{ height: bottomPanelMaximized ? 'calc(100vh - 80px)' : bottomPanelHeight }}
              >
                {bottomPanelContent}
              </div>
            </>
          )}
        </div>

        {chatPaneOpen && (
          <>
            <Splitter
              orientation="vertical"
              onResize={(dx) => setChatPaneWidth((w) => Math.max(320, Math.min(900, w - dx)))}
            />
            <div
              className="pane-right"
              style={{ width: chatPaneWidth }}
              data-chat-font={transcriptFontSize}
              data-chat-mode={transcriptMode}
            >
              <ChatSessionTabs
                sessions={chatSessions}
                activeId={activeChatSessionId}
                onSelect={handleSelectChatSession}
                onClose={handleCloseChatSession}
                onNew={handleNewChatSession}
                onRename={handleRenameChatSession}
                onDuplicate={handleDuplicateChatSession}
              />
              <ChatView
                key={`${cwd}|${activeChatSessionId || resumeSessionId || 'new'}`}
                cwd={cwd}
                onStatusChange={setStatus}
                onSessionInfoChange={setSessionInfo}
                prefillInput={chatPrefill}
                transcriptMode={transcriptMode}
                transcriptFontSize={transcriptFontSize}
                resumeSessionId={activeChatSessionId || resumeSessionId}
                onOpenMcpManager={() => setMcpManagerOpen(true)}
                onOpenPluginMarketplace={() => setPluginMarketplaceOpen(true)}
                onOpenCustomization={() => setCustomizationOpen(true)}
              />
            </div>
          </>
        )}

      </div>

      <StatusBar cwd={cwd} info={sessionInfo} dirtyCount={dirtyContents.size} />

      <TranscriptView
        open={transcriptOpen}
        onClose={() => setTranscriptOpen(false)}
        anchorRef={transcriptBtnRef}
        mode={transcriptMode}
        fontSize={transcriptFontSize}
        onModeChange={setTranscriptMode}
        onFontSizeChange={setTranscriptFontSize}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      <McpManager
        open={mcpManagerOpen}
        onClose={() => setMcpManagerOpen(false)}
        cwd={cwd}
        onOpenRawJson={(scope) => {
          const fn = window.akaiAPI?.mcp?.openConfig;
          if (typeof fn !== 'function') return;
          fn(scope, cwd).then((res) => {
            if ('error' in res) return;
            openFileTab(res.path);
          });
        }}
      />

      <PluginMarketplace
        open={pluginMarketplaceOpen}
        onClose={() => setPluginMarketplaceOpen(false)}
      />

      <CustomizationTabs
        open={customizationOpen}
        cwd={cwd}
        onClose={() => setCustomizationOpen(false)}
        onOpenMcpManager={() => {
          setCustomizationOpen(false);
          setMcpManagerOpen(true);
        }}
      />

      <ShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      <SnippetsManager
        open={snippetsManagerOpen}
        onClose={() => setSnippetsManagerOpen(false)}
      />

      <HistoryPanel
        open={historyPanelOpen}
        cwd={cwd}
        onClose={() => setHistoryPanelOpen(false)}
        onResume={(sid) => {
          setHistoryPanelOpen(false);
          // Reusa o handler existente — cwd já é o atual, então só seta o resumeSessionId
          // e força o ChatView a remontar (key muda por causa do resumeSessionId).
          handleResumeSession(cwd, sid);
        }}
      />

      <ReviewChanges
        open={reviewChangesOpen}
        edits={pendingReviewEdits}
        onClose={() => setReviewChangesOpen(false)}
        onAcceptAll={handleReviewAcceptAll}
        onRejectAll={handleReviewRejectAll}
        onAccept={handleReviewAccept}
        onReject={handleReviewReject}
      />

      <RecentActivity
        open={recentActivityOpen}
        cwd={cwd}
        onClose={() => setRecentActivityOpen(false)}
        onOpenFile={(path) => openFileTab(path)}
      />

      {(() => {
        // Outline de símbolos: usa o tab central ativo se for 'file'. dirtyContent
        // tem prioridade no parser (reflete edits unsaved no Monaco).
        const activeTab = centralTabs.find((t) => t.id === activeCentralTabId);
        const activeFilePath = activeTab && activeTab.kind === 'file' ? activeTab.path : null;
        const dirty = activeFilePath ? dirtyContents.get(activeFilePath) : undefined;
        return (
          <SymbolOutline
            open={symbolOutlineOpen}
            filePath={activeFilePath}
            dirtyContent={dirty}
            onClose={() => setSymbolOutlineOpen(false)}
          />
        );
      })()}

      <CheckpointPanel
        open={checkpointPanelOpen}
        cwd={cwd}
        onClose={() => setCheckpointPanelOpen(false)}
      />

      {/* "Mais opções" menu — disparado pelo botão chevron da sidebar pane-left.
       * Itens convergem pros modais já existentes (Settings/Shortcuts/Plugins/Customization). */}
      <ContextMenu
        open={moreMenuPos !== null}
        x={moreMenuPos?.x ?? 0}
        y={moreMenuPos?.y ?? 0}
        items={[
          {
            kind: 'item',
            icon: 'settings-gear',
            label: 'Configurações',
            shortcut: 'Ctrl ,',
            onClick: () => { setMoreMenuPos(null); setSettingsOpen(true); },
          },
          {
            kind: 'item',
            icon: 'keyboard',
            label: 'Atalhos do teclado',
            shortcut: 'Ctrl /',
            onClick: () => { setMoreMenuPos(null); setShortcutsOpen(true); },
          },
          {
            kind: 'item',
            icon: 'history',
            label: 'Histórico de conversas',
            shortcut: 'Ctrl Shift H',
            onClick: () => { setMoreMenuPos(null); setHistoryPanelOpen(true); },
          },
          {
            kind: 'item',
            icon: 'bookmark',
            label: 'Checkpoints',
            onClick: () => { setMoreMenuPos(null); setCheckpointPanelOpen(true); },
          },
          {
            kind: 'item',
            icon: 'symbol-snippet',
            label: 'Gerenciar snippets',
            shortcut: 'Ctrl ;',
            onClick: () => { setMoreMenuPos(null); setSnippetsManagerOpen(true); },
          },
          { kind: 'divider' },
          // Removidos do menu Mais opções (já existem em outros menus canônicos):
          //   - "Atividade recente" → fica em File menu (Open Recent) + Go menu
          //   - "Refazer tour" → fica em Help menu
          //   - "Trocar workspace" → fica em File menu (Open Workspace)
          // Mantemos apenas itens UNIQUE a este menu de "ferramentas/sistema".
          {
            kind: 'item',
            icon: 'clear-all',
            label: 'Limpar estado do workspace',
            onClick: () => {
              setMoreMenuPos(null);
              if (cwd) clearWorkspaceState(cwd);
              window.location.reload();
            },
          },
          { kind: 'divider' },
          {
            kind: 'item',
            icon: 'color-mode',
            label: `Tema: ${theme === 'akai' ? 'Akai' : theme === 'antigravity-dark' ? 'Antigravity Dark' : 'Light'} (clique pra ciclar)`,
            onClick: () => {
              // Cicla akai → antigravity-dark → light → akai. Salva imediato via settings IPC
              // pra sincronizar com SettingsModal e persistir entre boots.
              const next: Theme = theme === 'akai' ? 'antigravity-dark' : theme === 'antigravity-dark' ? 'light' : 'akai';
              setTheme(next);
              window.akaiAPI?.settings?.set?.('theme', next).catch(() => { /* ignore */ });
              setMoreMenuPos(null);
            },
          },
        ] satisfies ContextMenuItem[]}
        onClose={() => setMoreMenuPos(null)}
      />

      <CommitDialog
        open={commitDialogOpen}
        onClose={() => setCommitDialogOpen(false)}
        cwd={cwd}
        stagedCount={0}
      />

      {/* Host global pro confirmDialog() imperativo. Só renderiza modal quando alguem chama. */}
      <ConfirmDialogHost />

      {/* Host global pro toast() imperativo. Stack de notificações no canto inferior direito. */}
      <ToastHost />

      {/* Detector de dev servers — banner top-right quando porta nova aparece. */}
      <DevServerBanner />

      {/* Onboarding tour — primeira vez OR re-trigger via comando "Refazer tour" */}
      <Onboarding open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />

      {/* GlobalTooltip — intercepta TODOS os title="..." do app e renderiza
          tooltip estilizado em portal. Mount uma vez aqui. */}
      <GlobalTooltip />

      {diffViewerData && (
        <div className="diff-viewer-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeDiffViewer(); }}>
          <div className="diff-viewer-modal">
            <div className="diff-viewer-header">
              <span className="diff-viewer-title">
                <i className="codicon codicon-git-pull-request" />
                <strong>{diffViewerData.filePath}</strong>
                <span className="diff-viewer-subtitle">working tree vs HEAD</span>
              </span>
              <div className="diff-viewer-header-actions">
                <button type="button" className="diff-viewer-close" onClick={openGitDiff} title="Atualizar diff">
                  <i className="codicon codicon-refresh" />
                </button>
                <button type="button" className="diff-viewer-close" onClick={closeDiffViewer} title="Fechar (Esc)">
                  <i className="codicon codicon-close" />
                </button>
              </div>
            </div>
            {diffViewerData.hunks.length > 0 ? (
              <DiffViewer
                ref={diffViewerRef}
                filePath={diffViewerData.filePath}
                hunks={diffViewerData.hunks}
                theme={editorTheme}
                onAccept={handleHunkAccept}
                onReject={handleHunkReject}
                onRejectAll={handleRejectAll}
                error={diffError}
              />
            ) : (
              <div className="diff-viewer-empty">
                <i className="codicon codicon-check" />
                <p>No changes in working tree</p>
              </div>
            )}
          </div>
        </div>
      )}

      <Palette
        open={paletteMode !== null}
        mode={paletteMode ?? 'commands'}
        onClose={() => setPaletteMode(null)}
        cwd={cwd}
        onOpenFile={openFileTab}
        onExecuteCommand={handleCommandExec}
        onSelectWorkspace={(path) => {
          // Reaproveita o evento que FileTree dispara — App listener já trata
          // (reset de cwd, sessionInfo, central tabs).
          window.dispatchEvent(new CustomEvent('akai:set-workspace', { detail: { cwd: path } }));
        }}
      />

      <CustomizeLayout
        open={customizeLayoutOpen}
        onClose={() => setCustomizeLayoutOpen(false)}
        toggles={[
          {
            id: 'primary-sidebar',
            label: 'Primary Side Bar',
            shortcut: ['Ctrl', 'B'],
            value: leftPaneOpen,
            onChange: setLeftPaneOpen,
          },
          {
            id: 'secondary-sidebar',
            label: 'Secondary Side Bar (Chat)',
            shortcut: ['Ctrl', 'Alt', 'B'],
            value: chatPaneOpen,
            onChange: setChatPaneOpen,
          },
          {
            id: 'panel',
            label: 'Panel',
            shortcut: ['Ctrl', 'J'],
            value: bottomPanelOpen,
            onChange: setBottomPanelOpen,
          },
        ]}
      />

      <ComposerPopover
        open={fileMenuOpen}
        onClose={() => setFileMenuOpen(false)}
        anchorRef={fileMenuBtnRef}
        items={fileMenuItems}
        placement="bottom"
        align="left"
        minWidth={240}
      />

      <ComposerPopover
        open={editMenuOpen}
        onClose={() => setEditMenuOpen(false)}
        anchorRef={editMenuBtnRef}
        items={editMenuItems}
        placement="bottom"
        align="left"
        minWidth={240}
      />

      <ComposerPopover
        open={selectionMenuOpen}
        onClose={() => setSelectionMenuOpen(false)}
        anchorRef={selectionMenuBtnRef}
        items={selectionMenuItems}
        placement="bottom"
        align="left"
        minWidth={240}
      />

      <ComposerPopover
        open={viewMenuOpen}
        onClose={() => setViewMenuOpen(false)}
        anchorRef={viewMenuBtnRef}
        items={viewMenuItems}
        placement="bottom"
        align="left"
        minWidth={240}
      />

      <ComposerPopover
        open={goMenuOpen}
        onClose={() => setGoMenuOpen(false)}
        anchorRef={goMenuBtnRef}
        items={goMenuItems}
        placement="bottom"
        align="left"
        minWidth={240}
      />

      <ComposerPopover
        open={runMenuOpen}
        onClose={() => setRunMenuOpen(false)}
        anchorRef={runMenuBtnRef}
        items={runMenuItems}
        placement="bottom"
        align="left"
        minWidth={240}
      />

      <ComposerPopover
        open={terminalMenuOpen}
        onClose={() => setTerminalMenuOpen(false)}
        anchorRef={terminalMenuBtnRef}
        items={terminalMenuItems}
        placement="bottom"
        align="left"
        minWidth={240}
      />

      <ComposerPopover
        open={helpMenuOpen}
        onClose={() => setHelpMenuOpen(false)}
        anchorRef={helpMenuBtnRef}
        items={helpMenuItems}
        placement="bottom"
        align="left"
        minWidth={240}
      />

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

      <ComposerPopover
        open={settingsMenuOpen}
        onClose={() => setSettingsMenuOpen(false)}
        anchorRef={settingsBtnRef}
        items={settingsMenuItems}
        placement="bottom"
        align="right"
        minWidth={280}
      />

      <ComposerPopover
        open={accountMenuOpen}
        onClose={() => setAccountMenuOpen(false)}
        anchorRef={accountBtnRef}
        items={accountMenuItems}
        placement="bottom"
        align="right"
        minWidth={280}
      />
    </div>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'thinking': return '● pensando';
    case 'ready': return '● pronto';
    case 'error': return '● erro';
    default: return '○ idle';
  }
}
