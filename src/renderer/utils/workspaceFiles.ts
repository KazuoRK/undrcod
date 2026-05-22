/**
 * Lista files do workspace recursivamente pra @mention autocomplete.
 * Skipa node_modules, .git, build, dist, etc. (não-úteis pra mentions).
 * Max 2000 entries pra evitar travada em workspaces enormes.
 */

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.vite',
  '.cache',
  '.parcel-cache',
  '.turbo',
  'dist',
  'build',
  'out',
  'coverage',
  '.DS_Store',
  '__pycache__',
  '.venv',
  'venv',
  'target',         // Rust
  '.gradle',        // Java
  '.idea',
  '.vscode',
]);

const MAX_ENTRIES = 2000;
const MAX_DEPTH = 6;

export interface WorkspaceFile {
  /** relative path do cwd (forward slashes) */
  rel: string;
  /** absolute path */
  abs: string;
  type: 'file' | 'dir';
}

export async function listWorkspaceFiles(cwd: string): Promise<WorkspaceFile[]> {
  const result: WorkspaceFile[] = [];
  const sep = cwd.includes('\\') ? '\\' : '/';

  async function walk(dirAbs: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    if (result.length >= MAX_ENTRIES) return;

    let entries: Array<{ name: string; path: string; type: 'file' | 'dir' }>;
    try {
      entries = await window.undrcodAPI?.fs.listDir(dirAbs);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (result.length >= MAX_ENTRIES) return;
      // skip dot files (except .env / .gitignore)
      if (entry.name.startsWith('.') && !/^\.(env|gitignore|gitattributes|prettierrc|eslintrc)/.test(entry.name)) {
        continue;
      }
      if (entry.type === 'dir' && SKIP_DIRS.has(entry.name)) continue;

      const relPath = entry.path.startsWith(cwd)
        ? entry.path.slice(cwd.length).replace(/^[\\/]/, '').replace(/\\/g, '/')
        : entry.path.replace(/\\/g, '/');

      result.push({ rel: relPath, abs: entry.path, type: entry.type });

      if (entry.type === 'dir') {
        await walk(entry.path, depth + 1);
      }
    }
  }

  await walk(cwd, 0);
  return result;
}

/**
 * Score-based fuzzy match: case-insensitive substring boost, full segment match, etc.
 * Retorna score >= 0. Não-match = -1.
 */
export function fuzzyMatchScore(query: string, target: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // exact prefix match = best
  if (t.startsWith(q)) return 1000 - t.length;
  // basename starts with query (after last /)
  const baseStart = t.lastIndexOf('/') + 1;
  if (t.slice(baseStart).startsWith(q)) return 800 - t.length;
  // contains as substring
  const idx = t.indexOf(q);
  if (idx >= 0) return 500 - idx - t.length / 10;
  // all chars match in order (fuzzy)
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  if (qi === q.length) return 200 - t.length;
  return -1;
}

export function filterWorkspaceFiles(
  files: WorkspaceFile[],
  query: string,
  limit = 20
): WorkspaceFile[] {
  if (!query) {
    // sem query, retorna primeiros N (dirs primeiro)
    return [...files]
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.rel.localeCompare(b.rel);
      })
      .slice(0, limit);
  }
  const scored = files
    .map((f) => ({ file: f, score: fuzzyMatchScore(query, f.rel) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((x) => x.file);
}
