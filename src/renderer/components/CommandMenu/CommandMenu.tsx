import { useEffect, useMemo, useRef, useState } from 'react';
import './CommandMenu.css';
import { COMMAND_REGISTRY, CATEGORY_LABELS, type RegistryCommand } from './commandRegistry';
import { fuzzyRank, type FuzzyResult } from './fuzzyMatch';

export type CommandAction =
  | { kind: 'write-to-input'; text: string }       // escreve no input do user, ele revê e envia
  | { kind: 'send-direct'; prompt: string }        // envia direto pro Claude (ex: /clear)
  | { kind: 'pick-file'; multiple?: boolean }      // abre file dialog do OS
  | { kind: 'focus-tree' };                        // foca FileTree pro user arrastar

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;        // descrição curta à direita
  keywords?: string;    // pra fuzzy filter
  icon?: string;        // emoji ou ícone simples
  action: CommandAction;
  disabled?: boolean;
  disabledReason?: string;
}

export interface CommandSection {
  id: string;
  title: string;
  items: CommandItem[];
}

interface CommandMenuProps {
  open: boolean;
  onClose: () => void;
  sections: CommandSection[];
  onSelect: (item: CommandItem) => void;
  /** posiciona em relação a um elemento ancorado (input + button) */
  anchorRef?: React.RefObject<HTMLElement | null>;
  /** filter controlado externamente (ex: vindo do textarea com `/cmd`).
   *  Quando setado, esconde o input interno e o foco fica no anchor. */
  externalFilter?: string;
}

export function CommandMenu({ open, onClose, sections, onSelect, anchorRef, externalFilter }: CommandMenuProps) {
  const [filter, setFilter] = useState('');
  const [focusedIdx, setFocusedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const useExternal = externalFilter !== undefined;
  const effectiveFilter = useExternal ? externalFilter : filter;

  // Flatten items pra navegação por teclado considerando filter
  const filteredSections = useMemo(() => {
    if (!effectiveFilter.trim()) return sections;
    const q = effectiveFilter.toLowerCase();
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter(
          (it) =>
            it.label.toLowerCase().includes(q) ||
            it.keywords?.toLowerCase().includes(q) ||
            it.hint?.toLowerCase().includes(q)
        )
      }))
      .filter((s) => s.items.length > 0);
  }, [effectiveFilter, sections]);

  const flatItems = useMemo(
    () => filteredSections.flatMap((s) => s.items.filter((i) => !i.disabled)),
    [filteredSections]
  );

  useEffect(() => {
    if (open) {
      setFocusedIdx(0);
      // Auto-foca o input interno SÓ se não tiver filter externo
      // (quando externo, o foco fica no textarea pra user editar)
      if (!useExternal) {
        setFilter('');
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    }
  }, [open, useExternal]);

  useEffect(() => {
    setFocusedIdx(0);
  }, [effectiveFilter]);

  // Click fora fecha
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      // Quando aberto via externalFilter (textarea com `/`),
      // ignora clicks no próprio textarea — senão fecha+reabre em loop
      if (useExternal && (target as Element)?.closest?.('.composer-input')) return;
      onClose();
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open, onClose, anchorRef, useExternal]);

  if (!open) return null;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIdx((i) => Math.min(i + 1, flatItems.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatItems[focusedIdx];
      if (item) {
        onSelect(item);
        onClose();
      }
      return;
    }
  }

  return (
    <div className="cmdmenu" ref={menuRef} role="dialog" aria-label="Comandos">
      {!useExternal && (
        <input
          ref={inputRef}
          className="cmdmenu-filter"
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="buscar comando..."
          spellCheck={false}
        />
      )}
      <div className="cmdmenu-list">
        {filteredSections.length === 0 && (
          <div className="cmdmenu-empty">nenhum comando</div>
        )}
        {filteredSections.map((section) => (
          <div key={section.id} className="cmdmenu-section">
            <div className="cmdmenu-section-title">{section.title}</div>
            {section.items.map((item) => {
              const globalIdx = flatItems.findIndex((i) => i.id === item.id);
              const focused = !item.disabled && globalIdx === focusedIdx;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`cmdmenu-item ${focused ? 'is-focused' : ''} ${item.disabled ? 'is-disabled' : ''}`}
                  onClick={() => {
                    if (item.disabled) return;
                    onSelect(item);
                    onClose();
                  }}
                  onMouseEnter={() => {
                    if (!item.disabled && globalIdx >= 0) setFocusedIdx(globalIdx);
                  }}
                  disabled={item.disabled}
                >
                  {item.icon && (
                    <span className="cmdmenu-item-icon">
                      <i className={`codicon codicon-${item.icon}`} />
                    </span>
                  )}
                  <span className="cmdmenu-item-label">{item.label}</span>
                  {item.hint && <span className="cmdmenu-item-hint">{item.hint}</span>}
                  {item.disabled && item.disabledReason && (
                    <span className="cmdmenu-item-disabled">{item.disabledReason}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="cmdmenu-footer">
        <span><kbd>↑↓</kbd> navegar</span>
        <span><kbd>↵</kbd> executar</span>
        <span><kbd>esc</kbd> fechar</span>
      </div>
    </div>
  );
}

// =============================================================================
// CommandPalette — VS Code-style global palette (Ctrl+P / Ctrl+Shift+P).
//
// Modes:
//   `>` prefix  → built-in commands (registry.ts)
//   `@` prefix  → files (fuzzy via fs:searchFiles IPC)
//   `:` prefix  → grep contents (fs:grepContent IPC)
//   sem prefix  → file mode (Ctrl+P default)
//
// Distinto do CommandMenu acima (que é o popover de slash-commands do ChatView).
// Mesmo arquivo pra agrupar tudo "command-ish", exports separados pra evitar
// confusão de API.
// =============================================================================

export type PaletteMode = 'command' | 'file' | 'grep';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  cwd: string | null;
  onOpenFile: (path: string) => void;
  onExecuteCommand: (commandId: string) => void;
  /** Texto inicial — App.tsx passa '>' pra Ctrl+Shift+P, '' pra Ctrl+P. */
  initialInput?: string;
}

interface FileResult {
  path: string;
  name: string;
}

interface GrepResult {
  path: string;
  line: number;
  text: string;
}

type PaletteResult =
  | { kind: 'command'; command: RegistryCommand; match: FuzzyResult }
  | { kind: 'file'; file: FileResult; match: FuzzyResult }
  | { kind: 'grep'; hit: GrepResult };

// Defensivo — preload pode não ter os endpoints novos ainda (outros 2 agents
// em paralelo). Probes em runtime e cai em empty graceful.
function safeSearchFiles(cwd: string, query: string): Promise<FileResult[]> {
  const api = (window.undrcodAPI?.fs as unknown as {
    searchFiles?: (cwd: string, query: string) => Promise<FileResult[] | { error: string }>;
  })?.searchFiles;
  if (typeof api !== 'function') return Promise.resolve([]);
  return api(cwd, query)
    .then((r) => (Array.isArray(r) ? r : []))
    .catch(() => []);
}

function safeGrepContent(cwd: string, query: string): Promise<GrepResult[]> {
  const api = (window.undrcodAPI?.fs as unknown as {
    grepContent?: (cwd: string, query: string) => Promise<GrepResult[] | { error: string }>;
  })?.grepContent;
  if (typeof api !== 'function') return Promise.resolve([]);
  return api(cwd, query)
    .then((r) => (Array.isArray(r) ? r : []))
    .catch(() => []);
}

function detectMode(input: string): { mode: PaletteMode; query: string } {
  if (input.startsWith('>')) return { mode: 'command', query: input.slice(1).trimStart() };
  if (input.startsWith('@')) return { mode: 'file', query: input.slice(1).trimStart() };
  if (input.startsWith(':')) return { mode: 'grep', query: input.slice(1).trimStart() };
  return { mode: 'file', query: input.trimStart() };
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function dirname(path: string, cwd: string | null): string {
  // Mostra path relativo ao cwd quando possível, senão path completo.
  let p = path;
  if (cwd && path.startsWith(cwd)) {
    p = path.substring(cwd.length).replace(/^[\\/]+/, '');
  }
  p = p.replace(/\\/g, '/');
  const slash = p.lastIndexOf('/');
  return slash > 0 ? p.substring(0, slash) : '';
}

/** Renderiza texto com matches em <strong> baseado em índices casados. */
function HighlightedText({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const set = new Set(indices);
  const out: React.ReactNode[] = [];
  let buf = '';
  let bufMatched: boolean | null = null;
  for (let i = 0; i < text.length; i++) {
    const isMatch = set.has(i);
    if (bufMatched === null) bufMatched = isMatch;
    if (isMatch === bufMatched) {
      buf += text[i];
    } else {
      out.push(bufMatched ? <strong key={i + 'm'}>{buf}</strong> : <span key={i + 's'}>{buf}</span>);
      buf = text[i];
      bufMatched = isMatch;
    }
  }
  if (buf) {
    out.push(bufMatched ? <strong key="last-m">{buf}</strong> : <span key="last-s">{buf}</span>);
  }
  return <>{out}</>;
}

const MAX_VISIBLE = 12;

export function CommandPalette({
  open,
  onClose,
  cwd,
  onOpenFile,
  onExecuteCommand,
  initialInput = '',
}: CommandPaletteProps) {
  const [input, setInput] = useState(initialInput);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [fileResults, setFileResults] = useState<FileResult[]>([]);
  const [grepResults, setGrepResults] = useState<GrepResult[]>([]);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  const { mode, query } = useMemo(() => detectMode(input), [input]);

  // Reset on open + foca input
  useEffect(() => {
    if (open) {
      setInput(initialInput);
      setFocusedIdx(0);
      setFileResults([]);
      setGrepResults([]);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, initialInput]);

  // Reseta highlight quando query/mode muda
  useEffect(() => {
    setFocusedIdx(0);
  }, [input]);

  // Debounced fetch pra file/grep
  useEffect(() => {
    if (!open) return;
    if (mode === 'command') return;
    if (!cwd) {
      setFileResults([]);
      setGrepResults([]);
      return;
    }

    const reqId = ++requestIdRef.current;
    setLoading(true);

    // Debounce 80ms — file search é rápido, grep pode ser pesado
    const delay = mode === 'grep' ? 150 : 80;
    const handle = setTimeout(async () => {
      if (mode === 'file') {
        const results = await safeSearchFiles(cwd, query);
        if (reqId !== requestIdRef.current) return;
        setFileResults(results.slice(0, 100));
      } else if (mode === 'grep') {
        if (!query) {
          setGrepResults([]);
          setLoading(false);
          return;
        }
        const results = await safeGrepContent(cwd, query);
        if (reqId !== requestIdRef.current) return;
        setGrepResults(results.slice(0, 100));
      }
      setLoading(false);
    }, delay);

    return () => {
      clearTimeout(handle);
    };
  }, [open, mode, query, cwd]);

  // Computa lista final de resultados pra mode atual
  const results = useMemo<PaletteResult[]>(() => {
    if (mode === 'command') {
      return fuzzyRank(COMMAND_REGISTRY, query, (c) => `${c.title} ${c.keywords ?? ''} ${c.description ?? ''}`)
        .map(({ item, result }) => ({ kind: 'command' as const, command: item, match: result }));
    }
    if (mode === 'file') {
      // Backend já filtra; aplica fuzzy só pra ordenação consistente + highlight no nome.
      if (!query) {
        return fileResults.map((f) => ({
          kind: 'file' as const,
          file: f,
          match: { score: 1, matchedIndices: [] } as FuzzyResult,
        }));
      }
      return fuzzyRank(fileResults, query, (f) => f.name)
        .map(({ item, result }) => ({ kind: 'file' as const, file: item, match: result }));
    }
    // grep — backend já casou, não re-ranqueia
    return grepResults.map((g) => ({ kind: 'grep' as const, hit: g }));
  }, [mode, query, fileResults, grepResults]);

  const visibleCount = Math.min(results.length, 100);

  // Mantém item focado visível (scroll-into-view)
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${focusedIdx}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIdx]);

  // Backdrop click + Escape global
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  function activate(idx: number) {
    const r = results[idx];
    if (!r) return;
    if (r.kind === 'command') {
      onExecuteCommand(r.command.id);
      onClose();
    } else if (r.kind === 'file') {
      onOpenFile(r.file.path);
      onClose();
    } else if (r.kind === 'grep') {
      onOpenFile(r.hit.path);
      onClose();
    }
  }

  function handleInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIdx((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIdx((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      activate(focusedIdx);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    // Ctrl+K — limpa input (cycle back to empty)
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setInput('');
      return;
    }
  }

  const modeLabel: Record<PaletteMode, string> = {
    command: 'Command',
    file: 'File',
    grep: 'Grep',
  };
  const modeIcon: Record<PaletteMode, string> = {
    command: 'chevron-right',
    file: 'file',
    grep: 'search',
  };

  return (
    <div
      className="cmdpalette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="cmdpalette"
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmdpalette-input-row">
          <span className={`cmdpalette-mode-pill mode-${mode}`}>
            <i className={`codicon codicon-${modeIcon[mode]}`} />
            <span>{modeLabel[mode]}</span>
          </span>
          <input
            ref={inputRef}
            className="cmdpalette-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleInputKey}
            placeholder={'Type ">" for commands, "@" for files, ":" for grep'}
            spellCheck={false}
            autoComplete="off"
          />
          {loading && <span className="cmdpalette-loading" aria-label="loading" />}
        </div>

        <div className="cmdpalette-list" ref={listRef}>
          {results.length === 0 && (
            <div className="cmdpalette-empty">
              {mode === 'grep' && !query
                ? 'Digite algo pra buscar conteúdo dos arquivos…'
                : mode === 'file' && !cwd
                  ? 'Nenhum workspace aberto'
                  : loading
                    ? 'Buscando…'
                    : 'Nenhum resultado'}
            </div>
          )}

          {results.slice(0, visibleCount).map((r, idx) => {
            const isFocused = idx === focusedIdx;
            const cls = `cmdpalette-item ${isFocused ? 'is-focused' : ''}`;
            return (
              <button
                key={r.kind === 'command' ? `c:${r.command.id}` : r.kind === 'file' ? `f:${r.file.path}` : `g:${r.hit.path}:${r.hit.line}`}
                type="button"
                data-idx={idx}
                className={cls}
                onMouseEnter={() => setFocusedIdx(idx)}
                onClick={() => activate(idx)}
              >
                {isFocused && <span className="cmdpalette-item-cursor">▸</span>}
                {!isFocused && <span className="cmdpalette-item-cursor-spacer" />}
                {renderItem(r, cwd)}
              </button>
            );
          })}
        </div>

        <div className="cmdpalette-footer">
          <span className="kbd-row"><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> navegar</span>
          <span className="kbd-row"><kbd className="kbd">↵</kbd> ativar</span>
          <span className="kbd-row"><kbd className="kbd">esc</kbd> fechar</span>
          <span className="cmdpalette-footer-spacer" />
          <span className="cmdpalette-footer-hint">
            <kbd className="kbd">&gt;</kbd> cmd · <kbd className="kbd">@</kbd> file · <kbd className="kbd">:</kbd> grep
          </span>
        </div>
      </div>
    </div>
  );
}

function renderItem(r: PaletteResult, cwd: string | null) {
  if (r.kind === 'command') {
    return (
      <>
        <span className="cmdpalette-item-icon">
          <i className={`codicon codicon-${r.command.icon}`} />
        </span>
        <span className="cmdpalette-item-main">
          <span className="cmdpalette-item-title">
            <HighlightedText
              text={r.command.title}
              indices={r.match.matchedIndices.filter((i) => i < r.command.title.length)}
            />
          </span>
          {r.command.description && (
            <span className="cmdpalette-item-desc">{r.command.description}</span>
          )}
        </span>
        <span className="cmdpalette-item-meta">
          {r.command.shortcut && (
            <span className="kbd-row">
              {r.command.shortcut.map((k, i) => (
                <kbd key={i} className="kbd">{k}</kbd>
              ))}
            </span>
          )}
          <span className="cmdpalette-item-category">{CATEGORY_LABELS[r.command.category]}</span>
        </span>
      </>
    );
  }
  if (r.kind === 'file') {
    const name = r.file.name || basename(r.file.path);
    const dir = dirname(r.file.path, cwd);
    return (
      <>
        <span className="cmdpalette-item-icon">
          <i className="codicon codicon-file" />
        </span>
        <span className="cmdpalette-item-main">
          <span className="cmdpalette-item-title">
            <HighlightedText text={name} indices={r.match.matchedIndices} />
          </span>
          {dir && <span className="cmdpalette-item-desc">{dir}</span>}
        </span>
      </>
    );
  }
  // grep
  const name = basename(r.hit.path);
  const dir = dirname(r.hit.path, cwd);
  return (
    <>
      <span className="cmdpalette-item-icon">
        <i className="codicon codicon-search" />
      </span>
      <span className="cmdpalette-item-main">
        <span className="cmdpalette-item-title">
          {name}
          <span className="cmdpalette-grep-line">:{r.hit.line}</span>
        </span>
        <span className="cmdpalette-item-desc cmdpalette-grep-snippet">
          {dir && <span className="cmdpalette-grep-dir">{dir} · </span>}
          <code>{r.hit.text.length > 200 ? r.hit.text.slice(0, 200) + '…' : r.hit.text}</code>
        </span>
      </span>
    </>
  );
}
