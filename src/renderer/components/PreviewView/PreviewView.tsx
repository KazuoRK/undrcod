/**
 * PreviewView — modo "Lovable" do UNDRCOD.
 *
 * Mostra o dev server do projeto rodando ao vivo dentro do app, via Electron
 * <webview> (igual browser tab isolado). Header tem URL bar editavel + refresh
 * + back/forward + abrir externamente.
 *
 * Features Cursor Browser-style:
 *   - Select element (toggle): clica no preview e seleciona elemento; mostra
 *     metadata (tag, classes, computed styles, dimensões) no painel lateral.
 *   - Terminal embedado: toggle pra mostrar Terminal embaixo do webview.
 *   - Inspector panel: tabs Components (breadcrumb) + Design (props legíveis)
 *     + CSS (lista bruta de computed styles).
 *
 * Comunicação host ↔ webview:
 *   - host → webview: executeJavaScript() pra ativar/desativar inspector
 *   - webview → host: console.log('__UNDRCOD_SELECT__' + JSON) capturado via
 *     console-message event (pattern conhecido sem precisar de preload).
 */

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, type ReactNode } from 'react';
import './PreviewView.css';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu';

interface PreviewViewProps {
  cwd: string;
  /** URL inicial. Se vazio, tenta detectar do projeto. */
  initialUrl?: string;
  /** Callback quando o usuário muda a URL via input. */
  onUrlChange?: (url: string) => void;
  /** Callback quando a página dentro do webview navega (click em link, etc).
   * App usa pra sincronizar tabs do CentralTabs com a URL atual do preview. */
  onNavigate?: (url: string) => void;
  onClose?: () => void;
}

/** Nó da árvore DOM enviado pelo preload — usado no painel Components. */
interface DomTreeNode {
  uid: string;
  tag: string;
  id: string;
  classes: string[];
  children: DomTreeNode[];
}

interface InspectedElement {
  tag: string;
  id: string;
  classes: string[];
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  /** Offset relativo ao offsetParent (closest positioned ancestor) — bate
   * com como `left`/`top` CSS funcionam pra position: absolute. Usado pra
   * exibir X/Y no painel Position. Undefined em payloads legacy. */
  offset?: { x: number; y: number };
  /** Árvore DOM completa do <body> — usado no painel Components.
   * Cada nó tem uid estável pra select via click. Só vem no element-selected
   * (não em element-updated). */
  domTree?: DomTreeNode;
  /** Path do elemento (raiz → folha) — usado pro Components tree breadcrumb. */
  path: Array<{ tag: string; id: string; classes: string[] }>;
  /** UID estável (data-undrcod-uid) — usado pra editing mesmo após re-render. */
  uid?: string;
  /** Subset curado de getComputedStyle, pra tab Design. */
  designProps: {
    width: string;
    height: string;
    paddingTop: string;
    paddingRight: string;
    paddingBottom: string;
    paddingLeft: string;
    marginTop: string;
    marginRight: string;
    marginBottom: string;
    marginLeft: string;
    borderRadius: string;
    opacity: string;
    backgroundColor: string;
    color: string;
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
    letterSpacing: string;
    display: string;
    flexDirection: string;
    position: string;
  };
  /** Computed styles completos (filtrados) — pra tab CSS. */
  allStyles: Record<string, string>;
  /** Inline styles raw (el.style.*) — preserva valores que computed perde.
   * Ex: rotate(540deg) inline vs matrix(...) computed que trunca via atan2.
   * Usado pra rotation acumular indefinidamente. */
  inlineStyles?: { transform?: string };
  /** Fontes detectadas na página — usado pelo FontFamilyDropdown. */
  availableFontFamilies?: string[];
  /** Info de React component detectado no elemento (via Fiber tree).
   * Quando presente, ativa sections Properties + Children no inspector.
   * Stub por enquanto — detection real requer preload com React DevTools hook. */
  reactComponent?: {
    name?: string;
    props?: Record<string, unknown>;
    childCount?: number;
    children?: Array<{ name: string; uid?: string }>;
  };
}

// Webview do Electron com metodos extras não tipados em React HTMLAttributes
interface WebviewElement extends HTMLElement {
  src: string;
  reload(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
  getURL(): string;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  /** Envia IPC message pro preload do webview. Recebido via ipcRenderer.on no preload. */
  send(channel: string, ...args: unknown[]): void;
  /** WebContents ID — usado pra setDevToolsWebContents (DevTools embedado). */
  getWebContentsId(): number;
  /** Zoom factor (1.0 = 100%). Range típico 0.25 a 5.0 conforme Electron. */
  setZoomFactor(factor: number): void;
  getZoomFactor(): number;
}

/** Evento ipc-message disparado quando o preload chama ipcRenderer.sendToHost. */
interface IpcMessageEvent extends Event {
  channel: string;
  args: unknown[];
}

/**
 * Constrói items do context menu do webview (right-click).
 *
 * Pure function — recebe todas as dependências como params pra ficar simples
 * de chamar dentro do JSX inline.
 *
 * Por que função separada: o canGoBack/Forward do webview crasha se chamado
 * antes do `dom-ready`. A função guarda essas chamadas com try/catch e só
 * roda quando ctxMenu.open === true (computed-on-demand).
 */
function buildWebviewContextMenuItems(opts: {
  canGoBack: boolean;
  canGoForward: boolean;
  hasSelection: boolean;
  isEditable: boolean;
  handleBack: () => void;
  handleForward: () => void;
  handleRefresh: () => void;
  execInWebview: (cmd: string) => void;
  openDevTools: () => void;
}): ContextMenuItem[] {
  return [
    {
      kind: 'item',
      icon: 'arrow-left',
      label: 'Voltar',
      shortcut: 'Alt ←',
      disabled: !opts.canGoBack,
      onClick: opts.handleBack,
    },
    {
      kind: 'item',
      icon: 'arrow-right',
      label: 'Avançar',
      shortcut: 'Alt →',
      disabled: !opts.canGoForward,
      onClick: opts.handleForward,
    },
    {
      kind: 'item',
      icon: 'refresh',
      label: 'Recarregar',
      shortcut: 'F5',
      onClick: opts.handleRefresh,
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'discard',
      label: 'Desfazer',
      shortcut: 'Ctrl Z',
      disabled: !opts.isEditable,
      onClick: () => opts.execInWebview('undo'),
    },
    {
      kind: 'item',
      icon: 'redo',
      label: 'Refazer',
      shortcut: 'Ctrl Y',
      disabled: !opts.isEditable,
      onClick: () => opts.execInWebview('redo'),
    },
    {
      kind: 'item',
      icon: 'scissors',
      label: 'Recortar',
      shortcut: 'Ctrl X',
      disabled: !opts.hasSelection || !opts.isEditable,
      onClick: () => opts.execInWebview('cut'),
    },
    {
      kind: 'item',
      icon: 'copy',
      label: 'Copiar',
      shortcut: 'Ctrl C',
      disabled: !opts.hasSelection,
      onClick: () => opts.execInWebview('copy'),
    },
    {
      kind: 'item',
      icon: 'clippy',
      label: 'Colar',
      shortcut: 'Ctrl V',
      disabled: !opts.isEditable,
      onClick: () => opts.execInWebview('paste'),
    },
    {
      kind: 'item',
      icon: 'list-selection',
      label: 'Selecionar tudo',
      shortcut: 'Ctrl A',
      onClick: () => opts.execInWebview('selectAll'),
    },
    { kind: 'divider' },
    {
      kind: 'item',
      icon: 'inspect',
      label: 'Inspect Element',
      shortcut: 'F12',
      onClick: opts.openDevTools,
    },
  ];
}

/**
 * Detecta a porta usada pelo próprio UNDRCOD dev server pra EVITAR recursão
 * (webview carregando UNDRCOD dentro dele). Lê de `window.location.port`.
 */
function getSelfPort(): number {
  try {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return parseInt(window.location.port || '0', 10);
    }
  } catch { /* ignore */ }
  return 0;
}

/**
 * Normaliza qualquer input do user pra URL válida pro webview:
 *   - `http://...` / `https://...` → keep
 *   - `file:///...` → keep
 *   - `C:\path\to\file.html` ou `C:/path/to/file.html` → `file:///C:/path/to/file.html`
 *   - `/Users/x/file.html` (Unix-style) → `file:///Users/x/file.html`
 *   - `localhost:3000` ou `localhost` → `http://localhost:3000`
 *   - `example.com` → `https://example.com`
 *   - default → `http://input` (legacy fallback)
 *
 * Caminhos com espaços são URI-encoded (espaço → %20).
 */
function normalizePreviewUrl(input: string): string {
  const s = input.trim();
  if (!s) return s;
  // Já é URL com scheme
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  // Windows path: C:\... ou C:/...
  if (/^[a-zA-Z]:[\\/]/.test(s)) {
    // Converte \ pra / e percent-encode espaços/chars especiais por segment
    const normalized = s.replace(/\\/g, '/');
    // Split em segments depois do "C:/" e encode cada um (preserva slashes)
    const driveMatch = normalized.match(/^([a-zA-Z]):\/(.*)$/);
    if (driveMatch) {
      const drive = driveMatch[1].toUpperCase();
      const rest = driveMatch[2].split('/').map((seg) => encodeURIComponent(seg)).join('/');
      return `file:///${drive}:/${rest}`;
    }
    return `file:///${normalized}`;
  }
  // Unix-style absolute path
  if (s.startsWith('/')) {
    const encoded = s.split('/').map((seg) => seg ? encodeURIComponent(seg) : '').join('/');
    return `file://${encoded}`;
  }
  // localhost:port ou localhost
  if (/^localhost(:|\/|$)/i.test(s)) return `http://${s}`;
  // IP local com porta
  if (/^\d+\.\d+\.\d+\.\d+(:\d+)?(\/|$)/.test(s)) return `http://${s}`;
  // Domínio com TLD → https default
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s)) return `https://${s}`;
  // Fallback: trata como http path
  return `http://${s}`;
}

async function detectDevServerUrl(cwd: string): Promise<string | null> {
  const selfPort = getSelfPort();
  const candidates: Array<[string, number]> = [
    ['vite.config.ts', 5173],
    ['vite.config.js', 5173],
    ['vite.config.mjs', 5173],
    ['next.config.ts', 3000],
    ['next.config.js', 3000],
    ['next.config.mjs', 3000],
    ['astro.config.ts', 4321],
    ['astro.config.mjs', 4321],
    ['nuxt.config.ts', 3000],
    ['nuxt.config.js', 3000],
    ['svelte.config.js', 5173],
    ['remix.config.js', 3000],
  ];

  for (const [filename, port] of candidates) {
    // Skip se a porta detectada bate com a do próprio UNDRCOD dev server —
    // senão webview carrega recursivamente o UNDRCOD dentro dele e mostra
    // só o logo de splash (sem o seu projeto).
    if (selfPort && port === selfPort) continue;
    try {
      const sep = cwd.includes('\\') ? '\\' : '/';
      const path = `${cwd}${sep}${filename}`;
      const stat = await window.undrcodAPI?.fs.stat(path);
      if (!stat || 'error' in stat) continue;
      if (stat.isFile) {
        return `http://localhost:${port}`;
      }
    } catch { /* ignore */ }
  }
  return null;
}

const TABS: Array<['design' | 'css', string]> = [
  ['design', 'Design'],
  ['css', 'CSS'],
];

export function PreviewView({ cwd, initialUrl, onUrlChange, onNavigate, onClose }: PreviewViewProps) {
  const webviewRef = useRef<WebviewElement | null>(null);
  const [url, setUrl] = useState<string>(initialUrl || '');
  const [inputUrl, setInputUrl] = useState<string>(initialUrl || '');
  const [loading, setLoading] = useState(false);
  const [detected, setDetected] = useState(false);
  // Flag webviewReady — true após dom-ready (declarada AQUI no topo pra
  // ser usada por effects que precisam sincronizar com o ciclo de vida do
  // webview, especialmente arm/disarm do menu-relay).
  // setWebviewReady é chamado no useEffect que gerencia events do webview
  // (mais abaixo no componente).
  const [webviewReady, setWebviewReady] = useState(false);
  useEffect(() => {
    console.log('[menu] PreviewView MOUNTED initialUrl=', initialUrl);
    return () => console.log('[menu] PreviewView UNMOUNTED');
  }, []);

  // Preview zoom — replica IG0 do Cursor (range 25-500%, default 100%).
  // Persistido em localStorage por workspace.
  const ZOOM_MIN = 25;
  const ZOOM_MAX = 500;
  const ZOOM_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];
  const [zoomPercent, setZoomPercent] = useState<number>(() => {
    try {
      const v = localStorage.getItem('undrcode.previewZoom');
      const n = v ? parseInt(v, 10) : 100;
      return Number.isFinite(n) ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, n)) : 100;
    } catch { return 100; }
  });
  // Aplica zoom no webview quando muda
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv?.setZoomFactor) return;
    try { wv.setZoomFactor(zoomPercent / 100); } catch { /* webview not ready */ }
    try { localStorage.setItem('undrcode.previewZoom', String(zoomPercent)); } catch { /* ignore */ }
  }, [zoomPercent, url]);
  const handleZoomOut = useCallback((): void => {
    setZoomPercent((cur) => {
      // Próximo step abaixo de cur
      const below = ZOOM_STEPS.filter((s) => s < cur);
      return below.length > 0 ? below[below.length - 1] : ZOOM_MIN;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleZoomIn = useCallback((): void => {
    setZoomPercent((cur) => {
      const above = ZOOM_STEPS.filter((s) => s > cur);
      return above.length > 0 ? above[0] : ZOOM_MAX;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleZoomReset = useCallback((): void => setZoomPercent(100), []);

  // Browser More Menu (replica n4p do Cursor) — popover ao clicar "..."
  const [moreMenu, setMoreMenu] = useState<{ open: boolean; x: number; y: number }>({
    open: false, x: 0, y: 0,
  });

  // (moved abaixo do ctxMenu state — precisa de ambos pra computar anyMenuOpen)
  const handleHardReload = useCallback((): void => {
    const wv = webviewRef.current;
    if (!wv) return;
    // Hard reload = bypass cache. Electron <webview> tem reloadIgnoringCache(),
    // mas API depende da versão. Fallback: executeJavaScript('location.reload(true)').
    try {
      const anyWv = wv as unknown as { reloadIgnoringCache?: () => void };
      if (typeof anyWv.reloadIgnoringCache === 'function') {
        anyWv.reloadIgnoringCache();
      } else {
        void wv.executeJavaScript('location.reload(true)', false).catch(() => {});
      }
    } catch { /* ignore */ }
  }, []);
  const handleCopyUrl = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url || '');
      const { toast } = await import('../Toast/Toast');
      toast.success('URL copiada pro clipboard');
    } catch {
      const { toast } = await import('../Toast/Toast');
      toast.error('Falha ao copiar URL');
    }
  }, [url]);

  // Webview context menu (right-click) — replica menu Chromium com items reais.
  // Trigger vem via IPC do preload (preview-webview.ts) com x/y no espaço da viewport
  // do webview. Convertemos pra viewport do host somando offset do webview-element.
  const [ctxMenu, setCtxMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    hasSelection: boolean;
    isEditable: boolean;
  }>({ open: false, x: 0, y: 0, hasSelection: false, isEditable: false });

  // Computa se há algum menu aberto. Trigger pra arm/disarm o relay no
  // preload do webview (ver useEffect abaixo). Quando armed, qualquer
  // mousedown DENTRO do webview gera IPC `preview-menu-relay-click` que
  // chega aqui via `ipc-message` listener e fecha o menu.
  //
  // Soluções que NÃO funcionam (todas testadas, documentadas no preload):
  //   - `pointer-events: none` no <webview>: compositing layer não respeita
  //   - Overlay <div> z-index: BrowserView pinta acima do DOM host
  //   - CDP `Input.setIgnoreInputEvents` SOZINHO: dropa input mas não
  //     redireciona pra host → click some, menu não fecha
  //
  // O armed-relay funciona porque o preload PROPRIO do guest captura o
  // mousedown e sendToHost ANTES da página processar. preventDefault
  // ainda mata o click side-effect na página.
  const anyMenuOpen = moreMenu.open || ctxMenu.open;

  // Effect: arma/desarma o "menu-relay" no preload do webview conforme
  // menu state. ESSE é o mecanismo PRIMÁRIO de outside-click pra menus
  // abertos no host enquanto user clica DENTRO do webview.
  //
  // Como funciona (resumido — detalhes no preload `preview-webview.ts`):
  //   - Preload tem um mousedown listener (capture) sempre attachado
  //   - Listener só ENVIA IPC pro host quando flag local `armed=true`
  //   - Host arma quando menu abre, desarma quando fecha
  //   - Click DENTRO do webview com menu aberto → IPC `preview-menu-relay-click`
  //     chega via `ipc-message` listener do host → fecha menu
  //   - Click DENTRO do webview SEM menu aberto → early-return imediato
  //     no preload, zero IPC traffic
  //
  // Também mantém o `setIgnoreInputEvents` CDP como camada secundária
  // — bloqueia a página de receber o click (defesa contra side-effects
  // tipo activar link no clique de fechar menu). Se CDP falhar, o
  // armed-relay ainda fecha o menu (preload é o owner do mousedown).
  //
  // Por que armed-relay + CDP, não só armed-relay:
  //   - preload preventDefault já bloqueia eventos no guest → CDP é redundante
  //   - mas CDP é uma defesa em profundidade caso preload race com page script
  //     (ex: page tem own capture-phase mousedown que stopImmediatePropagation antes)
  // Track sync entre state menu e preload. Quando webview re-mounta ou
  // dom-ready, perde estado armed do preload — precisamos re-arm se
  // anyMenuOpen=true naquele momento. armedSyncedRef guarda último valor
  // enviado, pra evitar double-send quando ambos deps disparam juntos.
  const armedSyncedRef = useRef<boolean | null>(null);

  useEffect(() => {
    console.log('[menu] anyMenuOpen =', anyMenuOpen, '(moreMenu.open=', moreMenu.open, 'ctxMenu.open=', ctxMenu.open, ')');
    const wv = webviewRef.current;
    if (!wv) {
      console.log('[menu] webviewRef.current is NULL — skipping (will retry on webview ready via separate effect)');
      // Limpa cache de "last synced" pra próximo effect ter incentivo a re-enviar
      armedSyncedRef.current = null;
      return;
    }
    console.log('[menu] webview ref exists, proceeding');
    // 1) Arma/desarma o relay no preload (PRIMÁRIO)
    // wv.send precisa do webview ATTACHED — webviewReady garante dom-ready.
    // Se não estiver pronto, ainda assim tenta (try/catch) — em casos de
    // menu aberto pré-load (raro), só silencia.
    try {
      wv.send(anyMenuOpen ? 'undrcod:menu-arm' : 'undrcod:menu-disarm');
      armedSyncedRef.current = anyMenuOpen;
      console.log('[menu] sent', anyMenuOpen ? 'undrcod:menu-arm' : 'undrcod:menu-disarm', 'to target webview');
    } catch (err) {
      console.warn('[menu] webview send failed:', err);
    }
    // NOTA: devtools-host webview NÃO recebe preload (DevTools UI roda em
    // chrome-devtools:// que ignora preload por CSP). Clicks em DevTools com
    // menu aberto vão depender do overlay <div> fallback OU do user clicar
    // novamente fora. UX P1 — primary case (clicks na página previewada) é
    // resolvido pelo armed-relay no target webview.

    // 2) Camada secundária: CDP setIgnoreInputEvents (best-effort)
    type UNDRCODInputAPI = {
      previewSetIgnoreInput?: (id: number, ignore: boolean) => Promise<{ ok: boolean }>;
    };
    const api = (window as unknown as { undrcodAPI?: UNDRCODInputAPI }).undrcodAPI;
    if (api?.previewSetIgnoreInput) {
      let id: number;
      try {
        id = wv.getWebContentsId();
        void api.previewSetIgnoreInput(id, anyMenuOpen)
          .then((r) => console.log('[menu] CDP setIgnoreInput', anyMenuOpen, 'result:', r))
          .catch(() => { /* ignore */ });
      } catch { /* ignore */ }
    }

    return () => {
      // Cleanup: se anyMenuOpen=true e component unmounta antes do menu
      // fechar, garante que TUDO fica desarmado pra próxima sessão.
      if (anyMenuOpen) {
        try { wv.send('undrcod:menu-disarm'); } catch { /* ignore */ }
        if (api?.previewSetIgnoreInput) {
          try {
            const id = wv.getWebContentsId();
            void api.previewSetIgnoreInput(id, false).catch(() => { /* ignore */ });
          } catch { /* ignore */ }
        }
      }
    };
  }, [anyMenuOpen]);

  // === TRUCO #1 (Cursor pattern): polling de focus pro outside-click ===
  // Quando armed-relay + CDP setIgnoreInputEvents falham (ex: preload race,
  // CDP rejected), o focus DOM ainda é um sinal confiável: ao clicar no
  // <webview>, document.activeElement aponta pra ele. Polling de 100ms
  // detecta a mudança e fecha menus.
  //
  // Funciona porque <webview> tag (Electron) é elemento DOM real do tipo
  // EmbeddedHTMLElement — receber focus dele é evento padrão do navegador.
  // VS Code/Cursor usam técnica equivalente no `index.html` do webview
  // wrapper (linha 47-63), com interval=250ms. Usamos 100ms pra UX mais
  // responsiva — overhead é negligível (1 comparação de DOM node).
  //
  // Effect roda só quando menu aberto. Cleanup limpa o interval.
  useEffect(() => {
    if (!anyMenuOpen) return;
    const wv = webviewRef.current;
    if (!wv) return;
    // Estado inicial: foco ainda no host (menu acabou de abrir via click no host)
    let lastFocusWasWebview = document.activeElement === wv;
    const interval = window.setInterval(() => {
      const focusIsWebview = document.activeElement === wv;
      // Transição host→webview = user clicou dentro do webview → fecha menus
      if (focusIsWebview && !lastFocusWasWebview) {
        console.log('[menu] focus polling detected webview gained focus → closing menus');
        setMoreMenu((m) => ({ ...m, open: false }));
        setCtxMenu((m) => ({ ...m, open: false }));
      }
      lastFocusWasWebview = focusIsWebview;
    }, 100);
    return () => window.clearInterval(interval);
  }, [anyMenuOpen]);

  // Exec command no webview (Cut/Copy/Paste/Undo/Redo/SelectAll).
  const execInWebview = useCallback((command: string): void => {
    const wv = webviewRef.current;
    if (!wv) return;
    void wv.executeJavaScript(`document.execCommand(${JSON.stringify(command)})`, false).catch(() => {});
  }, []);

  // "Bloquear JS" toggle — útil pra ver SPAs em file:// que dão 404 porque
  // o JS detecta pathname inválido e renderiza <NotFound />. Com JS off,
  // o HTML estático fica visível (CSS continua aplicando).
  // Per-URL: cada URL tem seu próprio toggle (persistido). Default false.
  const [jsDisabled, setJsDisabled] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(`undrcode.previewJsDisabled.${url}`);
      return v === 'true';
    } catch { return false; }
  });
  // Re-lê quando URL muda
  useEffect(() => {
    try {
      const v = localStorage.getItem(`undrcode.previewJsDisabled.${url}`);
      setJsDisabled(v === 'true');
    } catch { /* ignore */ }
  }, [url]);
  const toggleJsDisabled = useCallback((): void => {
    setJsDisabled((prev) => {
      const next = !prev;
      try { localStorage.setItem(`undrcode.previewJsDisabled.${url}`, next ? 'true' : 'false'); } catch { /* ignore */ }
      // Força reload do webview com nova flag (webview attr só aplica on attach)
      const wv = webviewRef.current;
      if (wv) {
        try { wv.reload(); } catch { /* ignore */ }
      }
      return next;
    });
  }, [url]);

  // Atalhos: Ctrl+= zoom in, Ctrl+- zoom out, Ctrl+0 reset.
  // Só aplica quando o preview tem foco (target dentro de .preview-view-root).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      // Só captura se foco está dentro do nosso component (não roubar do app)
      if (!target?.closest('.preview-view-root')) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        handleZoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        handleZoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        handleZoomReset();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleZoomIn, handleZoomOut, handleZoomReset]);

  // DevTools embedado à direita — segundo <webview> que vira "host" do
  // DevTools UI via setDevToolsWebContents() no main process.
  // Cursor pattern: setDevToolsWebContents + openDevTools + reconnect cycle.
  const devtoolsHostRef = useRef<WebviewElement | null>(null);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const [devtoolsHostReady, setDevtoolsHostReady] = useState(false);

  // Listen dom-ready do companion webview pra marcar pronto
  useEffect(() => {
    if (!devtoolsOpen) {
      setDevtoolsHostReady(false);
      return;
    }
    const host = devtoolsHostRef.current;
    if (!host) return;
    const onReady = (): void => {
      console.log('[preview:devtools] companion dom-ready');
      setDevtoolsHostReady(true);
    };
    host.addEventListener('dom-ready', onReady);
    // Race fix: se já tá attached, dom-ready pode ter passado
    try {
      const id = host.getWebContentsId();
      if (typeof id === 'number') setDevtoolsHostReady(true);
    } catch { /* not attached yet */ }
    return () => {
      try { host.removeEventListener('dom-ready', onReady); } catch { /* ignore */ }
    };
  }, [devtoolsOpen]);

  // Dispara IPC attach quando ambos target + companion estiverem prontos.
  // Cursor pattern: setDevToolsWebContents(host) + openDevTools + reconnect cycle.
  const attachedDevtoolsRef = useRef(false);
  useEffect(() => {
    const target = webviewRef.current;
    if (!target) return;
    type UNDRCODPreviewDT = {
      previewAttachDevtools?: (t: number, h: number) => Promise<{ ok: boolean; error?: string }>;
      previewDetachDevtools?: (t: number) => Promise<{ ok: boolean; error?: string }>;
    };
    const api = (window as unknown as { undrcodAPI?: UNDRCODPreviewDT }).undrcodAPI;
    if (!api) return;
    if (devtoolsOpen && devtoolsHostReady && !attachedDevtoolsRef.current) {
      const host = devtoolsHostRef.current;
      if (!host) return;
      attachedDevtoolsRef.current = true;
      try {
        const targetId = target.getWebContentsId();
        const hostId = host.getWebContentsId();
        console.log('[preview:devtools] attaching', { targetId, hostId });
        void api.previewAttachDevtools?.(targetId, hostId);
      } catch (err) {
        console.warn('[preview:devtools] attach failed:', err);
        attachedDevtoolsRef.current = false;
      }
    } else if (!devtoolsOpen && attachedDevtoolsRef.current) {
      attachedDevtoolsRef.current = false;
      try {
        const targetId = target.getWebContentsId();
        void api.previewDetachDevtools?.(targetId);
      } catch { /* ignore */ }
    }
  }, [devtoolsOpen, devtoolsHostReady]);
  // Largura do panel devtools em px. Persiste no localStorage.
  const [devtoolsWidth, setDevtoolsWidth] = useState<number>(() => {
    try {
      const v = localStorage.getItem('undrcode.devtoolsWidth');
      return v ? Math.max(280, Math.min(1200, parseInt(v, 10) || 480)) : 480;
    } catch { return 480; }
  });
  // Drag state — quando true, overlay aparece pra capturar mouse events
  // que normalmente seriam comidos pelos <webview> (problema clássico em
  // Electron: webview intercepta pointer events do host).
  const [resizingDevtools, setResizingDevtools] = useState(false);
  const [resizingInspector, setResizingInspector] = useState(false);

  // Largura do inspector panel (Components/Design/CSS). Persiste em localStorage.
  const [inspectorWidth, setInspectorWidth] = useState<number>(() => {
    try {
      const v = localStorage.getItem('undrcode.inspectorWidth');
      return v ? Math.max(260, Math.min(800, parseInt(v, 10) || 340)) : 340;
    } catch { return 340; }
  });
  useEffect(() => {
    try { localStorage.setItem('undrcode.inspectorWidth', String(inspectorWidth)); } catch { /* ignore */ }
  }, [inspectorWidth]);

  /**
   * Altura da Components tree (top section do inspector). Resizable vertical.
   * Range 80-500px. Persiste em localStorage. Quando user arrasta o divider
   * abaixo da tree, esse state muda e o resto do espaço vira pra Design/CSS.
   */
  const [inspectorTreeHeight, setInspectorTreeHeight] = useState<number>(() => {
    try {
      const v = localStorage.getItem('undrcode.inspectorTreeHeight');
      return v ? Math.max(80, Math.min(500, parseInt(v, 10) || 220)) : 220;
    } catch { return 220; }
  });
  const [resizingTree, setResizingTree] = useState(false);
  useEffect(() => {
    try { localStorage.setItem('undrcode.inspectorTreeHeight', String(inspectorTreeHeight)); } catch { /* ignore */ }
  }, [inspectorTreeHeight]);
  const treeResizeStartRef = useRef<{ startY: number; startHeight: number } | null>(null);
  useEffect(() => {
    if (!resizingTree) return;
    const onMove = (e: MouseEvent): void => {
      if (!treeResizeStartRef.current) return;
      const delta = e.clientY - treeResizeStartRef.current.startY;
      const next = Math.max(80, Math.min(500, treeResizeStartRef.current.startHeight + delta));
      setInspectorTreeHeight(next);
    };
    const onUp = (): void => {
      setResizingTree(false);
      treeResizeStartRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [resizingTree]);
  const previewBodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    try { localStorage.setItem('undrcode.devtoolsWidth', String(devtoolsWidth)); } catch { /* ignore */ }
  }, [devtoolsWidth]);
  // Container ref pra calcular largura disponivel durante drag.
  const previewContentRef = useRef<HTMLDivElement | null>(null);
  // Ref do botão "N Edits" no toolbar do inspector — usado pelo EditsPopover
  // pra calcular posição via getBoundingClientRect (position: fixed escapa
  // overflow:hidden de panels pai).
  const editsBtnRef = useRef<HTMLButtonElement | null>(null);

  // Inspector state
  const [inspectMode, setInspectMode] = useState(false);
  const [inspectorPanelOpen, setInspectorPanelOpen] = useState(false);
  const [selectedElement, setSelectedElement] = useState<InspectedElement | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'design' | 'css'>('design');
  // DOM tree state SEPARADO do selectedElement: persiste entre style changes
  // (element-updated não traz domTree) e fica disponível mesmo sem seleção.
  const [domTree, setDomTree] = useState<DomTreeNode | null>(null);

  // MULTI-SELECT: uids extras selecionados via Ctrl+click no webview.
  // O primary continua sendo selectedElement. Esses extras ganham overlay
  // pintado pelo preload e participam do arrow-key nudge.
  const [selectedExtraUids, setSelectedExtraUids] = useState<Set<string>>(() => new Set());

  // VIEWPORT MODE: simula desktop/tablet/mobile no preview restringindo a width
  // do webview. Persistido em localStorage pra voltar no mesmo estado.
  type ViewportMode = 'desktop' | 'tablet' | 'mobile';
  const [viewportMode, setViewportMode] = useState<ViewportMode>(() => {
    try {
      const saved = localStorage.getItem('undrcode.viewportMode');
      if (saved === 'desktop' || saved === 'tablet' || saved === 'mobile') return saved;
    } catch {}
    return 'desktop';
  });
  useEffect(() => {
    try { localStorage.setItem('undrcode.viewportMode', viewportMode); } catch {}
  }, [viewportMode]);

  // FIND IN PAGE (Ctrl+F): barra flutuante de busca no preview.
  // Usa webview.findInPage / stopFindInPage / found-in-page event (Electron API).
  // Diferencial vs Cursor: preview tem find próprio (Cursor confia no Chromium).
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResult, setFindResult] = useState<{ active: number; total: number }>({ active: 0, total: 0 });
  const findInputRef = useRef<HTMLInputElement | null>(null);

  // Path do preload do webview (resolve via main, depende do __dirname dele).
  // null durante o boot (~50ms); render do webview espera resolver.
  const [previewPreload, setPreviewPreload] = useState<string | null>(null);
  useEffect(() => {
    const fn = window.undrcodAPI?.getPreviewPreload;
    if (typeof fn !== 'function') return;
    void fn().then((p) => setPreviewPreload(p)).catch(() => { /* sem preload, inspector desabilitado */ });
  }, []);

  // Auto-detect com cancel flag — previne race: se initialUrl chegar via
  // event ENQUANTO detectDevServerUrl tá pendente, o .then resolveria depois
  // e sobrescreveria a URL nova com a detectada. Cleanup cancela a promise.
  useEffect(() => {
    if (initialUrl || detected) return;
    let cancelled = false;
    detectDevServerUrl(cwd).then((detectedUrl) => {
      if (cancelled) return;
      setDetected(true);
      if (detectedUrl) {
        setUrl(detectedUrl);
        setInputUrl(detectedUrl);
        onUrlChange?.(detectedUrl);
      }
    });
    return () => { cancelled = true; };
  }, [cwd, initialUrl, detected, onUrlChange]);

  // DevTools agora usa API NATIVA do <webview> element (wv.openDevTools()).
  // Listeners 'devtools-opened' e 'devtools-closed' do próprio webview sincronizam
  // o state quando user fecha a janela via X — sem precisar de IPC custom.
  useEffect(() => {
    if (!webviewReady) return;
    const wv = webviewRef.current;
    if (!wv) return;
    const onOpened = (): void => {
      console.log('[preview:devtools] webview devtools-opened event');
      setDevtoolsOpen(true);
    };
    const onClosed = (): void => {
      console.log('[preview:devtools] webview devtools-closed event');
      setDevtoolsOpen(false);
    };
    wv.addEventListener('devtools-opened', onOpened);
    wv.addEventListener('devtools-closed', onClosed);
    return () => {
      wv.removeEventListener('devtools-opened', onOpened);
      wv.removeEventListener('devtools-closed', onClosed);
    };
  }, [webviewReady]);

  // Track quando o webview tá pronto pra receber .send() — Electron exige
  // attach ao DOM + dom-ready ANTES de qualquer IPC. Sem essa flag, chamar
  // wv.send() cedo demais joga "WebView must be attached..." direto na
  // ErrorBoundary e trava o app.
  // (Já declarado no topo do componente — esta linha removida.)

  // Sincroniza url com initialUrl quando muda externamente — ex: "Abrir no
  // preview do app" dispatcha undrcod:open-preview que muda previewUrl em App.tsx
  // que repassa via initialUrl.
  //
  // CRÍTICO: <webview> do Electron NÃO recarrega quando React atualiza o
  // atributo `src` — só lê no attach inicial. Por isso usamos loadURL()
  // imperativo. Esse é o bug clássico que faz a URL travar.
  useEffect(() => {
    if (initialUrl && initialUrl !== url) {
      setUrl(initialUrl);
      setInputUrl(initialUrl);
      const wv = webviewRef.current;
      if (wv && webviewReady) {
        try {
          wv.executeJavaScript(`location.href = ${JSON.stringify(initialUrl)}`).catch(() => {
            // Fallback: tenta loadURL via electron API quando executeJavaScript falha
            // (ex: file:// → file:// cross-origin block).
            const wvAny = wv as unknown as { loadURL?: (u: string) => Promise<void> };
            wvAny.loadURL?.(initialUrl).catch(() => { /* ignore */ });
          });
        } catch { /* ignore */ }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl, webviewReady]);

  // Loading state + IPC bridge via preload do webview (espelha Cursor's preload-webview-browser).
  // Antes: console.log bridge → console-message event no host = string parsing em CADA log da página.
  // Agora: ipcRenderer.sendToHost no preload → ipc-message event no host = IPC nativo, zero overhead.
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    setWebviewReady(false);
    const handleStart = (): void => setLoading(true);
    const handleStop = (): void => setLoading(false);
    const handleDomReady = (): void => setWebviewReady(true);
    const handleDestroyed = (): void => setWebviewReady(false);
    // did-navigate dispara em top-level navigation (click em <a>, location.href=).
    // did-navigate-in-page dispara em hash/pushState changes (SPAs).
    // Atualiza state local + chama onNavigate pro App.tsx sincronizar tab atual.
    const handleNavigate = (e: Event): void => {
      const ne = e as Event & { url?: string };
      const newUrl = ne.url || webviewRef.current?.getURL();
      if (!newUrl) return;
      setUrl(newUrl);
      setInputUrl(newUrl);
      onNavigate?.(newUrl);
      onUrlChange?.(newUrl);
    };
    const handleIpcMessage = (e: Event): void => {
      const ev = e as IpcMessageEvent;
      switch (ev.channel) {
        case 'element-selected': {
          const data = ev.args[0] as InspectedElement;
          if (!data) return;
          setSelectedElement(data);
          // domTree só vem em element-selected (sendPicked), preserva no update.
          if (data.domTree) setDomTree(data.domTree);
          // Click normal limpa extras (preload já limpou seu lado; sync host).
          setSelectedExtraUids((prev) => (prev.size === 0 ? prev : new Set()));
          // NÃO abre painel automaticamente — user controla via botão dedicado.
          break;
        }
        case 'element-additional-selected': {
          const payload = ev.args[0] as { uid?: string } | undefined;
          if (!payload?.uid) return;
          setSelectedExtraUids((prev) => {
            if (prev.has(payload.uid as string)) return prev;
            const next = new Set(prev);
            next.add(payload.uid as string);
            return next;
          });
          break;
        }
        case 'element-deselected': {
          const payload = ev.args[0] as { uid?: string } | undefined;
          if (!payload?.uid) return;
          setSelectedExtraUids((prev) => {
            if (!prev.has(payload.uid as string)) return prev;
            const next = new Set(prev);
            next.delete(payload.uid as string);
            return next;
          });
          break;
        }
        case 'nudge-committed': {
          // User pressed Enter após arrow nudges. Adiciona left/top edits ao
          // pendingEdits ring pra aparecer no "N Edits" + Apply.
          const payload = ev.args[0] as {
            entries?: Array<{
              uid: string;
              tag: string;
              id: string;
              classes: string[];
              text: string;
              left: number;
              top: number;
            }>;
          } | undefined;
          if (!payload?.entries?.length) return;
          setPendingEdits((prev) => {
            const next = prev.slice();
            for (const entry of payload.entries!) {
              let sel = entry.tag || 'element';
              if (entry.id) sel += `#${entry.id}`;
              if (entry.classes?.length) sel += '.' + entry.classes.slice(0, 2).join('.');
              const elementHtml =
                `<${entry.tag}` +
                (entry.id ? ` id="${entry.id}"` : '') +
                (entry.classes?.length ? ` class="${entry.classes.join(' ')}"` : '') +
                '>';
              // Adiciona position:relative + left + top como entries separadas (todas
              // com mesmo selector → o handleApply agrupa no mesmo bloco CSS).
              const props: Array<[string, string]> = [
                ['position', 'relative'],
              ];
              if (entry.left !== 0) props.push(['left', `${entry.left}px`]);
              if (entry.top !== 0) props.push(['top', `${entry.top}px`]);
              for (const [property, value] of props) {
                const idx = next.findIndex((e) => e.selector === sel && e.property === property);
                if (idx >= 0) {
                  next[idx] = { ...next[idx], value, ts: Date.now() };
                } else {
                  next.push({
                    selector: sel,
                    property,
                    value,
                    prevValue: '',
                    ts: Date.now(),
                    elementHtml,
                    pathStr: sel,
                    text: entry.text,
                  });
                }
              }
            }
            return next;
          });
          break;
        }
        case 'text-edited': {
          // User editou texto inline via double-click (contenteditable).
          // Adiciona pending edit kind:'text' pra agente saber a mudança.
          const payload = ev.args[0] as {
            uid?: string;
            oldText?: string;
            newText?: string;
            tag?: string;
            id?: string;
            classes?: string[];
          } | undefined;
          if (!payload || typeof payload.newText !== 'string') return;
          const tag = payload.tag || 'element';
          const classes = payload.classes || [];
          let sel = tag;
          if (payload.id) sel += `#${payload.id}`;
          if (classes.length) sel += '.' + classes.slice(0, 2).join('.');
          const fullClasses = classes.join(' ');
          const elementHtml = `<${tag}` +
            (payload.id ? ` id="${payload.id}"` : '') +
            (fullClasses ? ` class="${fullClasses}"` : '') +
            '>';
          const truncated = (payload.newText || '').trim().slice(0, 80);
          setPendingEdits((prev) => [
            ...prev,
            {
              selector: sel,
              property: 'textContent',
              value: payload.newText || '',
              prevValue: payload.oldText || '',
              ts: Date.now(),
              elementHtml,
              pathStr: sel,
              text: truncated,
              kind: 'text',
            },
          ]);
          break;
        }
        case 'element-updated': {
          // Re-emitido pelo preload após apply-style — atualiza painel sem
          // perder a seleção. UI mostra os computed styles novos.
          // NOTA: preserva domTree antigo aqui (update não traz tree pra
          // evitar custo de rebuild a cada style change).
          const data = ev.args[0] as InspectedElement;
          if (!data) return;
          setSelectedElement(data);
          break;
        }
        case 'inspector-escape':
          setInspectMode(false);
          break;
        case 'preview-zoom-wheel': {
          // Ctrl+Wheel no webview → avança step de zoom.
          // Atualiza state imediatamente (display do % muda em tempo real).
          const payload = ev.args[0] as { direction?: 'in' | 'out' } | undefined;
          if (payload?.direction === 'in') handleZoomIn();
          else if (payload?.direction === 'out') handleZoomOut();
          break;
        }
        case 'preview-context-menu': {
          // Right-click no webview → abrir custom context menu.
          // Coords vêm em viewport-space do webview. Converte pra viewport do host
          // somando offset do <webview> element (que pode estar em qualquer pos).
          const payload = ev.args[0] as {
            x?: number; y?: number; hasSelection?: boolean; isEditable?: boolean;
          } | undefined;
          const wv = webviewRef.current;
          if (!wv || !payload) break;
          const rect = wv.getBoundingClientRect();
          setCtxMenu({
            open: true,
            x: (payload.x ?? 0) + rect.left,
            y: (payload.y ?? 0) + rect.top,
            hasSelection: !!payload.hasSelection,
            isEditable: !!payload.isEditable,
          });
          // Fecha outros menus abertos (só um aberto por vez)
          setMoreMenu((prev) => ({ ...prev, open: false }));
          break;
        }
        case 'preview-menu-relay-click': {
          // Click DENTRO do webview enquanto menu host está aberto.
          // Preload só envia esse evento quando "armado" (host abriu menu).
          // Aqui simplesmente fecha ambos os menus — guarded com `prev.open`
          // pra não causar re-render se ambos já fechados (defensive).
          console.log('[menu] received preview-menu-relay-click — closing menus');
          setMoreMenu((prev) => prev.open ? { ...prev, open: false } : prev);
          setCtxMenu((prev) => prev.open ? { ...prev, open: false } : prev);
          break;
        }
        // 'preview-click' não é mais usado — outside-click via CSS pointer-events.
        case 'inspector-ready':
        case 'style-applied':
          break;
        default:
          break;
      }
    };
    wv.addEventListener('did-start-loading', handleStart);
    wv.addEventListener('did-stop-loading', handleStop);
    wv.addEventListener('dom-ready', handleDomReady);
    wv.addEventListener('destroyed', handleDestroyed);
    wv.addEventListener('ipc-message', handleIpcMessage);
    wv.addEventListener('did-navigate', handleNavigate);
    wv.addEventListener('did-navigate-in-page', handleNavigate);
    return () => {
      wv.removeEventListener('did-start-loading', handleStart);
      wv.removeEventListener('did-stop-loading', handleStop);
      wv.removeEventListener('dom-ready', handleDomReady);
      wv.removeEventListener('destroyed', handleDestroyed);
      wv.removeEventListener('ipc-message', handleIpcMessage);
      wv.removeEventListener('did-navigate', handleNavigate);
      wv.removeEventListener('did-navigate-in-page', handleNavigate);
    };
    // Dep `[]`: listeners não referenciam `url`, só precisam attach UMA vez.
    // Antes tinha `[url]` que re-wired tudo a cada URL change e disparava
    // `setWebviewReady(false)` síncrono → cascade de effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewPreload]);

  // Sincroniza inspectMode → manda mensagem pro preload via wv.send().
  // Só dispara depois do webview estar attached + dom-ready (webviewReady).
  // try/catch defensivo: se mesmo assim o send falhar (race condition em
  // navegação), só ignora — o estado React permanece consistente.
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady) return;
    try {
      wv.send(inspectMode ? 'undrcod:inspector-activate' : 'undrcod:inspector-deactivate');
    } catch (err) {
      console.warn('[preview] inspector send failed:', err);
    }
  }, [inspectMode, webviewReady]);

  /**
   * applyStyle — chama window.__undrcodInspector.applyStyle DIRETAMENTE no
   * page context via webview.executeJavaScript. Preload re-emite
   * `element-updated` com computed styles novos.
   *
   * Mais robusto que IPC: chamada síncrona, sem channel routing.
   */
  // Track de edits pendentes pro contador "N Edits" + Apply (Cursor pattern).
  // Persiste em memória (não localStorage — reset por session faz sentido pra edits).
  //
  // Cada edit guarda um SNAPSHOT do elemento no momento do edit (tag/id/classes
  // completos + path breadcrumb + inner text). Isso é crítico porque:
  //   1. User pode trocar de selectedElement antes do Apply
  //   2. Agente precisa de contexto ESTRUTURAL do source (tag + classes + path +
  //      text) pra grepar no codebase. NÃO precisa de computed styles ou
  //      position/size — são valores resolvidos pelo browser que NÃO existem
  //      literalmente no source (Tailwind `w-full` → 185.51px no browser).
  type PendingEdit = {
    selector: string;
    property: string;
    value: string;
    prevValue: string;
    ts: number;
    /** Tag opening completa: `<h1 id="x" class="font-serif text-[2.5rem] ...">` */
    elementHtml: string;
    /** Breadcrumb: `main.pt-16 > section#hero > div.max-w-4xl > h1.font-serif` */
    pathStr: string;
    /** Inner text truncado (~80 chars) — útil pra elementos sem id/class única */
    text: string;
    /** 'css' (default) = style change. 'text' = textContent edit via contenteditable. */
    kind?: 'css' | 'text';
  };
  const [pendingEdits, setPendingEdits] = useState<PendingEdit[]>([]);
  // Popover "N CHANGES" — abre quando user clica no contador "N Edits".
  // Mostra diff list (oldValue → newValue) agrupado por element (Cursor pattern).
  const [editsPopoverOpen, setEditsPopoverOpen] = useState(false);

  const applyStyle = useCallback((property: string, value: string): void => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady || !selectedElement) return;
    const uid = selectedElement.uid || '';
    const el = selectedElement;
    // Selector legível: `tag#id.class1.class2` (CSS selector simples — só 2 classes
    // pro counter UI, pq classes Tailwind ficam enormes).
    let sel = el.tag || 'element';
    if (el.id) sel += `#${el.id}`;
    if (el.classes?.length) sel += '.' + el.classes.slice(0, 2).join('.');
    // Snapshot do ELEMENT pro contexto rico no Apply:
    //   - elementHtml: tag opening completa com TODAS as classes (não corta)
    //   - pathStr: breadcrumb DOM (raiz → atual) tipo `main > section#hero > h1.font-serif`
    //   - text: innerText truncado a 80 chars, espaços normalizados
    const fullClasses = (el.classes || []).join(' ');
    const elementHtml =
      `<${el.tag}` +
      (el.id ? ` id="${el.id}"` : '') +
      (fullClasses ? ` class="${fullClasses}"` : '') +
      '>';
    const pathStr = (el.path || [])
      .map((p) => {
        let s = p.tag;
        if (p.id) s += `#${p.id}`;
        if (p.classes?.length) s += '.' + p.classes.slice(0, 2).join('.');
        return s;
      })
      .join(' > ');
    const text = (el.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const prevValue = el.allStyles?.[property] || '';
    setPendingEdits((prev) => {
      // BUG FIX #205: drag do ScrubLabel chamava applyStyle por PIXEL (centenas
      // de calls por drag), todas adicionadas como entries separadas → counter
      // explodia ("2300 Edits" depois de 1 ajuste).
      //
      // Fix: dedupe por (selector + property). Se já existe edit pra mesma
      // (selector, property), SUBSTITUI o value mantendo prevValue ORIGINAL
      // (pra Apply gerar CSS correto + undo voltar pro valor pre-drag).
      const idx = prev.findIndex((e) => e.selector === sel && e.property === property);
      if (idx >= 0) {
        const next = prev.slice();
        // Atualiza value + ts mas mantém prevValue + element snapshot original.
        next[idx] = { ...next[idx], value, ts: Date.now() };
        return next;
      }
      return [...prev, {
        selector: sel,
        property,
        value,
        prevValue,
        ts: Date.now(),
        elementHtml,
        pathStr,
        text,
      }];
    });
    const code = `window.__undrcodInspector && window.__undrcodInspector.applyStyle(${JSON.stringify(uid)}, ${JSON.stringify(property)}, ${JSON.stringify(value)})`;
    wv.executeJavaScript(code, false).catch((err) => {
      console.warn('[preview] applyStyle failed:', err);
    });

    // MULTI-SELECT: aplica a mesma propriedade nos EXTRAS selecionados.
    // Pra cada uid extra, snapshot do elemento + push no pendingEdits + apply via inspector.
    if (selectedExtraUids.size > 0) {
      const extraUids = Array.from(selectedExtraUids);
      // 1. Apply visual em todos os extras via executeJavaScript (já tem getMatchedElement
      //    em __undrcodInspector.applyStyle que faz querySelector pelo data-undrcod-uid).
      const extrasCode = `(() => {
        const I = window.__undrcodInspector;
        if (!I) return;
        ${JSON.stringify(extraUids)}.forEach((u) => {
          try { I.applyStyle(u, ${JSON.stringify(property)}, ${JSON.stringify(value)}); } catch {}
        });
      })()`;
      wv.executeJavaScript(extrasCode, false).catch(() => { /* noop */ });

      // 2. Pra cada extra, snapshot do elemento via inspector e add pending edit.
      //    Cada extra vira uma entry separada no pendingEdits (selector diferente)
      //    → no Apply, cada um vira um bloco CSS distinto pro agente.
      const snapshotCode = `(() => {
        const out = [];
        ${JSON.stringify(extraUids)}.forEach((u) => {
          const el = document.querySelector('[data-undrcod-uid="' + u + '"]');
          if (!el) return;
          const cs = window.getComputedStyle(el);
          out.push({
            uid: u,
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            classes: Array.from(el.classList),
            text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
            prevValue: cs.getPropertyValue(${JSON.stringify(property)}) || '',
          });
        });
        return out;
      })()`;
      wv.executeJavaScript(snapshotCode, false).then((snapshots) => {
        if (!Array.isArray(snapshots) || snapshots.length === 0) return;
        setPendingEdits((prev) => {
          let next = prev.slice();
          for (const s of snapshots as Array<{ uid: string; tag: string; id: string; classes: string[]; text: string; prevValue: string }>) {
            let extraSel = s.tag || 'element';
            if (s.id) extraSel += `#${s.id}`;
            if (s.classes?.length) extraSel += '.' + s.classes.slice(0, 2).join('.');
            const extraElementHtml =
              `<${s.tag}` +
              (s.id ? ` id="${s.id}"` : '') +
              (s.classes?.length ? ` class="${s.classes.join(' ')}"` : '') +
              '>';
            const idx2 = next.findIndex((e) => e.selector === extraSel && e.property === property);
            if (idx2 >= 0) {
              next[idx2] = { ...next[idx2], value, ts: Date.now() };
            } else {
              next.push({
                selector: extraSel,
                property,
                value,
                prevValue: s.prevValue,
                ts: Date.now(),
                elementHtml: extraElementHtml,
                pathStr: extraSel,
                text: s.text,
              });
            }
          }
          return next;
        });
      }).catch(() => { /* noop */ });
    }
  }, [webviewReady, selectedElement, selectedExtraUids]);

  /** Undo última mudança de style. Também remove da lista de pending. */
  const undoStyle = useCallback((): void => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady) return;
    wv.executeJavaScript('window.__undrcodInspector && window.__undrcodInspector.undo()', false).catch(() => {});
    setPendingEdits((prev) => prev.slice(0, -1));
  }, [webviewReady]);

  /** Redo. */
  const redoStyle = useCallback((): void => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady) return;
    wv.executeJavaScript('window.__undrcodInspector && window.__undrcodInspector.redo()', false).catch(() => {});
    // Nota: redo não recoloca o edit na lista — assumimos que o user
    // confiou no estado e segue daí. (Cursor faz igual: undo stack é linear.)
  }, [webviewReady]);

  /** Reset: remove TODAS as mudanças inline do elemento selecionado.
   *  Também limpa todos os pending edits desse elemento. */
  const resetStyles = useCallback((): void => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady) return;
    wv.executeJavaScript('window.__undrcodInspector && window.__undrcodInspector.resetSelection()', false).catch(() => {});
    // Limpa pending — reset é checkpoint negativo (volta ao default)
    setPendingEdits([]);
  }, [webviewReady]);

  /** Apply (Cursor pattern: anexa edits ao chat composer).
   *
   *  Replica o flow do Cursor (investigado no bundle workbench.desktop.main.js
   *  ~line 30960+37074): o Apply NÃO copia pro clipboard nem edita source direto.
   *  Em vez disso anexa o element + diff como chip de typeahead no composer richText
   *  e foca o input — user adiciona msg opcional → send → agente edita source.
   *
   *  Nosso wrapper:
   *    1. Agrupa pending edits por selector (último valor por property, prevValue ORIGINAL)
   *    2. Dispara `undrcod:attach-css-changes` com { selectors, css, count }
   *    3. ChatView captura → renderiza card "N CHANGES" ACIMA do textarea
   *    4. Zera o stack local (checkpoint — undo daqui pra trás some)
   *    5. Toast discreto (Cursor não mostra, mas como composer pode estar fora
   *       da viewport em layout split, ajuda)
   *
   *  Mudanças continuam aplicadas no webview. Apply só CONSOLIDA + empacota. */
  const handleApply = useCallback(async (): Promise<void> => {
    if (pendingEdits.length === 0) return;
    // Separa text edits dos CSS edits — eles vão pra payloads/blocks diferentes
    // mas no mesmo "Apply" pra agente receber o pacote consolidado.
    const cssEdits = pendingEdits.filter((e) => (e.kind || 'css') === 'css');
    const textEdits = pendingEdits.filter((e) => e.kind === 'text');
    // Agrupa por selector preservando element snapshot do primeiro edit de cada grupo.
    // (Se mesmo selector teve múltiplos edits, o elementHtml/pathStr/text são iguais
    //  — vêm do mesmo elemento.)
    type GroupVal = { value: string; prevValue: string };
    type GroupInfo = {
      elementHtml: string;
      pathStr: string;
      text: string;
      props: Record<string, GroupVal>;
    };
    const grouped: Record<string, GroupInfo> = {};
    for (const edit of cssEdits) {
      if (!grouped[edit.selector]) {
        grouped[edit.selector] = {
          elementHtml: edit.elementHtml,
          pathStr: edit.pathStr,
          text: edit.text,
          props: {},
        };
      }
      const g = grouped[edit.selector];
      const existing = g.props[edit.property];
      g.props[edit.property] = {
        value: edit.value,
        prevValue: existing ? existing.prevValue : edit.prevValue,
      };
    }
    // Payload estruturado pro ChatView renderizar chip + diff completo no prompt.
    const selectors = Object.entries(grouped).map(([sel, info]) => ({
      selector: sel,
      elementHtml: info.elementHtml,
      pathStr: info.pathStr,
      text: info.text,
      changes: Object.entries(info.props).map(([property, v]) => ({
        property,
        value: v.value,
        prevValue: v.prevValue,
      })),
    }));
    // CSS bloco-formatado pro prompt do agente.
    const cssBlocks: string[] = [];
    for (const { selector, changes } of selectors) {
      const lines = changes.map((c) => `  ${c.property}: ${c.value};`).join('\n');
      cssBlocks.push(`${selector} {\n${lines}\n}`);
    }
    const css = cssBlocks.join('\n\n');
    // Text changes — bloco separado no prompt. Cada uma com selector + diff.
    const textChangesSerialized = textEdits.map((e) => ({
      selector: e.selector,
      elementHtml: e.elementHtml,
      oldText: e.prevValue,
      newText: e.value,
    }));
    const count = pendingEdits.length;
    // Dispatch — ChatView listener anexa o card acima do input.
    window.dispatchEvent(new CustomEvent('undrcod:attach-css-changes', {
      detail: { selectors, css, count, textChanges: textChangesSerialized },
    }));
    // Checkpoint local.
    setPendingEdits([]);
    setEditsPopoverOpen(false);
    // Clear nudges no preload — edits já foram enviados, Esc não deve mais reverter.
    try {
      webviewRef.current?.executeJavaScript(
        'window.__undrcodInspector && window.__undrcodInspector.clearNudges && window.__undrcodInspector.clearNudges()',
        false,
      ).catch(() => { /* noop */ });
    } catch { /* noop */ }
    // Toast discreto.
    try {
      const { toast } = await import('../Toast/Toast');
      toast.success(`${count} change${count === 1 ? '' : 's'} attached to chat`, {
        sub: 'Adicione uma mensagem e envie pro agente',
      });
    } catch {
      /* toast unavailable — ignore */
    }
  }, [pendingEdits]);

  /** Navega pra outro elemento via CSS selector — usado pelo Components tree. */
  const selectByPath = useCallback((selector: string): void => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady) return;
    const code = `window.__undrcodInspector && window.__undrcodInspector.selectByPath(${JSON.stringify(selector)})`;
    wv.executeJavaScript(code, false).catch(() => {});
  }, [webviewReady]);

  /** Navega via uid (data-undrcod-uid). Usado pelo DomTreeView. */
  const selectByUid = useCallback((uid: string): void => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady) return;
    const code = `window.__undrcodInspector && window.__undrcodInspector.selectByUid(${JSON.stringify(uid)})`;
    wv.executeJavaScript(code, false).catch(() => {});
  }, [webviewReady]);

  /** Hover preview no DomTree → highlight no preview sem mudar seleção. */
  const previewByUid = useCallback((uid: string): void => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady) return;
    const code = `window.__undrcodInspector && window.__undrcodInspector.previewByUid(${JSON.stringify(uid)})`;
    wv.executeJavaScript(code, false).catch(() => {});
  }, [webviewReady]);

  const clearPreview = useCallback((): void => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady) return;
    wv.executeJavaScript(`window.__undrcodInspector && window.__undrcodInspector.clearPreview()`, false).catch(() => {});
  }, [webviewReady]);

  /** Fetch dom tree do preload — usado quando panel abre sem ter clicado em
   * elemento ainda. Garante que tree sempre tá disponível visualmente. */
  const fetchDomTree = useCallback(async (): Promise<void> => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady) return;
    try {
      const result = await wv.executeJavaScript(
        `window.__undrcodInspector && window.__undrcodInspector.getDomTree()`,
        false,
      );
      if (result) setDomTree(result as DomTreeNode);
    } catch { /* ignore */ }
  }, [webviewReady]);

  // Quando inspector panel abre OU webview fica pronto, busca tree se ainda
  // não tem. Re-busca a cada nova URL (navegação) seria ideal — TODO futuro.
  useEffect(() => {
    if (!inspectorPanelOpen || !webviewReady || domTree) return;
    void fetchDomTree();
  }, [inspectorPanelOpen, webviewReady, domTree, fetchDomTree]);

  // Escape sai do inspect mode. Ctrl+Z/Y = undo/redo quando inspector panel
  // está aberto (foco no painel host, não no webview).
  useEffect(() => {
    if (!inspectorPanelOpen && !inspectMode) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && inspectMode) {
        e.preventDefault();
        setInspectMode(false);
        return;
      }
      const target = e.target as HTMLElement | null;
      const isInputFocus = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (isInputFocus) return;
      if (!selectedElement) return;
      const mod = e.ctrlKey || e.metaKey;

      // ARROW KEY NUDGE (sem ctrl/meta): move o elemento selecionado pelas setas.
      // Shift = 10px, sem shift = 1px. Diferencial vs Cursor — manipulação
      // visual direta no preview, próximo das ferramentas de design.
      // Multi-select: aplica delta IGUAL pra todos os UIDs (primary + extras).
      if (!mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowUp') dy = -step;
        else if (e.key === 'ArrowDown') dy = step;
        else if (e.key === 'ArrowLeft') dx = -step;
        else if (e.key === 'ArrowRight') dx = step;

        // Lê position atual do PRIMARY; se static, força relative pra top/left fazer efeito.
        const styles = selectedElement.allStyles || {};
        const currentPosition = styles.position || 'static';
        if (currentPosition === 'static') {
          applyStyle('position', 'relative');
        }
        // Parse top/left atuais (default 0). Aceita "12px", "12", ou "auto".
        const parsePx = (raw: string | undefined): number => {
          if (!raw || raw === 'auto') return 0;
          const m = raw.match(/-?\d+(?:\.\d+)?/);
          return m ? parseFloat(m[0]) : 0;
        };
        const curLeft = parsePx(styles.left);
        const curTop = parsePx(styles.top);
        if (dx !== 0) applyStyle('left', `${curLeft + dx}px`);
        if (dy !== 0) applyStyle('top', `${curTop + dy}px`);

        // Aplica o MESMO delta nos extras. Lê via inspector.applyStyle direto
        // (sem entrar no edits ring do host porque não temos InspectedElement
        // completo dos extras). Cada extra ganha position:relative se for static.
        if (selectedExtraUids.size > 0) {
          const wv = webviewRef.current;
          if (wv && webviewReady) {
            const uids = Array.from(selectedExtraUids);
            const code = `(() => {
              const I = window.__undrcodInspector;
              if (!I) return;
              const uids = ${JSON.stringify(uids)};
              const dx = ${dx}, dy = ${dy};
              uids.forEach((uid) => {
                const el = document.querySelector('[data-undrcod-uid="' + uid + '"]');
                if (!el) return;
                const cs = window.getComputedStyle(el);
                if ((cs.position || 'static') === 'static') I.applyStyle(uid, 'position', 'relative');
                const parsePx = (raw) => {
                  if (!raw || raw === 'auto') return 0;
                  const m = String(raw).match(/-?\\d+(?:\\.\\d+)?/);
                  return m ? parseFloat(m[0]) : 0;
                };
                const cur = window.getComputedStyle(el);
                const curLeft = parsePx(cur.left);
                const curTop = parsePx(cur.top);
                if (dx !== 0) I.applyStyle(uid, 'left', (curLeft + dx) + 'px');
                if (dy !== 0) I.applyStyle(uid, 'top', (curTop + dy) + 'px');
              });
            })()`;
            wv.executeJavaScript(code, false).catch(() => { /* noop */ });
          }
        }
        return;
      }

      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoStyle();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redoStyle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inspectMode, inspectorPanelOpen, selectedElement, selectedExtraUids, webviewReady, undoStyle, redoStyle, applyStyle]);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    let next = inputUrl.trim();
    if (!next) return;
    next = normalizePreviewUrl(next);
    setUrl(next);
    setInputUrl(next);
    onUrlChange?.(next);
  };

  const handleRefresh = useCallback((): void => {
    webviewRef.current?.reload();
  }, []);
  const handleBack = useCallback((): void => {
    if (webviewRef.current?.canGoBack()) webviewRef.current.goBack();
  }, []);
  const handleForward = useCallback((): void => {
    if (webviewRef.current?.canGoForward()) webviewRef.current.goForward();
  }, []);

  // ─── FIND IN PAGE ────────────────────────────────────────────────────────
  // Wraps Electron's webview.findInPage / stopFindInPage. As-you-type triggers
  // findNext:false (fresh search). Enter/Shift+Enter cycle com findNext:true.
  const findInPage = useCallback((q: string, opts: { forward?: boolean; findNext?: boolean } = {}): void => {
    const wv = webviewRef.current;
    if (!wv) return;
    if (!q) {
      try { (wv as unknown as { stopFindInPage?: (a: string) => void }).stopFindInPage?.('clearSelection'); } catch { /* noop */ }
      setFindResult({ active: 0, total: 0 });
      return;
    }
    try {
      (wv as unknown as { findInPage?: (s: string, o: { forward?: boolean; findNext?: boolean }) => void })
        .findInPage?.(q, { forward: opts.forward ?? true, findNext: opts.findNext ?? false });
    } catch { /* noop */ }
  }, []);
  const findNext = useCallback((): void => {
    if (findQuery) findInPage(findQuery, { forward: true, findNext: true });
  }, [findInPage, findQuery]);
  const findPrev = useCallback((): void => {
    if (findQuery) findInPage(findQuery, { forward: false, findNext: true });
  }, [findInPage, findQuery]);
  const closeFind = useCallback((): void => {
    const wv = webviewRef.current;
    try { (wv as unknown as { stopFindInPage?: (a: string) => void } | null)?.stopFindInPage?.('clearSelection'); } catch { /* noop */ }
    setFindOpen(false);
    setFindResult({ active: 0, total: 0 });
  }, []);

  // Listener pro evento 'found-in-page' do webview — atualiza contador.
  // Re-anexa quando previewPreload muda (mesmo lifecycle do main ipc-message).
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const onFound = (e: Event): void => {
      const ev = e as Event & { result?: { activeMatchOrdinal?: number; matches?: number; finalUpdate?: boolean } };
      if (!ev.result) return;
      setFindResult({
        active: ev.result.activeMatchOrdinal || 0,
        total: ev.result.matches || 0,
      });
    };
    wv.addEventListener('found-in-page', onFound);
    return () => wv.removeEventListener('found-in-page', onFound);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewPreload]);

  // Atalhos de navegação no preview (padrão browser):
  //   Alt+← / Alt+→ — voltar / avançar
  //   F5 / Ctrl+R — recarregar
  //   Ctrl+Shift+R / Ctrl+F5 — hard reload (mesmo handler — Electron já bypassa cache)
  //   F12 / Ctrl+Shift+I — toggle DevTools embedado (padrão browser)
  // Mesma guard do zoom: só dispara quando foco tá dentro de .preview-view-root.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.preview-view-root')) return;
      // F12 (sem modifiers) ou Ctrl+Shift+I — toggle devtools
      if (e.key === 'F12' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        setDevtoolsOpen((p) => !p);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'i')) {
        e.preventDefault();
        setDevtoolsOpen((p) => !p);
        return;
      }
      // Alt+Arrow — navegação
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
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
      // F5 (sozinho) — refresh
      if (e.key === 'F5' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        handleRefresh();
        return;
      }
      // Ctrl+R / Cmd+R — refresh (também com Shift pra hard reload)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        handleRefresh();
        return;
      }
      // Ctrl+F / Cmd+F — abre find bar, foca input. Se já aberto, re-seleciona.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setFindOpen(true);
        // requestAnimationFrame em vez de setTimeout pra render do input acontecer
        requestAnimationFrame(() => {
          const input = findInputRef.current;
          if (input) { input.focus(); input.select(); }
        });
        return;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleBack, handleForward, handleRefresh]);
  const handleOpenExternal = useCallback((): void => {
    if (url) window.undrcodAPI?.openExternal?.(url);
  }, [url]);

  const toggleInspect = useCallback((): void => {
    // Inspect e Painel são INDEPENDENTES. Toggle só muda inspect mode.
    setInspectMode((p) => !p);
  }, []);

  const formatRectLabel = (e: InspectedElement): string => {
    const cls = e.classes.length ? '.' + e.classes.slice(0, 2).join('.') : '';
    return e.tag + (e.id ? '#' + e.id : '') + cls;
  };

  return (
    <div className={`preview-view preview-view-root ${anyMenuOpen ? 'is-menu-open' : ''}`}>
      <div className="preview-toolbar">
        <button type="button" className="preview-btn" title="Voltar (Alt+←)" onClick={handleBack}>
          <i className="codicon codicon-arrow-left" />
        </button>
        <button type="button" className="preview-btn" title="Avançar (Alt+→)" onClick={handleForward}>
          <i className="codicon codicon-arrow-right" />
        </button>
        <button
          type="button"
          className={`preview-btn ${loading ? 'is-loading' : ''}`}
          title="Recarregar (F5)"
          onClick={handleRefresh}
        >
          <i className={`codicon codicon-${loading ? 'sync~spin' : 'refresh'}`} />
        </button>
        <form className="preview-url-form" onSubmit={handleSubmit}>
          <input
            type="text"
            className="preview-url-input"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="http://localhost:5173"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </form>

        {/* Zoom controls (replica Cursor IG0): − [100%] + ↺ */}
        <div className="preview-zoom-group" data-tooltip={`Zoom: ${zoomPercent}%`}>
          <button
            type="button"
            className="preview-btn preview-zoom-btn"
            title="Diminuir zoom"
            onClick={handleZoomOut}
            disabled={zoomPercent <= ZOOM_MIN}
            aria-label="Zoom out"
          >
            <i className="codicon codicon-zoom-out" />
          </button>
          <button
            type="button"
            className="preview-zoom-label"
            title="Resetar zoom para 100%"
            onClick={handleZoomReset}
            disabled={zoomPercent === 100}
            aria-label="Reset zoom"
          >
            {zoomPercent}%
          </button>
          <button
            type="button"
            className="preview-btn preview-zoom-btn"
            title="Aumentar zoom"
            onClick={handleZoomIn}
            disabled={zoomPercent >= ZOOM_MAX}
            aria-label="Zoom in"
          >
            <i className="codicon codicon-zoom-in" />
          </button>
        </div>

        {/* Botões Cursor-style à direita */}
        {/* Toggle "Bloquear JS" — pra SPAs que dão 404 em file://.
            Quando ativo: webview recarrega com javascript=no. */}
        <button
          type="button"
          className={`preview-btn ${jsDisabled ? 'is-active' : ''}`}
          title={jsDisabled ? 'Ativar JavaScript (recarregar)' : 'Bloquear JavaScript (útil pra SPAs que dão 404)'}
          onClick={toggleJsDisabled}
          aria-pressed={jsDisabled}
        >
          <i className={`codicon ${jsDisabled ? 'codicon-shield' : 'codicon-symbol-event'}`} />
        </button>
        <button
          type="button"
          className={`preview-btn ${inspectMode ? 'is-active' : ''}`}
          title="Selecionar elemento (inspecionar)"
          onClick={toggleInspect}
        >
          <i className="codicon codicon-inspect" />
        </button>
        <button
          type="button"
          className={`preview-btn ${devtoolsOpen ? 'is-active' : ''}`}
          title="DevTools embedado (Cursor pattern: setDevToolsWebContents + reconnect cycle)"
          onClick={() => {
            // Toggle apenas. O useEffect [devtoolsOpen] dispara o IPC quando
            // o companion webview <about:blank> estiver dom-ready (Cursor pattern).
            setDevtoolsOpen((p) => !p);
          }}
        >
          <i className="codicon codicon-tools" />
        </button>
        <button
          type="button"
          className={`preview-btn ${inspectorPanelOpen ? 'is-active' : ''}`}
          title="Painel inspector"
          onClick={() => setInspectorPanelOpen((p) => !p)}
        >
          <i className="codicon codicon-layout-sidebar-right" />
        </button>
        {/* Viewport mode toggle — cicla Desktop → Tablet → Mobile → Desktop.
            1 botão só, ícone muda conforme o estado atual. */}
        <button
          type="button"
          className={`preview-btn preview-viewport-btn mode-${viewportMode}`}
          title={
            viewportMode === 'desktop' ? 'Desktop (clique pra Tablet)' :
            viewportMode === 'tablet' ? 'Tablet 768px (clique pra Mobile)' :
            'Mobile 375px (clique pra Desktop)'
          }
          onClick={() => {
            setViewportMode((m) => m === 'desktop' ? 'tablet' : m === 'tablet' ? 'mobile' : 'desktop');
          }}
        >
          {viewportMode === 'desktop' ? (
            <i className="codicon codicon-device-desktop" />
          ) : viewportMode === 'tablet' ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="3" y="2" width="10" height="12" rx="1.5" />
              <circle cx="8" cy="12.5" r="0.5" fill="currentColor" />
            </svg>
          ) : (
            <i className="codicon codicon-device-mobile" />
          )}
        </button>
        <button
          type="button"
          className="preview-btn"
          title="Abrir no browser externo"
          onClick={handleOpenExternal}
        >
          <i className="codicon codicon-link-external" />
        </button>
        {/* More menu (...) — replica `n4p` do Cursor.
            Items: Hard Reload, Copy URL, Clear data (history/cookies/cache).
            Trigger position-aware + toggle (não re-abre após outside-click). */}
        <button
          type="button"
          className="preview-btn"
          title="Mais opções"
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            console.log('[menu] button "..." clicked, current moreMenu.open=', moreMenu.open);
            setMoreMenu((prev) => {
              const next = prev.open
                ? { ...prev, open: false }
                : { open: true, x: rect.right - 200, y: rect.bottom + 4 };
              console.log('[menu] setMoreMenu: prev.open=', prev.open, '→ next.open=', next.open);
              return next;
            });
          }}
        >
          <i className="codicon codicon-ellipsis" />
        </button>
        {onClose && (
          <button
            type="button"
            className="preview-btn"
            title="Fechar preview"
            onClick={onClose}
          >
            <i className="codicon codicon-close" />
          </button>
        )}
      </div>

      <div ref={previewBodyRef} className="preview-body">
        {resizingInspector && <div className="preview-resize-overlay-global" />}
        <div className="preview-main">
          <div ref={previewContentRef} className={`preview-content ${devtoolsOpen ? 'has-devtools' : ''}`}>
            {/* Overlay durante resize: captura mouse pra evitar que os <webview>
                comam os pointer events e travem o drag. */}
            {resizingDevtools && <div className="preview-resize-overlay" />}
            <div className={`preview-content-page preview-viewport-${viewportMode}`}>
            {url ? (
              // Espera o preload resolver ANTES de montar o webview.
              // Se montasse sem preload e depois recebesse o path, Electron
              // destrói e recria o webview inteiro (double-load + double
              // dom-ready + double-injection storm = freeze).
              previewPreload === null ? (
                <div className="preview-loading">Inicializando preview...</div>
              ) : (
                <>
                  <webview
                    ref={webviewRef}
                    src={url}
                    className="preview-webview"
                    // key inclui jsDisabled — re-mounta o webview quando muda o
                    // flag (webview attrs `webpreferences` só aplicam on attach,
                    // não em runtime). Reload simples não basta.
                    key={`webview-${url}-js${jsDisabled ? '0' : '1'}`}
                    {...({
                      allowpopups: 'true',
                      preload: previewPreload,
                      // disablejavascript: 'on' bloqueia <script> tags antes de
                      // executar. Útil pra SPAs em file:// que dão 404 client-side.
                      ...(jsDisabled ? { webpreferences: 'javascript=no' } : {}),
                    } as Record<string, string>)}
                  />
                  {/* Overlay quando há menu aberto. Funciona em COMBINAÇÃO com o
                      useEffect que dispara `previewSetIgnoreInput(true)` no guest
                      via CDP: o webview para de processar input, então clicks
                      fluem pro DOM host. Este overlay (z-index > webview no DOM)
                      captura os mousedown/contextmenu e fecha o menu explicit.
                      Sem o CDP block, o overlay sozinho NÃO funciona (BrowserView
                      é compositado acima do DOM). Sem o overlay, o CDP block
                      sozinho funciona (window mousedown bubble fecha via
                      ContextMenu outside-click listener), mas o overlay garante
                      fallback caso CDP detache (e.g., devtools embedado aberto). */}
                  {anyMenuOpen && (
                    <div
                      className="preview-menu-overlay"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setCtxMenu((prev) => prev.open ? { ...prev, open: false } : prev);
                        setMoreMenu((prev) => prev.open ? { ...prev, open: false } : prev);
                      }}
                      onContextMenu={(e) => {
                        // Right-click no overlay também fecha (igual click normal)
                        e.preventDefault();
                        setCtxMenu((prev) => prev.open ? { ...prev, open: false } : prev);
                        setMoreMenu((prev) => prev.open ? { ...prev, open: false } : prev);
                      }}
                    />
                  )}
                  {findOpen && (
                    <div className="preview-find-bar" role="search">
                      <i className="codicon codicon-search preview-find-icon" />
                      <input
                        ref={findInputRef}
                        type="text"
                        className="preview-find-input"
                        placeholder="Buscar na página"
                        value={findQuery}
                        autoFocus
                        onChange={(e) => {
                          const v = e.target.value;
                          setFindQuery(v);
                          findInPage(v, { forward: true, findNext: false });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (e.shiftKey) findPrev(); else findNext();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            closeFind();
                          }
                        }}
                      />
                      <div className="preview-find-count">
                        {findQuery
                          ? (findResult.total > 0 ? `${findResult.active} de ${findResult.total}` : 'Nenhum')
                          : ''}
                      </div>
                      <button
                        type="button"
                        className="preview-find-btn"
                        title="Anterior (Shift+Enter)"
                        onClick={findPrev}
                        disabled={!findQuery || findResult.total === 0}
                      >
                        <i className="codicon codicon-arrow-up" />
                      </button>
                      <button
                        type="button"
                        className="preview-find-btn"
                        title="Próximo (Enter)"
                        onClick={findNext}
                        disabled={!findQuery || findResult.total === 0}
                      >
                        <i className="codicon codicon-arrow-down" />
                      </button>
                      <button
                        type="button"
                        className="preview-find-btn"
                        title="Fechar (Esc)"
                        onClick={closeFind}
                      >
                        <i className="codicon codicon-close" />
                      </button>
                    </div>
                  )}
                </>
              )
            ) : (
              <div className="preview-empty">
                <i className="codicon codicon-globe preview-empty-icon" />
                <div className="preview-empty-title">Configure o dev server</div>
                <div className="preview-empty-hint">
                  Digite a URL acima (ex: <code>localhost:5173</code>) ou rode <code>npm run dev</code> e o UNDRCOD tenta detectar a porta automaticamente.
                </div>
                <button
                  type="button"
                  className="preview-empty-btn"
                  onClick={() => {
                    setInputUrl('http://localhost:5173');
                    setUrl('http://localhost:5173');
                    onUrlChange?.('http://localhost:5173');
                  }}
                >
                  Usar http://localhost:5173
                </button>
              </div>
            )}
            </div>
            {/*
              Cursor pattern (exato do main.js `vscode:setDevToolsWebContents` handler):
              Companion <webview src="about:blank"> recebe o devtools via
              setDevToolsWebContents + openDevTools + reconnect cycle (close → 100ms → reopen).
              Esse reconnect cycle resolve o bug "Elements vazio" que tinha antes.
            */}
            {devtoolsOpen && (
              <>
                {/* Divider resizable entre preview e devtools panel.
                    Cursor pattern (monaco-sash): div fininho com cursor:ew-resize,
                    mousedown captura listeners no window. Overlay
                    .preview-resize-overlay aparece durante o drag pra impedir que
                    os <webview> comam os pointer events do host (Electron clássico). */}
                <div
                  className="preview-devtools-divider"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const container = previewContentRef.current;
                    if (!container) return;
                    setResizingDevtools(true);
                    const onMove = (ev: MouseEvent): void => {
                      const rect = container.getBoundingClientRect();
                      // newWidth = distância do mouse até a borda direita do content
                      // (devtools pane fica colado na direita do .preview-content).
                      // min 280, max = container.width - 320 (preserva preview minViewable).
                      const newWidth = Math.max(
                        280,
                        Math.min(Math.max(280, rect.width - 320), rect.right - ev.clientX),
                      );
                      setDevtoolsWidth(newWidth);
                    };
                    const onUp = (): void => {
                      window.removeEventListener('mousemove', onMove);
                      window.removeEventListener('mouseup', onUp);
                      document.body.style.cursor = '';
                      document.body.style.userSelect = '';
                      setResizingDevtools(false);
                    };
                    document.body.style.cursor = 'ew-resize';
                    document.body.style.userSelect = 'none';
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                  }}
                />
                <div className="preview-devtools-host-pane" style={{
                  width: devtoolsWidth,
                  flex: `0 0 ${devtoolsWidth}px`,
                  borderLeft: '1px solid var(--border-subtle)',
                  background: 'var(--bg-panel)',
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 280,
                }}>
                  <webview
                    ref={devtoolsHostRef}
                    src="about:blank"
                    className="preview-webview"
                    style={{ flex: 1, minHeight: 0, width: '100%' }}
                  />
                </div>
              </>
            )}
          </div>

        </div>

        {/* Divider resizable entre preview e inspector panel */}
        {inspectorPanelOpen && (
          <div
            className="preview-inspector-divider"
            onMouseDown={(e) => {
              e.preventDefault();
              const container = previewBodyRef.current;
              if (!container) return;
              setResizingInspector(true);
              const onMove = (ev: MouseEvent): void => {
                const rect = container.getBoundingClientRect();
                // Largura desejada = distancia do mouse até a borda direita do body
                const newWidth = Math.max(260, Math.min(rect.width - 320, rect.right - ev.clientX));
                setInspectorWidth(newWidth);
              };
              const onUp = (): void => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                setResizingInspector(false);
              };
              document.body.style.cursor = 'ew-resize';
              document.body.style.userSelect = 'none';
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
          />
        )}
        {/* Inspector panel lateral direita — Components + Design / CSS tabs */}
        {inspectorPanelOpen && (
          <aside className="preview-inspector" style={{ width: inspectorWidth, flex: `0 0 ${inspectorWidth}px` }}>
            <div
              className="preview-inspector-section preview-inspector-section-tree"
              style={{ height: inspectorTreeHeight, maxHeight: inspectorTreeHeight }}
            >
              <div className="preview-inspector-section-title">Components</div>
              <div
                className="preview-inspector-tree"
                style={{ maxHeight: inspectorTreeHeight - 40 }}
              >
                {domTree ? (
                  <DomTreeView
                    root={domTree}
                    selectedUid={selectedElement?.uid || ''}
                    onSelect={(uid) => selectByUid(uid)}
                    onHover={(uid) => previewByUid(uid)}
                    onHoverEnd={() => clearPreview()}
                  />
                ) : (
                  <div className="preview-inspector-empty">
                    Carregando árvore DOM…
                  </div>
                )}
              </div>
            </div>

            {/* Divider arrastável vertical — resize entre Components tree e
                Design/CSS panel. Drag pra cima/baixo ajusta `inspectorTreeHeight`. */}
            <div
              className={`preview-inspector-tree-divider ${resizingTree ? 'is-resizing' : ''}`}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize Components tree height"
              onMouseDown={(e) => {
                e.preventDefault();
                treeResizeStartRef.current = { startY: e.clientY, startHeight: inspectorTreeHeight };
                setResizingTree(true);
              }}
            />

            <div className="preview-inspector-tabs">
              {TABS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`preview-inspector-tab ${inspectorTab === id ? 'is-active' : ''}`}
                  onClick={() => setInspectorTab(id)}
                >
                  {label}
                </button>
              ))}
              <div className="preview-inspector-tabs-spacer" />
              {/* Contador de edits pendentes (Cursor-style) — clicável.
                * Abre popover com diff list de TODAS as mudanças (oldValue → newValue),
                * agrupado por elemento. Cursor pattern: dá review pré-Apply pro user. */}
              {pendingEdits.length > 0 && (
                <div className="preview-inspector-edits-wrap">
                  <button
                    ref={editsBtnRef}
                    type="button"
                    className="preview-inspector-edits-count"
                    title="View all pending changes"
                    onClick={() => setEditsPopoverOpen((p) => !p)}
                    aria-expanded={editsPopoverOpen}
                    aria-haspopup="dialog"
                  >
                    {pendingEdits.length} Edit{pendingEdits.length === 1 ? '' : 's'}
                  </button>
                  {editsPopoverOpen && (
                    <EditsPopover
                      edits={pendingEdits}
                      onClose={() => setEditsPopoverOpen(false)}
                      onApply={() => { void handleApply(); }}
                      onDiscard={() => {
                        setPendingEdits([]);
                        setEditsPopoverOpen(false);
                      }}
                      anchorRef={editsBtnRef}
                    />
                  )}
                </div>
              )}
              {/* Undo / Redo / Reset — só visíveis com elemento selecionado */}
              {selectedElement && (
                <>
                  <button
                    type="button"
                    className="preview-inspector-action"
                    title="Desfazer última edição (Ctrl+Z)"
                    onClick={undoStyle}
                    disabled={pendingEdits.length === 0}
                  >
                    <i className="codicon codicon-discard" />
                  </button>
                  <button
                    type="button"
                    className="preview-inspector-action"
                    title="Refazer (Ctrl+Y)"
                    onClick={redoStyle}
                  >
                    <i className="codicon codicon-redo" />
                  </button>
                  <button
                    type="button"
                    className="preview-inspector-action"
                    title="Resetar todas as edições deste elemento"
                    onClick={resetStyles}
                  >
                    <i className="codicon codicon-clear-all" />
                  </button>
                  {/* Apply (proeminente azul) — só ativa quando tem pending edits.
                      Combo: copia CSS pro clipboard + zera undo stack + toast. */}
                  <button
                    type="button"
                    className="preview-inspector-apply"
                    title="Aplicar (copia CSS pro clipboard + finaliza edits)"
                    onClick={() => { void handleApply(); }}
                    disabled={pendingEdits.length === 0}
                  >
                    Apply
                  </button>
                </>
              )}
            </div>

            <div className="preview-inspector-content">
              {selectedElement ? (
                inspectorTab === 'design' ? (
                  <DesignTab element={selectedElement} onApply={applyStyle} />
                ) : (
                  <CssTab element={selectedElement} />
                )
              ) : (
                <div className="preview-inspector-empty">Sem elemento selecionado</div>
              )}
            </div>

            {selectedElement && (
              <div className="preview-inspector-footer">
                <span className="preview-inspector-footer-label">
                  {formatRectLabel(selectedElement)}
                </span>
                {selectedExtraUids.size > 0 && (
                  <span
                    className="preview-inspector-footer-multi"
                    title="Ctrl+click pra adicionar/remover. Setas movem todos juntos."
                  >
                    +{selectedExtraUids.size}
                  </span>
                )}
                <span className="preview-inspector-footer-rect">
                  {Math.round(selectedElement.rect.width)} × {Math.round(selectedElement.rect.height)}
                </span>
              </div>
            )}
          </aside>
        )}
      </div>
      {/* Webview context menu (right-click) — replica Chromium menu nativo
          mas estilizado. Items vão de Back/Forward/Reload → Edit ops → Inspect.
          Items são computados ONLY quando ctxMenu.open === true pra evitar chamar
          canGoBack/Forward antes do webview dar dom-ready (crash conhecido). */}
      <ContextMenu
        open={ctxMenu.open}
        x={ctxMenu.x}
        y={ctxMenu.y}
        items={ctxMenu.open ? buildWebviewContextMenuItems({
          canGoBack: webviewReady ? (() => {
            try { return webviewRef.current?.canGoBack() ?? false; } catch { return false; }
          })() : false,
          canGoForward: webviewReady ? (() => {
            try { return webviewRef.current?.canGoForward() ?? false; } catch { return false; }
          })() : false,
          hasSelection: ctxMenu.hasSelection,
          isEditable: ctxMenu.isEditable,
          handleBack,
          handleForward,
          handleRefresh,
          execInWebview,
          openDevTools: () => {
            // Apenas setDevtoolsOpen(true). O useEffect [devtoolsOpen, devtoolsHostReady]
            // dispara o IPC previewAttachDevtools(targetId, hostId) com o REAL hostId
            // do companion webview quando ele tá pronto.
            //
            // BUG ANTERIOR (loop infinito open/close): chamávamos previewAttachDevtools
            // com hostId=0 AQUI direto, e DEPOIS setDevtoolsOpen(true). Resultado:
            //   1. Primeira chamada abre devtools em mode:'detach' (hostId=0 → fallback)
            //   2. Companion dom-ready → useEffect chama attach com hostId real (companion)
            //   3. Main: close → reopen → close event fires → onClosed listener seta
            //      devtoolsOpen=false → detach useEffect → close again → loop
            // Fix: deixar só o state controlar. Single source of truth.
            setDevtoolsOpen(true);
          },
        }) : []}
        onClose={() => setCtxMenu({ ...ctxMenu, open: false })}
      />
      {/* Browser More Menu (replica `n4p` do Cursor) — popover do "..." no toolbar */}
      <ContextMenu
        open={moreMenu.open}
        x={moreMenu.x}
        y={moreMenu.y}
        items={moreMenu.open ? [
          {
            kind: 'item' as const,
            icon: 'refresh',
            label: 'Hard Reload',
            onClick: handleHardReload,
          },
          {
            kind: 'item' as const,
            icon: 'link',
            label: 'Copy Current URL',
            disabled: !url,
            onClick: () => { void handleCopyUrl(); },
          },
          { kind: 'divider' as const },
          {
            kind: 'item' as const,
            icon: 'link-external',
            label: 'Abrir no browser externo',
            disabled: !url,
            onClick: handleOpenExternal,
          },
        ] satisfies ContextMenuItem[] : []}
        onClose={() => setMoreMenu({ ...moreMenu, open: false })}
      />
    </div>
  );
}

/**
 * Tab "Design" — props legíveis E editáveis (W/H, padding, margin, opacity, font, color).
 * Layout estilo Cursor: grupos colapsáveis. Cada input edita inline style do
 * elemento via `onApply(property, value)` → preload aplica setProperty.
 */
function DesignTab({
  element,
  onApply,
}: {
  element: InspectedElement;
  onApply: (property: string, value: string) => void;
}) {
  const d = element.designProps;
  // ORDEM REAL DO CURSOR (extraída do wrapper `ke(la,re(XG0..))` no bundle):
  //   1. XG0 = Position
  //   2. YG0 = Layout (composite com Dimensions + Padding + Margin + Box-sizing + Clip)
  //   3. OG0 = Appearance
  //   4. lW0 = Text
  //   5. VG0 = Background (Fill)
  //   6. oW0 = Border (Stroke)
  //   7. $G0 = Shadow & Blur
  //   8. rW0 = React Component (Properties + Children) — só quando React detectado
  // Cursor NÃO tem "Advanced" section.
  return (
    <div className="preview-design">
      {/* 1. Position — X/Y/Z + rotation + flip */}
      <PositionSection element={element} onApply={onApply} />

      {/* 2. Layout composite — Flow + Dimensions + Padding + Margin + Clip/Box-sizing */}
      <Group title="Layout">
        <LayoutFlowButtons
          display={d.display}
          flexDirection={d.flexDirection}
          flexWrap={element.allStyles['flex-wrap'] || 'nowrap'}
          onApply={onApply}
        />
        <LayoutExtras element={element} onApply={onApply} />
        {/* PA Layout #198 P1-1: removido label "Position: static" — duplicado
         * com Position section acima. Cursor não mostra Position dentro de Layout. */}
      </Group>
      {/*
        PA Layout #199 Batch 2 (P0-3): Dimensions FLAT (sem chevron sub-section).
        Cursor usa "Dimensions" como inline label dentro da Layout section, não
        como collapsible sub-section. Removida wrapper <Group> que tinha chevron.

        Min/Max W/H: showOnlyIfNonTrivial helpers checam se o computed value
        difere do default initial:
          - min-width default = '0px' or 'auto' → hide se for um deles
          - max-width default = 'none' → hide se for esse
          - same for height
        Cursor esconde por padrão; user explicitly adiciona via dropdown
        "Add Min Width" (Batch 3 implementa o dropdown). Batch 2 já filtra
        defaults pra match Cursor's empty-state visual.
       */}
      {/*
        PA Layout #199 Batch 2 (P0-3): Dimensions FLAT (sem chevron sub-section).
        Cursor usa "Dimensions" como inline label dentro da Layout section, não
        como collapsible sub-section.

        PA Layout #200 Batch 3 (P0-2): usa helpers `isNonTrivialMin/Max` (module-level,
        definidos perto do DimensionInput) — mesmo predicate usado pelo dropdown W/H
        pra decidir se "Add Min/Max" aparece. Single source of truth.
       */}
      {(() => {
        const mw = element.allStyles['min-width'];
        const Mw = element.allStyles['max-width'];
        const mh = element.allStyles['min-height'];
        const Mh = element.allStyles['max-height'];
        const showMinWMax = isNonTrivialMin(mw) || isNonTrivialMax(Mw);
        const showMinHMax = isNonTrivialMin(mh) || isNonTrivialMax(Mh);
        return (
          <div className="css-dimension-section">
            <div className="css-dimension-label">Dimensions</div>
            <div className="css-dimension-row">
              <DimensionInput dimension="width" value={d.width} element={element} onApply={onApply} />
              <DimensionInput dimension="height" value={d.height} element={element} onApply={onApply} />
            </div>
            {showMinWMax && (
              <div className="css-dimension-row">
                {isNonTrivialMin(mw) ? (
                  <ConstraintInput prop="min-width" value={mw!} currentDimensionValue={d.width} onApply={onApply} />
                ) : <div />}
                {isNonTrivialMax(Mw) ? (
                  <ConstraintInput prop="max-width" value={Mw!} currentDimensionValue={d.width} onApply={onApply} />
                ) : <div />}
              </div>
            )}
            {showMinHMax && (
              <div className="css-dimension-row">
                {isNonTrivialMin(mh) ? (
                  <ConstraintInput prop="min-height" value={mh!} currentDimensionValue={d.height} onApply={onApply} />
                ) : <div />}
                {isNonTrivialMax(Mh) ? (
                  <ConstraintInput prop="max-height" value={Mh!} currentDimensionValue={d.height} onApply={onApply} />
                ) : <div />}
              </div>
            )}
          </div>
        );
      })()}
      <PaddingEditor
        top={d.paddingTop} right={d.paddingRight} bottom={d.paddingBottom} left={d.paddingLeft}
        onApply={onApply}
      />
      <ClipContentCheckbox value={element.allStyles['overflow'] || ''} onApply={onApply} />
      <MarginEditor
        top={d.marginTop} right={d.marginRight} bottom={d.marginBottom} left={d.marginLeft}
        rawTop={element.allStyles['margin-top'] || ''}
        rawRight={element.allStyles['margin-right'] || ''}
        rawBottom={element.allStyles['margin-bottom'] || ''}
        rawLeft={element.allStyles['margin-left'] || ''}
        onApply={onApply}
      />
      <BorderBoxCheckbox value={element.allStyles['box-sizing'] || ''} onApply={onApply} />

      {/* 3. Appearance — Opacity + Corner Radius */}
      <AppearanceSection
        opacity={d.opacity}
        borderRadius={d.borderRadius}
        tl={element.allStyles['border-top-left-radius'] || ''}
        tr={element.allStyles['border-top-right-radius'] || ''}
        br={element.allStyles['border-bottom-right-radius'] || ''}
        bl={element.allStyles['border-bottom-left-radius'] || ''}
        visibility={element.allStyles['visibility'] || 'visible'}
        onApply={onApply}
      />

      {/* 4. Text — Typography (Cursor coloca antes de Background, não no fim) */}
      <TypographySection
        fontFamily={d.fontFamily}
        fontSize={d.fontSize}
        fontWeight={d.fontWeight}
        color={d.color}
        lineHeight={d.lineHeight}
        letterSpacing={d.letterSpacing}
        textAlign={element.allStyles['text-align'] || 'start'}
        verticalAlign={element.allStyles['vertical-align'] || 'baseline'}
        availableFonts={element.availableFontFamilies}
        backgroundImage={element.allStyles['background-image'] || ''}
        backgroundClip={element.allStyles['-webkit-background-clip'] || element.allStyles['background-clip'] || ''}
        onApply={onApply}
      />

      {/* 5. Background — Fill com type dropdown Solid/Linear/Radial */}
      <BackgroundSection element={element} onApply={onApply} />

      {/* 6. Border — Stroke com weight + style + color */}
      <BorderSection element={element} onApply={onApply} />

      {/* 7. Shadow & Blur — replica $G0 (drop/inner shadow + layer/backdrop blur) */}
      <EffectsSection element={element} onApply={onApply} />

      {/* 8. React Component (Properties + Children) — só quando preload detecta
          via Fiber tree. Vai no fim conforme Cursor (`rW0`). */}
      <ReactSections element={element} />
    </div>
  );
}

/**
 * LayeredColorSection — section pattern de Background/Border do Cursor.
 *
 *   ┌── Section Title ──────────── [palette] [+] ──┐
 *   │ Type ▾ [Solid / Linear gradient / Radial]    │
 *   │ [□ swatch] [#hex] [100 %] [👁] [-]            │  ← layer 1
 *   │ [□ swatch] [#hex] [100 %] [👁] [-]            │  ← layer 2 (se add)
 *   └────────────────────────────────────────────────┘
 *
 * Mantém compatibilidade: 1 layer = direct property (background-color).
 * 2+ layers = combinado como var(--bg) ou múltiplo shadow stack.
 *
 * Pra v1 só suporta Solid + 1 layer. Stack 2+ vira tarefa futura.
 */
function LayeredColorSection({
  title,
  cssProp,
  value,
  onApply,
  hideHeader,
}: {
  title: string;
  cssProp: string;
  value: string;
  onApply: (property: string, value: string) => void;
  /** Quando true, esconde o header próprio (usado quando wrapper já tem header). */
  hideHeader?: boolean;
}) {
  const [type, setType] = useState<'solid' | 'linear' | 'radial'>('solid');
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [visible, setVisible] = useState(true);

  // Detecta gradient no value
  const isGradient = value.includes('gradient');
  const effectiveType = isGradient
    ? (value.includes('radial') ? 'radial' : 'linear')
    : type;

  return (
    <div className={`preview-design-group preview-layered-section ${hideHeader ? 'no-header' : ''}`}>
      {!hideHeader && (
        <div className="preview-design-group-header">
          <span className="preview-design-group-title">{title}</span>
          <div className="preview-layered-actions">
            <button type="button" className="preview-side-toggle" title="Color picker">
              <i className="codicon codicon-symbol-color" />
            </button>
            <button type="button" className="preview-side-toggle" title="Add layer">
              <i className="codicon codicon-add" />
            </button>
          </div>
        </div>
      )}

      {/* Type dropdown */}
      <div className="preview-layered-type">
        <button
          type="button"
          className="preview-layered-type-btn"
          onClick={() => setTypeMenuOpen((p) => !p)}
        >
          <span>{effectiveType === 'solid' ? 'Solid' : effectiveType === 'linear' ? 'Linear gradient' : 'Radial gradient'}</span>
          <i className="codicon codicon-chevron-down" />
        </button>
        {typeMenuOpen && (
          <div className="preview-layered-type-menu">
            <button
              type="button"
              className={`preview-layered-type-item ${effectiveType === 'solid' ? 'is-active' : ''}`}
              onClick={() => {
                setType('solid');
                setTypeMenuOpen(false);
                // Switching FROM gradient TO solid → limpa background-image
                // pra gradient parar de overrider background-color.
                if (isGradient && cssProp === 'background-color') {
                  onApply('background-image', 'none');
                }
              }}
            >Solid</button>
            <button
              type="button"
              className={`preview-layered-type-item ${effectiveType === 'linear' ? 'is-active' : ''}`}
              onClick={() => {
                setType('linear');
                setTypeMenuOpen(false);
                // Gradient mora em background-image quando cssProp = background-color.
                // Mesmo target logic do GradientEditor.onApply abaixo.
                const targetProp = cssProp === 'background-color' ? 'background-image' : cssProp;
                onApply(targetProp, 'linear-gradient(180deg, #ffffff 0%, #000000 100%)');
              }}
            >Linear gradient</button>
            <button
              type="button"
              className={`preview-layered-type-item ${effectiveType === 'radial' ? 'is-active' : ''}`}
              onClick={() => {
                setType('radial');
                setTypeMenuOpen(false);
                const targetProp = cssProp === 'background-color' ? 'background-image' : cssProp;
                onApply(targetProp, 'radial-gradient(circle, #ffffff 0%, #000000 100%)');
              }}
            >Radial gradient</button>
          </div>
        )}
      </div>

      {/* Layer body — solid = LayerRow color picker; gradient = GradientEditor */}
      {effectiveType === 'solid' ? (
        <LayerRow
          value={value}
          prop={cssProp}
          onApply={onApply}
          visible={visible}
          onToggleVisible={() => setVisible((p) => !p)}
          onRemove={() => onApply(cssProp, '')}
        />
      ) : (
        <GradientEditor
          value={value}
          gradientType={effectiveType as 'linear' | 'radial'}
          onApply={(grad) => {
            // Gradient mora em background-image, não background-color
            const targetProp = cssProp === 'background-color' ? 'background-image' : cssProp;
            onApply(targetProp, grad);
          }}
        />
      )}
    </div>
  );
}

/**
 * EffectsSection — Cursor-style com layered effects + type dropdown por layer.
 *
 * Tipos suportados:
 *  - Drop shadow (box-shadow)
 *  - Inner shadow (box-shadow com `inset`)
 *  - Layer Blur (filter: blur())
 *  - Backdrop Blur (backdrop-filter: blur())
 *  - Text shadow (text-shadow)
 *
 * Cada layer aparece como uma row com:
 *  - Type dropdown ("Change effect type")
 *  - Inputs específicos (x/y/blur/spread pra shadow; radius pra blur)
 *  - Color (pra shadows)
 *  - Eye toggle + remove
 */
/**
 * Shadow & Blur — réplica 1:1 do $G0 do Cursor.
 *
 * GATE 0 (inventário): Section tem:
 *   - Header `css-section-header` (+ "clickable" class quando vazia)
 *     + `css-section-title` "Shadow & Blur"
 *     + `css-section-actions` com 1 botão `css-section-action` (+add)
 *   - Body `css-section-body css-effects-body` contém:
 *     - `css-effects-list` role=list aria-label="Effects"
 *       - 1+ `css-effect-entry` role=listitem cada um com:
 *         - `css-effects-icon-button` (abre menu editor)
 *         - `css-effects-type-select-wrapper > css-effects-type-select-container`
 *           - `<select class=css-effects-type-select>` com 4 options
 *           - `<label class=css-effects-type-select-adornment>` (chevron)
 *         - `css-effects-row-actions`
 *           - `css-stroke-action` (visibility eye/eyeClosed)
 *           - `css-stroke-action` (remove — chromeMinimize icon)
 *
 * GATE 1 (templates):
 *   ipw = section principal
 *   tpw = effects menu (popup)
 *   npw = effects list
 *   rpw = effect entry
 *   spw = icon button (abre menu)
 *   opw = option (do select)
 *   apw = visibility button
 *   lpw = remove button (css-stroke-action)
 *   epw = shadow editor (X/Y/Blur/Spread/Color/Opacity)
 *   Zmw = blur editor (single Blur input)
 *
 * GATE 2 (handlers):
 *   onAddShadow, onRemoveShadow, onSelectShadow, onToggleShadowVisibility
 *   onShadowEffectTypeChange, onEffectTypeChange
 *   onBoxShadowOffsetChange("x"|"y", value)
 *   onBoxShadowBlurChange, onBoxShadowSpreadChange
 *   onBoxShadowHexCommit, onBoxShadowOpacityChange
 *   onLayerBlurChange, onToggleLayerBlurVisibility, onClearLayerBlur
 *   onBackdropBlurChange, onToggleBackdropBlurVisibility, onClearBackdropBlur
 *
 * GATE 3 (conditionals):
 *   - Padding-bottom: 8px se R() (tem algum effect), 0px se vazio
 *   - Header "clickable" class quando vazia
 *   - Icon class extra: css-effects-icon-drop-shadow / css-effects-icon-inner-shadow
 *   - data-expanded="true" no icon button quando menu aberto
 *   - Eye icon: eye ↔ eyeClosed; row tem class "active" quando visible
 *
 * GATE 4 (defaults):
 *   Oon = {offsetX:0, offsetY:4, blur:12, spread:0, color:{hex:"#000000",alpha:15}, isInset:false}
 *   Blur regex: /blur\(\s*([0-9.+-eE]+)\s*(px)?\s*\)/i
 *   Blur format: `blur(${Math.round(Math.max(0,n)*100)/100}px)`
 *
 * GATE 5 (generation): código abaixo
 * GATE 6 (self-audit): NÃO TEM text-shadow, NÃO TEM Advanced details, NÃO TEM Transform/Transition/Blend
 * GATE 7 (conclusion): replica fidedigna com 4 tipos {drop, inner, layer-blur, backdrop-blur}
 */

type EffectType = 'drop-shadow' | 'inner-shadow' | 'layer-blur' | 'backdrop-blur';

const EFFECT_TYPE_LABELS: Record<EffectType, string> = {
  'drop-shadow': 'Drop shadow',
  'inner-shadow': 'Inner shadow',
  'layer-blur': 'Layer Blur',
  'backdrop-blur': 'Backdrop Blur',
};

interface ShadowValues {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  hex: string; // sem alpha (#RRGGBB)
  alpha: number; // 0-100
  isInset: boolean;
}

const DEFAULT_SHADOW: ShadowValues = {
  offsetX: 0, offsetY: 4, blur: 12, spread: 0,
  hex: '#000000', alpha: 15, isInset: false,
};

// Parse "Npx Mpx Bpx Spx rgba(r,g,b,a)" ou "inset Npx ..."
function parseShadow(raw: string): ShadowValues {
  if (!raw || raw === 'none') return { ...DEFAULT_SHADOW };
  const trimmed = raw.trim();
  const isInset = /\binset\b/.test(trimmed);
  const cleaned = trimmed.replace(/\binset\b/, '').trim();
  // Parse rgba/hex no fim
  let color = '#000000';
  let alpha = 100;
  const colorMatch = cleaned.match(/(rgba?\([^)]+\)|#[0-9a-f]{3,8})$/i);
  if (colorMatch) {
    const c = colorMatch[1];
    const rgb = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
    if (rgb) {
      const r = parseInt(rgb[1], 10);
      const g = parseInt(rgb[2], 10);
      const b = parseInt(rgb[3], 10);
      const a = rgb[4] ? parseFloat(rgb[4]) : 1;
      color = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0').toUpperCase()).join('');
      alpha = Math.round(a * 100);
    } else if (/^#[0-9a-f]{6}$/i.test(c)) {
      color = c.toUpperCase();
    }
  }
  const numberParts = cleaned.replace(/(rgba?\([^)]+\)|#[0-9a-f]{3,8})$/i, '').trim().split(/\s+/);
  const nums = numberParts.map((p) => parseFloat(p)).filter((n) => Number.isFinite(n));
  return {
    offsetX: nums[0] ?? 0,
    offsetY: nums[1] ?? 4,
    blur: nums[2] ?? 12,
    spread: nums[3] ?? 0,
    hex: color,
    alpha,
    isInset,
  };
}

function stringifyShadow(v: ShadowValues): string {
  const prefix = v.isInset ? 'inset ' : '';
  // hex → rgba
  const m = v.hex.match(/^#([0-9a-f]{6})$/i);
  let colorStr = v.hex;
  if (m) {
    const r = parseInt(m[1].slice(0, 2), 16);
    const g = parseInt(m[1].slice(2, 4), 16);
    const b = parseInt(m[1].slice(4, 6), 16);
    const a = (v.alpha / 100).toFixed(2);
    colorStr = `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return `${prefix}${v.offsetX}px ${v.offsetY}px ${v.blur}px ${v.spread}px ${colorStr}`;
}

// Parse "blur(Npx)" → N
function parseBlurValue(raw: string): number {
  if (!raw || raw === 'none') return 0;
  const m = raw.match(/blur\(\s*([0-9.+-eE]+)\s*(px)?\s*\)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function formatBlur(n: number): string {
  return `blur(${Math.round(Math.max(0, n) * 100) / 100}px)`;
}

interface EffectRow {
  key: string;
  type: EffectType;
  isVisible: boolean;
}

function EffectsSection({
  element,
  onApply,
}: {
  element: InspectedElement;
  onApply: (property: string, value: string) => void;
}) {
  const [collapsed, toggleCollapsed] = useCollapseState('shadow-blur');

  // Hidden-values stash — pattern Cursor / Chrome DevTools: ao "Hide" um effect,
  // o valor CSS é zerado mas guardamos o original em state local pra restaurar
  // no "Show". Keys são fixas por prop CSS (não por EffectType — porque
  // drop-shadow e inner-shadow compartilham box-shadow).
  //
  // Quando um stash existe, a row continua renderizando (isVisible=false) mesmo
  // que a CSS prop esteja vazia — assim o user pode re-mostrar.
  const [hidden, setHidden] = useState<{
    boxShadow?: string;
    filter?: string;
    backdropFilter?: string;
  }>({});

  // Reset stash quando muda o elemento selecionado — stash é per-elemento.
  // Sem isso, hide num elemento "vaza" pra outro (mesma instância de
  // EffectsSection sobrevive porque não tem key prop no parent).
  const currentUid = element.uid || '';
  const lastUidRef = useRef<string>(currentUid);
  if (lastUidRef.current !== currentUid) {
    lastUidRef.current = currentUid;
    // Defer pra próximo render — evita warning de setState durante render
    queueMicrotask(() => setHidden({}));
  }

  // Parse current state from styles. Quando hidden, parse do stash pros
  // controles do popover não pularem pra defaults.
  const boxShadow = element.allStyles['box-shadow'] || '';
  const hasShadow = !!boxShadow && boxShadow !== 'none';
  const shadowVals = hasShadow
    ? parseShadow(boxShadow)
    : hidden.boxShadow
      ? parseShadow(hidden.boxShadow)
      : { ...DEFAULT_SHADOW };

  const filter = element.allStyles['filter'] || '';
  const hasLayerBlur = !!filter && filter !== 'none' && /blur/.test(filter);
  const layerBlurValue = hasLayerBlur
    ? parseBlurValue(filter)
    : hidden.filter
      ? parseBlurValue(hidden.filter)
      : 0;

  const backdrop = element.allStyles['backdrop-filter'] || '';
  const hasBackdropBlur = !!backdrop && backdrop !== 'none' && /blur/.test(backdrop);
  const backdropBlurValue = hasBackdropBlur
    ? parseBlurValue(backdrop)
    : hidden.backdropFilter
      ? parseBlurValue(hidden.backdropFilter)
      : 0;

  // Build list of effect rows — uma row aparece se a CSS prop está visível
  // OU se temos valor stashed (hidden state).
  const rows: EffectRow[] = [];
  if (hasShadow || hidden.boxShadow) {
    rows.push({
      key: 'shadow-0',
      type: shadowVals.isInset ? 'inner-shadow' : 'drop-shadow',
      isVisible: hasShadow,
    });
  }
  if (hasLayerBlur || hidden.filter) {
    rows.push({ key: 'layer-blur', type: 'layer-blur', isVisible: hasLayerBlur });
  }
  if (hasBackdropBlur || hidden.backdropFilter) {
    rows.push({ key: 'backdrop-blur', type: 'backdrop-blur', isVisible: hasBackdropBlur });
  }

  // R() do Cursor: true se tem algum effect
  const hasAny = rows.length > 0;

  // Add next available effect (template Oon).
  // Bug fix: o + não pode sobrescrever box-shadow se já tem shadow.
  // Cursor cycle: drop-shadow → layer-blur → backdrop-blur. Quando tudo
  // existe, + vira no-op (Cursor disable; aqui re-aplica o último sem dano).
  // Quando há stash (hidden), também considera "preenchido" — clicar + não
  // deve clobber valor escondido que o user vai restaurar.
  const addShadow = (): void => {
    const shadowSlotFilled = hasShadow || !!hidden.boxShadow;
    const layerBlurSlotFilled = hasLayerBlur || !!hidden.filter;
    const backdropBlurSlotFilled = hasBackdropBlur || !!hidden.backdropFilter;
    if (!shadowSlotFilled) {
      onApply('box-shadow', stringifyShadow(DEFAULT_SHADOW));
    } else if (!layerBlurSlotFilled) {
      onApply('filter', formatBlur(4));
    } else if (!backdropBlurSlotFilled) {
      onApply('backdrop-filter', formatBlur(10));
    }
    // else: todas as 3 slots preenchidas — no-op (Cursor disable em vez)
  };

  const allSlotsFilled =
    (hasShadow || !!hidden.boxShadow) &&
    (hasLayerBlur || !!hidden.filter) &&
    (hasBackdropBlur || !!hidden.backdropFilter);

  // Remove specific effect by type. Também limpa o stash correspondente —
  // "remove" (botão chromeMinimize) deve fazer a row sumir mesmo se estava hidden.
  const removeEffect = (type: EffectType): void => {
    if (type === 'drop-shadow' || type === 'inner-shadow') {
      onApply('box-shadow', '');
      setHidden((p) => ({ ...p, boxShadow: undefined }));
    } else if (type === 'layer-blur') {
      onApply('filter', '');
      setHidden((p) => ({ ...p, filter: undefined }));
    } else if (type === 'backdrop-blur') {
      onApply('backdrop-filter', '');
      setHidden((p) => ({ ...p, backdropFilter: undefined }));
    }
  };

  // Toggle visibility — stash-and-zero quando visible, restore quando hidden.
  // Pattern Cursor / Chrome DevTools: o valor original persiste em state
  // enquanto a row existe, e re-aplica idêntico quando user clica Show.
  const toggleVisibility = (type: EffectType): void => {
    if (type === 'drop-shadow' || type === 'inner-shadow') {
      if (hidden.boxShadow) {
        // Currently hidden → restore
        const restored = hidden.boxShadow;
        setHidden((p) => ({ ...p, boxShadow: undefined }));
        onApply('box-shadow', restored);
      } else if (hasShadow) {
        // Currently visible → stash + zero
        setHidden((p) => ({ ...p, boxShadow }));
        onApply('box-shadow', '');
      }
    } else if (type === 'layer-blur') {
      if (hidden.filter) {
        const restored = hidden.filter;
        setHidden((p) => ({ ...p, filter: undefined }));
        onApply('filter', restored);
      } else if (hasLayerBlur) {
        setHidden((p) => ({ ...p, filter }));
        onApply('filter', '');
      }
    } else if (type === 'backdrop-blur') {
      if (hidden.backdropFilter) {
        const restored = hidden.backdropFilter;
        setHidden((p) => ({ ...p, backdropFilter: undefined }));
        onApply('backdrop-filter', restored);
      } else if (hasBackdropBlur) {
        setHidden((p) => ({ ...p, backdropFilter: backdrop }));
        onApply('backdrop-filter', '');
      }
    }
  };

  // Change effect type (convert between types). Limpa stash correlato —
  // mudar tipo é edição explícita, então o effect volta a ser visible.
  const changeType = (currentType: EffectType, newType: EffectType): void => {
    if (currentType === newType) return;
    // First, remove the current (also clears its stash)
    removeEffect(currentType);
    // Then apply the new
    if (newType === 'drop-shadow' || newType === 'inner-shadow') {
      onApply('box-shadow', stringifyShadow({ ...DEFAULT_SHADOW, isInset: newType === 'inner-shadow' }));
    } else if (newType === 'layer-blur') {
      onApply('filter', formatBlur(4));
    } else if (newType === 'backdrop-blur') {
      onApply('backdrop-filter', formatBlur(10));
    }
  };

  return (
    <section
      className="css-inspector-section"
      data-collapsed={collapsed}
      style={{ paddingBottom: hasAny ? '8px' : '0px' }}
    >
      <div
        className={`css-section-header ${hasAny ? '' : 'clickable'}`}
        onClick={!hasAny ? (e) => { e.stopPropagation(); addShadow(); } : undefined}
        role={!hasAny ? 'button' : undefined}
        tabIndex={!hasAny ? 0 : undefined}
        onKeyDown={!hasAny ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addShadow(); }
        } : undefined}
      >
        <div className="css-section-header-title-group">
          <button
            type="button"
            className="css-section-collapse-toggle"
            aria-label={collapsed ? 'Expand Shadow & Blur' : 'Collapse Shadow & Blur'}
            aria-expanded={!collapsed}
            onClick={(e) => { e.stopPropagation(); toggleCollapsed(); }}
          >
            <i className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} />
          </button>
          <div className="css-section-title">Shadow & Blur</div>
        </div>
        <div className="css-section-actions">
          <button
            type="button"
            className="css-section-action"
            title={allSlotsFilled ? 'All effects added' : 'Add shadow or blur'}
            aria-label="Add shadow or blur"
            disabled={allSlotsFilled}
            onClick={(e) => { e.stopPropagation(); if (!allSlotsFilled) addShadow(); }}
          >
            <i className="codicon codicon-add" />
          </button>
        </div>
      </div>
      {hasAny ? (
        <div className="css-section-body css-effects-body">
          <div className="css-effects-list" role="list" aria-label="Effects">
            {rows.map((row) => (
              <EffectEntry
                key={row.key}
                row={row}
                shadowVals={shadowVals}
                layerBlurValue={layerBlurValue}
                backdropBlurValue={backdropBlurValue}
                onChangeType={(t) => changeType(row.type, t)}
                onToggleVisibility={() => toggleVisibility(row.type)}
                onRemove={() => removeEffect(row.type)}
                onApply={onApply}
              />
            ))}
          </div>
        </div>
      ) : (
        /* Empty state: hint pra clicar header ou + (estilo Figma) */
        <div className="css-effects-empty" onClick={(e) => { e.stopPropagation(); addShadow(); }}>
          <span className="css-effects-empty-hint">No shadows or blur</span>
          <span className="css-effects-empty-action">Click + or here to add</span>
        </div>
      )}
    </section>
  );
}

/**
 * EffectEntry — replica template `rpw` do Cursor.
 *
 * Layout:
 *   <div class=css-effect-entry role=listitem data-selected=true|false>
 *     <div class=css-effects-type-select-wrapper>
 *       <div class=css-effects-type-select-container>
 *         <select class=css-effects-type-select>
 *           <option>Drop shadow</option> ...
 *         </select>
 *         <label class=css-effects-type-select-adornment>
 *           <i class=chevron-down />
 *         </label>
 *       </div>
 *     </div>
 *     <button class="css-effects-icon-button [css-effects-icon-drop-shadow]"
 *             aria-haspopup=menu>
 *       <i class=borderAll|layerBlur|backgroundBlur />
 *     </button>
 *     <div class=css-effects-row-actions>
 *       <button class="css-stroke-action active|''"><i class=eye|eyeClosed /></button>
 *       <button class=css-stroke-action><i class=chromeMinimize /></button>
 *     </div>
 *   </div>
 */
function EffectEntry({
  row,
  shadowVals,
  layerBlurValue,
  backdropBlurValue,
  onChangeType,
  onToggleVisibility,
  onRemove,
  onApply,
}: {
  row: EffectRow;
  shadowVals: ShadowValues;
  layerBlurValue: number;
  backdropBlurValue: number;
  onChangeType: (newType: EffectType) => void;
  onToggleVisibility: () => void;
  onRemove: () => void;
  onApply: (property: string, value: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  // Icon class per type (matches Cursor css-effects-icon-{drop|inner}-shadow)
  const iconExtraClass =
    row.type === 'drop-shadow' ? 'css-effects-icon-drop-shadow' :
    row.type === 'inner-shadow' ? 'css-effects-icon-inner-shadow' : '';

  // Codicon name per type. Cursor usa custom icons `lt.borderAll/layerBlur/
  // backgroundBlur` (não fazem parte do @vscode/codicons). Mapeamos pros
  // codicons mais próximos visualmente:
  //   - drop/inner shadow → primitive-square (small filled square, similar
  //     ao borderAll-quadradinho do Cursor)
  //   - layer-blur → layers (stack vertical, semanticamente "filter: blur" sobre layer)
  //   - backdrop-blur → layers-dot (layers com indicator, sugere "blur do que tá atrás")
  const iconCodicon =
    row.type === 'layer-blur' ? 'codicon-layers' :
    row.type === 'backdrop-blur' ? 'codicon-layers-dot' :
    'codicon-primitive-square';

  const tooltipBlur = row.type === 'layer-blur' || row.type === 'backdrop-blur';

  return (
    <div
      ref={containerRef}
      className="css-effect-entry"
      role="listitem"
      data-selected={menuOpen ? 'true' : 'false'}
    >
      <button
        type="button"
        className={`css-effects-icon-button ${iconExtraClass}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={tooltipBlur ? 'Adjust blur' : 'Adjust shadow'}
        onClick={(e) => { e.stopPropagation(); setMenuOpen((p) => !p); }}
      >
        <i className={`codicon ${iconCodicon}`} />
      </button>
      <div className="css-effects-type-select-wrapper">
        <div className="css-effects-type-select-container">
          <select
            className="css-effects-type-select"
            value={row.type}
            onChange={(e) => onChangeType(e.currentTarget.value as EffectType)}
            title={EFFECT_TYPE_LABELS[row.type]}
          >
            {(Object.keys(EFFECT_TYPE_LABELS) as EffectType[]).map((t) => (
              <option key={t} value={t}>{EFFECT_TYPE_LABELS[t]}</option>
            ))}
          </select>
          <label className="css-effects-type-select-adornment" aria-label="Change effect type">
            <i className="codicon codicon-chevron-down" />
          </label>
        </div>
      </div>
      <div className="css-effects-row-actions">
        <button
          type="button"
          className={`css-stroke-action ${row.isVisible ? 'active' : ''}`}
          title={row.isVisible ? `Hide ${EFFECT_TYPE_LABELS[row.type].toLowerCase()}` : `Show ${EFFECT_TYPE_LABELS[row.type].toLowerCase()}`}
          aria-label="Toggle visibility"
          onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
        >
          <i className={`codicon ${row.isVisible ? 'codicon-eye' : 'codicon-eye-closed'}`} />
        </button>
        <button
          type="button"
          className="css-stroke-action"
          title={tooltipBlur ? 'Remove blur' : 'Remove shadow'}
          aria-label="Remove effect"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <i className="codicon codicon-chrome-minimize" />
        </button>
      </div>
      {menuOpen && (
        <EffectEditorPopup
          row={row}
          shadowVals={shadowVals}
          layerBlurValue={layerBlurValue}
          backdropBlurValue={backdropBlurValue}
          onApply={onApply}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * EffectEditorPopup — popover anchor com inputs (`epw` pra shadow, `Zmw` pra blur).
 *
 * Cursor renderiza via _8 (popup component) com:
 *   anchor: "top-left"
 *   position: { x: button.left, y: button.top - 8 }
 *   width: 320
 *   maxHeight: 360
 *
 * Pra shadow (epw):
 *   <div class=css-effects-controls>
 *     <div class=css-effects-parameters>  -- grid 2x2
 *       [X] [Y]
 *       [Blur] [Spread]
 *     </div>
 *     <div class=css-effects-color-row>
 *       [swatch] [hex] | [opacity %]
 *     </div>
 *   </div>
 *
 * Pra blur (Zmw):
 *   <div class=css-effects-menu>
 *     <div class=css-effects-controls>
 *       <div class=css-effects-parameters>
 *         [Blur]
 *       </div>
 *     </div>
 *   </div>
 */
function EffectEditorPopup({
  row,
  shadowVals,
  layerBlurValue,
  backdropBlurValue,
  onApply,
  onClose,
}: {
  row: EffectRow;
  shadowVals: ShadowValues;
  layerBlurValue: number;
  backdropBlurValue: number;
  onApply: (property: string, value: string) => void;
  onClose: () => void;
}) {
  void onClose;
  // Local draft state pra hex commit
  const [hexDraft, setHexDraft] = useState(shadowVals.hex);
  useEffect(() => { setHexDraft(shadowVals.hex); }, [shadowVals.hex]);

  const applyShadow = (patch: Partial<ShadowValues>): void => {
    const next = { ...shadowVals, ...patch };
    onApply('box-shadow', stringifyShadow(next));
  };

  if (row.type === 'layer-blur' || row.type === 'backdrop-blur') {
    const current = row.type === 'layer-blur' ? layerBlurValue : backdropBlurValue;
    return (
      <div className="css-effects-menu css-effects-popup">
        <div className="css-effects-controls">
          <div className="css-effects-parameters">
            <div className="css-input-group">
              <label className="css-input-label-draggable" aria-label="Blur amount">Blur</label>
              <div className="css-input-field">
                <input
                  className="css-number-input"
                  type="number"
                  min={0}
                  value={current}
                  onChange={(e) => {
                    const n = parseFloat(e.currentTarget.value);
                    if (!Number.isNaN(n)) {
                      const prop = row.type === 'layer-blur' ? 'filter' : 'backdrop-filter';
                      onApply(prop, formatBlur(n));
                    }
                  }}
                />
                <span className="css-input-suffix css-input-suffix-draggable">px</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Shadow editor (drop-shadow / inner-shadow)
  return (
    <div className="css-effects-menu css-effects-popup">
      <div className="css-effects-controls">
        <div className="css-effects-parameters">
          <div className="css-input-group">
            <label className="css-input-label-draggable" aria-label="Shadow X offset">X</label>
            <div className="css-input-field">
              <input
                className="css-number-input"
                type="number"
                value={shadowVals.offsetX}
                onChange={(e) => {
                  const n = parseFloat(e.currentTarget.value);
                  if (!Number.isNaN(n)) applyShadow({ offsetX: n });
                }}
              />
              <span className="css-input-suffix css-input-suffix-draggable">px</span>
            </div>
          </div>
          <div className="css-input-group">
            <label className="css-input-label-draggable" aria-label="Shadow Y offset">Y</label>
            <div className="css-input-field">
              <input
                className="css-number-input"
                type="number"
                value={shadowVals.offsetY}
                onChange={(e) => {
                  const n = parseFloat(e.currentTarget.value);
                  if (!Number.isNaN(n)) applyShadow({ offsetY: n });
                }}
              />
              <span className="css-input-suffix css-input-suffix-draggable">px</span>
            </div>
          </div>
          <div className="css-input-group">
            <label className="css-input-label-draggable" aria-label="Shadow blur">Blur</label>
            <div className="css-input-field">
              <input
                className="css-number-input"
                type="number"
                min={0}
                value={shadowVals.blur}
                onChange={(e) => {
                  const n = parseFloat(e.currentTarget.value);
                  if (!Number.isNaN(n)) applyShadow({ blur: Math.max(0, n) });
                }}
              />
              <span className="css-input-suffix css-input-suffix-draggable">px</span>
            </div>
          </div>
          <div className="css-input-group">
            <label className="css-input-label-draggable" aria-label="Shadow spread">Spread</label>
            <div className="css-input-field">
              <input
                className="css-number-input"
                type="number"
                value={shadowVals.spread}
                onChange={(e) => {
                  const n = parseFloat(e.currentTarget.value);
                  if (!Number.isNaN(n)) applyShadow({ spread: n });
                }}
              />
              <span className="css-input-suffix css-input-suffix-draggable">px</span>
            </div>
          </div>
        </div>
        <div className="css-effects-color-row">
          <div className="css-color-input-container">
            <input
              className="css-color-swatch-inline"
              type="color"
              value={shadowVals.hex.toLowerCase()}
              onChange={(e) => applyShadow({ hex: e.currentTarget.value.toUpperCase() })}
            />
            <input
              className="css-hex-input"
              type="text"
              value={hexDraft}
              onChange={(e) => setHexDraft(e.currentTarget.value)}
              onBlur={() => {
                if (/^#?[0-9a-f]{6}$/i.test(hexDraft)) {
                  applyShadow({ hex: (hexDraft.startsWith('#') ? hexDraft : `#${hexDraft}`).toUpperCase() });
                } else {
                  setHexDraft(shadowVals.hex);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
              }}
              spellCheck={false}
            />
            <div className="css-input-separator" />
            <div className="css-opacity-input-inline css-input-field">
              <input
                className="css-number-input"
                type="number"
                min={0}
                max={100}
                value={shadowVals.alpha}
                onChange={(e) => {
                  const n = parseFloat(e.currentTarget.value);
                  if (!Number.isNaN(n)) applyShadow({ alpha: Math.max(0, Math.min(100, Math.round(n))) });
                }}
              />
              <span className="css-input-suffix css-input-suffix-draggable" title="Drag to adjust opacity" aria-label="Drag to adjust opacity">%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * GradientEditor — barra de gradient com stops arrastáveis + add/remove/reverse.
 * Espelha Cursor (css-gradient-stop-handle).
 *
 * UI:
 *   ┌─────────────────────────────────────┐
 *   │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ← barra gradient
 *   │   ▼          ▼               ▼      ← handles (stops)
 *   ├─────────────────────────────────────┤
 *   │ Stop selecionado: [hex] [pos%] [-]  │
 *   ├─────────────────────────────────────┤
 *   │ [+ Add stop]  [↔ Reverse]           │
 *   └─────────────────────────────────────┘
 *
 * Parse CSS gradient → stops array → render → on change → reconstruct.
 */
interface GradStop { color: string; position: number; /* 0-100 */ }

function parseGradient(value: string): { type: 'linear' | 'radial'; angle: string; stops: GradStop[] } {
  // Default fallback
  const fallback = { type: 'linear' as const, angle: '180deg', stops: [{ color: '#ffffff', position: 0 }, { color: '#000000', position: 100 }] };
  if (!value) return fallback;

  const isRadial = value.includes('radial');
  // Extract content inside gradient()
  const m = value.match(/(?:linear|radial)-gradient\(([^]+)\)$/);
  if (!m) return fallback;
  const inner = m[1];

  // Split by commas mas respeitando parens (rgba(), etc).
  const parts: string[] = [];
  let buf = '';
  let depth = 0;
  for (const ch of inner) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(buf.trim()); buf = '';
    } else buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());

  let angle = isRadial ? 'circle' : '180deg';
  let startIdx = 0;
  // First part is angle/direction (only for linear)
  if (!isRadial && parts[0] && !/^#|^rgb|^hsl/.test(parts[0])) {
    angle = parts[0];
    startIdx = 1;
  } else if (isRadial && parts[0] && !/^#|^rgb|^hsl/.test(parts[0])) {
    angle = parts[0];
    startIdx = 1;
  }

  const stops: GradStop[] = [];
  for (let i = startIdx; i < parts.length; i++) {
    const part = parts[i];
    // "color position%" — split last token if it's a percentage
    const stopM = part.match(/^(.+?)\s+(\d*\.?\d+)%$/);
    if (stopM) {
      stops.push({ color: stopM[1].trim(), position: parseFloat(stopM[2]) });
    } else {
      // No explicit position — interpolate later
      stops.push({ color: part, position: -1 });
    }
  }
  // Fill in missing positions (interpolate)
  if (stops.some((s) => s.position < 0)) {
    const total = stops.length;
    stops.forEach((s, i) => {
      if (s.position < 0) s.position = (i / Math.max(1, total - 1)) * 100;
    });
  }
  return { type: isRadial ? 'radial' : 'linear', angle, stops };
}

function buildGradient(type: 'linear' | 'radial', angle: string, stops: GradStop[]): string {
  const sortedStops = [...stops].sort((a, b) => a.position - b.position);
  const stopsStr = sortedStops.map((s) => `${s.color} ${s.position}%`).join(', ');
  return `${type}-gradient(${angle}, ${stopsStr})`;
}

function GradientEditor({
  value,
  gradientType,
  onApply,
}: {
  value: string;
  gradientType: 'linear' | 'radial';
  onApply: (gradient: string) => void;
}) {
  const parsed = parseGradient(value);
  const stops = parsed.stops.length > 0 ? parsed.stops : [{ color: '#ffffff', position: 0 }, { color: '#000000', position: 100 }];
  const [selectedIdx, setSelectedIdx] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);

  const commit = (newStops: GradStop[], newAngle: string = parsed.angle): void => {
    onApply(buildGradient(gradientType, newAngle, newStops));
  };

  const onBarClick = (e: React.MouseEvent): void => {
    if (e.target !== barRef.current) return; // só click na barra direta, não no handle
    const rect = barRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.round((x / rect.width) * 100);
    // Add stop at this position, color interpolated (simple: midpoint between adjacent)
    const next = [...stops, { color: '#888888', position: pct }];
    commit(next);
    setSelectedIdx(next.length - 1);
  };

  const onHandleMouseDown = (idx: number, e: React.MouseEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedIdx(idx);
    const rect = barRef.current!.getBoundingClientRect();
    const startStops = [...stops];
    document.body.classList.add('is-dragging-value');

    const onMove = (ev: MouseEvent): void => {
      const x = ev.clientX - rect.left;
      const pct = Math.max(0, Math.min(100, Math.round((x / rect.width) * 100)));
      const next = startStops.map((s, i) => i === idx ? { ...s, position: pct } : s);
      commit(next);
    };
    const onUp = (): void => {
      document.body.classList.remove('is-dragging-value');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const updateStopColor = (idx: number, color: string): void => {
    commit(stops.map((s, i) => i === idx ? { ...s, color } : s));
  };
  const updateStopPos = (idx: number, position: number): void => {
    commit(stops.map((s, i) => i === idx ? { ...s, position } : s));
  };
  const removeStop = (idx: number): void => {
    if (stops.length <= 2) return;
    const next = stops.filter((_, i) => i !== idx);
    commit(next);
    if (selectedIdx >= next.length) setSelectedIdx(next.length - 1);
  };
  const addStop = (): void => {
    // Add at midpoint between selected and next stop (ou no fim)
    const sorted = [...stops].sort((a, b) => a.position - b.position);
    const selPos = stops[selectedIdx]?.position ?? 0;
    const nextStop = sorted.find((s) => s.position > selPos);
    const pos = nextStop ? (selPos + nextStop.position) / 2 : Math.min(100, selPos + 25);
    const next = [...stops, { color: stops[selectedIdx]?.color || '#888888', position: pos }];
    commit(next);
    setSelectedIdx(next.length - 1);
  };
  const reverse = (): void => {
    commit(stops.map((s) => ({ ...s, position: 100 - s.position })));
  };

  // Gradient string pra background do preview bar
  const previewGrad = buildGradient('linear', '90deg', stops);
  const sel = stops[selectedIdx] || stops[0];

  return (
    <div className="preview-gradient-editor">
      {/* Barra preview com handles */}
      <div
        ref={barRef}
        className="preview-gradient-bar"
        style={{ background: previewGrad }}
        onClick={onBarClick}
        title="Click to add stop"
      >
        {stops.map((s, i) => (
          <button
            key={i}
            type="button"
            className={`preview-gradient-stop-handle ${i === selectedIdx ? 'selected' : ''}`}
            style={{ left: `${s.position}%`, background: s.color }}
            onMouseDown={(e) => onHandleMouseDown(i, e)}
            title={`${s.color} ${s.position}%`}
          />
        ))}
      </div>

      {/* Stop editor inline */}
      {sel && (
        <div className="preview-gradient-stop-edit">
          <input
            type="color"
            className="preview-color-native"
            value={/^#[0-9a-f]{6}$/i.test(sel.color) ? sel.color : '#888888'}
            onChange={(e) => updateStopColor(selectedIdx, e.target.value)}
          />
          <span className="preview-color-swatch" style={{ background: sel.color }} />
          <input
            type="text"
            className="preview-color-hex"
            value={sel.color}
            onChange={(e) => updateStopColor(selectedIdx, e.target.value)}
            spellCheck={false}
          />
          <input
            type="number"
            className="preview-gradient-pos"
            value={Math.round(sel.position)}
            min={0}
            max={100}
            onChange={(e) => updateStopPos(selectedIdx, parseInt(e.target.value) || 0)}
          />
          <span className="preview-gradient-pos-suffix">%</span>
          <button
            type="button"
            className="preview-layer-remove"
            onClick={() => removeStop(selectedIdx)}
            title="Remove stop"
            disabled={stops.length <= 2}
          >
            <i className="codicon codicon-dash" />
          </button>
        </div>
      )}

      {/* Action row */}
      <div className="preview-gradient-actions">
        <button
          type="button"
          className="preview-gradient-add-stop"
          onClick={addStop}
          title="Add color stop"
        >
          <i className="codicon codicon-add" /> Add stop
        </button>
        <button
          type="button"
          className="preview-gradient-reverse"
          onClick={reverse}
          title="Reverse gradient"
        >
          <i className="codicon codicon-arrow-swap" /> Reverse
        </button>
      </div>
    </div>
  );
}

/**
 * LayerRow — 1 row de Background/Border/Shadow.
 * Swatch + hex + opacity + visibility + remove.
 */
function LayerRow({
  value,
  prop,
  onApply,
  visible,
  onToggleVisible,
  onRemove,
}: {
  value: string;
  prop: string;
  onApply: (property: string, value: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
  onRemove: () => void;
}) {
  const parseColor = (v: string): { hex: string; alpha: number } => {
    if (!v) return { hex: '#000000', alpha: 100 };
    const hexM = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
    if (hexM) return { hex: '#' + hexM[1].toLowerCase(), alpha: hexM[2] ? Math.round(parseInt(hexM[2], 16) / 2.55) : 100 };
    const rgbM = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d*\.?\d+))?\s*\)/);
    if (rgbM) {
      const r = parseInt(rgbM[1]).toString(16).padStart(2, '0');
      const g = parseInt(rgbM[2]).toString(16).padStart(2, '0');
      const b = parseInt(rgbM[3]).toString(16).padStart(2, '0');
      const a = rgbM[4] !== undefined ? parseFloat(rgbM[4]) : 1;
      return { hex: '#' + r + g + b, alpha: Math.round(a * 100) };
    }
    return { hex: '#000000', alpha: 100 };
  };
  const buildColor = (h: string, a: number): string =>
    a >= 100 ? h : `rgba(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}, ${(a / 100).toFixed(2)})`;

  const parsed = parseColor(value);
  const [hex, setHex] = useState(parsed.hex);
  const [alpha, setAlpha] = useState(parsed.alpha);
  useEffect(() => { const p = parseColor(value); setHex(p.hex); setAlpha(p.alpha); }, [value]);

  return (
    <div className={`preview-layer-row ${!visible ? 'is-hidden' : ''}`}>
      <input
        type="color"
        className="preview-color-native"
        value={hex}
        onChange={(e) => {
          setHex(e.target.value);
          onApply(prop, buildColor(e.target.value, alpha));
        }}
      />
      <span className="preview-color-swatch" style={{ background: value || hex }} />
      <input
        type="text"
        className="preview-color-hex"
        value={hex}
        onChange={(e) => setHex(e.target.value)}
        onBlur={() => onApply(prop, buildColor(hex, alpha))}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
        spellCheck={false}
      />
      <input
        type="text"
        className="preview-color-alpha"
        value={alpha + '%'}
        onChange={(e) => {
          const n = parseInt(e.target.value.replace(/[^\d]/g, ''));
          if (!isNaN(n)) setAlpha(Math.min(100, Math.max(0, n)));
        }}
        onBlur={() => onApply(prop, buildColor(hex, alpha))}
        spellCheck={false}
      />
      <button type="button" className="preview-layer-eye" onClick={onToggleVisible} title="Toggle visibility">
        <i className={`codicon codicon-${visible ? 'eye' : 'eye-closed'}`} />
      </button>
      <button type="button" className="preview-layer-remove" onClick={onRemove} title="Remove">
        <i className="codicon codicon-dash" />
      </button>
    </div>
  );
}

/**
 * RadiusSection — border-radius com toggle "individual corners".
 * Default: 1 input (afeta os 4 cantos). Toggle abre 4 inputs (TL, TR, BR, BL).
 * Layout dos 4 inputs imita a posição visual dos cantos (2x2 grid).
 */
function RadiusSection({
  all,
  tl, tr, br, bl,
  onApply,
}: {
  all: string;
  tl: string; tr: string; br: string; bl: string;
  onApply: (property: string, value: string) => void;
}) {
  const symmetric = tl === tr && tr === br && br === bl;
  const [forceExpanded, setForceExpanded] = useState(false);
  const expanded = forceExpanded || !symmetric;

  return (
    <div className="preview-design-row preview-design-row-edit">
      <span className="preview-design-row-label">Radius</span>
      <div className="preview-radius-input">
        {expanded ? (
          <div className="preview-radius-grid">
            <NumberInput value={tl} prop="border-top-left-radius" onApply={onApply} />
            <NumberInput value={tr} prop="border-top-right-radius" onApply={onApply} />
            <NumberInput value={bl} prop="border-bottom-left-radius" onApply={onApply} />
            <NumberInput value={br} prop="border-bottom-right-radius" onApply={onApply} />
          </div>
        ) : (
          <NumberInput value={all} prop="border-radius" onApply={onApply} />
        )}
        <button
          type="button"
          className={`preview-side-toggle ${expanded ? 'is-active' : ''}`}
          onClick={() => setForceExpanded((p) => !p)}
          title="Edit corners individually"
        >
          <svg width="12" height="12" viewBox="0 0 14 14">
            <path d="M2 5 L2 2 L5 2 M9 2 L12 2 L12 5 M12 9 L12 12 L9 12 M5 12 L2 12 L2 9"
              stroke="currentColor" strokeWidth="1.2" fill="none" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * FontFamilyRow — dropdown que lista fontes carregadas + system fonts comuns.
 * Espelha Cursor: input com texto editável + chevron + lista flutuante ao clicar.
 */
const SYSTEM_FONTS = [
  'system-ui', '-apple-system', 'sans-serif', 'serif', 'monospace',
  'Arial', 'Helvetica', 'Helvetica Neue', 'Verdana', 'Tahoma', 'Trebuchet MS',
  'Times New Roman', 'Georgia', 'Courier New', 'Consolas', 'Menlo', 'Monaco',
  'Segoe UI', 'Roboto', 'Inter', 'SF Pro Display', 'SF Pro Text',
];

function FontFamilyRow({
  value,
  onApply,
}: {
  value: string;
  onApply: (property: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const triggerRef = useRef<HTMLDivElement>(null);

  // Parse primary font do value computed (vem como "Anthropic Sans", system-ui, ...)
  const primary = (value || '').split(',')[0]?.trim().replace(/^["']|["']$/g, '') || 'inherit';

  // Lista filtrada — system fonts + qualquer fonte usada na página.
  // TODO: query document.fonts.values() via webFrame quando integrar fully.
  const options = SYSTEM_FONTS.filter((f) =>
    !filter || f.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="preview-design-row preview-design-row-edit">
      <span className="preview-design-row-label">Font</span>
      <div className="preview-font-picker" ref={triggerRef}>
        <button
          type="button"
          className="preview-font-picker-trigger"
          onClick={() => setOpen((p) => !p)}
        >
          <span className="preview-font-picker-value" style={{ fontFamily: primary }}>
            {primary}
          </span>
          <i className="codicon codicon-chevron-down" />
        </button>
        {open && (
          <div className="preview-font-picker-menu">
            <input
              type="text"
              className="preview-font-picker-search"
              placeholder="Buscar fonte..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
            <div className="preview-font-picker-list">
              {options.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`preview-font-picker-item ${f === primary ? 'is-active' : ''}`}
                  style={{ fontFamily: f }}
                  onClick={() => { onApply('font-family', f); setOpen(false); setFilter(''); }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * useScrubbyDrag — hook que faz um elemento virar "scrubby input" igual Cursor.
 *
 * Algoritmo extraído do bundle do Cursor (i1 directive):
 *   pointerdown(button=0) → salva clientX inicial + valor atual (getValue())
 *   pointermove → delta = clientX - startX
 *                 multiplier = shift?10 : alt?0.1 : 1
 *                 newValue = startValue + delta * step * multiplier
 *                 clamp(min, max), round to 0.1
 *                 onChange(newValue)
 *   pointerup → cleanup
 *
 * cursor: ew-resize durante drag. setPointerCapture pra continuar recebendo
 * eventos mesmo se cursor sair do elemento.
 */
function useScrubbyDrag(
  ref: { current: HTMLElement | null },
  config: {
    getValue: () => number;
    onChange: (v: number) => void;
    step?: number;
    min?: number;
    max?: number;
    disabled?: boolean;
  },
): void {
  // Guarda config num ref pra não re-attach listeners a cada render
  const cfgRef = useRef(config);
  cfgRef.current = config;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let pointerId: number | null = null;
    let startX = 0;
    let startValue = 0;
    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      if (cfgRef.current.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startValue = cfgRef.current.getValue();
      if (!Number.isFinite(startValue)) startValue = 0;
      pointerId = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      el.setAttribute('data-dragging', 'true');
    };
    const onPointerMove = (e: PointerEvent): void => {
      if (pointerId === null) return;
      const cfg = cfgRef.current;
      const step = cfg.step ?? 1;
      const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      const delta = e.clientX - startX;
      let next = startValue + delta * step * mult;
      if (typeof cfg.min === 'number') next = Math.max(cfg.min, next);
      if (typeof cfg.max === 'number') next = Math.min(cfg.max, next);
      next = Math.round(next * 10) / 10;
      cfg.onChange(next);
    };
    const onPointerUp = (e: PointerEvent): void => {
      if (pointerId === null) return;
      try { el.releasePointerCapture(pointerId); } catch { /* ignore */ }
      pointerId = null;
      el.removeAttribute('data-dragging');
    };
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
    };
  }, [ref]);
}

/**
 * ScrubLabel — label numérico arrastável (igual Cursor). Wrapper de useScrubbyDrag.
 * Usado em todos os labels X/Y/Z/rotation/padding/etc do CSS Inspector.
 */
function ScrubLabel({
  children,
  getValue,
  onChange,
  step,
  min,
  max,
  disabled,
  ariaLabel,
  className,
  title,
}: {
  children: ReactNode;
  getValue: () => number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  ariaLabel?: string;
  /** Modifier extra pra label (ex: `css-padding-label-icon`, `css-gap-label-icon`). */
  className?: string;
  title?: string;
}) {
  const ref = useRef<HTMLLabelElement | null>(null);
  useScrubbyDrag(ref, { getValue, onChange, step, min, max, disabled });
  return (
    <label
      ref={ref}
      className={`css-input-label-draggable${className ? ' ' + className : ''}`}
      aria-label={ariaLabel}
      title={title}
      style={{ cursor: disabled ? 'default' : 'ew-resize' }}
    >
      {children}
    </label>
  );
}

/**
 * PositionSection — réplica 1:1 do Cursor (XG0 em workbench.desktop.main.js).
 *
 * HTML extraído raw do bundle do Cursor:
 *   <section class="css-inspector-section">
 *     <div class="css-section-header">
 *       <div><div class="css-section-title">Position</div></div>
 *       <div class="css-section-actions">
 *         <button class="css-section-action css-position-mode-toggle"><i></i></button>
 *       </div>
 *     </div>
 *     <div class="css-section-body">
 *       <div class="css-dual-input-row">
 *         <div class="css-input-group">  (X)
 *           <label class="css-input-label-draggable">X</label>
 *           <div class="css-input-field">
 *             <input class="css-number-input" type="number">
 *             <span class="css-input-suffix">px</span>
 *           </div>
 *         </div>
 *         (Y idem)
 *         (Z idem mas sem suffix — z-index é unitless)
 *         <div class="css-rotation-row">
 *           <div class="css-rotation-inputs">
 *             <div class="css-input-group">
 *               <label class="css-input-label-draggable"><i>∠</i></label>
 *               <div class="css-input-field">
 *                 <input class="css-number-input" type="number">
 *                 <span class="css-input-suffix">°</span>
 *               </div>
 *             </div>
 *           </div>
 *           <div class="css-rotation-actions">
 *             <button class="css-section-action css-rotation-action">↻</button>
 *             <button class="css-section-action css-rotation-action">⇋</button>
 *             <button class="css-section-action css-rotation-action">⇵</button>
 *           </div>
 *         </div>
 *       </div>
 *     </div>
 *   </section>
 *
 * Handlers replicam Lm/Uf/c0/c_/Gf/xp/Ro do Cursor (ver docs/cursor-css-inspector-rev.md).
 * Display values usam Math.round nos 3 primeiros, rotation NÃO arredonda.
 * X/Y/Z disabled quando NOT absolute; rotation SEMPRE editável.
 */
function PositionSection({
  element,
  onApply,
}: {
  element: InspectedElement;
  onApply: (property: string, value: string) => void;
}) {
  const [collapsed, toggleCollapsed] = useCollapseState('position');
  // Si() — isAbsolutePositioned
  const isAbsolute = element.designProps.position === 'absolute';
  const disabled = !isAbsolute;

  // BZ helper: parseia pixel string pra number (null se inválido)
  const parsePx = (raw: string): number | null => {
    if (!raw || raw === 'auto') return null;
    const m = raw.match(/^(-?\d*\.?\d+)/);
    return m ? parseFloat(m[1]) : null;
  };

  // rs/Cs — positionX/YValue: parsed CSS left/top ?? rect.left/top puro
  const positionXValue = parsePx(element.allStyles['left'] || '') ?? element.rect.x;
  const positionYValue = parsePx(element.allStyles['top'] || '') ?? element.rect.y;

  // Bs — zIndexValue: parsed z-index ?? 0
  const zIndexValue = parsePx(element.allStyles['z-index'] || '') ?? 0;

  // Dl — rotationValue: Lmw(transform)
  // PRIORIDADE: inline style (preserva rotate(540deg) literal) > computed
  // matrix (trunca via atan2 pra [-180,180]). Sem inline-first, accumulate
  // de 90° loopa apos 180°.
  const inlineTransform = element.inlineStyles?.transform || '';
  const computedTransform = element.allStyles['transform'] || 'none';
  const transformRaw = inlineTransform || computedTransform;
  const parseRotation = (t: string): number => {
    if (!t || t === 'none') return 0;
    // 1) Tenta rotate() literal (vem do inline OU declaração simples)
    const rotM = t.match(/rotate\(([^)]+)\)/);
    if (rotM) {
      const v = parseFloat(rotM[1]);
      if (Number.isFinite(v)) return v;
    }
    // 2) Fallback: matrix do computed (perde precisão se > 180°)
    const matrix = t.match(/^matrix\(\s*([^,]+),\s*([^,]+),/);
    if (matrix) {
      const a = parseFloat(matrix[1]);
      const b = parseFloat(matrix[2]);
      return Math.atan2(b, a) * 180 / Math.PI;
    }
    return 0;
  };
  const rotationValue = parseRotation(transformRaw);

  // === Handlers (replica Cursor exato) ===

  // Ro — onAbsolutePositionToggle
  const onAbsolutePositionToggle = (next: boolean): void => {
    if (next === isAbsolute) return;
    if (next) {
      onApply('position', 'absolute');
    } else {
      onApply('position', 'static');
      onApply('left', '');
      onApply('top', '');
    }
  };

  // Lm — onPositionChange (prop = "left" | "top")
  const onPositionChange = (prop: string, value: string): void => {
    if (value === '') { onApply(prop, ''); return; }
    const n = parseFloat(value);
    if (Number.isNaN(n)) return;
    if (!isAbsolute) return;
    onApply(prop, `${n}px`);
  };

  // Uf — onZIndexChange
  const onZIndexChange = (value: string): void => {
    if (!isAbsolute) return;
    if (value.trim() === '') { onApply('z-index', 'auto'); return; }
    const n = parseFloat(value);
    if (Number.isNaN(n)) return;
    onApply('z-index', `${Math.round(n)}`);
  };

  // c0 — onRotationChange via Nmw (substitui rotate() no transform)
  const onRotationChange = (value: string): void => {
    const n = parseFloat(value);
    if (Number.isNaN(n)) return;
    // Nmw equivalente: substitui ou adiciona rotate(Ndeg) no transform
    const t = transformRaw === 'none' ? '' : transformRaw;
    let next: string;
    if (/rotate\(/.test(t)) {
      next = t.replace(/rotate\([^)]+\)/, `rotate(${n}deg)`);
    } else if (t.trim()) {
      next = `${t} rotate(${n}deg)`;
    } else {
      next = `rotate(${n}deg)`;
    }
    onApply('transform', next);
  };

  // c_ — onRotateQuarterTurn: ACUMULA +90 sempre
  const onRotateQuarterTurn = (): void => {
    const current = Number.isFinite(rotationValue) ? rotationValue : 0;
    onRotationChange((current + 90).toString());
  };

  // X_ — flip axis helper (Mmw): toggle scaleX(-1) ou scaleY(-1)
  const flipAxis = (axis: 'horizontal' | 'vertical'): void => {
    const scaleProp = axis === 'horizontal' ? 'scaleX' : 'scaleY';
    const re = new RegExp(`${scaleProp}\\(\\s*-1\\s*\\)`);
    const t = transformRaw === 'none' ? '' : transformRaw;
    let next: string;
    if (re.test(t)) {
      // Já tem -1, remove
      next = t.replace(re, '').replace(/\s+/g, ' ').trim();
    } else if (t.trim()) {
      next = `${t} ${scaleProp}(-1)`;
    } else {
      next = `${scaleProp}(-1)`;
    }
    onApply('transform', next || '');
  };

  // Gf / xp
  const onFlipHorizontal = (): void => flipAxis('horizontal');
  const onFlipVertical = (): void => flipAxis('vertical');

  return (
    <section className="css-inspector-section" data-collapsed={collapsed}>
      <div className="css-section-header">
        <div className="css-section-header-title-group">
          <button
            type="button"
            className="css-section-collapse-toggle"
            aria-label={collapsed ? 'Expand Position' : 'Collapse Position'}
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
          >
            <i className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} />
          </button>
          <div className="css-section-title">Position</div>
        </div>
        <div className="css-section-actions">
          <button
            type="button"
            className={`css-section-action css-position-mode-toggle ${isAbsolute ? 'active' : ''}`}
            aria-pressed={isAbsolute}
            title={isAbsolute ? 'Disable absolute positioning' : 'Enable absolute positioning'}
            onClick={(e) => {
              e.stopPropagation();
              onAbsolutePositionToggle(!isAbsolute);
            }}
          >
            <i className="codicon codicon-pin" />
          </button>
        </div>
      </div>
      <div className="css-section-body">
        <div className="css-dual-input-row">
          {/* X */}
          <div className={`css-input-group ${disabled ? 'css-position-disabled' : ''}`}>
            <ScrubLabel
              getValue={() => Math.round(positionXValue)}
              onChange={(v) => onPositionChange('left', Math.round(v).toString())}
              disabled={disabled}
            >X</ScrubLabel>
            <div className="css-input-field">
              <input
                className="css-number-input"
                type="number"
                value={Math.round(positionXValue)}
                disabled={disabled}
                onChange={(e) => onPositionChange('left', e.currentTarget.value)}
              />
              <span className="css-input-suffix">px</span>
            </div>
          </div>
          {/* Y */}
          <div className={`css-input-group ${disabled ? 'css-position-disabled' : ''}`}>
            <ScrubLabel
              getValue={() => Math.round(positionYValue)}
              onChange={(v) => onPositionChange('top', Math.round(v).toString())}
              disabled={disabled}
            >Y</ScrubLabel>
            <div className="css-input-field">
              <input
                className="css-number-input"
                type="number"
                value={Math.round(positionYValue)}
                disabled={disabled}
                onChange={(e) => onPositionChange('top', e.currentTarget.value)}
              />
              <span className="css-input-suffix">px</span>
            </div>
          </div>
          {/* Z (sem suffix — unitless) */}
          <div className={`css-input-group ${disabled ? 'css-position-disabled' : ''}`}>
            <ScrubLabel
              getValue={() => Math.round(zIndexValue)}
              onChange={(v) => onZIndexChange(Math.round(v).toString())}
              disabled={disabled}
            >Z</ScrubLabel>
            <div className="css-input-field">
              <input
                className="css-number-input"
                type="number"
                value={Math.round(zIndexValue)}
                disabled={disabled}
                onChange={(e) => onZIndexChange(e.currentTarget.value)}
              />
            </div>
          </div>
          {/* Rotation row — sempre editável (não depende de isAbsolute) */}
          <div className="css-rotation-row">
            <div className="css-rotation-inputs">
              <div className="css-input-group">
                <ScrubLabel
                  getValue={() => rotationValue}
                  onChange={(v) => onRotationChange(v.toString())}
                  ariaLabel="Rotation"
                >
                  <i className="codicon codicon-symbol-ruler" />
                </ScrubLabel>
                <div className="css-input-field">
                  <input
                    className="css-number-input"
                    type="number"
                    value={rotationValue}
                    onChange={(e) => onRotationChange(e.currentTarget.value)}
                  />
                  <span className="css-input-suffix">°</span>
                </div>
              </div>
            </div>
            <div className="css-rotation-actions">
              <button
                type="button"
                className="css-section-action css-rotation-action"
                aria-label="Rotate 90 degrees"
                title="Rotate 90°"
                onClick={(e) => { e.stopPropagation(); onRotateQuarterTurn(); }}
              >
                <i className="codicon codicon-discard" />
              </button>
              <button
                type="button"
                className="css-section-action css-rotation-action"
                aria-label="Flip horizontally"
                title="Flip horizontally"
                onClick={(e) => { e.stopPropagation(); onFlipHorizontal(); }}
              >
                <i className="codicon codicon-arrow-swap" />
              </button>
              <button
                type="button"
                className="css-section-action css-rotation-action css-rotation-action--flip-vertical"
                aria-label="Flip vertically"
                title="Flip vertically"
                onClick={(e) => { e.stopPropagation(); onFlipVertical(); }}
              >
                <i className="codicon codicon-arrow-swap" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * DomTreeView — renderiza a árvore DOM completa do <body> no painel
 * Components. Replica o Cursor: cada nó tem chevron expand/collapse +
 * tag.classe + click pra selecionar. Ancestrais do selected ficam auto-
 * expandidos.
 */
function DomTreeView({
  root,
  selectedUid,
  onSelect,
  onHover,
  onHoverEnd,
}: {
  root: DomTreeNode;
  selectedUid: string;
  onSelect: (uid: string) => void;
  onHover: (uid: string) => void;
  onHoverEnd: () => void;
}) {
  // Hover end no container inteiro (sai do tree → limpa preview)
  return (
    <div onMouseLeave={onHoverEnd}>
      <TreeNode
        node={root}
        depth={0}
        selectedUid={selectedUid}
        onSelect={onSelect}
        onHover={onHover}
      />
    </div>
  );
}

function TreeNode({
  node,
  depth,
  selectedUid,
  onSelect,
  onHover,
}: {
  node: DomTreeNode;
  depth: number;
  selectedUid: string;
  onSelect: (uid: string) => void;
  onHover: (uid: string) => void;
}) {
  // Detecta se o selected está dentro de descendentes (auto-expand chain).
  const containsSelected = useMemo(() => {
    const check = (n: DomTreeNode): boolean => {
      if (n.uid === selectedUid) return true;
      for (const c of n.children) if (check(c)) return true;
      return false;
    };
    return check(node);
  }, [node, selectedUid]);

  const [openLocal, setOpenLocal] = useState<boolean | null>(null);
  const isOpen = openLocal !== null ? openLocal : (containsSelected || depth === 0);

  // Quando selected muda e cai dentro deste subtree, força open
  useEffect(() => {
    if (containsSelected) setOpenLocal(true);
  }, [containsSelected]);

  const hasChildren = node.children.length > 0;
  const isSelected = node.uid === selectedUid;
  // Tooltip full identifier (todas classes + id) — pra hover
  const fullLabel = node.tag + (node.id ? '#' + node.id : '') + (node.classes.length ? '.' + node.classes.join('.') : '');

  return (
    <>
      <div
        className={`preview-tree-node ${isSelected ? 'is-active' : ''}`}
        style={{ paddingLeft: `${4 + depth * 12}px` }}
        onClick={() => onSelect(node.uid)}
        onMouseEnter={() => onHover(node.uid)}
        role="button"
        tabIndex={0}
        title={fullLabel}
      >
        {hasChildren ? (
          <i
            className={`codicon codicon-chevron-${isOpen ? 'down' : 'right'} preview-tree-chevron`}
            onClick={(e) => { e.stopPropagation(); setOpenLocal(!isOpen); }}
          />
        ) : (
          <span className="preview-tree-leaf" />
        )}
        {/* Syntax-highlighted label (Cursor/Antigravity pattern) */}
        <span className="preview-tree-label">
          <span className="preview-tree-tag">{node.tag}</span>
          {node.id && (
            <>
              <span className="preview-tree-sym">#</span>
              <span className="preview-tree-id">{node.id}</span>
            </>
          )}
          {node.classes.length > 0 && (
            <>
              <span className="preview-tree-sym">.</span>
              <span className="preview-tree-class">{node.classes[0]}</span>
              {node.classes.length > 1 && (
                <span className="preview-tree-class-more"> · +{node.classes.length - 1}</span>
              )}
            </>
          )}
        </span>
      </div>
      {isOpen && hasChildren && node.children.map((c) => (
        <TreeNode
          key={c.uid}
          node={c}
          depth={depth + 1}
          selectedUid={selectedUid}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
    </>
  );
}

/** Helper: monta transform string a partir das partes */
function buildTransform(parts: {
  tx: string; ty: string; rot: string; flipX: boolean; flipY: boolean;
}): string {
  const out: string[] = [];
  if (parts.tx || parts.ty) {
    const tx = parts.tx || '0';
    const ty = parts.ty || '0';
    out.push(`translate(${tx}, ${ty})`);
  }
  if (parts.rot && parts.rot !== '0' && parts.rot !== '0deg') {
    out.push(`rotate(${parts.rot})`);
  }
  if (parts.flipX) out.push('scaleX(-1)');
  if (parts.flipY) out.push('scaleY(-1)');
  return out.length > 0 ? out.join(' ') : '';
}

/** Input compacto pra X/Y/Z — label + NumberInput inline */
function PositionInput({
  label,
  value,
  onApply,
  hideUnit,
  disabled,
}: {
  label: string;
  value: string;
  onApply: (v: string) => void;
  hideUnit?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`preview-position-input ${disabled ? 'is-disabled' : ''}`}>
      <span className="preview-position-input-label">{label}</span>
      {hideUnit ? (
        <input
          type="text"
          className="preview-position-input-field"
          value={value}
          onChange={(e) => onApply(e.target.value)}
          spellCheck={false}
          disabled={disabled}
        />
      ) : (
        <NumberInput value={value} prop="" onApply={(_, v) => onApply(v)} disabled={disabled} />
      )}
    </div>
  );
}

/**
 * NumberInput — input numérico com dropdown de unidade (px/%/em/rem/vh/vw/auto).
 * Igual Cursor. Parse separa número da unidade, edita independente.
 * Reconstrói value como "Nunit" no commit. Se unit="auto", value="auto".
 */
const UNITS = ['px', '%', 'em', 'rem', 'vh', 'vw', 'auto', 'fr'];
// Unidades pra rotate/angle — só faz sentido deg/rad/turn.
const ANGLE_UNITS = ['deg', 'rad', 'turn'];

/**
 * formatNumber — replica `hu` do Cursor.
 * Number sem trailing zeros. NaN/Infinity → "0".
 */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.parseFloat(n.toFixed(4)).toString();
}

/**
 * applyCss — replica `Fm` do Cursor.
 * Parser robusto de CSS value com:
 *   - allowedKeywords: whitelist (ex: ["auto", "fit-content"]). Match case-insensitive,
 *     aplica com a capitalização original do whitelist.
 *   - allowedUnits: whitelist (ex: ["px", "em", "%"]). Se input tem unit fora dela, rejeita.
 *   - allowNegative: default false. Clampa negativos pra 0.
 *   - allowUnitless: default false. Aplica sem unit se permitido.
 *   - defaultUnit: aplica essa unit quando input sem unit (default "px" ou única allowedUnit).
 *
 * Comportamento:
 *   - vazio/whitespace → aplica "" (limpa property)
 *   - keyword exato → aplica keyword
 *   - "Nunit" parseado → aplica "Nunit" (validado contra allowedUnits)
 *   - número puro → aplica "NdefaultUnit"
 *   - inválido → NOOP
 */
function applyCss(
  apply: (prop: string, val: string) => void,
  prop: string,
  rawValue: string,
  opts?: {
    allowedKeywords?: string[];
    allowedUnits?: string[];
    allowNegative?: boolean;
    allowUnitless?: boolean;
    defaultUnit?: string;
  },
): void {
  const trimmed = rawValue.trim();
  if (!trimmed) { apply(prop, ''); return; }
  const keywords = opts?.allowedKeywords ?? [];
  const lower = trimmed.toLowerCase();
  const matchedKw = keywords.find((k) => k.toLowerCase() === lower);
  if (matchedKw) { apply(prop, matchedKw); return; }
  const m = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*([a-z%]*)$/i);
  if (!m) return;
  let num = parseFloat(m[1]);
  if (Number.isNaN(num)) return;
  if (!opts?.allowNegative && num < 0) num = 0;
  const formatted = formatNumber(num);
  const unit = m[2].toLowerCase();
  const allowed = opts?.allowedUnits?.map((u) => u.toLowerCase());
  if (unit) {
    if (allowed && allowed.length > 0 && !allowed.includes(unit)) return;
    apply(prop, `${formatted}${unit}`);
    return;
  }
  if (opts?.allowUnitless) { apply(prop, formatted); return; }
  const defaultUnit = opts?.defaultUnit ?? (allowed && allowed.length === 1 ? allowed[0] : 'px');
  apply(prop, `${formatted}${defaultUnit}`);
}

/**
 * applyPadding — replica `Pg` do Cursor pra padding.
 * Vazio → "auto". Float válido → "Npx". NaN → NOOP.
 * Não clampa negativo (padding pode ser negativo via custom).
 */
function applyPadding(
  apply: (prop: string, val: string) => void,
  prop: string,
  rawValue: string,
): void {
  if (rawValue === '') { apply(prop, 'auto'); return; }
  const n = parseFloat(rawValue);
  if (Number.isNaN(n)) return;
  apply(prop, `${n}px`);
}

function parseValue(value: string): { num: string; unit: string } {
  if (!value || value === 'auto') return { num: '', unit: 'auto' };
  // Match "12.5px", "100%", "1rem", "1fr"
  const m = String(value).match(/^(-?\d*\.?\d+)([a-z%]*)$/i);
  if (!m) return { num: '', unit: 'px' };
  return { num: m[1], unit: m[2] || 'px' };
}

function NumberInput({
  value,
  prop,
  onApply,
  defaultUnit = 'px',
  disabled,
  units,
}: {
  value: string;
  prop: string;
  onApply: (property: string, value: string) => void;
  defaultUnit?: string;
  disabled?: boolean;
  /** Custom unit set (ex: ANGLE_UNITS pra rotação). Default = UNITS. */
  units?: string[];
}) {
  const unitList = units || UNITS;
  const parsed = parseValue(value);
  const [num, setNum] = useState(parsed.num);
  const [unit, setUnit] = useState(parsed.unit || defaultUnit);

  useEffect(() => {
    const p = parseValue(value);
    setNum(p.num);
    setUnit(p.unit || defaultUnit);
  }, [value, defaultUnit]);

  const commit = (n: string, u: string): void => {
    const next = u === 'auto' ? 'auto' : (n ? n + u : '');
    if (next !== value) onApply(prop, next);
  };

  return (
    <div className="preview-num-input">
      <input
        type="text"
        className="preview-num-input-field"
        value={num}
        onChange={(e) => setNum(e.target.value)}
        onBlur={() => commit(num, unit)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const next = String((parseFloat(num) || 0) + (e.shiftKey ? 10 : 1));
            setNum(next);
            commit(next, unit);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = String((parseFloat(num) || 0) - (e.shiftKey ? 10 : 1));
            setNum(next);
            commit(next, unit);
          }
        }}
        spellCheck={false}
        disabled={disabled || unit === 'auto'}
        placeholder={disabled ? 'auto' : ''}
      />
      <select
        className="preview-num-input-unit"
        value={unit}
        onChange={(e) => {
          const u = e.target.value;
          setUnit(u);
          commit(num, u);
        }}
        disabled={disabled}
      >
        {unitList.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
    </div>
  );
}

/**
 * DraggableLabel — label clicável que vira "drag handle" pra ajustar
 * numericamente o valor associado. Espelha Cursor (css-input-label-draggable):
 * cursor vira "ew-resize", arrastar horizontal incrementa/decrementa.
 *
 * Detecta o número atual no value e drag deltas:
 *  - 1px = 1 unit (default)
 *  - Shift = 10x
 *  - Alt = 0.1x (precisão)
 */
function DraggableLabel({
  label,
  prop,
  value,
  onApply,
  step = 1,
}: {
  label: string;
  prop: string;
  value: string;
  onApply: (property: string, value: string) => void;
  step?: number;
}) {
  const dragState = useRef<{
    startX: number;
    startVal: number;
    unit: string;
  } | null>(null);

  const onMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault();
    // Parse valor numérico + unit
    const m = (value || '').match(/^(-?\d*\.?\d+)([a-z%]*)$/i);
    if (!m) return;
    dragState.current = {
      startX: e.clientX,
      startVal: parseFloat(m[1]) || 0,
      unit: m[2] || 'px',
    };
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    // CRÍTICO: <webview> do Electron captura todos os pointer events do seu
    // retangulo. Sem essa classe (que renderiza overlay fixed via CSS), o drag
    // trava assim que o cursor entra na area do webview do preview.
    document.body.classList.add('is-dragging-value');

    const onMove = (ev: MouseEvent): void => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const multiplier = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const delta = dx * step * multiplier;
      const next = Math.round((dragState.current.startVal + delta) * 100) / 100;
      onApply(prop, next + dragState.current.unit);
    };
    const onUp = (): void => {
      dragState.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.classList.remove('is-dragging-value');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <span
      className="preview-design-row-label preview-draggable-label"
      onMouseDown={onMouseDown}
      title={`Arraste pra ajustar (Shift = 10x, Alt = 0.1x)`}
    >
      {label}
    </span>
  );
}

/**
 * EditRow — input controlado pra cada CSS property.
 * Dispara onApply em blur ou Enter — sem debounce porque cada keystroke
 * faria muitos re-renders. User vê a mudança ao sair do input.
 */
function EditRow({
  label,
  prop,
  value,
  onApply,
  swatch,
  truncate,
}: {
  label: string;
  prop: string;
  value: string;
  onApply: (property: string, value: string) => void;
  swatch?: boolean;
  truncate?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  // Sync draft com value quando elemento muda (selected) ou após apply
  // (element-updated traz computed value novo).
  useEffect(() => { setDraft(value); }, [value]);

  const commit = (): void => {
    if (draft !== value) onApply(prop, draft);
  };

  const isColor = swatch && /^(rgb|rgba|#)/.test(value);

  return (
    <div className="preview-design-row preview-design-row-edit">
      <span className="preview-design-row-label">{label}</span>
      <div className={`preview-design-row-input-wrap ${truncate ? 'is-truncate' : ''}`}>
        {isColor && <span className="preview-design-swatch" style={{ background: value }} />}
        <input
          type="text"
          className="preview-design-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              setDraft(value); // revert
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          spellCheck={false}
          autoCorrect="off"
        />
      </div>
    </div>
  );
}

/**
 * ColorRow — input de cor com swatch clicável, hex input editável, opacity %,
 * e native color picker no swatch. Espelha Cursor's FillSection.
 *
 * Parse rgb/rgba/hex → hex#RRGGBB + alpha 0-100. Re-monta como rgba() ao
 * commitar. Permite picking visual via input type="color".
 */
/**
 * Detecta se value é um TOKEN (var(--xxx) ou Tailwind-style bg-[#xxx]) em
 * vez de cor literal. Tokens mostram como chip com nome + unlink button
 * (espelha Cursor css-color-token-button + css-color-token-unlink).
 */
function detectColorToken(value: string): { isToken: boolean; tokenName?: string; resolvedColor?: string } {
  if (!value) return { isToken: false };
  // var(--xxx) ou var(--xxx, fallback)
  const varM = value.match(/^var\((--[^,)]+)(?:,\s*([^)]+))?\)$/);
  if (varM) {
    return { isToken: true, tokenName: varM[1], resolvedColor: varM[2]?.trim() };
  }
  // Tailwind arbitrary value: bg-[#xxxxxx] (já resolvido a hex normalmente, mas mantém)
  const twM = value.match(/^(?:bg|text|border)-\[(#[0-9a-f]{3,8}|rgb[a]?\([^)]+\))\]$/i);
  if (twM) {
    return { isToken: true, tokenName: value, resolvedColor: twM[1] };
  }
  return { isToken: false };
}

function ColorRow({
  label,
  prop,
  value,
  onApply,
}: {
  label: string;
  prop: string;
  value: string;
  onApply: (property: string, value: string) => void;
}) {
  // Token detection — se for var() ou Tailwind, mostra chip diferenciado
  const tokenInfo = detectColorToken(value);
  if (tokenInfo.isToken) {
    return (
      <div className="preview-design-row preview-design-row-edit">
        <span className="preview-design-row-label">{label}</span>
        <div className="preview-color-token-input">
          <span
            className="preview-color-swatch"
            style={{ background: tokenInfo.resolvedColor || '#888' }}
          />
          <span className="preview-color-token-name" title={value}>
            {tokenInfo.tokenName}
          </span>
          <button
            type="button"
            className="preview-color-token-unlink"
            title="Convert to literal value"
            onClick={() => onApply(prop, tokenInfo.resolvedColor || '#000000')}
          >
            <i className="codicon codicon-link" />
          </button>
        </div>
      </div>
    );
  }
  // Fallback: ColorRow normal (sem token)
  return <ColorRowLiteral label={label} prop={prop} value={value} onApply={onApply} />;
}

function ColorRowLiteral({
  label,
  prop,
  value,
  onApply,
}: {
  label: string;
  prop: string;
  value: string;
  onApply: (property: string, value: string) => void;
}) {
  const parseColor = (v: string): { hex: string; alpha: number } => {
    if (!v) return { hex: '#000000', alpha: 100 };
    // hex já formatado
    const hexM = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
    if (hexM) {
      const a = hexM[2] ? parseInt(hexM[2], 16) / 255 : 1;
      return { hex: '#' + hexM[1].toLowerCase(), alpha: Math.round(a * 100) };
    }
    // rgb/rgba
    const rgbM = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d*\.?\d+))?\s*\)/);
    if (rgbM) {
      const r = parseInt(rgbM[1], 10).toString(16).padStart(2, '0');
      const g = parseInt(rgbM[2], 10).toString(16).padStart(2, '0');
      const b = parseInt(rgbM[3], 10).toString(16).padStart(2, '0');
      const a = rgbM[4] !== undefined ? parseFloat(rgbM[4]) : 1;
      return { hex: '#' + r + g + b, alpha: Math.round(a * 100) };
    }
    return { hex: '#000000', alpha: 100 };
  };

  const buildColor = (hex: string, alpha: number): string => {
    if (alpha >= 100) return hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${(alpha / 100).toFixed(2)})`;
  };

  const parsed = parseColor(value);
  const [hex, setHex] = useState(parsed.hex);
  const [alpha, setAlpha] = useState(parsed.alpha);

  useEffect(() => {
    const p = parseColor(value);
    setHex(p.hex);
    setAlpha(p.alpha);
  }, [value]);

  const commit = (h: string, a: number): void => {
    const next = buildColor(h, a);
    if (next !== value) onApply(prop, next);
  };

  return (
    <div className="preview-design-row preview-design-row-edit">
      <span className="preview-design-row-label">{label}</span>
      <div className="preview-color-input">
        {/* Native color picker — escondido atrás do swatch */}
        <input
          type="color"
          className="preview-color-native"
          value={hex}
          onChange={(e) => {
            setHex(e.target.value);
            commit(e.target.value, alpha);
          }}
        />
        <span
          className="preview-color-swatch"
          style={{ background: value || hex }}
          title="Clique pra abrir color picker"
        />
        <input
          type="text"
          className="preview-color-hex"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          onBlur={() => commit(hex, alpha)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          spellCheck={false}
        />
        <input
          type="text"
          className="preview-color-alpha"
          value={alpha + '%'}
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/[^\d]/g, ''), 10);
            if (!isNaN(n)) setAlpha(Math.min(100, Math.max(0, n)));
          }}
          onBlur={() => commit(hex, alpha)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

/**
 * LayoutExtras — controles que aparecem APÓS escolher um Flow mode.
 *
 * - Freeform/Row/Column (flex): grid 3x3 de alignment (justify × align) + Gap input
 * - Grid: GridColumns × GridRows picker + Column gap + Row gap
 *
 * Replica jG0 (flex extras) e KG0 (grid extras) do Cursor.
 */
function LayoutExtras({
  element,
  onApply,
}: {
  element: InspectedElement;
  onApply: (property: string, value: string) => void;
}) {
  const display = element.designProps.display;
  const flexDir = element.designProps.flexDirection;
  const flexWrap = element.allStyles['flex-wrap'] || 'nowrap';
  const mode = deriveLayoutMode(display, flexDir, flexWrap);
  // Cursor só mostra extras pra row/column/grid. Wrap (Freeform) não tem.
  if (mode === 'grid') {
    return <GridExtras element={element} onApply={onApply} />;
  }
  if (mode === 'row' || mode === 'column') {
    return <FlexExtras element={element} flexDirection={flexDir} onApply={onApply} />;
  }
  return null;
}

/**
 * FlexExtras — Grid 3x3 (justify × align) + Gap input.
 * Replica jG0. Arrays do Cursor:
 *   k4p = ["flex-start", "center", "flex-end"]  (justify-content)
 *   O3n = ["flex-start", "center", "flex-end"]  (align-items)
 *
 * No grid 3x3: linhas = align-items (top/middle/bottom),
 *              colunas = justify-content (left/center/right).
 * Visualmente o layout do grid depende do flex-direction:
 *   - row: cada cell representa (justify=col, align=row)
 *   - column: cada cell representa (justify=row, align=col)
 *
 * Pra simplicidade, sempre mostramos a grid no orientation row.
 *
 * Gap input com modo "auto" — quando auto, aplica `justify-content: space-between`.
 */
function FlexExtras({
  element,
  flexDirection,
  onApply,
}: {
  element: InspectedElement;
  flexDirection: string;
  onApply: (property: string, value: string) => void;
}) {
  const JUSTIFY = ['flex-start', 'center', 'flex-end'] as const;
  const ALIGN = ['flex-start', 'center', 'flex-end'] as const;
  const justify = element.allStyles['justify-content'] || 'flex-start';
  const align = element.allStyles['align-items'] || 'flex-start';
  const gapRaw = element.allStyles['gap'] || '0';
  const isColumn = flexDirection.includes('column');
  const isAutoGap = justify === 'space-between';

  const justifyIdx = JUSTIFY.indexOf(justify as typeof JUSTIFY[number]);
  const alignIdx = ALIGN.indexOf(align as typeof ALIGN[number]);

  // Replica `R(ie, te)` exato do Cursor (jG0). 3 branches:
  //   isAutoGap (justify=space-between): SÓ aplica align-items, NÃO toca
  //     justify-content (preserva space-between). Eixo do align depende de y()
  //     (true = row, mostra ALIGN[ie]; false = column, mostra ALIGN[te]).
  //   else: aplica AMBOS — justify-content[ie] + align-items[te].
  //
  // ie = linha 0/1/2 do grid (representa justify quando NÃO autoGap)
  // te = coluna 0/1/2 do grid (representa align)
  const isRow = !isColumn; // y() do Cursor
  const onCellClick = (col: number, row: number): void => {
    if (isAutoGap) {
      // Cursor: v() && (y() ? n.onAlignItemsChange(O3n[ie]) : n.onAlignItemsChange(O3n[te]))
      onApply('align-items', isRow ? ALIGN[row] : ALIGN[col]);
      return;
    }
    onApply('justify-content', JUSTIFY[row]);
    onApply('align-items', ALIGN[col]);
  };

  // L: se autoGap NÃO ativa cells por justify (só compara align)
  const isCellActive = (col: number, row: number): boolean => {
    if (isAutoGap) {
      // Só compara align, ignora justify (que é space-between)
      const targetAlign = isRow ? ALIGN[row] : ALIGN[col];
      return align === targetAlign;
    }
    return justifyIdx === row && alignIdx === col;
  };

  const gapNum = parseFloat(gapRaw) || 0;

  // Ícones de align por col (Qpw do Cursor): col 0=left, 1=center, 2=right.
  // No template, cada cell mostra DOT por default e ÍCONE quando active.
  // O codicon usado é symbol-method (proxy de Qpw — Cursor usa codicons proprietários).
  const alignIcons = ['codicon-arrow-left', 'codicon-symbol-method', 'codicon-arrow-right'];

  return (
    <div className="css-alignment-gap-row">
      <div className="css-alignment-control">
        <div className="css-control-label">Alignment</div>
        <div
          className="css-alignment-grid"
          aria-label="Justify & Align"
          data-space-between={isAutoGap ? 'true' : undefined}
        >
          {/* 9 cells FLAT dentro de css-alignment-grid (matching Cursor template
              que renderiza via pa loop sem wrappers de row). Layout 3×3 vem do
              CSS grid no .css-alignment-grid. */}
          {[0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => {
            const active = isCellActive(col, row);
            const labelText = isAutoGap
              ? `align-items: ${ALIGN[isRow ? row : col]}`
              : `justify-content: ${JUSTIFY[row]}, align-items: ${ALIGN[col]}`;
            return (
              <button
                key={`${row}-${col}`}
                type="button"
                className={`css-alignment-grid-cell ${active ? 'active' : ''}`}
                aria-pressed={active}
                onClick={() => onCellClick(col, row)}
                aria-label={labelText}
              >
                {active ? (
                  <i className={`codicon ${alignIcons[col]} css-alignment-grid-icon`} />
                ) : (
                  <span className="css-alignment-grid-dot" />
                )}
              </button>
            );
          }))}
        </div>
      </div>
      <div className="css-gap-control">
        <div className="css-control-label">Gap</div>
        <div className={`css-input-group ${isAutoGap ? 'is-auto' : ''}`}>
          <ScrubLabel
            getValue={() => Math.round(gapNum)}
            onChange={(v) => {
              if (isAutoGap) onApply('justify-content', 'flex-start');
              onApply('gap', `${Math.max(0, Math.round(v))}px`);
            }}
            min={0}
            ariaLabel={isAutoGap ? 'Gap (auto = space-between)' : 'Gap'}
          >
            <i className="codicon codicon-symbol-numeric" />
          </ScrubLabel>
          <div className="css-input-field">
            <input
              type="text"
              className={`css-number-input ${isAutoGap ? 'css-number-input--mode-token' : ''}`}
              inputMode="numeric"
              aria-label={isAutoGap ? 'Gap (auto = space-between)' : 'Gap'}
              value={isAutoGap ? 'auto' : Math.round(gapNum)}
              onChange={(e) => {
                const v = e.currentTarget.value.trim().toLowerCase();
                if (v === 'auto') {
                  // Cursor aplica gap: "auto" LITERAL + justify space-between
                  // (não "0px" — preserva o keyword no inline style).
                  onApply('gap', 'auto');
                  onApply('justify-content', 'space-between');
                  return;
                }
                const n = parseFloat(v);
                if (!Number.isNaN(n) && n >= 0) {
                  if (isAutoGap) onApply('justify-content', 'flex-start');
                  onApply('gap', `${Math.round(n)}px`);
                }
              }}
              spellCheck={false}
            />
            <span className="css-input-suffix">px</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * GridExtras — replica KG0: trigger button GridCols×Rows + col/row gap.
 * Click no button abre menu picker (igual Excel "table picker": hover sobre cells).
 */
function GridExtras({
  element,
  onApply,
}: {
  element: InspectedElement;
  onApply: (property: string, value: string) => void;
}) {
  const gridCols = element.allStyles['grid-template-columns'] || '';
  const gridRows = element.allStyles['grid-template-rows'] || '';
  // Conta colunas/linhas via split (cada valor é uma track).
  const colCount = gridCols && gridCols !== 'none' ? gridCols.split(/\s+/).filter(Boolean).length : 1;
  const rowCount = gridRows && gridRows !== 'none' ? gridRows.split(/\s+/).filter(Boolean).length : 1;
  const colGap = parseFloat(element.allStyles['column-gap'] || '0') || 0;
  const rowGap = parseFloat(element.allStyles['row-gap'] || '0') || 0;

  const [menuOpen, setMenuOpen] = useState(false);
  const [hoverPos, setHoverPos] = useState<{ col: number; row: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  // Preserva tracks customizados quando user só muda count.
  // Ex: "1fr 200px 1fr" + setGrid(4, _) → "1fr 200px 1fr 1fr" (adiciona 1fr).
  // Ex: "1fr 200px 1fr" + setGrid(2, _) → "1fr 200px" (corta do fim).
  // Se tracks era `repeat(N, 1fr)` original → mantém repeat (vira `repeat(M, 1fr)`).
  const resizeTracks = (current: string, newCount: number): string => {
    const trimmed = (current || '').trim();
    if (!trimmed || trimmed === 'none') return `repeat(${newCount}, 1fr)`;
    // Caso repeat() puro — mantém o pattern
    const repeatMatch = trimmed.match(/^repeat\(\s*\d+\s*,\s*(.+?)\s*\)$/);
    if (repeatMatch) return `repeat(${newCount}, ${repeatMatch[1]})`;
    // Caso lista explícita — adicionar/cortar do fim
    const tracks = trimmed.split(/\s+(?![^()]*\))/).filter(Boolean);
    if (tracks.length === newCount) return current; // já bate, no-op
    if (tracks.length < newCount) {
      // Adiciona 1fr no fim até atingir count
      const filler = Array.from({ length: newCount - tracks.length }, () => '1fr');
      return [...tracks, ...filler].join(' ');
    }
    // Corta do fim
    return tracks.slice(0, newCount).join(' ');
  };
  const setGrid = (cols: number, rows: number): void => {
    onApply('grid-template-columns', resizeTracks(gridCols, cols));
    onApply('grid-template-rows', resizeTracks(gridRows, rows));
    setMenuOpen(false);
  };

  // Constantes EXATAS do Cursor (Xpw, Zpw):
  // 11 colunas × 8 linhas no picker visual.
  const MAX_C = 11;
  const MAX_R = 8;

  return (
    <div className="css-alignment-gap-row">
      <div className="css-alignment-control">
        <div className="css-control-label">Grid</div>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="css-grid-dimensions-trigger"
            onClick={() => setMenuOpen((p) => !p)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Grid dimensions"
          >
            <span className="css-grid-dimensions-label">{colCount} × {rowCount}</span>
          </button>
          {menuOpen && (
            <div ref={menuRef} className="css-grid-picker-menu">
              <div className="css-grid-picker-content">
                <div className="css-grid-picker-header">
                  <div className="css-control-label">Dimensions</div>
                  <div className="css-grid-picker-inputs">
                    <div className="css-grid-picker-input-group">
                      <ScrubLabel
                        getValue={() => colCount}
                        onChange={(v) => setGrid(Math.max(1, Math.round(v)), rowCount)}
                        min={1}
                        ariaLabel="Columns"
                      >C</ScrubLabel>
                      <input
                        className="css-grid-picker-input"
                        type="number"
                        min={1}
                        value={hoverPos?.col ?? colCount}
                        onChange={(e) => {
                          const n = parseInt(e.currentTarget.value, 10);
                          if (!Number.isNaN(n) && n >= 1) setGrid(n, rowCount);
                        }}
                      />
                    </div>
                    <span className="css-grid-picker-separator">×</span>
                    <div className="css-grid-picker-input-group">
                      <ScrubLabel
                        getValue={() => rowCount}
                        onChange={(v) => setGrid(colCount, Math.max(1, Math.round(v)))}
                        min={1}
                        ariaLabel="Rows"
                      >R</ScrubLabel>
                      <input
                        className="css-grid-picker-input"
                        type="number"
                        min={1}
                        value={hoverPos?.row ?? rowCount}
                        onChange={(e) => {
                          const n = parseInt(e.currentTarget.value, 10);
                          if (!Number.isNaN(n) && n >= 1) setGrid(colCount, n);
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div
                  className="css-grid-picker-grid"
                  onMouseLeave={() => setHoverPos(null)}
                >
                  {/* 88 cells FLAT (11×8). CSS grid no .css-grid-picker-grid
                      determina layout 2D. Matching template xpw do Cursor. */}
                  {Array.from({ length: MAX_R * MAX_C }, (_, idx) => {
                    const r = Math.floor(idx / MAX_C);
                    const c = idx % MAX_C;
                    const selC = hoverPos?.col ?? colCount;
                    const selR = hoverPos?.row ?? rowCount;
                    const isOn = c + 1 <= selC && r + 1 <= selR;
                    return (
                      <button
                        key={`${r}-${c}`}
                        type="button"
                        className="css-grid-picker-cell"
                        data-selected={isOn ? 'true' : undefined}
                        aria-label={`${c + 1} × ${r + 1}`}
                        onClick={() => setGrid(c + 1, r + 1)}
                        onMouseEnter={() => setHoverPos({ col: c + 1, row: r + 1 })}
                      />
                    );
                  })}
                  {/* Tooltip Ipw do Cursor: `<div class=css-grid-picker-tooltip> × `.
                      Posição absoluta calculada via (col-0.5)*20px, row*20+4px. */}
                  {hoverPos && (
                    <div
                      className="css-grid-picker-tooltip"
                      style={{
                        left: `${(hoverPos.col - 0.5) * 20}px`,
                        top: `${hoverPos.row * 20 + 4}px`,
                      }}
                    >
                      {hoverPos.col} × {hoverPos.row}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="css-gap-control">
        <div className="css-control-label">Gap</div>
        <div className="css-grid-gap-inputs">
          <div className="css-input-group">
            <ScrubLabel
              getValue={() => Math.round(colGap)}
              onChange={(v) => onApply('column-gap', `${Math.max(0, Math.round(v))}px`)}
              min={0}
              ariaLabel="Column gap"
              title="Column gap"
              className="css-gap-label-icon"
            >
              <i className="codicon codicon-arrow-both" />
            </ScrubLabel>
            <div className="css-input-field">
              <input
                type="text"
                inputMode="numeric"
                className="css-number-input"
                value={Math.round(colGap)}
                onChange={(e) => {
                  const n = parseFloat(e.currentTarget.value);
                  if (!Number.isNaN(n) && n >= 0) onApply('column-gap', `${Math.round(n)}px`);
                }}
              />
              <span className="css-input-suffix">px</span>
            </div>
          </div>
          <div className="css-input-group">
            <ScrubLabel
              getValue={() => Math.round(rowGap)}
              onChange={(v) => onApply('row-gap', `${Math.max(0, Math.round(v))}px`)}
              min={0}
              ariaLabel="Row gap"
              title="Row gap"
              className="css-gap-label-icon css-gap-label-icon--row"
            >
              <i className="codicon codicon-arrow-both" style={{ transform: 'rotate(90deg)' }} />
            </ScrubLabel>
            <div className="css-input-field">
              <input
                type="text"
                inputMode="numeric"
                className="css-number-input"
                value={Math.round(rowGap)}
                onChange={(e) => {
                  const n = parseFloat(e.currentTarget.value);
                  if (!Number.isNaN(n) && n >= 0) onApply('row-gap', `${Math.round(n)}px`);
                }}
              />
              <span className="css-input-suffix">px</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * LayoutFlowButtons — replica `hpw` + `Ca` (onLayoutModeChange) do Cursor.
 *
 * Modos (ordem do array hpw):
 *   1. Freeform (wrap)  → display:flex + flex-direction:row + flex-wrap:wrap
 *   2. Column           → display:flex + flex-direction:column + flex-wrap:nowrap
 *   3. Row              → display:flex + flex-direction:row    + flex-wrap:nowrap
 *   4. Grid             → display:grid
 *
 * Cursor NÃO inclui "block" como modo selecionável — assume flex/grid pra
 * layouts não-trivial. Block fica como "estado nulo" (nenhum botão ativo).
 *
 * Derivação do modo atual (replica deriveLayoutMode):
 *   grid    se display === 'grid'
 *   wrap    se display contém 'flex' E flex-wrap === 'wrap'
 *   row     se display contém 'flex' E (flex-direction omitido ou 'row')
 *   column  se display contém 'flex' E flex-direction === 'column'
 *   null    senão (display: block/inline/etc — nenhum botão ativo)
 */
type LayoutMode = 'wrap' | 'row' | 'column' | 'grid';

function deriveLayoutMode(display: string, flexDirection: string, flexWrap: string): LayoutMode | null {
  if (display === 'grid' || display === 'inline-grid') return 'grid';
  if (display === 'flex' || display === 'inline-flex') {
    if (flexWrap === 'wrap' || flexWrap === 'wrap-reverse') return 'wrap';
    return flexDirection.includes('column') ? 'column' : 'row';
  }
  return null;
}

function LayoutFlowButtons({
  display,
  flexDirection,
  flexWrap,
  onApply,
}: {
  display: string;
  flexDirection: string;
  flexWrap: string;
  onApply: (property: string, value: string) => void;
}) {
  const current = deriveLayoutMode(display, flexDirection, flexWrap);

  // `Ca` do Cursor — set CSS properties pra cada mode.
  const setMode = (mode: LayoutMode): void => {
    switch (mode) {
      case 'wrap':
        onApply('display', 'flex');
        onApply('flex-direction', 'row');
        onApply('flex-wrap', 'wrap');
        break;
      case 'row':
        onApply('display', 'flex');
        onApply('flex-direction', 'row');
        onApply('flex-wrap', 'nowrap');
        break;
      case 'column':
        onApply('display', 'flex');
        onApply('flex-direction', 'column');
        onApply('flex-wrap', 'nowrap');
        break;
      case 'grid':
        onApply('display', 'grid');
        break;
    }
  };

  // SVGs minimalistas representando cada layout (igual ícones do Cursor).
  const options: Array<{ mode: LayoutMode; label: string; svg: ReactNode }> = [
    {
      mode: 'wrap',
      label: 'Freeform',
      svg: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="4.5" height="4.5" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
          <rect x="9.5" y="2" width="4.5" height="4.5" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
          <rect x="2" y="9.5" width="4.5" height="4.5" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      ),
    },
    {
      mode: 'column',
      label: 'Column',
      svg: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="4" y="2" width="8" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
          <rect x="4" y="6.5" width="8" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
          <rect x="4" y="11" width="8" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      ),
    },
    {
      mode: 'row',
      label: 'Row',
      svg: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="4" width="3" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
          <rect x="6.5" y="4" width="3" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
          <rect x="11" y="4" width="3" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      ),
    },
    {
      mode: 'grid',
      label: 'Grid',
      svg: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
          <rect x="9" y="2" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
          <rect x="2" y="9" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
          <rect x="9" y="9" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      ),
    },
  ];

  return (
    <div className="css-flow-grid">
      {options.map((opt) => (
        <button
          key={opt.mode}
          type="button"
          className={`css-flow-option ${current === opt.mode ? 'active' : ''}`}
          aria-pressed={current === opt.mode}
          aria-label={opt.label}
          onClick={() => setMode(opt.mode)}
          title={opt.label}
        >
          <span className="css-flow-icon">{opt.svg}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * NumberRow — variant de EditRow que usa NumberInput em vez de input texto.
 * Pra propriedades dimensionais (width, height, font-size, padding, etc).
 */
function NumberRow({
  label,
  prop,
  value,
  onApply,
  defaultUnit,
}: {
  label: string;
  prop: string;
  value: string;
  onApply: (property: string, value: string) => void;
  defaultUnit?: string;
}) {
  return (
    <div className="preview-design-row preview-design-row-edit">
      <DraggableLabel label={label} prop={prop} value={value} onApply={onApply} />
      <div className="preview-design-row-input-wrap">
        <NumberInput value={value} prop={prop} onApply={onApply} defaultUnit={defaultUnit} />
      </div>
    </div>
  );
}

/**
 * SideIcon — SVG inline mostrando qual lado do quadrado é controlado.
 * Tipos: 'top', 'right', 'bottom', 'left', 'vertical' (top+bottom), 'horizontal' (left+right).
 */
function SideIcon({ side }: { side: 'top' | 'right' | 'bottom' | 'left' | 'vertical' | 'horizontal' }) {
  const base = 'stroke="currentColor" stroke-width="1" fill="none"';
  // Square outline base
  const square = <rect x="3.5" y="3.5" width="9" height="9" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" fill="none" />;
  const accent = (props: { x1: number; y1: number; x2: number; y2: number }) => (
    <line x1={props.x1} y1={props.y1} x2={props.x2} y2={props.y2} stroke="currentColor" strokeWidth="1.5" />
  );
  let highlight: React.ReactNode = null;
  switch (side) {
    case 'top':    highlight = accent({ x1: 3.5, y1: 3.5, x2: 12.5, y2: 3.5 }); break;
    case 'right':  highlight = accent({ x1: 12.5, y1: 3.5, x2: 12.5, y2: 12.5 }); break;
    case 'bottom': highlight = accent({ x1: 3.5, y1: 12.5, x2: 12.5, y2: 12.5 }); break;
    case 'left':   highlight = accent({ x1: 3.5, y1: 3.5, x2: 3.5, y2: 12.5 }); break;
    case 'vertical':
      highlight = <>
        {accent({ x1: 3.5, y1: 3.5, x2: 12.5, y2: 3.5 })}
        {accent({ x1: 3.5, y1: 12.5, x2: 12.5, y2: 12.5 })}
      </>;
      break;
    case 'horizontal':
      highlight = <>
        {accent({ x1: 3.5, y1: 3.5, x2: 3.5, y2: 12.5 })}
        {accent({ x1: 12.5, y1: 3.5, x2: 12.5, y2: 12.5 })}
      </>;
      break;
  }
  void base;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      {square}
      {highlight}
    </svg>
  );
}

/**
 * PaddingEditor — réplica 1:1 do Cursor (YG0 padding controls).
 *
 * Estado:
 *   `expanded` = false (default) → mostra 2-input symmetric (vertical, horizontal)
 *   `expanded` = true → mostra 4-input grid (top, right, bottom, left)
 *
 * Toggle button:
 *   - SEM auto-detect (Cursor SEMPRE começa em 2-input, user controla via click)
 *   - Tooltip dinâmico: "Edit sides" no 2-input, "Edit vertical/horizontal" no 4-input
 *
 * 2-input mode:
 *   - Input vertical mostra valor de padding-top. onChange → aplica em top E bottom
 *     (`onLinkedPaddingChange("vertical", v)`)
 *   - Input horizontal mostra valor de padding-left. onChange → aplica em left E right
 *   - `data-mismatch`: marca se top !== bottom (ou left !== right) — sinaliza visualmente
 *     que mudar isso vai sobrescrever um lado assimétrico
 *
 * 4-input mode:
 *   - Cada lado independente (top/right/bottom/left, ordem do array Hpw do Cursor)
 *   - onChange → onPaddingChange(side, value)
 *
 * Helpers ScrubLabel em todos labels (drag horizontal pra ajustar).
 */

/**
 * PxDraftInput — input numérico com draft local + commit on blur/Enter.
 *
 * Mesmo pattern do Border weight (linha ~6387) e UnitInput (linha ~5061):
 * controlled input bound direto ao prop quebra Backspace porque parseFloat('')
 * = NaN, guard skip, React re-render com value antigo → backspace "não responde".
 *
 * Solução: draft local controla o text. onCommit é chamado em blur OU Enter.
 * Sync externa → interna acontece só quando input não está focused.
 *
 * `acceptAuto`: aceita keyword "auto" (margin). Padding não usa.
 * `min`: clamp inferior (padding clamp 0, margin sem clamp).
 */
function PxDraftInput({
  numValue,
  isAuto,
  acceptAuto,
  min,
  onCommit,
  ariaLabel,
  className,
}: {
  numValue: number;
  isAuto?: boolean;
  acceptAuto?: boolean;
  min?: number;
  onCommit: (rawValue: string) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const display = isAuto ? 'auto' : String(Math.round(numValue));
  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(display);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display, focused]);
  const commit = (): void => {
    const v = draft.trim();
    if (v === '') { setDraft(display); return; }
    if (acceptAuto && v.toLowerCase() === 'auto') { onCommit('auto'); return; }
    const n = parseFloat(v);
    if (Number.isNaN(n)) { setDraft(display); return; }
    const clamped = typeof min === 'number' ? Math.max(min, n) : n;
    onCommit(String(Math.round(clamped)));
  };
  return (
    <input
      type="text"
      inputMode={acceptAuto ? 'text' : 'numeric'}
      pattern={acceptAuto ? undefined : '[0-9]*'}
      className={className || 'css-number-input'}
      aria-label={ariaLabel}
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        if (e.key === 'Escape') { setDraft(display); (e.currentTarget as HTMLInputElement).blur(); }
      }}
    />
  );
}

function PaddingEditor({
  top,
  right,
  bottom,
  left,
  onApply,
}: {
  top: string;
  right: string;
  bottom: string;
  left: string;
  onApply: (property: string, value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const parsePx = (v: string): number => {
    const m = (v || '').match(/^(-?\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  };
  const t = parsePx(top), r = parsePx(right), b = parsePx(bottom), l = parsePx(left);
  const verticalMismatch = t !== b;
  const horizontalMismatch = l !== r;

  const applyVertical = (v: string): void => {
    onApply('padding-top', v);
    onApply('padding-bottom', v);
  };
  const applyHorizontal = (v: string): void => {
    onApply('padding-left', v);
    onApply('padding-right', v);
  };
  const applyPx = (prop: string, n: number): void => {
    onApply(prop, `${Math.max(0, Math.round(n))}px`);
  };

  return (
    <div className="css-padding-controls">
      <div className="css-padding-header">
        <div className="css-control-label">Padding</div>
        <button
          type="button"
          className={`css-padding-mode-toggle ${expanded ? 'active' : ''}`}
          aria-pressed={expanded}
          onClick={() => setExpanded((p) => !p)}
          title={expanded ? 'Edit vertical/horizontal' : 'Edit sides'}
          aria-label={expanded ? 'Edit vertical/horizontal' : 'Edit sides'}
        >
          {/* PA Layout #198 P1-2: trocado codicon-symbol-namespace ({}) por
           * codicon-empty-window — rectangle outline representando 4 sides do box. */}
          <i className="codicon codicon-empty-window" />
        </button>
      </div>
      {expanded ? (
        <div className="css-padding-grid">
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => {
            const val = side === 'top' ? t : side === 'right' ? r : side === 'bottom' ? b : l;
            return (
              <div key={side} className="css-input-group" aria-label={`Padding ${side}`}>
                <ScrubLabel
                  getValue={() => Math.round(val)}
                  onChange={(v) => applyPx(`padding-${side}`, v)}
                  min={0}
                  ariaLabel={`Padding ${side}`}
                  className="css-padding-label-icon"
                >
                  {/* PA #203: trocado codicon-arrow-X por BoxSideIcon — square com 1 lado bold. */}
                  <BoxSideIcon side={side} />
                </ScrubLabel>
                <div className="css-input-field">
                  <PxDraftInput
                    numValue={val}
                    min={0}
                    ariaLabel={`Padding ${side}`}
                    onCommit={(raw) => applyPx(`padding-${side}`, parseFloat(raw))}
                  />
                  <span className="css-input-suffix">px</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="css-padding-axis-row">
          {/* Vertical — top+bottom linked */}
          <div
            className="css-input-group"
            data-mismatch={verticalMismatch ? 'true' : undefined}
            title={verticalMismatch ? `Padding top ${t}px · bottom ${b}px` : 'Padding top and bottom'}
          >
            <ScrubLabel
              getValue={() => Math.round(t)}
              onChange={(v) => applyVertical(`${Math.max(0, Math.round(v))}px`)}
              min={0}
              ariaLabel="Padding top and bottom"
              className="css-padding-label-icon"
            >
              {/* PA #203: BoxSideIcon vertical (top+bottom bold) — consistente com expanded. */}
              <BoxSideIcon side="vertical" />
            </ScrubLabel>
            <div className="css-input-field">
              <PxDraftInput
                numValue={t}
                min={0}
                ariaLabel="Padding top and bottom"
                onCommit={(raw) => applyVertical(`${Math.max(0, Math.round(parseFloat(raw)))}px`)}
              />
              <span className="css-input-suffix">px</span>
            </div>
          </div>
          {/* Horizontal — left+right linked */}
          <div
            className="css-input-group"
            data-mismatch={horizontalMismatch ? 'true' : undefined}
            title={horizontalMismatch ? `Padding left ${l}px · right ${r}px` : 'Padding left and right'}
          >
            <ScrubLabel
              getValue={() => Math.round(l)}
              onChange={(v) => applyHorizontal(`${Math.max(0, Math.round(v))}px`)}
              min={0}
              ariaLabel="Padding left and right"
              className="css-padding-label-icon"
            >
              {/* PA #203: BoxSideIcon horizontal (left+right bold) — consistente com expanded. */}
              <BoxSideIcon side="horizontal" />
            </ScrubLabel>
            <div className="css-input-field">
              <PxDraftInput
                numValue={l}
                min={0}
                ariaLabel="Padding left and right"
                onCommit={(raw) => applyHorizontal(`${Math.max(0, Math.round(parseFloat(raw)))}px`)}
              />
              <span className="css-input-suffix">px</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * TypographySection — réplica 1:1 do Cursor (template Vfw).
 *
 * Estrutura:
 *   Font picker (font-family) — full width dropdown
 *   Font weight + Font size — 2 cols (select + numeric input)
 *   Color label + Color type dropdown ("Solid")
 *   Color input row (swatch + hex + opacity)
 *   Line Height + Letter Spacing — 2 cols com label em cima
 *   Alignment — 2 button groups lado a lado (text-align + vertical-align)
 *
 * Helpers Cursor:
 *   ia = qn("font-family") || ""
 *   ks = parsed font-weight (100-900 step 100)
 *   go = BZ(qn("font-size")) ?? 0
 *   ko = qn("line-height").trim()
 *   aa = qn("letter-spacing").trim()
 *   Pl = text-align normalize (end→right)
 *   kl = vertical-align normalize (baseline→bottom)
 */
/**
 * UnitInput — input com draft state local pra valores tipo "12px" / "1.4" / "normal".
 *
 * BUG anterior: input controlled bound direto ao prop. Quando user digita "0." ou "-"
 * o regex parser não matchava → onCommit não chamava → state externo não atualizava
 * → input value "voltava" pro valor antigo, parecendo que "nada acontece".
 *
 * Solução: draft state local controla o text input. onChange só atualiza draft.
 * Commit acontece em onBlur OU Enter. Quando prop externa muda, sincroniza draft
 * (se input não está focado).
 *
 * Aceita:
 *   - número puro (usa `defaultUnit`)
 *   - número + unit (se unit em `allowUnits`)
 *   - `normalKeyword` (vazio também → normal)
 */
function UnitInput({
  value,
  placeholder,
  defaultUnit,
  allowUnits,
  onCommit,
  normalKeyword,
  liveCommit = false,
  liveCommitDelayMs = 150,
}: {
  value: string;
  placeholder?: string;
  defaultUnit: string;
  allowUnits: string[];
  onCommit: (v: string) => void;
  normalKeyword?: string;
  /** Quando true, commit acontece live enquanto user digita (debounced). Sempre commita tambem em blur/Enter. */
  liveCommit?: boolean;
  /** Debounce do live commit em ms. Default 150ms. */
  liveCommitDelayMs?: number;
}) {
  const display = (() => {
    if (normalKeyword && value === normalKeyword) return '';
    return value || '';
  })();
  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  // Sync externo → interno (só quando não está focado)
  useEffect(() => {
    if (!focused) setDraft(display);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);

  // tryCommit: parseia o draft e chama onCommit se válido. Retorna true se commit foi feito.
  // Se `revertOnInvalid=true`, reseta draft pro display value quando inválido (uso pra blur).
  // Se false, deixa o draft como tá (uso pra live debounce — user pode estar no meio de digitar).
  const tryCommit = (revertOnInvalid: boolean): boolean => {
    const v = draft.trim();
    if (!v) {
      if (normalKeyword) { onCommit(normalKeyword); return true; }
      return false;
    }
    if (normalKeyword && v.toLowerCase() === normalKeyword) {
      onCommit(normalKeyword);
      return true;
    }
    const m = v.match(/^(-?\d+(?:\.\d+)?)\s*([a-z%]*)$/i);
    if (!m) {
      if (revertOnInvalid) setDraft(display);
      return false;
    }
    const num = m[1];
    const unit = m[2].toLowerCase();
    const finalUnit = unit === '' ? defaultUnit : unit;
    if (allowUnits.includes(finalUnit)) {
      onCommit(finalUnit ? `${num}${finalUnit}` : num);
    } else {
      // Unit não permitida: usa defaultUnit
      onCommit(defaultUnit ? `${num}${defaultUnit}` : num);
    }
    return true;
  };

  const commit = (): void => { tryCommit(true); };

  // Live commit debounced: dispara enquanto user digita (se liveCommit=true).
  // Trigger: mudanca em `draft` enquanto focused. Cancela timer anterior em cada
  // novo char (debounce). Em blur/Enter o commit normal acontece de qualquer jeito.
  useEffect(() => {
    if (!liveCommit) return;
    if (!focused) return;
    const id = window.setTimeout(() => {
      // revertOnInvalid=false: nao revert no debounce (user pode estar no meio
      // de digitar "1.5em" e ja passou pelo "1." que e invalido).
      tryCommit(false);
    }, liveCommitDelayMs);
    return () => { window.clearTimeout(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, focused, liveCommit, liveCommitDelayMs]);

  return (
    <div className="css-input-field">
      <input
        className="css-number-input"
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
          if (e.key === 'Escape') { setDraft(display); (e.currentTarget as HTMLInputElement).blur(); }
        }}
      />
    </div>
  );
}

function TypographySection({
  fontFamily,
  fontSize,
  fontWeight,
  color,
  lineHeight,
  letterSpacing,
  textAlign,
  verticalAlign,
  availableFonts,
  backgroundImage,
  backgroundClip,
  onApply,
}: {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  color: string;
  lineHeight: string;
  letterSpacing: string;
  textAlign: string;
  verticalAlign: string;
  availableFonts?: string[];
  backgroundImage: string;
  backgroundClip: string;
  onApply: (property: string, value: string) => void;
}) {
  // Normalize de font-weight (replica `ks` do Cursor)
  const normalizeWeight = (raw: string): string => {
    const v = (raw || '').trim().toLowerCase();
    if (!v || v === 'normal') return '400';
    if (v === 'bold') return '700';
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return '400';
    return Math.min(900, Math.max(100, Math.round(n / 100) * 100)).toString();
  };
  const weightDisplay = normalizeWeight(fontWeight);
  // fontSize agora vai direto pro UnitInput (draft pattern), nao precisamos
  // parsear aqui — UnitInput cuida de display, draft, commit.

  // Text align normalize (Pl do Cursor)
  const ta = (textAlign || '').trim().toLowerCase();
  const taNormalized: 'left' | 'center' | 'right' | 'justify' = ta === 'center' ? 'center'
    : (ta === 'right' || ta === 'end') ? 'right'
    : ta === 'justify' ? 'justify'
    : 'left';
  // Vertical align normalize (kl do Cursor)
  const va = (verticalAlign || '').trim().toLowerCase();
  const vaNormalized: 'top' | 'middle' | 'bottom' = (va === 'middle' || va === 'center') ? 'middle'
    : (va === 'bottom' || va === 'baseline') ? 'bottom'
    : 'top';

  const [collapsed, toggleCollapsed] = useCollapseState('typography');
  return (
    <section className="css-inspector-section" data-collapsed={collapsed}>
      <div className="css-section-header">
        <div className="css-section-header-title-group">
          <button
            type="button"
            className="css-section-collapse-toggle"
            aria-label={collapsed ? 'Expand Text' : 'Collapse Text'}
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
          >
            <i className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} />
          </button>
          <div className="css-section-title">Text</div>
        </div>
      </div>
      <div className="css-section-body css-typography-body">
        {/* Font family — full width dropdown */}
        <div className="css-control-block">
          <div className="css-control-label">Font</div>
          <FontFamilyDropdown value={fontFamily} availableFonts={availableFonts} onApply={onApply} />
        </div>
        {/* Font weight + Font size — 2 cols. WeightDropdown custom evita
            o bg azul vibrante do `<option>` nativo (Chromium não estiliza).
            Font-size usa UnitInput (draft pattern) pra evitar Backspace bug
            do <input type=number>: quando user limpa o campo, parseFloat("")
            vira NaN -> nao commitava -> display "voltava". Cursor usa o mesmo
            commit handler (Fm) com defaultUnit:"px" e !allowNegative. */}
        <div className="css-dual-input-row css-typography-row">
          <WeightDropdown value={weightDisplay} onApply={onApply} />
          <div className="css-input-group">
            <UnitInput
              value={fontSize}
              placeholder="12"
              defaultUnit="px"
              allowUnits={['px', 'em', 'rem', '%']}
              onCommit={(v) => onApply('font-size', v)}
            />
            <span
              className="css-input-suffix css-input-suffix-draggable"
              title="Drag to adjust font size"
              aria-label="Drag to adjust font size"
            >px</span>
          </div>
        </div>
        {/* Color — Solid/Linear/Radial/Conic (replica `lW0` do Cursor).
            Type detectado: se background-image=gradient + bg-clip=text → gradient text,
            senão Solid. Mudança de type aplica/remove `background` + `background-clip`. */}
        <TextColorPaint
          color={color}
          backgroundImage={backgroundImage}
          backgroundClip={backgroundClip}
          onApply={onApply}
        />
        {/* Line height + Letter spacing — 2 cols com labels */}
        <div className="css-dual-input-row css-typography-row">
          <div className="css-typography-field">
            <label className="css-control-label css-typography-field-label">Line Height</label>
            <div className="css-input-group css-typography-input-group">
              <ScrubLabel
                getValue={() => {
                  const m = (lineHeight || '').match(/^(-?\d+(?:\.\d+)?)/);
                  return m ? parseFloat(m[1]) : 1;
                }}
                onChange={(v) => {
                  // Preserva a unit atual durante drag. line-height é especial:
                  //   - sem unit → multiplier de font-size (1.4 × 16px = 22px)
                  //   - com px → valor absoluto (22px)
                  // Se drag começou em valor px (ex: "30px"), continua aplicando px.
                  // Senão (unitless ou %/em/rem), aplica unitless multiplier.
                  const cur = (lineHeight || '').match(/[a-z%]+$/i);
                  const unit = cur ? cur[0] : '';
                  const num = Math.max(0, v).toFixed(2);
                  onApply('line-height', unit ? `${num}${unit}` : num);
                }}
                step={0.1}
                min={0}
                className="css-typography-label-icon"
                title="Line height"
                ariaLabel="Adjust line height"
              >
                {/* PA #196 P1-1: trocado codicon-symbol-numeric (# hash) por
                 * codicon-text-size — Cursor usa ícone "A↕" custom não disponível
                 * no @vscode/codicons; text-size é o mais próximo semantically
                 * (A com indicador de tamanho vertical). */}
                <i className="codicon codicon-text-size" />
              </ScrubLabel>
              <UnitInput
                value={lineHeight}
                placeholder="1.4 or 120%"
                defaultUnit=""
                allowUnits={['px', '%', 'em', 'rem', '']}
                onCommit={(v) => {
                  // Smart unit inference (Figma-style):
                  //   - tem unit explícita (px/%/em/rem) → respeita
                  //   - número com decimal (1.4, 0.8) → unitless multiplier
                  //   - número inteiro pequeno (< 4) → unitless multiplier (ex: "2" = 2× font-size)
                  //   - número inteiro >= 4 → assume px (ex: "30" = "30px")
                  // CSS sem unit interpreta "30" como 30× font-size = 480px com font 16,
                  // que NÃO é o que o user quer ao digitar 30.
                  const m = v.match(/^(-?\d+(?:\.\d+)?)\s*([a-z%]*)$/i);
                  if (m && !m[2]) {
                    const numStr = m[1];
                    const n = parseFloat(numStr);
                    if (numStr.includes('.') || n < 4) {
                      onApply('line-height', numStr);
                    } else {
                      onApply('line-height', `${numStr}px`);
                    }
                  } else {
                    onApply('line-height', v);
                  }
                }}
                normalKeyword="normal"
              />
            </div>
          </div>
          <div className="css-typography-field">
            <label className="css-control-label css-typography-field-label">Letter Spacing</label>
            <div className="css-input-group css-typography-input-group">
              <ScrubLabel
                getValue={() => {
                  const m = (letterSpacing || '').match(/^(-?\d+(?:\.\d+)?)/);
                  return m ? parseFloat(m[1]) : 0;
                }}
                onChange={(v) => onApply('letter-spacing', `${v.toFixed(2)}px`)}
                step={0.1}
                className="css-typography-label-icon"
                title="Letter spacing"
                ariaLabel="Adjust letter spacing"
              >
                <i className="codicon codicon-symbol-text" />
              </ScrubLabel>
              <UnitInput
                value={letterSpacing}
                placeholder="0px"
                defaultUnit="px"
                allowUnits={['px', '%', 'em', 'rem']}
                onCommit={(v) => onApply('letter-spacing', v)}
                normalKeyword="normal"
                liveCommit
                liveCommitDelayMs={150}
              />
            </div>
          </div>
        </div>
        {/* Alignment — 2 button groups lado a lado */}
        <div className="css-control-block css-typography-align-block">
          <div className="css-control-label">Alignment</div>
          <div className="css-typography-align-row">
            <div className="css-button-group">
              {(['left', 'center', 'right'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`css-button-group-item ${taNormalized === v ? 'active' : ''}`}
                  onClick={() => onApply('text-align', v)}
                  /* PA #196 P2-3: Cursor usa "Align text X" não "Text align X". */
                  title={`Align text ${v}`}
                  aria-pressed={taNormalized === v}
                >
                  <TextAlignIcon align={v} />
                </button>
              ))}
            </div>
            <div className="css-button-group css-vertical-align-group">
              {(['top', 'middle', 'bottom'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`css-button-group-item ${vaNormalized === v ? 'active' : ''}`}
                  onClick={() => onApply('vertical-align', v)}
                  /* PA #196 P2-3: Cursor usa "Align text middle/top/bottom". */
                  title={`Align text ${v}`}
                  aria-pressed={vaNormalized === v}
                >
                  <VerticalAlignIcon align={v} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * FontFamilyDropdown — dropdown full-width que mostra font-family atual e abre
 * menu com fonts disponíveis. Simplified version (sem search). Cursor tem
 * `css-font-menu` com `css-font-search`.
 */
/**
 * WeightDropdown — custom dropdown pra font-weight (100-900).
 *
 * Substitui o `<select>` nativo que renderizava com bg azul forte no item
 * selecionado (estilo Chromium não estilizável). Usa o mesmo pattern do
 * FontFamilyDropdown: trigger custom + menu absoluto + items clicáveis.
 */
const WEIGHT_LABELS: Record<string, string> = {
  '100': '100 · Thin',
  '200': '200 · Extra Light',
  '300': '300 · Light',
  '400': '400 · Regular',
  '500': '500 · Medium',
  '600': '600 · Semi Bold',
  '700': '700 · Bold',
  '800': '800 · Extra Bold',
  '900': '900 · Black',
};
function WeightDropdown({
  value,
  onApply,
}: {
  value: string;
  onApply: (property: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const WEIGHTS = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];
  const selected = WEIGHTS.includes(value) ? value : '400';

  return (
    <div ref={ref} className="css-weight-dropdown-wrapper">
      <button
        type="button"
        className="css-weight-dropdown"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Font weight"
        onClick={() => setOpen((p) => !p)}
      >
        <span className="css-weight-dropdown-value">{selected}</span>
        <i className="codicon codicon-chevron-down" />
      </button>
      {open && (
        <div className="css-weight-menu" role="listbox">
          {WEIGHTS.map((w) => (
            <button
              key={w}
              type="button"
              role="option"
              aria-selected={selected === w}
              className={`css-weight-menu-item ${selected === w ? 'active' : ''}`}
              style={{ fontWeight: w }}
              onClick={() => { onApply('font-weight', w); setOpen(false); }}
            >
              <span>{WEIGHT_LABELS[w] || w}</span>
              {selected === w && <i className="codicon codicon-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * TextAlignIcon — SVG inline pra alinhamento horizontal de texto.
 *
 * Pattern padrão Windows/Word/Mac (4 linhas representando parágrafos):
 *   - left:   ▬▬▬▬▬▬ / ▬▬▬▬ / ▬▬▬▬▬ / ▬▬▬       (todas começam à esquerda)
 *   - center: ▬▬▬▬▬▬ /  ▬▬▬▬  / ▬▬▬▬▬ /   ▬▬▬   (todas centradas)
 *   - right:  ▬▬▬▬▬▬ /   ▬▬▬▬ / ▬▬▬▬▬ /     ▬▬▬ (todas terminam à direita)
 *
 * `@vscode/codicons` NÃO tem ícones de text-align padrão (só seta direção).
 * Antes usávamos arrow-left/small-down/arrow-right que ficavam contra-intuitivos
 * (especialmente "down arrow" pra center). PA #196: SVG inline matchando Windows.
 *
 * ViewBox 16×16, currentColor, 1px stroke.
 */
function TextAlignIcon({ align }: { align: 'left' | 'center' | 'right' }) {
  // 4 horizontal lines em y=3.5, 7, 10.5, 13.5 (espaçamento ~3.5px).
  // Larguras variam pra dar visual de parágrafo (linhas curtas/longas).
  // 'left':  x=2 sempre, widths [12, 8, 10, 6]
  // 'center': x centered, widths [12, 8, 10, 6]
  // 'right': x = 14 - width, widths [12, 8, 10, 6]
  const widths = [12, 8, 10, 6];
  const lines = widths.map((w, i) => {
    const y = 3 + i * 3;
    let x: number;
    if (align === 'left') x = 2;
    else if (align === 'right') x = 14 - w;
    else x = (16 - w) / 2;
    return <rect key={i} x={x} y={y} width={w} height={1.5} rx={0.5} />;
  });
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {lines}
    </svg>
  );
}

/**
 * VerticalAlignIcon — SVG inline pra alinhamento vertical.
 *
 * Pattern: box outline + barra interna posicionada conforme alinhamento.
 *   - top:    [▬▬▬]   (barra encostada no topo)
 *             [   ]
 *             [   ]
 *   - middle: [   ]
 *             [▬▬▬]   (barra no meio)
 *             [   ]
 *   - bottom: [   ]
 *             [   ]
 *             [▬▬▬]   (barra encostada no fundo)
 *
 * Match Cursor/Word vertical-align pattern.
 */
function VerticalAlignIcon({ align }: { align: 'top' | 'middle' | 'bottom' }) {
  // Box 12x12 centrado, com barra interna conforme alinhamento.
  // Barra tem 8px de largura, 2px de altura, centrada horizontalmente.
  let barY: number;
  if (align === 'top') barY = 3.5;
  else if (align === 'bottom') barY = 10.5;
  else barY = 7;
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
      {/* Box outline */}
      <rect x={2.5} y={2.5} width={11} height={11} strokeWidth={1} rx={1} />
      {/* Bar inside indicating alignment */}
      <rect x={4} y={barY} width={8} height={1.5} fill="currentColor" stroke="none" rx={0.5} />
    </svg>
  );
}

function FontFamilyDropdown({
  value,
  availableFonts,
  onApply,
}: {
  value: string;
  availableFonts?: string[];
  onApply: (property: string, value: string) => void;
}) {
  // Usa lista detectada da página se disponível, senão fallback default.
  const FONTS = availableFonts && availableFonts.length > 0 ? availableFonts : [
    'system-ui', 'sans-serif', 'serif', 'monospace', 'cursive',
    'Inter', 'Roboto', 'Helvetica', 'Arial', 'Georgia', 'Times New Roman',
    'Courier New', 'Menlo', 'Consolas', 'JetBrains Mono',
  ];
  const [open, setOpen] = useState(false);
  // PA #196 P0-1: search filter — Cursor tem `css-font-search` input no topo
  // do menu. Sem isso, listas com 50+ fontes (caso comum em projetos com Tailwind
  // configurado) viram cansativo scroll. Auto-foca quando abre, reseta ao fechar.
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!open) {
      setFilter('');
      return;
    }
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    // Auto-foca o search input quando abre (rAF pra esperar DOM commit).
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);
  // Display: pega primeira font do stack
  const display = (value || '').split(',')[0]?.trim().replace(/['"]/g, '') || 'inherit';
  // Filtra case-insensitive — match em qualquer parte do nome.
  const filteredFonts = filter.trim()
    ? FONTS.filter((f) => f.toLowerCase().includes(filter.trim().toLowerCase()))
    : FONTS;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="css-font-dropdown"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((p) => !p)}
      >
        <span className="css-font-dropdown-label">{display}</span>
        <i className="codicon codicon-chevron-down" />
      </button>
      {open && (
        <div className="css-font-menu" role="listbox">
          {/* PA #196 P0-1: Search input no topo (matches Cursor `css-font-search`). */}
          <div className="css-font-search-wrap">
            <input
              ref={searchRef}
              type="text"
              className="css-font-search"
              placeholder="Search fonts"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setOpen(false); }
                else if (e.key === 'Enter' && filteredFonts.length > 0) {
                  // Enter aplica primeira font filtrada — atalho útil pra "Inter" → digit "in" → Enter.
                  onApply('font-family', filteredFonts[0]);
                  setOpen(false);
                }
              }}
            />
          </div>
          <div className="css-font-list">
            {filteredFonts.length === 0 ? (
              <div className="css-font-menu-empty">No matching fonts</div>
            ) : (
              filteredFonts.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="option"
                  aria-selected={display === f}
                  className={`css-font-menu-item ${display === f ? 'active' : ''}`}
                  onClick={() => { onApply('font-family', f); setOpen(false); }}
                  style={{ fontFamily: f }}
                >
                  {f}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * CollapsibleSection — wrapper que adiciona chevron colapsável a qualquer
 * section do inspector. Persiste estado em localStorage por section.
 *
 * Uso:
 *   <CollapsibleSection title="Position" id="position">
 *     <PositionSection ... />
 *   </CollapsibleSection>
 *
 * Mas como nossas sections já renderizam <section class=css-inspector-section>
 * com header próprio, esse wrapper é mais um helper. Vou usar abordagem
 * alternativa: hook + classes CSS controladas via data-collapsed attribute.
 */
function useCollapseState(id: string): [boolean, () => void] {
  const key = `undrcode.section-collapsed.${id}`;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(key) === 'true'; } catch { return false; }
  });
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(key, next ? 'true' : 'false'); } catch { /* ignore */ }
      return next;
    });
  }, [key]);
  return [collapsed, toggle];
}

/**
 * SectionHeader — header padrão pras sections do inspector com chevron
 * colapsável + título + actions opcionais. Usa o template HTML do Cursor
 * + adiciona chevron no início (Cursor NÃO tem chevron mas user pediu).
 */
function SectionHeader({
  id,
  title,
  actions,
  collapsible = true,
}: {
  id: string;
  title: string;
  actions?: ReactNode;
  collapsible?: boolean;
}) {
  const [collapsed, toggle] = useCollapseState(id);

  // expor o collapsed via window pra outros componentes lerem se precisarem
  // (alternativa seria context, mas mantém simples).
  useEffect(() => {
    const el = document.querySelector(`[data-section="${id}"]`);
    if (el) el.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
  }, [id, collapsed]);

  return (
    <div className="css-section-header">
      <div className="css-section-header-title-group">
        {collapsible && (
          <button
            type="button"
            className="css-section-collapse-toggle"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            aria-expanded={!collapsed}
            onClick={toggle}
          >
            <i className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} />
          </button>
        )}
        <div className="css-section-title">{title}</div>
      </div>
      {actions && <div className="css-section-actions">{actions}</div>}
    </div>
  );
}

/**
 * GradientTypeDropdown — dropdown Solid/Linear/Radial/Conic (Cursor array).
 *
 * Cursor exato: `[
 *   {value:"solid", label:"Solid"},
 *   {value:"linear", label:"Linear"},
 *   {value:"radial", label:"Radial"},
 *   {value:"conic", label:"Conic"}
 * ]`
 *
 * Usado em Background, Border, Text color. Cada um decide o que aplicar.
 */
type GradientType = 'solid' | 'linear' | 'radial' | 'conic';

// ─────────────────────────────────────────────────────────────────────────
// Gradient helpers — replica $mw/Gmw/Wmw/v1e do Cursor
// ─────────────────────────────────────────────────────────────────────────

interface GradientStop { color: string; alpha: number; position: number; }
interface GradientConfig {
  type: 'linear' | 'radial' | 'conic';
  angle: number;
  shape: 'circle' | 'ellipse';
  position: { x: number; y: number };
  stops: GradientStop[];
}

const DEFAULT_GRADIENT_CONFIG: GradientConfig = {
  type: 'linear',
  angle: 90,
  shape: 'circle',
  position: { x: 50, y: 50 },
  stops: [
    { color: '#000000', alpha: 100, position: 0 },
    { color: '#FFFFFF', alpha: 100, position: 100 },
  ],
};

// VN(hex, alpha) → rgba string (replica Cursor)
function colorToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '').match(/^([0-9a-f]{6})$/i);
  if (!m) return hex;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  const a = (alpha / 100).toFixed(2);
  return alpha === 100 ? `#${m[1].toUpperCase()}` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

// $mw — Linear formatter
function formatLinearGradient(c: GradientConfig): string {
  const angle = `${Math.round(c.angle * 100) / 100}deg`;
  const stops = c.stops
    .map((s) => `${colorToRgba(s.color, s.alpha)} ${s.position}%`)
    .join(', ');
  return `linear-gradient(${angle}, ${stops})`;
}

// Gmw — Radial formatter
function formatRadialGradient(c: GradientConfig): string {
  const shape = c.shape;
  const pos = `at ${c.position.x}% ${c.position.y}%`;
  const stops = c.stops
    .map((s) => `${colorToRgba(s.color, s.alpha)} ${s.position}%`)
    .join(', ');
  return `radial-gradient(${shape} ${pos}, ${stops})`;
}

// Wmw — Conic formatter
function formatConicGradient(c: GradientConfig): string {
  const angle = `from ${Math.round(c.angle * 100) / 100}deg`;
  const pos = `at ${c.position.x}% ${c.position.y}%`;
  const stops = c.stops
    .map((s) => `${colorToRgba(s.color, s.alpha)} ${s.position}%`)
    .join(', ');
  return `conic-gradient(${angle} ${pos}, ${stops})`;
}

// v1e — dispatcher
function formatGradient(c: GradientConfig): string {
  if (c.type === 'linear') return formatLinearGradient(c);
  if (c.type === 'radial') return formatRadialGradient(c);
  return formatConicGradient(c);
}

// Detect type from CSS string
function detectGradientType(css: string): GradientType {
  if (!css) return 'solid';
  if (css.includes('linear-gradient')) return 'linear';
  if (css.includes('radial-gradient')) return 'radial';
  if (css.includes('conic-gradient')) return 'conic';
  return 'solid';
}

// Parse CSS gradient → config (best-effort)
function parseGradientCss(css: string): GradientConfig | null {
  if (!css || css === 'none') return null;
  const trimmed = css.trim();
  const m = trimmed.match(/(linear|radial|conic)-gradient\((.+)\)$/);
  if (!m) return null;
  const type = m[1] as GradientConfig['type'];
  const inner = m[2];
  // Split top-level commas (respect parens)
  const parts: string[] = [];
  let buf = '';
  let depth = 0;
  for (const ch of inner) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(buf.trim());
      buf = '';
    } else buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());

  const config: GradientConfig = { ...DEFAULT_GRADIENT_CONFIG, type, stops: [] };

  let stopsStart = 0;
  // First part may contain angle/shape/position
  if (parts.length > 0) {
    const first = parts[0];
    // linear: "90deg" or "to right" etc.
    if (type === 'linear') {
      const am = first.match(/(-?\d+(?:\.\d+)?)deg/);
      if (am) { config.angle = parseFloat(am[1]); stopsStart = 1; }
    }
    // radial: "circle at 50% 50%" / "ellipse at ..."
    if (type === 'radial') {
      if (/circle|ellipse|at\s+\d/.test(first)) {
        if (first.includes('ellipse')) config.shape = 'ellipse';
        else if (first.includes('circle')) config.shape = 'circle';
        const at = first.match(/at\s+([\d.]+)%\s+([\d.]+)%/);
        if (at) {
          config.position.x = parseFloat(at[1]);
          config.position.y = parseFloat(at[2]);
        }
        stopsStart = 1;
      }
    }
    // conic: "from 0deg at 50% 50%"
    if (type === 'conic') {
      const am = first.match(/from\s+(-?\d+(?:\.\d+)?)deg/);
      if (am) config.angle = parseFloat(am[1]);
      const at = first.match(/at\s+([\d.]+)%\s+([\d.]+)%/);
      if (at) {
        config.position.x = parseFloat(at[1]);
        config.position.y = parseFloat(at[2]);
      }
      if (am || at) stopsStart = 1;
    }
  }

  // Parse stops: "color position%"
  for (let i = stopsStart; i < parts.length; i++) {
    const sp = parts[i];
    const posMatch = sp.match(/([\d.]+)%\s*$/);
    const position = posMatch ? parseFloat(posMatch[1]) : (i - stopsStart) * (100 / Math.max(1, parts.length - stopsStart - 1));
    const colorRaw = sp.replace(/\s*[\d.]+%\s*$/, '').trim();
    const rgbMatch = colorRaw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    let color = '#000000';
    let alpha = 100;
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1], 10);
      const g = parseInt(rgbMatch[2], 10);
      const b = parseInt(rgbMatch[3], 10);
      alpha = rgbMatch[4] ? Math.round(parseFloat(rgbMatch[4]) * 100) : 100;
      color = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0').toUpperCase()).join('');
    } else if (/^#[0-9a-f]{6}$/i.test(colorRaw)) {
      color = colorRaw.toUpperCase();
    }
    config.stops.push({ color, alpha, position });
  }
  if (config.stops.length < 2) {
    config.stops = [...DEFAULT_GRADIENT_CONFIG.stops];
  }
  return config;
}

/**
 * GradientEditorMVP — editor simplificado de gradient (linear/radial/conic).
 *
 * Mostra: 2 stops (from/to) + angle (linear/conic) + shape (radial).
 * Cursor tem versão completa com stops arrastáveis, mas como MVP fica assim.
 */
/**
 * DraftInput — input controlled via DRAFT state. Commit no blur/Enter.
 *
 * Resolve bug clássico de controlled input com validação:
 *   value={x}  +  onChange filtra valor inválido + propaga
 * → user digita parcial inválido → onChange skip → state externo igual
 * → re-render restaura value original → user não consegue editar.
 *
 * Pattern: draft é fonte de verdade durante edit; sync com prop quando blur.
 * Validate opcional reverte ao value original se draft falhar.
 */
function DraftInput({
  value,
  onCommit,
  validate,
  className,
  type,
  inputMode,
  spellCheck,
  min,
  max,
  pattern,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onCommit: (v: string) => void;
  validate?: (v: string) => boolean;
  className?: string;
  type?: string;
  inputMode?: 'numeric' | 'decimal' | 'text';
  spellCheck?: boolean;
  min?: number;
  max?: number;
  pattern?: string;
  placeholder?: string;
  ariaLabel?: string;
}): JSX.Element {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);
  const commit = (): void => {
    if (validate && !validate(draft)) {
      setDraft(value);
      return;
    }
    onCommit(draft);
  };
  return (
    <input
      className={className}
      type={type ?? 'text'}
      inputMode={inputMode}
      spellCheck={spellCheck}
      min={min}
      max={max}
      pattern={pattern}
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        if (e.key === 'Escape') { setDraft(value); (e.currentTarget as HTMLInputElement).blur(); }
      }}
    />
  );
}

/**
 * GradientEditorMVP — Cursor templates literal (Mfw/Bfw/Ffw + Efw + q5d):
 *   <div class=css-gradient-controls>
 *     <div class=css-gradient-preview-container>
 *       <div class=css-gradient-preview>
 *         <div class=css-gradient-preview-track></div>  ← gradient pintado
 *       </div>
 *     </div>
 *     <div class=css-gradient-angle-row (ou shape-row)>
 *       <input angle°>  OU  <Circle/Ellipse buttons>
 *       <div class=css-gradient-header-actions>
 *         <button title="Reverse gradient">⇄</button>
 *         <button title="Remove fill">🗑</button>
 *       </div>
 *     </div>
 *     <div class=css-gradient-stops>
 *       <div class=css-gradient-stops-header>
 *         <label>Stops</label>
 *         <button title="Add color stop">+</button>
 *       </div>
 *       <div class=css-gradient-stop-row>  (repeat por stop)
 *         <input position% />
 *         <div class=css-gradient-stop-color-container>
 *           <swatch> <hex> | <opacity%>
 *         </div>
 *         <button class=css-gradient-stop-remove>—</button>
 *       </div>
 *     </div>
 *   </div>
 *
 * Cursor handlers (literal):
 *   onAddStop: Cursor _e — encontra maior gap entre stops e adiciona um no meio
 *   onRemoveStop: Cursor Ie — só permite se stops.length > 2
 *   reverseGradient: inverte ordem dos stops + position = 100-position
 */
function GradientEditorMVP({
  config,
  onChange,
  onRemove,
}: {
  config: GradientConfig;
  onChange: (cfg: GradientConfig) => void;
  /** Cursor pattern: trash icon na header-actions chama isso (clear gradient). */
  onRemove?: () => void;
}) {
  const updateStop = (idx: number, patch: Partial<GradientStop>): void => {
    const stops = [...config.stops];
    stops[idx] = { ...stops[idx], ...patch };
    onChange({ ...config, stops });
  };

  // Cursor _e: novo stop no maior gap entre stops adjacentes
  const addStop = (): void => {
    const stops = config.stops;
    let pos = 50;
    if (stops.length >= 2) {
      let maxGap = 0;
      let bestPos = 0;
      for (let i = 0; i < stops.length - 1; i++) {
        const gap = stops[i + 1].position - stops[i].position;
        if (gap > maxGap) { maxGap = gap; bestPos = stops[i].position; }
      }
      pos = bestPos + maxGap / 2;
    }
    const newStop: GradientStop = { color: '#888888', position: pos, alpha: 100 };
    const sorted = [...stops, newStop].sort((a, b) => a.position - b.position);
    onChange({ ...config, stops: sorted });
  };

  // Cursor Ie: remover stop só se restar ≥2
  const removeStop = (idx: number): void => {
    if (config.stops.length <= 2) return;
    const stops = config.stops.filter((_, i) => i !== idx);
    onChange({ ...config, stops });
  };

  // Reverse gradient: inverte ordem + posições espelhadas
  const reverseGradient = (): void => {
    const reversed = [...config.stops]
      .reverse()
      .map((s) => ({ ...s, position: 100 - s.position }))
      .sort((a, b) => a.position - b.position);
    onChange({ ...config, stops: reversed });
  };

  /**
   * Drag handler para stops — Cursor pattern.
   * Mousedown no handle inicia drag, mousemove atualiza position em %
   * relativa à preview-track width, mouseup encerra.
   */
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [selectedStop, setSelectedStop] = useState<number | null>(null);
  const startStopDrag = (idx: number, e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedStop(idx);
    const track = previewRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    // Capture initial stops snapshot pra evitar stale closure
    const stopsSnapshot = [...config.stops];
    const onMove = (me: MouseEvent): void => {
      const x = me.clientX - rect.left;
      const position = Math.max(0, Math.min(100, (x / rect.width) * 100));
      const next = [...stopsSnapshot];
      next[idx] = { ...next[idx], position };
      onChange({ ...config, stops: next });
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div className="css-gradient-controls">
      {/* Preview bar (Cursor: css-gradient-preview-container) */}
      <div className="css-gradient-preview-container">
        <div className="css-gradient-preview" ref={previewRef}>
          <div
            className="css-gradient-preview-track"
            style={{ background: formatGradient(config) }}
          />
          {/* Stop handles — arrastáveis horizontalmente.
              Cada handle = quadradinho 18×18 com border branco 2px,
              background = cor do stop. */}
          {config.stops.map((stop, i) => (
            <div
              key={i}
              className={`css-gradient-stop-handle ${selectedStop === i ? 'selected' : ''}`}
              style={{
                left: `${stop.position}%`,
                background: stop.color,
              }}
              onMouseDown={(e) => startStopDrag(i, e)}
              title={`Stop ${i + 1}: ${stop.color} @ ${Math.round(stop.position)}%`}
            />
          ))}
        </div>
      </div>

      {/* Linear/Conic: angle row | Radial: shape row */}
      {config.type === 'radial' ? (
        <div className="css-gradient-shape-row">
          <div className="css-button-group">
            <button
              type="button"
              className={`css-segmented-button ${config.shape === 'circle' ? 'active' : ''}`}
              onClick={() => onChange({ ...config, shape: 'circle' })}
            >Circle</button>
            <button
              type="button"
              className={`css-segmented-button ${config.shape === 'ellipse' ? 'active' : ''}`}
              onClick={() => onChange({ ...config, shape: 'ellipse' })}
            >Ellipse</button>
          </div>
          <div className="css-gradient-header-actions">
            <button
              type="button"
              className="css-gradient-action-btn"
              title="Reverse gradient"
              onClick={reverseGradient}
            ><i className="codicon codicon-arrow-swap" /></button>
            {onRemove && (
              <button
                type="button"
                className="css-gradient-action-btn"
                title="Remove fill"
                onClick={onRemove}
              ><i className="codicon codicon-trash" /></button>
            )}
          </div>
        </div>
      ) : (
        <div className="css-gradient-angle-row">
          <div className="css-input-group css-gradient-angle-input">
            {/* Conic (Cursor template Ffw): label "Start" antes do input. Linear (Mfw) não tem. */}
            {config.type === 'conic' && (
              <label className="css-input-label">Start</label>
            )}
            <DraftInput
              className="css-number-input"
              inputMode="numeric"
              ariaLabel="Gradient angle"
              value={String(Math.round(config.angle))}
              onCommit={(raw) => {
                const v = parseFloat(raw);
                if (!Number.isNaN(v)) onChange({ ...config, angle: Math.max(0, Math.min(360, v)) });
              }}
            />
            <span className="css-input-suffix">°</span>
          </div>
          <div className="css-gradient-header-actions">
            <button
              type="button"
              className="css-gradient-action-btn"
              title="Reverse gradient"
              onClick={reverseGradient}
            ><i className="codicon codicon-arrow-swap" /></button>
            {onRemove && (
              <button
                type="button"
                className="css-gradient-action-btn"
                title="Remove fill"
                onClick={onRemove}
              ><i className="codicon codicon-trash" /></button>
            )}
          </div>
        </div>
      )}

      {/* Stops section — Cursor template */}
      <div className="css-gradient-stops">
        <div className="css-gradient-stops-header">
          <label className="css-control-label">Stops</label>
          <button
            type="button"
            className="css-gradient-add-stop"
            title="Add color stop"
            onClick={addStop}
          ><i className="codicon codicon-add" /></button>
        </div>
        {config.stops.map((stop, i) => (
          <div key={i} className="css-gradient-stop-row">
            {/* Position % input */}
            <div className="css-input-group css-gradient-stop-position-input">
              <DraftInput
                className="css-number-input"
                inputMode="numeric"
                ariaLabel={`Stop ${i + 1} position`}
                value={String(Math.round(stop.position))}
                onCommit={(raw) => {
                  const v = parseFloat(raw);
                  if (!Number.isNaN(v)) updateStop(i, { position: Math.max(0, Math.min(100, v)) });
                }}
              />
              <span className="css-input-suffix">%</span>
            </div>
            {/* Color container: swatch + hex + separator + opacity */}
            <div className="css-gradient-stop-color-container">
              {/* Native color picker uncontrolled — pattern do ColorInputRow.
                  Ref-based sync evita remount no onInput → picker mantém drag. */}
              <input
                ref={(el) => {
                  const v = stop.color.toLowerCase();
                  if (el && el.value.toLowerCase() !== v && document.activeElement !== el) {
                    el.value = v;
                  }
                }}
                type="color"
                className="css-color-swatch-inline"
                defaultValue={stop.color.toLowerCase()}
                onInput={(e) => updateStop(i, { color: (e.currentTarget as HTMLInputElement).value.toUpperCase() })}
                onChange={(e) => updateStop(i, { color: e.currentTarget.value.toUpperCase() })}
              />
              <DraftInput
                className="css-hex-input"
                spellCheck={false}
                ariaLabel={`Stop ${i + 1} hex`}
                value={stop.color.replace('#', '')}
                onCommit={(raw) => {
                  const v = raw.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
                  if (v.length === 3 || v.length === 6) updateStop(i, { color: '#' + v.toUpperCase() });
                }}
                validate={(raw) => {
                  const v = raw.replace(/[^0-9a-fA-F]/g, '');
                  return v.length === 3 || v.length === 6;
                }}
              />
              <div className="css-input-separator" />
              <div className="css-opacity-input-inline css-input-field">
                <DraftInput
                  className="css-number-input"
                  inputMode="numeric"
                  ariaLabel={`Stop ${i + 1} opacity`}
                  value={String(stop.alpha)}
                  onCommit={(raw) => {
                    const v = parseFloat(raw);
                    if (!Number.isNaN(v)) updateStop(i, { alpha: Math.max(0, Math.min(100, Math.round(v))) });
                  }}
                />
                <span className="css-input-suffix">%</span>
              </div>
            </div>
            {/* Remove stop button — disabled se só restam 2 */}
            <button
              type="button"
              className="css-gradient-stop-remove"
              title="Remove stop"
              disabled={config.stops.length <= 2}
              onClick={() => removeStop(i)}
            ><i className="codicon codicon-chrome-minimize" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * TextColorPaint — replica color block do `lW0` (Text) com Solid/Linear/Radial/Conic.
 *
 * Comportamento:
 *  - Solid: color = hex/rgba, sem background gradient
 *  - Gradient: color = transparent, background = gradient, -webkit-background-clip = text
 *
 * Detecção atual: se `backgroundImage` contém gradient AND `backgroundClip` includes "text"
 * → renderiza como gradient. Senão → Solid.
 */
function TextColorPaint({
  color,
  backgroundImage,
  backgroundClip,
  onApply,
}: {
  color: string;
  backgroundImage: string;
  backgroundClip: string;
  onApply: (property: string, value: string) => void;
}) {
  // Cursor pattern (signals lW0): type EXPLÍCITO em state local.
  // Para text gradient: solid se NÃO (background-clip:text + gradient).
  const detectInitial = (): GradientType => {
    const isGradientText = backgroundClip.includes('text') && /gradient/.test(backgroundImage);
    if (!isGradientText) return 'solid';
    return detectGradientType(backgroundImage);
  };
  const [type, setType] = useState<GradientType>(detectInitial);
  const [config, setConfig] = useState<GradientConfig>(() => {
    const detected = detectInitial();
    if (detected === 'solid') return DEFAULT_GRADIENT_CONFIG;
    return parseGradientCss(backgroundImage) || { ...DEFAULT_GRADIENT_CONFIG, type: detected as GradientConfig['type'] };
  });

  // Sync externo: backgroundClip OU backgroundImage mudou fora do componente.
  useEffect(() => {
    const externalType = detectInitial();
    setType(externalType);
    if (externalType !== 'solid') {
      const parsed = parseGradientCss(backgroundImage);
      if (parsed) setConfig(parsed);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundImage, backgroundClip]);

  const applyGradient = (cfg: GradientConfig): void => {
    setConfig(cfg);
    const css = formatGradient(cfg);
    onApply('background-image', css);
    onApply('-webkit-background-clip', 'text');
    onApply('background-clip', 'text');
    onApply('color', 'transparent');
  };

  const switchType = (newType: GradientType): void => {
    setType(newType); // Cursor pattern: state primeiro.
    if (newType === 'solid') {
      onApply('background-image', '');
      onApply('-webkit-background-clip', '');
      onApply('background-clip', '');
      if (color === 'transparent' || color === 'rgba(0, 0, 0, 0)') {
        onApply('color', '#000000');
      }
      return;
    }
    const next: GradientConfig = config.type === newType ? config : { ...config, type: newType };
    setConfig(next);
    const css = formatGradient(next);
    onApply('background-image', css);
    onApply('-webkit-background-clip', 'text');
    onApply('background-clip', 'text');
    onApply('color', 'transparent');
  };

  return (
    <div className="css-control-block">
      <div className="css-control-label">Color</div>
      <GradientTypeDropdown current={type} onChange={switchType} />
      {type === 'solid' ? (
        <ColorInputRow value={color} onApply={(v) => onApply('color', v)} />
      ) : (
        <GradientEditorMVP
          config={config}
          onChange={applyGradient}
          onRemove={() => switchType('solid')}
        />
      )}
    </div>
  );
}

/**
 * BackgroundPaint — replica VG0 (Background) com Solid/Linear/Radial/Conic.
 *
 * Solid: `background-color: <color>` + remove background-image gradient
 * Gradient: `background-image: <gradient>` + clear background-color
 */
function BackgroundPaint({
  bgColor,
  bgImage,
  linkedVariable,
  resolvedTokenColor,
  onApply,
  onUnlinkVariable,
  onOpenTokenPicker,
}: {
  bgColor: string;
  bgImage: string;
  /** If bgColor is `var(--name)`, pass the var name here. Null = not linked. */
  linkedVariable: string | null;
  /** Resolved rgb() of the linked token, for the swatch preview. */
  resolvedTokenColor: string;
  onApply: (property: string, value: string) => void;
  /** Cursor pattern: onUnlinkVariable() clears the linked token → reverts to hex. */
  onUnlinkVariable: () => void;
  /** Cursor pattern: click token button → re-open token picker. */
  onOpenTokenPicker?: () => void;
}) {
  // Cursor pattern (signals VG0): gradient TYPE é state EXPLÍCITO, não derived do CSS.
  const [type, setType] = useState<GradientType>(() => detectGradientType(bgImage));
  const [config, setConfig] = useState<GradientConfig>(() => {
    const detected = detectGradientType(bgImage);
    if (detected === 'solid') return DEFAULT_GRADIENT_CONFIG;
    return parseGradientCss(bgImage) || { ...DEFAULT_GRADIENT_CONFIG, type: detected as GradientConfig['type'] };
  });

  // Sync externo (raro): outro panel ou inline edit muda bgImage.
  useEffect(() => {
    const externalType = detectGradientType(bgImage);
    setType(externalType);
    if (externalType !== 'solid') {
      const parsed = parseGradientCss(bgImage);
      if (parsed) setConfig(parsed);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgImage]);

  const applyGradient = (cfg: GradientConfig): void => {
    setConfig(cfg);
    onApply('background-image', formatGradient(cfg));
  };

  const switchType = (newType: GradientType): void => {
    setType(newType);
    if (newType === 'solid') {
      onApply('background-image', '');
      if (!bgColor || bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
        onApply('background-color', '#FFFFFF');
      }
      return;
    }
    const next: GradientConfig = config.type === newType
      ? config
      : { ...config, type: newType };
    setConfig(next);
    onApply('background-image', formatGradient(next));
  };

  return (
    <>
      <GradientTypeDropdown current={type} onChange={switchType} />
      {type === 'solid' ? (
        /* Cursor pattern: linked token → show token button, else → hex input */
        linkedVariable ? (
          <LinkedTokenButton
            tokenName={linkedVariable}
            resolvedColor={resolvedTokenColor}
            onClickToken={() => onOpenTokenPicker?.()}
            onUnlink={onUnlinkVariable}
          />
        ) : (
          <ColorInputRow value={bgColor} onApply={(v) => onApply('background-color', v)} />
        )
      ) : (
        <GradientEditorMVP
          config={config}
          onChange={applyGradient}
          onRemove={() => switchType('solid')}
        />
      )}
    </>
  );
}

/**
 * BorderPaint — replica oW0 (Border color) com Solid/Linear/Radial/Conic.
 *
 * Solid: `border-color: <color>` + remove border-image
 * Gradient: `border-image: <gradient> 1` + border-style transparent fallback
 *
 * Border gradient é dificultado pelo CSS: precisa `border-image` que substitui
 * border-color. Pra ficar visível também precisa de `border-style` !== none.
 */
function BorderPaint({
  borderColor,
  borderImage,
  borderWidth,
  borderStyle,
  borderVisible,
  linkedVariable,
  resolvedTokenColor,
  onApply,
  onToggleVisibility,
  onClearBorder,
  onUnlinkVariable,
  onOpenTokenPicker,
}: {
  borderColor: string;
  borderImage: string;
  borderWidth?: string;
  borderStyle?: string;
  /** Cursor pattern: strokeVisible signal. True = border renders (style!=none && width>0). */
  borderVisible: boolean;
  /** Cursor pattern: linkedVariable signal — set when borderColor is var(--xxx). */
  linkedVariable: string | null;
  /** Resolved rgb() do token linkado, pro swatch preview. */
  resolvedTokenColor: string;
  onApply: (property: string, value: string) => void;
  /** Cursor H5: alternates border-style:none ↔ solid + ensures width≥1px. */
  onToggleVisibility: () => void;
  /** Cursor Ox: remove the border entirely. */
  onClearBorder: () => void;
  onUnlinkVariable: () => void;
  onOpenTokenPicker?: () => void;
}) {
  const borderImageSource = borderImage.replace(/\s+\d+(\s+\w+)?$/, '');
  const [type, setType] = useState<GradientType>(() => detectGradientType(borderImageSource));
  const [config, setConfig] = useState<GradientConfig>(() => {
    const detected = detectGradientType(borderImageSource);
    if (detected === 'solid') return DEFAULT_GRADIENT_CONFIG;
    return parseGradientCss(borderImageSource) || { ...DEFAULT_GRADIENT_CONFIG, type: detected as GradientConfig['type'] };
  });

  useEffect(() => {
    const externalType = detectGradientType(borderImageSource);
    setType(externalType);
    if (externalType !== 'solid') {
      const parsed = parseGradientCss(borderImageSource);
      if (parsed) setConfig(parsed);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [borderImageSource]);

  const applyGradient = (cfg: GradientConfig): void => {
    setConfig(cfg);
    onApply('border-image', `${formatGradient(cfg)} 1`);
  };

  const switchType = (newType: GradientType): void => {
    setType(newType);
    if (newType === 'solid') {
      // Cursor pattern: limpa border-image COMPLETO (color + width 1 stretch).
      // String vazia '' não reseta em alguns engines — usar 'none'.
      onApply('border-image', 'none');
      onApply('border-image-source', 'none');
      onApply('border-image-slice', '100%');
      if (!borderColor || borderColor === 'transparent') {
        onApply('border-color', '#000000');
      }
      return;
    }
    if (!borderStyle || borderStyle === 'none') onApply('border-style', 'solid');
    const widthNum = parseFloat((borderWidth || '0').replace(/[^0-9.]/g, ''));
    if (Number.isNaN(widthNum) || widthNum <= 0) onApply('border-width', '1px');
    const next: GradientConfig = config.type === newType ? config : { ...config, type: newType };
    setConfig(next);
    onApply('border-image', `${formatGradient(next)} 1`);
  };

  return (
    <>
      {/* Cursor pattern (Pfw): gradient type dropdown FIRST */}
      <GradientTypeDropdown current={type} onChange={switchType} />
      {type === 'solid' ? (
        /*
         * Cursor pattern (Ifw template): stroke-row é UMA ÚNICA ROW horizontal.
         * Visual screenshot Cursor: [color input flex:1] [row-actions flex:0 0 auto]
         * Color input à esquerda, row-actions (eye + clear) à direita.
         */
        <div className="css-stroke-row">
          {linkedVariable ? (
            <LinkedTokenButton
              tokenName={linkedVariable}
              resolvedColor={resolvedTokenColor}
              onClickToken={() => onOpenTokenPicker?.()}
              onUnlink={onUnlinkVariable}
            />
          ) : (
            <ColorInputRow value={borderColor} onApply={(v) => onApply('border-color', v)} />
          )}
          <div className="css-stroke-row-actions">
            <button
              type="button"
              className={`css-stroke-action ${borderVisible ? 'active' : ''}`}
              title={borderVisible ? 'Hide border' : 'Show border'}
              aria-label={borderVisible ? 'Hide border' : 'Show border'}
              onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
            >
              <i className={`codicon codicon-${borderVisible ? 'eye' : 'eye-closed'}`} />
            </button>
            <button
              type="button"
              className="css-stroke-action"
              title="Remove border"
              aria-label="Remove border"
              onClick={(e) => { e.stopPropagation(); onClearBorder(); }}
            >
              <i className="codicon codicon-chrome-minimize" />
            </button>
          </div>
        </div>
      ) : (
        <GradientEditorMVP
          config={config}
          onChange={applyGradient}
          onRemove={onClearBorder}
        />
      )}
    </>
  );
}

function GradientTypeDropdown({
  current,
  onChange,
}: {
  current: GradientType;
  onChange: (type: GradientType) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const OPTIONS: Array<{ value: GradientType; label: string }> = [
    { value: 'solid', label: 'Solid' },
    { value: 'linear', label: 'Linear' },
    { value: 'radial', label: 'Radial' },
    { value: 'conic', label: 'Conic' },
  ];
  const currentLabel = OPTIONS.find((o) => o.value === current)?.label || 'Solid';

  return (
    <div ref={ref} className="css-gradient-type-row" style={{ position: 'relative' }}>
      <button
        type="button"
        className="css-gradient-type-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((p) => !p)}
      >
        <span className="css-gradient-type-label">{currentLabel}</span>
        <i className="codicon codicon-chevron-down" />
      </button>
      {open && (
        <div className="css-gradient-type-menu">
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`css-gradient-type-menu-item ${current === opt.value ? 'is-active' : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              <span>{opt.label}</span>
              {current === opt.value && <i className="codicon codicon-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * ColorInputRow — replica `jfw` template do Cursor:
 *   [color swatch] [hex input] | [opacity input %]
 */
function ColorInputRow({
  value,
  onApply,
}: {
  value: string;
  onApply: (val: string) => void;
}) {
  /*
   * Parse rgb/rgba/hex → hex + opacity.
   *
   * `isNone`: sentinel pra quando property NÃO está aplicada (ex: border-color
   * ausente porque elemento não tem border). Antes o fallback retornava
   * `#000000` + opacity 100 → user via swatch preto e achava que o elemento
   * tinha border preta.
   *
   * Cases tratados como "None":
   *   - vazio (`''`, `'   '`)
   *   - palavras-chave CSS: `none`, `transparent`, `inherit`, `initial`,
   *     `unset`, `revert`, `currentcolor` (herda, não tem valor próprio)
   *   - `rgba(_, _, _, 0)` (alpha zero — Cursor trata como sem cor)
   *
   * Match Figma/Webflow: swatch checkerboard + label "None".
   */
  const parseColor = (v: string): { hex: string; opacity: number; isNone: boolean } => {
    const trimmed = (v || '').trim();
    const lower = trimmed.toLowerCase();
    if (
      trimmed === '' ||
      lower === 'none' ||
      lower === 'transparent' ||
      lower === 'inherit' ||
      lower === 'initial' ||
      lower === 'unset' ||
      lower === 'revert' ||
      lower === 'currentcolor'
    ) {
      return { hex: '#000000', opacity: 0, isNone: true };
    }
    const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1], 10);
      const g = parseInt(rgbMatch[2], 10);
      const b = parseInt(rgbMatch[3], 10);
      const a = rgbMatch[4] ? parseFloat(rgbMatch[4]) : 1;
      // Alpha 0 = sem cor visível, igual transparent.
      if (a === 0) return { hex: '#000000', opacity: 0, isNone: true };
      const hex = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0').toUpperCase()).join('');
      return { hex, opacity: Math.round(a * 100), isNone: false };
    }
    if (/^#[0-9a-f]{6}$/i.test(trimmed)) return { hex: trimmed.toUpperCase(), opacity: 100, isNone: false };
    if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
      const expanded = '#' + trimmed.slice(1).split('').map((c) => c + c).join('').toUpperCase();
      return { hex: expanded, opacity: 100, isNone: false };
    }
    if (/^#[0-9a-f]{8}$/i.test(trimmed)) {
      // #RRGGBBAA — hex com alpha.
      const r = parseInt(trimmed.slice(1, 3), 16);
      const g = parseInt(trimmed.slice(3, 5), 16);
      const b = parseInt(trimmed.slice(5, 7), 16);
      const a = parseInt(trimmed.slice(7, 9), 16) / 255;
      if (a === 0) return { hex: '#000000', opacity: 0, isNone: true };
      const hex = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0').toUpperCase()).join('');
      return { hex, opacity: Math.round(a * 100), isNone: false };
    }
    // Valor não reconhecido (named color, hsl, etc) — não chama de "None",
    // só mostra fallback preto pra user poder editar.
    return { hex: '#000000', opacity: 100, isNone: false };
  };
  const { hex, opacity, isNone } = parseColor(value);
  const apply = (h: string, o: number): void => {
    const cleanHex = h.startsWith('#') ? h : `#${h}`;
    if (o === 100) {
      onApply(cleanHex);
    } else {
      const m = cleanHex.match(/^#([0-9a-f]{6})$/i);
      if (!m) return;
      const r = parseInt(m[1].slice(0, 2), 16);
      const g = parseInt(m[1].slice(2, 4), 16);
      const b = parseInt(m[1].slice(4, 6), 16);
      onApply(`rgba(${r}, ${g}, ${b}, ${(o / 100).toFixed(2)})`);
    }
  };

  /*
   * Draft state pattern (mesmo do borderWidth):
   * Input controlled pelo draft local, commit no blur/Enter.
   * Bug original: `value={hex}` + onChange só aplicando se regex completa
   * → user digita parcial (ex "#0000") → regex falha → apply não chama
   * → estado externo não muda → re-render restaura hex original
   * → user não consegue editar.
   *
   * Solução: draft é fonte de verdade durante edição; commit valida no blur.
   */
  const [hexDraft, setHexDraft] = useState(hex);
  const [hexFocused, setHexFocused] = useState(false);
  useEffect(() => {
    if (!hexFocused) setHexDraft(hex);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex, hexFocused]);
  const commitHex = (): void => {
    const v = hexDraft.trim();
    const withHash = v.startsWith('#') ? v : `#${v}`;
    if (/^#[0-9a-f]{6}$/i.test(withHash) || /^#[0-9a-f]{3}$/i.test(withHash)) {
      // Se estávamos em "None" (opacity=0), commitar com opacity=100 — senão
      // gera rgba(_,_,_,0) que re-parseia como None e a edição "some".
      const commitOpacityValue = isNone ? 100 : opacity;
      apply(withHash.toUpperCase(), commitOpacityValue);
    } else if (isNone) {
      // None + input inválido (incluindo vazio) → fica None.
      setHexDraft('');
    } else {
      setHexDraft(hex); // reverte se inválido
    }
  };

  // Mesmo pattern pro opacity (number input)
  const [opacityDraft, setOpacityDraft] = useState(String(opacity));
  const [opacityFocused, setOpacityFocused] = useState(false);
  useEffect(() => {
    if (!opacityFocused) setOpacityDraft(String(opacity));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opacity, opacityFocused]);
  const commitOpacity = (): void => {
    const v = opacityDraft.trim();
    if (v === '') { setOpacityDraft(String(opacity)); return; }
    const n = parseFloat(v);
    if (Number.isNaN(n)) { setOpacityDraft(String(opacity)); return; }
    apply(hex, Math.max(0, Math.min(100, Math.round(n))));
  };

  /*
   * Render "None" state quando property não está aplicada.
   * Visual: swatch checkerboard (CSS gradient) + label "None" no hex input.
   * Native color picker permanece clicável — quando user escolhe cor, `onApply`
   * commita valor real → próximo render volta pro state normal.
   * Default do picker quando isNone: branco (#FFFFFF) — match Figma.
   */
  if (isNone) {
    const noneDefault = '#FFFFFF';
    return (
      <div className="css-color-input-container">
        <input
          ref={(el) => {
            if (el && document.activeElement !== el) {
              el.value = noneDefault.toLowerCase();
            }
          }}
          className="css-color-swatch-inline css-color-swatch-none"
          type="color"
          defaultValue={noneDefault.toLowerCase()}
          title="No color — click to set"
          aria-label="No color — click to set"
          onInput={(e) => apply((e.currentTarget as HTMLInputElement).value.toUpperCase(), 100)}
          onChange={(e) => apply(e.currentTarget.value.toUpperCase(), 100)}
        />
        <input
          className="css-hex-input css-hex-input-none"
          type="text"
          spellCheck={false}
          value={hexFocused ? hexDraft : 'None'}
          placeholder="None"
          onChange={(e) => setHexDraft(e.currentTarget.value)}
          onFocus={(e) => {
            setHexFocused(true);
            // Limpa "None" pra user digitar hex direto.
            setHexDraft('');
            // Próximo tick (depois do React render) limpa também o DOM value.
            requestAnimationFrame(() => { e.target.value = ''; });
          }}
          onBlur={() => { setHexFocused(false); commitHex(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            if (e.key === 'Escape') { setHexDraft(hex); (e.currentTarget as HTMLInputElement).blur(); }
          }}
        />
      </div>
    );
  }

  return (
    <div className="css-color-input-container">
      {/*
       * Native color picker (input type=color) — uncontrolled.
       * React controlled de type=color conflita com native picker (events drop).
       * Sem `key`: native picker mantém estado interno durante drag (mouse-track).
       * Sync com external via useEffect + ref (atualiza só quando muda fora).
       * onInput dispara continuous durante drag; onChange no commit final.
       */}
      <input
        ref={(el) => {
          if (el && el.value.toLowerCase() !== hex.toLowerCase() && document.activeElement !== el) {
            el.value = hex.toLowerCase();
          }
        }}
        className="css-color-swatch-inline"
        type="color"
        defaultValue={hex.toLowerCase()}
        onInput={(e) => apply((e.currentTarget as HTMLInputElement).value.toUpperCase(), opacity)}
        onChange={(e) => apply(e.currentTarget.value.toUpperCase(), opacity)}
      />
      <input
        className="css-hex-input"
        type="text"
        spellCheck={false}
        value={hexDraft}
        onChange={(e) => setHexDraft(e.currentTarget.value)}
        onFocus={() => setHexFocused(true)}
        onBlur={() => { setHexFocused(false); commitHex(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
          if (e.key === 'Escape') { setHexDraft(hex); (e.currentTarget as HTMLInputElement).blur(); }
        }}
      />
      <div className="css-input-separator" />
      <div className="css-opacity-input-inline css-input-field">
        <input
          className="css-number-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={opacityDraft}
          onChange={(e) => setOpacityDraft(e.currentTarget.value)}
          onFocus={() => setOpacityFocused(true)}
          onBlur={() => { setOpacityFocused(false); commitOpacity(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            if (e.key === 'Escape') { setOpacityDraft(String(opacity)); (e.currentTarget as HTMLInputElement).blur(); }
          }}
        />
        <span
          className="css-input-suffix css-input-suffix-draggable"
          title="Drag to adjust opacity"
          aria-label="Drag to adjust opacity"
        >%</span>
      </div>
    </div>
  );
}

/**
 * ReactSections — replica `yfw` + `_fw` do Cursor.
 *
 * Renderiza duas sections (Properties + Children) APENAS quando há React
 * component detectado. Senão retorna null.
 *
 * Detection real do Cursor:
 *   - preload-webview hookeia React DevTools global (`__REACT_DEVTOOLS_GLOBAL_HOOK__`)
 *   - Pra cada element selecionado, busca Fiber instance via `_reactRootContainer`
 *     ou `__reactFiber$XXX` property
 *   - Extrai component name (function/class display name) e props
 *   - Lista children Fiber (filhos diretos) com nomes
 *
 * Nosso (V1): stub. preload precisaria implementar detection. Quando
 * `element.reactComponent` chega, exibe.
 *
 * Limites Cursor: max 100 children, max depth 10.
 */
function ReactSections({ element }: { element: InspectedElement }) {
  const rc = element.reactComponent;
  const [propsCollapsed, togglePropsCollapsed] = useCollapseState('react-properties');
  const [childrenCollapsed, toggleChildrenCollapsed] = useCollapseState('react-children');
  if (!rc) return null;

  const propsEntries = rc.props ? Object.entries(rc.props) : [];
  const children = rc.children || [];
  const childCount = rc.childCount ?? children.length;

  return (
    <>
      {/* Properties section */}
      <section className="css-inspector-section css-react-section" data-collapsed={propsCollapsed}>
        <div className="css-section-header">
          <div className="css-section-header-title-group">
            <button
              type="button"
              className="css-section-collapse-toggle"
              aria-label={propsCollapsed ? 'Expand Properties' : 'Collapse Properties'}
              aria-expanded={!propsCollapsed}
              onClick={togglePropsCollapsed}
            >
              <i className={`codicon codicon-chevron-${propsCollapsed ? 'right' : 'down'}`} />
            </button>
            <div className="css-section-title">
              Properties{rc.name ? ` · ${rc.name}` : ''}
            </div>
          </div>
        </div>
        <div className="css-section-body css-react-props-list">
          {propsEntries.length === 0 ? (
            <div className="css-react-no-props">No props</div>
          ) : (
            propsEntries.map(([key, value]) => (
              <div key={key} className="css-react-prop-row">
                <span className="css-react-prop-key">{key}</span>
                <span className="css-react-prop-value">
                  {typeof value === 'string'
                    ? `"${value}"`
                    : typeof value === 'function'
                    ? 'ƒ()'
                    : value === null
                    ? 'null'
                    : value === undefined
                    ? 'undefined'
                    : typeof value === 'object'
                    ? Array.isArray(value) ? `Array(${value.length})` : 'Object'
                    : String(value)}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Children section */}
      {childCount > 0 && (
        <section className="css-inspector-section css-react-section css-react-children-section" data-collapsed={childrenCollapsed}>
          <div className="css-section-header">
            <div className="css-section-header-title-group">
              <button
                type="button"
                className="css-section-collapse-toggle"
                aria-label={childrenCollapsed ? 'Expand Children' : 'Collapse Children'}
                aria-expanded={!childrenCollapsed}
                onClick={toggleChildrenCollapsed}
              >
                <i className={`codicon codicon-chevron-${childrenCollapsed ? 'right' : 'down'}`} />
              </button>
              <div className="css-section-title">Children ({childCount})</div>
            </div>
          </div>
          <div className="css-section-body css-react-children-list">
            {children.length === 0 ? (
              <div className="css-react-no-props">Children not loaded</div>
            ) : (
              children.slice(0, 100).map((c, i) => (
                <div key={`${c.name}-${i}`} className="css-react-child-row">
                  <span>{c.name}</span>
                </div>
              ))
            )}
            {children.length > 100 && (
              <div className="css-react-truncated-notice">
                Showing first 100 children (max depth: 10)
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}

/**
 * ColorTokensPickerButton — generic dropdown picker pra CSS custom properties
 * que resolvem pra cores. Replica Cursor `bt` (color tokens picker do
 * BorderSection/BackgroundSection). Bundle Cursor (oW0/VG0):
 *
 *   const z = He(() => n.cssVariableColorOptions().length > 0);
 *   bt.addEventListener("mouseenter", () => {
 *     V(r, z() ? "Choose from available color tokens" : "No color tokens detected");
 *   });
 *   bt.addEventListener("click", he);  // abre popover _8
 *
 * Scan no preview webview: stylesheets (rules em :root/html/body) + computed
 * style do documentElement/body, filtra custom props que parseiam como cor.
 * Click no item → onPick(varName) — caller aplica em background-color/border-color
 * via `var(--token)`.
 */
function ColorTokensPickerButton({
  currentValue,
  onPick,
  onPreviewColor,
  onRestorePreview,
}: {
  /** Valor CSS atual da propriedade (ex: borderColor ou backgroundColor) —
   * usado pra marcar checkmark se já estiver linkado a um token. */
  currentValue: string;
  /** Chamado com o nome do token selecionado (ex: "--accent"). Caller decide
   * como aplicar (ex: background-color: var(--accent) + force opaque). */
  onPick: (varName: string) => void;
  /** Cursor pattern: hover preview — apply color temporariamente no mouse enter. */
  onPreviewColor?: (color: string) => void;
  /** Cursor pattern: restore cor original ao sair do item. */
  onRestorePreview?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<Array<{ name: string; value: string; color: string; hex?: string; isTailwindToken?: boolean }>>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const linkedM = (currentValue || '').trim().match(/^var\((--[a-zA-Z0-9_-]+)/);
  const linkedToken = linkedM ? linkedM[1] : null;

  // Scan tokens from preview webview on first open
  useEffect(() => {
    if (!open || loaded) return;
    const wv = document.querySelector('.preview-webview') as
      | { executeJavaScript?: (code: string, gesture?: boolean) => Promise<unknown> }
      | null;
    if (!wv?.executeJavaScript) {
      setLoaded(true);
      return;
    }
    // Cursor pattern (collectCssVariables + convertColorToHex):
    //   1. Itera stylesheets coletando NOMES de custom props + @property rules
    //   2. Pra cada nome, lê rootStyle.getPropertyValue (resolved value se @property
    //      tem syntax:<color> — Tailwind v4 puro HSL vira rgb() resolvido)
    //   3. convertColorToHex via Canvas 2D fillStyle — parseia oklch/oklab/lab/lch
    //   4. Fallback pra @property initial-value se computed vazio
    const script = `(function(){
      try {
        // Canvas-based color parser — Cursor's convertColorToHex.
        // Aceita QUALQUER cor que Canvas parseia: hex, rgb, hsl, oklch, oklab, lab, lch, named.
        var canvas = document.createElement('canvas');
        canvas.width = 1; canvas.height = 1;
        var ctx = canvas.getContext('2d');
        // Cursor pattern (literal): aceita ANY valor. Se Canvas falha em parsear,
        // fillStyle mantém previous → fillRect pinta com previous → pixel reflete
        // previous color. Token aparece com swatch fallback (preto/branco) mas
        // APARECE na lista. Não tenta validar — deixa Canvas decidir.
        var convertColorToHex = function(v) {
          if (!v || v === 'transparent' || v === 'rgba(0, 0, 0, 0)') return null;
          try {
            // Reset previous fillStyle pra known sentinel (#000000) antes de tentar.
            // Se o valor for inválido, fillStyle mantém #000000 → swatch preto.
            ctx.fillStyle = '#000000';
            ctx.fillStyle = v; // tenta o valor — se inválido, mantém #000
            ctx.clearRect(0,0,1,1);
            ctx.fillRect(0,0,1,1);
            var d = ctx.getImageData(0,0,1,1).data;
            // Se pixel totalmente transparente (algumas falhas dão isso), pula
            if (d[3] === 0) return null;
            var hex = '#' + [d[0],d[1],d[2]].map(function(x){ return x.toString(16).padStart(2,'0'); }).join('').toUpperCase();
            var resolved = 'rgb(' + d[0] + ', ' + d[1] + ', ' + d[2] + ')';
            return { hex: hex, resolved: resolved };
          } catch(e) { return null; }
        };

        // Coleta NOMES de custom props de TODOS os stylesheets (Cursor pattern).
        // Inclui @property rules (Tailwind v4: type 15 = CSSPropertyRule).
        var names = new Set();
        var propertyRuleValues = new Map();
        var collectFromRules = function(rules) {
          if (!rules) return;
          for (var i=0; i<rules.length; i++) {
            var rule = rules[i];
            if (!rule) continue;
            // @property rule (Tailwind v4) — type 15
            if (rule.type === 15 && rule.name && typeof rule.name === 'string') {
              if (rule.name.charCodeAt(0) === 45 && rule.name.charCodeAt(1) === 45) {
                names.add(rule.name);
                if (rule.initialValue) propertyRuleValues.set(rule.name, rule.initialValue);
              }
            }
            // Style rule — coleta declared custom props
            var style = rule.style;
            if (style && style.length > 0) {
              for (var j=0; j<style.length; j++) {
                var p = style[j];
                if (p && p.charCodeAt(0) === 45 && p.charCodeAt(1) === 45) {
                  names.add(p);
                }
              }
            }
            // Nested rules (@media, @supports, @layer)
            if (rule.cssRules) collectFromRules(rule.cssRules);
          }
        };
        for (var s=0; s<document.styleSheets.length; s++) {
          try { collectFromRules(document.styleSheets[s].cssRules); }
          catch(e) { /* CORS */ }
        }
        // Inline styles do documentElement
        var inline = document.documentElement && document.documentElement.style;
        if (inline) {
          for (var k=0; k<inline.length; k++) {
            var pi = inline[k];
            if (pi && pi.charCodeAt(0) === 45 && pi.charCodeAt(1) === 45) names.add(pi);
          }
        }
        // ALSO add computed style props — pega vars que CORS-protected stylesheets
        // ou JS-injected runtime. Cursor faz fallback se stylesheet vazio; nós
        // SEMPRE adicionamos pra max coverage.
        try {
          var rootComputed = getComputedStyle(document.documentElement);
          for (var ri=0; ri<rootComputed.length; ri++) {
            var rp = rootComputed[ri];
            if (rp && rp.charCodeAt(0) === 45 && rp.charCodeAt(1) === 45) names.add(rp);
          }
        } catch(e) {}
        try {
          var bodyComputed = getComputedStyle(document.body);
          for (var bi=0; bi<bodyComputed.length; bi++) {
            var bp = bodyComputed[bi];
            if (bp && bp.charCodeAt(0) === 45 && bp.charCodeAt(1) === 45) names.add(bp);
          }
        } catch(e) {}

        // Resolve cada nome via rootStyle.getPropertyValue (browser resolve @property)
        var rootStyle = getComputedStyle(document.documentElement);
        var results = [];
        var seen = new Set();
        names.forEach(function(name) {
          if (seen.has(name)) return;
          var raw = rootStyle.getPropertyValue(name);
          if (!raw && propertyRuleValues.has(name)) raw = propertyRuleValues.get(name);
          if (!raw) return;
          raw = raw.trim();
          if (!raw) return;
          // Skip valores claramente NÃO-color
          if (/^["']/.test(raw)) return;
          if (/,\\s*(serif|sans-serif|monospace|cursive|fantasy)/i.test(raw)) return;
          if (/^url\\(/i.test(raw)) return;
          if (/\\d+\\s*(px|em|rem|vw|vh|s|ms|deg)\\b/i.test(raw)) return;
          if (raw.split(/\\s+/).length > 6) return;

          // UNDRCOD addition: detect raw HSL coords (Tailwind v3 pattern):
          //   "0 0% 100%" → "hsl(0 0% 100%)"
          //   "210 85% 50% / 0.5" → "hsl(210 85% 50% / 0.5)"
          // Same for OKLCH/OKLAB raw coords (Tailwind v4):
          //   "0.7 0.15 200" → "oklch(0.7 0.15 200)"
          // Canvas resolve via browser, swatch fica colorido.
          var canvasInput = raw;
          // HSL raw: number + number% + number% (with optional /alpha)
          if (/^\\d+(?:\\.\\d+)?\\s+\\d+(?:\\.\\d+)?%\\s+\\d+(?:\\.\\d+)?%(?:\\s*\\/\\s*[\\d.]+)?$/.test(raw)) {
            canvasInput = 'hsl(' + raw + ')';
          }
          // OKLCH raw: number + number + number (with optional /alpha) — first ≤ 1.0
          else if (/^0?\\.\\d+\\s+\\d+(?:\\.\\d+)?\\s+\\d+(?:\\.\\d+)?(?:\\s*\\/\\s*[\\d.]+)?$/.test(raw)) {
            canvasInput = 'oklch(' + raw + ')';
          }

          var converted = convertColorToHex(canvasInput);
          if (!converted) return;
          seen.add(name);
          results.push({ name: name, value: raw, color: converted.resolved, hex: converted.hex });
        });

        // Cursor pattern: collectTailwindColorTokens — extrai cores de utility
        // classes (bg-red-500, text-[#ff0000], bg-black, etc.)
        var TAILWIND_PATTERNS = [
          { re: /^\\.(text-([a-z]+(?:-[a-z]+)*-\\d+|black|white|\\\\?\\[[^\\]]+\\\\?\\]))$/, prop: 'color' },
          { re: /^\\.(bg-([a-z]+(?:-[a-z]+)*-\\d+|black|white|\\\\?\\[[^\\]]+\\\\?\\]))$/, prop: 'background-color' },
          { re: /^\\.(border-([a-z]+(?:-[a-z]+)*-\\d+|black|white|\\\\?\\[[^\\]]+\\\\?\\]))$/, prop: 'border-color' },
          { re: /^\\.(ring-([a-z]+(?:-[a-z]+)*-\\d+|black|white|transparent|\\\\?\\[[^\\]]+\\\\?\\]))$/, prop: '--tw-ring-color' },
          { re: /^\\.(fill-([a-z]+(?:-[a-z]+)*-\\d+|black|white|\\\\?\\[[^\\]]+\\\\?\\]))$/, prop: 'fill' },
          { re: /^\\.(stroke-([a-z]+(?:-[a-z]+)*-\\d+|black|white|\\\\?\\[[^\\]]+\\\\?\\]))$/, prop: 'stroke' },
        ];
        var twSeen = new Set();
        for (var s2=0; s2<document.styleSheets.length; s2++) {
          try {
            var rules2 = document.styleSheets[s2].cssRules || [];
            for (var r2=0; r2<rules2.length; r2++) {
              var rule = rules2[r2];
              if (!rule || rule.type !== 1) continue; // STYLE_RULE only
              var selector = rule.selectorText;
              if (!selector) continue;
              for (var pi=0; pi<TAILWIND_PATTERNS.length; pi++) {
                var pat = TAILWIND_PATTERNS[pi];
                if (!pat.re.test(selector)) continue;
                var className = selector.slice(1); // strip leading dot
                if (twSeen.has(className)) continue;
                var twValue = rule.style.getPropertyValue(pat.prop);
                if (!twValue) continue;
                twValue = twValue.trim();
                // Handle Tailwind opacity pattern: rgb(R G B / var(--tw-X-opacity))
                var rgbM = twValue.match(/^rgba?\\(\\s*(\\d+)[\\s,]+(\\d+)[\\s,]+(\\d+)/);
                if (rgbM) twValue = 'rgb(' + rgbM[1] + ', ' + rgbM[2] + ', ' + rgbM[3] + ')';
                else if (twValue.includes('var(')) continue;
                var twConverted = convertColorToHex(twValue);
                if (!twConverted) continue;
                twSeen.add(className);
                results.push({ name: className, value: twValue, color: twConverted.resolved, hex: twConverted.hex, isTailwindToken: true });
                break;
              }
            }
          } catch(e) { /* CORS */ }
        }

        results.sort(function(a,b){ return a.name.localeCompare(b.name); });
        return results.slice(0, 500);
      } catch (e) { return []; }
    })()`;
    wv.executeJavaScript(script, false).then((result) => {
      if (Array.isArray(result)) setTokens(result as Array<{ name: string; value: string; color: string }>);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [open, loaded]);

  // Outside-click close
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onRestorePreview?.();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, onRestorePreview]);

  // Auto-focus search on open
  useEffect(() => {
    if (open && searchRef.current) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
    if (!open) setSearch('');
  }, [open]);

  const hasTokens = tokens.length > 0;
  const tip = loaded && !hasTokens ? 'No color tokens detected' : 'Choose token';

  // Cursor pattern: fuzzy filter — simple substring match on name + value
  const filtered = search.trim()
    ? tokens.filter((t) => {
        const q = search.trim().toLowerCase();
        return t.name.toLowerCase().includes(q) || t.value.toLowerCase().includes(q);
      })
    : tokens;

  // Cursor: "No color tokens detected" vs "No parseable color tokens found" vs "No matching tokens"
  const emptyMessage = !loaded
    ? 'Loading...'
    : !hasTokens
      ? 'No color tokens detected'
      : filtered.length === 0
        ? 'No matching tokens'
        : null;

  const closeMenu = (): void => {
    onRestorePreview?.();
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className={`css-section-action ${open ? 'active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={tip}
        aria-label="Color tokens"
        onClick={(e) => { e.stopPropagation(); setOpen((p) => !p); }}
      >
        <i className="codicon codicon-symbol-color" />
      </button>
      {open && (
        <div className="css-tokens-menu" role="menu">
          {/* Cursor pattern: search input shown when tokens exist */}
          {hasTokens && (
            <div className="css-tokens-menu-search">
              <input
                ref={searchRef}
                type="text"
                placeholder="Search tokens"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); }
                }}
              />
            </div>
          )}
          {emptyMessage && <div className="css-tokens-menu-empty">{emptyMessage}</div>}
          {filtered.map((t) => (
            <button
              key={t.name}
              type="button"
              role="menuitem"
              className={`css-tokens-menu-item ${linkedToken === t.name ? 'is-active' : ''}`}
              title={`${t.name}: ${t.value}`}
              onMouseEnter={() => onPreviewColor?.(t.color)}
              onMouseLeave={() => onRestorePreview?.()}
              onMouseUp={(e) => {
                e.stopPropagation();
                onPick(t.name);
                closeMenu();
              }}
            >
              <span
                className="css-tokens-menu-swatch"
                style={{ ['--css-inspector-token-color' as string]: t.color }}
              />
              <span className="css-tokens-menu-name">{t.name}</span>
              <span className="css-tokens-menu-value">{t.value}</span>
              {linkedToken === t.name && <i className="codicon codicon-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * LinkedTokenButton — Cursor pattern (_pw template).
 * When a CSS var is linked (currentValue = "var(--name)"), show this instead
 * of the regular hex input. Click to re-open picker, unlink button to clear.
 */
function LinkedTokenButton({
  tokenName,
  resolvedColor,
  onClickToken,
  onUnlink,
}: {
  tokenName: string;
  resolvedColor: string;
  onClickToken: () => void;
  onUnlink: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="css-color-token-button"
      onClick={(e) => { e.stopPropagation(); onClickToken(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClickToken(); }
      }}
    >
      <span
        className="css-color-token-swatch"
        style={{ ['--css-inspector-token-color' as string]: resolvedColor }}
      />
      <span className="css-color-token-name">{tokenName}</span>
      <button
        type="button"
        className="css-color-token-unlink"
        title="Unlink"
        onClick={(e) => { e.stopPropagation(); onUnlink(); }}
      >
        <i className="codicon codicon-close" />
      </button>
    </div>
  );
}

/**
 * BorderSection — réplica do Cursor (template Dfw).
 *
 * Estrutura igual Background (section + header + 2 actions + body com layers),
 * mas pra border. Adicional: Weight input + side selector (top/right/bottom/left
 * individual via css-stroke-side-button) + outline.
 *
 * Cursor template:
 *   <section class="css-inspector-section">
 *     <div>
 *       <div class="css-section-title">Border</div>
 *       <div class="css-section-actions">
 *         <button aria-haspopup="menu"><i></i></button>  <!-- color tokens -->
 *         <button><i></i></button>                        <!-- + add layer -->
 *       </div>
 *     </div>
 *     <div class="css-stroke-controls">...</div>
 *   </section>
 */
/**
 * Border side options — Cursor F5d table.
 * Default "all" aplica border-* genérico. Outras aplicam border-{side}-*.
 *
 * Cursor usa codicons `borderAll/borderTop/borderBottom/borderLeft/borderRight`
 * que NÃO existem na codicon font standard do UNDRCOD. Solução: SVG inline
 * customizado mostrando outline do retângulo + linha mais grossa no side ativo.
 */
type BorderSideValue = 'all' | 'top' | 'right' | 'bottom' | 'left';
const BORDER_SIDES: Array<{ value: BorderSideValue; label: string }> = [
  { value: 'all',    label: 'All' },
  { value: 'top',    label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left',   label: 'Left' },
  { value: 'right',  label: 'Right' },
];

/**
 * BorderSideIcon — SVG inline pra cada side (All/Top/Right/Bottom/Left).
 * All = retângulo completo; outros = retângulo fraco + linha grossa no side.
 * 14×14 viewBox pra match codicon size 14px.
 *
 * Renomeado de SideIcon pra não conflitar com `SideIcon` usado em Padding/Margin.
 */
function BorderSideIcon({ side }: { side: BorderSideValue }): JSX.Element {
  const isAll = side === 'all';
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeLinecap="square"
      aria-hidden="true"
    >
      {/* Base outline (faded se não All) */}
      <rect
        x="1.5"
        y="1.5"
        width="11"
        height="11"
        strokeWidth={isAll ? 1.5 : 1}
        opacity={isAll ? 1 : 0.3}
      />
      {/* Highlight no side ativo */}
      {side === 'top'    && <line x1="1.5"  y1="1.5"  x2="12.5" y2="1.5"  strokeWidth="2" />}
      {side === 'right'  && <line x1="12.5" y1="1.5"  x2="12.5" y2="12.5" strokeWidth="2" />}
      {side === 'bottom' && <line x1="1.5"  y1="12.5" x2="12.5" y2="12.5" strokeWidth="2" />}
      {side === 'left'   && <line x1="1.5"  y1="1.5"  x2="1.5"  y2="12.5" strokeWidth="2" />}
    </svg>
  );
}

function BorderSection({
  element,
  onApply,
}: {
  element: InspectedElement;
  onApply: (property: string, value: string) => void;
}) {
  const [collapsed, toggleCollapsed] = useCollapseState('border');
  const borderWidth = element.allStyles['border-width'] || '0px';
  const borderStyle = element.allStyles['border-style'] || 'none';
  const borderColor = element.allStyles['border-color'] || '';
  const widthMatch = borderWidth.match(/^(-?\d+(?:\.\d+)?)/);
  const widthNum = widthMatch ? parseFloat(widthMatch[1]) : 0;

  /*
   * Cursor pattern signals:
   *   dC = strokeVisible = border-style not empty/none/hidden
   *   Bb = hasStroke = width > 0 OR (style != none/hidden + color visible) OR has gradient
   *   linkedVariable = var(--xxx) extracted from border-color
   *   selectedStrokeSide = 'all' | 'top' | ... (default 'all')
   *
   * BUG CSS spec: quando border-style:none, browser força computed
   * border-width:0 (mesmo se inline tem 1px). Pra Add ficar disabled quando
   * border foi adicionado mas user clicou eye pra esconder, usamos um ref
   * que GUARDA o último width > 0 visto. Reset no element change ou no Clear.
   */
  const borderImage = element.allStyles['border-image'] || element.allStyles['border-image-source'] || '';
  const styleLower = (borderStyle || '').trim().toLowerCase();
  const borderVisible = styleLower !== '' && styleLower !== 'none' && styleLower !== 'hidden';
  const colorIsVisible = !!borderColor
    && borderColor.trim() !== ''
    && borderColor.trim() !== 'transparent'
    && borderColor.trim() !== 'rgba(0, 0, 0, 0)';

  // Lembra do último width > 0 — pra hasStroke continuar true mesmo quando
  // user esconde border (style:none → computed width vira 0).
  const rememberedWidthRef = useRef<number>(0);
  const lastElementUidRef = useRef<string>(element.uid);
  useEffect(() => {
    if (lastElementUidRef.current !== element.uid) {
      lastElementUidRef.current = element.uid;
      rememberedWidthRef.current = 0;
    }
  }, [element.uid]);
  useEffect(() => {
    if (widthNum > 0) rememberedWidthRef.current = widthNum;
  }, [widthNum]);

  const effectiveWidth = widthNum > 0 ? widthNum : rememberedWidthRef.current;
  const hasStroke = effectiveWidth > 0
    || (borderVisible && colorIsVisible)
    || (!!borderImage && borderImage !== 'none' && /gradient|url\(/i.test(borderImage));

  const linkedM = (borderColor || '').trim().match(/^var\((--[a-zA-Z0-9_-]+)/);
  const linkedVariable = linkedM ? linkedM[1] : null;
  const resolvedTokenColor = element.allStyles['border-color'] || borderColor || '';

  const [selectedSide, setSelectedSide] = useState<'all' | 'top' | 'right' | 'bottom' | 'left'>('all');
  const [sidePickerOpen, setSidePickerOpen] = useState(false);
  const sidePickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sidePickerOpen) return;
    const onClick = (e: MouseEvent): void => {
      if (sidePickerRef.current && !sidePickerRef.current.contains(e.target as Node)) {
        setSidePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [sidePickerOpen]);

  const currentSide = BORDER_SIDES.find((s) => s.value === selectedSide) || BORDER_SIDES[0];

  /*
   * Cursor pattern: hover preview state pra token picker.
   * previewRef guarda o valor original; aplica preview no hover, restaura no leave.
   */
  const previewRef = useRef<string | null>(null);
  const onPreviewColor = (color: string): void => {
    if (!previewRef.current) previewRef.current = borderColor;
    onApply('border-color', color);
  };
  const onRestorePreview = (): void => {
    if (previewRef.current !== null) {
      onApply('border-color', previewRef.current);
      previewRef.current = null;
    }
  };

  /*
   * Cursor H5 — onToggleStrokeVisibility:
   *   - Se invisible → set style=solid + width≥1px (usa rememberedWidth se >0).
   *   - Se visible → set style=none (hide, but keep color/width).
   */
  const onToggleVisibility = (): void => {
    if (borderVisible) {
      onApply('border-style', 'none');
    } else {
      onApply('border-style', 'solid');
      if (widthNum <= 0) {
        // Restore último width lembrado (caso user tenha hidden com width X)
        const restore = rememberedWidthRef.current > 0 ? rememberedWidthRef.current : 1;
        onApply('border-width', `${restore}px`);
      }
    }
  };

  /*
   * Cursor Ox — onClearStroke: remove border entirely.
   * Literal: width=0px, color=rgba(0,0,0,0), style=none, border-image=none.
   * Reset rememberedWidth pra Add reabilitar.
   */
  const onClearBorder = (): void => {
    rememberedWidthRef.current = 0;
    onApply('border-width', '0px');
    onApply('border-color', 'rgba(0, 0, 0, 0)');
    onApply('border-style', 'none');
    onApply('border-image', 'none');
  };

  /*
   * Unlink token: substitui var() pela cor resolvida (oW0.onUnlinkVariable).
   */
  const onUnlinkVariable = (): void => {
    const resolved = element.allStyles['border-color'] || '#000000';
    onApply('border-color', resolved);
  };
  // Draft state pro Weight input: permite que user limpe o campo com Backspace.
  // Bug anterior: input controlled bound a `Math.round(widthNum)` com guard
  // `if (!Number.isNaN(n)) onApply(...)` no onChange — quando user apagava
  // o ultimo char, parseFloat('') = NaN → guard skip → state externo nao mudava
  // → React re-renderizava com o value antigo → Backspace parecia nao responder.
  // Solucao: draft local controla o input; commit no blur/Enter. Mesmo pattern
  // do UnitInput.
  const widthDisplay = String(Math.round(widthNum));
  const [widthDraft, setWidthDraft] = useState(widthDisplay);
  const [widthFocused, setWidthFocused] = useState(false);
  useEffect(() => {
    if (!widthFocused) setWidthDraft(widthDisplay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [borderWidth, widthFocused]);
  const commitWidth = (): void => {
    const v = widthDraft.trim();
    if (v === '') {
      // Vazio → mantem valor atual (nao forca 0 pra nao surpreender o user
      // que apagou pra digitar outro valor mas perdeu o foco antes).
      setWidthDraft(widthDisplay);
      return;
    }
    const n = parseFloat(v);
    if (Number.isNaN(n)) {
      setWidthDraft(widthDisplay);
      return;
    }
    onApply('border-width', `${Math.max(0, Math.round(n))}px`);
  };

  return (
    <section className="css-inspector-section" data-collapsed={collapsed}>
      <div className="css-section-header">
        <div className="css-section-header-title-group">
          <button
            type="button"
            className="css-section-collapse-toggle"
            aria-label={collapsed ? 'Expand Border' : 'Collapse Border'}
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
          >
            <i className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} />
          </button>
          <div className="css-section-title">Border</div>
        </div>
        <div className="css-section-actions">
          {/* Color tokens picker — Cursor bt button (oW0) */}
          <ColorTokensPickerButton
            currentValue={borderColor}
            onPick={(varName) => {
              previewRef.current = null;
              onApply('border-color', `var(${varName})`);
              onApply('border-style', 'solid');
            }}
            onPreviewColor={onPreviewColor}
            onRestorePreview={onRestorePreview}
          />
          <button
            type="button"
            className="css-section-action"
            title={hasStroke ? 'Border already added' : 'Add border'}
            aria-label="Add border"
            disabled={hasStroke}
            onClick={(e) => {
              // Cursor Nk literal: sempre cria stroke utilizável (1px, black, solid).
              // Reset selectedSide → 'all' pra apply genérico.
              e.stopPropagation();
              if (hasStroke) return;
              setSelectedSide('all');
              rememberedWidthRef.current = 1;
              // Cursor pattern: reset border-image também (limpa gradient residual)
              onApply('border-image', 'none');
              onApply('border-style', 'solid');
              onApply('border-width', '1px');
              onApply('border-color', 'rgba(0, 0, 0, 1)');
            }}
          >
            <i className="codicon codicon-add" />
          </button>
        </div>
      </div>
      {/*
       * Cursor pattern: <Show when={hasStroke}>body</Show>. Body só renderiza
       * quando há stroke. Quando user clica Clear (—), hasStroke vira false e
       * body inteiro some — só o header com Add habilitado fica visível.
       */}
      {hasStroke && <div className="css-stroke-controls">
        {/*
         * Cursor pattern (literal): ordem dos elementos
         *   1° BorderPaint = gradient type dropdown FIRST, then stroke-row (solid) or gradient editor
         *   2° Meta row = Weight + Style (extra UNDRCOD) + Side button
         */}
        <BorderPaint
          borderColor={borderColor}
          borderImage={element.allStyles['border-image'] || element.allStyles['border-image-source'] || ''}
          borderWidth={borderWidth}
          borderStyle={borderStyle}
          borderVisible={borderVisible}
          linkedVariable={linkedVariable}
          resolvedTokenColor={resolvedTokenColor}
          onApply={onApply}
          onToggleVisibility={onToggleVisibility}
          onClearBorder={onClearBorder}
          onUnlinkVariable={onUnlinkVariable}
          onOpenTokenPicker={() => {
            // Programmatic click no token picker button do header
            const btn = document.querySelector('.css-inspector-section[data-collapsed="false"] .css-section-actions .css-section-action[aria-haspopup="menu"]') as HTMLButtonElement | null;
            btn?.click();
          }}
        />
        {/* Meta row — Cursor Rfw: Weight + Side button (UNDRCOD adiciona Style entre eles) */}
        <div className="css-stroke-meta-row">
          {/* Weight (Cursor field) */}
          <div className="css-stroke-field">
            <label className="css-stroke-field-label">Weight</label>
            <div className="css-stroke-weight-input">
              <ScrubLabel
                getValue={() => Math.round(widthNum)}
                onChange={(v) => onApply('border-width', `${Math.max(0, Math.round(v))}px`)}
                min={0}
                ariaLabel="Drag to adjust stroke weight"
                className="css-stroke-weight-drag"
              >
                <i aria-hidden="true" className="codicon codicon-symbol-ruler" />
              </ScrubLabel>
              <div className="css-input-field">
                <input
                  className="css-number-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-label="Stroke weight"
                  value={widthDraft}
                  onChange={(e) => setWidthDraft(e.currentTarget.value)}
                  onFocus={() => setWidthFocused(true)}
                  onBlur={() => { setWidthFocused(false); commitWidth(); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                    if (e.key === 'Escape') { setWidthDraft(widthDisplay); (e.currentTarget as HTMLInputElement).blur(); }
                  }}
                />
                <span className="css-input-suffix">px</span>
              </div>
            </div>
          </div>
          {/* Style dropdown — EXTRA UNDRCOD (Cursor não tem) */}
          <div className="css-stroke-field">
            <label className="css-stroke-field-label">Style</label>
            <select
              className="css-select"
              value={borderStyle}
              onChange={(e) => onApply('border-style', e.currentTarget.value)}
              aria-label="Border style"
            >
              <option value="none">none</option>
              <option value="solid">solid</option>
              <option value="dashed">dashed</option>
              <option value="dotted">dotted</option>
              <option value="double">double</option>
              <option value="groove">groove</option>
              <option value="ridge">ridge</option>
              <option value="inset">inset</option>
              <option value="outset">outset</option>
            </select>
          </div>
          {/* Side button — Cursor css-stroke-side-button (todos os 4 lados ou um específico) */}
          <div className="css-stroke-side-button" ref={sidePickerRef}>
            <button
              type="button"
              className="css-stroke-side-trigger-button"
              title={`Apply stroke to ${currentSide.label}`}
              aria-label="Choose stroke sides"
              aria-haspopup="menu"
              aria-expanded={sidePickerOpen}
              onClick={(e) => { e.stopPropagation(); setSidePickerOpen((p) => !p); }}
            >
              <BorderSideIcon side={selectedSide} />
            </button>
            {sidePickerOpen && (
              <div className="css-side-picker-menu" role="menu">
                {BORDER_SIDES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    role="menuitem"
                    className={`css-side-picker-item ${selectedSide === s.value ? 'is-active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedSide(s.value);
                      setSidePickerOpen(false);
                    }}
                  >
                    <BorderSideIcon side={s.value} />
                    <span>{s.label}</span>
                    {selectedSide === s.value && <i className="codicon codicon-check" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>}
      {/* Outline (extras foldable) */}
      <details className="css-bg-advanced">
        <summary>Outline</summary>
        <EditRow label="Outline" prop="outline" value={element.allStyles['outline'] || ''} onApply={onApply} />
        <EditRow label="Outline color" prop="outline-color" value={element.allStyles['outline-color'] || ''} onApply={onApply} />
        <EditRow label="Outline style" prop="outline-style" value={element.allStyles['outline-style'] || ''} onApply={onApply} />
        <EditRow label="Outline offset" prop="outline-offset" value={element.allStyles['outline-offset'] || ''} onApply={onApply} />
      </details>
    </section>
  );
}

/**
 * BackgroundSection — réplica do Cursor (template ypw).
 *
 * Template HTML:
 *   <section class="css-inspector-section">
 *     <div>
 *       <div class="css-section-title">Background</div>
 *       <div class="css-section-actions">
 *         <button aria-haspopup="menu"><i></i></button>  <!-- color tokens picker -->
 *         <button><i></i></button>                        <!-- + Add layer -->
 *       </div>
 *     </div>
 *     <div class="css-fill-controls">
 *       ... layers ...
 *     </div>
 *   </section>
 *
 * Cada layer (bpw) tem:
 *   - type dropdown (Solid / Linear / Radial)
 *   - color input (wpw) OU gradient controls (y4p) dependendo do tipo
 *
 * Propriedades adicionais (background-image/size/position/repeat) vão num
 * sub-bloco "Advanced" no fim da section (não está no Cursor template mas
 * mantém pra não perder feature).
 */
function BackgroundSection({
  element,
  onApply,
}: {
  element: InspectedElement;
  onApply: (property: string, value: string) => void;
}) {
  const [collapsed, toggleCollapsed] = useCollapseState('background');
  const bgColor = element.designProps.backgroundColor;
  const bgImage = element.allStyles['background-image'] || '';

  // Cursor pattern: linkedVariable state — detect from bgColor.
  // Cursor VG0 maintains linkedVariable as explicit signal, set/cleared on
  // pick/unlink/addFill. We derive from the CSS value for simplicity.
  const linkedM = (bgColor || '').trim().match(/^var\((--[a-zA-Z0-9_-]+)/);
  const linkedVariable = linkedM ? linkedM[1] : null;

  // Cursor pattern: resolve the token to an actual color for the swatch.
  // We use the computed backgroundColor from allStyles as fallback.
  const resolvedTokenColor = element.allStyles['background-color'] || bgColor || '';

  // Ref to programmatically open the token picker (for LinkedTokenButton click)
  // Cursor pattern: preview state for hover preview in token picker
  const previewRef = useRef<string | null>(null);

  const onPreviewColor = (color: string): void => {
    if (!previewRef.current) previewRef.current = bgColor;
    onApply('background-color', color);
  };

  const onRestorePreview = (): void => {
    if (previewRef.current !== null) {
      onApply('background-color', previewRef.current);
      previewRef.current = null;
    }
  };

  /**
   * Add layer — replica Cursor (U_ = onAddFill em VG0):
   * Comportamento: seta bg-color white opaco, limpando linked token.
   */
  const onAddLayer = (): void => {
    const hasColor = bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent';
    const hasImage = !!bgImage && bgImage !== 'none';
    if (!hasColor && !hasImage) {
      onApply('background-color', 'rgba(255, 255, 255, 1)');
      return;
    }
    const newLayer = 'linear-gradient(rgba(255, 255, 255, 1), rgba(255, 255, 255, 1))';
    const next = hasImage ? `${newLayer}, ${bgImage}` : newLayer;
    onApply('background-image', next);
  };

  const onPickColorToken = (varName: string): void => {
    previewRef.current = null; // clear preview state on commit
    onApply('background-color', `var(${varName})`);
  };

  const onUnlinkVariable = (): void => {
    // Cursor: unlink = replace var() with the resolved computed value.
    const resolved = element.allStyles['background-color'] || '#FFFFFF';
    onApply('background-color', resolved);
  };

  return (
    <section className="css-inspector-section" data-collapsed={collapsed}>
      <div className="css-section-header">
        <div className="css-section-header-title-group">
          <button
            type="button"
            className="css-section-collapse-toggle"
            aria-label={collapsed ? 'Expand Background' : 'Collapse Background'}
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
          >
            <i className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} />
          </button>
          <div className="css-section-title">Background</div>
        </div>
        <div className="css-section-actions">
          <ColorTokensPickerButton
            currentValue={bgColor}
            onPick={onPickColorToken}
            onPreviewColor={onPreviewColor}
            onRestorePreview={onRestorePreview}
          />
          <button
            type="button"
            className="css-section-action"
            title="Add fill"
            aria-label="Add fill"
            onClick={onAddLayer}
          >
            <i className="codicon codicon-add" />
          </button>
        </div>
      </div>
      <div className="css-fill-controls">
        <BackgroundPaint
          bgColor={bgColor}
          bgImage={bgImage}
          linkedVariable={linkedVariable}
          resolvedTokenColor={resolvedTokenColor}
          onApply={onApply}
          onUnlinkVariable={onUnlinkVariable}
          onOpenTokenPicker={() => {
            // Programmatically trigger the token picker button click
            const btn = document.querySelector('.css-inspector-section[data-collapsed="false"] .css-section-action[aria-haspopup="menu"]') as HTMLButtonElement | null;
            btn?.click();
          }}
        />
      </div>
      {/* Extras: bg image (url), size, position, repeat */}
      <details className="css-bg-advanced">
        <summary>Image options</summary>
        <EditRow label="Bg image" prop="background-image" value={bgImage} onApply={onApply} truncate />
        <EditRow label="Bg size" prop="background-size" value={element.allStyles['background-size'] || ''} onApply={onApply} />
        <EditRow label="Bg position" prop="background-position" value={element.allStyles['background-position'] || ''} onApply={onApply} />
        <EditRow label="Bg repeat" prop="background-repeat" value={element.allStyles['background-repeat'] || ''} onApply={onApply} />
        <EditRow label="Aspect" prop="aspect-ratio" value={element.allStyles['aspect-ratio'] || ''} onApply={onApply} />
        <EditRow label="Object fit" prop="object-fit" value={element.allStyles['object-fit'] || ''} onApply={onApply} />
      </details>
    </section>
  );
}

/**
 * ThemePickerButton — replica `jmw` array do Cursor:
 *   [{mode:"light"}, {mode:"dark"}, {mode:"system"}]
 *
 * Aplica/remove classe `dark` no <body> da página previewzada via webview
 * executeJavaScript. "System" = remove a classe (respeita prefers-color-scheme).
 */
function ThemePickerButton() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'light' | 'dark' | 'system'>('system');
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);
  const setTheme = (m: 'light' | 'dark' | 'system'): void => {
    setMode(m);
    setOpen(false);
    // Cursor usa BrowserView.emulateColorScheme via CDP — não hack de classe
    // CSS. Isso dispara `@media (prefers-color-scheme)` corretamente.
    const wv = document.querySelector('.preview-webview') as {
      getWebContentsId?: () => number;
    } | null;
    type UNDRCODThemeAPI = {
      previewEmulateColorScheme?: (id: number, s: 'light' | 'dark' | 'system') => Promise<{ ok: boolean }>;
    };
    const api = (window as unknown as { undrcodAPI?: UNDRCODThemeAPI }).undrcodAPI;
    if (!wv?.getWebContentsId || !api?.previewEmulateColorScheme) return;
    try {
      void api.previewEmulateColorScheme(wv.getWebContentsId(), m);
    } catch { /* ignore */ }
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className={`css-stroke-action ${open ? 'active' : ''}`}
        title="Change theme"
        aria-label="Change theme"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((p) => !p); }}
      >
        <i className="codicon codicon-color-mode" />
      </button>
      {open && (
        <div className="css-theme-menu">
          {(['light', 'dark', 'system'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`css-theme-menu-item ${mode === m ? 'is-active' : ''}`}
              onClick={() => setTheme(m)}
            >
              <i className={`codicon codicon-${m === 'light' ? 'sun' : m === 'dark' ? 'moon' : 'device-desktop'}`} />
              <span>{m.charAt(0).toUpperCase() + m.slice(1)}</span>
              {mode === m && <i className="codicon codicon-check css-theme-menu-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * AppearanceSection — réplica 1:1 do Cursor (UG0 / template Vmw).
 *
 * Template HTML extraído raw:
 *   <section class="css-inspector-section">
 *     <div class="css-section-header">
 *       <div><div class="css-section-title">Appearance</div></div>
 *       <div class="css-section-header-actions">
 *         <button aria-label="Change theme" aria-haspopup="menu">...</button>
 *         <button>...</button>  ← provavelmente "Hide element" (visibility toggle)
 *       </div>
 *     </div>
 *     <div class="css-section-body css-appearance-grid">
 *       <div class="css-control-block">
 *         <div class="css-control-label">Opacity</div>
 *         <div class="css-input-group">
 *           <label aria-label="Opacity"><i></i></label>
 *           <input min=0 max=100> <span>%</span>
 *         </div>
 *       </div>
 *       <div class="css-control-block">
 *         <div class="css-control-label">Corner Radius</div>
 *         <div class="css-corner-radius-row">
 *           <div class="css-input-group css-corner-radius-group">
 *             <label aria-label="Corner radius"><i></i></label>
 *             <input> <span>px</span>
 *           </div>
 *           <button class="css-corner-toggle-button" aria-label="Edit corners">...</button>
 *         </div>
 *       </div>
 *     </div>
 *   </section>
 *
 * Quando "Edit corners" ativo, renderiza `<div class=css-corner-grid>` com 4
 * inputs ordem `["topLeft", "topRight", "bottomRight", "bottomLeft"]` (Kmw).
 *
 * Corner radius input mostra "Mixed" como texto quando os 4 cantos diferem
 * (isCornerRadiusMixed). Ao editar nesse modo, sobrescreve TODOS os 4 cantos.
 */
function AppearanceSection({
  opacity,
  borderRadius,
  tl, tr, br, bl,
  visibility,
  onApply,
}: {
  opacity: string;
  borderRadius: string;
  tl: string;
  tr: string;
  br: string;
  bl: string;
  visibility: string;
  onApply: (property: string, value: string) => void;
}) {
  const [collapsed, toggleCollapsed] = useCollapseState('appearance');
  // Opacity: CSS é 0-1, mas display é 0-100 (%). Replica L_ do Cursor:
  //   L_ = He(() => mpe(Math.round(parseFloat(qn("opacity")) * 100)))
  const opacityRaw = parseFloat(opacity);
  const opacityNum = Number.isFinite(opacityRaw) ? Math.round(opacityRaw * 100) : 100;

  // Per-corner state — começa em sync se todos os 4 são iguais.
  const [editCorners, setEditCorners] = useState(false);
  const parsePx = (v: string): number => {
    const m = (v || '').match(/^(-?\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  };
  const radiusOverall = parsePx(borderRadius);
  const cTL = parsePx(tl || borderRadius);
  const cTR = parsePx(tr || borderRadius);
  const cBR = parsePx(br || borderRadius);
  const cBL = parsePx(bl || borderRadius);
  // Mixed: 4 corners não são todos iguais ao overall (replica isCornerRadiusMixed)
  const isMixed = !(cTL === cTR && cTR === cBR && cBR === cBL);
  const radiusDisplay = isMixed ? 'Mixed' : `${Math.round(radiusOverall)}`;
  // Draft state pro radius overall — permite Backspace limpar sem reverter.
  // Não usa PxDraftInput porque precisa do modo "Mixed" (token text) + onFocus select.
  const [radiusDraft, setRadiusDraft] = useState(radiusDisplay);
  const [radiusFocused, setRadiusFocused] = useState(false);
  useEffect(() => {
    if (!radiusFocused) setRadiusDraft(radiusDisplay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiusDisplay, radiusFocused]);

  const applyAllCorners = (v: string): void => {
    // BUG FIX #206: ANTES `applyAllCorners` setava `border-radius: Npx` e
    // DEPOIS limpava as 4 per-corner inline. Mas o CSSOM (setProperty com value
    // vazio) REMOVE a longhand do estilo inline. Quando border-radius shorthand
    // expande pras 4 longhand internamente e depois removemos uma → computed
    // value volta pro stylesheet default (0px). User via valor voltar pra 0.
    //
    // Fix: SÓ setar a shorthand. CSSOM já cuida de substituir as longhands
    // existentes — setar `border-radius` substitui as 4 longhand inline
    // simultaneamente (replace, não merge). Não precisa limpar antes/depois.
    onApply('border-radius', v);
  };

  const visibilityHidden = visibility === 'hidden';

  return (
    <section className="css-inspector-section" data-collapsed={collapsed}>
      <div className="css-section-header">
        <div className="css-section-header-title-group">
          <button
            type="button"
            className="css-section-collapse-toggle"
            aria-label={collapsed ? 'Expand Appearance' : 'Collapse Appearance'}
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
          >
            <i className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} />
          </button>
          <div className="css-section-title">Appearance</div>
        </div>
        <div className="css-section-header-actions">
          {/* 1° botão: Theme picker (Light/Dark/System) — ícone sol, aria-haspopup */}
          <ThemePickerButton />
          {/* 2° botão: Visibility toggle (eye/eyeClosed) — tooltip dinâmico */}
          <button
            type="button"
            className={`css-stroke-action ${visibilityHidden ? 'active' : ''}`}
            title={visibilityHidden ? 'Show element' : 'Hide element'}
            aria-label={visibilityHidden ? 'Show element' : 'Hide element'}
            aria-pressed={visibilityHidden}
            onClick={(e) => {
              e.stopPropagation();
              onApply('visibility', visibilityHidden ? 'visible' : 'hidden');
            }}
          >
            <i className={`codicon ${visibilityHidden ? 'codicon-eye-closed' : 'codicon-eye'}`} />
          </button>
        </div>
      </div>
      <div className="css-section-body css-appearance-grid">
        {/* Opacity */}
        <div className="css-control-block">
          <div className="css-control-label">Opacity</div>
          <div className="css-input-group">
            <ScrubLabel
              getValue={() => opacityNum}
              onChange={(v) => {
                const clamped = Math.max(0, Math.min(100, Math.round(v)));
                onApply('opacity', `${clamped / 100}`);
              }}
              min={0}
              max={100}
              ariaLabel="Opacity"
            >
              <i className="codicon codicon-symbol-color" />
            </ScrubLabel>
            <div className="css-input-field">
              {/* Draft state pro Opacity: permite Backspace limpar o campo sem
                  reverter (bug do input.type=number + onChange parseFloat bail). */}
              <PxDraftInput
                numValue={opacityNum}
                min={0}
                ariaLabel="Opacity"
                onCommit={(raw) => {
                  const n = parseFloat(raw);
                  if (Number.isNaN(n)) return;
                  const clamped = Math.max(0, Math.min(100, Math.round(n)));
                  onApply('opacity', `${clamped / 100}`);
                }}
              />
              <span
                className="css-input-suffix"
                title="Drag to adjust opacity"
                aria-label="Drag to adjust opacity"
              >%</span>
            </div>
          </div>
        </div>
        {/* Corner Radius */}
        <div className="css-control-block">
          <div className="css-control-label">Corner Radius</div>
          <div className="css-corner-radius-row">
            <div className="css-input-group css-corner-radius-group">
              <ScrubLabel
                getValue={() => Math.round(radiusOverall)}
                onChange={(v) => applyAllCorners(`${Math.max(0, Math.round(v))}px`)}
                min={0}
                ariaLabel="Corner radius"
                title="Drag to adjust corner radius"
              >
                {/* PA #204: SVG inline — rounded-corner square (Cursor pattern).
                 * Antes usava codicon-symbol-misc (genérico, não-óbvio que era drag).
                 * Agora visualmente representa "corner radius" — semantically correto. */}
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M3 7 L3 5 Q3 3 5 3 L7 3" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
                  <path d="M9 3 L11 3 Q13 3 13 5 L13 7" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
                  <path d="M13 9 L13 11 Q13 13 11 13 L9 13" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
                  <path d="M7 13 L5 13 Q3 13 3 11 L3 9" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
                </svg>
              </ScrubLabel>
              <div className="css-input-field">
                <input
                  // Cursor: input.type alterna entre "text" (Mixed) e "number" (uniform).
                  type={isMixed ? 'text' : 'number'}
                  inputMode="numeric"
                  className={`css-number-input ${isMixed ? 'css-number-input--mode-token' : ''}`}
                  min={0}
                  value={radiusDraft}
                  onFocus={(e) => {
                    setRadiusFocused(true);
                    // Mixed → auto-select pra user digitar substituir tudo.
                    if (isMixed) e.currentTarget.select();
                  }}
                  onChange={(e) => setRadiusDraft(e.currentTarget.value)}
                  onBlur={() => {
                    setRadiusFocused(false);
                    const v = radiusDraft.trim();
                    if (v === '') { setRadiusDraft(radiusDisplay); return; }
                    const n = parseFloat(v);
                    if (Number.isNaN(n)) { setRadiusDraft(radiusDisplay); return; }
                    applyAllCorners(`${Math.max(0, Math.round(n))}px`);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                    if (e.key === 'Escape') {
                      setRadiusDraft(radiusDisplay);
                      (e.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                />
                <span className="css-input-suffix">px</span>
              </div>
            </div>
            <button
              type="button"
              className="css-corner-toggle-button"
              data-active={editCorners ? 'true' : undefined}
              aria-label="Edit corners"
              title="Edit corners"
              aria-pressed={editCorners}
              aria-expanded={editCorners}
              onClick={() => setEditCorners((p) => !p)}
            >
              {/* PA #204: SVG inline — rectangle outline com 4 corner dashes
               * (Cursor pattern). Antes era codicon-symbol-misc (genérico).
               * Visual: pequeno quadrado com cantos pintados/destacados. */}
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                {/* 4 corner brackets — top-left, top-right, bottom-right, bottom-left */}
                <path d="M3 5 L3 3 L5 3" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
                <path d="M11 3 L13 3 L13 5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
                <path d="M13 11 L13 13 L11 13" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
                <path d="M5 13 L3 13 L3 11" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {editCorners && (
            <div className="css-corner-grid" aria-label="Individual corner radius inputs">
              {([
                { key: 'topLeft', prop: 'border-top-left-radius', value: cTL, label: 'Top left', preview: 'top-left' },
                { key: 'topRight', prop: 'border-top-right-radius', value: cTR, label: 'Top right', preview: 'top-right' },
                { key: 'bottomRight', prop: 'border-bottom-right-radius', value: cBR, label: 'Bottom right', preview: 'bottom-right' },
                { key: 'bottomLeft', prop: 'border-bottom-left-radius', value: cBL, label: 'Bottom left', preview: 'bottom-left' },
              ] as const).map((c) => (
                <div key={c.key} className="css-input-group css-corner-input">
                  {/*
                    POLISH #208: corner-preview agora é draggable (ScrubLabel).
                    Antes era `<span>` estático. User pediu drag pra ajustar cada
                    canto individualmente, igual ao ícone do all-corner.
                   */}
                  <ScrubLabel
                    getValue={() => Math.round(c.value)}
                    onChange={(v) => onApply(c.prop, `${Math.max(0, Math.round(v))}px`)}
                    min={0}
                    ariaLabel={c.label}
                    title={'Drag to adjust ' + c.label.toLowerCase() + ' radius'}
                    className="css-corner-preview-scrub"
                  >
                    <span
                      className="css-corner-preview"
                      data-corner={c.preview}
                      aria-hidden="true"
                    />
                  </ScrubLabel>
                  <div className="css-input-field">
                    {/* Draft state: Backspace funciona sem reverter pro valor anterior. */}
                    <PxDraftInput
                      numValue={Math.round(c.value)}
                      min={0}
                      ariaLabel={c.label}
                      onCommit={(raw) => {
                        const n = parseFloat(raw);
                        if (Number.isNaN(n)) return;
                        onApply(c.prop, `${Math.max(0, Math.round(n))}px`);
                      }}
                    />
                    <span className="css-input-suffix">px</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * MarginEditor — réplica do Cursor (YG0 margin controls).
 *
 * Igual PaddingEditor mas com diferenças:
 *   - Aceita "auto" como valor (margin: auto centra)
 *   - Aceita negativos (margin pode ser negativo, padding não)
 *   - Tooltip dinâmico mostra ambos valores quando mismatch:
 *     "Margin top 10px · bottom 5px"
 *   - Display estilo "mode-token" (italic+accent) quando valor é "auto"
 *
 * 2-input handler (`ni` do Cursor):
 *   if value.trim().toLowerCase() === "auto"  → onLinkedMarginChange(axis, "auto")
 *   else if parseFloat(value) válido           → onLinkedMarginChange(axis, Math.round(n).toString())
 *   else                                       → revert pro valor anterior
 *
 * 4-input: idem mas per-side.
 */
function MarginEditor({
  top, right, bottom, left,
  rawTop, rawRight, rawBottom, rawLeft,
  onApply,
}: {
  top: string; right: string; bottom: string; left: string;
  rawTop: string; rawRight: string; rawBottom: string; rawLeft: string;
  onApply: (property: string, value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const isAuto = (raw: string): boolean => raw.trim().toLowerCase() === 'auto';
  const parseNum = (v: string): number => {
    const m = (v || '').match(/^(-?\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  };
  const t = parseNum(top), r = parseNum(right), b = parseNum(bottom), l = parseNum(left);
  const tAuto = isAuto(rawTop), rAuto = isAuto(rawRight), bAuto = isAuto(rawBottom), lAuto = isAuto(rawLeft);

  // Mismatch: top !== bottom OU (top é auto !== bottom é auto)
  const verticalMismatch = Math.round(t) !== Math.round(b) || tAuto !== bAuto;
  const horizontalMismatch = Math.round(l) !== Math.round(r) || lAuto !== rAuto;

  const formatVal = (n: number, auto: boolean): string => auto ? 'auto' : `${Math.round(n)}px`;

  const applyVertical = (raw: string): void => {
    const v = raw.trim().toLowerCase();
    const value = v === 'auto' ? 'auto' : (() => {
      const n = parseFloat(v);
      return Number.isNaN(n) ? null : `${Math.round(n)}px`;
    })();
    if (value === null) return;
    onApply('margin-top', value);
    onApply('margin-bottom', value);
  };
  const applyHorizontal = (raw: string): void => {
    const v = raw.trim().toLowerCase();
    const value = v === 'auto' ? 'auto' : (() => {
      const n = parseFloat(v);
      return Number.isNaN(n) ? null : `${Math.round(n)}px`;
    })();
    if (value === null) return;
    onApply('margin-left', value);
    onApply('margin-right', value);
  };
  const applyPerSide = (side: 'top' | 'right' | 'bottom' | 'left', raw: string): void => {
    const v = raw.trim().toLowerCase();
    if (v === 'auto') { onApply(`margin-${side}`, 'auto'); return; }
    const n = parseFloat(v);
    if (Number.isNaN(n)) return;
    onApply(`margin-${side}`, `${Math.round(n)}px`);
  };

  return (
    <div className="css-margin-controls">
      <div className="css-margin-header">
        <div className="css-control-label">Margin</div>
        <button
          type="button"
          className={`css-margin-mode-toggle ${expanded ? 'active' : ''}`}
          aria-pressed={expanded}
          onClick={() => setExpanded((p) => !p)}
          title={expanded ? 'Edit vertical/horizontal' : 'Edit sides'}
        >
          {/* PA Layout #198 P1-2: troca de {} pra rectangle outline (4 sides). */}
          <i className="codicon codicon-empty-window" />
        </button>
      </div>
      {expanded ? (
        <div className="css-margin-grid">
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => {
            const num = side === 'top' ? t : side === 'right' ? r : side === 'bottom' ? b : l;
            const auto = side === 'top' ? tAuto : side === 'right' ? rAuto : side === 'bottom' ? bAuto : lAuto;
            return (
              <div key={side} className="css-input-group" aria-label={`Margin ${side}`}>
                <ScrubLabel
                  getValue={() => Math.round(num)}
                  onChange={(v) => onApply(`margin-${side}`, `${Math.round(v)}px`)}
                  ariaLabel={`Margin ${side}`}
                  className="css-margin-label-icon"
                >
                  {/* PA #203: trocado codicon-arrow-X por BoxSideIcon (square + 1 lado bold). */}
                  <BoxSideIcon side={side} />
                </ScrubLabel>
                <div className="css-input-field">
                  <PxDraftInput
                    numValue={num}
                    isAuto={auto}
                    acceptAuto
                    ariaLabel={`Margin ${side}`}
                    className={`css-number-input ${auto ? 'css-number-input--mode-token' : ''}`}
                    onCommit={(raw) => applyPerSide(side, raw)}
                  />
                  <span
                    className="css-input-suffix"
                    data-hidden={auto ? 'true' : undefined}
                  >px</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="css-margin-axis-row">
          {/* Vertical */}
          <div
            className="css-input-group"
            data-mismatch={verticalMismatch ? 'true' : undefined}
            title={verticalMismatch
              ? `Margin top ${formatVal(t, tAuto)} · bottom ${formatVal(b, bAuto)}`
              : 'Margin top and bottom'}
          >
            <ScrubLabel
              getValue={() => Math.round(t)}
              onChange={(v) => applyVertical(`${Math.round(v)}`)}
              ariaLabel="Margin top and bottom"
              className="css-margin-label-icon"
            >
              {/* PA #203: BoxSideIcon vertical (consistente com Padding + expanded mode). */}
              <BoxSideIcon side="vertical" />
            </ScrubLabel>
            <div className="css-input-field">
              <PxDraftInput
                numValue={t}
                isAuto={tAuto && bAuto}
                acceptAuto
                ariaLabel="Margin top and bottom"
                className={`css-number-input ${tAuto && bAuto ? 'css-number-input--mode-token' : ''}`}
                onCommit={(raw) => applyVertical(raw)}
              />
              <span
                className="css-input-suffix"
                data-hidden={tAuto && bAuto ? 'true' : undefined}
              >px</span>
            </div>
          </div>
          {/* Horizontal */}
          <div
            className="css-input-group"
            data-mismatch={horizontalMismatch ? 'true' : undefined}
            title={horizontalMismatch
              ? `Margin left ${formatVal(l, lAuto)} · right ${formatVal(r, rAuto)}`
              : 'Margin left and right'}
          >
            <ScrubLabel
              getValue={() => Math.round(l)}
              onChange={(v) => applyHorizontal(`${Math.round(v)}`)}
              ariaLabel="Margin left and right"
              className="css-margin-label-icon"
            >
              {/* PA #203: BoxSideIcon horizontal (consistente com Padding + expanded mode). */}
              <BoxSideIcon side="horizontal" />
            </ScrubLabel>
            <div className="css-input-field">
              <PxDraftInput
                numValue={l}
                isAuto={lAuto && rAuto}
                acceptAuto
                ariaLabel="Margin left and right"
                className={`css-number-input ${lAuto && rAuto ? 'css-number-input--mode-token' : ''}`}
                onCommit={(raw) => applyHorizontal(raw)}
              />
              <span
                className="css-input-suffix"
                data-hidden={lAuto && rAuto ? 'true' : undefined}
              >px</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * SideEditor — editor de 4 lados (padding/margin/border) com 2 modos:
 *   - Symmetric (default): 2 inputs [vertical | horizontal] quando T==B && L==R
 *   - Individual: 4 inputs 2x2 grid (top, right, bottom, left)
 *
 * Toggle via "Edit sides" icon no header. Espelha Cursor exato.
 */
function SideEditor({
  title,
  top, right, bottom, left,
  propPrefix,
  onApply,
  extras,
}: {
  title: string;
  top: string; right: string; bottom: string; left: string;
  propPrefix: string;
  onApply: (property: string, value: string) => void;
  extras?: React.ReactNode;
}) {
  // Detecta se valores são simétricos (T==B && L==R) → mostra modo compacto.
  // User pode forçar modo expanded via toggle.
  const isSymmetric = top === bottom && left === right;
  const [forceExpanded, setForceExpanded] = useState(false);
  // Auto: se assimétrico, abre. Se simétrico, fechado (a menos que user force).
  const expanded = forceExpanded || !isSymmetric;

  return (
    <div className="preview-design-group">
      <div className="preview-design-group-header">
        <span className="preview-design-group-title">{title}</span>
        <button
          type="button"
          className={`preview-side-toggle ${expanded ? 'is-active' : ''}`}
          onClick={() => setForceExpanded((p) => !p)}
          title="Edit sides"
        >
          <svg width="14" height="14" viewBox="0 0 14 14">
            <rect x="2" y="2" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1" fill="none" strokeDasharray="2 1" />
          </svg>
        </button>
      </div>

      <div className={`preview-side-grid ${expanded ? 'is-expanded' : ''}`}>
        {expanded ? (
          <>
            <SideInput icon="top" value={top} prop={`${propPrefix}-top`} onApply={onApply} />
            <SideInput icon="right" value={right} prop={`${propPrefix}-right`} onApply={onApply} />
            <SideInput icon="bottom" value={bottom} prop={`${propPrefix}-bottom`} onApply={onApply} />
            <SideInput icon="left" value={left} prop={`${propPrefix}-left`} onApply={onApply} />
          </>
        ) : (
          <>
            <SideInput
              icon="vertical"
              value={top}
              prop={`${propPrefix}-top`}
              onApply={(_p, v) => {
                onApply(`${propPrefix}-top`, v);
                onApply(`${propPrefix}-bottom`, v);
              }}
            />
            <SideInput
              icon="horizontal"
              value={left}
              prop={`${propPrefix}-left`}
              onApply={(_p, v) => {
                onApply(`${propPrefix}-left`, v);
                onApply(`${propPrefix}-right`, v);
              }}
            />
          </>
        )}
      </div>
      {extras && <div className="preview-side-extras">{extras}</div>}
    </div>
  );
}

/**
 * SideInput — input com SideIcon à esquerda + NumberInput compacto à direita.
 * Pattern visual do Cursor.
 */
function SideInput({
  icon,
  value,
  prop,
  onApply,
}: {
  icon: 'top' | 'right' | 'bottom' | 'left' | 'vertical' | 'horizontal';
  value: string;
  prop: string;
  onApply: (property: string, value: string) => void;
}) {
  return (
    <div className="preview-side-input">
      <span className="preview-side-input-icon"><SideIcon side={icon} /></span>
      <NumberInput value={value} prop={prop} onApply={onApply} />
    </div>
  );
}

/**
 * CursorToggleRow — label + switch alinhados (estilo dpe do Cursor).
 *
 * O ROW INTEIRO é o trigger de toggle (label, span, switch — tudo clicável).
 * Evita bug de "switch dentro de label" onde click event borbulha errado e
 * o estado não muda.
 */
function CursorToggleRow({
  label,
  checked,
  onChange,
  ariaLabel,
  wrapperClass,
  size = 'small',
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
  wrapperClass: 'css-toggle-row' | 'css-padding-box-sizing';
  size?: 'small' | 'medium';
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  return (
    <div className={wrapperClass}>
      <button
        ref={buttonRef}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel || label}
        className="css-toggle"
        onClick={() => {
          onChange(!checked);
          // Cursor faz Ze?.focus() pós-toggle pra preservar focus no switch.
          // Garante a11y: user toggla com teclado e mantém posição.
          requestAnimationFrame(() => buttonRef.current?.focus());
        }}
      >
        <span>{label}</span>
        <span
          className={`css-switch css-switch--${size} ${checked ? 'is-on' : ''}`}
          aria-hidden="true"
        >
          <span className="css-switch-thumb" />
        </span>
      </button>
    </div>
  );
}

/**
 * CursorCheckboxRow — checkbox row estilo Windows/Cursor (square + check icon).
 *
 * PA Layout #198 P1-3 / P1-4: Cursor usa checkboxes square não toggle switch
 * pra Clip content + Border box. Toggle switch (pill rounded) destoa do padrão
 * do app (mais fancy que necessário pra boolean simples).
 *
 * Layout: `[square 14px] [label]` — checkbox à ESQUERDA, label à direita.
 * Estado checked: square com bg accent + white check codicon.
 * Click-area: row inteira é trigger (label clicável também).
 */
function CursorCheckboxRow({
  label,
  checked,
  onChange,
  ariaLabel,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel || label}
      className="css-checkbox-row"
      onClick={() => onChange(!checked)}
    >
      <span className={`css-checkbox-square ${checked ? 'is-checked' : ''}`} aria-hidden="true">
        {checked && <i className="codicon codicon-check" />}
      </span>
      <span className="css-checkbox-label">{label}</span>
    </button>
  );
}

/**
 * ClipContentCheckbox — toggle overflow: hidden ↔ visible.
 */
function ClipContentCheckbox({
  value,
  onApply,
}: {
  value: string;
  onApply: (property: string, value: string) => void;
}) {
  // Cursor `Gy`: qn("overflow").trim().toLowerCase() === "hidden"
  // (SÓ "hidden", não aceita "clip"). Trim+lowercase pra defensiva.
  const checked = (value || '').trim().toLowerCase() === 'hidden';
  return (
    <CursorCheckboxRow
      label="Clip content"
      checked={checked}
      onChange={(next) => onApply('overflow', next ? 'hidden' : 'visible')}
      ariaLabel="Toggle clip content"
    />
  );
}

/**
 * BorderBoxCheckbox — toggle box-sizing: border-box ↔ content-box.
 */
function BorderBoxCheckbox({
  value,
  onApply,
}: {
  value: string;
  onApply: (property: string, value: string) => void;
}) {
  // Cursor `$y` = qn("box-sizing").trim().toLowerCase() === "border-box"
  // Replica trim+lowercase pra evitar mismatch por whitespace/case.
  const checked = (value || '').trim().toLowerCase() === 'border-box';
  return (
    <CursorCheckboxRow
      label="Border box"
      checked={checked}
      onChange={(next) => onApply('box-sizing', next ? 'border-box' : 'content-box')}
      ariaLabel="Toggle border-box sizing"
    />
  );
}

/** 4-grid editável pra padding/margin (top/right/bottom/left). */
function FourRowEdit({
  top, right, bottom, left,
  propPrefix,
  onApply,
}: {
  top: string; right: string; bottom: string; left: string;
  propPrefix: 'padding' | 'margin';
  onApply: (property: string, value: string) => void;
}) {
  return (
    <div className="preview-design-four-edit">
      <QuadInput value={top} prop={`${propPrefix}-top`} onApply={onApply} title="top" />
      <QuadInput value={right} prop={`${propPrefix}-right`} onApply={onApply} title="right" />
      <QuadInput value={bottom} prop={`${propPrefix}-bottom`} onApply={onApply} title="bottom" />
      <QuadInput value={left} prop={`${propPrefix}-left`} onApply={onApply} title="left" />
    </div>
  );
}

/**
 * AlignButtonRow — atalhos visuais pra justify-content / align-items.
 * 4 botões: start / center / end / space-between (justify) ou stretch (align).
 * Ícones rotacionam conforme flex-direction (horizontal vs column).
 */
function AlignButtonRow({
  label,
  prop,
  value,
  direction,
  axis,
  onApply,
}: {
  label: string;
  prop: string;
  value: string;
  direction: string;
  axis: 'main' | 'cross';
  onApply: (property: string, value: string) => void;
}) {
  const isColumn = direction.includes('column');
  // Conjunto de opções depende do axis.
  const options: Array<{ val: string; icon: string; title: string }> = axis === 'main'
    ? [
        { val: 'flex-start', icon: 'arrow-left', title: 'Start' },
        { val: 'center', icon: 'symbol-method', title: 'Center' },
        { val: 'flex-end', icon: 'arrow-right', title: 'End' },
        { val: 'space-between', icon: 'split-horizontal', title: 'Space between' },
      ]
    : [
        { val: 'flex-start', icon: 'arrow-up', title: 'Start' },
        { val: 'center', icon: 'symbol-method', title: 'Center' },
        { val: 'flex-end', icon: 'arrow-down', title: 'End' },
        { val: 'stretch', icon: 'split-vertical', title: 'Stretch' },
      ];

  // Normaliza valores (start = flex-start, end = flex-end).
  const normalized = value === 'start' ? 'flex-start' : value === 'end' ? 'flex-end' : value;

  return (
    <div className="preview-design-row preview-design-align-row">
      <span className="preview-design-row-label">{label}</span>
      <div className="preview-design-align-buttons">
        {options.map((opt) => (
          <button
            key={opt.val}
            type="button"
            className={`preview-design-align-btn ${normalized === opt.val ? 'is-active' : ''} ${isColumn && axis === 'main' ? 'is-rotated' : ''}`}
            onClick={() => onApply(prop, opt.val)}
            title={opt.title + ' (' + opt.val + ')'}
          >
            <i className={`codicon codicon-${opt.icon}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * TextAlignRow — 4 botões pra text-align (left/center/right/justify) com
 * ícones visuais. Mesmo padrão do Cursor's TypographySection.
 */
/**
 * DimensionRow — width/height com mode dropdown (fixed/fit/fill).
 * Replica `fb` (setDimensionMode) + `Hp` (applyPixelDimension) do Cursor:
 *
 *   - "fixed" mode: aplica value atual em px (Math.max(0, round(currentValue)))
 *   - "fit" mode: aplica "fit-content"
 *   - "fill" mode: aplica "100%"
 *   - input direto: parseFloat + clamp >= 0 + "Npx" (default), aceita unit válida
 *
 * Detecta mode atual a partir do value: "Npx" = fixed, "fit-content" = fit,
 * "100%" = fill, outros = custom (mostra como fixed mas preserva).
 */
/**
 * DimensionInput — replica W/H do Cursor com menu dropdown custom.
 *
 * Visual:
 *   [W] [752] [px ▾]    ← label + input + dropdown trigger
 *
 * Dropdown menu (4 opções + 2 ações):
 *   ↔️ Fixed Width (752) ✓
 *   ↔️ Fit contents
 *   ↔️ Fill container
 *   ─────
 *   → Add Min Width
 *   → Add Max Width
 *
 * Cursor source: YG0 (workbench.desktop.main.js) + array cs com modes
 * fixed/fit/fill. Label dinamico "Fixed Width (NUM)" mostra valor atual.
 */
type DimensionMode = 'fixed' | 'fit' | 'fill';

/**
 * BoxSideIcon — SVG inline com square outline + 1 ou 2 lados emphasized.
 *
 * Pattern Cursor/Figma: ícone visual indicando qual lado está sendo editado.
 * Suporta 6 modos:
 *   - 'top' | 'right' | 'bottom' | 'left' — 1 lado bold (expanded 4-input mode)
 *   - 'vertical'   — top + bottom bold   (collapsed mode, par vertical)
 *   - 'horizontal' — left + right bold   (collapsed mode, par horizontal)
 *
 * Antes usávamos codicon-arrow-{up,right,down,left} no expanded + ↕/↔ no collapsed.
 * UX inconsistente — Rafael apontou. PA #203 padroniza ambos os modos com box-side.
 *
 * ViewBox 16×16 fixed. Box em (3,3)-(13,13). Lado bold = stroke 2px.
 */
type BoxSide = 'top' | 'right' | 'bottom' | 'left' | 'vertical' | 'horizontal';
function BoxSideIcon({ side }: { side: BoxSide }) {
  const isBold = {
    top:    side === 'top'    || side === 'vertical',
    right:  side === 'right'  || side === 'horizontal',
    bottom: side === 'bottom' || side === 'vertical',
    left:   side === 'left'   || side === 'horizontal',
  };
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      {/* Box outline com strokes sutis nos 4 lados */}
      <rect x={3} y={3} width={10} height={10} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} />
      {/* Highlight dos lados ativos (stroke 2px solid currentColor) */}
      {isBold.top    && <line x1={3} y1={3}  x2={13} y2={3}  stroke="currentColor" strokeWidth={2} strokeLinecap="round" />}
      {isBold.right  && <line x1={13} y1={3} x2={13} y2={13} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />}
      {isBold.bottom && <line x1={3} y1={13} x2={13} y2={13} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />}
      {isBold.left   && <line x1={3} y1={3}  x2={3}  y2={13} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />}
    </svg>
  );
}

/**
 * Helpers compartilhados — usados em DimensionInput (decide se mostra "Add Min/Max"
 * no dropdown) E em DesignTab (decide se renderiza a row Min/Max).
 *
 * Computed style SEMPRE retorna valor pra min-width/max-width (ex: '0px', 'auto',
 * 'none'). Naive truthy-check daria sempre true → rows e Add buttons sempre
 * visíveis. Estes helpers filtram os valores "default" (não-setados explicitamente)
 * pra emular o behavior do Cursor onde Min/Max só aparecem após Add explícito.
 */
function isNonTrivialMin(v: string | undefined): boolean {
  if (!v) return false;
  const t = v.trim().toLowerCase();
  return t !== '' && t !== '0px' && t !== '0' && t !== 'auto';
}
function isNonTrivialMax(v: string | undefined): boolean {
  if (!v) return false;
  const t = v.trim().toLowerCase();
  return t !== '' && t !== 'none' && t !== 'auto';
}

function DimensionInput({
  dimension,
  value,
  element,
  onApply,
}: {
  dimension: 'width' | 'height';
  value: string;
  element: InspectedElement;
  onApply: (property: string, value: string) => void;
}) {
  const v = (value || '').trim();
  const labelLetter = dimension === 'width' ? 'W' : 'H';
  const fullLabel = dimension === 'width' ? 'Width' : 'Height';
  // Detecta o mode atual a partir do value CSS COMPUTED.
  //
  // ⚠️ getComputedStyle resolve `fit-content` → pixels (ex: 641px) e `100%` →
  // pixels também. Então depois do user clicar "Fit contents" ou "Fill container",
  // o broadcast volta com value = '641px' → detectedMode vira 'fixed' → checkmark
  // pula de volta pro Fixed.
  //
  // Fix: userSelectedMode local state. Quando user clica no menu, setamos
  // imediatamente — UI atualiza sem esperar o broadcast. Reset quando element
  // muda (uid).
  const detectedMode: DimensionMode = v === 'fit-content' || v === 'max-content' || v === 'min-content' ? 'fit'
    : v === '100%' ? 'fill'
    : 'fixed';
  const [userSelectedMode, setUserSelectedMode] = useState<DimensionMode | null>(null);
  const lastUidRef = useRef<string>(element.uid);
  useEffect(() => {
    if (lastUidRef.current !== element.uid) {
      lastUidRef.current = element.uid;
      setUserSelectedMode(null);
    }
  }, [element.uid]);
  const mode: DimensionMode = userSelectedMode ?? detectedMode;
  // Valor numérico pra exibir no input (round). Pra fit/fill, mostra ""/placeholder.
  const numMatch = v.match(/^(-?\d+(?:\.\d+)?)/);
  const numValue = numMatch
    ? Math.round(parseFloat(numMatch[1]))
    : Math.round(dimension === 'width' ? element.rect.width : element.rect.height);

  const setMode = (newMode: DimensionMode): void => {
    setUserSelectedMode(newMode);
    if (newMode === 'fit') { onApply(dimension, 'fit-content'); return; }
    if (newMode === 'fill') { onApply(dimension, '100%'); return; }
    onApply(dimension, `${Math.max(0, numValue)}px`);
  };

  const handleApply = (raw: string): void => {
    applyCss(onApply, dimension, raw, {
      allowedKeywords: ['auto', 'fit-content', 'max-content', 'min-content'],
      allowedUnits: ['px', '%', 'em', 'rem', 'vh', 'vw'],
      allowNegative: false,
      defaultUnit: 'px',
    });
  };

  const [menuOpen, setMenuOpen] = useState(false);

  // PA Layout #200 Batch 3 fix: outside-click NÃO fecha o menu quando user clica
  // no PRÓPRIO trigger button (chevron). Antes só o menuRef era checado — o
  // mousedown no chevron caía como "outside" → fechava imediatamente. UX bug
  // observado: chevron parecia não abrir o menu.
  //
  // Fix: trackear o triggerRef do botão também. Click no chevron = "inside" →
  // listener ignora → onClick do botão dispara setMenuOpen toggle normalmente.
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  const displayInput = mode === 'fixed' ? String(numValue)
    : mode === 'fit' ? 'Fit'
    : 'Fill';

  return (
    <div
      className="css-input-group"
      data-dimension={dimension}
    >
      <ScrubLabel
        getValue={() => numValue}
        onChange={(v) => onApply(dimension, `${Math.max(0, Math.round(v))}px`)}
        disabled={mode !== 'fixed'}
      >{labelLetter}</ScrubLabel>
      <div
        className="css-input-field css-input-field--with-dropdown"
        data-dimension-mode={mode}
      >
        <input
          type="text"
          className="css-number-input"
          value={displayInput}
          onChange={(e) => handleApply(e.currentTarget.value)}
          spellCheck={false}
          readOnly={mode !== 'fixed'}
        />
        <span
          className="css-input-suffix"
          data-hidden={mode === 'fixed' ? undefined : 'true'}
        >px</span>
        {/* Button DENTRO do input-field, depois do suffix (Cursor template Rpw).
         * triggerRef pra outside-click excluir esse botão do "outside" check. */}
        <button
          ref={triggerRef}
          type="button"
          className="css-input-dropdown"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((p) => !p); }}
          title={`Dimension mode: ${mode}`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <i className="codicon codicon-chevron-down" />
        </button>
      </div>
      {menuOpen && (
        <div ref={menuRef} className="css-dimension-menu">
          <button
            type="button"
            className={`css-dimension-menu-item ${mode === 'fixed' ? 'is-active' : ''}`}
            onClick={() => { setMode('fixed'); setMenuOpen(false); }}
          >
            <i className="codicon codicon-symbol-ruler css-dimension-menu-icon" />
            <span className="css-dimension-menu-label">
              Fixed {fullLabel} <span className="css-dimension-menu-measurement">({numValue})</span>
            </span>
            {mode === 'fixed' && <i className="codicon codicon-check css-dimension-menu-check" />}
          </button>
          <button
            type="button"
            className={`css-dimension-menu-item ${mode === 'fit' ? 'is-active' : ''}`}
            onClick={() => { setMode('fit'); setMenuOpen(false); }}
          >
            <i className="codicon codicon-collapse-all css-dimension-menu-icon" />
            <span className="css-dimension-menu-label">Fit contents</span>
            {mode === 'fit' && <i className="codicon codicon-check css-dimension-menu-check" />}
          </button>
          <button
            type="button"
            className={`css-dimension-menu-item ${mode === 'fill' ? 'is-active' : ''}`}
            onClick={() => { setMode('fill'); setMenuOpen(false); }}
          >
            <i className="codicon codicon-expand-all css-dimension-menu-icon" />
            <span className="css-dimension-menu-label">Fill container</span>
            {mode === 'fill' && <i className="codicon codicon-check css-dimension-menu-check" />}
          </button>
          {/*
            PA Layout #200 Batch 3: "Add Min/Max" só aparece se VALOR ATUAL é trivial
            (não-setado explicitamente). Antes a condition `!element.allStyles[X]`
            nunca era true (computed sempre retorna '0px'/'none'/'auto') → botões
            nunca apareciam. Agora usa isNonTrivialMin/Max pra checar se o user
            já adicionou um valor.

            Cursor source: `$s = C4p[Wn].filter(p => mn(p))` (mn = "ainda não está em qgs").
            mn() retorna false pra defaults — mesma semantica dos nossos helpers.
           */}
          {(() => {
            const minV = element.allStyles[`min-${dimension}`];
            const maxV = element.allStyles[`max-${dimension}`];
            const canAddMin = !isNonTrivialMin(minV);
            const canAddMax = !isNonTrivialMax(maxV);
            return (
              <>
                {(canAddMin || canAddMax) && (
                  <div className="css-dimension-menu-separator" />
                )}
                {canAddMin && (
                  <button
                    type="button"
                    className="css-dimension-menu-item"
                    onClick={() => {
                      // Aplica o valor numérico atual (W/H) como min — garante que
                      // a row aparece via isNonTrivialMin no parent.
                      onApply(`min-${dimension}`, `${numValue}px`);
                      setMenuOpen(false);
                    }}
                  >
                    <i className="codicon codicon-arrow-small-right css-dimension-menu-icon" />
                    <span className="css-dimension-menu-label">Add min {fullLabel.toLowerCase()}</span>
                  </button>
                )}
                {canAddMax && (
                  <button
                    type="button"
                    className="css-dimension-menu-item"
                    onClick={() => {
                      onApply(`max-${dimension}`, `${numValue}px`);
                      setMenuOpen(false);
                    }}
                  >
                    <i className="codicon codicon-arrow-small-left css-dimension-menu-icon" />
                    <span className="css-dimension-menu-label">Add max {fullLabel.toLowerCase()}</span>
                  </button>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/**
 * ConstraintInput — replica `_i` factory do Cursor pra min/max W/H rows.
 *
 * Visual:
 *   [Min W] [320] [px ▾]    ← label curto + input + dropdown
 *
 * Dropdown menu (Cursor pattern via `_i`):
 *   ↶ Set to current width
 *   ─────
 *   ✕ Remove min width
 *
 * Cursor source: `_i=Wn=>{...ke(Mr,()=>`Set to current ${lr.toLowerCase()}`),
 * ...ke(Dr,()=>`Remove ${Bon[Wn].longLabel}`)...}`
 * Map: Bon[prop] = { label: "Min W"|"Max W"|"Min H"|"Max H", longLabel, ... }
 */
const CONSTRAINT_LABELS: Record<string, { short: string; long: string; baseDim: 'width' | 'height' }> = {
  'min-width':  { short: 'Min W', long: 'min width',  baseDim: 'width' },
  'max-width':  { short: 'Max W', long: 'max width',  baseDim: 'width' },
  'min-height': { short: 'Min H', long: 'min height', baseDim: 'height' },
  'max-height': { short: 'Max H', long: 'max height', baseDim: 'height' },
};

function ConstraintInput({
  prop,
  value,
  currentDimensionValue,
  onApply,
}: {
  prop: 'min-width' | 'max-width' | 'min-height' | 'max-height';
  value: string;
  currentDimensionValue: string;
  onApply: (property: string, value: string) => void;
}) {
  const meta = CONSTRAINT_LABELS[prop];
  const v = (value || '').trim();
  const numMatch = v.match(/^(-?\d+(?:\.\d+)?)/);
  const numValue = numMatch ? Math.round(parseFloat(numMatch[1])) : 0;
  const unitMatch = v.match(/(px|%|em|rem|vh|vw)$/);
  const unit = unitMatch ? unitMatch[1] : 'px';

  const handleApply = (raw: string): void => {
    applyCss(onApply, prop, raw, {
      allowedKeywords: ['auto', 'none', 'fit-content', 'max-content', 'min-content'],
      allowedUnits: ['px', '%', 'em', 'rem', 'vh', 'vw'],
      allowNegative: false,
      defaultUnit: 'px',
    });
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  return (
    <div className="css-input-group" data-dimension={meta.baseDim} data-constraint={prop}>
      <ScrubLabel
        getValue={() => numValue}
        onChange={(nv) => onApply(prop, `${Math.max(0, Math.round(nv))}${unit}`)}
      >{meta.short}</ScrubLabel>
      <div className="css-input-field css-input-field--with-dropdown">
        <input
          type="text"
          className="css-number-input"
          value={String(numValue)}
          onChange={(e) => handleApply(e.currentTarget.value)}
          spellCheck={false}
        />
        <span className="css-input-suffix">{unit}</span>
        <button
          type="button"
          className="css-input-dropdown"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((p) => !p); }}
          title={`${meta.short} options`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <i className="codicon codicon-chevron-down" />
        </button>
      </div>
      {menuOpen && (
        <div ref={menuRef} className="css-dimension-menu">
          <button
            type="button"
            className="css-dimension-menu-item"
            onClick={() => {
              const cm = currentDimensionValue.match(/^(-?\d+(?:\.\d+)?)/);
              const curNum = cm ? Math.round(parseFloat(cm[1])) : numValue;
              onApply(prop, `${curNum}px`);
              setMenuOpen(false);
            }}
          >
            <i className="codicon codicon-arrow-left css-dimension-menu-icon" />
            <span className="css-dimension-menu-label">Set to current {meta.baseDim}</span>
          </button>
          <div className="css-dimension-menu-separator" />
          <button
            type="button"
            className="css-dimension-menu-item"
            onClick={() => {
              onApply(prop, '');
              setMenuOpen(false);
            }}
          >
            <i className="codicon codicon-trash css-dimension-menu-icon" />
            <span className="css-dimension-menu-label">Remove {meta.long}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * VerticalAlignRow — replica `kl` do Cursor.
 *
 * Display normalize:
 *   - "middle"/"center" → middle
 *   - "bottom"/"baseline" → bottom
 *   - default → top
 *
 * Cursor agrupa baseline com bottom (não é tecnicamente correto pra CSS, mas
 * é como o Cursor decide mostrar — fica visualmente próximo).
 */
function VerticalAlignRow({
  value,
  onApply,
}: {
  value: string;
  onApply: (property: string, value: string) => void;
}) {
  const v = value.trim().toLowerCase();
  const normalized = (v === 'middle' || v === 'center') ? 'middle'
    : (v === 'bottom' || v === 'baseline') ? 'bottom'
    : 'top';
  const options: Array<{ val: string; icon: string; title: string }> = [
    { val: 'top', icon: 'arrow-up', title: 'Top' },
    { val: 'middle', icon: 'symbol-method', title: 'Middle' },
    { val: 'bottom', icon: 'arrow-down', title: 'Bottom' },
  ];
  return (
    <div className="preview-design-row preview-design-align-row">
      <span className="preview-design-row-label">V-Align</span>
      <div className="preview-design-align-buttons">
        {options.map((opt) => (
          <button
            key={opt.val}
            type="button"
            className={`preview-design-align-btn ${normalized === opt.val ? 'is-active' : ''}`}
            onClick={() => onApply('vertical-align', opt.val)}
            title={opt.title}
          >
            <i className={`codicon codicon-${opt.icon}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * FontWeightRow — replica `ks` (display) + `td` (apply) do Cursor.
 *
 * Display normalize:
 *   - vazio/"normal" → 400
 *   - "bold" → 700
 *   - número inválido → 400
 *   - número válido → clamp 100-900 em steps de 100
 *
 * Apply: trim e salva como string (Cursor permite qualquer value via input,
 * mas display sempre mostra normalizado).
 */
function FontWeightRow({
  value,
  onApply,
}: {
  value: string;
  onApply: (property: string, value: string) => void;
}) {
  const normalize = (raw: string): string => {
    const v = raw.trim().toLowerCase();
    if (!v || v === 'normal') return '400';
    if (v === 'bold') return '700';
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return '400';
    return Math.min(900, Math.max(100, Math.round(n / 100) * 100)).toString();
  };
  const display = normalize(value);
  const options = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];
  return (
    <div className="preview-design-row">
      <span className="preview-design-row-label">Weight</span>
      <select
        className="preview-design-row-input"
        value={display}
        onChange={(e) => onApply('font-weight', e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

function TextAlignRow({
  value,
  onApply,
}: {
  value: string;
  onApply: (property: string, value: string) => void;
}) {
  const options: Array<{ val: string; icon: string; title: string }> = [
    { val: 'left', icon: 'arrow-left', title: 'Left' },
    { val: 'center', icon: 'symbol-method', title: 'Center' },
    { val: 'right', icon: 'arrow-right', title: 'Right' },
    { val: 'justify', icon: 'three-bars', title: 'Justify' },
  ];
  // Normaliza start/end (depende de direction) pra left/right comuns.
  const normalized = value === 'start' ? 'left' : value === 'end' ? 'right' : value;
  return (
    <div className="preview-design-row preview-design-align-row">
      <span className="preview-design-row-label">Align</span>
      <div className="preview-design-align-buttons">
        {options.map((opt) => (
          <button
            key={opt.val}
            type="button"
            className={`preview-design-align-btn ${normalized === opt.val ? 'is-active' : ''}`}
            onClick={() => onApply('text-align', opt.val)}
            title={opt.title}
          >
            <i className={`codicon codicon-${opt.icon}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * AdvancedRow — input duplo (property + value) pra adicionar QUALQUER CSS.
 * Estilo Cursor's AdvancedStylesSection. Sem autocomplete por enquanto.
 */
function AdvancedRow({
  onApply,
}: {
  onApply: (property: string, value: string) => void;
}) {
  const [prop, setProp] = useState('');
  const [val, setVal] = useState('');
  const commit = (): void => {
    const p = prop.trim();
    const v = val.trim();
    if (!p) return;
    onApply(p, v);
    setProp('');
    setVal('');
  };
  return (
    <div className="preview-design-advanced">
      <input
        type="text"
        className="preview-design-input preview-design-advanced-prop"
        placeholder="property"
        value={prop}
        onChange={(e) => setProp(e.target.value)}
        spellCheck={false}
      />
      <input
        type="text"
        className="preview-design-input preview-design-advanced-val"
        placeholder="value"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
        }}
        spellCheck={false}
      />
      <button
        type="button"
        className="preview-design-advanced-add"
        onClick={commit}
        title="Adicionar"
        disabled={!prop.trim()}
      >
        <i className="codicon codicon-add" />
      </button>
    </div>
  );
}

function QuadInput({
  value, prop, onApply, title,
}: {
  value: string; prop: string;
  onApply: (property: string, value: string) => void;
  title: string;
}) {
  // Usa NumberInput em vez de input texto — suporta unit dropdown + arrows.
  return (
    <div className="preview-design-quad" title={title}>
      <NumberInput value={value} prop={prop} onApply={onApply} />
    </div>
  );
}

/**
 * Tab "CSS" — lista bruta de computed styles "úteis" (subset).
 */
function CssTab({ element }: { element: InspectedElement }) {
  const entries = Object.entries(element.allStyles);
  return (
    <div className="preview-css">
      {entries.map(([prop, value]) => (
        <div key={prop} className="preview-css-row">
          <span className="preview-css-prop">{prop}</span>
          <span className="preview-css-value">{value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * EditsPopover — popover Cursor-style mostrando diff list de pending edits.
 *
 * Aberto via click no "N Edits" counter. Mostra cada edit como:
 *   property: oldValue (strikethrough) → newValue
 *
 * Color props (border-color, background-color, etc) ganham swatch ao lado.
 * Agrupado por selector — cada grupo tem ELEMENT info no fim.
 *
 * Pattern: replica `cs0` do Cursor (Changes panel). User aprova antes de Apply.
 */
type PendingEdit = { selector: string; property: string; value: string; prevValue: string; ts: number };
function EditsPopover({
  edits,
  onClose,
  onApply,
  onDiscard,
  anchorRef,
}: {
  edits: PendingEdit[];
  onClose: () => void;
  onApply: () => void;
  onDiscard: () => void;
  /** Ref do botão trigger pra calcular posição (position: fixed). Sem isso o
   * popover ficava cortado por containers pais com overflow: hidden. */
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  // Computa posição via getBoundingClientRect do botão âncora. Position FIXED
  // (não absolute) escapa qualquer overflow:hidden de containers pais.
  useLayoutEffect(() => {
    const update = () => {
      if (!anchorRef.current) return;
      const r = anchorRef.current.getBoundingClientRect();
      setPos({
        top: r.bottom + 6,
        right: window.innerWidth - r.right,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef]);
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const target = e.target as Node;
      // Não fecha se clicou no próprio popover OU no botão âncora (que toggla).
      if (ref.current && ref.current.contains(target)) return;
      if (anchorRef.current && anchorRef.current.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [onClose, anchorRef]);

  // Agrupa edits por selector — cada grupo vira uma "seção" no popover.
  const grouped: Record<string, PendingEdit[]> = {};
  for (const edit of edits) {
    (grouped[edit.selector] = grouped[edit.selector] || []).push(edit);
  }
  const isColorProp = (prop: string): boolean =>
    /color|background-color|border-color|fill|stroke/.test(prop)
      && !prop.includes('background-image');

  return (
    <div
      ref={ref}
      className="preview-edits-popover"
      role="dialog"
      aria-label="Pending changes"
      style={pos ? { top: pos.top, right: pos.right } : { visibility: 'hidden' }}
    >
      <div className="preview-edits-popover-header">
        {edits.length} CHANGE{edits.length === 1 ? '' : 'S'}
      </div>
      {Object.entries(grouped).map(([selector, groupEdits]) => (
        <div key={selector} className="preview-edits-popover-group">
          <ul className="preview-edits-popover-list">
            {groupEdits.map((edit, i) => (
              <li key={`${edit.property}-${i}`} className="preview-edits-popover-row">
                <span className="preview-edits-popover-prop">{edit.property}:</span>
                <div className="preview-edits-popover-values">
                  {isColorProp(edit.property) && edit.prevValue && (
                    <span
                      className="preview-edits-popover-swatch"
                      style={{ background: edit.prevValue }}
                      aria-hidden="true"
                    />
                  )}
                  {edit.prevValue ? (
                    <span className="preview-edits-popover-old">{edit.prevValue}</span>
                  ) : null}
                  <span className="preview-edits-popover-arrow">→</span>
                  {isColorProp(edit.property) && (
                    <span
                      className="preview-edits-popover-swatch"
                      style={{ background: edit.value }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="preview-edits-popover-new">{edit.value}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="preview-edits-popover-element">
            <div className="preview-edits-popover-label">ELEMENT</div>
            <code className="preview-edits-popover-selector">{selector}</code>
          </div>
        </div>
      ))}
      <div className="preview-edits-popover-actions">
        <button
          type="button"
          className="preview-edits-popover-action preview-edits-popover-action--primary"
          onClick={() => {
            // Cursor pattern: Apply anexa o diff ao chat composer como chip de
            // typeahead. PreviewView.handleApply dispara `undrcod:attach-css-changes`
            // que ChatView ouve e renderiza o card "N CHANGES" acima do input.
            onApply();
          }}
        >
          <i className="codicon codicon-send" />
          Apply
        </button>
        <button
          type="button"
          className="preview-edits-popover-action"
          onClick={() => onDiscard()}
        >
          <i className="codicon codicon-discard" />
          Discard
        </button>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  // Section header clicável (estilo Cursor css-section-header.clickable):
  // click no título toggla collapse/expand do body.
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={`preview-design-group ${collapsed ? 'is-collapsed' : ''}`}>
      <button
        type="button"
        className="preview-design-group-title preview-section-header"
        onClick={() => setCollapsed((p) => !p)}
        title={collapsed ? 'Expandir' : 'Colapsar'}
      >
        <i className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} />
        <span>{title}</span>
      </button>
      {!collapsed && <div className="preview-design-group-body">{children}</div>}
    </div>
  );
}


function Row({
  label,
  value,
  swatch,
  truncate,
}: {
  label: string;
  value: string;
  swatch?: boolean;
  truncate?: boolean;
}) {
  // Renderiza swatch de cor pra background/color rows.
  const isColor = swatch && /^(rgb|rgba|#)/.test(value);
  return (
    <div className="preview-design-row">
      <span className="preview-design-row-label">{label}</span>
      <span className={`preview-design-row-value ${truncate ? 'is-truncate' : ''}`}>
        {isColor && (
          <span
            className="preview-design-swatch"
            style={{ background: value }}
          />
        )}
        {value || '—'}
      </span>
    </div>
  );
}

function FourRow({
  top,
  right,
  bottom,
  left,
}: {
  top: string;
  right: string;
  bottom: string;
  left: string;
}) {
  return (
    <div className="preview-design-four">
      <span title="top">{top}</span>
      <span title="right">{right}</span>
      <span title="bottom">{bottom}</span>
      <span title="left">{left}</span>
    </div>
  );
}
