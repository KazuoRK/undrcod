/**
 * BottomPanel — painel inferior com 5 tabs fixas (estilo VS Code).
 *
 *   Problems | Output | Debug Console | Terminal | Ports
 *
 * Status atual:
 *   - Problems: tsc --noEmit no cwd, agrupado por arquivo, "Send to Agent" — FUNCIONAL.
 *   - Output: 3 canais (Main process / Renderer / Tasks) com buffer FIFO — FUNCIONAL.
 *   - Debug Console: REPL pra debug session. Empty state (sem debugger ainda).
 *   - Terminal: shell interativa (xterm.js + node-pty) — FUNCIONAL.
 *   - Ports: netstat/lsof detector com refresh 5s — FUNCIONAL.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TerminalView, type TerminalViewHandle } from '../TerminalView/TerminalView';
import { toast } from '../Toast/Toast';
import './BottomPanel.css';

interface LogLine {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  text: string;
}

interface PortEntry {
  port: number;
  address: string;
  process?: string;
}

interface ProblemError {
  line: number;
  col: number;
  code: string;
  message: string;
}

interface ProblemFile {
  path: string;
  errors: ProblemError[];
}

export type BottomTabId =
  | 'problems'
  | 'todos'
  | 'output'
  | 'debug-console'
  | 'terminal'
  | 'tasks'
  | 'ports'
  | 'pending-changes';

// ─────────────────────────────────────────────────────
// Pending changes — proposta de edits do Agent
// ─────────────────────────────────────────────────────

export interface PendingEdit {
  path: string;
  oldContent: string;
  newContent: string;
}

const PENDING_EVENT = 'undrcod:pending-changes';

/**
 * Helper de integração futura com o agent. Quando o Claude propor um edit
 * via tool, chama isso pra adicionar à fila de pending changes em vez de
 * gravar direto no disco.
 *
 * O event payload tem shape `{ files: PendingEdit[] }` (mesmo formato que a
 * PendingChangesTab espera no listener). Chamadas múltiplas acumulam — a tab
 * faz merge por path (substitui se o mesmo arquivo for proposto de novo).
 */
export function proposePendingEdit(
  path: string,
  oldContent: string,
  newContent: string,
): void {
  const payload: { files: PendingEdit[] } = {
    files: [{ path, oldContent, newContent }],
  };
  window.dispatchEvent(new CustomEvent(PENDING_EVENT, { detail: payload }));
}

interface BottomPanelProps {
  cwd: string;
  activeTabId: BottomTabId;
  onTabSelect: (id: BottomTabId) => void;
  onClose: () => void;
  onToggleMaximize: () => void;
  isMaximized: boolean;
}

interface TabSpec {
  id: BottomTabId;
  title: string;
  badge?: number;
}

export function BottomPanel({
  cwd,
  activeTabId,
  onTabSelect,
  onClose,
  onToggleMaximize,
  isMaximized,
}: BottomPanelProps) {
  const terminalRef = useRef<TerminalViewHandle>(null);
  const shellLabel = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')
    ? 'powershell'
    : 'bash';

  // problemState fica no parent pra (a) render badge mesmo quando tab inativa
  //                              (b) compartilhar resultado entre polling e ProblemsTab
  const [problemFiles, setProblemFiles] = useState<ProblemFile[]>([]);
  const [problemLoading, setProblemLoading] = useState(false);
  const problemCount = useMemo(
    () => problemFiles.reduce((acc, f) => acc + f.errors.length, 0),
    [problemFiles],
  );

  // pendingCount fica no parent só pra render o badge mesmo quando a tab
  // está inativa. A PendingChangesTab tem o estado autoritativo da lista.
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    const onPending = (ev: Event): void => {
      const detail = (ev as CustomEvent).detail;
      if (!detail || !Array.isArray(detail.files)) return;
      setPendingCount((prev) => prev + detail.files.length);
    };
    const onAccepted = (ev: Event): void => {
      const detail = (ev as CustomEvent).detail;
      const total = typeof detail?.total === 'number' ? detail.total : 0;
      setPendingCount(total);
    };
    window.addEventListener(PENDING_EVENT, onPending);
    window.addEventListener('undrcod:pending-changes-total', onAccepted);
    return () => {
      window.removeEventListener(PENDING_EVENT, onPending);
      window.removeEventListener('undrcod:pending-changes-total', onAccepted);
    };
  }, []);

  const runProblemCheck = useCallback(async () => {
    if (!cwd) return;
    setProblemLoading(true);
    try {
      const res = await window.undrcodAPI?.problems.check(cwd);
      setProblemFiles(res.files);
    } catch (err) {
      console.warn('[BottomPanel] problems check falhou', err);
    } finally {
      setProblemLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void runProblemCheck();
    const id = window.setInterval(() => { void runProblemCheck(); }, 30_000);
    return () => window.clearInterval(id);
  }, [runProblemCheck]);

  // Escuta pedidos de "rodar comando no terminal" (vindos da TasksTab e da
  // PortsTab "Encaminhar Porta"). Switch pra tab Terminal + envia o comando
  // pelo handle do TerminalView. detail pode vir como string ou { script }.
  useEffect(() => {
    const onRunTask = (ev: Event): void => {
      const detail = (ev as CustomEvent).detail;
      const command: string | undefined =
        typeof detail === 'string'
          ? detail
          : detail && typeof detail === 'object' && typeof detail.script === 'string'
            ? detail.script
            : undefined;
      if (!command) return;
      onTabSelect('terminal');
      // Aguarda 1 frame pra garantir que o pty existe (se Terminal nunca foi
      // aberto antes, TerminalView so spawna ao montar).
      requestAnimationFrame(() => {
        terminalRef.current?.runCommand(command);
      });
    };
    window.addEventListener('undrcod:run-task', onRunTask);
    return () => window.removeEventListener('undrcod:run-task', onRunTask);
  }, [onTabSelect]);

  const tabs: TabSpec[] = [
    { id: 'problems', title: 'Problems', badge: problemCount },
    { id: 'todos', title: 'TODOs' },
    { id: 'pending-changes', title: 'Pending', badge: pendingCount },
    { id: 'output', title: 'Output' },
    { id: 'debug-console', title: 'Debug Console' },
    { id: 'terminal', title: 'Terminal' },
    { id: 'tasks', title: 'Tasks' },
    { id: 'ports', title: 'Ports' },
  ];

  return (
    <div className="bottom-panel-root">
      <div className="bottom-panel-tabbar">
        {tabs.map((t) => {
          const isActive = t.id === activeTabId;
          return (
            <button
              key={t.id}
              type="button"
              className={`bottom-panel-tab ${isActive ? 'is-active' : ''}`}
              onClick={() => onTabSelect(t.id)}
            >
              <span className="bottom-panel-tab-title">{t.title}</span>
              {t.badge !== undefined && t.badge > 0 && (
                <span className="bottom-panel-tab-badge">{t.badge}</span>
              )}
            </button>
          );
        })}

        <div className="bottom-panel-tabbar-spacer" />

        {/* Acoes especificas da tab Terminal — na mesma linha das tabs */}
        {activeTabId === 'terminal' && (
          <>
            <div className="bottom-panel-shell-label">
              <i className="codicon codicon-terminal-powershell" />
              <span>{shellLabel}</span>
            </div>
            <button
              type="button"
              className="bottom-panel-btn"
              title="Enviar últimas 50 linhas pro chat"
              onClick={() => {
                const text = terminalRef.current?.getRecentLines(50) ?? '';
                if (!text.trim()) {
                  toast.warn('Terminal vazio');
                  return;
                }
                window.dispatchEvent(
                  new CustomEvent('undrcod:terminal-to-chat', { detail: { text } }),
                );
                toast.success('Enviado pro chat');
              }}
            >
              <i className="codicon codicon-comment" />
            </button>
            <button
              type="button"
              className="bottom-panel-btn"
              title="Limpar tela"
              onClick={() => terminalRef.current?.clear()}
            >
              <i className="codicon codicon-clear-all" />
            </button>
            <button
              type="button"
              className="bottom-panel-btn"
              title="Matar e reiniciar shell"
              onClick={() => terminalRef.current?.restart()}
            >
              <i className="codicon codicon-trash" />
            </button>
            <div className="bottom-panel-tabbar-divider" />
          </>
        )}

        {/* Toolbar global (right) */}
        <button
          type="button"
          className="bottom-panel-btn"
          title={isMaximized ? 'Restaurar tamanho' : 'Maximizar painel'}
          onClick={onToggleMaximize}
        >
          <i className={`codicon codicon-${isMaximized ? 'screen-normal' : 'screen-full'}`} />
        </button>
        <button
          type="button"
          className="bottom-panel-btn"
          title="Fechar painel"
          onClick={onClose}
        >
          <i className="codicon codicon-close" />
        </button>
      </div>

      <div className="bottom-panel-content">
        {activeTabId === 'problems' && (
          <ProblemsTab
            files={problemFiles}
            loading={problemLoading}
            onRefresh={runProblemCheck}
          />
        )}
        {activeTabId === 'todos' && <TodosTab cwd={cwd} />}
        {activeTabId === 'pending-changes' && <PendingChangesTab />}
        {activeTabId === 'output' && <OutputTab />}
        {activeTabId === 'debug-console' && <DebugConsoleTab />}
        {activeTabId === 'tasks' && <TasksTab cwd={cwd} />}
        {activeTabId === 'ports' && <PortsTab />}
        {/* TerminalView fica sempre montado pra evitar kill+respawn em ciclo de tabs.
            Apenas escondemos com display:none quando outra tab esta ativa. */}
        <div
          className="bottom-panel-terminal-host"
          style={{ display: activeTabId === 'terminal' ? 'flex' : 'none' }}
        >
          <TerminalView ref={terminalRef} cwd={cwd} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Tab contents — empty states honestos
// ─────────────────────────────────────────────────────

interface ProblemsTabProps {
  files: ProblemFile[];
  loading: boolean;
  onRefresh: () => void;
}

function ProblemsTab({ files, loading, onRefresh }: ProblemsTabProps) {
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return files;
    return files
      .map((f) => ({
        ...f,
        errors: f.errors.filter(
          (e) =>
            f.path.toLowerCase().includes(q) ||
            e.message.toLowerCase().includes(q) ||
            e.code.toLowerCase().includes(q),
        ),
      }))
      .filter((f) => f.errors.length > 0);
  }, [files, filter]);

  const toggle = (path: string) =>
    setExpanded((prev) => ({ ...prev, [path]: prev[path] === false ? true : !prev[path] }));

  const isExpanded = (path: string): boolean => expanded[path] !== false; // default expandido

  const sendFileToAgent = (file: ProblemFile) => {
    const body = formatProblemsForAgent([file]);
    dispatchAgentMessage(body);
  };

  const sendAllToAgent = () => {
    if (filtered.length === 0) return;
    const body = formatProblemsForAgent(filtered);
    dispatchAgentMessage(body);
  };

  return (
    <div className="bottom-panel-tab-body">
      <div className="bottom-panel-subtoolbar">
        <input
          type="search"
          className="bottom-panel-filter"
          placeholder="Filter (e.g. text, **/*.ts, !**/node_modules/**)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
        />
        <button
          type="button"
          className="bottom-panel-btn"
          title="Re-checar agora"
          onClick={onRefresh}
          disabled={loading}
        >
          <i className={`codicon codicon-${loading ? 'sync~spin' : 'refresh'}`} />
        </button>
        {filtered.length > 0 && (
          <button
            type="button"
            className="bottom-panel-pill-btn"
            title="Envia todos os erros pro chat do Agent"
            onClick={sendAllToAgent}
          >
            Send all to Agent
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="bottom-panel-empty">
          <i className="codicon codicon-check-all" />
          <span>Nenhum problema detectado.</span>
          <span className="bottom-panel-empty-hint">
            Rodando tsc --noEmit a cada 30s. Sem tsconfig.json no workspace? A tab fica vazia.
          </span>
        </div>
      ) : (
        <div className="bottom-panel-problems-list">
          {filtered.map((file) => {
            const open = isExpanded(file.path);
            return (
              <div key={file.path} className="bottom-panel-problem-file">
                <div className="bottom-panel-problem-file-header">
                  <button
                    type="button"
                    className="bottom-panel-problem-file-toggle"
                    onClick={() => toggle(file.path)}
                  >
                    <i className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} />
                    <i className="codicon codicon-symbol-file" />
                    <span className="bottom-panel-problem-file-path" title={file.path}>
                      {basename(file.path)}
                    </span>
                    <span className="bottom-panel-problem-file-count">{file.errors.length}</span>
                    <span className="bottom-panel-problem-file-dim">{dirname(file.path)}</span>
                  </button>
                  <button
                    type="button"
                    className="bottom-panel-pill-btn bottom-panel-pill-btn--inline"
                    onClick={() => sendFileToAgent(file)}
                    title="Envia erros deste arquivo pro chat do Agent"
                  >
                    Send to Agent
                  </button>
                </div>
                {open && (
                  <ul className="bottom-panel-problem-errors">
                    {file.errors.map((e, i) => (
                      <li key={`${file.path}:${i}`} className="bottom-panel-problem-error">
                        <i className="codicon codicon-error" />
                        <span className="bottom-panel-problem-msg">{e.message}</span>
                        <span className="bottom-panel-problem-code">{e.code}</span>
                        <span className="bottom-panel-problem-loc">[Ln {e.line}, Col {e.col}]</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Pending changes tab — review queue de edits propostos pelo agent
// ─────────────────────────────────────────────────────

interface DiffStats {
  added: number;
  removed: number;
}

function computeDiffStats(oldContent: string, newContent: string): DiffStats {
  // Stat barato: conta linhas adicionadas/removidas como delta líquido,
  // sem rodar Myers. Suficiente pra exibir "+X -Y" no header de cada arquivo.
  const oldLines = oldContent === '' ? [] : oldContent.split(/\r?\n/);
  const newLines = newContent === '' ? [] : newContent.split(/\r?\n/);
  const oldSet = new Map<string, number>();
  for (const l of oldLines) oldSet.set(l, (oldSet.get(l) ?? 0) + 1);
  let removed = 0;
  for (const l of oldLines) {
    const count = oldSet.get(l) ?? 0;
    if (count > 0) oldSet.set(l, count - 1);
  }
  // Reset and do proper LCS-ish approximation via line frequency diff
  oldSet.clear();
  for (const l of oldLines) oldSet.set(l, (oldSet.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of newLines) {
    const c = oldSet.get(l) ?? 0;
    if (c > 0) oldSet.set(l, c - 1);
    else added += 1;
  }
  const newSet = new Map<string, number>();
  for (const l of newLines) newSet.set(l, (newSet.get(l) ?? 0) + 1);
  for (const l of oldLines) {
    const c = newSet.get(l) ?? 0;
    if (c > 0) newSet.set(l, c - 1);
    else removed += 1;
  }
  return { added, removed };
}

function PendingChangesTab() {
  const [files, setFiles] = useState<PendingEdit[]>([]);

  // Listener: merge por path (substitui se o mesmo arquivo for proposto duas vezes)
  useEffect(() => {
    const onPending = (ev: Event): void => {
      const detail = (ev as CustomEvent).detail;
      if (!detail || !Array.isArray(detail.files)) return;
      setFiles((prev) => {
        const map = new Map(prev.map((f) => [f.path, f]));
        for (const f of detail.files as PendingEdit[]) {
          map.set(f.path, f);
        }
        return Array.from(map.values());
      });
    };
    window.addEventListener(PENDING_EVENT, onPending);
    return () => window.removeEventListener(PENDING_EVENT, onPending);
  }, []);

  // Sempre que muda, broadcast o total pro parent reconciliar o badge
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('undrcod:pending-changes-total', { detail: { total: files.length } }),
    );
  }, [files.length]);

  const remove = useCallback((path: string) => {
    setFiles((prev) => prev.filter((f) => f.path !== path));
  }, []);

  const acceptFile = useCallback(async (file: PendingEdit) => {
    try {
      const res = await window.undrcodAPI?.fs.writeFile(file.path, file.newContent);
      if (res && typeof res === 'object' && 'error' in res) {
        toast.error('Falha ao aplicar', { sub: (res as { error: string }).error });
        return;
      }
      remove(file.path);
      toast.success(`${basename(file.path)} aplicado`);
    } catch (err) {
      toast.error('Falha ao aplicar', { sub: (err as Error).message });
    }
  }, [remove]);

  const rejectFile = useCallback((file: PendingEdit) => {
    remove(file.path);
    toast.info(`${basename(file.path)} rejeitado`);
  }, [remove]);

  const acceptAll = useCallback(async () => {
    const snapshot = files.slice();
    let okCount = 0;
    let failCount = 0;
    for (const f of snapshot) {
      try {
        const res = await window.undrcodAPI?.fs.writeFile(f.path, f.newContent);
        if (res && typeof res === 'object' && 'error' in res) {
          failCount += 1;
        } else {
          okCount += 1;
        }
      } catch {
        failCount += 1;
      }
    }
    setFiles([]);
    if (failCount === 0) {
      toast.success(`${okCount} arquivo(s) aplicado(s)`);
    } else {
      toast.warn(`${okCount} aplicado(s), ${failCount} falharam`);
    }
  }, [files]);

  const rejectAll = useCallback(() => {
    const n = files.length;
    setFiles([]);
    if (n > 0) toast.info(`${n} alteração(ões) rejeitada(s)`);
  }, [files]);

  const openDiff = useCallback((file: PendingEdit) => {
    window.dispatchEvent(
      new CustomEvent('undrcod:open-diff', {
        detail: {
          left: { path: file.path, content: file.oldContent, label: `${basename(file.path)} (atual)` },
          right: { path: file.path, content: file.newContent, label: `${basename(file.path)} (proposto)` },
        },
      }),
    );
  }, []);

  if (files.length === 0) {
    return (
      <div className="bottom-panel-empty">
        <i className="codicon codicon-git-pull-request" />
        <span>Nenhuma alteração pendente</span>
        <span className="bottom-panel-empty-hint">
          Quando o Agent propor edits via Edit/Write, eles aparecem aqui pra você revisar
          antes de aplicar no disco.
        </span>
      </div>
    );
  }

  return (
    <div className="bottom-panel-tab-body">
      <div className="bottom-panel-subtoolbar">
        <span className="bottom-panel-ports-count">
          {files.length} {files.length === 1 ? 'alteração' : 'alterações'} pendente{files.length === 1 ? '' : 's'}
        </span>
        <div className="bottom-panel-tabbar-spacer" />
        <button
          type="button"
          className="bottom-panel-pill-btn"
          title="Rejeita todas — descarta as alterações sem gravar"
          onClick={rejectAll}
        >
          Reject All
        </button>
        <button
          type="button"
          className="bottom-panel-pill-btn bottom-panel-pending-accept-all"
          title="Aplica todas as alterações no disco"
          onClick={() => void acceptAll()}
        >
          Accept All
        </button>
      </div>

      <div className="bottom-panel-pending-list">
        {files.map((f) => {
          const stats = computeDiffStats(f.oldContent, f.newContent);
          return (
            <div key={f.path} className="bottom-panel-pending-row">
              <button
                type="button"
                className="bottom-panel-pending-file"
                onClick={() => openDiff(f)}
                title="Abrir diff do arquivo"
              >
                <i className="codicon codicon-symbol-file" />
                <span className="bottom-panel-pending-name">{basename(f.path)}</span>
                <span className="bottom-panel-pending-dim" title={f.path}>
                  {dirname(f.path)}
                </span>
                <span className="bottom-panel-pending-stats">
                  <span className="bottom-panel-pending-stat-add">+{stats.added}</span>
                  <span className="bottom-panel-pending-stat-rem">-{stats.removed}</span>
                </span>
              </button>
              <button
                type="button"
                className="bottom-panel-pill-btn"
                onClick={() => rejectFile(f)}
                title="Rejeita só este arquivo"
              >
                Reject
              </button>
              <button
                type="button"
                className="bottom-panel-pill-btn bottom-panel-pending-accept"
                onClick={() => void acceptFile(f)}
                title="Aplica só este arquivo no disco"
              >
                Accept
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx === -1 ? p : p.slice(idx + 1);
}

function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx === -1 ? '' : p.slice(0, idx);
}

function formatProblemsForAgent(files: ProblemFile[]): string {
  const total = files.reduce((acc, f) => acc + f.errors.length, 0);
  const lines: string[] = [];
  lines.push(`Encontrei ${total} erro(s) TypeScript em ${files.length} arquivo(s). Pode corrigir?`);
  lines.push('');
  for (const f of files) {
    lines.push(`### ${f.path}`);
    for (const e of f.errors) {
      lines.push(`- [Ln ${e.line}, Col ${e.col}] ${e.code}: ${e.message}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Dispara mensagem pro chat do Agent. Em vez de chamar a API diretamente daqui
 * (precisaria de prop drilling de App-level), emitimos um CustomEvent.
 * App.tsx ou ChatPanel.tsx escuta e roteia.
 */
function dispatchAgentMessage(body: string): void {
  // App.tsx escuta esse event e espera detail como string direta.
  window.dispatchEvent(new CustomEvent('undrcod:send-to-agent', { detail: body }));
}

const MAX_RENDER_LINES = 1000;

function OutputTab() {
  const [channels, setChannels] = useState<string[]>(['Main process', 'Renderer', 'Tasks']);
  const [channel, setChannel] = useState<string>('Main process');
  const [buffers, setBuffers] = useState<Record<string, LogLine[]>>({
    'Main process': [],
    Renderer: [],
    Tasks: [],
  });
  const [filter, setFilter] = useState('');
  const [locked, setLocked] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Subscribe ao montar — pega buffer historico + stream
  useEffect(() => {
    let off: (() => void) | undefined;
    void window.undrcodAPI?.output.subscribe().then((res) => {
      setChannels(res.channels);
      setBuffers((prev) => ({ ...prev, ...res.buffer }));
    });
    off = window.undrcodAPI?.output.onLog((ch, line) => {
      setBuffers((prev) => {
        const cur = prev[ch] ?? [];
        const next = [...cur, line];
        if (next.length > MAX_RENDER_LINES) next.splice(0, next.length - MAX_RENDER_LINES);
        return { ...prev, [ch]: next };
      });
    });
    return () => { if (off) off(); };
  }, []);

  const currentLines = useMemo(() => {
    const all = buffers[channel] ?? [];
    if (!filter.trim()) return all;
    const q = filter.toLowerCase();
    return all.filter((l) => l.text.toLowerCase().includes(q));
  }, [buffers, channel, filter]);

  // Auto-scroll quando não locked
  useEffect(() => {
    if (locked) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [currentLines, locked]);

  const clearChannel = () => {
    setBuffers((prev) => ({ ...prev, [channel]: [] }));
  };

  return (
    <div className="bottom-panel-tab-body">
      <div className="bottom-panel-subtoolbar">
        <input
          type="search"
          className="bottom-panel-filter"
          placeholder="Filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
        />
        <select
          className="bottom-panel-select"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
        >
          {channels.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button
          type="button"
          className={`bottom-panel-btn ${locked ? 'is-active' : ''}`}
          title={locked ? 'Auto-scroll: travado' : 'Auto-scroll: ligado'}
          onClick={() => setLocked((v) => !v)}
        >
          <i className={`codicon codicon-${locked ? 'lock' : 'unlock'}`} />
        </button>
        <button
          type="button"
          className="bottom-panel-btn"
          title="Limpar canal"
          onClick={clearChannel}
        >
          <i className="codicon codicon-clear-all" />
        </button>
      </div>

      {currentLines.length === 0 ? (
        <div className="bottom-panel-empty">
          <i className="codicon codicon-output" />
          <span>Canal &quot;{channel}&quot; sem mensagens.</span>
          <span className="bottom-panel-empty-hint">
            {channel === 'Tasks'
              ? 'Tasks runner ainda não implementado — canal reservado.'
              : 'Aguardando logs.'}
          </span>
        </div>
      ) : (
        <div ref={scrollRef} className="bottom-panel-output-log">
          {currentLines.map((line, i) => (
            <div key={i} className={`bottom-panel-output-line bottom-panel-output-line--${line.level}`}>
              <span className="bottom-panel-output-time">{formatTime(line.timestamp)}</span>
              <span className="bottom-panel-output-level">{line.level}</span>
              <span className="bottom-panel-output-text">{line.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  } catch {
    return iso;
  }
}

function DebugConsoleTab() {
  const [input, setInput] = useState('');
  return (
    <div className="bottom-panel-tab-body">
      <div className="bottom-panel-subtoolbar">
        <input
          type="search"
          className="bottom-panel-filter"
          placeholder="Filter (e.g. text, !exclude, \\escape)"
          spellCheck={false}
        />
        <button type="button" className="bottom-panel-btn" title="Buscar">
          <i className="codicon codicon-search" />
        </button>
        <button type="button" className="bottom-panel-btn" title="Limpar">
          <i className="codicon codicon-clear-all" />
        </button>
      </div>
      <div className="bottom-panel-debug-console">
        <div className="bottom-panel-debug-line bottom-panel-debug-hint">
          <i className="codicon codicon-chevron-right" />
          <span className="bottom-panel-debug-placeholder">
            Inicie uma sessão de debug para avaliar expressoes
          </span>
        </div>
      </div>
      <div className="bottom-panel-debug-prompt">
        <i className="codicon codicon-chevron-right" />
        <input
          type="text"
          className="bottom-panel-debug-input"
          placeholder="Sem sessão de debug ativa"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled
        />
      </div>
    </div>
  );
}

function PortsTab() {
  const [ports, setPorts] = useState<PortEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardSeed, setForwardSeed] = useState<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.undrcodAPI?.ports.list();
      setPorts(list);
    } catch (err) {
      console.warn('[PortsTab] list falhou', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 5_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const open = (port: number) => {
    void window.undrcodAPI?.openExternal(`http://localhost:${port}`);
  };

  const openForward = (seed?: number) => {
    setForwardSeed(seed);
    setForwardOpen(true);
  };

  return (
    <>
      {ports.length === 0 ? (
        <div className="bottom-panel-empty bottom-panel-empty-with-action">
          <span>Nenhuma porta em LISTENING detectada.</span>
          <span className="bottom-panel-empty-hint">
            Scaneando localhost a cada 5s via {navigator.userAgent.includes('Windows') ? 'netstat' : 'lsof'}.
            Sobe um dev server (vite, next, etc) e ele aparece aqui.
          </span>
          <div className="bottom-panel-ports-actions">
            <button
              type="button"
              className="bottom-panel-action-btn bottom-panel-action-btn--secondary"
              onClick={refresh}
              disabled={loading}
            >
              <i className={`codicon codicon-${loading ? 'sync~spin' : 'refresh'}`} />
              <span>Atualizar</span>
            </button>
            <button
              type="button"
              className="bottom-panel-action-btn"
              onClick={() => openForward()}
              title="Encaminhar porta via SSH tunnel (localhost.run / ngrok)"
            >
              Encaminhar Porta
            </button>
          </div>
        </div>
      ) : (
        <div className="bottom-panel-tab-body">
          <div className="bottom-panel-subtoolbar">
            <span className="bottom-panel-ports-count">
              {ports.length} {ports.length === 1 ? 'porta' : 'portas'} em LISTENING
            </span>
            <div className="bottom-panel-tabbar-spacer" />
            <button
              type="button"
              className="bottom-panel-pill-btn"
              onClick={() => openForward(ports[0]?.port)}
              title="Encaminhar porta via SSH tunnel (localhost.run / ngrok)"
            >
              Encaminhar Porta
            </button>
            <button
              type="button"
              className="bottom-panel-btn"
              title="Atualizar agora"
              onClick={refresh}
              disabled={loading}
            >
              <i className={`codicon codicon-${loading ? 'sync~spin' : 'refresh'}`} />
            </button>
          </div>
          <div className="bottom-panel-ports-list">
            {ports.map((p) => (
              <button
                key={`${p.address}:${p.port}`}
                type="button"
                className="bottom-panel-port-row"
                onClick={() => open(p.port)}
                title={`Abrir http://localhost:${p.port}`}
              >
                <i className="codicon codicon-link-external" />
                <span className="bottom-panel-port-num">{p.port}</span>
                <span className="bottom-panel-port-addr">{p.address}</span>
                {p.process && <span className="bottom-panel-port-proc">{p.process}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {forwardOpen && (
        <ForwardPortDialog
          seedPort={forwardSeed}
          onClose={() => setForwardOpen(false)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────
// Encaminhar Porta — dialog inline (sem dependencia externa)
// ─────────────────────────────────────────────────────

interface ForwardPortDialogProps {
  seedPort?: number;
  onClose: () => void;
}

function ForwardPortDialog({ seedPort, onClose }: ForwardPortDialogProps) {
  const [port, setPort] = useState<string>(seedPort ? String(seedPort) : '3000');
  const [provider, setProvider] = useState<'localhost.run' | 'ngrok'>('localhost.run');

  const portNum = Number.parseInt(port, 10);
  const portValid = Number.isFinite(portNum) && portNum > 0 && portNum < 65536;

  const command = provider === 'localhost.run'
    ? `ssh -R 80:localhost:${portValid ? portNum : '<port>'} nokey@localhost.run`
    : `ngrok http ${portValid ? portNum : '<port>'}`;

  const submit = () => {
    if (!portValid) return;
    dispatchRunTask(command);
    onClose();
  };

  return (
    <div className="bottom-panel-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="bottom-panel-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Encaminhar Porta"
      >
        <div className="bottom-panel-modal-header">
          <i className="codicon codicon-radio-tower" />
          <span>Encaminhar Porta</span>
          <div className="bottom-panel-tabbar-spacer" />
          <button
            type="button"
            className="bottom-panel-btn"
            onClick={onClose}
            title="Fechar"
          >
            <i className="codicon codicon-close" />
          </button>
        </div>
        <div className="bottom-panel-modal-body">
          <label className="bottom-panel-modal-field">
            <span>Porta local</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="bottom-panel-filter"
              autoFocus
            />
          </label>
          <fieldset className="bottom-panel-modal-field">
            <legend>Provider</legend>
            <label className="bottom-panel-modal-radio">
              <input
                type="radio"
                name="forward-provider"
                checked={provider === 'localhost.run'}
                onChange={() => setProvider('localhost.run')}
              />
              <div>
                <strong>localhost.run</strong>
                <span className="bottom-panel-empty-hint">Gratuito, zero config (precisa OpenSSH instalado).</span>
              </div>
            </label>
            <label className="bottom-panel-modal-radio">
              <input
                type="radio"
                name="forward-provider"
                checked={provider === 'ngrok'}
                onChange={() => setProvider('ngrok')}
              />
              <div>
                <strong>ngrok</strong>
                <span className="bottom-panel-empty-hint">Precisa `ngrok` no PATH.</span>
              </div>
            </label>
          </fieldset>
          <div className="bottom-panel-modal-preview">
            <span className="bottom-panel-empty-hint">Comando que sera enviado pro terminal:</span>
            <code>{command}</code>
          </div>
        </div>
        <div className="bottom-panel-modal-footer">
          <button
            type="button"
            className="bottom-panel-action-btn bottom-panel-action-btn--secondary"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="bottom-panel-action-btn"
            onClick={submit}
            disabled={!portValid}
          >
            Enviar pro terminal
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Tasks — lista scripts do package.json e roda no terminal
// ─────────────────────────────────────────────────────

type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

interface PackageScripts {
  scripts: Record<string, string>;
  packageName?: string;
  pkgManager: PackageManager;
}

type TasksState =
  | { kind: 'loading' }
  | { kind: 'no-package' }
  | { kind: 'no-scripts'; packageName?: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: PackageScripts };

interface TasksTabProps {
  cwd: string;
}

/**
 * Monta o comando shell respeitando o package manager do projeto.
 * yarn classic invoca scripts sem 'run' (`yarn dev` em vez de `yarn run dev`),
 * mas `yarn run dev` tambem funciona — pulamos o 'run' pra ficar idiomatico.
 */
function buildRunCommand(pm: PackageManager, scriptName: string): string {
  if (pm === 'yarn') return `yarn ${scriptName}`;
  return `${pm} run ${scriptName}`;
}

/**
 * Detecta o package manager via lockfile no cwd. Ordem de prioridade:
 * bun → pnpm → yarn → npm (default).
 * Se mais de um lockfile existir (raro mas acontece em migrations), o
 * primeiro match na ordem acima vence.
 */
async function detectPackageManager(cwd: string, sep: string): Promise<PackageManager> {
  const base = cwd.endsWith(sep) ? cwd : `${cwd}${sep}`;
  const candidates: Array<{ pm: PackageManager; file: string }> = [
    { pm: 'bun',  file: 'bun.lockb' },
    { pm: 'pnpm', file: 'pnpm-lock.yaml' },
    { pm: 'yarn', file: 'yarn.lock' },
    { pm: 'npm',  file: 'package-lock.json' },
  ];
  const results = await Promise.all(
    candidates.map(({ file }) =>
      window.undrcodAPI?.fs.stat(`${base}${file}`).then(
        (s) => !('error' in s) && s.isFile,
        () => false,
      ),
    ),
  );
  for (let i = 0; i < candidates.length; i += 1) {
    if (results[i]) return candidates[i].pm;
  }
  return 'npm';
}

function TasksTab({ cwd }: TasksTabProps) {
  const [state, setState] = useState<TasksState>({ kind: 'loading' });

  const load = useCallback(async () => {
    if (!cwd) {
      setState({ kind: 'no-package' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      // Path separator agnostico — fs.readFile aceita / no Windows tambem.
      const sep = cwd.includes('\\') ? '\\' : '/';
      const path = `${cwd}${cwd.endsWith(sep) ? '' : sep}package.json`;
      const [res, pkgManager] = await Promise.all([
        window.undrcodAPI?.fs.readFile(path),
        detectPackageManager(cwd, sep),
      ]);
      if ('error' in res) {
        setState({ kind: 'no-package' });
        return;
      }
      let parsed: { scripts?: Record<string, string>; name?: string };
      try {
        parsed = JSON.parse(res.content) as { scripts?: Record<string, string>; name?: string };
      } catch (e) {
        setState({ kind: 'error', message: `package.json invalido: ${(e as Error).message}` });
        return;
      }
      const scripts = parsed.scripts ?? {};
      const entries = Object.entries(scripts).filter(
        ([, v]) => typeof v === 'string' && v.length > 0,
      );
      if (entries.length === 0) {
        setState({ kind: 'no-scripts', packageName: parsed.name });
        return;
      }
      setState({
        kind: 'ready',
        data: {
          scripts: Object.fromEntries(entries),
          packageName: parsed.name,
          pkgManager,
        },
      });
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message });
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const runScript = (name: string, pm: PackageManager) => {
    dispatchRunTask(buildRunCommand(pm, name));
  };

  return (
    <div className="bottom-panel-tab-body">
      <div className="bottom-panel-subtoolbar">
        <span className="bottom-panel-ports-count">
          {state.kind === 'ready'
            ? `${Object.keys(state.data.scripts).length} script(s)${state.data.packageName ? ` — ${state.data.packageName}` : ''}`
            : 'package.json scripts'}
        </span>
        {state.kind === 'ready' && (
          <span
            className="bottom-panel-task-pm-badge"
            title={`Lockfile detectado: usando ${state.data.pkgManager}`}
          >
            via {state.data.pkgManager}
          </span>
        )}
        <div className="bottom-panel-tabbar-spacer" />
        <button
          type="button"
          className="bottom-panel-btn"
          title="Re-ler package.json"
          onClick={() => void load()}
          disabled={state.kind === 'loading'}
        >
          <i className={`codicon codicon-${state.kind === 'loading' ? 'sync~spin' : 'refresh'}`} />
        </button>
      </div>

      {state.kind === 'loading' && (
        <div className="bottom-panel-empty">
          <i className="codicon codicon-sync codicon-modifier-spin" />
          <span>Lendo package.json...</span>
        </div>
      )}

      {state.kind === 'no-package' && (
        <div className="bottom-panel-empty">
          <i className="codicon codicon-package" />
          <span>Nenhum package.json no workspace</span>
          <span className="bottom-panel-empty-hint">
            Abra um projeto Node/npm pra ver os scripts disponiveis.
          </span>
        </div>
      )}

      {state.kind === 'no-scripts' && (
        <div className="bottom-panel-empty">
          <i className="codicon codicon-package" />
          <span>Nenhum script definido em package.json</span>
          {state.packageName && (
            <span className="bottom-panel-empty-hint">{state.packageName}</span>
          )}
        </div>
      )}

      {state.kind === 'error' && (
        <div className="bottom-panel-empty">
          <i className="codicon codicon-error" />
          <span>Falha ao ler package.json</span>
          <span className="bottom-panel-empty-hint">{state.message}</span>
        </div>
      )}

      {state.kind === 'ready' && (
        <div className="bottom-panel-tasks-list">
          {Object.entries(state.data.scripts).map(([name, cmd]) => {
            const runCmd = buildRunCommand(state.data.pkgManager, name);
            return (
              <div key={name} className="bottom-panel-task-row">
                <button
                  type="button"
                  className="bottom-panel-task-play"
                  title={runCmd}
                  onClick={() => runScript(name, state.data.pkgManager)}
                >
                  <i className="codicon codicon-play" />
                </button>
                <div className="bottom-panel-task-info">
                  <span className="bottom-panel-task-name">{name}</span>
                  <span className="bottom-panel-task-cmd" title={cmd}>{cmd}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Dispara comando pro terminal do BottomPanel. BottomPanel escuta esse event,
 * faz switch pra tab Terminal e chama runCommand() no TerminalView via ref.
 */
function dispatchRunTask(command: string): void {
  window.dispatchEvent(new CustomEvent('undrcod:run-task', { detail: { script: command } }));
}

// ─────────────────────────────────────────────────────
// TODOs tab — aggregator de TODO/FIXME/HACK/XXX no workspace
// ─────────────────────────────────────────────────────

interface TodoMatch {
  path: string;
  relPath: string;
  line: number;
  text: string;
  matchStart: number;
  matchEnd: number;
}

interface TodoFileGroup {
  path: string;
  relPath: string;
  matches: TodoMatch[];
}

const TODO_TAG_REGEX = /\b(TODO|FIXME|HACK|XXX)\b/g;

interface TodosTabProps {
  cwd: string;
}

function TodosTab({ cwd }: TodosTabProps) {
  const [matches, setMatches] = useState<TodoMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!cwd) {
      setMatches([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // grepContent retorna match por linha, mas pra robustez filtramos no
      // cliente exigindo a tag como palavra inteira (regex \b...\b).
      const res = await window.undrcodAPI?.fs.grepContent(cwd, 'TODO|FIXME|HACK|XXX');
      const arr = Array.isArray(res) ? res : [];
      const filtered = arr.filter((m) => /\b(TODO|FIXME|HACK|XXX)\b/.test(m.text));
      setMatches(filtered);
    } catch (err) {
      setError((err as Error).message);
      console.warn('[TodosTab] grepContent falhou', err);
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const grouped = useMemo<TodoFileGroup[]>(() => {
    const byPath = new Map<string, TodoFileGroup>();
    for (const m of matches) {
      const g = byPath.get(m.path);
      if (g) {
        g.matches.push(m);
      } else {
        byPath.set(m.path, { path: m.path, relPath: m.relPath, matches: [m] });
      }
    }
    const out = Array.from(byPath.values());
    out.sort((a, b) => a.relPath.localeCompare(b.relPath));
    for (const g of out) g.matches.sort((a, b) => a.line - b.line);
    return out;
  }, [matches]);

  const total = matches.length;

  const openMatch = (m: TodoMatch) => {
    // undrcod:goto-line é o event certo pra abrir arquivo + navegar pra linha.
    // undrcod:open-file aceita só string e perderia o número da linha.
    window.dispatchEvent(
      new CustomEvent('undrcod:goto-line', { detail: { path: m.path, line: m.line } }),
    );
  };

  return (
    <div className="bottom-panel-tab-body">
      <div className="bottom-panel-subtoolbar">
        <span className="bottom-panel-ports-count">
          {total === 0
            ? 'TODO / FIXME / HACK / XXX'
            : `${total} ${total === 1 ? 'ocorrência' : 'ocorrências'} em ${grouped.length} arquivo(s)`}
        </span>
        <div className="bottom-panel-tabbar-spacer" />
        <button
          type="button"
          className="bottom-panel-btn"
          title="Re-escanear workspace"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <i className={`codicon codicon-${loading ? 'sync~spin' : 'refresh'}`} />
        </button>
      </div>

      {loading && grouped.length === 0 && (
        <div className="bottom-panel-empty">
          <i className="codicon codicon-sync codicon-modifier-spin" />
          <span>Escaneando workspace...</span>
        </div>
      )}

      {!loading && error && (
        <div className="bottom-panel-empty">
          <i className="codicon codicon-error" />
          <span>Falha ao escanear</span>
          <span className="bottom-panel-empty-hint">{error}</span>
        </div>
      )}

      {!loading && !error && grouped.length === 0 && (
        <div className="bottom-panel-empty">
          <i className="codicon codicon-checklist" />
          <span>Nenhum TODO/FIXME encontrado no workspace</span>
          <span className="bottom-panel-empty-hint">
            Busca por TODO, FIXME, HACK e XXX em todos os arquivos do cwd.
          </span>
        </div>
      )}

      {grouped.length > 0 && (
        <div className="bottom-panel-todos-list">
          {grouped.map((g) => (
            <div key={g.path} className="bottom-panel-todo-file">
              <div className="bottom-panel-todo-file-header">
                <i className="codicon codicon-symbol-file" />
                <span className="bottom-panel-todo-file-name" title={g.path}>
                  {basename(g.path)}
                </span>
                <span className="bottom-panel-todo-file-count">{g.matches.length}</span>
                <span className="bottom-panel-todo-file-dim">{dirname(g.relPath)}</span>
              </div>
              <ul className="bottom-panel-todo-matches">
                {g.matches.map((m, i) => (
                  <li key={`${m.path}:${m.line}:${i}`}>
                    <button
                      type="button"
                      className="bottom-panel-todo-match"
                      onClick={() => openMatch(m)}
                      title={`Abrir ${m.relPath}:${m.line}`}
                    >
                      <span className="bottom-panel-todo-line">{m.line}</span>
                      <span className="bottom-panel-todo-text">
                        {renderTodoText(m.text)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Renderiza a linha com TODO/FIXME/HACK/XXX em destaque.
 * Retorna fragments de span — keyed pra React.
 */
function renderTodoText(text: string): JSX.Element[] {
  const trimmed = text.replace(/^\s+/, '').replace(/\s+$/, '');
  const out: JSX.Element[] = [];
  let lastIdx = 0;
  let key = 0;
  // Reset regex state — TODO_TAG_REGEX é /g, mantém lastIndex entre execs.
  TODO_TAG_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null = TODO_TAG_REGEX.exec(trimmed);
  while (m !== null) {
    if (m.index > lastIdx) {
      out.push(<span key={key++}>{trimmed.slice(lastIdx, m.index)}</span>);
    }
    out.push(
      <span
        key={key++}
        className={`bottom-panel-todo-tag bottom-panel-todo-tag--${m[1].toLowerCase()}`}
      >
        {m[1]}
      </span>,
    );
    lastIdx = m.index + m[1].length;
    m = TODO_TAG_REGEX.exec(trimmed);
  }
  if (lastIdx < trimmed.length) {
    out.push(<span key={key++}>{trimmed.slice(lastIdx)}</span>);
  }
  return out;
}
