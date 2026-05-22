/**
 * PreviewViewV2 — preview usando WebContentsView (Cursor pattern).
 *
 * Diferença do PreviewView original (V1):
 *   - V1 usa <webview> tag (Electron BrowserView nativo compositado)
 *   - V2 usa WebContentsView gerenciada pelo main process (mesma API VS Code/Cursor)
 *
 * Resolve definitivamente:
 *   - Outside-click: previewView.hide() move pra off-screen quando menu host aberto
 *   - DevTools dockado: openDevTools({mode:'right'}) funciona em WebContentsView
 *   - CSS Inspector: previewView.executeJavaScript funciona igual ao webview
 *
 * Pra ativar: setting `previewUseV2=true` (App.tsx alterna entre V1 e V2).
 * V2 ainda é MINIMAL — só features essenciais. Validar primeiro, depois portamos
 * CSS Inspector inteiro pra V2.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface PreviewViewV2Props {
  cwd: string | null;
  initialUrl: string;
  onUrlChange: (url: string) => void;
  onNavigate?: (url: string) => void;
  onClose: () => void;
  /** Quando true, V2 hide() a view (off-screen) — pra outside-click funcionar. */
  anyMenuOpen?: boolean;
}

interface UNDRCODPreviewViewAPI {
  create: (initialUrl: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<{ ok: boolean; viewId?: number; error?: string }>;
  destroy: (viewId: number) => Promise<{ ok: boolean; error?: string }>;
  setBounds: (viewId: number, bounds: { x: number; y: number; width: number; height: number }) => Promise<{ ok: boolean }>;
  hide: (viewId: number) => Promise<{ ok: boolean }>;
  show: (viewId: number) => Promise<{ ok: boolean }>;
  loadURL: (viewId: number, url: string) => Promise<{ ok: boolean }>;
  back: (viewId: number) => Promise<{ ok: boolean }>;
  forward: (viewId: number) => Promise<{ ok: boolean }>;
  reload: (viewId: number, ignoreCache?: boolean) => Promise<{ ok: boolean }>;
  canGoBack: (viewId: number) => Promise<{ ok: boolean; canGoBack: boolean }>;
  canGoForward: (viewId: number) => Promise<{ ok: boolean; canGoForward: boolean }>;
  getURL: (viewId: number) => Promise<{ ok: boolean; url: string }>;
  openDevTools: (viewId: number, mode?: 'right' | 'bottom' | 'undocked' | 'detach') => Promise<{ ok: boolean }>;
  closeDevTools: (viewId: number) => Promise<{ ok: boolean }>;
  isDevToolsOpened: (viewId: number) => Promise<{ ok: boolean; isOpen: boolean }>;
  setZoomFactor: (viewId: number, factor: number) => Promise<{ ok: boolean }>;
  onEvent: (viewId: number, cb: (channel: string, ...args: unknown[]) => void) => () => void;
}

function getAPI(): UNDRCODPreviewViewAPI | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = window.undrcodAPI?.previewView as UNDRCODPreviewViewAPI | undefined;
  return api ?? null;
}

export function PreviewViewV2({ initialUrl, onUrlChange, onNavigate, onClose, anyMenuOpen }: PreviewViewV2Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  const viewIdRef = useRef<number | null>(null);
  const [url, setUrl] = useState(initialUrl);
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(false);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);

  // === Lifecycle: cria/destroi WebContentsView ============================
  //
  // Teste manual Bug 1 (preview fica visível após fechar):
  //   1. localStorage.setItem('undrcode.previewV2','true') + reload
  //   2. Abre preview, espera carregar
  //   3. Clica X (fechar preview)
  //   EXPECTED: WebContentsView some imediatamente, sem fantasma sobre o editor
  //   Console DEVE ter:
  //     - "[PreviewViewV2] cleanup: unmount detected" (do React)
  //     - "[PreviewViewV2] cleanup: calling destroy() for viewId=X"
  //     - "[previewView] destroy: viewId=X starting cleanup" (do main)
  //     - "[previewView] destroy: setVisible(false) ok" (do main)
  //     - "[previewView] destroy: removeChildView ok" (do main)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const api = getAPI();
    if (!api) {
      console.warn('[PreviewViewV2] undrcodAPI.previewView not available');
      return;
    }

    let cancelled = false;
    let createdViewId: number | null = null;
    let cleanupEvents: (() => void) | null = null;

    const rect = container.getBoundingClientRect();
    const bounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    console.log('[PreviewViewV2] mount: creating view with bounds=', bounds); // DEBUG:
    void api.create(initialUrl, bounds).then((res) => {
      if (cancelled) {
        // Componente foi desmontado ANTES da create resolver — destroy imediato
        // pra evitar leak. Sem isso, view fica órfã se mount+unmount rapido.
        if (res.ok && res.viewId) {
          console.log('[PreviewViewV2] mount: cancelled mid-create, destroying viewId=', res.viewId); // DEBUG:
          void api.destroy(res.viewId);
        }
        return;
      }
      if (!res.ok || !res.viewId) {
        console.error('[PreviewViewV2] create failed:', res.error);
        return;
      }
      createdViewId = res.viewId;
      viewIdRef.current = res.viewId;
      setViewId(res.viewId);
      console.log('[PreviewViewV2] view created, id=', res.viewId);

      // Subscribe a eventos do webContents
      cleanupEvents = api.onEvent(res.viewId, (channel, ...args) => {
        switch (channel) {
          case 'previewView:event:loading-start':
            setLoading(true);
            break;
          case 'previewView:event:loading-stop':
            setLoading(false);
            // Refresh canGoBack/Forward depois de cada loading
            void api.canGoBack(res.viewId!).then((r) => setCanGoBack(r.canGoBack));
            void api.canGoForward(res.viewId!).then((r) => setCanGoForward(r.canGoForward));
            break;
          case 'previewView:event:did-navigate':
          case 'previewView:event:did-navigate-in-page': {
            const newUrl = args[0] as string;
            setUrl(newUrl);
            setUrlInput(newUrl);
            onUrlChange(newUrl);
            onNavigate?.(newUrl);
            break;
          }
          case 'previewView:event:devtools-opened':
            setDevtoolsOpen(true);
            break;
          case 'previewView:event:devtools-closed':
            setDevtoolsOpen(false);
            break;
        }
      });
    });

    return () => {
      console.log('[PreviewViewV2] cleanup: unmount detected'); // DEBUG:
      cancelled = true;
      if (cleanupEvents) cleanupEvents();
      if (createdViewId !== null) {
        console.log('[PreviewViewV2] cleanup: calling destroy() for viewId=', createdViewId); // DEBUG:
        void api.destroy(createdViewId);
      } else {
        console.log('[PreviewViewV2] cleanup: no viewId to destroy (create not resolved yet)'); // DEBUG:
      }
      viewIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount/unmount only — bounds updates via ResizeObserver

  // === ResizeObserver: sincroniza bounds com container ====================
  // Inclui detecção de "container hidden" — se offsetParent é null OU bounds
  // viraram zero, esconde a view automaticamente. Resolve glitch de
  // WebContentsView ficar visível quando preview pane é fechado ou trocado.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || viewId === null) return;
    const api = getAPI();
    if (!api) return;

    let lastBounds = { x: -1, y: -1, width: -1, height: -1 };
    let lastHidden = false;
    let rafId: number | null = null;

    const updateBounds = (): void => {
      // Detecta se container está visível no DOM. offsetParent==null significa
      // display:none ou removido. width/height zero significa container colapsado.
      const isVisible = container.offsetParent !== null && container.isConnected;
      const rect = container.getBoundingClientRect();
      const bounds = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      const tooSmall = bounds.width < 4 || bounds.height < 4;
      const shouldHide = !isVisible || tooSmall;

      if (shouldHide && !lastHidden) {
        lastHidden = true;
        void api.hide(viewId);
        return;
      }
      if (!shouldHide && lastHidden) {
        lastHidden = false;
        void api.show(viewId);
        // continua pra atualizar bounds
      }

      if (lastHidden) return; // skip setBounds se hidden

      if (bounds.x === lastBounds.x && bounds.y === lastBounds.y && bounds.width === lastBounds.width && bounds.height === lastBounds.height) {
        return;
      }
      lastBounds = bounds;
      // DEBUG: investigar barras pretas em volta do conteúdo preview.
      // JSON.stringify pra atravessar a console-message bridge (que serializa
      // o segundo argumento como [object Object]).
      console.log('[PreviewViewV2 BOUNDS] ' + JSON.stringify({
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          x: rect.x,
          y: rect.y,
        },
        bounds,
        windowDPR: window.devicePixelRatio,
        windowInner: { w: window.innerWidth, h: window.innerHeight },
        windowOuter: { w: window.outerWidth, h: window.outerHeight },
        containerOffsetParent: (container.offsetParent as HTMLElement | null)?.tagName ?? null,
        containerClientSize: { w: container.clientWidth, h: container.clientHeight },
        containerOffsetSize: { w: container.offsetWidth, h: container.offsetHeight },
      }));
      void api.setBounds(viewId, bounds);
    };

    const scheduleUpdate = (): void => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updateBounds();
      });
    };

    // ResizeObserver pro próprio container
    const ro = new ResizeObserver(scheduleUpdate);
    ro.observe(container);
    // IntersectionObserver pra detectar quando sai do viewport (clipping)
    const io = new IntersectionObserver(scheduleUpdate, { threshold: 0 });
    io.observe(container);
    // MutationObserver pra detectar mudanças de style/class no ancestor (display:none, etc)
    const mo = new MutationObserver(scheduleUpdate);
    let ancestor: HTMLElement | null = container;
    while (ancestor) {
      mo.observe(ancestor, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
      ancestor = ancestor.parentElement;
    }
    // Window resize também afeta bounds absolutos
    window.addEventListener('resize', scheduleUpdate);
    // Scroll do parent move o container — observa scroll global
    window.addEventListener('scroll', scheduleUpdate, true);
    // Poll fallback a 200ms — defensivo contra cases que nenhum observer pega
    const fallbackPoll = window.setInterval(scheduleUpdate, 200);

    // Initial sync
    updateBounds();

    return () => {
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
      window.clearInterval(fallbackPoll);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [viewId]);

  // === Outside-click: hide() quando menu aberto ============================
  // Auto-detect via DOM polling: se .context-menu existe E é visível, esconde
  // a WebContentsView + fecha DevTools temporariamente. Isso permite que o
  // menu (DOM normal) fique visualmente em cima E que clicks fora dele
  // (no DOM normal agora exposto) fechem ele.
  //
  // BUG FIX (outside-click não funcionava em CentralTabs "..." menu):
  //   - O check anterior usava `offsetParent !== null` pra detectar
  //     visibilidade. MAS .context-menu tem `position: fixed`, e elementos
  //     fixed-positioned têm `offsetParent === null` quando NÃO há ancestor
  //     com `transform`/`filter`/`perspective` (caso comum). Resultado:
  //     polling NUNCA detectava o menu aberto → preview NUNCA escondia.
  //   - Fix: trocar pra getClientRects().length > 0 — funciona pra fixed,
  //     absolute, e relative. Combinado com getComputedStyle().visibility/
  //     display checks pra robustez total.
  //
  // Polling 50ms (era 80) = ~20fps, mais responsivo. Skip se viewId não pronto.
  //
  // Teste manual:
  //   1. localStorage.setItem('undrcode.previewV2','true') + reload
  //   2. Abre preview
  //   3. Clica "..." no canto direito do CentralTabs strip
  //   EXPECTED: menu "Fechar todas / Ctrl K W" aparece visível, preview some
  //   ANTES DO FIX: menu fica atrás do preview (invisível)
  const wasHiddenRef = useRef(false);
  const wasDevtoolsOpenRef = useRef(false);
  useEffect(() => {
    const api = getAPI();
    if (!api || viewId === null) return;

    const isElementVisible = (el: HTMLElement): boolean => {
      // getClientRects().length > 0 funciona pra fixed/absolute/relative.
      // Elementos com display:none têm length=0; com visibility:hidden têm length>0
      // mas o rect existe — então combinamos com getComputedStyle pra robustez.
      const rects = el.getClientRects();
      if (rects.length === 0) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden') return false;
      // opacity:0 também consideramos "invisível" pra UX — menu fadeIn animation
      // começa com opacity:0 mas vai pra 1 em <140ms, então isso só fica false
      // num primeiríssimo frame. Aceitável.
      return true;
    };

    const checkMenuOpen = (): boolean => {
      // Pega TODOS os elementos com classe context-menu OU role=menu.
      // Inclui também .composer-popover (ComposerPopover do ChatView) e
      // .command-menu (CommandMenu/Palette) — qualquer overlay flutuante
      // do app deveria forçar o preview a esconder pro outside-click funcionar.
      const menus = document.querySelectorAll(
        '.context-menu, [role="menu"], .composer-popover, .command-menu, .undrcod-popover, [data-popover-open="true"]',
      );
      for (const m of menus) {
        if (isElementVisible(m as HTMLElement)) return true;
      }
      return false;
    };

    // PERF: trocado polling 50ms (20Hz) por MutationObserver no body.
    // Antes: querySelector com 6 seletores a cada 50ms = 25-30 callbacks/s
    // queimando ~2% CPU contínuo enquanto preview aberto.
    // Agora: callback só dispara quando DOM muda (menu abre/fecha) — ~0%
    // CPU idle, latência igual (browser paint = sync com mutation).
    const evaluate = () => {
      const menuOpen = checkMenuOpen() || !!anyMenuOpen;
      if (menuOpen && !wasHiddenRef.current) {
        wasHiddenRef.current = true;
        wasDevtoolsOpenRef.current = devtoolsOpen;
        void api.hide(viewId);
        if (devtoolsOpen) {
          void api.closeDevTools(viewId);
        }
      } else if (!menuOpen && wasHiddenRef.current) {
        wasHiddenRef.current = false;
        void api.show(viewId);
        if (wasDevtoolsOpenRef.current) {
          void api.openDevTools(viewId, 'right');
          wasDevtoolsOpenRef.current = false;
        }
      }
    };

    // Debounce micro pra coalescer bursts de mutations (style/class changes
    // disparam várias vezes durante mesmo "abrir menu"). 16ms ≈ 1 frame.
    let raf: number | null = null;
    const scheduleEval = () => {
      if (raf !== null) return;
      raf = window.requestAnimationFrame(() => {
        raf = null;
        evaluate();
      });
    };

    const observer = new MutationObserver(scheduleEval);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'data-popover-open'],
    });

    // Eval inicial pra capturar estado já presente no mount
    evaluate();

    return () => {
      observer.disconnect();
      if (raf !== null) window.cancelAnimationFrame(raf);
      if (wasHiddenRef.current) {
        wasHiddenRef.current = false;
        void api.show(viewId);
      }
    };
  }, [viewId, anyMenuOpen, devtoolsOpen]);

  // === Handlers ===========================================================
  const handleBack = useCallback(() => {
    const api = getAPI();
    if (!api || viewId === null) return;
    void api.back(viewId);
  }, [viewId]);

  const handleForward = useCallback(() => {
    const api = getAPI();
    if (!api || viewId === null) return;
    void api.forward(viewId);
  }, [viewId]);

  const handleRefresh = useCallback(() => {
    const api = getAPI();
    if (!api || viewId === null) return;
    void api.reload(viewId);
  }, [viewId]);

  const handleUrlSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const api = getAPI();
    if (!api || viewId === null) return;
    void api.loadURL(viewId, urlInput);
  }, [viewId, urlInput]);

  const handleToggleDevTools = useCallback(() => {
    const api = getAPI();
    if (!api || viewId === null) return;
    if (devtoolsOpen) {
      void api.closeDevTools(viewId);
    } else {
      void api.openDevTools(viewId, 'right'); // Cursor-style dock à direita
    }
  }, [viewId, devtoolsOpen]);

  return (
    <div className="preview-view preview-view-v2">
      {/* Toolbar simplificada */}
      <div className="preview-toolbar">
        <button className="preview-btn" disabled={!canGoBack} onClick={handleBack} title="Voltar (Alt+←)">
          <i className="codicon codicon-arrow-left" />
        </button>
        <button className="preview-btn" disabled={!canGoForward} onClick={handleForward} title="Avançar (Alt+→)">
          <i className="codicon codicon-arrow-right" />
        </button>
        <button className="preview-btn" onClick={handleRefresh} title="Atualizar (F5)">
          <i className={`codicon ${loading ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh'}`} />
        </button>
        <form onSubmit={handleUrlSubmit} className="preview-url-form" style={{ flex: 1, display: 'flex' }}>
          <input
            type="text"
            className="preview-url-input"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            spellCheck={false}
            style={{ flex: 1 }}
          />
        </form>
        <button
          className={`preview-btn ${devtoolsOpen ? 'is-active' : ''}`}
          onClick={handleToggleDevTools}
          title="DevTools (dockado à direita)"
        >
          <i className="codicon codicon-tools" />
        </button>
        <button className="preview-btn preview-btn-close" onClick={onClose} title="Fechar preview">
          <i className="codicon codicon-close" />
        </button>
      </div>

      {/* Container onde a WebContentsView vai ser posicionada via setBounds.
          Não há <webview> nem <iframe> aqui — só um div vazio servindo de
          "placeholder" pro main process medir bounds. */}
      <div
        ref={containerRef}
        className="preview-content preview-content-v2"
        style={{
          flex: 1,
          background: 'var(--bg-panel)',
          minHeight: 0,
          position: 'relative',
        }}
      >
        {viewId === null && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}>
            <i className="codicon codicon-loading codicon-modifier-spin" />
            <span style={{ marginLeft: 8 }}>Inicializando preview…</span>
          </div>
        )}
      </div>

      {/* Esconde o conteúdo URL atual no debug pra evitar warning de variável não usada */}
      <span style={{ display: 'none' }} data-url={url} />
    </div>
  );
}
