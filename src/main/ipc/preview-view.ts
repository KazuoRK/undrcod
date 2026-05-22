/**
 * preview-view.ts — IPC handlers pro novo preview baseado em WebContentsView.
 *
 * Substitui o `<webview>` tag por uma WebContentsView gerenciada pelo main process.
 * Motivo: Electron <webview> tag tem 2 problemas estruturais (BrowserView nativo
 * compositado acima do DOM):
 *   1. Outside-click — cliques no webview NÃO bubbleam pro DOM host (menus não fecham)
 *   2. DevTools embedado — setDevToolsWebContents tem CDP conflict (Elements vazios)
 *
 * WebContentsView (substituto da BrowserView, Electron 30+) é o que VS Code/Cursor
 * usam internamente pro Simple Browser. Permite:
 *   - Reposicionamento via setBounds (renderer manda quando container resize)
 *   - hide(): move pra off-screen quando menu host aberto → outside-click funciona
 *   - openDevTools({mode:'right'}): dock à direita do BrowserWindow parent
 *   - executeJavaScript: mesma API do webview, CSS Inspector continua funcionando
 *
 * Convenção de IPC channels: `previewView:*`. Cada handler retorna `{ ok, error? }`
 * pra renderer fazer error handling consistente.
 *
 * Lifecycle:
 *   - create() → cria view, attacha à parent window, retorna viewId
 *   - destroy() → remove da janela + cleanup webContents
 *   - Auto-destroy quando parent BrowserWindow fecha (listener no 'closed')
 */
import { BrowserWindow, WebContentsView, ipcMain, webContents } from 'electron';

interface ViewEntry {
  view: WebContentsView;
  parentWin: BrowserWindow;
  bounds: { x: number; y: number; width: number; height: number };
  /** Bounds salvos quando hide() é chamado, restaurados em show(). */
  savedBounds: { x: number; y: number; width: number; height: number } | null;
  hidden: boolean;
}

const views = new Map<number, ViewEntry>();
let nextViewId = 1;

/** Resolve a parent BrowserWindow do IPC sender. */
function getParentWindow(evt: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(evt.sender);
}

/** Helper: pega entry com guards de existência + destruição. */
function getEntry(viewId: number): ViewEntry | null {
  const entry = views.get(viewId);
  if (!entry) return null;
  if (entry.view.webContents.isDestroyed()) {
    views.delete(viewId);
    return null;
  }
  return entry;
}

/** Off-screen position usado por hide() — não conflita com nenhum monitor real. */
const HIDDEN_BOUNDS = { x: -99999, y: -99999, width: 1, height: 1 } as const;

export function registerPreviewViewIPC(): void {
  // === create === --------------------------------------------------------
  ipcMain.handle('previewView:create', (evt, initialUrl: string, bounds: { x: number; y: number; width: number; height: number }) => {
    try {
      const parentWin = getParentWindow(evt);
      if (!parentWin) return { ok: false, error: 'no-parent-window' };

      const view = new WebContentsView({
        webPreferences: {
          // SECURITY: webSecurity: false aqui é JUSTIFICADO porque essa view é
          // um BROWSER pane (Cursor Simple Browser pattern) que carrega URLs
          // arbitrárias do user (file://, http://localhost dev server, etc).
          // Ela roda em webContents ISOLADO — não compartilha origin com o
          // renderer principal nem tem acesso ao preload/undrcodAPI. O risco
          // de XSS na página guest fica contido à própria view.
          webSecurity: false,
          // allowRunningInsecureContent: false — mixed content (HTTP em HTTPS)
          // não é use case esperado pra dev preview. Default Electron.
          allowRunningInsecureContent: false,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });

      // Attach à content view da janela parent (substitui setBrowserView legacy)
      parentWin.contentView.addChildView(view);
      view.setBounds(bounds);

      // Background transparente — caso bounds não cubra 100% do container
      // (resize lag), não mostra retângulo branco.
      view.setBackgroundColor('#00000000');

      // Force compositor repaint depois do setBounds inicial — pattern do Cursor
      // (BrowserViewMainService.setBoundsOf chama webContents.invalidate() depois
      // de setBounds). Resolve "barras pretas" quando layer compositada não
      // re-paints sozinha após resize/attach.
      try { view.webContents.invalidate(); } catch { /* compositor not ready */ }

      // Carrega URL inicial. file:// passa direto, http(s):// também.
      if (initialUrl) {
        view.webContents.loadURL(initialUrl).catch((err) => {
          console.warn('[previewView] initial loadURL failed:', err);
        });
      }

      const viewId = nextViewId++;
      const entry: ViewEntry = {
        view,
        parentWin,
        bounds,
        savedBounds: null,
        hidden: false,
      };
      views.set(viewId, entry);

      // === Repasso de eventos do webContents pro renderer ===
      // Renderer escuta via window.undrcodAPI.previewView.onEvent(viewId, callback)
      const wc = view.webContents;
      const send = (channel: string, ...args: unknown[]): void => {
        // Envia pra TODOS webContents da parent window (renderer principal + popups).
        // Se parent foi destruída, skipa silenciosamente.
        if (parentWin.isDestroyed()) return;
        const target = parentWin.webContents;
        if (target.isDestroyed()) return;
        try { target.send(channel, viewId, ...args); } catch { /* race */ }
      };

      wc.on('did-start-loading', () => send('previewView:event:loading-start'));
      wc.on('did-stop-loading', () => send('previewView:event:loading-stop'));
      wc.on('did-finish-load', () => send('previewView:event:dom-ready'));
      wc.on('did-navigate', (_e, url) => send('previewView:event:did-navigate', url));
      wc.on('did-navigate-in-page', (_e, url) => send('previewView:event:did-navigate-in-page', url));
      wc.on('page-title-updated', (_e, title) => send('previewView:event:page-title-updated', title));
      wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
        send('previewView:event:did-fail-load', { errorCode, errorDescription, validatedURL });
      });
      wc.on('devtools-opened', () => send('previewView:event:devtools-opened'));
      wc.on('devtools-closed', () => send('previewView:event:devtools-closed'));

      // Cleanup automático quando parent window fecha
      parentWin.once('closed', () => {
        if (views.has(viewId)) {
          views.delete(viewId);
          // WebContentsView é GC'd automaticamente quando parent destrói
        }
      });

      console.log(`[previewView] created viewId=${viewId} bounds=`, bounds);
      return { ok: true, viewId };
    } catch (err) {
      console.error('[previewView] create failed:', err);
      return { ok: false, error: (err as Error).message };
    }
  });

  // === destroy === -------------------------------------------------------
  //
  // BUG FIX (preview view fica visível depois de destroy):
  //   - removeChildView() em Electron 31.7 remove do array `children` mas a layer
  //     compositada do Chromium pode permanecer painted no frame buffer até o
  //     próximo paint cycle. Sintoma: WebContentsView fica "fantasma" em cima do
  //     editor Monaco mesmo após `views.delete(viewId)`.
  //   - Fix canonical: chamar `view.setVisible(false)` ANTES de removeChildView.
  //     setVisible(false) força o compositor a parar de painted essa layer
  //     imediatamente (próximo frame), sem depender do removeChildView limpar
  //     o GPU surface.
  //
  // Teste manual:
  //   1. localStorage.setItem('undrcode.previewV2','true') + reload
  //   2. Abre preview (botão topbar ou Ctrl+Shift+P)
  //   3. Espera carregar
  //   4. Clica X (fechar preview)
  //   EXPECTED: WebContentsView some imediatamente, editor Monaco visível
  //   ANTES DO FIX: WebContentsView fica visível por cima do editor
  ipcMain.handle('previewView:destroy', (_evt, viewId: number) => {
    try {
      const entry = views.get(viewId);
      if (!entry) {
        console.log(`[previewView] destroy: viewId=${viewId} already destroyed`); // DEBUG:
        return { ok: true, alreadyDestroyed: true };
      }
      console.log(`[previewView] destroy: viewId=${viewId} starting cleanup`); // DEBUG:

      // FIRST: setVisible(false) — força o compositor a parar de pintar essa layer.
      // Sem isso, remoção via removeChildView pode deixar a layer "fantasma" pintada.
      try {
        entry.view.setVisible(false);
        console.log(`[previewView] destroy: setVisible(false) ok`); // DEBUG:
      } catch (err) {
        console.warn(`[previewView] destroy: setVisible(false) failed:`, (err as Error).message);
      }

      // SECOND: move off-screen — defensivo extra caso setVisible não pegue.
      try { entry.view.setBounds(HIDDEN_BOUNDS); } catch { /* ignore */ }

      // THIRD: fecha devtools (separadas) antes de tudo
      if (!entry.view.webContents.isDestroyed() && entry.view.webContents.isDevToolsOpened()) {
        try { entry.view.webContents.closeDevTools(); } catch { /* ignore */ }
      }

      // FOURTH: remove do contentView pra não composit mais
      try {
        if (!entry.parentWin.isDestroyed()) {
          entry.parentWin.contentView.removeChildView(entry.view);
          console.log(`[previewView] destroy: removeChildView ok`); // DEBUG:
        }
      } catch (err) {
        console.warn('[previewView] removeChildView failed:', (err as Error).message);
      }

      // FIFTH: destroy webContents explicitamente (Electron 31+ tem método interno)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wc = entry.view.webContents as any;
        if (typeof wc.close === 'function' && !wc.isDestroyed()) {
          wc.close();
          console.log(`[previewView] destroy: webContents.close ok`); // DEBUG:
        }
      } catch { /* ignore */ }
      views.delete(viewId);
      console.log(`[previewView] destroyed viewId=${viewId} (full cleanup)`);
      return { ok: true };
    } catch (err) {
      console.error('[previewView] destroy failed:', err);
      return { ok: false, error: (err as Error).message };
    }
  });

  // === setBounds === -----------------------------------------------------
  ipcMain.handle('previewView:setBounds', (_evt, viewId: number, bounds: { x: number; y: number; width: number; height: number }) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, error: 'view-not-found' };
    try {
      // Se hidden, atualiza só savedBounds (pra show() restaurar com bounds atuais)
      if (entry.hidden) {
        entry.savedBounds = bounds;
        // DEBUG: hidden path
        console.log('[previewView setBounds]', {
          viewId,
          hidden: true,
          received: bounds,
          note: 'hidden — saved only, not applied',
        });
      } else {
        entry.view.setBounds(bounds);
        entry.bounds = bounds;
        // Force compositor redraw — Cursor faz exatamente isso em
        // BrowserViewMainService.setBoundsOf (main.js):
        //   s.browserView.setBounds(...); try { s.browserView.webContents.invalidate() } catch {}
        // Sem invalidate(), layer GPU pode ficar com bounds antigos pintados
        // por 1 frame (causa "barras pretas" no resize do split pane).
        try { entry.view.webContents.invalidate(); } catch { /* ignore */ }
        // DEBUG: investigar barras pretas em volta do preview
        let applied: { x: number; y: number; width: number; height: number } | null = null;
        try { applied = entry.view.getBounds(); } catch { applied = null; }
        let winContent: { x: number; y: number; width: number; height: number } | null = null;
        try { winContent = entry.parentWin.getContentBounds(); } catch { winContent = null; }
        let winBounds: { x: number; y: number; width: number; height: number } | null = null;
        try { winBounds = entry.parentWin.getBounds(); } catch { winBounds = null; }
        let winSize: { w: number; h: number } | null = null;
        try { const s = entry.parentWin.getSize(); winSize = { w: s[0], h: s[1] }; } catch { winSize = null; }
        let winContentSize: { w: number; h: number } | null = null;
        try { const s = entry.parentWin.getContentSize(); winContentSize = { w: s[0], h: s[1] }; } catch { winContentSize = null; }
        const sender = _evt.sender;
        let senderZoom: number | null = null;
        try { senderZoom = sender.getZoomFactor(); } catch { senderZoom = null; }
        console.log('[previewView setBounds]', {
          viewId,
          received: bounds,
          applied,
          appliedDiff: applied ? {
            dx: applied.x - bounds.x,
            dy: applied.y - bounds.y,
            dw: applied.width - bounds.width,
            dh: applied.height - bounds.height,
          } : null,
          winContent,
          winBounds,
          winSize,
          winContentSize,
          parentWinDestroyed: entry.parentWin.isDestroyed(),
          senderZoomFactor: senderZoom,
        });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // === hide === ----------------------------------------------------------
  // Usado quando menu host aberto pra outside-click funcionar.
  // Cliques no host agora alcançam o DOM normalmente.
  //
  // Combina DOIS mecanismos pra garantir sumiço:
  //   1. setVisible(false) — Electron 31 método oficial; para o compositor
  //      de pintar essa layer. Funciona mesmo se o WebContents continua vivo.
  //   2. setBounds(HIDDEN_BOUNDS) — fallback defensivo. Se setVisible falhar
  //      (improvável em E31), a view ainda fica off-screen.
  // Ambos são reversíveis em show().
  ipcMain.handle('previewView:hide', (_evt, viewId: number) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, error: 'view-not-found' };
    if (entry.hidden) return { ok: true, alreadyHidden: true };
    try {
      entry.savedBounds = entry.bounds;
      entry.hidden = true;
      try { entry.view.setVisible(false); } catch { /* ignore — fallback off-screen pega */ }
      entry.view.setBounds(HIDDEN_BOUNDS);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // === show === ----------------------------------------------------------
  ipcMain.handle('previewView:show', (_evt, viewId: number) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, error: 'view-not-found' };
    if (!entry.hidden) return { ok: true, alreadyVisible: true };
    try {
      entry.hidden = false;
      if (entry.savedBounds) {
        entry.view.setBounds(entry.savedBounds);
        entry.bounds = entry.savedBounds;
        entry.savedBounds = null;
      }
      // Restaura visibilidade no compositor — par do setVisible(false) no hide().
      try { entry.view.setVisible(true); } catch { /* ignore */ }
      // Force redraw depois de restaurar — sem isso a layer pode ficar 1 frame
      // sem repaint (mesmo padrão do setBounds handler, Cursor faz igual).
      try { entry.view.webContents.invalidate(); } catch { /* ignore */ }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // === loadURL === -------------------------------------------------------
  ipcMain.handle('previewView:loadURL', async (_evt, viewId: number, url: string) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, error: 'view-not-found' };
    try {
      await entry.view.webContents.loadURL(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // === navigation === ----------------------------------------------------
  ipcMain.handle('previewView:back', (_evt, viewId: number) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, error: 'view-not-found' };
    try {
      const wc = entry.view.webContents as Electron.WebContents & { canGoBack(): boolean; goBack(): void };
      if (wc.canGoBack()) wc.goBack();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('previewView:forward', (_evt, viewId: number) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, error: 'view-not-found' };
    try {
      const wc = entry.view.webContents as Electron.WebContents & { canGoForward(): boolean; goForward(): void };
      if (wc.canGoForward()) wc.goForward();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('previewView:reload', (_evt, viewId: number, ignoreCache?: boolean) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, error: 'view-not-found' };
    try {
      if (ignoreCache) entry.view.webContents.reloadIgnoringCache();
      else entry.view.webContents.reload();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('previewView:canGoBack', (_evt, viewId: number) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, canGoBack: false };
    try {
      const wc = entry.view.webContents as Electron.WebContents & { canGoBack(): boolean };
      return { ok: true, canGoBack: wc.canGoBack() };
    } catch { return { ok: false, canGoBack: false }; }
  });

  ipcMain.handle('previewView:canGoForward', (_evt, viewId: number) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, canGoForward: false };
    try {
      const wc = entry.view.webContents as Electron.WebContents & { canGoForward(): boolean };
      return { ok: true, canGoForward: wc.canGoForward() };
    } catch { return { ok: false, canGoForward: false }; }
  });

  ipcMain.handle('previewView:getURL', (_evt, viewId: number) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, url: '' };
    try { return { ok: true, url: entry.view.webContents.getURL() }; }
    catch { return { ok: false, url: '' }; }
  });

  // === executeJavaScript === ---------------------------------------------
  // Substitui webview.executeJavaScript do CSS Inspector legacy.
  // Mesma API: aceita string de código + userGesture opcional.
  ipcMain.handle('previewView:executeJavaScript', async (_evt, viewId: number, code: string, userGesture?: boolean) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, error: 'view-not-found', result: null };
    try {
      const result = await entry.view.webContents.executeJavaScript(code, userGesture ?? false);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: (err as Error).message, result: null };
    }
  });

  // === zoom === ----------------------------------------------------------
  ipcMain.handle('previewView:setZoomFactor', (_evt, viewId: number, factor: number) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, error: 'view-not-found' };
    try {
      entry.view.webContents.setZoomFactor(factor);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('previewView:getZoomFactor', (_evt, viewId: number) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, factor: 1 };
    try { return { ok: true, factor: entry.view.webContents.getZoomFactor() }; }
    catch { return { ok: false, factor: 1 }; }
  });

  // === openDevTools === --------------------------------------------------
  // EXATO igual ao Cursor (main.js, BrowserViewMainService.openDevTools):
  //   r.browserView.webContents.openDevTools({ mode: "right", activate: true })
  // Dock à direita do CONTENT VIEW (não da BrowserWindow inteira), porque a
  // WebContentsView tem webContents próprio. Resultado: devtools fica ao lado
  // do iframe DENTRO do espaço do preview, não ocupando a janela toda.
  ipcMain.handle('previewView:openDevTools', (_evt, viewId: number, mode: 'right' | 'bottom' | 'undocked' | 'detach' = 'right') => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, error: 'view-not-found' };
    try {
      const wc = entry.view.webContents;
      // Detach debugger se attached (CSS Inspector pode ter deixado de antes).
      if (wc.debugger.isAttached()) {
        try { wc.debugger.detach(); } catch { /* ignore */ }
      }
      if (wc.isDevToolsOpened()) wc.closeDevTools();
      // activate: true = força foco no devtools quando abre (Cursor pattern).
      wc.openDevTools({ mode, activate: true });
      console.log(`[previewView] devtools opened viewId=${viewId} mode=${mode} (Cursor pattern)`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('previewView:closeDevTools', (_evt, viewId: number) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, error: 'view-not-found' };
    try {
      const wc = entry.view.webContents;
      if (wc.isDevToolsOpened()) wc.closeDevTools();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('previewView:isDevToolsOpened', (_evt, viewId: number) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, isOpen: false };
    try { return { ok: true, isOpen: entry.view.webContents.isDevToolsOpened() }; }
    catch { return { ok: false, isOpen: false }; }
  });

  // === sendInputEvent === ------------------------------------------------
  // Pra atalhos que devem chegar no preview (F5 dentro do iframe, etc).
  // Renderer envia event object normalizado.
  ipcMain.handle('previewView:sendInputEvent', (_evt, viewId: number, inputEvent: Electron.MouseInputEvent | Electron.KeyboardInputEvent | Electron.MouseWheelInputEvent) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, error: 'view-not-found' };
    try {
      entry.view.webContents.sendInputEvent(inputEvent);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // === emulateColorScheme === --------------------------------------------
  // Substitui handler legacy preview:emulateColorScheme.
  ipcMain.handle('previewView:emulateColorScheme', async (_evt, viewId: number, scheme: 'light' | 'dark' | 'system') => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, error: 'view-not-found' };
    try {
      const wc = entry.view.webContents;
      // Skipa se devtools aberto — mesma proteção do handler antigo
      if (wc.isDevToolsOpened()) {
        return { ok: true, skipped: 'devtools-open' };
      }
      if (!wc.debugger.isAttached()) {
        try { wc.debugger.attach('1.3'); } catch { /* já attached em outro lugar */ }
      }
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: scheme === 'system' ? [] : [{ name: 'prefers-color-scheme', value: scheme }],
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // === insertCSS === -----------------------------------------------------
  // Útil pro CSS Inspector aplicar overrides globais
  ipcMain.handle('previewView:insertCSS', async (_evt, viewId: number, css: string) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, error: 'view-not-found', key: null };
    try {
      const key = await entry.view.webContents.insertCSS(css);
      return { ok: true, key };
    } catch (err) {
      return { ok: false, error: (err as Error).message, key: null };
    }
  });

  ipcMain.handle('previewView:removeInsertedCSS', async (_evt, viewId: number, key: string) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, error: 'view-not-found' };
    try {
      await entry.view.webContents.removeInsertedCSS(key);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // === getWebContentsId === ----------------------------------------------
  // Pra compat com código que esperava esse ID do <webview>
  ipcMain.handle('previewView:getWebContentsId', (_evt, viewId: number) => {
    const entry = getEntry(viewId);
    if (!entry) return { ok: false, id: -1 };
    try { return { ok: true, id: entry.view.webContents.id }; }
    catch { return { ok: false, id: -1 }; }
  });
}

/** Garante cleanup de TODAS as views quando app fecha. */
export function destroyAllPreviewViews(): void {
  for (const [viewId, entry] of views.entries()) {
    try {
      // setVisible(false) ANTES de remove — mesmo motivo do destroy handler:
      // garante que o compositor pare de pintar essa layer imediatamente.
      try { entry.view.setVisible(false); } catch { /* ignore */ }
      if (!entry.parentWin.isDestroyed()) {
        entry.parentWin.contentView.removeChildView(entry.view);
      }
      if (!entry.view.webContents.isDestroyed() && entry.view.webContents.isDevToolsOpened()) {
        entry.view.webContents.closeDevTools();
      }
    } catch { /* ignore */ }
    views.delete(viewId);
  }
}

/** Export pra debug/test interno. */
export function _getViewIds(): number[] {
  return Array.from(views.keys());
}

// Silenciar warning de webContents import não usado (futuro: pode precisar).
void webContents;
