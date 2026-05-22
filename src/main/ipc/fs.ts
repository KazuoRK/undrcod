import { ipcMain, dialog, BrowserWindow, shell, WebContents } from 'electron';
import { readdir, readFile, writeFile, stat, mkdir, rm, rename } from 'fs/promises';
import { resolve as pathResolve, join, dirname, relative, sep } from 'path';
import { homedir } from 'os';
import chokidar, { FSWatcher } from 'chokidar';

export interface FsEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
}

const HIDDEN_ALLOWLIST = new Set(['.vscode', '.github', '.claude']);

// =========================================================================
// PATH TRAVERSAL GUARD — P0 security
// =========================================================================
// Problema: fs:* handlers aceitavam paths absolutos arbitrários do renderer
// sem validação. Renderer comprometido (XSS num markdown rendered, malicious
// iframe page, etc) podia ler/escrever em QUALQUER lugar do FS do user.
//
// Modelo de allowlist:
//   1. Renderer registra `activeCwd` via `fs:setActiveCwd(cwd)` ao montar
//      um workspace. Persiste por WebContents.id (multi-window safe).
//   2. validatePath(p, mode) resolve `p` e exige que esteja DENTRO de:
//        - activeCwd da window OU
//        - homedir + '/.claude/' (Claude CLI storage — readonly via mode='read')
//   3. Handlers fs:* invocam validate antes de tocar disco. Validação falha
//      → retorna { error: 'PATH_OUTSIDE_WORKSPACE' } sem revelar paths.
//
// Exceções (não passam por aqui):
//   - dialog:openWorkspace / openFiles / saveFile — user clicou no dialog
//     nativo, consentiu interativamente.
//   - fs:replaceInFiles — opera SOMENTE sob `cwd` argument (já confina o walk
//     ao subtree). Validação extra do cwd contra activeCwd no handler.

const activeCwdByWc = new Map<number, string>();
type ValidationMode = 'read' | 'write';

// Note: usamos `error?: string` no shape "ok" pra TS conseguir acessar a
// property em narrowing parcial — `strict: false` no tsconfig fica menos
// rigoroso com narrowing de discriminated unions. Em runtime só popula
// `error` quando ok=false.
type ValidationResult = {
  ok: boolean;
  resolved?: string;
  error?: 'PATH_OUTSIDE_WORKSPACE' | 'NO_ACTIVE_CWD' | 'INVALID_PATH';
};

function isInside(child: string, parent: string): boolean {
  // Normaliza ambos antes — Windows é case-insensitive, mas mantemos comparação
  // exata pra POSIX. resolve() já normaliza separators e remove '..' resolved.
  const c = pathResolve(child);
  const p = pathResolve(parent);
  if (c === p) return true;
  const withSep = p.endsWith(sep) ? p : p + sep;
  return c.startsWith(withSep);
}

export function validatePath(
  inputPath: string | undefined | null,
  wc: WebContents,
  mode: ValidationMode = 'read',
): ValidationResult {
  if (typeof inputPath !== 'string' || inputPath.length === 0) {
    return { ok: false, error: 'INVALID_PATH' };
  }
  let resolved: string;
  try {
    resolved = pathResolve(inputPath);
  } catch {
    return { ok: false, error: 'INVALID_PATH' };
  }
  const cwd = activeCwdByWc.get(wc.id);
  if (cwd && isInside(resolved, cwd)) {
    return { ok: true, resolved };
  }
  // Read-only allowlist: ~/.claude (Claude CLI sessions, settings, etc).
  // Renderer historicamente lia coisas tipo ~/.claude/projects/<slug>/*.jsonl.
  // Write requires explicit activeCwd containment.
  if (mode === 'read') {
    const claudeHome = pathResolve(join(homedir(), '.claude'));
    if (isInside(resolved, claudeHome)) {
      return { ok: true, resolved };
    }
  }
  if (!cwd) return { ok: false, error: 'NO_ACTIVE_CWD' };
  return { ok: false, error: 'PATH_OUTSIDE_WORKSPACE' };
}

export function logBlocked(handler: string, wc: WebContents, inputPath: string, error: string): void {
  // Log no main process pra detectar tentativas de abuse. Não loga path
  // completo no error retornado pro renderer (info leak).
  console.warn(
    `[fs:security] ${handler} BLOCKED wcId=${wc.id} error=${error} path=${JSON.stringify(inputPath).slice(0, 200)}`,
  );
}

async function listDir(dirPath: string): Promise<FsEntry[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => {
        // Filtra hidden exceto allowlist
        if (e.name.startsWith('.')) return HIDDEN_ALLOWLIST.has(e.name);
        // node_modules sempre escondido (default)
        if (e.name === 'node_modules') return false;
        return true;
      })
      .map((e) => ({
        name: e.name,
        path: join(dirPath, e.name),
        type: e.isDirectory() ? ('dir' as const) : ('file' as const)
      }))
      .sort((a, b) => {
        // Pastas primeiro, depois alfabético
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch (err) {
    console.error('listDir error:', dirPath, err);
    return [];
  }
}

export function registerFsIPC(): void {
  // Registra cwd ativo da window. Renderer chama isso ao abrir um workspace.
  // Sem cwd registrado, todos handlers fs:* que escrevem retornam NO_ACTIVE_CWD.
  // Read-only handlers ainda funcionam pra ~/.claude (Claude CLI storage).
  ipcMain.handle('fs:setActiveCwd', (evt, cwd: string) => {
    if (typeof cwd !== 'string' || cwd.length === 0) {
      activeCwdByWc.delete(evt.sender.id);
      return { ok: true };
    }
    try {
      const resolved = pathResolve(cwd);
      activeCwdByWc.set(evt.sender.id, resolved);
      // Cleanup quando o webContents é destroyed (window closed).
      evt.sender.once('destroyed', () => {
        activeCwdByWc.delete(evt.sender.id);
      });
      return { ok: true, cwd: resolved };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('fs:listDir', (evt, dirPath: string) => {
    const v = validatePath(dirPath, evt.sender, 'read');
    if (!v.ok) {
      logBlocked('listDir', evt.sender, dirPath, v.error);
      return [];
    }
    return listDir(v.resolved);
  });

  ipcMain.handle('fs:readFile', async (evt, filePath: string) => {
    const v = validatePath(filePath, evt.sender, 'read');
    if (!v.ok) {
      logBlocked('readFile', evt.sender, filePath, v.error);
      return { error: v.error };
    }
    try {
      const content = await readFile(v.resolved, 'utf-8');
      return { content };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('fs:writeFile', async (evt, filePath: string, content: string) => {
    const v = validatePath(filePath, evt.sender, 'write');
    if (!v.ok) {
      logBlocked('writeFile', evt.sender, filePath, v.error);
      return { error: v.error };
    }
    try {
      await writeFile(v.resolved, content, 'utf-8');
      return { ok: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  /**
   * Escreve arquivo binário a partir de base64. Usado por image paste no composer
   * (clipboard image → .undrcod/pasted-images/<ts>.png) e qualquer caso de attachment binário.
   * mkdir recursivo do dir pai (não fail se dir não existir).
   */
  ipcMain.handle('fs:writeBinaryFromBase64', async (evt, filePath: string, base64: string) => {
    const v = validatePath(filePath, evt.sender, 'write');
    if (!v.ok) {
      logBlocked('writeBinaryFromBase64', evt.sender, filePath, v.error);
      return { error: v.error };
    }
    try {
      await mkdir(dirname(v.resolved), { recursive: true });
      const buf = Buffer.from(base64, 'base64');
      await writeFile(v.resolved, buf);
      return { ok: true, path: v.resolved };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('fs:stat', async (evt, p: string) => {
    const v = validatePath(p, evt.sender, 'read');
    if (!v.ok) {
      logBlocked('stat', evt.sender, p, v.error);
      return { error: v.error };
    }
    try {
      const s = await stat(v.resolved);
      return {
        isDirectory: s.isDirectory(),
        isFile: s.isFile(),
        size: s.size,
        mtime: s.mtimeMs
      };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // Revela arquivo/pasta no Windows Explorer / Finder / Files (OS-specific).
  // Usa shell.showItemInFolder do Electron.
  // === File operations: create/delete/rename ===
  // Usados pelo context menu do FileTree (botão direito → "Novo arquivo / pasta / Excluir / Renomear").
  // Path absoluto sempre. Retornam { ok: true } | { error: string }.

  ipcMain.handle('fs:createFile', async (evt, filePath: string, content = '') => {
    const v = validatePath(filePath, evt.sender, 'write');
    if (!v.ok) {
      logBlocked('createFile', evt.sender, filePath, v.error);
      return { error: v.error };
    }
    try {
      // mkdir parent se não existir, depois writeFile com flag 'wx' (fail se já existe).
      await mkdir(dirname(v.resolved), { recursive: true });
      await writeFile(v.resolved, content, { flag: 'wx', encoding: 'utf8' });
      return { ok: true };
    } catch (err: any) {
      return { error: err.code === 'EEXIST' ? 'Arquivo já existe' : err.message };
    }
  });

  ipcMain.handle('fs:createDir', async (evt, dirPath: string) => {
    const v = validatePath(dirPath, evt.sender, 'write');
    if (!v.ok) {
      logBlocked('createDir', evt.sender, dirPath, v.error);
      return { error: v.error };
    }
    try {
      await mkdir(v.resolved, { recursive: false });
      return { ok: true };
    } catch (err: any) {
      return { error: err.code === 'EEXIST' ? 'Pasta já existe' : err.message };
    }
  });

  ipcMain.handle('fs:delete', async (evt, p: string) => {
    const v = validatePath(p, evt.sender, 'write');
    if (!v.ok) {
      logBlocked('delete', evt.sender, p, v.error);
      return { error: v.error };
    }
    try {
      // recursive: true pra cobrir pasta com conteúdo. force: true pra ignorar
      // ENOENT (se já foi deletado por outro processo). Não é "shred" — apenas unlink.
      await rm(v.resolved, { recursive: true, force: true });
      return { ok: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('fs:rename', async (evt, oldPath: string, newPath: string) => {
    const vOld = validatePath(oldPath, evt.sender, 'write');
    if (!vOld.ok) {
      logBlocked('rename(old)', evt.sender, oldPath, vOld.error);
      return { error: vOld.error };
    }
    const vNew = validatePath(newPath, evt.sender, 'write');
    if (!vNew.ok) {
      logBlocked('rename(new)', evt.sender, newPath, vNew.error);
      return { error: vNew.error };
    }
    try {
      // rename do Node tanto renomeia (mesmo dir) quanto move (dir diferente).
      await rename(vOld.resolved, vNew.resolved);
      return { ok: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('fs:revealInOs', (evt, p: string) => {
    const v = validatePath(p, evt.sender, 'read');
    if (!v.ok) {
      logBlocked('revealInOs', evt.sender, p, v.error);
      return { ok: false, error: v.error };
    }
    shell.showItemInFolder(v.resolved);
    return { ok: true };
  });

  // Lê arquivo binário como data URL (base64). Usado pra preview de imagens —
  // o CSP do renderer NÃO permite img-src file:, então passamos via IPC convertendo
  // pra data:image/<ext>;base64,... que JÁ está no whitelist do CSP.
  ipcMain.handle('fs:readFileAsDataUrl', async (evt, filePath: string) => {
    const v = validatePath(filePath, evt.sender, 'read');
    if (!v.ok) {
      logBlocked('readFileAsDataUrl', evt.sender, filePath, v.error);
      return { error: v.error };
    }
    try {
      const buf = await readFile(v.resolved);
      const ext = (v.resolved.split('.').pop() || '').toLowerCase();
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
        ico: 'image/x-icon',
        svg: 'image/svg+xml',
      };
      const mime = mimeMap[ext] || 'application/octet-stream';
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      return { dataUrl };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // === Find & Replace global no workspace ===
  // Walka mesma estrutura do grepNative (search.ts) mas faz replace in-place.
  // opts: { matchCase, wholeWord, regex, includeGlob?, excludeGlob? }
  // Retorna { filesChanged, totalReplacements } | { error }.
  ipcMain.handle(
    'fs:replaceInFiles',
    async (
      evt,
      cwd: string,
      query: string,
      replacement: string,
      opts: {
        matchCase: boolean;
        wholeWord: boolean;
        regex: boolean;
        includeGlob?: string;
        excludeGlob?: string;
      },
    ) => {
      if (!cwd || !query) return { error: 'cwd e query obrigatorios' };
      // Confina o walk ao activeCwd. Renderer só pode pedir replaceInFiles
      // dentro do workspace registrado — senão XSS no renderer podia rodar
      // mass-write em ~/ ou C:\ inteiro.
      const v = validatePath(cwd, evt.sender, 'write');
      if (!v.ok) {
        logBlocked('replaceInFiles', evt.sender, cwd, v.error);
        return { error: v.error };
      }
      cwd = v.resolved;

      const IGNORE_DIRS = new Set([
        'node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache',
        '.vscode', '.idea', 'coverage', 'target', '__pycache__',
      ]);
      const BINARY_EXT = new Set([
        'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'pdf', 'zip', '7z',
        'exe', 'dll', 'so', 'dylib', 'mp3', 'mp4', 'mov', 'wav', 'afdesign', 'afphoto',
      ]);

      function escapeRegex(s: string): string {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }

      function globsToRegex(globs: string | undefined): RegExp | null {
        if (!globs) return null;
        const parts = globs.split(',').map((p) => p.trim()).filter(Boolean);
        if (parts.length === 0) return null;
        const escapeChar = (c: string): string =>
          /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
        const compileOne = (g: string): string => {
          let out = '';
          let i = 0;
          while (i < g.length) {
            const c = g[i];
            if (c === '*' && g[i + 1] === '*') {
              out += '.*';
              i += 2;
              if (g[i] === '/') i++;
            } else if (c === '*') {
              out += '[^/]*';
              i++;
            } else if (c === '?') {
              out += '[^/]';
              i++;
            } else if (c === '/') {
              out += '/';
              i++;
            } else {
              out += escapeChar(c);
              i++;
            }
          }
          return out;
        };
        const pattern = parts.map((p) => `(?:^|/)(?:${compileOne(p)})$`).join('|');
        try {
          return new RegExp(pattern);
        } catch {
          return null;
        }
      }

      // Constroi regex a partir do query + flags. Sempre /g pra replace global.
      let re: RegExp;
      try {
        let body = opts.regex ? query : escapeRegex(query);
        if (opts.wholeWord) body = `\\b${body}\\b`;
        const flags = opts.matchCase ? 'g' : 'gi';
        re = new RegExp(body, flags);
      } catch (err: any) {
        return { error: `Regex invalida: ${err.message}` };
      }

      const incRe = globsToRegex(opts.includeGlob);
      const excRe = globsToRegex(opts.excludeGlob);

      let filesChanged = 0;
      let totalReplacements = 0;

      async function walk(dir: string, depth: number): Promise<void> {
        if (depth > 10) return;
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (e.name.startsWith('.') && !['.claude', '.vscode', '.github'].includes(e.name)) continue;
          if (IGNORE_DIRS.has(e.name)) continue;
          const full = join(dir, e.name);
          if (e.isDirectory()) {
            await walk(full, depth + 1);
          } else if (e.isFile()) {
            const ext = e.name.split('.').pop()?.toLowerCase() || '';
            if (BINARY_EXT.has(ext)) continue;

            const rel = relative(cwd, full).split(sep).join('/');
            if (incRe && !incRe.test(rel)) continue;
            if (excRe && excRe.test(rel)) continue;

            try {
              const s = await stat(full);
              if (s.size > 1_000_000) continue;
              const content = await readFile(full, 'utf8');

              // Conta antes de substituir (regex /g — usa matchAll).
              re.lastIndex = 0;
              const matches = content.match(re);
              if (!matches || matches.length === 0) continue;

              re.lastIndex = 0;
              const next = content.replace(re, replacement);
              if (next === content) continue;

              await writeFile(full, next, 'utf8');
              filesChanged++;
              totalReplacements += matches.length;
            } catch {
              /* skip unreadable */
            }
          }
        }
      }

      try {
        await walk(cwd, 0);
        return { ok: true as const, filesChanged, totalReplacements };
      } catch (err: any) {
        return { error: err.message };
      }
    },
  );

  ipcMain.handle('dialog:openWorkspace', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { canceled: true };
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return { canceled: false, path: result.filePaths[0] };
  });

  ipcMain.handle('dialog:openFiles', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { canceled: true };
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return { canceled: false, paths: result.filePaths };
  });

  ipcMain.handle('dialog:openFolder', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { canceled: true };
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return { canceled: false, path: result.filePaths[0] };
  });

  // "Save As..." — dialog nativo de save. Retorna path escolhido ou canceled.
  // Não escreve nada — caller usa fs:writeFile no path retornado.
  ipcMain.handle('dialog:saveFile', async (_, suggestedName?: string, defaultDir?: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { canceled: true };
    const defaultPath =
      defaultDir && suggestedName
        ? join(defaultDir, suggestedName)
        : suggestedName || undefined;
    const result = await dialog.showSaveDialog(win, {
      defaultPath,
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    return { canceled: false, path: result.filePath };
  });

  // ===== File watcher (chokidar) =====
  // Watcher per-window: cada renderer pode ter UM watcher ativo. Re-startar
  // mata o anterior. Eventos mandados pra `fs:watcher-event` no sender.
  // Ignora node_modules / .git / dist / build pra não floodar com noise.
  const watchersByWebContents = new Map<number, FSWatcher>();

  const cleanupWatcher = async (wcId: number): Promise<void> => {
    const w = watchersByWebContents.get(wcId);
    if (w) {
      watchersByWebContents.delete(wcId);
      // await pra evitar 2 watchers convivendo no mesmo cwd durante re-watch.
      try { await w.close(); } catch { /* ignore */ }
    }
  };

  const sendIfAlive = (wc: WebContents, channel: string, payload: unknown): void => {
    if (!wc.isDestroyed()) {
      try { wc.send(channel, payload); } catch { /* ignore */ }
    }
  };

  ipcMain.handle('fs:watchWorkspace', async (event, cwd: string) => {
    const wc = event.sender;
    // O watcher emite paths absolutos dos arquivos pro renderer. Sem validação,
    // renderer comprometido podia watchar /etc, ~/.ssh, etc, e exfiltrar info
    // só pela sequencia de eventos (mtime/size).
    const v = validatePath(cwd, wc, 'read');
    if (!v.ok) {
      logBlocked('watchWorkspace', wc, cwd, v.error);
      return { error: v.error };
    }
    cwd = v.resolved;
    await cleanupWatcher(wc.id);
    try {
      // Ignored list AGRESSIVO — Vite/Next/Webpack/Rust/Java/.NET/Python builds
      // escrevem dezenas de arquivos por segundo em HMR. Watcher seguindo isso
      // = main thread starve + UI freeze. Lista expandida pra cobrir os
      // hotspots mais comuns. Função em vez de array regex pra avaliação O(1).
      const IGNORED_DIRS = new Set([
        '.git', 'node_modules', 'dist', 'build', 'out', 'coverage',
        '.next', '.cache', '.vite', '.turbo', '.parcel-cache',
        '.svelte-kit', '.vercel', '.nuxt', '.astro',
        'target', 'bin', 'obj', '.gradle',
        '__pycache__', '.venv', 'venv', '.pytest_cache', '.mypy_cache',
        'tmp', 'temp', '.tmp',
      ]);
      const watcher = chokidar.watch(cwd, {
        // Função é mais rápida que array de regex — avalia segment por segment.
        ignored: (p: string): boolean => {
          // Split rápido por separador OS e checa qualquer segment contra Set.
          const segs = p.split(/[\\\/]/);
          for (const s of segs) {
            if (s && IGNORED_DIRS.has(s)) return true;
          }
          return false;
        },
        ignoreInitial: true,
        persistent: true,
        // Polling relax: dev servers/builds escrevem múltiplas vezes o mesmo
        // arquivo em milissegundos. Stability 500ms + poll 200ms agrupa
        // os writes em 1 evento sem queimar CPU.
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
        // Depth menor — workspaces tipo monorepo facilmente alcançam 8+ níveis.
        // 5 cobre src/components/feature/sub/file.ts e similares.
        depth: 5,
        usePolling: false,
      });

      watcher.on('change', (p) => sendIfAlive(wc, 'fs:watcher-event', { event: 'change', path: p }));
      watcher.on('add', (p) => sendIfAlive(wc, 'fs:watcher-event', { event: 'add', path: p }));
      watcher.on('unlink', (p) => sendIfAlive(wc, 'fs:watcher-event', { event: 'unlink', path: p }));
      watcher.on('addDir', (p) => sendIfAlive(wc, 'fs:watcher-event', { event: 'addDir', path: p }));
      watcher.on('unlinkDir', (p) => sendIfAlive(wc, 'fs:watcher-event', { event: 'unlinkDir', path: p }));
      watcher.on('error', (err) => {
        console.error('[fs:watch] error:', err);
        sendIfAlive(wc, 'fs:watcher-event', { event: 'error', path: String(err) });
      });

      watchersByWebContents.set(wc.id, watcher);
      wc.once('destroyed', () => { void cleanupWatcher(wc.id); });
      return { ok: true as const };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('fs:unwatchWorkspace', async (event) => {
    await cleanupWatcher(event.sender.id);
    return { ok: true as const };
  });
}
