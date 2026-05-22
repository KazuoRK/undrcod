/**
 * workspaceState — persiste tabs centrais + dirty content por workspace (cwd) no localStorage.
 *
 * Objetivo: ao reload (F5 / Ctrl+R / restart), restaurar exatamente as tabs que
 * estavam abertas naquele workspace, qual era a ativa, e o conteúdo não-salvo
 * (dirtyContents) de cada arquivo editado mas não salvo.
 *
 * Storage:
 *   - 1 entry por workspace, keyed por hash curto do cwd (btoa truncado).
 *   - Múltiplos workspaces coexistem sem colisão.
 *   - Cada entry tem timestamp pra debug / eventual TTL.
 *
 * Não persiste:
 *   - gotoLine / matchStart / matchEnd (são ephemeral, vindos de grep)
 *   - bottom panel / right pane / outros UI state (escopo deste módulo é só central tabs)
 *
 * Caller é responsável por validar paths via fs.stat antes de re-abrir (arquivo
 * pode ter sido deletado entre sessões).
 */

const KEY_PREFIX = 'undrcode.workspaceState.';

/** Forma serializável de um CentralTab. Campos opcionais espelham os dois kinds (file | view). */
export interface PersistedTab {
  id: string;
  kind: 'file' | 'view';
  path?: string;
  viewId?: string;
  title?: string;
  icon?: string;
  pinned?: boolean;
}

export interface PersistedWorkspaceState {
  centralTabs: PersistedTab[];
  activeCentralTabId: string | null;
  /** Entries do Map<path, content> serializados como pares. */
  dirtyContents: Array<[string, string]>;
  ts: number;
}

/**
 * Gera key estável a partir do cwd. Usa btoa (base64) pra evitar caracteres
 * inválidos (`:`, `\`, `/`) e trunca pra 40 chars (suficiente pra deduplicar
 * — não precisa ser criptográfico, só evitar colisão entre workspaces).
 *
 * Note: btoa pode lançar em strings com chars fora do range latin1.
 * Usamos encodeURIComponent → unescape pra normalizar antes (suporta UTF-8).
 */
function key(cwd: string): string {
  try {
    const normalized = unescape(encodeURIComponent(cwd));
    return KEY_PREFIX + btoa(normalized).replace(/[+/=]/g, '').slice(0, 40);
  } catch {
    // Fallback ultra-defensivo: hash trivial caso btoa falhe por algum motivo.
    let h = 0;
    for (let i = 0; i < cwd.length; i++) h = ((h << 5) - h + cwd.charCodeAt(i)) | 0;
    return KEY_PREFIX + 'fb' + Math.abs(h).toString(36);
  }
}

export function saveWorkspaceState(cwd: string, state: PersistedWorkspaceState): void {
  try {
    localStorage.setItem(key(cwd), JSON.stringify(state));
  } catch (err) {
    // Quota exceeded / serialization error — não deve quebrar a app.
    // eslint-disable-next-line no-console
    console.warn('[workspaceState] save falhou:', (err as Error).message);
  }
}

export function loadWorkspaceState(cwd: string): PersistedWorkspaceState | null {
  try {
    const raw = localStorage.getItem(key(cwd));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedWorkspaceState;
    // Validação defensiva mínima — entradas com shape errado retornam null.
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.centralTabs)) return null;
    if (!Array.isArray(parsed.dirtyContents)) return null;
    return parsed;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[workspaceState] load falhou:', (err as Error).message);
    return null;
  }
}

export function clearWorkspaceState(cwd: string): void {
  try {
    localStorage.removeItem(key(cwd));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[workspaceState] clear falhou:', (err as Error).message);
  }
}
