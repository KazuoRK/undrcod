/**
 * planParser — extrai steps de uma resposta do assistant gerada em plan mode.
 *
 * Reconhece três formatos comuns nos primeiros ~10 itens encontrados:
 *   - Markdown task list:   `- [ ] passo` ou `- [x] passo concluído`
 *   - Bullet list:          `- passo`, `* passo`, `+ passo`
 *   - Numbered list:        `1. passo`, `2) passo`, `3- passo`
 *
 * Mantém só linhas top-level (sem indent mínimo) e ignora linhas vazias.
 * O caller decide se há plano suficiente (heurística atual: >= 3 steps).
 */
export interface PlanStep {
  text: string;
  /** Se a linha veio com `[x]`, marca como já feito. Default false. */
  checked: boolean;
}

const TASK_LIST_RE = /^\s*[-*+]\s*\[(\s|x|X)\]\s+(.+?)\s*$/;
const BULLET_RE = /^\s*[-*+]\s+(.+?)\s*$/;
const NUMBERED_RE = /^\s*\d+[.)\-]\s+(.+?)\s*$/;

const MAX_STEPS = 10;

export function parsePlanSteps(text: string): PlanStep[] {
  if (!text) return [];

  const lines = text.split(/\r?\n/);
  const steps: PlanStep[] = [];

  for (const rawLine of lines) {
    if (steps.length >= MAX_STEPS) break;
    const line = rawLine.replace(/\t/g, '  ');
    if (!line.trim()) continue;

    // Ignora linhas claramente indentadas (sub-items) — pega só top-level.
    const leadingSpaces = line.length - line.trimStart().length;
    if (leadingSpaces > 3) continue;

    let m = line.match(TASK_LIST_RE);
    if (m) {
      const checked = m[1].toLowerCase() === 'x';
      const stepText = stripMarkdown(m[2]);
      if (stepText) steps.push({ text: stepText, checked });
      continue;
    }

    m = line.match(BULLET_RE);
    if (m) {
      const stepText = stripMarkdown(m[1]);
      if (stepText) steps.push({ text: stepText, checked: false });
      continue;
    }

    m = line.match(NUMBERED_RE);
    if (m) {
      const stepText = stripMarkdown(m[1]);
      if (stepText) steps.push({ text: stepText, checked: false });
      continue;
    }
  }

  return steps;
}

/** Remove `**bold**`, `*italic*` e backticks de inline code pra leitura clean no panel. */
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .trim();
}
