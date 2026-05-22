import { ipcMain } from 'electron';
import { spawn } from 'child_process';
import { readdir, readFile, stat } from 'fs/promises';
import { join, relative, sep } from 'path';
import { validatePath, logBlocked } from './fs';

interface FileSearchResult {
  path: string;       // absolute
  relPath: string;    // workspace-relative, forward slashes
  score: number;      // higher = better match
}

interface GrepMatch {
  path: string;
  relPath: string;
  line: number;
  text: string;
  matchStart: number;
  matchEnd: number;
}

const GREP_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache',
  '.vscode', '.idea', 'coverage', 'target', '__pycache__'
]);
const MAX_GREP_RESULTS = 200;
const MAX_LINE_LENGTH = 240;
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'pdf', 'zip', '7z',
  'exe', 'dll', 'só', 'dylib', 'mp3', 'mp4', 'mov', 'wav', 'afdesign', 'afphoto'
]);

async function isRipgrepAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const p = spawn('rg', ['--version'], { windowsHide: true });
      p.on('error', () => resolve(false));
      p.on('exit', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

async function grepViaRipgrep(cwd: string, query: string): Promise<GrepMatch[]> {
  return new Promise((resolve) => {
    const matches: GrepMatch[] = [];
    const args = ['--json', '--max-count=20', '--no-ignore-vcs', '-i', '--', query, '.'];
    const p = spawn('rg', args, { cwd, windowsHide: true });
    let buf = '';
    p.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (matches.length >= MAX_GREP_RESULTS) {
          p.kill();
          return;
        }
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'match' && evt.data) {
            const relPath: string = evt.data.path?.text || '';
            const lineNum: number = evt.data.line_number || 1;
            const text: string = (evt.data.lines?.text || '').replace(/\n$/, '').slice(0, MAX_LINE_LENGTH);
            const submatch = evt.data.submatches?.[0];
            const matchStart: number = submatch?.start ?? 0;
            const matchEnd: number = Math.min(submatch?.end ?? matchStart + query.length, MAX_LINE_LENGTH);
            matches.push({
              path: join(cwd, relPath),
              relPath: relPath.split(sep).join('/'),
              line: lineNum,
              text,
              matchStart,
              matchEnd,
            });
          }
        } catch {
          /* skip malformed JSON line */
        }
      }
    });
    p.on('error', () => resolve(matches));
    p.on('exit', () => resolve(matches));
  });
}

async function grepNative(cwd: string, query: string): Promise<GrepMatch[]> {
  const lcQuery = query.toLowerCase();
  const matches: GrepMatch[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (matches.length >= MAX_GREP_RESULTS) return;
    if (depth > 10) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && !['.claude', '.vscode', '.github'].includes(e.name)) continue;
      if (GREP_IGNORE_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
        if (matches.length >= MAX_GREP_RESULTS) return;
      } else if (e.isFile()) {
        const ext = e.name.split('.').pop()?.toLowerCase() || '';
        if (BINARY_EXT.has(ext)) continue;
        try {
          const s = await stat(full);
          if (s.size > 1_000_000) continue; // skip files > 1MB
          const content = await readFile(full, 'utf8');
          const lines = content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const lc = lines[i].toLowerCase();
            const idx = lc.indexOf(lcQuery);
            if (idx >= 0) {
              const text = lines[i].slice(0, MAX_LINE_LENGTH);
              matches.push({
                path: full,
                relPath: relative(cwd, full).split(sep).join('/'),
                line: i + 1,
                text,
                matchStart: idx,
                matchEnd: Math.min(idx + query.length, MAX_LINE_LENGTH),
              });
              if (matches.length >= MAX_GREP_RESULTS) return;
            }
          }
        } catch {
          /* skip unreadable */
        }
      }
    }
  }

  await walk(cwd, 0);
  return matches;
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache',
  '.vscode', '.idea', 'coverage', '.nuxt', '.svelte-kit', 'target',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.tox',
  '.DS_Store'
]);

const MAX_RESULTS = 50;
const MAX_FILES_SCANNED = 10000; // safety cap

// Simple cache: cwd -> { ts, files }
const cache = new Map<string, { ts: number; files: string[] }>();
const CACHE_TTL_MS = 15000;

async function listAllFiles(cwd: string): Promise<string[]> {
  const cached = cache.get(cwd);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.files;

  const results: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (results.length >= MAX_FILES_SCANNED) return;
    if (depth > 12) return; // hard depth cap
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && !['.claude', '.vscode', '.github'].includes(entry.name)) continue;
      if (IGNORE_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        results.push(full);
        if (results.length >= MAX_FILES_SCANNED) return;
      }
    }
  }
  await walk(cwd, 0);
  cache.set(cwd, { ts: Date.now(), files: results });
  return results;
}

// Fuzzy score: returns -1 if no match, else higher score = better
function fuzzyScore(query: string, target: string): number {
  if (!query) return 1; // empty query matches all with low priority
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  // Exact substring bonus
  const idx = t.indexOf(q);
  if (idx >= 0) {
    // Bonus if match starts at path boundary (after / or .) or at start
    const boundary = idx === 0 || '/.-_\\'.includes(t[idx - 1]);
    return 1000 + (boundary ? 500 : 0) - idx; // earlier match wins
  }
  // Char-by-char fuzzy com penalty de gap pra evitar matches super espalhados
  // em paths longos (ex: "tsx" matchando em "marke**T**place**S**/e**X**ternal_plugins").
  let qi = 0, score = 0, lastMatch = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      const consecutive = ti === lastMatch + 1;
      const wordStart = ti === 0 || '/.-_\\'.includes(t[ti - 1]);
      let charScore = 10 + (consecutive ? 10 : 0) + (wordStart ? 20 : 0);
      // Penalty proporcional ao gap entre match anterior e atual.
      if (lastMatch >= 0) {
        const gap = ti - lastMatch - 1;
        if (gap > 0) charScore -= Math.min(gap, 15); // cap em -15 pra cada gap
      }
      score += charScore;
      lastMatch = ti;
      qi++;
    }
  }
  if (qi < q.length) return -1; // not all chars matched
  // Threshold mínimo proporcional ao tamanho da query — filtra matches muito espalhados.
  // Pra query "abc" (3 chars), exige ao menos score 18 = ~6/char = chars relativamente próximos.
  const minScore = q.length >= 3 ? q.length * 6 : 0;
  if (score < minScore) return -1;
  return score;
}

export function registerSearchIPC(): void {
  ipcMain.handle('fs:searchFiles', async (evt, cwd: string, query: string): Promise<FileSearchResult[]> => {
    if (!cwd) return [];
    const v = validatePath(cwd, evt.sender, 'read');
    if (!v.ok) {
      logBlocked('searchFiles', evt.sender, cwd, v.error);
      return [];
    }
    cwd = v.resolved;
    try {
      const all = await listAllFiles(cwd);
      const results: FileSearchResult[] = [];
      for (const full of all) {
        const rel = relative(cwd, full).split(sep).join('/');
        const score = fuzzyScore(query, rel);
        if (score >= 0) {
          results.push({ path: full, relPath: rel, score });
        }
      }
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, MAX_RESULTS);
    } catch (err) {
      console.error('[search] file search error:', err);
      return [];
    }
  });

  ipcMain.handle('fs:grepContent', async (evt, cwd: string, query: string): Promise<GrepMatch[]> => {
    if (!cwd || !query || query.length < 2) return [];
    const v = validatePath(cwd, evt.sender, 'read');
    if (!v.ok) {
      logBlocked('grepContent', evt.sender, cwd, v.error);
      return [];
    }
    cwd = v.resolved;
    try {
      const hasRg = await isRipgrepAvailable();
      return hasRg ? await grepViaRipgrep(cwd, query) : await grepNative(cwd, query);
    } catch (err) {
      console.error('[search] grep error:', err);
      return [];
    }
  });
}
