import { useEffect, useRef } from 'react';
import './TodoChecklist.css';

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  content: string;
  activeForm: string;
  status: TodoStatus;
}

interface TodoChecklistProps {
  todos: TodoItem[];
}

/**
 * Renderiza o input do tool TodoWrite como checklist visual.
 * - Cada linha usa `key = content` pra que React reutilize o DOM quando o
 *   status muda (pending → in_progress → completed) e a transição CSS suave
 *   aconteça em vez de unmount/remount.
 * - Quando um item vira `completed`, dispara um pulso de flash via data-attr
 *   `data-flash` (ativado por 1 frame, removido em 600ms).
 */
export function TodoChecklist({ todos }: TodoChecklistProps) {
  // Mapa status anterior por content — usado pra detectar
  // transicao in_progress → completed e disparar flash.
  const prevStatusRef = useRef<Map<string, TodoStatus>>(new Map());
  // Mapa de timeouts ativos pra limpar no unmount.
  const timeoutsRef = useRef<Map<string, number>>(new Map());
  // Ref do container pra encontrar as rows e marcar data-flash.
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const prev = prevStatusRef.current;
    const list = listRef.current;
    if (!list) return;

    for (const todo of todos) {
      const before = prev.get(todo.content);
      if (before === 'in_progress' && todo.status === 'completed') {
        const row = list.querySelector<HTMLLIElement>(
          `[data-todo-key="${cssEscape(todo.content)}"]`
        );
        if (row) {
          // Reativa a animação: limpa, força reflow, religa.
          row.removeAttribute('data-flash');
          void row.offsetWidth;
          row.setAttribute('data-flash', 'on');
          // Limpa timeout anterior pra esse item, se houver
          const old = timeoutsRef.current.get(todo.content);
          if (old) window.clearTimeout(old);
          const t = window.setTimeout(() => {
            row.removeAttribute('data-flash');
            timeoutsRef.current.delete(todo.content);
          }, 650);
          timeoutsRef.current.set(todo.content, t);
        }
      }
      prev.set(todo.content, todo.status);
    }

    // Limpa entradas pra items que sumiram do plano
    const liveKeys = new Set(todos.map((t) => t.content));
    for (const key of Array.from(prev.keys())) {
      if (!liveKeys.has(key)) prev.delete(key);
    }
  }, [todos]);

  // Cleanup completo no unmount
  useEffect(() => {
    return () => {
      for (const t of timeoutsRef.current.values()) {
        window.clearTimeout(t);
      }
      timeoutsRef.current.clear();
    };
  }, []);

  const total = todos.length;
  const completed = todos.filter((t) => t.status === 'completed').length;
  const hasInProgress = todos.some((t) => t.status === 'in_progress');
  const progressPct = total > 0 ? (completed / total) * 100 : 0;

  if (total === 0) {
    return (
      <div className="todo-checklist todo-checklist-empty">
        <div className="todo-checklist-header">
          <span className="todo-checklist-label">PLANO</span>
        </div>
        <div className="todo-checklist-empty-msg">Plano sem tarefas</div>
      </div>
    );
  }

  return (
    <div className="todo-checklist" role="group" aria-label="Plano de tarefas">
      <div className="todo-checklist-header">
        <span className="todo-checklist-label">PLANO</span>
        <span className="todo-checklist-counter" aria-live="polite">
          <strong>{completed}</strong> de {total}
        </span>
      </div>
      <ul className="todo-checklist-list" ref={listRef}>
        {todos.map((todo) => (
          <TodoRow key={todo.content} todo={todo} />
        ))}
      </ul>
      {hasInProgress && (
        <div className="todo-checklist-progress" aria-hidden="true">
          <div
            className="todo-checklist-progress-fill"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function TodoRow({ todo }: { todo: TodoItem }) {
  const { content, activeForm, status } = todo;
  const label = status === 'in_progress' ? activeForm : content;
  const iconClass =
    status === 'pending'
      ? 'codicon-circle-large-outline'
      : status === 'in_progress'
        ? 'codicon-loading codicon-modifier-spin'
        : 'codicon-pass-filled';

  return (
    <li
      className={`todo-row todo-row-${status}`}
      data-todo-key={content}
      aria-checked={status === 'completed'}
      role="checkbox"
    >
      <span className="todo-row-icon" aria-hidden="true">
        <i className={`codicon ${iconClass}`} />
      </span>
      <span className="todo-row-label">{label}</span>
    </li>
  );
}

/**
 * Escapa caracteres especiais pra usar `content` em querySelector. Implementa
 * o subset que importa pra strings imperativas vindas do TodoWrite (".", "\"",
 * "'", "[", "]", "\\"). Para casos arbitrários usaria CSS.escape, mas Electron
 * já tem suporte global — usamos quando disponível.
 */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/[\\"'\][().,*+?^${}|]/g, '\\$&');
}
