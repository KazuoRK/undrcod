/**
 * CentralViewContent — renderiza conteudo de uma view especial dentro do pane-mid.
 * Reusa os tab contents que existem no RightPane (Tarefas, Plano, Ver previa, Diff, Arquivos).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentTask } from '../StatusBar/StatusBar';
import type { CentralViewId } from './CentralTabs';
import { WorkspacesPanel } from '../WorkspacesPanel/WorkspacesPanel';
import { PreviewView } from '../PreviewView/PreviewView';
import './CentralViewContent.css';

interface CentralViewContentProps {
  viewId: CentralViewId;
  cwd: string;
  tasks?: AgentTask[];
  /** Mensagens do assistant (text content) — usado pra detectar plano automaticamente. */
  assistantMessages?: string[];
  onResumeSession?: (path: string, sessionId: string) => void;
  onNewConversation?: (path: string) => void;
}

/* ---------- Plan parser ---------- */

interface PlanItem {
  text: string;
  /** 'check' = [x] feito, 'open' = [ ] aberto, 'numbered' = item de lista numerada (sem check). */
  kind: 'check' | 'open' | 'numbered';
  /** Numero pra items numerados. */
  index?: number;
}

const SECTION_HEADER_RE = /^(?:#{1,6}\s+)?(plano|steps?|todo|tarefas?|to\s*do)\s*:?\s*$/i;
const CHECKBOX_RE = /^\s*[-*+]\s*\[([ xX])\]\s+(.+?)\s*$/;
const NUMBERED_RE = /^\s*(\d+)[\.\)]\s+(.+?)\s*$/;

/**
 * Acha a ULTIMA section de plano nas mensagens do assistant (mais recente).
 * Tolerante a varias formas:
 *   - Header "Plano:" / "Steps:" / "TODO:" / "Tarefas:" iniciando uma section
 *   - Checkbox markdown `- [ ]` / `- [x]`
 *   - Lista numerada `1.` / `2.`
 *
 * Estrategia:
 *   1. Scan de tras pra frente nas mensagens
 *   2. Pra cada mensagem, acha o ULTIMO bloco contiguo de items que casam
 *      com checkbox/numbered, possivelmente precedido por um header
 *   3. Retorna o primeiro bloco encontrado (== último na ordem cronologica)
 */
function parsePlanFromMessages(messages: string[]): PlanItem[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    const items = parsePlanFromText(msg);
    if (items.length > 0) return items;
  }
  return [];
}

function parsePlanFromText(text: string): PlanItem[] {
  const lines = text.split(/\r?\n/);

  // Acha todas as runs contiguas de items + opcional header logo antes.
  // Cada run = { startLine, items, hasHeader }
  type Run = { start: number; end: number; items: PlanItem[]; hasHeader: boolean };
  const runs: Run[] = [];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    // Detecta header de plano
    if (SECTION_HEADER_RE.test(raw.trim())) {
      // Tenta coletar items logo abaixo (permitindo linhas em branco entre header e primeiro item)
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      const collected = collectItems(lines, j);
      if (collected.items.length > 0) {
        runs.push({ start: i, end: collected.endLine, items: collected.items, hasHeader: true });
        i = collected.endLine + 1;
        continue;
      }
    }

    // Ou: run de items sem header (lista numerada/checkbox solta).
    if (isItemLine(raw)) {
      const collected = collectItems(lines, i);
      if (collected.items.length > 0) {
        runs.push({ start: i, end: collected.endLine, items: collected.items, hasHeader: false });
        i = collected.endLine + 1;
        continue;
      }
    }

    i++;
  }

  if (runs.length === 0) return [];

  // Preferencia: runs com header > runs sem header. Dentro do grupo, a última (mais recente).
  const withHeader = runs.filter((r) => r.hasHeader);
  const pool = withHeader.length > 0 ? withHeader : runs;
  return pool[pool.length - 1].items;
}

function isItemLine(line: string): boolean {
  return CHECKBOX_RE.test(line) || NUMBERED_RE.test(line);
}

function collectItems(
  lines: string[],
  startIdx: number,
): { items: PlanItem[]; endLine: number } {
  const items: PlanItem[] = [];
  let i = startIdx;
  let blankBuffer = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (trimmed === '') {
      blankBuffer++;
      // Tolerancia: até 1 linha em branco entre items
      if (blankBuffer > 1) break;
      i++;
      continue;
    }

    const cb = raw.match(CHECKBOX_RE);
    if (cb) {
      const checked = cb[1].toLowerCase() === 'x';
      items.push({ text: cb[2].trim(), kind: checked ? 'check' : 'open' });
      blankBuffer = 0;
      i++;
      continue;
    }

    const num = raw.match(NUMBERED_RE);
    if (num) {
      items.push({ text: num[2].trim(), kind: 'numbered', index: parseInt(num[1], 10) });
      blankBuffer = 0;
      i++;
      continue;
    }

    break;
  }

  return { items, endLine: i - 1 };
}

/* ---------- Diff types (mirror do main) ---------- */

interface DiffLine {
  type: '+' | '-' | ' ';
  text: string;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffFile {
  path: string;
  hunks: DiffHunk[];
}

/* ---------- Componente ---------- */

export function CentralViewContent({
  viewId,
  cwd,
  tasks,
  assistantMessages,
  onResumeSession,
  onNewConversation,
}: CentralViewContentProps) {
  if (viewId === 'tasks') {
    if (!tasks || tasks.length === 0) {
      return (
        <div className="central-view-empty">
          <i className="codicon codicon-tasklist central-view-empty-icon" />
          <div className="central-view-empty-title">Sem tarefas ainda</div>
          <div className="central-view-empty-hint">
            Cada ferramenta executada pelo Claude vira uma tarefa aqui.
          </div>
        </div>
      );
    }
    const running = tasks.filter((t) => t.status === 'running');
    const done = tasks.filter((t) => t.status !== 'running');
    return (
      <div className="central-view-body">
        {running.length > 0 && (
          <>
            <div className="central-view-section-title">Em execucao</div>
            <ul className="central-view-list">
              {running.map((t) => (
                <li key={t.id} className="central-view-task">
                  <i className="codicon codicon-sync~spin central-view-task-status" />
                  <div className="central-view-task-body">
                    <div className="central-view-task-title">{t.description || t.name}</div>
                    <div className="central-view-task-meta">{t.name} · Em execucao</div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {done.length > 0 && (
          <>
            <div className="central-view-section-title">Concluido</div>
            <ul className="central-view-list">
              {done.map((t) => (
                <li key={t.id} className="central-view-task">
                  <i
                    className={`codicon codicon-${t.status === 'failed' ? 'error' : 'check'} central-view-task-status ${t.status === 'failed' ? 'is-error' : ''}`}
                  />
                  <div className="central-view-task-body">
                    <div className="central-view-task-title">{t.description || t.name}</div>
                    <div className="central-view-task-meta">
                      {t.name} · {t.status === 'failed' ? 'Falhou' : 'Concluido'}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  if (viewId === 'plan') {
    return <PlanView assistantMessages={assistantMessages || []} />;
  }

  if (viewId === 'preview') {
    return (
      <PreviewView
        cwd={cwd}
        initialUrl=""
        onUrlChange={() => { /* neutro */ }}
      />
    );
  }

  if (viewId === 'diff') {
    return <DiffView cwd={cwd} />;
  }

  if (viewId === 'files') {
    return (
      <WorkspacesPanel
        cwd={cwd}
        onResumeSession={(p, sid) => onResumeSession?.(p, sid)}
        onNewConversation={(p) => onNewConversation?.(p)}
      />
    );
  }

  return null;
}

/* ---------- PlanView ---------- */

function PlanView({ assistantMessages }: { assistantMessages: string[] }) {
  const items = useMemo(() => parsePlanFromMessages(assistantMessages), [assistantMessages]);

  if (items.length === 0) {
    return (
      <div className="central-view-empty">
        <i className="codicon codicon-list-ordered central-view-empty-icon" />
        <div className="central-view-empty-title">Nenhum plano detectado nas mensagens</div>
        <div className="central-view-empty-hint">
          Claude escreve o plano aqui enquanto explora. Continue conversando.
        </div>
      </div>
    );
  }

  return (
    <div className="central-view-body">
      <div className="central-view-section-title">Plano (detectado automaticamente)</div>
      <ul className="central-view-checklist">
        {items.map((item, idx) => {
          const done = item.kind === 'check';
          return (
            <li key={idx} className={`plan-item ${done ? 'is-done' : ''}`}>
              <span className="plan-item-marker">
                {item.kind === 'numbered' ? (
                  <span className="plan-item-number">{item.index}.</span>
                ) : done ? (
                  <i className="codicon codicon-pass-filled plan-item-icon is-check" />
                ) : (
                  <i className="codicon codicon-circle-large-outline plan-item-icon" />
                )}
              </span>
              <span className="plan-item-text">{item.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- DiffView ---------- */

function DiffView({ cwd }: { cwd: string }) {
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const refresh = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    try {
      const result = await window.undrcodAPI?.git.diff(cwd);
      setFiles(result.files);
    } catch (err) {
      console.error('[DiffView] erro:', err);
      setFiles([]);
    } finally {
      setLoading(false);
      setLoadedOnce(true);
    }
  }, [cwd]);

  // Carga inicial + refresh quando cwd muda
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh quando janela ganha foco
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  if (loadedOnce && files.length === 0) {
    return (
      <div className="central-view-body">
        <div className="central-view-diff-header">
          <span className="central-view-section-title">Diff (vs HEAD)</span>
          <button
            type="button"
            className="central-view-diff-refresh"
            title="Atualizar"
            onClick={refresh}
            disabled={loading}
          >
            <i className={`codicon codicon-${loading ? 'sync~spin' : 'refresh'}`} />
          </button>
        </div>
        <div className="central-view-empty">
          <i className="codicon codicon-diff central-view-empty-icon" />
          <div className="central-view-empty-title">Sem alteracoes ainda</div>
          <div className="central-view-empty-hint">
            Quando você editar arquivos, o diff vs HEAD aparece aqui.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="central-view-body">
      <div className="central-view-diff-header">
        <span className="central-view-section-title">
          Diff (vs HEAD) · {files.length} {files.length === 1 ? 'arquivo' : 'arquivos'}
        </span>
        <button
          type="button"
          className="central-view-diff-refresh"
          title="Atualizar"
          onClick={refresh}
          disabled={loading}
        >
          <i className={`codicon codicon-${loading ? 'sync~spin' : 'refresh'}`} />
        </button>
      </div>
      <div className="central-view-diff-files">
        {files.map((f) => (
          <DiffFileBlock key={f.path} file={f} />
        ))}
      </div>
    </div>
  );
}

function DiffFileBlock({ file }: { file: DiffFile }) {
  const [collapsed, setCollapsed] = useState(false);
  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const h of file.hunks) {
      for (const l of h.lines) {
        if (l.type === '+') added++;
        else if (l.type === '-') removed++;
      }
    }
    return { added, removed };
  }, [file]);

  return (
    <div className="diff-file">
      <button
        type="button"
        className="diff-file-header"
        onClick={() => setCollapsed((c) => !c)}
      >
        <i className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'} diff-file-chevron`} />
        <span className="diff-file-path">{file.path}</span>
        <span className="diff-file-stats">
          <span className="diff-stat-add">+{stats.added}</span>
          <span className="diff-stat-del">-{stats.removed}</span>
        </span>
      </button>
      {!collapsed && (
        <div className="diff-file-body">
          {file.hunks.length === 0 ? (
            <div className="diff-hunk-empty">Sem hunks (provavelmente metadata only)</div>
          ) : (
            file.hunks.map((hunk, hIdx) => (
              <div key={hIdx} className="diff-hunk">
                <div className="diff-hunk-header">{hunk.header}</div>
                <pre className="diff-hunk-lines">
                  {hunk.lines.map((line, lIdx) => (
                    <div
                      key={lIdx}
                      className={`diff-line diff-line-${line.type === '+' ? 'add' : line.type === '-' ? 'del' : 'ctx'}`}
                    >
                      <span className="diff-line-sign">
                        {line.type === '+' ? '+' : line.type === '-' ? '-' : ' '}
                      </span>
                      <span className="diff-line-text">{line.text || ' '}</span>
                    </div>
                  ))}
                </pre>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
