/**
 * RightPane — painel lateral direito com tabs Antigravity-style.
 * Tabs: Ver previa | Diff | Terminal | Arquivos | Tarefas | Plano.
 *
 * Dados:
 *   - Tarefas / Terminal: derivados dos tool_use events do CLI (via sessionInfo)
 *   - Arquivos: lista de workspaces recentes (electron-store, ou fallback aos abertos na sessão)
 *   - Ver previa / Diff / Plano: empty states (precisam de infra adicional pra serem reais)
 */

import { useEffect, useState } from 'react';
import type { AgentTask, BashLogEntry } from '../StatusBar/StatusBar';
import { TerminalView } from '../TerminalView/TerminalView';
import { WorkspacesPanel } from '../WorkspacesPanel/WorkspacesPanel';
import './RightPane.css';

export type RightTabId =
  // Central tabs (pane-mid):
  | 'preview' | 'diff' | 'files' | 'tasks' | 'plan'
  // Bottom Panel tabs (5 fixas estilo VS Code):
  | 'problems' | 'output' | 'debug-console' | 'terminal' | 'ports';

export interface RightTab {
  id: RightTabId;
  title: string;
  icon: string;
}

interface RightPaneProps {
  tabs: RightTab[];
  activeTabId: RightTabId | null;
  onTabSelect: (id: RightTabId) => void;
  onTabClose: (id: RightTabId) => void;
  onPaneClose: () => void;
  /** Tarefas reais (tool_use events) — pode ser undefined antes do primeiro turn */
  tasks?: AgentTask[];
  /** Bash log real */
  bashLog?: BashLogEntry[];
  /** Workspace atual — pra Arquivos saber qual destacar como atual */
  cwd?: string;
  /** Resume uma sessão antiga (path + sessionId do Claude CLI) */
  onResumeSession?: (path: string, sessionId: string) => void;
  /** Spawn sessão fresh num workspace */
  onNewConversation?: (path: string) => void;
  /** Toggle maximize/restore do bottom panel */
  onToggleMaximize?: () => void;
  /** Panel maximizado? */
  isMaximized?: boolean;
}

export function RightPane({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onPaneClose,
  tasks,
  bashLog,
  cwd,
  onResumeSession,
  onNewConversation,
  onToggleMaximize,
  isMaximized,
}: RightPaneProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="right-pane">
      <div className="right-pane-tabbar">
        {tabs.map((t) => {
          const isActive = t.id === activeTabId;
          return (
            <div
              key={t.id}
              className={`right-pane-tab ${isActive ? 'is-active' : ''}`}
              onClick={() => onTabSelect(t.id)}
            >
              <i className={`codicon codicon-${t.icon} right-pane-tab-icon`} />
              <span className="right-pane-tab-title">{t.title}</span>
              <button
                type="button"
                className="right-pane-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(t.id);
                }}
                title="Fechar"
              >
                <i className="codicon codicon-close" />
              </button>
            </div>
          );
        })}
        <div className="right-pane-tabbar-spacer" />
        <button
          type="button"
          className="right-pane-pane-close"
          onClick={onPaneClose}
          title="Fechar painel"
        >
          <i className="codicon codicon-chevron-right" />
        </button>
      </div>

      <div className="right-pane-content">
        {activeTabId === 'preview' && <PreviewTabContent />}
        {activeTabId === 'diff' && <DiffTabContent />}
        {/* Terminal não aparece mais aqui — agora vive exclusivamente no BottomPanel */}
        {activeTabId === 'files' && (
          <WorkspacesPanel
            cwd={cwd}
            onResumeSession={(p, sid) => onResumeSession?.(p, sid)}
            onNewConversation={(p) => onNewConversation?.(p)}
          />
        )}
        {activeTabId === 'tasks' && <TasksTabContent tasks={tasks} />}
        {activeTabId === 'plan' && <PlanTabContent />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Tab contents
// ─────────────────────────────────────────────────────

function FilesTabContent({ cwd }: { cwd?: string }) {
  // Workspaces recentes — vem do localStorage por enquanto.
  // Adiciona o atual cada vez que muda.
  const [recents, setRecents] = useState<string[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('undrcode.recentWorkspaces');
      const list = stored ? (JSON.parse(stored) as string[]) : [];
      if (cwd && !list.includes(cwd)) {
        list.unshift(cwd);
        const trimmed = list.slice(0, 15);
        localStorage.setItem('undrcode.recentWorkspaces', JSON.stringify(trimmed));
        setRecents(trimmed);
      } else {
        // Mover atual pro topo
        if (cwd) {
          const reordered = [cwd, ...list.filter((p) => p !== cwd)];
          localStorage.setItem('undrcode.recentWorkspaces', JSON.stringify(reordered));
          setRecents(reordered);
        } else {
          setRecents(list);
        }
      }
    } catch {
      setRecents(cwd ? [cwd] : []);
    }
  }, [cwd]);

  const filtered = filter
    ? recents.filter((p) => p.toLowerCase().includes(filter.toLowerCase()))
    : recents;

  const openWorkspace = async () => {
    const result = await window.undrcodAPI?.dialog.openWorkspace();
    if (!result.canceled) {
      // Vai disparar reload via App (que escuta o resultado do dialog)
      window.location.reload();
    }
  };

  if (recents.length === 0) {
    return (
      <div className="right-pane-tab-body right-pane-empty">
        <i className="codicon codicon-folder-opened right-pane-empty-icon" />
        <div className="right-pane-empty-title">Sem workspaces recentes.</div>
        <button type="button" className="right-pane-empty-btn" onClick={openWorkspace}>
          Abrir workspace
        </button>
      </div>
    );
  }

  return (
    <div className="right-pane-tab-body">
      <div className="right-pane-search">
        <i className="codicon codicon-search" />
        <input
          type="search"
          placeholder="Filtrar workspaces..."
          className="right-pane-search-input"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <ul className="right-pane-list">
        {filtered.map((path) => {
          const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
          const isCurrent = path === cwd;
          return (
            <li
              key={path}
              className={`right-pane-list-item ${isCurrent ? 'is-current' : ''}`}
              title={path}
            >
              <i className="codicon codicon-folder" />
              <span>{name}</span>
              {isCurrent && <span className="right-pane-list-badge">atual</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PlanTabContent() {
  return (
    <div className="right-pane-tab-body right-pane-empty">
      <i className="codicon codicon-list-ordered right-pane-empty-icon" />
      <div className="right-pane-empty-title">Nenhum plano ainda.</div>
      <div className="right-pane-empty-hint">
        Claude escreve o plano aqui enquanto explora. Continue conversando.
      </div>
    </div>
  );
}

function PreviewTabContent() {
  return (
    <div className="right-pane-tab-body right-pane-empty">
      <i className="codicon codicon-globe right-pane-empty-icon" />
      <div className="right-pane-empty-title">Sem servidor configurado.</div>
      <div className="right-pane-empty-hint">
        Precisa de configuração de dev server (porta + reload) — ainda não implementado.
      </div>
    </div>
  );
}

function DiffTabContent() {
  return (
    <div className="right-pane-tab-body right-pane-empty">
      <i className="codicon codicon-diff right-pane-empty-icon" />
      <div className="right-pane-empty-title">Nenhuma alteracao para mostrar.</div>
      <div className="right-pane-empty-hint">
        Precisa de git integration para comparar diff entre versões — ainda não implementado.
      </div>
    </div>
  );
}

function TasksTabContent({ tasks }: { tasks?: AgentTask[] }) {
  if (!tasks || tasks.length === 0) {
    return (
      <div className="right-pane-tab-body right-pane-empty">
        <i className="codicon codicon-tasklist right-pane-empty-icon" />
        <div className="right-pane-empty-title">Sem tarefas ainda.</div>
        <div className="right-pane-empty-hint">
          Cada tool executado pelo Claude vira uma tarefa aqui.
        </div>
      </div>
    );
  }

  const running = tasks.filter((t) => t.status === 'running');
  const done = tasks.filter((t) => t.status !== 'running');

  return (
    <div className="right-pane-tab-body">
      {running.length > 0 && (
        <>
          <div className="right-pane-section-title">Em execucao</div>
          <ul className="right-pane-list">
            {running.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        </>
      )}
      {done.length > 0 && (
        <>
          <div className="right-pane-section-title">Concluido</div>
          <ul className="right-pane-list">
            {done.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TaskRow({ task }: { task: AgentTask }) {
  const icon =
    task.status === 'running' ? 'sync~spin'
    : task.status === 'failed' ? 'error'
    : 'check';
  const statusLabel =
    task.status === 'running' ? 'Em execucao'
    : task.status === 'failed' ? 'Falhou'
    : 'Concluido';
  return (
    <li className="right-pane-task">
      <i className={`codicon codicon-${icon} right-pane-task-status ${task.status === 'failed' ? 'is-error' : ''}`} />
      <div className="right-pane-task-body">
        <div className="right-pane-task-title" title={task.description}>
          {task.description || task.name}
        </div>
        <div className="right-pane-task-meta">{task.name} · {statusLabel}</div>
      </div>
      <i className="codicon codicon-chevron-right right-pane-task-chevron" />
    </li>
  );
}
