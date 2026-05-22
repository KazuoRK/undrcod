/**
 * PermissionCard — gate de aprovação inline pra tool calls.
 *
 * Treat each permission request as a *system call signature* the user is being
 * asked to sign off on. The tool name reads as a function call (`Bash()`), the
 * target reads as the actual argument that will execute. Three actions:
 *   • Negar           (descartar)
 *   • Sempre <Tool>   (whitelist a tool inteira)
 *   • Permitir        (one-shot, primary, atalho Ctrl+Enter)
 *
 * Risk classes mudam SÓ a tonalidade do tile do glyph + borda — sem teatro:
 *   • low  → Read/Grep/Glob/WebSearch — accent neutro
 *   • mid  → WebFetch/Task             — accent
 *   • high → Bash/Write/Edit/PowerShell — orange (heads-up: side effect real)
 */

import { useEffect, useMemo, useState } from 'react';
import './PermissionCard.css';

export interface PermissionCardProps {
  toolName: string;
  summary: string;
  iconCodicon: string;
  onAllow: () => void;
  onDeny: () => void;
  onAllowAlways: () => void;
}

type Decision = null | 'allow' | 'deny' | 'always';
type Risk = 'low' | 'mid' | 'high';

/** Classifica a tool por raio de impacto. Define só a cor do glyph + borda. */
function riskFor(toolName: string): Risk {
  const t = toolName.toLowerCase();
  if (t === 'bash' || t === 'powershell' || t === 'write' || t === 'edit' || t === 'multiedit') {
    return 'high';
  }
  if (t === 'webfetch' || t === 'task') return 'mid';
  return 'low';
}

/** Prefixo do bloco-alvo. "$ " pra shell, "›" pra file ops, "↗" pra rede, "?" pra query. */
function targetPrefix(toolName: string): string {
  const t = toolName.toLowerCase();
  if (t === 'bash' || t === 'powershell') return '$';
  if (t === 'webfetch' || t === 'websearch') return '↗';
  if (t === 'grep' || t === 'glob') return '?';
  return '›';
}

/** Curto descritor da ação no header — verbo único, sem prosa. */
function actionVerb(toolName: string): string {
  const t = toolName.toLowerCase();
  if (t === 'write') return 'criar arquivo';
  if (t === 'edit' || t === 'multiedit') return 'editar arquivo';
  if (t === 'read') return 'ler arquivo';
  if (t === 'bash' || t === 'powershell') return 'rodar comando';
  if (t === 'grep') return 'pesquisar conteúdo';
  if (t === 'glob') return 'buscar arquivos';
  if (t === 'webfetch') return 'buscar URL';
  if (t === 'websearch') return 'pesquisar na web';
  if (t === 'task') return 'executar tarefa';
  return 'usar tool';
}

/** Render do nome da tool: capitaliza inicial mas preserva camelCase (MultiEdit). */
function displayToolName(toolName: string): string {
  if (!toolName) return '';
  return toolName.charAt(0).toUpperCase() + toolName.slice(1);
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
const MOD_LABEL = isMac ? '⌘' : 'Ctrl';

export function PermissionCard({
  toolName,
  summary,
  iconCodicon,
  onAllow,
  onDeny,
  onAllowAlways,
}: PermissionCardProps) {
  const [decision, setDecision] = useState<Decision>(null);
  const risk = useMemo(() => riskFor(toolName), [toolName]);
  const prefix = useMemo(() => targetPrefix(toolName), [toolName]);
  const verb = useMemo(() => actionVerb(toolName), [toolName]);
  const display = useMemo(() => displayToolName(toolName), [toolName]);

  const handle = (d: Exclude<Decision, null>, fn: () => void): void => {
    if (decision) return;
    setDecision(d);
    fn();
  };

  useEffect(() => {
    if (decision) return;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handle('allow', onAllow);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision]);

  return (
    <div
      className="perm-card"
      data-state={decision ?? 'pending'}
      data-risk={risk}
      role="group"
      aria-label={`Permitir que Claude ${verb}?`}
    >
      {/* Header: glyph tile + função(args) + kbd hint flutuante */}
      <header className="perm-card-head">
        <div className="perm-card-glyph" aria-hidden="true">
          <i className={`codicon codicon-${iconCodicon}`} />
          <span className="perm-card-glyph-pulse" />
        </div>

        <div className="perm-card-titleblock">
          <div className="perm-card-call">
            <span className="perm-card-tool">{display}</span>
            <span className="perm-card-paren">()</span>
            <span className="perm-card-sep" aria-hidden="true">·</span>
            <span className="perm-card-verb">{verb}</span>
          </div>
          <div className="perm-card-sub">
            {decision === null && 'pede permissão pra prosseguir'}
            {decision === 'allow' && 'permitido uma vez'}
            {decision === 'always' && `${display} sempre permitido`}
            {decision === 'deny' && 'negado'}
          </div>
        </div>

        <div className="perm-card-kbd" aria-hidden="true" title={`${MOD_LABEL}+Enter`}>
          <kbd>{MOD_LABEL}</kbd>
          <kbd>↵</kbd>
        </div>
      </header>

      {/* Target: argumento real que vai ser executado (path, command, URL, etc) */}
      {summary && (
        <div className="perm-card-target" title={summary}>
          <span className="perm-card-target-prefix" aria-hidden="true">{prefix}</span>
          <span className="perm-card-target-body">{summary}</span>
        </div>
      )}

      {/* Actions: deny ⟵ always ⟵ primary (right-anchored, primário no fim) */}
      <div className="perm-card-actions">
        <button
          type="button"
          className="perm-action perm-action-deny"
          onClick={() => handle('deny', onDeny)}
          disabled={!!decision}
        >
          Negar
        </button>

        <div className="perm-card-actions-spacer" aria-hidden="true" />

        <button
          type="button"
          className="perm-action perm-action-always"
          onClick={() => handle('always', onAllowAlways)}
          disabled={!!decision}
          title={`Não pede mais permissão pra ${display}() nesta sessão`}
        >
          Sempre {display}
        </button>

        <button
          type="button"
          className="perm-action perm-action-primary"
          onClick={() => handle('allow', onAllow)}
          disabled={!!decision}
          autoFocus
        >
          <span>Permitir</span>
          <i className="codicon codicon-arrow-right perm-action-arrow" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
