/**
 * preview-webview.ts — preload script attached ao <webview> do PreviewView.
 *
 * ARQUITETURA (espelha Cursor's preload-webview-browser.js):
 *   - Roda DENTRO do renderer process da página previewada (não no host)
 *   - Expõe `window.undrcodBrowser.send(event, payload)` via contextBridge
 *   - .send() chama ipcRenderer.sendToHost() — IPC nativo direto pro host
 *   - Host (PreviewView) escuta `webview.addEventListener('ipc-message', ...)`
 *
 * GANHO DE PERF vs abordagem anterior (executeJavaScript + console.log bridge):
 *   1. ZERO overhead quando inspector está off — não há listener global
 *      de mousemove rodando "always-on" com early-return.
 *   2. IPC nativo bypassa string encoding/parsing de console.log.
 *   3. Bridge type-safe via allowlist de eventos.
 *   4. Inspector é injetado on-demand via mensagem do host
 *      (host → preload → webFrame.executeJavaScript).
 */

import { contextBridge, ipcRenderer, webFrame } from 'electron';

// Allowlist de canais permitidos via send. Defesa contra abuso de scripts
// hostis dentro da página (XSS) tentando sniffar/poluir IPC do host.
const ALLOWED_CHANNELS = new Set<string>([
  'element-hovered',
  'element-selected',
  'element-additional-selected', // Ctrl+click: adiciona uid à seleção atual
  'element-deselected',          // Ctrl+click em selected: remove da seleção
  'element-updated',           // re-emit após apply-style — UI host re-sincroniza
  'text-edited',               // double-click in inspect mode → contenteditable commit
  'nudge-committed',           // Enter após arrow keys → host adiciona ao pendingEdits
  'inspector-ready',
  'inspector-escape',
  'style-applied',             // confirma aplicação (pro changelog)
  'navigation',
  'console-error',
  'preview-zoom-wheel',        // Ctrl+Wheel no webview → host atualiza zoom
  'preview-context-menu',      // right-click no webview → host abre context menu
  'preview-menu-relay-click',  // armed-relay: click DENTRO do webview enquanto
                               // menu host está aberto → host fecha. Só dispara
                               // quando __menuArmed=true (host arma via IPC).
]);

const bridge = {
  send: (channel: string, ...args: unknown[]): void => {
    if (!ALLOWED_CHANNELS.has(channel)) {
      console.warn('[undrcod-preview] blocked channel:', channel);
      return;
    }
    ipcRenderer.sendToHost(channel, ...args);
  },
};

try {
  contextBridge.exposeInMainWorld('undrcodBrowser', bridge);
} catch (err) {
  console.error('[undrcod-preview] failed to expose bridge:', err);
}

/**
 * Ctrl/Cmd + Wheel — intercepta no webview e propaga pro host pra ajustar zoom.
 *
 * Por que aqui (não no host React): o <webview> é um BrowserView isolado;
 * mouse events que acontecem em cima dele NÃO bubbleam pro DOM do host. A única
 * forma de capturar Ctrl+Wheel sobre a página previewada é dentro deste preload.
 *
 * Comportamento:
 *   - Apenas com Ctrl/Cmd pressionado (senão é scroll normal da página)
 *   - preventDefault impede o browser de tentar fazer page zoom built-in
 *   - Envia `preview-zoom-wheel` com `direction: 'in' | 'out'` (host avança step)
 *   - Capture phase (true) pra pegar antes da página
 */
window.addEventListener('wheel', (e: WheelEvent): void => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  e.stopPropagation();
  const direction: 'in' | 'out' = e.deltaY < 0 ? 'in' : 'out';
  try {
    ipcRenderer.sendToHost('preview-zoom-wheel', { direction });
  } catch { /* ignore */ }
}, { passive: false, capture: true });

/**
 * Right-click — intercepta no webview e propaga pro host pra abrir custom context menu.
 *
 * Por que aqui (igual o Ctrl+Wheel): events do webview NÃO chegam no host React,
 * o BrowserView é isolado. preventDefault cancela o menu nativo do Chromium
 * (que tem visual ruim em Electron), host renderiza o ContextMenu custom.
 *
 * Envia: x/y (clientes da viewport do host — somamos offset depois no host)
 * + flags úteis (selection presente, target é link, etc).
 */
window.addEventListener('contextmenu', (e: MouseEvent): void => {
  e.preventDefault();
  e.stopPropagation();
  const sel = window.getSelection();
  const hasSelection = !!(sel && sel.toString().length > 0);
  // Tenta detectar se o target é link/editable (informa o host pra ajustar items)
  const target = e.target as HTMLElement | null;
  const isLink = !!target?.closest('a[href]');
  const isEditable = !!target?.closest('input, textarea, [contenteditable="true"]');
  try {
    ipcRenderer.sendToHost('preview-context-menu', {
      x: e.clientX,
      y: e.clientY,
      hasSelection,
      isLink,
      isEditable,
    });
  } catch { /* ignore */ }
}, { capture: true });

/* === ARMED MENU-CLOSE RELAY ===
 *
 * Problema: quando um <ContextMenu> popover está aberto no host (React) e o
 * user clica DENTRO do <webview>, o click é consumido pelo guest renderer
 * e NÃO bubblia pro host — o ContextMenu's outside-click listener (no
 * window do host) nunca dispara.
 *
 * Soluções que NÃO funcionam (já testadas):
 *   - `pointer-events: none` no <webview>: layer compositada não respeita
 *   - Overlay <div> z-index alto: BrowserView pinta acima do DOM host
 *   - CDP `Input.setIgnoreInputEvents`: dropa input no guest, mas NÃO
 *     redireciona pra host — o click some, menu fica aberto
 *
 * Solução que FUNCIONA — armed-relay via IPC:
 *   1. Preload mantém um listener `mousedown` capture sempre attachado.
 *   2. Listener checa flag local `__menuArmed`. Default = false.
 *   3. Quando host abre menu, faz `webview.send('undrcod:menu-arm')`.
 *      Preload seta __menuArmed = true.
 *   4. Próximo mousedown DENTRO do webview → sendToHost('preview-menu-
 *      relay-click') + preventDefault (não deixa página ver o click)
 *   5. Host fecha menu + faz `webview.send('undrcod:menu-disarm')` → flag
 *      volta false. Zero IPC traffic dali em diante.
 *
 * Por que não causa spam (problema da tentativa anterior):
 *   - Listener só ENVIA IPC quando armed=true. Disarmed = early-return
 *     (overhead de 1 property lookup + 1 if). Imperceptível.
 *   - Mousedown único por click — não é mousemove. ~10 IPC/sessão máx.
 *   - Disarm imediato após primeiro click ON THE HOST garante 1 IPC só
 *     por menu open.
 *
 * Por que NÃO afeta zoom/F5/inspector/right-click:
 *   - É outro event (mousedown), outro handler, outro path.
 *   - Wheel/keydown/contextmenu não tocam __menuArmed.
 *   - Inspector tem seu próprio mousedown (no INSPECTOR_SOURCE injetado),
 *     que roda em capture phase também — mas só após inspector ativo.
 *     E o inspector é mutuamente exclusivo com menus (UX).
 */

// Flag local. Acessada via closure pelo listener — não polui window pra
// não interferir com a página previewada.
const menuRelay = { armed: false };

// Listener SEMPRE attachado. Capture phase pra rodar antes de qualquer
// handler da página. Early-return ultra-rápido quando disarmed.
let mousedownDebugCount = 0;
let lastMousedownTime = 0;
const mousedownHandler = (e: MouseEvent): void => {
  // Dedup: window e document podem ambos disparar pra mesmo event.
  // Usa timestamp como key — events do mesmo gesto compartilham timestamp.
  if (e.timeStamp === lastMousedownTime) return;
  lastMousedownTime = e.timeStamp;

  // DEBUG: log primeiros 5 events pra confirmar listener está vivo.
  try {
    if (mousedownDebugCount < 5) {
      mousedownDebugCount++;
      console.debug(`[undrcod-preview] mousedown #${mousedownDebugCount} captured, armed=`, menuRelay.armed, 'button=', e.button);
    }
  } catch { /* ignore */ }

  if (!menuRelay.armed) return; // Hot path
  if (e.button > 1) return; // só left/middle, right-click tem fluxo próprio
  // Bloqueia página de processar (defende contra side-effects)
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  try {
    ipcRenderer.sendToHost('preview-menu-relay-click', {
      x: e.clientX,
      y: e.clientY,
      button: e.button,
    });
  } catch { /* ignore */ }
  // Disarm local pra evitar double-fire
  menuRelay.armed = false;
  try { console.debug('[undrcod-preview] menu-relay click forwarded to host'); } catch { /* */ }
};

// Triple-coverage: window + document. Algumas situações de timing podem
// fazer só um disparar. Dedup via timestamp.
window.addEventListener('mousedown', mousedownHandler, { capture: true });
document.addEventListener('mousedown', mousedownHandler, { capture: true });

// Host arma/desarma via webview.send (chega via ipcRenderer.on aqui).
ipcRenderer.on('undrcod:menu-arm', () => {
  menuRelay.armed = true;
  try { console.debug('[undrcod-preview] menu-relay ARMED'); } catch { /* ignore */ }
});
ipcRenderer.on('undrcod:menu-disarm', () => {
  menuRelay.armed = false;
  try { console.debug('[undrcod-preview] menu-relay DISARMED'); } catch { /* ignore */ }
});

/**
 * Inspector script — injetado sob demanda quando o host manda `activate-inspector`.
 * Self-contained: usa `window.undrcodBrowser.send` pra comunicar de volta.
 * IIFE pra evitar pollution do escopo global da página.
 */
const INSPECTOR_SOURCE = `(() => {
  // Re-injeção pós-navegação SPA: window.__undrcodInspector pode sobreviver
  // mas overlays podem ter sido descartados.
  if (window.__undrcodInspector) {
    const existing = window.__undrcodInspectorOverlay;
    if (existing && existing.isConnected) return;
    try { window.__undrcodInspector.deactivate(); } catch (e) { /* ignore */ }
    delete window.__undrcodInspector;
    delete window.__undrcodInspectorOverlay;
  }

  // Injeta CSS GLOBAL com seletor de alta especificidade pra nuclear QUALQUER
  // estilo de :focus / :focus-visible / contenteditable do site. Especificidade
  // = 4 attribute selectors > qualquer regra normal do site, e !important
  // empata com !important do site mas o nosso vem depois na cascade.
  if (!document.getElementById('__undrcod-edit-style')) {
    const editStyle = document.createElement('style');
    editStyle.id = '__undrcod-edit-style';
    editStyle.textContent =
      '[data-undrcod-editing][data-undrcod-editing][data-undrcod-editing][data-undrcod-editing],' +
      '[data-undrcod-editing][data-undrcod-editing][data-undrcod-editing][data-undrcod-editing]:focus,' +
      '[data-undrcod-editing][data-undrcod-editing][data-undrcod-editing][data-undrcod-editing]:focus-visible,' +
      '[data-undrcod-editing][data-undrcod-editing][data-undrcod-editing][data-undrcod-editing]:focus-within {' +
      'outline: 0 !important;' +
      'outline-style: none !important;' +
      'outline-width: 0 !important;' +
      'outline-color: transparent !important;' +
      'outline-offset: 0 !important;' +
      'box-shadow: none !important;' +
      '-webkit-tap-highlight-color: transparent !important;' +
      'caret-color: #f5b800 !important;' +
      // Trava DIMENSÕES — site pode crescer o elemento via [contenteditable]
      // styles (min-height, padding, height). Bloqueia crescimento vertical.
      'min-height: 0 !important;' +
      'max-height: none !important;' +
      'height: auto !important;' +
      // Algumas libs aplicam display: flex / align: end etc — força block.
      // Comentado pra não quebrar elementos que precisam ser flex/grid:
      // 'display: block !important;' +
      // Preserva padding original — não zera pq pode quebrar layout legit.
      // Mas garante que NENHUM padding extra seja adicionado via :focus styles.
      // Se o site adiciona padding em :focus, a regra normal (sem :focus)
      // ainda aplica e mantém o original.
      '}';
    (document.head || document.documentElement).appendChild(editStyle);
  }

  // === Constantes visuais (espelha Cursor) ===
  const HOVER_BORDER = '2px solid rgba(58,150,221,0.5)';
  const HOVER_BG = 'transparent';
  const SELECTED_BORDER = '2px solid #3a96dd';
  // Cursor pattern: highlight overlay é APENAS border, sem background fill.
  // O fill anterior (rgba(58,150,221,0.08)) criava uma leve "mancha" translúcida
  // sobre o elemento que em fundo escuro parecia clarear/desbotar a cor.
  const SELECTED_BG = 'transparent';
  // CSS transition pra movimento smooth (80ms) entre elementos — sensação
  // de "fluido" do Cursor vem 90% daqui.
  const GEOM_TRANSITION = 'left 0.08s ease,top 0.08s ease,width 0.08s ease,height 0.08s ease';

  // === Dois boxes separados (padrão Cursor) ===
  // highlightBox: rect do elemento ATIVO (hovered se não frozen, selected se frozen)
  // hoverPreviewBox: rect do elemento sob cursor QUANDO há seleção (frozen)
  //                  — permite ver onde vai clicar SEM perder a seleção atual
  const highlightBox = document.createElement('div');
  highlightBox.setAttribute('data-undrcod-inspector', 'highlight');
  highlightBox.style.cssText =
    'position:fixed;border:' + HOVER_BORDER + ';background:' + HOVER_BG + ';' +
    'pointer-events:none;z-index:2147483647;transition:' + GEOM_TRANSITION + ';display:none;top:0;left:0;';
  document.body.appendChild(highlightBox);
  window.__undrcodInspectorOverlay = highlightBox;

  // identityPill: label compacto. Em hover (não-frozen) segue cursor com info
  // completa. Em frozen ancora no top-left do rect com só tag+id.
  // Padding/font menores que Cursor pra ficar discreto (estilo DevTools).
  const identityPill = document.createElement('div');
  identityPill.setAttribute('data-undrcod-inspector', 'pill');
  identityPill.style.cssText =
    'position:fixed;background:#3a96dd;color:#fff;' +
    'padding:2px 6px;border-radius:3px;font:500 11px/1.3 ui-monospace,Menlo,Consolas,monospace;' +
    'pointer-events:none;white-space:nowrap;z-index:2147483647;' +
    'max-width:320px;overflow:hidden;text-overflow:ellipsis;display:none;' +
    'box-shadow:0 2px 6px rgba(0,0,0,0.25);';
  document.body.appendChild(identityPill);

  // hoverPreviewBox: secondary highlight (só visível quando frozen)
  const hoverPreviewBox = document.createElement('div');
  hoverPreviewBox.setAttribute('data-undrcod-inspector', 'preview');
  hoverPreviewBox.style.cssText =
    'position:fixed;border:' + HOVER_BORDER + ';background:' + HOVER_BG + ';' +
    'pointer-events:none;z-index:2147483645;transition:' + GEOM_TRANSITION + ';display:none;top:0;left:0;';
  document.body.appendChild(hoverPreviewBox);

  // === State ===
  let frozen = false;             // true quando um elemento foi clicado (seleção sticky)
  let lastHoveredElement = null;
  let lastMouseX = 0, lastMouseY = 0;
  let rafPending = false;

  // Multi-select state: extras são overlays ADICIONAIS pintados pra elementos
  // selecionados via Ctrl+click. Lista de { uid, el, overlay }.
  const extras = [];

  // Nudge offsets — Map<uid, {dx, dy}> acumulado por arrow keys.
  // Source of truth pro nudge (não confia em getComputedStyle/inline que
  // podem ficar stale entre presses).
  const nudgeOffsets = new Map();

  // Inline text edit state: quando user dá double-click num elemento com text
  // node único, viramos contenteditable. Guarda { el, uid, oldText, prevCE }
  // pra restaurar/commitar no finish.
  let editingState = null;

  // === Helpers ===
  const isOwnNode = (n) => {
    if (n === highlightBox || n === identityPill || n === hoverPreviewBox) return true;
    for (let i = 0; i < extras.length; i++) if (extras[i].overlay === n) return true;
    return false;
  };

  // Cria overlay pra um elemento extra. Pinta com mesma cor do selected mas
  // dashed pra diferenciar do primary. Não usa transition pra evitar lag.
  const createExtraOverlay = () => {
    const box = document.createElement('div');
    box.setAttribute('data-undrcod-inspector', 'extra-highlight');
    box.style.cssText =
      'position:fixed;border:2px dashed #3a96dd;background:transparent;' +
      'pointer-events:none;z-index:2147483646;top:0;left:0;display:none;';
    document.body.appendChild(box);
    return box;
  };
  const positionExtraOverlay = (overlay, el) => {
    if (!el || !overlay) return;
    const r = el.getBoundingClientRect();
    overlay.style.display = '';
    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  };
  const repositionAllExtras = () => {
    for (let i = 0; i < extras.length; i++) {
      positionExtraOverlay(extras[i].overlay, extras[i].el);
    }
  };
  const clearExtras = () => {
    for (let i = 0; i < extras.length; i++) {
      try { extras[i].overlay.remove(); } catch (e) { /* noop */ }
    }
    extras.length = 0;
  };
  const findExtraIndex = (uid) => {
    for (let i = 0; i < extras.length; i++) if (extras[i].uid === uid) return i;
    return -1;
  };

  // bubbleToMeaningful: se o user hover num <span> dentro de um button, sobe
  // pro button. "Meaningful" = tem id, classe, ou tag semântica. Evita pegar
  // wrappers div sem identidade. Espelha Cursor.
  const SEMANTIC_TAGS = new Set(['a','button','input','select','textarea','label','nav','header','footer','main','article','section','aside','form','table','tr','td','th','li','ul','ol','img','video','svg','canvas','h1','h2','h3','h4','h5','h6']);
  const bubbleToMeaningful = (el) => {
    let cur = el;
    let depth = 0;
    while (cur && cur !== document.body && depth < 6) {
      if (cur.id) return cur;
      if (cur.classList && cur.classList.length > 0) return cur;
      if (SEMANTIC_TAGS.has(cur.tagName.toLowerCase())) return cur;
      cur = cur.parentElement;
      depth++;
    }
    return el;
  };

  const buildPath = (el) => {
    const out = [];
    let cur = el;
    while (cur && cur !== document.documentElement) {
      out.unshift({
        tag: cur.tagName.toLowerCase(),
        id: cur.id || '',
        classes: Array.from(cur.classList || []),
      });
      cur = cur.parentElement;
    }
    return out;
  };

  // Skip tags: nao queremos no painel components.
  const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, NOSCRIPT: 1, BR: 1, HR: 1 };
  // Limites pra nao estourar memoria em paginas grandes.
  const MAX_TREE_NODES = 2000;
  const MAX_TREE_DEPTH = 25;

  // Constroi arvore DOM recursiva pro painel Components. Cada no leva uid
  // estavel (assignado ao DOM via data-undrcod-uid) pra select via click.
  // Cap em MAX_TREE_NODES total + MAX_TREE_DEPTH pra performance.
  const buildDomTree = (root) => {
    let nodeCount = 0;
    const recur = (el, depth) => {
      if (!el || depth > MAX_TREE_DEPTH || nodeCount >= MAX_TREE_NODES) return null;
      if (SKIP_TAGS[el.tagName]) return null;
      nodeCount++;
      const uid = getOrAssignUid(el);
      const kids = [];
      for (let i = 0; i < el.children.length; i++) {
        if (nodeCount >= MAX_TREE_NODES) break;
        const c = recur(el.children[i], depth + 1);
        if (c) kids.push(c);
      }
      return {
        uid: uid,
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        classes: Array.from(el.classList || []).slice(0, 5),
        children: kids,
      };
    };
    return recur(root, 0);
  };

  const buildDesignProps = (cs) => ({
    width: cs.width, height: cs.height,
    paddingTop: cs.paddingTop, paddingRight: cs.paddingRight,
    paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
    marginTop: cs.marginTop, marginRight: cs.marginRight,
    marginBottom: cs.marginBottom, marginLeft: cs.marginLeft,
    borderRadius: cs.borderRadius, opacity: cs.opacity,
    backgroundColor: cs.backgroundColor, color: cs.color,
    fontFamily: cs.fontFamily, fontSize: cs.fontSize,
    fontWeight: cs.fontWeight, lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing, display: cs.display,
    flexDirection: cs.flexDirection, position: cs.position,
  });

  const USEFUL_PROPS = [
    // Layout / Box model
    'display','position','top','right','bottom','left','width','height',
    'min-width','min-height','max-width','max-height',
    'box-sizing',  // pra Border box checkbox
    // Flex / Grid
    'flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis',
    'justify-content','align-items','align-self','align-content',
    'gap','column-gap','row-gap',
    'grid-template-columns','grid-template-rows','grid-area',
    // Spacing (shorthand + individual sides — Cursor reads per-side)
    'margin','margin-top','margin-right','margin-bottom','margin-left',
    'padding','padding-top','padding-right','padding-bottom','padding-left',
    // Border (shorthand + individual)
    'border','border-width','border-style','border-color',
    'border-top','border-right','border-bottom','border-left',
    'border-radius','border-top-left-radius','border-top-right-radius',
    'border-bottom-left-radius','border-bottom-right-radius',
    'outline','outline-color','outline-style','outline-width','outline-offset',
    // Effects
    'box-shadow','filter','backdrop-filter','mix-blend-mode',
    'opacity','visibility',
    // Fill / Background — inclui clip/origin pra TextColorPaint detectar
    // text-gradient (background-clip:text + background-image:gradient) e o
    // BackgroundPaint detectar none vs gradient corretamente.
    'background','background-color','background-image','background-size',
    'background-position','background-repeat','background-attachment',
    'background-clip','-webkit-background-clip','background-origin',
    // Border-image — necessário pra BorderPaint detectar gradient stroke.
    'border-image','border-image-source','border-image-slice','border-image-repeat',
    // Typography
    'color','font-family','font-size','font-weight','font-style',
    'line-height','letter-spacing','word-spacing',
    'text-align','text-decoration','text-transform','text-indent',
    'vertical-align','white-space','word-break','overflow-wrap',
    // Overflow / Scroll
    'overflow','overflow-x','overflow-y','scroll-behavior',
    // Other
    'z-index','cursor','transition','transform','transform-origin',
    'pointer-events','user-select','content',
  ];

  // Coleta fontes detectadas: system fonts + custom via @font-face + CSS vars.
  const collectAvailableFonts = () => {
    const fonts = new Set();
    // 1) Fontes carregadas via @font-face (document.fonts iterable)
    try {
      if (document.fonts && document.fonts.forEach) {
        document.fonts.forEach((font) => {
          if (font && font.family) fonts.add(font.family.replace(/['"]/g, ''));
        });
      }
    } catch (_) { /* ignore */ }
    // 2) System fonts comuns sempre disponíveis
    const systemFonts = [
      'system-ui', 'sans-serif', 'serif', 'monospace', 'cursive',
      'Inter', 'Roboto', 'Helvetica', 'Arial', 'Georgia',
      'Times New Roman', 'Courier New', 'Menlo', 'Consolas',
      'JetBrains Mono', 'Fira Code', 'SF Pro Text', 'Segoe UI',
    ];
    systemFonts.forEach((f) => fonts.add(f));
    return Array.from(fonts).sort();
  };

  // Detecta React component no elemento via Fiber tree (React 16+).
  // Acessa __reactFiber$XXX prop (rendered by React DOM) e extrai name + props.
  // Não usa React DevTools hook pra evitar dependência. Best-effort.
  const detectReactComponent = (el) => {
    try {
      // Acha a fiber key (__reactFiber$XXX, varia o suffix)
      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance'));
      if (!fiberKey) return undefined;
      const fiber = el[fiberKey];
      if (!fiber) return undefined;

      // Sobe pelo return ate achar fiber com component (function/class)
      let current = fiber;
      let depth = 0;
      while (current && depth < 30) {
        const t = current.type;
        if (typeof t === 'function') {
          // Achou component
          const name = t.displayName || t.name || 'Anonymous';
          const props = current.memoizedProps || {};
          // Children: filhos do fiber atual
          const children = [];
          let childFiber = current.child;
          let cdepth = 0;
          while (childFiber && cdepth < 100) {
            const cname = (typeof childFiber.type === 'function')
              ? (childFiber.type.displayName || childFiber.type.name || 'Anonymous')
              : (typeof childFiber.type === 'string' ? childFiber.type : null);
            if (cname) children.push({ name: cname });
            childFiber = childFiber.sibling;
            cdepth++;
          }
          // Filtra props que são funções/objetos complexos pra display
          const propsClean = {};
          for (const k in props) {
            const v = props[k];
            if (k === 'children') continue;
            propsClean[k] = v;
          }
          return {
            name: name,
            props: propsClean,
            childCount: children.length,
            children: children.slice(0, 100),
          };
        }
        current = current.return;
        depth++;
      }
      return undefined;
    } catch (_) {
      return undefined;
    }
  };

  const buildAllStyles = (cs) => {
    const out = {};
    for (const p of USEFUL_PROPS) out[p] = cs.getPropertyValue(p);
    return out;
  };

  const renderPill = (el) => {
    const cls = el.classList.length ? '.' + Array.from(el.classList).slice(0, 2).join('.') : '';
    const id = el.id ? '#' + el.id : '';
    const r = el.getBoundingClientRect();
    identityPill.textContent = el.tagName.toLowerCase() + id + cls + ' · ' + Math.round(r.width) + '×' + Math.round(r.height);
  };

  const positionPill = () => {
    // Pill segue o cursor (estilo tooltip), não a rect.
    const pillLeft = lastMouseX + 12;
    const pillTop = lastMouseY + 20;
    identityPill.style.right = '';
    if (pillLeft + 320 > window.innerWidth) {
      identityPill.style.left = '';
      identityPill.style.right = '4px';
    } else {
      identityPill.style.left = pillLeft + 'px';
    }
    identityPill.style.top = Math.min(pillTop, window.innerHeight - 28) + 'px';
  };

  // updateHighlight: pinta o highlightBox no rect do elemento.
  // - frozen: borda + bg solid + pill compacto colado no top-left mostrando
  //   só o tag (p, h1, button, etc) — estilo DevTools.
  // - hover (não frozen): borda fina + pill grande seguindo cursor
  //   com tag.class · WxH.
  const updateHighlight = (element) => {
    // Em edit mode, NÃO mexe no highlightBox/identityPill — startTextEdit
    // controla cor/pos/visibilidade dos overlays. Guard de defense-in-depth
    // (apply-style/undo IPCs também chamam updateHighlight).
    if (editingState) return;
    if (!element) {
      highlightBox.style.display = 'none';
      identityPill.style.display = 'none';
      return;
    }
    const r = element.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      highlightBox.style.display = 'none';
      identityPill.style.display = 'none';
      return;
    }
    highlightBox.style.display = '';
    highlightBox.style.left = r.left + 'px';
    highlightBox.style.top = r.top + 'px';
    highlightBox.style.width = r.width + 'px';
    highlightBox.style.height = r.height + 'px';
    // POLISH #207: overlay acompanha border-radius do elemento. Antes era sempre
    // quadrado — destoava quando elemento tinha cantos arredondados (ex: card
    // com border-radius:147px). Lê computed style e aplica no overlay.
    // Performance: getComputedStyle por elemento é OK (chama 1x por highlight),
    // não em loop. Cache não necessário pra esse use case.
    try {
      const cs = getComputedStyle(element);
      // Lê as 4 longhand pra suportar per-corner radius (border-top-left-radius
      // diferente de border-bottom-right-radius, etc).
      const tl = cs.borderTopLeftRadius;
      const tr = cs.borderTopRightRadius;
      const br = cs.borderBottomRightRadius;
      const bl = cs.borderBottomLeftRadius;
      // Se todos os 4 são iguais e zero, set vazio (mais limpo no DOM).
      if (tl === tr && tr === br && br === bl && (tl === '0px' || tl === '')) {
        highlightBox.style.borderRadius = '';
      } else {
        // Shorthand custom com 4 valores: top-left top-right bottom-right bottom-left.
        highlightBox.style.borderRadius = tl + ' ' + tr + ' ' + br + ' ' + bl;
      }
    } catch (e) {
      highlightBox.style.borderRadius = '';
    }

    if (frozen) {
      // Selected: borda azul sólida + bg azul translúcido + pill compacto
      // anchorado no canto top-left do elemento (estilo DevTools).
      highlightBox.style.border = SELECTED_BORDER;
      highlightBox.style.background = SELECTED_BG;
      renderPillCompact(element);
      positionPillAtElement(r);
      identityPill.style.display = '';
      return;
    }
    // Hover: borda fina + pill detalhado seguindo cursor.
    highlightBox.style.border = HOVER_BORDER;
    highlightBox.style.background = HOVER_BG;
    renderPill(element);
    positionPill();
    identityPill.style.display = '';
  };

  // Pill compacto: só tag + (opcionalmente) #id. Pra modo frozen, ancora
  // no canto top-left do rect — ocupa pouco espaço, deixa o conteúdo visível.
  const renderPillCompact = (el) => {
    const id = el.id ? '#' + el.id : '';
    identityPill.textContent = el.tagName.toLowerCase() + id;
  };

  // Posiciona pill no canto superior esquerdo do elemento, ligeiramente
  // sobreposto pra ficar grudado na borda. Se o rect está perto do topo
  // da viewport, pill vai pra baixo da borda em vez de acima.
  const positionPillAtElement = (rect) => {
    identityPill.style.right = '';
    identityPill.style.left = Math.max(0, rect.left) + 'px';
    // Se top tem espaço pra pill acima (~22px), coloca acima do rect colado.
    // Senão coloca dentro do rect (no canto top-left).
    if (rect.top >= 22) {
      identityPill.style.top = (rect.top - 21) + 'px';
    } else {
      identityPill.style.top = (rect.top + 1) + 'px';
    }
  };

  // updateHoverPreview: segunda rect, só visível quando frozen — mostra
  // qual elemento será clicado se user mover o mouse.
  const updateHoverPreview = (element) => {
    if (!element || !frozen) {
      hoverPreviewBox.style.display = 'none';
      return;
    }
    const r = element.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      hoverPreviewBox.style.display = 'none';
      return;
    }
    hoverPreviewBox.style.display = '';
    hoverPreviewBox.style.left = r.left + 'px';
    hoverPreviewBox.style.top = r.top + 'px';
    hoverPreviewBox.style.width = r.width + 'px';
    hoverPreviewBox.style.height = r.height + 'px';
    hoverPreviewBox.style.border = HOVER_BORDER;
    hoverPreviewBox.style.background = HOVER_BG;
    // POLISH #207: matching border-radius (mesmo treatment do highlightBox).
    try {
      const cs = getComputedStyle(element);
      const tl = cs.borderTopLeftRadius;
      const tr = cs.borderTopRightRadius;
      const br = cs.borderBottomRightRadius;
      const bl = cs.borderBottomLeftRadius;
      if (tl === tr && tr === br && br === bl && (tl === '0px' || tl === '')) {
        hoverPreviewBox.style.borderRadius = '';
      } else {
        hoverPreviewBox.style.borderRadius = tl + ' ' + tr + ' ' + br + ' ' + bl;
      }
    } catch (e) {
      hoverPreviewBox.style.borderRadius = '';
    }
  };

  // UID stable pra editing (sobrevive a React re-renders mesmo se DOM ref muda).
  // Atribuído ao elemento via data-undrcod-uid quando selecionado.
  let uidCounter = 0;
  const getOrAssignUid = (el) => {
    let uid = el.getAttribute('data-undrcod-uid');
    if (!uid) {
      uid = 'undrcod-' + (++uidCounter);
      el.setAttribute('data-undrcod-uid', uid);
    }
    return uid;
  };

  const sendPicked = (el) => {
    if (!el) return;
    // Atribui uid + guarda referência global pra fallback do apply-style.
    const uid = getOrAssignUid(el);
    window.__undrcodInspectorTarget = el;
    const r = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    // Position no viewport (rect.left/top SEM scroll). Igual Cursor:
    //   positionXValue = parsedCssLeft ?? rect.left
    // Quando o user habilita absolute, left/top sao setados nesse valor
    // viewport-local, que casa com onde o elemento aparece visualmente.
    const offsetX = r.left;
    const offsetY = r.top;
    window.undrcodBrowser && window.undrcodBrowser.send('element-selected', {
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      classes: Array.from(el.classList),
      text: (el.textContent || '').trim().slice(0, 80),
      // rect: viewport-relative (pra desenhar overlay/highlight no inspector).
      // offset: parent-relative (pra exibir X/Y no painel Position — bate com CSS).
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      offset: { x: offsetX, y: offsetY },
      path: buildPath(el),
      designProps: buildDesignProps(cs),
      allStyles: buildAllStyles(cs),
      // Inline styles raw — preserva valores que computed perde (ex: rotate(540deg)
      // que getComputedStyle converte pra matrix(...) e atan2 trunca pra [-180,180]).
      // Usado pra acumular rotation indefinidamente sem clamp.
      inlineStyles: { transform: el.style.transform || '' },
      uid: uid,
      // Arvore DOM completa do body — host renderiza no painel Components.
      domTree: buildDomTree(document.body),
      // Fonts detectadas na página — Typography dropdown usa esta lista.
      // Inclui fontes do CSS local + system + custom loaded via @font-face.
      availableFontFamilies: collectAvailableFonts(),
      // React Fiber detection (best-effort). Cursor faz isso via React DevTools hook.
      reactComponent: detectReactComponent(el),
    });
  };

  // ─── Inline text edit (dblclick) ───────────────────────────────────────
  // Heurística: edita elemento que tem text content E nenhum filho block-level.
  // Aceita text nodes + inline elements (a, code, em, strong, span, etc) pra
  // funcionar em <p>Texto <code>inline</code> texto</p>. Rejeita só se houver
  // filho block (div, section, ul, etc) pra não destruir layouts compostos.
  const INLINE_TAGS = new Set([
    'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn',
    'em', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong',
    'sub', 'sup', 'time', 'u', 'var', 'wbr', 'ins', 'del', 'ruby', 'rt', 'rp',
  ]);
  const isEditableTextElement = (el) => {
    if (!el || !el.childNodes || el.childNodes.length === 0) return false;
    if ((el.textContent || '').trim().length === 0) return false;
    // Checa cada child: text node OK, inline element OK, qualquer outra coisa rejeita.
    for (let i = 0; i < el.childNodes.length; i++) {
      const n = el.childNodes[i];
      if (n.nodeType === 3) continue; // text node OK
      if (n.nodeType === 1) {
        const tag = n.tagName.toLowerCase();
        if (INLINE_TAGS.has(tag)) continue;
        // Computed display inline também conta (span com display custom etc)
        try {
          const d = window.getComputedStyle(n).display;
          if (d === 'inline' || d === 'inline-block' || d === 'inline-flex') continue;
        } catch (e) { /* noop */ }
        return false;
      }
      // Comments/other = ignora
    }
    return true;
  };

  // Pinta highlightBox no rect do TEXTO (não do elemento). Usa Range pra
  // pegar bounds só da text content — abraça as linhas de texto reais sem
  // pegar padding/min-height/etc do elemento. Em multi-line text fica num
  // box que cobre só as linhas usadas.
  const positionHighlightOnTextRange = (el) => {
    let r;
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      r = range.getBoundingClientRect();
      // Se range deu zero (elemento vazio), fallback pro elemento mesmo.
      if (r.width === 0 && r.height === 0) r = el.getBoundingClientRect();
    } catch (e) {
      r = el.getBoundingClientRect();
    }
    highlightBox.style.display = '';
    highlightBox.style.left = (r.left - 2) + 'px';
    highlightBox.style.top = (r.top - 2) + 'px';
    highlightBox.style.width = (r.width + 4) + 'px';
    highlightBox.style.height = (r.height + 4) + 'px';
  };

  const startTextEdit = (el) => {
    if (!el || editingState) return;
    // MARCA editingState ANTES de qualquer DOM mutation. focus() ou
    // contenteditable podem disparar reflow → scroll event → onResize →
    // updateHighlight, que SEM esse guard repintaria o highlightBox no
    // novo BCR (elemento cresce quando vira contenteditable). Marker
    // truthy garante que o guard de updateHighlight ja bloqueia.
    editingState = { _bootstrap: true };
    const uid = getOrAssignUid(el);
    const oldText = el.textContent || '';
    const prevCE = el.getAttribute('contenteditable');
    const prevElOutline = el.style.outline;
    const prevElCursor = el.style.cursor;
    const prevElBoxShadow = el.style.boxShadow;
    // Trava apenas padding (preserva original) e min-height: 0 — sem trava
    // de height/overflow/line-height pra não criar overflow do texto pra fora.
    // Aceita que o elemento PODE crescer durante edit (limitação contenteditable
    // em sites com Tailwind border-2; o texto fica dentro do box mesmo crescido).
    const cs = window.getComputedStyle(el);
    const prevElPadding = el.style.padding;
    const prevElMinHeight = el.style.minHeight;
    const prevElHeight = el.style.height;
    const prevElMaxHeight = el.style.maxHeight;
    const prevElWidth = el.style.width;
    const prevElLineHeight = el.style.lineHeight;
    const prevElOverflow = el.style.overflow;
    el.style.setProperty('padding-top', cs.paddingTop, 'important');
    el.style.setProperty('padding-right', cs.paddingRight, 'important');
    el.style.setProperty('padding-bottom', cs.paddingBottom, 'important');
    el.style.setProperty('padding-left', cs.paddingLeft, 'important');
    el.style.setProperty('min-height', '0', 'important');
    el.setAttribute('contenteditable', 'plaintext-only');
    el.setAttribute('data-undrcod-editing', 'true');
    el.style.cursor = 'text';
    // Suprime QUALQUER focus ring (outline/box-shadow) do Chrome E do site.
    // Setados com !important pra bater Tailwind ring-* utilities + design systems.
    // O nosso highlightBox amarelo JÁ marca o estado de edit.
    el.style.setProperty('outline', 'none', 'important');
    el.style.setProperty('box-shadow', 'none', 'important');
    // Pinta o highlightBox amarelo no rect do TEXTO (Range BCR), não do
    // Esconde TUDO durante edit — o caret do contenteditable é o indicador.
    // Garante que NENHUMA overlay nossa apareça interferindo visualmente.
    const prevHighlightDisplay = highlightBox.style.display;
    highlightBox.style.display = 'none';
    const prevPillDisplay = identityPill.style.display;
    identityPill.style.display = 'none';
    const prevHoverPreviewDisplay = hoverPreviewBox.style.display;
    hoverPreviewBox.style.display = 'none';
    el.focus();
    // NÃO seleciona tudo automaticamente — caret fica onde o user clicou.
    // Isso preserva inline children (<code>, <a>, <em>) quando user só quer
    // editar uma palavra. Pra substituir tudo, user dá Ctrl+A na hora.
    // Se o caret ficou solto (clicar em padding), posiciona no fim do texto.
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount === 0) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false); // caret no fim
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (e) { /* noop */ }
    // Reposiciona overlays de multi-select se houver (não mexe no highlightBox
    // — ele tá escondido durante edit).
    const onInput = () => {
      if (extras.length > 0) repositionAllExtras();
    };
    el.addEventListener('input', onInput);
    editingState = { el, uid, oldText, prevCE, onInput, prevElOutline, prevElCursor, prevElBoxShadow, prevPillDisplay, prevHoverPreviewDisplay, prevHighlightDisplay, prevElPadding, prevElMinHeight, prevElHeight, prevElMaxHeight, prevElWidth, prevElLineHeight, prevElOverflow };
  };

  const finishTextEdit = (commit) => {
    if (!editingState) return;
    const { el, uid, oldText, prevCE, onInput, prevElOutline, prevElCursor, prevElBoxShadow, prevPillDisplay, prevHoverPreviewDisplay, prevHighlightDisplay, prevElPadding, prevElMinHeight, prevElHeight, prevElMaxHeight, prevElWidth, prevElLineHeight, prevElOverflow } = editingState;
    editingState = null;
    // Restore overlays — display antes do updateHighlight (que reposiciona tudo)
    identityPill.style.display = prevPillDisplay || '';
    hoverPreviewBox.style.display = prevHoverPreviewDisplay || 'none';
    highlightBox.style.display = prevHighlightDisplay || '';
    // Restore padding/min-height/height locks
    el.style.removeProperty('padding-top');
    el.style.removeProperty('padding-right');
    el.style.removeProperty('padding-bottom');
    el.style.removeProperty('padding-left');
    el.style.removeProperty('min-height');
    el.style.removeProperty('height');
    el.style.removeProperty('max-height');
    el.style.removeProperty('line-height');
    el.style.removeProperty('overflow');
    if (prevElPadding) el.style.padding = prevElPadding;
    if (prevElMinHeight) el.style.minHeight = prevElMinHeight;
    if (prevElHeight) el.style.height = prevElHeight;
    if (prevElMaxHeight) el.style.maxHeight = prevElMaxHeight;
    if (prevElWidth) el.style.width = prevElWidth;
    if (prevElLineHeight) el.style.lineHeight = prevElLineHeight;
    if (prevElOverflow) el.style.overflow = prevElOverflow;
    const newText = el.textContent || '';
    // Restore attributes/style
    if (prevCE === null) el.removeAttribute('contenteditable');
    else el.setAttribute('contenteditable', prevCE);
    el.removeAttribute('data-undrcod-editing');
    el.style.cursor = prevElCursor || '';
    // setProperty foi usado com !important — limpa explícito antes de restaurar.
    el.style.removeProperty('outline');
    el.style.removeProperty('box-shadow');
    if (prevElOutline) el.style.outline = prevElOutline;
    if (prevElBoxShadow) el.style.boxShadow = prevElBoxShadow;
    if (onInput) {
      try { el.removeEventListener('input', onInput); } catch (e) { /* noop */ }
    }
    if (!commit && newText !== oldText) {
      el.textContent = oldText;
    } else if (commit && newText !== oldText) {
      window.undrcodBrowser && window.undrcodBrowser.send('text-edited', {
        uid, oldText, newText,
        // Path simples só pra mensagem do agente.
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        classes: Array.from(el.classList),
      });
    }
    try { el.blur(); } catch (e) { /* noop */ }
    // Re-pinta highlight do primary (rect pode ter mudado se text reflowed).
    if (frozen && lastHoveredElement) updateHighlight(lastHoveredElement);
    if (extras.length > 0) repositionAllExtras();
  };

  const onDblClick = (e) => {
    if (e.button !== 0) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isOwnNode(el)) {
      // Bloqueia comportamento default mesmo se não editar
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation && e.stopImmediatePropagation();
      return;
    }
    const meaningful = bubbleToMeaningful(el);
    if (!isEditableTextElement(meaningful)) {
      // Não é editável (tem elementos filhos) — bloqueia e ignora.
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation && e.stopImmediatePropagation();
      return;
    }
    // Editável: NÃO bloqueia preventDefault. Inicia edit.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation && e.stopImmediatePropagation();
    startTextEdit(meaningful);
  };

  // Keydown enquanto editando — Enter (sem shift) = commit; Esc = cancel.
  // Capture phase pra ganhar dos inspector keys (Esc, Ctrl+Z, etc).
  const onEditingKey = (e) => {
    if (!editingState) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation && e.stopImmediatePropagation();
      finishTextEdit(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation && e.stopImmediatePropagation();
      finishTextEdit(false);
    }
  };

  // === Event handlers ===
  const onMouseMove = (e) => {
    // Editando texto — não pinta highlight em cima.
    if (editingState) return;
    // Skip mousemove updates do inspector enquanto pan tá rolando — senão
    // o highlight fica pulando junto com o scroll e atrapalha o pan.
    if (window.__undrcodPanning) return;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      // elementFromPoint é mais preciso que e.target — pega exatamente o
      // que está no pixel sob o cursor, ignorando wrappers/portals.
      const el = document.elementFromPoint(lastMouseX, lastMouseY);
      if (!el || isOwnNode(el)) return;
      const meaningful = bubbleToMeaningful(el);

      if (frozen) {
        // Selected: highlightBox fica no selected, hoverPreview mostra hover.
        updateHoverPreview(meaningful);
      } else {
        // Não frozen: highlightBox segue o cursor, hoverPreview off.
        lastHoveredElement = meaningful;
        updateHighlight(meaningful);
        updateHoverPreview(null);
      }
    });
  };

  const onClick = (e) => {
    // Editando texto: deixa o click fluir pra elemento editado (caret pos)
    // mas comita se for fora. Handler onEditingClick faz isso.
    if (editingState) {
      // Se click for DENTRO do elemento editado, deixa o browser tratar
      // (pra mover o caret). Não previne nem para propagation.
      if (e.target === editingState.el || editingState.el.contains(e.target)) {
        // Não bloqueia: caret nativo
        return;
      }
      // Fora — comita, mas não troca a seleção (deixa o user continuar editando
      // outro elemento via dblclick novo).
      finishTextEdit(true);
      return;
    }
    // Skip middle/right click — pan handler usa middle, contextmenu usa right.
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation && e.stopImmediatePropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isOwnNode(el)) return;
    const meaningful = bubbleToMeaningful(el);

    // Ctrl/Cmd+click → multi-select: adiciona à seleção sem trocar primary.
    // Se o elemento já é primary OU já é extra, faz toggle (deseleciona).
    if (e.ctrlKey || e.metaKey) {
      const uid = getOrAssignUid(meaningful);
      // Toggle se já é o primary
      const isPrimary = lastHoveredElement === meaningful;
      const extraIdx = findExtraIndex(uid);
      if (isPrimary) {
        // Não permite tirar o primary via ctrl+click (precisaria promover um extra).
        // Simplifica: ignora ctrl+click no próprio primary.
        return;
      }
      if (extraIdx >= 0) {
        // Já é extra — remove
        try { extras[extraIdx].overlay.remove(); } catch (err) { /* noop */ }
        extras.splice(extraIdx, 1);
        window.undrcodBrowser && window.undrcodBrowser.send('element-deselected', { uid });
        return;
      }
      // Adiciona como extra
      const overlay = createExtraOverlay();
      positionExtraOverlay(overlay, meaningful);
      extras.push({ uid, el: meaningful, overlay });
      window.undrcodBrowser && window.undrcodBrowser.send('element-additional-selected', { uid });
      return;
    }

    // Click normal — limpa extras e seleciona único.
    clearExtras();
    frozen = true;
    lastHoveredElement = meaningful;
    updateHighlight(meaningful);   // Re-paint com cor de selected
    updateHoverPreview(null);
    sendPicked(meaningful);
  };

  // Bloqueia eventos de interação completos enquanto inspecionando.
  // NÃO bloqueia middle button (button 1) — esse é reservado pro pan handler.
  // Durante text edit: NÃO bloqueia events DENTRO do elemento editado
  // (precisamos do mouse pra mover caret, do click pra seleção de texto).
  const blockEvent = (e) => {
    if (isOwnNode(e.target)) return;
    if (e.button === 1) return;
    if (editingState && (e.target === editingState.el || editingState.el.contains(e.target))) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation && e.stopImmediatePropagation();
  };

  const onKey = (e) => {
    // Durante edit: onEditingKey handler já cuida de Enter/Esc, e Ctrl+Z deve
    // ser do contenteditable nativo (undo do texto, não do CSS).
    if (editingState) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // REVERT NUDGES: se há offsets acumulados, reverte left/top dos elementos
      // pro estado pre-nudge (remove inline + position:relative se foi adicionado
      // por nós). Comportamento: primeira Esc desfaz nudges; segunda Esc sai do
      // inspect mode. Se não há nudges, vai direto pra exit.
      if (nudgeOffsets.size > 0) {
        nudgeOffsets.forEach((_offset, uid) => {
          const el = document.querySelector('[data-undrcod-uid="' + uid + '"]');
          if (!el) return;
          // Remove inline left/top — volta pro valor herdado/computed natural.
          el.style.removeProperty('left');
          el.style.removeProperty('top');
          // Se position:relative foi setado por nós (sem valor anterior), remove.
          // Heurística: se não tinha inline position antes E agora tá 'relative',
          // assume que foi nosso. Conservador — só remove se tem nada além disso.
        });
        nudgeOffsets.clear();
        // Re-pinta highlight no novo (original) rect.
        if (frozen && lastHoveredElement) updateHighlight(lastHoveredElement);
        if (extras.length > 0) repositionAllExtras();
        return;
      }
      window.undrcodBrowser && window.undrcodBrowser.send('inspector-escape');
      return;
    }
    const mod = e.ctrlKey || e.metaKey;

    // ENTER pra commitar nudges pendentes — gera entries no pendingEdits
    // do host. Cada uid com offset vira uma entry { left, top } no ring.
    if (!mod && !e.shiftKey && e.key === 'Enter' && frozen && nudgeOffsets.size > 0) {
      e.preventDefault();
      e.stopPropagation();
      const entries = [];
      nudgeOffsets.forEach((offset, uid) => {
        const el = document.querySelector('[data-undrcod-uid="' + uid + '"]');
        if (!el) return;
        entries.push({
          uid,
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          classes: Array.from(el.classList),
          text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
          left: offset.dx,
          top: offset.dy,
        });
      });
      if (entries.length > 0) {
        window.undrcodBrowser && window.undrcodBrowser.send('nudge-committed', { entries });
      }
      nudgeOffsets.clear();
      return;
    }

    // ARROW KEY NUDGE — só dispara quando há seleção frozen (não em hover).
    // Move o elemento primary + todos os extras pelo delta. Usa nudgeOffsets
    // Map interno como source of truth (não confia em DOM/computed style).
    if (!mod && frozen && lastHoveredElement &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? 10 : 1;
      let dx = 0, dy = 0;
      if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      // Aplica em primary + extras (lista completa de UIDs).
      const primaryUid = getOrAssignUid(lastHoveredElement);
      const allUids = [primaryUid];
      for (let i = 0; i < extras.length; i++) allUids.push(extras[i].uid);
      allUids.forEach((uid) => {
        const el = document.querySelector('[data-undrcod-uid="' + uid + '"]');
        if (!el) return;
        const cs = window.getComputedStyle(el);
        if ((cs.position || 'static') === 'static') {
          window.__undrcodInspector && window.__undrcodInspector.applyStyle(uid, 'position', 'relative');
        }
        // Acumula no Map — source of truth interno, imune a stale DOM reads.
        const cur = nudgeOffsets.get(uid) || { dx: 0, dy: 0 };
        cur.dx += dx;
        cur.dy += dy;
        nudgeOffsets.set(uid, cur);
        if (dx !== 0) window.__undrcodInspector && window.__undrcodInspector.applyStyle(uid, 'left', cur.dx + 'px');
        if (dy !== 0) window.__undrcodInspector && window.__undrcodInspector.applyStyle(uid, 'top', cur.dy + 'px');
      });
      return;
    }

    // Ctrl+Z / Cmd+Z = undo. Ctrl+Y ou Ctrl+Shift+Z = redo.
    // Só intercepta enquanto inspector ativo + tem elemento selecionado.
    if (!mod || !frozen) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault(); e.stopPropagation();
      window.__undrcodInspector && window.__undrcodInspector.undo();
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault(); e.stopPropagation();
      window.__undrcodInspector && window.__undrcodInspector.redo();
    }
  };

  // Re-align em resize/scroll — manter highlight no lugar certo.
  let resizeRaf = 0;
  const onResize = () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      // Em edit mode, reposiciona o box no Range (texto), NÃO chama
      // updateHighlight que reseta cor e usa BCR do elemento.
      if (editingState) {
        positionHighlightOnTextRange(editingState.el);
        if (extras.length > 0) repositionAllExtras();
        return;
      }
      if (frozen && lastHoveredElement) updateHighlight(lastHoveredElement);
      if (extras.length > 0) repositionAllExtras();
    });
  };

  let attached = false;
  const attach = () => {
    if (attached) return;
    attached = true;
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', blockEvent, true);
    document.addEventListener('mouseup', blockEvent, true);
    document.addEventListener('dblclick', onDblClick, true);
    document.addEventListener('contextmenu', blockEvent, true);
    document.addEventListener('keydown', onKey, true);
    // Edit-mode keydown ANTES do onKey (mesmo capture phase, mas
    // registrado depois → roda depois). Em vez disso usamos capture true
    // e checa editingState no início de onKey — vamos ajustar onKey.
    document.addEventListener('keydown', onEditingKey, true);
    window.addEventListener('resize', onResize, true);
    window.addEventListener('scroll', onResize, true);
  };
  const detach = () => {
    if (!attached) return;
    attached = false;
    // Termina edit limpo se estiver pendente
    if (editingState) finishTextEdit(true);
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mousedown', blockEvent, true);
    document.removeEventListener('mouseup', blockEvent, true);
    document.removeEventListener('dblclick', onDblClick, true);
    document.removeEventListener('contextmenu', blockEvent, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keydown', onEditingKey, true);
    window.removeEventListener('resize', onResize, true);
    window.removeEventListener('scroll', onResize, true);
    if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = 0; }
    rafPending = false;
    frozen = false;
    lastHoveredElement = null;
    updateHighlight(null);
    updateHoverPreview(null);
    clearExtras();
  };

  // Style change history — pra undo/redo (espelha Cursor's css-inspector-undo)
  const styleHistory = [];   // [{ uid, property, oldValue, newValue }]
  let historyIndex = -1;     // ponteiro atual no histórico

  // Acha elemento por uid OU fallback pro último target.
  const resolveTarget = (uid) => {
    if (uid) {
      const found = document.querySelector('[data-undrcod-uid="' + uid + '"]');
      if (found) return found;
    }
    return window.__undrcodInspectorTarget || null;
  };

  // Coleta + envia estado atualizado do elemento. Chamado após qualquer
  // mudança de style/DOM pra host sincronizar UI sem perder seleção.
  const broadcastUpdate = (el) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const offsetX = r.left;
    const offsetY = r.top;
    window.undrcodBrowser && window.undrcodBrowser.send('element-updated', {
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      classes: Array.from(el.classList),
      text: (el.textContent || '').trim().slice(0, 80),
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      offset: { x: offsetX, y: offsetY },
      path: buildPath(el),
      designProps: buildDesignProps(cs),
      allStyles: buildAllStyles(cs),
      inlineStyles: { transform: el.style.transform || '' },
      uid: el.getAttribute('data-undrcod-uid') || '',
    });
  };

  // Aplica style ao elemento alvo + registra no history pra undo.
  const applyStyle = (uid, property, value, fromHistory) => {
    const el = resolveTarget(uid);
    if (!el) return false;
    // Captura valor antigo (inline style, ANTES de mudar) pra undo.
    const oldValue = el.style.getPropertyValue(property);

    if (value === '' || value === 'initial' || value === 'unset') {
      el.style.removeProperty(property);
    } else {
      el.style.setProperty(property, value);
    }
    if (!fromHistory) {
      // Trunca redo stack quando user faz nova edição depois de undo.
      styleHistory.length = historyIndex + 1;
      styleHistory.push({ uid: uid || el.getAttribute('data-undrcod-uid') || '', property, oldValue, newValue: value });
      historyIndex = styleHistory.length - 1;
    }
    // Re-pinta highlight (padding/border podem ter mudado rect).
    requestAnimationFrame(() => {
      if (frozen && lastHoveredElement) updateHighlight(lastHoveredElement);
      broadcastUpdate(el);
    });
    return true;
  };

  // Reverte última mudança.
  const undo = () => {
    if (historyIndex < 0) return false;
    const change = styleHistory[historyIndex];
    historyIndex--;
    const el = resolveTarget(change.uid);
    if (!el) return false;
    if (!change.oldValue || change.oldValue === '') {
      el.style.removeProperty(change.property);
    } else {
      el.style.setProperty(change.property, change.oldValue);
    }
    requestAnimationFrame(() => {
      if (frozen && lastHoveredElement) updateHighlight(lastHoveredElement);
      broadcastUpdate(el);
    });
    return true;
  };

  // Refaz mudança previamente undone.
  const redo = () => {
    if (historyIndex >= styleHistory.length - 1) return false;
    historyIndex++;
    const change = styleHistory[historyIndex];
    return applyStyle(change.uid, change.property, change.newValue, true);
  };

  // Reset: reverte TUDO que foi modificado (limpa inline styles do elemento).
  const resetSelection = () => {
    const el = window.__undrcodInspectorTarget;
    if (!el) return false;
    // Remove só os properties que foram modificados via inspector.
    const seen = new Set();
    for (const ch of styleHistory) {
      if (seen.has(ch.property)) continue;
      seen.add(ch.property);
      el.style.removeProperty(ch.property);
    }
    styleHistory.length = 0;
    historyIndex = -1;
    requestAnimationFrame(() => {
      if (frozen && lastHoveredElement) updateHighlight(lastHoveredElement);
      broadcastUpdate(el);
    });
    return true;
  };

  window.__undrcodInspector = {
    activate() { attach(); document.body.style.cursor = 'crosshair'; },
    deactivate() { detach(); document.body.style.cursor = ''; },
    clearSelection() {
      frozen = false;
      updateHighlight(lastHoveredElement);
      updateHoverPreview(null);
    },
    refresh() {
      if (frozen && lastHoveredElement) updateHighlight(lastHoveredElement);
    },
    // Métodos chamados diretamente via executeJavaScript do host.
    // Sem IPC roundtrip — chamada síncrona DENTRO do page context.
    applyStyle: (uid, property, value) => applyStyle(uid, property, value, false),
    undo,
    redo,
    resetSelection,
    // Re-emite info do selected element atual (host pode chamar pra sync).
    sync() {
      if (lastHoveredElement) broadcastUpdate(lastHoveredElement);
    },
    // Pra Components tree: navega pra elemento por path (XPath-like).
    selectByPath(pathStr) {
      try {
        const el = document.querySelector(pathStr);
        if (!el) return false;
        frozen = true;
        lastHoveredElement = el;
        updateHighlight(el);
        updateHoverPreview(null);
        sendPicked(el);
        return true;
      } catch (e) { return false; }
    },
    // Pra Components tree: navega pra elemento por uid (data-undrcod-uid).
    selectByUid(uid) {
      const el = document.querySelector('[data-undrcod-uid="' + uid + '"]');
      if (!el) return false;
      clearExtras();
      frozen = true;
      lastHoveredElement = el;
      updateHighlight(el);
      updateHoverPreview(null);
      sendPicked(el);
      return true;
    },
    // Multi-select API exposta pro host — sincroniza extras quando user limpa
    // via UI (ex: Esc, "Clear selection" button) ou faz reset.
    clearExtras() { clearExtras(); },
    // Lista uids dos extras atuais (host pode chamar pra resync após reload).
    getExtras() {
      const out = [];
      for (let i = 0; i < extras.length; i++) out.push(extras[i].uid);
      return out;
    },
    // Limpa nudges acumulados (chamado pelo host quando user faz Apply —
    // os edits ja foram enviados pro chat, Esc nao deve reverter).
    clearNudges() { nudgeOffsets.clear(); },
    // Inline text edit — host pode disparar edit no primary via botão "Editar texto".
    startTextEditByUid(uid) {
      const el = document.querySelector('[data-undrcod-uid="' + uid + '"]');
      if (!el) return false;
      if (!isEditableTextElement(el)) return false;
      startTextEdit(el);
      return true;
    },
    commitTextEdit() { if (editingState) finishTextEdit(true); },
    cancelTextEdit() { if (editingState) finishTextEdit(false); },
    isEditingText() { return !!editingState; },
    // Pra Components tree: retorna a arvore inteira do <body> sem mudar
    // seleção. Host chama no mount do panel pra ter tree mesmo sem clique.
    getDomTree() {
      return buildDomTree(document.body);
    },
    // Pra Components tree HOVER: pinta hoverPreviewBox sobre o elemento SEM
    // mudar o selected. Quando user sai do tree, chame clearPreview.
    previewByUid(uid) {
      const el = document.querySelector('[data-undrcod-uid="' + uid + '"]');
      if (!el) {
        hoverPreviewBox.style.display = 'none';
        return false;
      }
      const r = el.getBoundingClientRect();
      hoverPreviewBox.style.display = '';
      hoverPreviewBox.style.left = r.left + 'px';
      hoverPreviewBox.style.top = r.top + 'px';
      hoverPreviewBox.style.width = r.width + 'px';
      hoverPreviewBox.style.height = r.height + 'px';
      return true;
    },
    clearPreview() {
      hoverPreviewBox.style.display = 'none';
    },
  };

  window.undrcodBrowser && window.undrcodBrowser.send('inspector-ready');
})();`;

// Middle-click pan: arrasta a página com o botão do meio (scroll wheel click),
// igual Figma/Photoshop. Sempre ativo (independente do inspector). Injetado
// em cada DOMContentLoaded pra sobreviver navigations.
//
// Chrome ativa o autoscroll nativo (ícone redondo de setas) em pointerdown
// middle button. Pra bloquear, preventDefault precisa rodar em pointerdown
// E mousedown E auxclick, todos em capture phase. Mesmo assim, em algumas
// situações o autoscroll ativa — fallback final é "click sem mover" detectar
// que o icone apareceu e fechar via novo click.
const MIDDLE_CLICK_PAN_SOURCE = `
(() => {
  if (window.__undrcodPanInstalled) return;
  window.__undrcodPanInstalled = true;

  let panning = false;
  let startX = 0, startY = 0;
  let startScrollX = 0, startScrollY = 0;
  let prevCursor = '';
  let prevScrollBehavior = '';
  let scrollEl = document.scrollingElement || document.documentElement;

  const findScrollContainer = (el) => {
    let cur = el;
    while (cur && cur !== document.body) {
      const cs = getComputedStyle(cur);
      const ox = cs.overflowX, oy = cs.overflowY;
      if (
        (ox === 'auto' || ox === 'scroll' || oy === 'auto' || oy === 'scroll') &&
        (cur.scrollHeight > cur.clientHeight || cur.scrollWidth > cur.clientWidth)
      ) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  };

  const blockMiddle = (e) => {
    if (e.button !== 1) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    return true;
  };

  // 1) pointerdown — primeiro evento. Bloquear AQUI mata autoscroll do Chrome.
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 1 || panning) return;
    if (!blockMiddle(e)) return;
    panning = true;
    window.__undrcodPanning = true;
    scrollEl = findScrollContainer(e.target);
    startX = e.clientX;
    startY = e.clientY;
    startScrollX = scrollEl.scrollLeft;
    startScrollY = scrollEl.scrollTop;
    prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';
    // Bloqueia scroll-behavior:smooth da página que adiciona delay no scrollTo.
    // Salva valor anterior pra restaurar no stopPan.
    prevScrollBehavior = scrollEl.style.getPropertyValue('scroll-behavior') || '';
    // setProperty com !important pra ganhar de CSS rules com !important
    scrollEl.style.setProperty('scroll-behavior', 'auto', 'important');
    // Capture o pointer pra continuar recebendo events mesmo se sair do elemento
    try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
  }, true);

  document.addEventListener('mousedown', (e) => {
    // Backup — bloqueia tambem aqui caso pointerdown tenha sido ignorado
    if (e.button === 1) blockMiddle(e);
  }, true);

  document.addEventListener('pointermove', (e) => {
    if (!panning) return;
    e.preventDefault();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    scrollEl.scrollLeft = startScrollX - dx;
    scrollEl.scrollTop = startScrollY - dy;
  }, true);

  const stopPan = (e) => {
    if (!panning) return;
    if (e && e.button !== undefined && e.button !== 1) return;
    if (e) { e.preventDefault(); e.stopImmediatePropagation(); }
    panning = false;
    window.__undrcodPanning = false;
    document.body.style.cursor = prevCursor;
    if (prevScrollBehavior) {
      scrollEl.style.setProperty('scroll-behavior', prevScrollBehavior);
    } else {
      scrollEl.style.removeProperty('scroll-behavior');
    }
  };

  document.addEventListener('pointerup', stopPan, true);
  document.addEventListener('mouseup', (e) => { if (e.button === 1) blockMiddle(e); }, true);
  document.addEventListener('pointercancel', stopPan, true);

  // auxclick é o "click" do middle button. Sempre bloquear pra não abrir link
  // em nova aba (default do middle-click em <a>).
  document.addEventListener('auxclick', (e) => {
    if (e.button === 1) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
})();
`;

// Injeta o pan handler em cada nova página carregada. webFrame.executeJavaScript
// roda apos DOMContentLoaded; pra cobrir navigations dentro do webview, hooka
// na window.load via setup repetido.
const installPan = (): void => {
  webFrame.executeJavaScript(MIDDLE_CLICK_PAN_SOURCE).catch(() => { /* page can navigate */ });
};
// Boot inicial
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installPan);
} else {
  installPan();
}

// Ctrl+Wheel = zoom no webframe inteiro (igual Chrome nativo + Figma).
// Roda no preload (não na página) porque precisa de webFrame.setZoomFactor.
// passive: false pra preventDefault funcionar e bloquear scroll default.
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;
document.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  e.stopPropagation();
  const current = webFrame.getZoomFactor();
  // deltaY < 0 = scroll up = zoom in. Multiplica factor pra escala exponencial
  // (cliques sucessivos não saturam linearmente).
  const factor = e.deltaY < 0 ? 1 + ZOOM_STEP : 1 / (1 + ZOOM_STEP);
  const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, current * factor));
  webFrame.setZoomFactor(next);
}, { passive: false, capture: true });

// Ctrl+0 = reset zoom pra 100%. Atalho padrão de browser.
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  if (e.key === '0') {
    e.preventDefault();
    webFrame.setZoomFactor(1);
  } else if (e.key === '=' || e.key === '+') {
    e.preventDefault();
    webFrame.setZoomFactor(Math.min(ZOOM_MAX, webFrame.getZoomFactor() * (1 + ZOOM_STEP)));
  } else if (e.key === '-') {
    e.preventDefault();
    webFrame.setZoomFactor(Math.max(ZOOM_MIN, webFrame.getZoomFactor() / (1 + ZOOM_STEP)));
  }
}, true);

// Listener do host: ativa/desativa o inspector dentro da página.
// Esses eventos chegam via `webview.send(...)` no host.
ipcRenderer.on('undrcod:inspector-activate', () => {
  webFrame.executeJavaScript(`${INSPECTOR_SOURCE}\nwindow.__undrcodInspector && window.__undrcodInspector.activate();`).catch((e) => {
    console.error('[undrcod-preview] activate failed:', e);
  });
});

ipcRenderer.on('undrcod:inspector-deactivate', () => {
  webFrame.executeJavaScript(`window.__undrcodInspector && window.__undrcodInspector.deactivate();`).catch(() => {
    /* ignore — page can navigate away during deactivate */
  });
});

// NOTA: Os métodos de edição (applyStyle, undo, redo, resetSelection, sync,
// selectByPath) são chamados DIRETAMENTE pelo host via:
//   wv.executeJavaScript('window.__undrcodInspector.applyStyle("uid","prop","val")')
// Em vez de IPC roundtrip (ipcRenderer.on no preload + wv.send no host),
// a execução direta é mais simples e mais robusta. O preload só precisa
// expor o bridge (undrcodBrowser.send) pra eventos PÁGINA → HOST.
