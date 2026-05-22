/**
 * PreviewViewV3 — preview baseado em <iframe> puro (Cursor Simple Browser pattern).
 *
 * Por que V3:
 *   - V1 (<webview>) e V2 (WebContentsView) sao BrowserView/CEF-equivalent nativos
 *     compositados POR CIMA do DOM. Resultado: bugs de "view fica visivel mesmo
 *     depois de fechar/trocar tab" porque sao geridos pelo main process e nao
 *     participam do z-index normal do DOM.
 *   - Cursor (fork VS Code) usa <iframe> simples pro Simple Browser deles
 *     (resources/app/extensions/simple-browser/media/index.js). Funciona porque
 *     iframe e DOM normal — outside-click, z-index, hide/show "just work".
 *
 * Tradeoffs vs V1/V2:
 *   - Cross-origin: cant ler iframe.contentWindow.location ou .history. Por
 *     isso historia eh mantida MANUAL aqui (historyRef + historyIdxRef).
 *   - CSS Inspector: nao da pra injetar JS em cross-origin iframe. Vai ficar
 *     so no V1. Pra preview de dev server local (mesma origin) pode funcionar
 *     no futuro, mas nao implementado aqui.
 *
 * Features portadas do V1:
 *   - Zoom (Ctrl+Wheel, Ctrl+=, Ctrl+-, Ctrl+0) via CSS transform: scale()
 *   - Atalhos: F5 refresh, Ctrl+Shift+R hard reload, Alt+← back, Alt+→ forward
 *   - Toggle bloquear JS (sandbox toggle)
 *   - Copy URL
 *   - Mention button (@)
 *   - Outside-click via polling de focus (Cursor pattern)
 *
 * Pra ativar: localStorage.setItem('undrcode.previewVersion', 'v3') + reload.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '../Toast/Toast';

interface PreviewViewV3Props {
  cwd: string | null;
  initialUrl: string;
  onUrlChange: (url: string) => void;
  onNavigate?: (url: string) => void;
  onClose: () => void;
  /** Quando definido, botão @ aparece pra fazer mention no chat com path do file:// atual. */
  onMention?: (relPath: string) => void;
}

const ZOOM_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500] as const;
const ZOOM_MIN = ZOOM_STEPS[0];
const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];
const ZOOM_STORAGE_KEY = 'undrcode.previewV3.zoom';

export function PreviewViewV3({ cwd, initialUrl, onUrlChange, onNavigate, onClose, onMention }: PreviewViewV3Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Historia manual: array de URLs ja visitadas + index do current.
  // Cross-origin bloqueia iframe.contentWindow.history, entao a gente mantem.
  const historyRef = useRef<string[]>([initialUrl]);
  const historyIdxRef = useRef<number>(0);

  const [urlInput, setUrlInput] = useState(initialUrl);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(false);

  // Zoom (CSS transform: scale()) — persistido em localStorage
  const [zoomPercent, setZoomPercent] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(ZOOM_STORAGE_KEY);
      const n = raw ? parseInt(raw, 10) : 100;
      return Number.isFinite(n) && n >= ZOOM_MIN && n <= ZOOM_MAX ? n : 100;
    } catch { return 100; }
  });
  useEffect(() => {
    try { localStorage.setItem(ZOOM_STORAGE_KEY, String(zoomPercent)); } catch { /* ignore */ }
  }, [zoomPercent]);

  // Toggle JS — quando true, iframe recarrega com sandbox sem allow-scripts
  const [jsDisabled, setJsDisabled] = useState(false);

  // Atualiza derived state (botoes back/forward enabled) a partir do history.
  const refreshNavState = useCallback(() => {
    setCanGoBack(historyIdxRef.current > 0);
    setCanGoForward(historyIdxRef.current < historyRef.current.length - 1);
  }, []);

  // Seta src do iframe sem mexer em historia (usado por back/forward/refresh).
  const setIframeSrc = useCallback((src: string) => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    setLoading(true);
    iframe.src = src;
  }, []);

  // Push de URL nova: adiciona ao history (truncando forward se necessario)
  // e navega o iframe pra ela.
  const pushUrl = useCallback((rawUrl: string) => {
    const url = rawUrl.trim();
    if (!url) return;
    const cur = historyIdxRef.current;
    historyRef.current = historyRef.current.slice(0, cur + 1);
    historyRef.current.push(url);
    historyIdxRef.current = historyRef.current.length - 1;
    setUrlInput(url);
    onUrlChange(url);
    setIframeSrc(url);
    refreshNavState();
  }, [onUrlChange, refreshNavState, setIframeSrc]);

  const handleBack = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current -= 1;
    const url = historyRef.current[historyIdxRef.current];
    setUrlInput(url);
    onUrlChange(url);
    setIframeSrc(url);
    refreshNavState();
  }, [onUrlChange, refreshNavState, setIframeSrc]);

  const handleForward = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current += 1;
    const url = historyRef.current[historyIdxRef.current];
    setUrlInput(url);
    onUrlChange(url);
    setIframeSrc(url);
    refreshNavState();
  }, [onUrlChange, refreshNavState, setIframeSrc]);

  const handleRefresh = useCallback((hard = false) => {
    const cur = historyRef.current[historyIdxRef.current];
    if (!cur) return;
    if (hard) {
      // Hard reload — cache buster timestamp na URL
      try {
        const u = new URL(cur);
        u.searchParams.set('_t', String(Date.now()));
        setIframeSrc(u.toString());
      } catch {
        setIframeSrc(cur);
      }
    } else {
      // Soft reload — re-seta o mesmo src (browser usa cache)
      setIframeSrc(cur);
    }
  }, [setIframeSrc]);

  const handleUrlSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    pushUrl(urlInput);
  }, [pushUrl, urlInput]);

  const handleToggleDevTools = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = window.undrcodAPI?.window;
    if (api?.toggleDevTools) {
      api.toggleDevTools();
    } else {
      toast.info('Use Ctrl+Shift+I pra abrir DevTools da janela');
    }
  }, []);

  const handleCopyUrl = useCallback(async () => {
    const cur = historyRef.current[historyIdxRef.current] || urlInput;
    // Electron clipboard via preload — funciona sempre (não depende de focus).
    // navigator.clipboard falha silenciosamente quando foco está em iframe.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electronClipboard = window.undrcodAPI?.clipboard?.writeText;
    if (typeof electronClipboard === 'function') {
      try {
        electronClipboard(cur);
        toast.success('URL copiada');
        return;
      } catch { /* fallback abaixo */ }
    }
    try {
      await navigator.clipboard.writeText(cur);
      toast.success('URL copiada');
    } catch {
      toast.error('Falha ao copiar URL — reinicie o app');
    }
  }, [urlInput]);

  const handleMention = useCallback(() => {
    if (!onMention) return;
    const cur = historyRef.current[historyIdxRef.current];
    if (!cur) return;
    // Tenta converter file:// pra relative path do cwd
    if (cur.startsWith('file:///') && cwd) {
      try {
        const u = new URL(cur);
        let p = decodeURIComponent(u.pathname);
        if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1);
        const cwdNorm = cwd.replace(/\\/g, '/');
        if (p.toLowerCase().startsWith(cwdNorm.toLowerCase())) {
          const rel = p.slice(cwdNorm.length).replace(/^\/+/, '');
          onMention(rel);
          return;
        }
      } catch { /* ignore */ }
    }
    onMention(cur);
  }, [cwd, onMention]);

  // Zoom handlers
  const zoomIn = useCallback(() => {
    setZoomPercent((cur) => {
      const next = ZOOM_STEPS.filter((s) => s > cur);
      return next.length > 0 ? next[0] : ZOOM_MAX;
    });
  }, []);
  const zoomOut = useCallback(() => {
    setZoomPercent((cur) => {
      const next = ZOOM_STEPS.filter((s) => s < cur);
      return next.length > 0 ? next[next.length - 1] : ZOOM_MIN;
    });
  }, []);
  const zoomReset = useCallback(() => setZoomPercent(100), []);

  // Iframe onLoad: marca loading=false + chama onNavigate.
  const handleIframeLoad = useCallback(() => {
    setLoading(false);
    const cur = historyRef.current[historyIdxRef.current];
    if (cur && onNavigate) onNavigate(cur);
  }, [onNavigate]);

  // Initial load + nav state refresh
  useEffect(() => {
    refreshNavState();
    setLoading(true);
  }, [refreshNavState]);

  // === Atalhos globais (F5, Ctrl+Shift+R, Alt+←/→, Ctrl+=/-/0) ============
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // Skip se foco está em input editável fora do preview
      const active = document.activeElement;
      if (active?.tagName === 'INPUT' && active !== iframeRef.current) {
        // Permite Alt+arrows mesmo em inputs (caso de URL bar não atrapalha)
        if (!e.altKey) return;
      }

      if (e.key === 'F5') {
        e.preventDefault();
        handleRefresh(e.shiftKey);
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        handleRefresh(true);
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          handleBack();
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          handleForward();
          return;
        }
      }
      // Ctrl+= / Ctrl+- / Ctrl+0 ficam pra ZOOM GLOBAL da janela (Electron native).
      // Zoom LOCAL do preview = botões da toolbar OU Ctrl+Wheel sobre o iframe.
      // Cursor pattern: zoom global afeta toda a UI (incluindo iframe por consequência).
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleBack, handleForward, handleRefresh, zoomIn, zoomOut, zoomReset]);

  // === Ctrl+Wheel zoom no preview area ====================================
  useEffect(() => {
    const container = iframeRef.current?.parentElement;
    if (!container) return;
    const handler = (e: WheelEvent): void => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else if (e.deltaY > 0) zoomOut();
    };
    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  }, [zoomIn, zoomOut]);

  // === Container size tracking pra zoom em pixels absolutos ================
  // Width/height em % têm ambiguidades (padding/border do parent afetam).
  // ResizeObserver pega pixels reais e calculamos iframe DOM size = container/zoom.
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const container = iframeRef.current?.parentElement;
    if (!container) return;
    const updateSize = (): void => {
      const rect = container.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // === Outside-click: polling de focus (Cursor pattern) ====================
  // Iframe cross-origin não propaga mousedown pro parent. Mas FOCUS muda
  // quando user clica nele. Polling 100ms detecta + dispatch synthetic
  // mousedown pra ContextMenu listeners fecharem.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let lastFocusWasIframe = document.activeElement === iframe;

    const interval = window.setInterval(() => {
      const focusIsIframe = document.activeElement === iframe;
      if (focusIsIframe && !lastFocusWasIframe) {
        const evt = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
        document.dispatchEvent(evt);
        window.dispatchEvent(new CustomEvent('undrcod:preview-clicked'));
      }
      lastFocusWasIframe = focusIsIframe;
    }, 100);

    return () => window.clearInterval(interval);
  }, []);

  // Sandbox attribute baseado em jsDisabled. iframe re-renderiza quando muda.
  const sandboxAttr = useMemo(() => {
    if (jsDisabled) {
      // Sem allow-scripts = JS bloqueado. Outros permits mantidos.
      return 'allow-same-origin allow-forms allow-popups allow-modals';
    }
    // Default: sem sandbox attribute (mais permissivo). Retorna undefined.
    return undefined;
  }, [jsDisabled]);

  return (
    <div className="preview-view preview-view-v3">
      <div className="preview-toolbar">
        <button className="preview-btn" disabled={!canGoBack} onClick={handleBack} title="Voltar (Alt+←)">
          <i className="codicon codicon-arrow-left" />
        </button>
        <button className="preview-btn" disabled={!canGoForward} onClick={handleForward} title="Avançar (Alt+→)">
          <i className="codicon codicon-arrow-right" />
        </button>
        <button className="preview-btn" onClick={() => handleRefresh(false)} title="Atualizar (F5) — Shift pra hard reload">
          <i className={`codicon ${loading ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh'}`} />
        </button>

        {/* Zoom controls */}
        <button className="preview-btn" onClick={zoomOut} disabled={zoomPercent <= ZOOM_MIN} title="Zoom out (Ctrl+-)">
          <i className="codicon codicon-zoom-out" />
        </button>
        <button className="preview-btn preview-zoom-label" onClick={zoomReset} title="Reset zoom (Ctrl+0)">
          {zoomPercent}%
        </button>
        <button className="preview-btn" onClick={zoomIn} disabled={zoomPercent >= ZOOM_MAX} title="Zoom in (Ctrl+=)">
          <i className="codicon codicon-zoom-in" />
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

        {/* Toggle JS */}
        <button
          type="button"
          className={`preview-btn ${jsDisabled ? 'is-active' : ''}`}
          onClick={() => setJsDisabled((v) => !v)}
          title={jsDisabled ? 'JS bloqueado (clica pra reativar)' : 'Bloquear JavaScript (útil pra SPAs em file://)'}
        >
          <i className={`codicon ${jsDisabled ? 'codicon-shield' : 'codicon-symbol-event'}`} />
        </button>

        {/* Copy URL */}
        <button className="preview-btn" onClick={handleCopyUrl} title="Copiar URL">
          <i className="codicon codicon-copy" />
        </button>

        {/* Mention @ */}
        {onMention && (
          <button className="preview-btn" onClick={handleMention} title="Mencionar este arquivo no chat (@)">
            <i className="codicon codicon-mention" />
          </button>
        )}

        <button className="preview-btn" onClick={handleToggleDevTools} title="DevTools da janela (Ctrl+Shift+I)">
          <i className="codicon codicon-tools" />
        </button>
        <button className="preview-btn preview-btn-close" onClick={onClose} title="Fechar preview">
          <i className="codicon codicon-close" />
        </button>
      </div>

      {/*
        === ZOOM IMPLEMENTATION (Gate 4 + 7) ===
        Zoom local do preview via transform: scale() + width/height compensados.
        Cursor pattern: Simple Browser deles NÃO tem zoom local. UNDRCOD tem
        como FEATURE extra que o V1 já tinha — Rafael escolheu manter.

        Mecânica:
          - zoom 200%: iframe width=50%, scale(2) → renderiza 50% viewport,
            escala 2x → aparenta 100% do container, conteúdo grande
          - zoom 50%:  iframe width=200%, scale(0.5) → renderiza 200% viewport,
            escala 0.5x → aparenta 100% do container, conteúdo pequeno
          - zoom 100%: width=100%, sem transform (sem custo de compositing)

        Container parent precisa de overflow:hidden quando zoom < 100% pra esconder
        o overflow do iframe pre-escala. Quando zoom > 100% poderia ter scroll
        mas iframe interno já scrolla o conteúdo, então mantemos hidden.
      */}
      <div
        className="preview-content preview-content-v3"
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          background: 'var(--bg-panel)',
          overflow: 'hidden',
        }}
      >
        <iframe
          ref={iframeRef}
          src={initialUrl}
          onLoad={handleIframeLoad}
          title="Preview"
          {...(sandboxAttr ? { sandbox: sandboxAttr } : {})}
          allow="autoplay; clipboard-read; clipboard-write"
          style={{
            // PIXELS ABSOLUTOS via ResizeObserver — elimina ambiguidades de
            // 100%/% que podem ser afetadas por padding/border/box-sizing.
            // Pre-scale width = container.width / (zoom/100). Scale leva ao
            // visual exato do container.
            position: 'absolute',
            top: 0,
            left: 0,
            width: zoomPercent === 100 || containerSize.width === 0
              ? '100%'
              : `${containerSize.width / (zoomPercent / 100)}px`,
            height: zoomPercent === 100 || containerSize.height === 0
              ? '100%'
              : `${containerSize.height / (zoomPercent / 100)}px`,
            border: 'none',
            display: 'block',
            background: 'white',
            transform: zoomPercent === 100 ? undefined : `scale(${zoomPercent / 100})`,
            transformOrigin: '0 0',
          }}
        />
      </div>
    </div>
  );
}
