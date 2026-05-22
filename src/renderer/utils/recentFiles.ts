/**
 * recentFiles — helper minimal pra localStorage que armazena últimos N arquivos abertos.
 *
 * Usado pelo QuickOpen (Ctrl+P) pra mostrar uma section "Recentes" quando a query
 * tá vazia. Lista ordenada por último uso (mais recente primeiro).
 *
 * Storage: localStorage key `undr.recentFiles` = JSON Array<{ path, lastUsed }>.
 * Max 20 entries. Path absoluto.
 */

const KEY = 'undr.recentFiles';
const MAX = 20;

interface RecentEntry {
  path: string;
  lastUsed: number;
}

function read(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is RecentEntry =>
      typeof e === 'object' && e !== null &&
      typeof e.path === 'string' && typeof e.lastUsed === 'number',
    );
  } catch {
    return [];
  }
}

function write(entries: RecentEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch { /* quota? noop */ }
}

/** Marca path como aberto agora. Sobe pro topo da lista. */
export function pushRecent(path: string): void {
  if (!path) return;
  const now = Date.now();
  const current = read();
  const next: RecentEntry[] = [
    { path, lastUsed: now },
    ...current.filter((e) => e.path !== path),
  ].slice(0, MAX);
  write(next);
}

/** Retorna paths ordenados por último uso (mais recente primeiro). */
export function getRecent(): string[] {
  return read()
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .map((e) => e.path);
}

/** Filtra apenas paths que começam com o cwd (workspace-scoped recent). */
export function getRecentForWorkspace(cwd: string | null): string[] {
  if (!cwd) return getRecent();
  const norm = cwd.replace(/\\/g, '/');
  return getRecent().filter((p) => p.replace(/\\/g, '/').startsWith(norm));
}

/**
 * Como getRecentForWorkspace, mas retorna entries com lastUsed pra UI mostrar
 * "há 5 min" etc. Ordenado por mais recente primeiro.
 */
export function getRecentEntriesForWorkspace(cwd: string | null): RecentEntry[] {
  const all = read().sort((a, b) => b.lastUsed - a.lastUsed);
  if (!cwd) return all;
  const norm = cwd.replace(/\\/g, '/');
  return all.filter((e) => e.path.replace(/\\/g, '/').startsWith(norm));
}

/** Remove path da lista (ex: arquivo deletado). */
export function removeRecent(path: string): void {
  write(read().filter((e) => e.path !== path));
}

/** Limpa toda a lista (settings: "Clear recent files"). */
export function clearRecent(): void {
  write([]);
}
