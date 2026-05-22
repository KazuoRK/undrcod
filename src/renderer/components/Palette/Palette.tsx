/**
 * Palette — modal de comando palette + quick open de arquivos.
 *
 * Inspirado no Ctrl+P / Ctrl+Shift+P do VS Code. Reaproveita `fuzzyMatch` do
 * `CommandMenu` (que ficou pra slash commands do chat).
 *
 * Dois modos:
 *   - `commands` → lista 13 actions do `commandRegistry`, fuzzy filter por título/keywords
 *   - `files`    → lista arquivos do workspace via `fs.searchFiles` (IPC do backend)
 *
 * Fechado por padrão. Parent controla via `open`. Esc fecha.
 */
import { useEffect, useRef, useState, useMemo } from 'react';
import { COMMAND_REGISTRY, type RegistryCommand } from '../CommandMenu/commandRegistry';
import { fuzzyRank } from '../CommandMenu/fuzzyMatch';
import { getRecentForWorkspace } from '../../utils/recentFiles';
import './Palette.css';

export type PaletteMode = 'commands' | 'files' | 'grep' | 'workspaces' | 'openedTabs';

/**
 * Item de tab aberta passado pelo parent quando mode==='openedTabs'.
 * Cursor `workbench.action.showAllEditors` literal: `quickAccess.show(P8i.PREFIX)` —
 * abre quick access filtrando SÓ tabs abertas (não o workspace inteiro).
 */
export interface OpenedTabItem {
  id: string;
  label: string;
  /** Path relativo (file tab) ou descrição (special tab tipo diff/git). */
  detail?: string;
  /** Codicon name sem prefixo. */
  icon?: string;
  /** Se está em dirty state (indicador visual). */
  dirty?: boolean;
  /** Grupo (primary/secondary) quando split. */
  group?: 'primary' | 'secondary';
}

interface PaletteProps {
  open: boolean;
  mode: PaletteMode;
  onClose: () => void;
  /** Quando `mode === 'commands'` */
  onExecuteCommand?: (commandId: string) => void;
  /** Quando `mode === 'files'` ou `'grep'` — cwd do workspace + abre arquivo */
  cwd?: string | null;
  /** Abre arquivo. Opcionalmente: linha 1-indexed + range do match (cols 0-indexed) pra grep. */
  onOpenFile?: (path: string, line?: number, matchStart?: number, matchEnd?: number) => void;
  /** Quando `mode === 'workspaces'` — troca o workspace ativo. */
  onSelectWorkspace?: (path: string) => void;
  /** Quando `mode === 'openedTabs'` — lista das tabs abertas (passa do parent). */
  openedTabs?: OpenedTabItem[];
  /** Quando `mode === 'openedTabs'` — seleciona uma tab. */
  onSelectTab?: (tabId: string, group?: 'primary' | 'secondary') => void;
}

interface FileResult {
  path: string;
  relPath: string;
  score: number;
}

interface GrepResult {
  path: string;
  relPath: string;
  line: number;
  text: string;
  matchStart: number;
  matchEnd: number;
}

interface WorkspaceResult {
  path: string;
  sessionCount: number;
  lastUsed: string;
}

const PLACEHOLDER: Record<PaletteMode, string> = {
  commands: 'Type a command name (Esc fecha)',
  files: 'Type to search files in workspace (Esc fecha)',
  grep: 'Type to grep contents (min 2 chars, Esc fecha)',
  workspaces: 'Type to switch workspace (Esc fecha)',
  openedTabs: 'Filter opened editors (Esc fecha)',
};

/** Path encurtado pra exibição (substitui home por ~). */
function shortenWorkspacePath(path: string): string {
  const homeLike = path.match(/^([A-Z]:[\\/]Users[\\/][^\\/]+|\/Users\/[^/]+|\/home\/[^/]+)/i);
  if (homeLike) {
    return '~' + path.slice(homeLike[0].length).replace(/\\/g, '/');
  }
  return path.replace(/\\/g, '/');
}

function workspaceBasename(path: string): string {
  const norm = path.replace(/\\/g, '/').replace(/\/$/, '');
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function formatLastUsed(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diff = now - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 1) return 'hoje';
  if (days < 2) return 'ontem';
  if (days < 7) return `${days}d atrás`;
  if (days < 30) return `${Math.floor(days / 7)}sem atrás`;
  return d.toLocaleDateString();
}

export function Palette({ open, mode, onClose, onExecuteCommand, cwd, onOpenFile, onSelectWorkspace, openedTabs, onSelectTab }: PaletteProps) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(0);
  const [files, setFiles] = useState<FileResult[]>([]);
  const [grepHits, setGrepHits] = useState<GrepResult[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset ao abrir
  useEffect(() => {
    if (open) {
      setQuery('');
      setFocused(0);
      setFiles([]);
      setGrepHits([]);
      setWorkspaces([]);
      // foca input após DOM commit
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, mode]);

  // Fetch workspaces conhecidos quando mode==workspaces (uma vez ao abrir).
  useEffect(() => {
    if (!open || mode !== 'workspaces') return;
    let cancelled = false;
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = window.undrcodAPI?.claude?.listKnownWorkspaces;
    if (typeof fn !== 'function') {
      setWorkspaces([]);
      setLoading(false);
      return;
    }
    fn().then((list: WorkspaceResult[]) => {
      if (cancelled) return;
      const arr = Array.isArray(list) ? list : [];
      // Ordena por lastUsed desc (mais recente primeiro).
      arr.sort((a, b) => {
        const ta = new Date(a.lastUsed).getTime() || 0;
        const tb = new Date(b.lastUsed).getTime() || 0;
        return tb - ta;
      });
      setWorkspaces(arr);
      setFocused(0);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setWorkspaces([]);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, mode]);

  // Busca arquivos quando mode==files
  useEffect(() => {
    if (!open || mode !== 'files' || !cwd) return;
    let cancelled = false;
    setLoading(true);
    const fn = (window.undrcodAPI?.fs as { searchFiles?: (cwd: string, q: string) => Promise<FileResult[]> }).searchFiles;
    if (typeof fn !== 'function') {
      setFiles([]);
      setLoading(false);
      return;
    }
    fn(cwd, query).then((result) => {
      if (!cancelled) {
        setFiles(result);
        setFocused(0);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setFiles([]);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [open, mode, cwd, query]);

  // Grep content quando mode==grep (debounce 200ms pra não martelar ripgrep)
  useEffect(() => {
    if (!open || mode !== 'grep' || !cwd) return;
    if (query.length < 2) {
      setGrepHits([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const fn = (window.undrcodAPI?.fs as { grepContent?: (cwd: string, q: string) => Promise<GrepResult[]> }).grepContent;
    if (typeof fn !== 'function') {
      setGrepHits([]);
      setLoading(false);
      return;
    }
    const timer = setTimeout(() => {
      fn(cwd, query).then((result) => {
        if (!cancelled) {
          setGrepHits(result);
          setFocused(0);
          setLoading(false);
        }
      }).catch(() => {
        if (!cancelled) {
          setGrepHits([]);
          setLoading(false);
        }
      });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, mode, cwd, query]);

  // Lista filtrada por mode (commands usa fuzzy local; files/grep já vem filtrado do backend).
  // Quando files+query vazia, mostra "Recentes" do localStorage (workspace-scoped).
  const items = useMemo(() => {
    if (mode === 'commands') {
      if (!query.trim()) return COMMAND_REGISTRY.map((cmd) => ({ kind: 'command' as const, cmd }));
      const ranked = fuzzyRank(
        COMMAND_REGISTRY,
        query,
        (c) => `${c.title} ${c.keywords ?? ''} ${c.description ?? ''}`,
      );
      return ranked.map(({ item }) => ({ kind: 'command' as const, cmd: item }));
    } else if (mode === 'files') {
      // Query vazia: mostra arquivos recentes (até 10) marcados como kind:'recent'.
      // Query com texto: usa results do backend.
      if (!query.trim()) {
        const recents = getRecentForWorkspace(cwd ?? null).slice(0, 10);
        const cwdNorm = (cwd ?? '').replace(/\\/g, '/').replace(/\/$/, '');
        return recents.map((p) => {
          const norm = p.replace(/\\/g, '/');
          const relPath = cwdNorm && norm.startsWith(cwdNorm)
            ? norm.slice(cwdNorm.length).replace(/^\//, '')
            : norm;
          return { kind: 'recent' as const, file: { path: p, relPath, score: 0 } };
        });
      }
      return files.map((f) => ({ kind: 'file' as const, file: f }));
    } else if (mode === 'grep') {
      return grepHits.map((g) => ({ kind: 'grep' as const, hit: g }));
    } else if (mode === 'openedTabs') {
      // Cursor `showAllEditors` literal: quickAccess.show(P8i.PREFIX) — só tabs abertas.
      // Aqui filtramos local por label/detail (sem fuzzy backend, pq são poucos itens).
      const list = openedTabs ?? [];
      const q = query.trim().toLowerCase();
      const filtered = !q
        ? list
        : list.filter((t) =>
            t.label.toLowerCase().includes(q) ||
            (t.detail ?? '').toLowerCase().includes(q),
          );
      return filtered.map((tab) => ({ kind: 'openedTab' as const, tab }));
    } else {
      // workspaces — filtro local por nome ou path
      const q = query.trim().toLowerCase();
      const filtered = !q
        ? workspaces
        : workspaces.filter((w) =>
            workspaceBasename(w.path).toLowerCase().includes(q) ||
            w.path.toLowerCase().includes(q),
          );
      return filtered.map((w) => ({ kind: 'workspace' as const, ws: w }));
    }
  }, [mode, query, files, grepHits, workspaces, cwd, openedTabs]);

  const total = items.length;

  // Keyboard nav
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocused((p) => (p + 1) % Math.max(1, total));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocused((p) => (p - 1 + total) % Math.max(1, total));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (total === 0) return;
        const item = items[focused];
        if (!item) return;
        if (item.kind === 'command') {
          onExecuteCommand?.(item.cmd.id);
          onClose();
        } else if (item.kind === 'file' || item.kind === 'recent') {
          onOpenFile?.(item.file.path);
          onClose();
        } else if (item.kind === 'grep') {
          onOpenFile?.(item.hit.path, item.hit.line, item.hit.matchStart, item.hit.matchEnd);
          onClose();
        } else if (item.kind === 'workspace') {
          if (onSelectWorkspace) {
            onSelectWorkspace(item.ws.path);
          } else {
            window.dispatchEvent(new CustomEvent('undrcod:set-workspace', { detail: { cwd: item.ws.path } }));
          }
          onClose();
        } else if (item.kind === 'openedTab') {
          onSelectTab?.(item.tab.id, item.tab.group);
          onClose();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, total, focused, items, onExecuteCommand, onOpenFile, onSelectWorkspace, onSelectTab, onClose]);

  // Scroll item focado pra view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${focused}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  if (!open) return null;

  return (
    <div
      className="palette-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="palette-modal">
        <div className="palette-input-wrap">
          <i className={`codicon codicon-${mode === 'commands' ? 'chevron-right' : 'search'} palette-input-icon`} />
          <input
            ref={inputRef}
            type="text"
            className="palette-input"
            placeholder={PLACEHOLDER[mode]}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setFocused(0); }}
            autoFocus
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {loading && (
            <div className="palette-empty">buscando…</div>
          )}
          {!loading && total === 0 && (
            <div className="palette-empty">
              {mode === 'commands' && 'no matching commands'}
              {mode === 'files' && (query ? 'no matching files' : 'nenhum arquivo recente — digite pra buscar')}
              {mode === 'grep' && (query.length < 2 ? 'digite ao menos 2 chars pra grepar' : 'nenhum match no conteúdo')}
              {mode === 'workspaces' && (query ? 'no matching workspaces' : 'nenhum workspace conhecido')}
              {mode === 'openedTabs' && (query ? 'no matching tabs' : 'nenhuma tab aberta')}
            </div>
          )}
          {mode === 'files' && !query.trim() && items.length > 0 && (
            <div className="palette-section-header">
              <i className="codicon codicon-history" /> Aberto recentemente
            </div>
          )}
          {mode === 'workspaces' && !query.trim() && items.length > 0 && (
            <div className="palette-section-header">
              <i className="codicon codicon-history" /> Workspaces recentes
            </div>
          )}
          {!loading && items.map((item, i) => {
            const isFocused = i === focused;
            const key =
              item.kind === 'command' ? `cmd:${item.cmd.id}` :
              item.kind === 'file' ? `file:${item.file.path}` :
              item.kind === 'recent' ? `recent:${item.file.path}` :
              item.kind === 'workspace' ? `ws:${item.ws.path}` :
              item.kind === 'openedTab' ? `tab:${item.tab.id}` :
              `grep:${item.hit.path}:${item.hit.line}`;
            return (
              <button
                key={key}
                type="button"
                data-idx={i}
                className={`palette-item ${isFocused ? 'is-focused' : ''}`}
                onMouseEnter={() => setFocused(i)}
                onClick={() => {
                  if (item.kind === 'command') {
                    onExecuteCommand?.(item.cmd.id);
                  } else if (item.kind === 'file' || item.kind === 'recent') {
                    onOpenFile?.(item.file.path);
                  } else if (item.kind === 'grep') {
                    onOpenFile?.(item.hit.path, item.hit.line, item.hit.matchStart, item.hit.matchEnd);
                  } else if (item.kind === 'workspace') {
                    if (onSelectWorkspace) {
                      onSelectWorkspace(item.ws.path);
                    } else {
                      window.dispatchEvent(new CustomEvent('undrcod:set-workspace', { detail: { cwd: item.ws.path } }));
                    }
                  } else if (item.kind === 'openedTab') {
                    onSelectTab?.(item.tab.id, item.tab.group);
                  }
                  onClose();
                }}
              >
                {item.kind === 'command' && <CommandRow cmd={item.cmd} />}
                {item.kind === 'file' && <FileRow relPath={item.file.relPath} />}
                {item.kind === 'recent' && <FileRow relPath={item.file.relPath} isRecent />}
                {item.kind === 'grep' && <GrepRow hit={item.hit} />}
                {item.kind === 'workspace' && <WorkspaceRow ws={item.ws} />}
                {item.kind === 'openedTab' && <OpenedTabRow tab={item.tab} />}
              </button>
            );
          })}
        </div>
        <div className="palette-footer">
          <span className="palette-hint">
            <kbd className="kbd">↑↓</kbd> navegar
            <kbd className="kbd">↵</kbd> selecionar
            <kbd className="kbd">Esc</kbd> fechar
          </span>
          {mode === 'commands' && total > 0 && (
            <span className="palette-count">{total} command{total !== 1 ? 's' : ''}</span>
          )}
          {mode === 'files' && total > 0 && (
            <span className="palette-count">{total} file{total !== 1 ? 's' : ''}</span>
          )}
          {mode === 'grep' && total > 0 && (
            <span className="palette-count">{total} match{total !== 1 ? 'es' : ''}</span>
          )}
          {mode === 'workspaces' && total > 0 && (
            <span className="palette-count">{total} workspace{total !== 1 ? 's' : ''}</span>
          )}
          {mode === 'openedTabs' && total > 0 && (
            <span className="palette-count">{total} tab{total !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function CommandRow({ cmd }: { cmd: RegistryCommand }) {
  return (
    <>
      <i className={`codicon codicon-${cmd.icon} palette-row-icon`} />
      <div className="palette-row-main">
        <div className="palette-row-title">{cmd.title}</div>
        {cmd.description && <div className="palette-row-desc">{cmd.description}</div>}
      </div>
      {cmd.shortcut && (
        <span className="palette-row-shortcut">
          {cmd.shortcut.map((k) => (
            <kbd key={k} className="kbd">{k}</kbd>
          ))}
        </span>
      )}
    </>
  );
}

function FileRow({ relPath, isRecent }: { relPath: string; isRecent?: boolean }) {
  const lastSlash = relPath.lastIndexOf('/');
  const filename = lastSlash >= 0 ? relPath.slice(lastSlash + 1) : relPath;
  const dir = lastSlash >= 0 ? relPath.slice(0, lastSlash) : '';
  return (
    <>
      <i className={`codicon codicon-${isRecent ? 'history' : 'file'} palette-row-icon`} />
      <div className="palette-row-main">
        <div className="palette-row-title">{filename}</div>
        {dir && <div className="palette-row-desc">{dir}</div>}
      </div>
    </>
  );
}

function WorkspaceRow({ ws }: { ws: WorkspaceResult }) {
  const name = workspaceBasename(ws.path);
  const shortPath = shortenWorkspacePath(ws.path);
  const last = formatLastUsed(ws.lastUsed);
  return (
    <>
      <i className="codicon codicon-folder palette-row-icon" />
      <div className="palette-row-main">
        <div className="palette-row-title">{name}</div>
        <div className="palette-row-desc">{shortPath}</div>
      </div>
      <span className="palette-row-shortcut">
        {ws.sessionCount > 0 && (
          <span className="palette-count">{ws.sessionCount} sess{ws.sessionCount !== 1 ? 'ões' : 'ão'}</span>
        )}
        {last && <span className="palette-count">{last}</span>}
      </span>
    </>
  );
}

function OpenedTabRow({ tab }: { tab: OpenedTabItem }) {
  const icon = tab.icon ?? 'file';
  return (
    <>
      <i className={`codicon codicon-${icon} palette-row-icon`} />
      <div className="palette-row-main">
        <div className="palette-row-title">
          {tab.label}
          {tab.dirty && <span className="palette-dirty-indicator" aria-label="unsaved"> ●</span>}
        </div>
        {tab.detail && <div className="palette-row-desc">{tab.detail}</div>}
      </div>
      {tab.group === 'secondary' && (
        <span className="palette-row-shortcut">
          <span className="palette-count">Group 2</span>
        </span>
      )}
    </>
  );
}

function GrepRow({ hit }: { hit: GrepResult }) {
  const before = hit.text.slice(0, hit.matchStart);
  const match = hit.text.slice(hit.matchStart, hit.matchEnd);
  const after = hit.text.slice(hit.matchEnd);
  return (
    <>
      <i className="codicon codicon-search palette-row-icon" />
      <div className="palette-row-main">
        <div className="palette-row-title palette-grep-snippet">
          <span className="palette-grep-line">{hit.line}:</span>
          <span className="palette-grep-text">
            {before}
            <mark className="palette-grep-match">{match}</mark>
            {after}
          </span>
        </div>
        <div className="palette-row-desc">{hit.relPath}</div>
      </div>
    </>
  );
}
