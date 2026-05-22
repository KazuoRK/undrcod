import { useState, useCallback } from 'react';
import type { PlanStep } from '../../utils/planParser';
import './PlanPanel.css';

/**
 * PlanPanel — card destacado que mostra os steps parseados de uma resposta em
 * plan mode. Renderizado INLINE no transcript no lugar da bubble assistant
 * quando ChatView detecta >= 3 steps.
 *
 * Toggle de checkboxes é PURAMENTE local (não afeta o CLI, não dispara nada
 * exceto feedback visual). Os 2 botões resolvem a intenção:
 *   - Editar plano   → onEdit (volta pro composer, ChatView decide se faz algo)
 *   - Executar plano → onExecute (ChatView muda permissionMode pra acceptEdits
 *                      e re-envia prompt "Execute o plano acima")
 */
export interface PlanPanelProps {
  steps: PlanStep[];
  onExecute: () => void;
  onEdit: () => void;
}

export function PlanPanel({ steps: initialSteps, onExecute, onEdit }: PlanPanelProps) {
  const [steps, setSteps] = useState<PlanStep[]>(initialSteps);

  const toggle = useCallback((idx: number) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, checked: !s.checked } : s))
    );
  }, []);

  const doneCount = steps.filter((s) => s.checked).length;

  return (
    <div className="plan-panel" role="region" aria-label="Plano proposto">
      <div className="plan-panel-header">
        <i className="codicon codicon-checklist plan-panel-icon" aria-hidden="true" />
        <span className="plan-panel-title">Plano proposto</span>
        <span className="plan-panel-count">
          {doneCount}/{steps.length}
        </span>
      </div>

      <ul className="plan-panel-list">
        {steps.map((step, idx) => (
          <li key={idx} className={`plan-panel-step ${step.checked ? 'is-checked' : ''}`}>
            <label className="plan-panel-step-label">
              <input
                type="checkbox"
                className="plan-panel-checkbox"
                checked={step.checked}
                onChange={() => toggle(idx)}
                aria-label={`Step ${idx + 1}: ${step.text}`}
              />
              <span className="plan-panel-step-text">{step.text}</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="plan-panel-actions">
        <button
          type="button"
          className="plan-panel-btn plan-panel-btn-secondary"
          onClick={onEdit}
        >
          <i className="codicon codicon-edit" aria-hidden="true" />
          Editar plano
        </button>
        <button
          type="button"
          className="plan-panel-btn plan-panel-btn-primary"
          onClick={onExecute}
        >
          <i className="codicon codicon-play" aria-hidden="true" />
          Executar plano
        </button>
      </div>
    </div>
  );
}
