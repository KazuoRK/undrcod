/**
 * ToolCard — card rico colapsável pra renderizar chamadas de ferramenta
 * (Read, Bash, Edit, Grep, Glob, Task, WebFetch, etc) dentro do ChatView.
 *
 * Substitui o bloco genérico antigo (.msg-tool) por um card com identidade
 * visual mais forte: header com ícone tintado em accent, summary inline,
 * status pill (running/ok/erro), body expansível com Input/Saída formatados
 * + syntax highlight via Prism e botão copy.
 *
 * TodoWrite é tratado em outro componente (TodoChecklist), via outro kind
 * (todo_checklist) no ChatItem union — NÃO entra aqui.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { highlight } from '../../utils/prismSetup';
import { EditToolDiff, type DiffHunk } from './EditToolDiff';
import './ToolCard.css';

export interface ToolCardProps {
  name: string;
  input?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  /** True enquanto a tool ainda está executando (sem result). */
  isRunning?: boolean;
  /** Resumo de 1 linha do input — fornecido por summarizeToolInput() do ChatView. */
  summary: string;
  /** Estado inicial expandido/colapsado (default false = colapsado). */
  defaultExpanded?: boolean;
}

/** Mapa de nome de tool → codicon expressivo. */
function iconFor(name: string): string {
  const n = name.toLowerCase();
  if (n === 'read') return 'file-text';
  if (n === 'write') return 'new-file';
  if (n === 'edit' || n === 'multiedit') return 'edit';
  if (n === 'bash') return 'terminal';
  if (n === 'powershell') return 'terminal-powershell';
  if (n === 'grep') return 'search';
  if (n === 'glob') return 'list-tree';
  if (n === 'task' || n === 'agent') return 'rocket';
  if (n === 'webfetch') return 'globe';
  if (n === 'websearch') return 'search-fuzzy';
  if (n === 'notebookedit' || n === 'notebookread') return 'notebook';
  // Fallbacks por família de nome (MCP tools etc)
  if (n.includes('bash') || n.includes('shell')) return 'terminal';
  if (n.includes('read') || n.includes('view')) return 'file-text';
  if (n.includes('write') || n.includes('create')) return 'new-file';
  if (n.includes('edit') || n.includes('replace')) return 'edit';
  if (n.includes('search') || n.includes('grep') || n.includes('find')) return 'search';
  if (n.includes('list') || n.includes('glob')) return 'list-tree';
  if (n.includes('delete') || n.includes('remove')) return 'trash';
  if (n.includes('browser') || n.includes('web') || n.includes('fetch')) return 'globe';
  if (n.includes('mcp')) return 'plug';
  return 'tools';
}

/** Tools que preferem summary em monospace (shell, regex). */
function isMonoSummary(name: string): boolean {
  const n = name.toLowerCase();
  return n === 'bash' || n === 'powershell' || n.includes('grep');
}

/** Tools que tipicamente recebem prompt de shell ($ prefix). */
function shellPrefix(name: string): string {
  const n = name.toLowerCase();
  if (n === 'bash' || n === 'powershell') return '$ ';
  return '';
}

/**
 * Trunca o JSON do input pra valores longos virarem "..." após N chars,
 * mantendo o highlight válido.
 */
function prettyInputJson(input: Record<string, unknown>): string {
  // Clonar substituindo strings muito longas por placeholder com tamanho
  const MAX = 600;
  const clone = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (v.length > MAX) return v.slice(0, MAX) + `… [+${v.length - MAX} chars]`;
      return v;
    }
    if (Array.isArray(v)) return v.map(clone);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = clone(val);
      return out;
    }
    return v;
  };
  try {
    return JSON.stringify(clone(input), null, 2);
  } catch {
    return String(input);
  }
}

function ToolCardImpl({
  name,
  input,
  result,
  isError,
  isRunning,
  summary,
  defaultExpanded = false,
}: ToolCardProps) {
  // Por design (modo Normal): tools ficam COLAPSADAS por default. Erros NÃO
  // auto-expandem mais — em vez disso, uma preview compacta da saída do erro
  // aparece logo abaixo do header (sem mostrar entrada/comando inteiro).
  //
  // Trade-off: economiza altura visual (cards de erro com input enorme tipo
  // Bash com 100 linhas não inflam mais a conversa) e mantém o erro visível
  // pra debug. Click no header expande full body se quiser ver entrada.
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);
  const [copied, setCopied] = useState(false);
  const [appeared, setAppeared] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Fade-in inicial (frame seguinte ao mount)
  useEffect(() => {
    const t = requestAnimationFrame(() => setAppeared(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const hasInput = !!input && Object.keys(input).length > 0;
  const hasResult = typeof result === 'string' && result.length > 0;

  const inputHtml = useMemo(() => {
    if (!hasInput || !input) return '';
    return highlight(prettyInputJson(input), 'json');
  }, [hasInput, input]);

  /**
   * Detecta tools de edição de arquivo e extrai os props pra EditToolDiff.
   * Retorna null se a tool não é Edit/Write/MultiEdit ou se o input não tem
   * a shape esperada — caso em que renderiza JSON cru como fallback.
   */
  const editDiffProps = useMemo<
    | null
    | {
        filePath: string;
        oldStr?: string;
        newStr?: string;
        hunks?: DiffHunk[];
        variant: 'edit' | 'write' | 'multiedit';
      }
  >(() => {
    if (!hasInput || !input) return null;
    const n = name.toLowerCase();
    const filePath = typeof input.file_path === 'string' ? input.file_path : '';
    if (!filePath) return null;

    if (n === 'edit') {
      const oldStr = typeof input.old_string === 'string' ? input.old_string : '';
      const newStr = typeof input.new_string === 'string' ? input.new_string : '';
      if (!oldStr && !newStr) return null;
      return { filePath, oldStr, newStr, variant: 'edit' };
    }
    if (n === 'write') {
      const content = typeof input.content === 'string' ? input.content : '';
      return { filePath, oldStr: '', newStr: content, variant: 'write' };
    }
    if (n === 'multiedit') {
      const rawEdits = Array.isArray(input.edits) ? (input.edits as unknown[]) : [];
      const hunks: DiffHunk[] = rawEdits
        .map((e): DiffHunk | null => {
          if (!e || typeof e !== 'object') return null;
          const obj = e as Record<string, unknown>;
          const oldStr = typeof obj.old_string === 'string' ? obj.old_string : '';
          const newStr = typeof obj.new_string === 'string' ? obj.new_string : '';
          if (!oldStr && !newStr) return null;
          return { oldStr, newStr };
        })
        .filter((h): h is DiffHunk => h !== null);
      if (hunks.length === 0) return null;
      return { filePath, hunks, variant: 'multiedit' };
    }
    return null;
  }, [hasInput, input, name]);

  const handleCopy = useCallback(() => {
    if (!hasResult || !result) return;
    navigator.clipboard
      .writeText(result)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {
        /* ignore — clipboard pode falhar em contextos sem permission */
      });
  }, [hasResult, result]);

  // Status pill — running > error > ok > idle
  let statusNode: React.ReactNode = null;
  if (isRunning) {
    statusNode = (
      <span className="tool-card-status is-running" aria-label="executando">
        <i className="codicon codicon-loading codicon-modifier-spin" />
        <span className="tool-card-status-label">executando</span>
      </span>
    );
  } else if (isError) {
    statusNode = (
      <span className="tool-card-status is-error" aria-label="erro">
        <span className="tool-card-status-dot" />
        <span className="tool-card-status-label">erro</span>
      </span>
    );
  } else if (hasResult) {
    statusNode = (
      <span className="tool-card-status is-ok" aria-label="ok">
        <span className="tool-card-status-dot" />
        <span className="tool-card-status-label">ok</span>
      </span>
    );
  }

  const icon = iconFor(name);
  const mono = isMonoSummary(name);
  const sumPrefix = shellPrefix(name);

  return (
    <div
      className={[
        'tool-card',
        isError ? 'has-error' : '',
        isRunning ? 'is-running' : '',
        expanded ? 'is-expanded' : '',
        appeared ? 'is-appeared' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        className="tool-card-header"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={`tool-card-body-${name}`}
      >
        <span className="tool-card-icon-wrap">
          <i className={`codicon codicon-${icon}`} aria-hidden="true" />
        </span>
        <span className="tool-card-title">
          <span className="tool-card-name">{name}</span>
          {summary && (
            <>
              <span className="tool-card-sep" aria-hidden="true">·</span>
              <span className={`tool-card-summary ${mono ? 'is-mono' : ''}`}>
                {sumPrefix && <span className="tool-card-shell-prompt">{sumPrefix}</span>}
                {summary}
              </span>
            </>
          )}
        </span>
        <span className="tool-card-status-slot">{statusNode}</span>
        <i
          className={`codicon codicon-chevron-right tool-card-caret ${
            expanded ? 'is-open' : ''
          }`}
          aria-hidden="true"
        />
      </button>
      {/* Error preview inline (modo Normal): mostra saída do erro logo abaixo
       * do header sem precisar expandir. Entrada/comando ficam escondidos pra
       * economizar altura visual (tools com comando bash longo não inflam mais).
       * Click no header expande full body se quiser ver entrada. */}
      {isError && hasResult && !expanded && (
        <div className="tool-card-error-preview" aria-label="Saída do erro">
          <pre className="tool-card-code tool-card-output">{result}</pre>
        </div>
      )}
      <div
        id={`tool-card-body-${name}`}
        ref={bodyRef}
        className={`tool-card-body-wrap ${expanded ? 'is-open' : ''}`}
        aria-hidden={!expanded}
      >
        <div className="tool-card-body">
          {hasInput && editDiffProps && (
            <section className="tool-card-section">
              <header className="tool-card-section-head">
                <span className="tool-card-section-label">Diff</span>
              </header>
              <EditToolDiff {...editDiffProps} />
            </section>
          )}
          {hasInput && !editDiffProps && (
            <section className="tool-card-section">
              <header className="tool-card-section-head">
                <span className="tool-card-section-label">Entrada</span>
              </header>
              <pre className="tool-card-code language-json">
                <code
                  className="language-json"
                  dangerouslySetInnerHTML={{ __html: inputHtml }}
                />
              </pre>
            </section>
          )}
          {hasResult && (
            <section className={`tool-card-section ${isError ? 'is-error-section' : ''}`}>
              <header className="tool-card-section-head">
                <span className="tool-card-section-label">Saída</span>
                <button
                  type="button"
                  className="tool-card-copy"
                  onClick={handleCopy}
                  title={copied ? 'Copiado' : 'Copiar saída'}
                  aria-label={copied ? 'Copiado' : 'Copiar saída'}
                >
                  <i className={`codicon codicon-${copied ? 'check' : 'copy'}`} aria-hidden="true" />
                  <span>{copied ? 'copiado' : 'copiar'}</span>
                </button>
              </header>
              <pre className="tool-card-code tool-card-output">{result}</pre>
            </section>
          )}
          {!hasInput && !hasResult && !isRunning && (
            <div className="tool-card-empty">sem detalhes</div>
          )}
          {!hasInput && !hasResult && isRunning && (
            <div className="tool-card-empty is-running">aguardando resposta da ferramenta</div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * PERF: memo evita re-render quando props não mudam (string equality em name,
 * summary, result; object identity em input). Sem memo, cada setItems no
 * ChatView re-renderiza TODOS os ToolCards mounted (inclusive os colapsados).
 * Sobre 50 tool calls num chat, custo era ~750ms-1.5s blocking por delta.
 */
export const ToolCard = memo(ToolCardImpl);
