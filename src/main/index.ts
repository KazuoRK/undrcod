import { app, BrowserWindow, shell, ipcMain, Menu, webContents } from 'electron';
import { join } from 'path';
import { homedir, userInfo, platform } from 'os';
import { registerClaudeIPC } from './ipc/claude';
import { prewarmSessionsCache } from './claude-sessions';
import { registerTerminalIPC } from './ipc/terminal';
import { registerFsIPC } from './ipc/fs';
import { registerAgentIPC } from './ipc/agent';
import { registerGitIPC } from './ipc/git';
import { registerOutputIPC } from './ipc/output';
import { registerPortsIPC } from './ipc/ports';
import { registerProblemsIPC } from './ipc/problems';
import { registerAuthIPC } from './ipc/auth';
import { registerSettingsIPC } from './ipc/settings';
import { registerPreviewViewIPC, destroyAllPreviewViews } from './ipc/preview-view';
import { registerMcpIPC } from './ipc/mcp';
import { registerPluginsIPC } from './ipc/plugins';
import { registerSkillsIPC } from './ipc/skills';
import { registerSearchIPC } from './ipc/search';
import { registerCustomizationIPC } from './ipc/customization';
import { registerWhisperIPC } from './ipc/whisper';
import { registerSystemIPC } from './ipc/system';
import { registerCheckpointIPC } from './ipc/checkpoint';
import { createAppMenu } from './menu';
import { ptyManager } from './pty-manager';
import { terminalManager } from './terminal-manager';
import { agentManager } from './agent-manager';
import { startCliServer, stopCliServer, type CliCommand } from './cli-server';

// Multi-window: rastreia TODAS as windows abertas + qual é a focada atualmente.
// `mainWindow` mantém o nome legado mas agora aponta pra "a última window focada"
// (pra compatibilidade com handlers globais tipo CLI dispatch). New windows são
// criadas via createWindow() e adicionadas ao Set; quando focam, viram mainWindow.
const windows = new Set<BrowserWindow>();
let mainWindow: BrowserWindow | null = null;

/**
 * Retorna a BrowserWindow associada ao sender de um IPC event.
 * Fallback pra mainWindow se sender não tem window (acontece em IPC sem renderer).
 */
function windowFromEvent(evt: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(evt.sender) ?? mainWindow;
}

/**
 * Parse argv pra extrair comandos CLI. Suporta:
 *   undrcode <folder>            → { kind:'open', path }
 *   undrcode --goto file:42:10   → { kind:'goto', path, line, col }
 *   undrcode --diff a.txt b.txt  → { kind:'diff', left, right }
 *
 * argv aqui é o que o Electron recebe quando uma segunda instância tenta abrir
 * (second-instance event) ou no boot inicial (process.argv).
 */
function parseCliArgs(argv: string[]): CliCommand[] {
  // Em PROD Electron, argv[0] = executável; em DEV, argv[0] = electron + argv[1] = '.'
  // Filtra args do Electron e fica só com o que veio do user.
  const args = argv.filter((a, i) => {
    if (i === 0) return false;
    if (a === '.' || a.endsWith('.exe') || a.endsWith('main/index.js')) return false;
    if (a.startsWith('--inspect') || a.startsWith('--remote-debugging')) return false;
    return true;
  });

  const out: CliCommand[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--goto' && i + 1 < args.length) {
      const target = args[++i];
      // Formato: path:line[:col]. No Windows path pode ter "C:\..." então parseia
      // só os últimos 1 ou 2 segmentos numéricos.
      const m = target.match(/^(.*?):(\d+)(?::(\d+))?$/);
      if (m && m[1] && !/^[A-Za-z]$/.test(m[1])) {
        out.push({ kind: 'goto', path: m[1], line: parseInt(m[2], 10), col: m[3] ? parseInt(m[3], 10) : undefined });
      } else {
        // Tenta de novo permitindo drive letter ("C:\foo\bar.ts:42:10")
        const m2 = target.match(/^([A-Za-z]:[^:]+):(\d+)(?::(\d+))?$/);
        if (m2) {
          out.push({ kind: 'goto', path: m2[1], line: parseInt(m2[2], 10), col: m2[3] ? parseInt(m2[3], 10) : undefined });
        } else {
          // Sem :line — abre como arquivo
          out.push({ kind: 'open', path: target });
        }
      }
    } else if (a === '--diff' && i + 2 < args.length) {
      const left = args[++i];
      const right = args[++i];
      out.push({ kind: 'diff', left, right });
    } else if (a.startsWith('--')) {
      // Flag não reconhecida — ignora silenciosamente (já tratado no script CLI)
      continue;
    } else {
      // Arg positional = abrir como folder/file
      out.push({ kind: 'open', path: a });
    }
  }
  return out;
}

function dispatchCliCommands(cmds: CliCommand[]): void {
  if (!mainWindow || cmds.length === 0) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  for (const c of cmds) {
    mainWindow.webContents.send('cli:command', c);
  }
}

/**
 * Cria uma nova BrowserWindow do UNDRCOD. Multi-window safe — pode ser chamada
 * múltiplas vezes; cada chamada abre janela independente (próprio renderer state,
 * próprio FileTree/ChatView/etc). Settings em electron-store ficam compartilhadas.
 *
 * Cada window tem handlers locais (DevTools, zoom, fullscreen) operando na própria.
 * `mainWindow` global é apenas referência pra "última focada" — usada por dispatch
 * de CLI commands e fallback de IPC.
 *
 * mode 'agent' abre a janela em modo Agent Manager (chat-focused, sem editor/files).
 * Append `?mode=agent` na URL — renderer detecta e renderiza AgentManager component.
 */
function createWindow(opts: { mode?: 'normal' | 'agent' } = {}): BrowserWindow {
  const mode = opts.mode || 'normal';
  console.log('[main] createWindow start');
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: true,
    autoHideMenuBar: false,
    title: 'UNDRCOD',
    // Icon do app — usado no taskbar + window header (quando frame visível).
    // Em dev: out/main/index.js → root/build/icon.ico. Em prod: electron-builder
    // empacota icon.ico/.icns/.png da pasta build/ automaticamente.
    icon: platform() === 'win32'
      ? join(__dirname, '../../build/icon.ico')
      : join(__dirname, '../../build/icon.png'),
    backgroundColor: '#1f1f1f',             // Antigravity exact (themeBackground)
    // Frame nativo escondido. Nossos próprios botões min/max/close no topbar.
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // TODO(security): migrar PreviewView V1 (<webview> tag, deprecated em
      // Electron) pra V3 (WebContentsView via preview-view.ts) e remover
      // `webviewTag: true`. Webview tag tem CVEs históricos (renderer→main
      // escape via attribute injection) e é officially deprecated.
      webviewTag: true,
      // SECURITY:
      // - webSecurity: true (production-ready). V1 (default) usa <webview> tag
      //   que tem webPreferences PRÓPRIOS (independentes do host); V2 usa
      //   WebContentsView isolado; V3 (iframe file://) era debug-only via
      //   localStorage flag e foi descartado — não bloqueia o flip.
      // - allowRunningInsecureContent: false → bloqueia HTTP em página HTTPS
      //   (mixed content). Default do Electron e não usamos.
      webSecurity: true,
      allowRunningInsecureContent: false,
    }
  });
  windows.add(win);
  mainWindow = win;
  console.log('[main] BrowserWindow created (total:', windows.size, ')');

  // CLEANUP CRÍTICO: quando user faz Ctrl+R no UNDRCOD, o renderer reinicia
  // mas o main process NÃO. WebContentsViews criadas pelo PreviewViewV2 antes
  // do reload ficam ZOMBIE — attached ao mainWindow.contentView mas órfãs (sem
  // dono no renderer). Visualmente cobrem editor/outros panes (compositadas
  // acima do DOM). Fix: ao detectar `did-start-navigation` pra mesma URL base
  // (= reload), destroi todas previewViews antes do renderer remount.
  win.webContents.on('did-start-navigation', (_e, url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace) return;
    // É navegação de top-level (reload ou nav). Destroi previewViews órfãs.
    destroyAllPreviewViews();
    console.log('[main] navigation detected — destroyed all preview views');
  });

  // Bridge: renderer console.log('[menu]'|'[test]') → main process console.
  // Filtra só logs específicos pra não poluir o log do dev. Útil pra debugar
  // o armed-relay (menu close em click dentro do webview).
  // Em produção esses logs não disparam (UI não loga [menu] em produção).
  win.webContents.on('console-message', (_e, _level, msg) => {
    if (msg.startsWith('[menu]') || msg.startsWith('[test]') || msg.startsWith('[PreviewViewV2')) {
      console.log('[renderer]', msg);
    }
  });

  // === TEST: open preview com URL hardcoded e roda fluxo ===
  if (process.env.UNDR_MENU_TEST === '1') {
    win.webContents.once('did-finish-load', () => {
      console.log('[test] host renderer did-finish-load — agendando setup');
      setTimeout(async () => {
        try {
          console.log('[test] STEP 0: setar localStorage previewUrl + abrir preview');
          const r0 = await win.webContents.executeJavaScript(
            `(async () => {
              try { localStorage.setItem('undrcode.previewUrl', 'https://example.com'); } catch(e) {}
              // Dispatch keypress ' (apostrofo) pra togglar preview
              // (atalho de view.togglePreview registrado no App.tsx)
              const ev = new KeyboardEvent('keydown', { key: "'", bubbles: true });
              document.dispatchEvent(ev);
              return 'preview toggle dispatched';
            })()`,
            true,
          );
          console.log('[test] step0 result:', r0);
        } catch (e) {
          console.log('[test] step0 error:', (e as Error).message);
        }
      }, 2000);
    });
  }

  // === DEBUG: capture V2 preview bounds investigation ===
  // Dispara quando UNDR_PREVIEW_DEBUG=1. Força V2, abre preview, e deixa V2
  // mountar pra os logs de [PreviewViewV2 BOUNDS] e [previewView setBounds]
  // aparecerem no terminal/log file.
  if (process.env.UNDR_PREVIEW_DEBUG === '1') {
    win.webContents.once('did-finish-load', () => {
      console.log('[preview-debug] host renderer did-finish-load — agendando setup');
      setTimeout(async () => {
        try {
          console.log('[preview-debug] STEP 1: força V2 + seta URL + abre preview');
          const r0 = await win.webContents.executeJavaScript(
            `(async () => {
              try {
                localStorage.setItem('undrcode.previewVersion', 'v2');
                localStorage.setItem('undrcode.previewUrl', 'about:blank');
              } catch(e) {}
              const ev = new KeyboardEvent('keydown', { key: "'", bubbles: true });
              document.dispatchEvent(ev);
              return { previewVersion: localStorage.getItem('undrcode.previewVersion'), dispatched: true };
            })()`,
            true,
          );
          console.log('[preview-debug] step1 result:', JSON.stringify(r0));
        } catch (e) {
          console.log('[preview-debug] step1 error:', (e as Error).message);
        }
      }, 1500);
    });
  }

  // === Microfone (Whisper.cpp via getUserMedia) ===
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    const audioPerms: string[] = ['media', 'audioCapture'];
    callback(audioPerms.includes(permission));
  });
  win.webContents.session.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media';
  });

  win.on('ready-to-show', () => {
    win.show();
    // Auto-open DevTools em dev mode REMOVIDO — estava disparando toda vez que
    // uma janela secundária era criada (New Agents Window) ou re-shown, abrindo
    // DevTools infinitamente. Use F12 ou Ctrl+Shift+I pra abrir manualmente.
  });

  // Foco: atualiza mainWindow ponteiro pra última window focada
  win.on('focus', () => {
    mainWindow = win;
  });

  // Cleanup quando fecha
  win.on('closed', () => {
    windows.delete(win);
    if (mainWindow === win) {
      mainWindow = windows.size > 0 ? Array.from(windows)[windows.size - 1] : null;
    }
  });

  // Zoom inicial 1.1x — UI fica visualmente igual ao Antigravity nativo.
  // V1 (<webview> tag, default) NÃO sofre do bug de zoom mismatch que V2
  // (WebContentsView) tinha, porque webview tag herda position do parent
  // via CSS (Cursor Simple Browser pattern: `WebviewBrowserManager.syncPosition`
  // assigna style.left/top/width/height direto do getBoundingClientRect).
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(1.1);
  });

  // Keyboard shortcuts locais (DevTools, fullscreen, reload, zoom) — operam na window deste closure.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    // F12 ou Ctrl+Shift+I → toggle DevTools
    if (input.key === 'F12' || (input.control && input.shift && input.key.toUpperCase() === 'I')) {
      event.preventDefault();
      // VS Code/Cursor pattern: toggleDevTools() nativo lembra última posição
      // (right/bottom/undocked) escolhida pelo user via drag. Pra forçar 'right'
      // na primeira abertura, openDevTools({mode:'right'}) explícito quando
      // não tem devtools aberto E não houve toggle anterior nessa sessão.
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools();
      } else {
        win.webContents.openDevTools({ mode: 'right', activate: true });
      }
      return;
    }

    // F11 → toggle fullscreen
    if (input.key === 'F11') {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
      return;
    }

    if (!input.control || input.alt) return;
    const key = input.key.toUpperCase();

    if (key === 'R') {
      event.preventDefault();
      if (input.shift) win.webContents.reloadIgnoringCache();
      else win.webContents.reload();
      return;
    }

    if (input.key === '=' || input.key === '+') {
      event.preventDefault();
      const cur = win.webContents.getZoomFactor();
      win.webContents.setZoomFactor(Math.min(cur + 0.1, 3));
    } else if (input.key === '-') {
      event.preventDefault();
      const cur = win.webContents.getZoomFactor();
      win.webContents.setZoomFactor(Math.max(cur - 0.1, 0.5));
    } else if (input.key === '0') {
      event.preventDefault();
      win.webContents.setZoomFactor(1.0);
    }
  });

  // Broadcast maximize state pra renderer atualizar icon do botão (local pra esta window)
  win.on('maximize', () => win.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win.webContents.send('window:maximized', false));

  // === Context menu nativo do Chromium pra iframes (V3 preview) ===
  // Quando user faz right-click em iframe do PreviewView V3, Electron por
  // default NÃO abre menu nenhum (renderer process não tem context menu builtin).
  // Adicionamos um menu mínimo com "Inspect Element" (que abre devtools focado
  // no element clicado, igual Chrome nativo).
  //
  // Importante: o event handler dispara pra QUALQUER right-click no renderer,
  // não só em iframes. Como o UNDRCOD tem custom ContextMenus em vários lugares
  // (que chamam preventDefault no React), eles têm precedência — só chegamos
  // aqui se NINGUÉM tratou o contextmenu (ex: dentro do iframe cross-origin).
  win.webContents.on('context-menu', (_event, params) => {
    // Skip se o user já tem alguma seleção/modo customizado. Sem inspeção =
    // não trazemos menu (deixa fall through pro custom React menu se houver).
    if (!params.frameURL || params.frameURL === win.webContents.getURL()) {
      // O click foi NO RENDERER PRINCIPAL — deixa o React tratar.
      return;
    }
    // Click foi DENTRO de um sub-frame (iframe do preview V3, etc).
    // Abre menu mínimo com Inspect Element.
    const menu = Menu.buildFromTemplate([
      {
        label: 'Inspect Element',
        click: () => {
          win.webContents.inspectElement(params.x, params.y);
        },
      },
      {
        label: 'Reload',
        click: () => {
          win.webContents.reload();
        },
      },
      { type: 'separator' },
      {
        label: 'Copy Link',
        enabled: !!params.linkURL,
        click: () => {
          if (params.linkURL) {
            const { clipboard } = require('electron');
            clipboard.writeText(params.linkURL);
          }
        },
      },
    ]);
    menu.popup({ window: win });
  });

  // Abre links externos no browser, não dentro do app.
  // SECURITY: validamos protocol antes de passar pra shell.openExternal —
  // protocols como `file:`, `javascript:`, `vscode:`, `ms-msdt:` podem
  // executar código ou abrir handlers nativos perigosos via URL spoofada
  // num link de markdown do agente.
  win.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url);
      const ALLOWED = ['http:', 'https:', 'mailto:'];
      if (ALLOWED.includes(url.protocol)) {
        shell.openExternal(details.url);
      } else {
        console.warn('[security] blocked window.open com protocol não-permitido:', url.protocol);
      }
    } catch {
      console.warn('[security] blocked window.open com URL inválida:', details.url);
    }
    return { action: 'deny' };
  });

  // Dev: carrega de Vite dev server. Prod: carrega bundle local.
  // Mode 'agent' append ?mode=agent na URL — renderer detecta no boot.
  const modeQuery = mode === 'agent' ? '?mode=agent' : '';
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = process.env.ELECTRON_RENDERER_URL + modeQuery;
    console.log('[main] loadURL:', url);
    win.loadURL(url).catch((err) => {
      console.error('[main] loadURL FAILED:', err);
    });
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { search: modeQuery.slice(1) });
  }

  return win;
}

/** Alias legado pra createWindow — chamado pelo bootstrap inicial. */
function createMainWindow(): void {
  createWindow();
}

// Single-instance lock: se outra instância já tá rodando, manda os args dela
// e sai. A instância existente recebe via second-instance event e dispatcha.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', (_evt, argv) => {
  const cmds = parseCliArgs(argv);
  dispatchCliCommands(cmds);
});

app.whenReady().then(() => {
  // Menu nativo customizado (File/Edit/View/Help). Fica escondido por default via
  // autoHideMenuBar=false na BrowserWindow — menu sempre visível (estilo Cursor).
  // É instalado DEPOIS de createMainWindow() abaixo (precisa da window pra dispatchar).

  // Captura console logs do preload de <webview> (preview-webview.ts).
  // Filtra só [undrcod-preview] pra debugar o armed-relay sem spam.
  // Em produção esses logs nunca disparam (só em dev quando inspector ativo).
  app.on('web-contents-created', (_event, wc) => {
    // wc.getType() pra webview retorna 'webview'. Host é 'window'.
    if (wc.getType() !== 'webview') return;
    wc.on('console-message', (_e, _level, msg) => {
      if (msg.startsWith('[undrcod-preview]')) {
        console.log('[webview]', msg);
      }
    });

    // === TESTE AUTOMÁTICO armed-relay (UNDR_MENU_TEST=1) ===
    // Simula o fluxo completo end-to-end:
    //   1. Aguarda dom-ready do webview
    //   2. Clica no botão "..." (abre moreMenu) via executeJavaScript
    //   3. Aguarda useEffect armar o relay no preload (500ms)
    //   4. Dispatch mousedown sintético no webview via sendInputEvent
    //      (input direto Chromium — não pode ser bloqueado por host)
    //   5. Aguarda IPC fluir host→preload→host (800ms)
    //   6. Verifica se moreMenu fechou no DOM do host
    // Output via console.log normal → vai pro dev-log via stdio.
    if (process.env.UNDR_MENU_TEST === '1') {
      console.log('[test] UNDR_MENU_TEST ativo, aguardando webview dom-ready');
      wc.once('dom-ready', () => {
        console.log('[test] webview dom-ready @', wc.getURL(), '— iniciando teste em 4s...');
        setTimeout(async () => {
          const mainWin = mainWindow;
          if (!mainWin) { console.log('[test] FAIL: no main window'); return; }
          try {
            console.log('[test] STEP 1: clicar "..." pra abrir moreMenu');
            const r1 = await mainWin.webContents.executeJavaScript(
              `(() => {
                const btn = document.querySelector('button[title="Mais opções"]');
                if (!btn) return 'NO BUTTON';
                btn.click();
                return 'CLICKED';
              })()`,
              true,
            );
            console.log('[test] step1 result:', r1);
          } catch (e) {
            console.log('[test] step1 error:', (e as Error).message);
            return;
          }

          await new Promise((res) => setTimeout(res, 500));

          try {
            const r15 = await mainWin.webContents.executeJavaScript(
              `(() => document.querySelector('.context-menu') ? 'OPEN' : 'NOT OPEN')()`,
              true,
            );
            console.log('[test] step1.5 menu state:', r15);
          } catch { /* */ }

          try {
            console.log('[test] STEP 2: sendInputEvent mousedown no webview @(100,100)');
            wc.sendInputEvent({ type: 'mouseDown', x: 100, y: 100, button: 'left', clickCount: 1 });
            wc.sendInputEvent({ type: 'mouseUp', x: 100, y: 100, button: 'left', clickCount: 1 });
            console.log('[test] step2: dispatched');
          } catch (e) {
            console.log('[test] step2 error:', (e as Error).message);
          }

          await new Promise((res) => setTimeout(res, 800));

          try {
            const r3 = await mainWin.webContents.executeJavaScript(
              `(() => document.querySelector('.context-menu') ? 'STILL OPEN (FAIL)' : 'CLOSED (PASS)')()`,
              true,
            );
            console.log('[test] STEP 3 result:', r3);
          } catch (e) {
            console.log('[test] step3 error:', (e as Error).message);
          }
          console.log('[test] === FIM DO TESTE ===');
        }, 4000);
      });
    }
  });

  // Util IPC
  ipcMain.handle('app:getCwd', () => homedir());

  ipcMain.handle('app:getSystemInfo', () => ({
    username: userInfo().username,
    platform: platform(),
    homedir: homedir(),
  }));

  // Path absoluto do preload do <webview> do PreviewView. O renderer não pode
  // resolver `__dirname` corretamente; main entrega o file:// completo.
  // Em dev: out/preload/preview-webview.js (via electron-vite). Em prod: idem.
  ipcMain.handle('app:getPreviewPreload', () => {
    const preloadPath = join(__dirname, '..', 'preload', 'preview-webview.js');
    return `file://${preloadPath.replace(/\\/g, '/')}`;
  });

  // DevTools embedado num <webview> "host" (right panel). Requer 2 webviews
  // no renderer: o "target" (preview da página) e o "host" (about:blank que
  // vira a UI do DevTools). Renderer passa os webContentsId via getWebContentsId().
  // setDevToolsWebContents() só existe no main; renderer chama via IPC.
  //
  // BUG HISTÓRICO: Elements tree vinha vazio. Causa raiz:
  //   `webContents.debugger.attach()` (usado por setIgnoreInput +
  //   emulateColorScheme) detem EXCLUSIVE CDP session no target. Quando
  //   DevTools tenta abrir sua própria CDP session pra alimentar a árvore
  //   DOM, o protocol bate em "Another debugger is already attached" e
  //   silenciosamente falha — UI carrega mas DOM.getDocument nunca responde.
  //   Fix: detach o debugger ANTES de openDevTools.
  ipcMain.handle('preview:attachDevtools', (_evt, targetId: number, hostId: number) => {
    try {
      const target = webContents.fromId(targetId);
      if (!target) {
        console.warn('[main:devtools] attach failed — invalid target id', { targetId });
        return { ok: false, error: 'invalid-target-id' };
      }
      // hostId não usado mais (não usamos setDevToolsWebContents) — só log
      console.log('[main:devtools] attach start', {
        targetId,
        hostId,
        targetUrl: target.getURL(),
        targetIsDestroyed: target.isDestroyed(),
        debuggerAttached: target.debugger.isAttached(),
        devtoolsAlreadyOpen: target.isDevToolsOpened(),
      });
      // CRÍTICO: se algum CDP debugger nosso (setIgnoreInput / emulateColorScheme)
      // estiver attachado, ele BLOQUEIA a sessão CDP interna do DevTools.
      // DevTools UI carrega mas Elements tree fica vazia porque DOM.getDocument
      // não responde. Detach antes pra liberar a sessão pro DevTools.
      if (target.debugger.isAttached()) {
        try {
          target.debugger.detach();
          console.log('[main:devtools] detached pre-existing debugger session');
        } catch (e) {
          console.warn('[main:devtools] debugger detach failed (continuing):', (e as Error).message);
        }
      }
      // Fecha se já tava aberto pra evitar abrir janela duplicada.
      if (target.isDevToolsOpened()) target.closeDevTools();
      // Cursor pattern EXATO (`vscode:setDevToolsWebContents` handler em main.js):
      //   y.setDevToolsWebContents(w);
      //   y.openDevTools();
      //   if (w.getURL() === "about:blank" && !skipReconnectCycle) setTimeout(() => {
      //     y.closeDevTools();
      //     setTimeout(() => y.openDevTools(), 100);
      //   }, 200);
      // O reconnect cycle é OBRIGATÓRIO pra evitar bug do "Elements vazio" —
      // primeira abertura tem race condition CDP, reabrir resolve.
      const host = hostId > 0 ? webContents.fromId(hostId) : null;
      if (host && !host.isDestroyed()) {
        try {
          target.setDevToolsWebContents(host);
          target.openDevTools();
          console.log('[main:devtools] setDevToolsWebContents applied — companion mode');
          // Reconnect cycle (Cursor pattern): se host ainda em about:blank
          const hostUrl = host.getURL();
          if (hostUrl === 'about:blank' || hostUrl === '') {
            setTimeout(() => {
              if (target.isDestroyed()) return;
              try {
                target.closeDevTools();
                setTimeout(() => {
                  if (target.isDestroyed()) return;
                  try { target.openDevTools(); console.log('[main:devtools] reconnect cycle completed'); } catch { /* ignore */ }
                }, 100);
              } catch { /* ignore */ }
            }, 200);
          }
        } catch (err) {
          console.warn('[main:devtools] setDevToolsWebContents failed, fallback to detach:', (err as Error).message);
          target.openDevTools({ mode: 'detach' });
        }
      } else {
        // Sem companion = janela separada (fallback).
        target.openDevTools({ mode: 'detach' });
      }
      console.log('[main:devtools] openDevTools called, isDevToolsOpened=', target.isDevToolsOpened());
      // Eventos de diagnóstico — uma vez, sem leak (off() depois do primeiro fire).
      const onOpened = (): void => {
        console.log('[main:devtools] devtools-opened fired');
        target.off('devtools-opened', onOpened);
      };
      const onClosed = (): void => {
        console.log('[main:devtools] devtools-closed fired');
        target.off('devtools-closed', onClosed);
        // Notifica TODOS os renderers pra resetar state (devtoolsOpen=false).
        // Senão user clica X na janela mas botão do preview continua highlighted.
        for (const win of BrowserWindow.getAllWindows()) {
          if (win.isDestroyed()) continue;
          const wc = win.webContents;
          if (!wc || wc.isDestroyed()) continue;
          try { wc.send('preview:devtools-window-closed', targetId); } catch { /* race */ }
        }
      };
      target.on('devtools-opened', onOpened);
      target.on('devtools-closed', onClosed);
      return { ok: true };
    } catch (err) {
      console.error('[main:devtools] attach exception:', err);
      return { ok: false, error: (err as Error).message };
    }
  });
  // Emula prefers-color-scheme no webview do preview via Chrome DevTools
  // Protocol (Emulation.setEmulatedMedia). Substitui hack de "adicionar
  // classe .dark no body" — dispara @media (prefers-color-scheme) corretamente.
  ipcMain.handle('preview:emulateColorScheme', async (_evt, targetId: number, scheme: 'light' | 'dark' | 'system') => {
    try {
      const wc = webContents.fromId(targetId);
      if (!wc) return { ok: false, error: 'invalid-id' };
      // Mesma razão de setIgnoreInput: se DevTools aberto, não rouba sessão CDP.
      // Theme emulation cai pro Apps SDK default (sem prefers-color-scheme override).
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

  ipcMain.handle('preview:detachDevtools', (_evt, targetId: number) => {
    try {
      const target = webContents.fromId(targetId);
      if (!target) return { ok: false, error: 'invalid-id' };
      console.log('[main:devtools] detach called', { targetId, isOpen: target.isDevToolsOpened() });
      if (target.isDevToolsOpened()) target.closeDevTools();
      return { ok: true };
    } catch (err) {
      console.warn('[main:devtools] detach error:', err);
      return { ok: false, error: (err as Error).message };
    }
  });

  // Bloqueia/libera input events no guest webContents do preview via CDP
  // (`Input.setIgnoreInputEvents`). Usado pra resolver outside-click do
  // ContextMenu quando o user clica DENTRO do <webview>: o BrowserView nativo
  // é compositado acima do DOM host, então `pointer-events: none` no elemento
  // host E overlay <div> z-index>50 NÃO interceptam o click. CDP é a forma
  // oficial de dropar input no nível do renderer da página guest.
  //
  // Pattern: renderer chama setIgnoreInput(true) quando menu abre e (false)
  // quando fecha. Com input bloqueado no guest, o click "atravessa" pro
  // overlay <div> no host (`.preview-menu-overlay`), cujo `onMouseDown`
  // fecha o menu. Sem efeito colateral em zoom/F5/inspector — esses só
  // executam quando NÃO há menu aberto.
  //
  // Compartilha o debugger attach com `preview:emulateColorScheme`.
  // `isAttached()` é o guard pra não tentar attach duplo.
  ipcMain.handle('preview:setIgnoreInput', async (_evt, targetId: number, ignore: boolean) => {
    try {
      const wc = webContents.fromId(targetId);
      if (!wc) return { ok: false, error: 'invalid-id' };
      // CRÍTICO: se DevTools embedado tá aberto, ele detém EXCLUSIVE CDP session.
      // Tentar attach aqui rouba a sessão dele e quebra o Elements panel (DOM tree
      // fica vazia). Skip silenciosamente — o overlay <div> serve de fallback.
      if (wc.isDevToolsOpened()) {
        return { ok: true, skipped: 'devtools-open' };
      }
      // Best-effort: tenta attach; se já estiver attachado (pelo emulateColorScheme),
      // sendCommand ainda funciona via o session existente.
      if (!wc.debugger.isAttached()) {
        try { wc.debugger.attach('1.3'); } catch { /* já attached em outro lugar */ }
      }
      // CDP `Input.setIgnoreInputEvents` — método estável do protocol
      // Chromium pra ignorar TODOS os input events (mouse/key/wheel/touch)
      // no renderer alvo. Reverte com {ignore:false}.
      await wc.debugger.sendCommand('Input.setIgnoreInputEvents', { ignore });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('shell:openExternal', async (_evt, url: string) => {
    // Aceita http/https/mailto/file. file:// abre no browser externo via
    // shell.openExternal (Chrome registrado como handler de file://) — funciona
    // pra arquivos HTML locais previewzados.
    try {
      const u = new URL(url);
      if (!['http:', 'https:', 'mailto:', 'file:'].includes(u.protocol)) {
        console.warn('[main] shell:openExternal recusado, protocolo:', u.protocol);
        return;
      }
      await shell.openExternal(url);
    } catch (err) {
      console.warn('[main] shell:openExternal erro:', err);
    }
  });

  // Window control IPC handlers (custom min/max/close buttons no topbar).
  // Multi-window: opera na window do SENDER, não em mainWindow global,
  // pra cada janela controlar a si mesma independentemente.
  ipcMain.on('window:minimize', (evt) => windowFromEvent(evt)?.minimize());
  ipcMain.on('window:maximize', (evt) => {
    const w = windowFromEvent(evt);
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.on('window:close', (evt) => windowFromEvent(evt)?.close());
  ipcMain.handle('window:isMaximized', (evt) => windowFromEvent(evt)?.isMaximized() ?? false);

  // Multi-window: abre nova janela do UNDRCOD (Ctrl+Shift+N).
  ipcMain.handle('window:openNew', () => {
    const w = createWindow();
    return { ok: true, count: windows.size, id: w.id };
  });

  // Agent Manager (Ctrl+Shift+M): nova janela em modo chat-only,
  // mostra lista de workspaces + conversations + chat focado, sem editor/files.
  // Equivalente ao "Open Agent Manager" do Antigravity/Cursor.
  ipcMain.handle('window:openAgentManager', () => {
    const w = createWindow({ mode: 'agent' });
    return { ok: true, count: windows.size, id: w.id };
  });

  // Fullscreen + zoom controls — expostos pra menu items disparem
  // (atalhos F11/Ctrl+=/Ctrl+-/Ctrl+0 já funcionam via before-input-event de cada window).
  ipcMain.on('window:toggleFullScreen', (evt) => {
    const w = windowFromEvent(evt);
    if (w) w.setFullScreen(!w.isFullScreen());
  });
  ipcMain.handle('window:isFullScreen', (evt) => windowFromEvent(evt)?.isFullScreen() ?? false);
  ipcMain.on('window:zoomIn', (evt) => {
    const w = windowFromEvent(evt);
    if (!w) return;
    const cur = w.webContents.getZoomFactor();
    w.webContents.setZoomFactor(Math.min(cur + 0.1, 3));
  });
  ipcMain.on('window:zoomOut', (evt) => {
    const w = windowFromEvent(evt);
    if (!w) return;
    const cur = w.webContents.getZoomFactor();
    w.webContents.setZoomFactor(Math.max(cur - 0.1, 0.5));
  });
  ipcMain.on('window:zoomReset', (evt) => {
    const w = windowFromEvent(evt);
    if (w) w.webContents.setZoomFactor(1.0);
  });

  // Toggle DevTools — VS Code/Cursor pattern.
  // No source do Cursor (main.js): `he.on("vscode:toggleDevTools", d => d.sender.toggleDevTools())`
  // toggleDevTools() nativo lembra a última posição escolhida pelo user (drag do
  // divider muda right→bottom→undocked, Electron persiste). Pra abertura inicial
  // sem state anterior, openDevTools({mode:'right'}) força dock à direita.
  ipcMain.on('window:toggleDevTools', (evt) => {
    const w = windowFromEvent(evt);
    if (!w) return;
    if (w.webContents.isDevToolsOpened()) w.webContents.closeDevTools();
    else w.webContents.openDevTools({ mode: 'right', activate: true });
  });

  registerClaudeIPC();
  // Pre-warm caches de sessions ANTES do renderer fazer o primeiro IPC. Sem isso,
  // o primeiro listProjectSessions paga read+parse do JSON do disco (50-150ms
  // pra ~80 entries no userData). Fire-and-forget — não bloqueia o whenReady.
  prewarmSessionsCache().catch((err) => console.error('[prewarm] failed', err));
  registerTerminalIPC();
  registerFsIPC();
  registerAgentIPC();
  registerGitIPC();
  registerOutputIPC();
  registerPortsIPC();
  registerProblemsIPC();
  registerAuthIPC();
  registerSettingsIPC();
  registerPreviewViewIPC();
  registerMcpIPC();
  registerPluginsIPC();
  registerSkillsIPC();
  registerSearchIPC();
  registerCustomizationIPC();
  registerWhisperIPC();
  registerSystemIPC();
  registerCheckpointIPC();
  createMainWindow();

  // Bootstrap do servidor CLI (named pipe / UDS). Roda em paralelo ao IPC normal.
  startCliServer(() => mainWindow);

  // Processa args do boot inicial (caso user tenha rodado `undrcode <folder>`
  // sem outra instância rodando — então não veio via second-instance).
  const bootCmds = parseCliArgs(process.argv);
  if (bootCmds.length > 0) {
    // Espera renderer estar pronto pra receber comandos
    mainWindow?.webContents.once('did-finish-load', () => {
      dispatchCliCommands(bootCmds);
    });
  }

  // Instala o menu nativo customizado (precisa de mainWindow já criada pra
  // dispatchar IPC `menu:*` pro renderer). Fica auto-hidden até user apertar Alt.
  if (mainWindow) {
    Menu.setApplicationMenu(createAppMenu(mainWindow));
  }

  // (Broadcast maximize state agora vive dentro de createWindow() — cada window
  //  tem seus próprios listeners independentes.)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  ptyManager.killAll();
  terminalManager.killAll();
  agentManager.cancelAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  ptyManager.killAll();
  terminalManager.killAll();
  agentManager.cancelAll();
  destroyAllPreviewViews();
  stopCliServer();
});
