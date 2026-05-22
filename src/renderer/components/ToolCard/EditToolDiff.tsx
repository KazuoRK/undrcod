/**
 * EditToolDiff — renderiza um diff unificado inline pra tools Edit/Write/MultiEdit.
 *
 * Substitui o JSON cru de {old_string,new_string} por uma visualização legível,
 * com linhas verdes (add) / vermelhas (remove) e gutter de line-numbers dim.
 *
 * Keyboard (quando o card está em hover/foco — ativa o handler global):
 *   - Alt+J / Alt+K        → navega entre hunks (highlight border-left accent)
 *   - Alt+Enter            → aceita o hunk atual (aplica no disco)
 *   - Alt+Shift+Enter      → aceita todos os hunks (apply-all)
 *
 * Estratégia de apply:
 *   - variant === 'write'  → escreve newStr direto via fs.writeFile
 *   - variant === 'edit'/'multiedit' → read file → string.replace(old, new) →
 *     write. Single-hunk usa só o hunk corrente; acceptAll itera todos.
 *
 * Algoritmo de diff: LCS clássica O(n*m). Sem deps externas.
 *
 * Props:
 *   - filePath      caminho relativo/absoluto (mostrado no header)
 *   - oldStr        conteúdo antigo (vazio = pure-write)
 *   - newStr        conteúdo novo
 *   - hunks         opcional, pra MultiEdit (array de {oldStr,newStr})
 *   - variant       'edit' | 'write' | 'multiedit' — afeta label de header
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from '../Toast/Toast';
import { useHunkKeyboard, type HunkNavigable } from '../../hooks/useHunkKeyboard';
import './EditToolDiff.css';

export interface DiffHunk {
  oldStr: string;
  newStr: string;
}

export interface EditToolDiffProps {
  filePath: string;
  oldStr?: string;
  newStr?: string;
  hunks?: DiffHunk[];
  variant: 'edit' | 'write' | 'multiedit';
}

type LineKind = 'context' | 'add' | 'remove';

interface DiffLine {
  kind: LineKind;
  /** Linha no arquivo antigo (1-based) ou null se é puro add. */
  oldNo: number | null;
  /** Linha no arquivo novo (1-based) ou null se é puro remove. */
  newNo: number | null;
  text: string;
}

/**
 * Diff linha-a-linha via LCS. Retorna sequência de DiffLine intercalando
 * context/remove/add. Não tenta agrupar hunks com elipse — pra Edit típico,
 * os trechos são curtos.
 */
function diffLines(oldStr: string, newStr: string): DiffLine[] {
  const a = oldStr.length === 0 ? [] : oldStr.split('\n');
  const b = newStr.length === 0 ? [] : newStr.split('\n');
  const n = a.length;
  const m = b.length;

  // Caso degenerado: arquivo novo (write)
  if (n === 0) {
    return b.map((text, i) => ({ kind: 'add' as const, oldNo: null, newNo: i + 1, text }));
  }
  if (m === 0) {
    return a.map((text, i) => ({ kind: 'remove' as const, oldNo: i + 1, newNo: null, text }));
  }

  // LCS DP — lengths
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack pra montar sequência
  const out: DiffLine[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push({ kind: 'context', oldNo: i, newNo: j, text: a[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      out.push({ kind: 'remove', oldNo: i, newNo: null, text: a[i - 1] });
      i--;
    } else {
      out.push({ kind: 'add', oldNo: null, newNo: j, text: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    out.push({ kind: 'remove', oldNo: i, newNo: null, text: a[i - 1] });
    i--;
  }
  while (j > 0) {
    out.push({ kind: 'add', oldNo: null, newNo: j, text: b[j - 1] });
    j--;
  }

  return out.reverse();
}

/** Encurta paths absolutos longos pra exibir só os últimos N segmentos. */
function shortenPath(p: string, maxSegments = 4): string {
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(sep).filter(Boolean);
  if (parts.length <= maxSegments) return p;
  return '…' + sep + parts.slice(-maxSegments).join(sep);
}

/** Basename rápido pra toasts. */
function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

interface HunkBlockProps {
  lines: DiffLine[];
  /** undefined quando há só 1 hunk — nesse caso esconde header. */
  idx?: number;
  /** True quando este hunk é o ativo (highlight border-left). */
  active?: boolean;
  /** Total de hunks pra indicador "X de Y" no header. */
  total?: number;
}

function HunkBlock({ lines, idx, active, total }: HunkBlockProps) {
  const adds = lines.filter((l) => l.kind === 'add').length;
  const rems = lines.filter((l) => l.kind === 'remove').length;
  const showHeader = typeof idx === 'number' && typeof total === 'number' && total > 1;
  return (
    <div
      className={`edit-tool-diff-hunk${active ? ' is-active-hunk' : ''}`}
      data-hunk-idx={idx}
      data-active={active ? 'true' : 'false'}
    >
      {showHeader && (
        <div className="edit-tool-diff-hunk-head">
          <span className="edit-tool-diff-hunk-label">
            Hunk {idx + 1}
            {total && total > 1 ? <span className="edit-tool-diff-hunk-count"> / {total}</span> : null}
          </span>
          <span className="edit-tool-diff-hunk-stats">
            <span className="edit-tool-diff-stat-add">+{adds}</span>
            <span className="edit-tool-diff-stat-rem">−{rems}</span>
          </span>
        </div>
      )}
      <pre className="edit-tool-diff-pre">
        {lines.map((line, k) => (
          <div
            key={k}
            className={`edit-tool-diff-line edit-tool-diff-line-${line.kind}`}
            data-kind={line.kind}
          >
            <span className="edit-tool-diff-gutter edit-tool-diff-gutter-old">
              {line.oldNo ?? ''}
            </span>
            <span className="edit-tool-diff-gutter edit-tool-diff-gutter-new">
              {line.newNo ?? ''}
            </span>
            <span className="edit-tool-diff-marker" aria-hidden="true">
              {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}
            </span>
            <span className="edit-tool-diff-text">{line.text || '​'}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

// ============================================================================
// Apply logic
// ============================================================================

/**
 * Aplica um único hunk no disco: lê o arquivo, substitui old → new (primeira
 * ocorrência só, espelhando semântica do Claude Edit tool), escreve de volta.
 * Pra variant 'write' (e oldStr vazio), escreve newStr direto.
 *
 * Retorna { ok: true } ou { error: string }.
 */
async function applyHunkToDisk(
  filePath: string,
  hunk: DiffHunk,
  isPureWrite: boolean,
): Promise<{ ok: true } | { error: string }> {
  if (isPureWrite || hunk.oldStr.length === 0) {
    return window.undrcodAPI?.fs.writeFile(filePath, hunk.newStr);
  }
  const read = await window.undrcodAPI?.fs.readFile(filePath);
  if ('error' in read) return { error: read.error };
  const content = read.content;
  const idx = content.indexOf(hunk.oldStr);
  if (idx < 0) {
    return { error: `Trecho não encontrado em ${basename(filePath)}` };
  }
  const next = content.slice(0, idx) + hunk.newStr + content.slice(idx + hunk.oldStr.length);
  return window.undrcodAPI?.fs.writeFile(filePath, next);
}

/** Aplica múltiplos hunks sequencialmente. Para no primeiro erro. */
async function applyAllHunksToDisk(
  filePath: string,
  hunks: DiffHunk[],
  isPureWrite: boolean,
): Promise<{ ok: true; applied: number } | { error: string; applied: number }> {
  // Pure write é sempre 1 hunk; trata separado.
  if (isPureWrite) {
    const res = await window.undrcodAPI?.fs.writeFile(filePath, hunks[0]?.newStr ?? '');
    if ('error' in res) return { error: res.error, applied: 0 };
    return { ok: true, applied: 1 };
  }
  let applied = 0;
  for (const h of hunks) {
    const res = await applyHunkToDisk(filePath, h, false);
    if ('error' in res) return { error: res.error, applied };
    applied++;
  }
  return { ok: true, applied };
}

// ============================================================================
// Component
// ============================================================================

/**
 * Implementação interna — usa forwardRef pra expor HunkNavigable.
 * O cabo do keyboard (window listener) é montado AQUI dentro, ativo apenas
 * quando o card está em hover (single source of truth — evita conflitos
 * entre múltiplos cards visíveis simultaneamente no transcript).
 */
const EditToolDiffImpl = forwardRef<HunkNavigable, EditToolDiffProps>(function EditToolDiffImpl(
  { filePath, oldStr, newStr, hunks, variant },
  forwardedRef,
) {
  const allHunks = useMemo<DiffHunk[]>(() => {
    if (hunks && hunks.length > 0) return hunks;
    return [{ oldStr: oldStr ?? '', newStr: newStr ?? '' }];
  }, [hunks, oldStr, newStr]);

  const hunkLines = useMemo(() => allHunks.map((h) => diffLines(h.oldStr, h.newStr)), [allHunks]);

  const totals = useMemo(() => {
    let adds = 0;
    let rems = 0;
    for (const lines of hunkLines) {
      for (const l of lines) {
        if (l.kind === 'add') adds++;
        else if (l.kind === 'remove') rems++;
      }
    }
    return { adds, rems };
  }, [hunkLines]);

  const variantLabel =
    variant === 'write' ? 'Novo arquivo' : variant === 'multiedit' ? 'Multi-edit' : 'Edit';

  const isPureWrite = variant === 'write';

  // ---- Navegação + apply state -------------------------------------------
  const [currentIdx, setCurrentIdx] = useState(0);
  const [applying, setApplying] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Reset índice se hunks mudarem.
  useEffect(() => {
    setCurrentIdx((idx) => (idx >= allHunks.length ? 0 : idx));
  }, [allHunks.length]);

  // Scroll hunk ativo pra view (centro) quando muda.
  useEffect(() => {
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-hunk-idx="${currentIdx}"]`,
    );
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentIdx]);

  const focusNextHunk = useCallback(() => {
    setCurrentIdx((idx) => (allHunks.length > 0 ? (idx + 1) % allHunks.length : 0));
  }, [allHunks.length]);

  const focusPrevHunk = useCallback(() => {
    setCurrentIdx((idx) =>
      allHunks.length > 0 ? (idx - 1 + allHunks.length) % allHunks.length : 0,
    );
  }, [allHunks.length]);

  const acceptCurrent = useCallback(() => {
    if (applying) return;
    const hunk = allHunks[currentIdx];
    if (!hunk) return;
    setApplying(true);
    void applyHunkToDisk(filePath, hunk, isPureWrite)
      .then((res) => {
        if ('error' in res) {
          toast.error('Falha ao aplicar edit', { sub: res.error });
          return;
        }
        const fname = basename(filePath);
        if (allHunks.length > 1) {
          toast.success(`Aceito hunk ${currentIdx + 1} de ${allHunks.length}`, {
            sub: `${fname} atualizado`,
          });
        } else {
          toast.success(`Edit aplicado em ${fname}`);
        }
      })
      .finally(() => setApplying(false));
  }, [allHunks, applying, currentIdx, filePath, isPureWrite]);

  const acceptAll = useCallback(() => {
    if (applying) return;
    if (allHunks.length === 0) return;
    setApplying(true);
    toast.info('Aceitando todos...', { ttl: 1500, skipLog: true });
    void applyAllHunksToDisk(filePath, allHunks, isPureWrite)
      .then((res) => {
        const fname = basename(filePath);
        if ('error' in res) {
          toast.error(`Falha após ${res.applied} hunk(s)`, { sub: res.error });
          return;
        }
        toast.success(`${res.applied} hunk(s) aplicados em ${fname}`);
      })
      .finally(() => setApplying(false));
  }, [allHunks, applying, filePath, isPureWrite]);

  const rejectCurrent = useCallback(() => {
    // Sem persistent state pra "rejected" no card — só feedback visual.
    toast.info('Hunk descartado', { ttl: 2000, skipLog: true });
  }, []);

  // Expose imperative API pro ref externo (caso ChatView queira controlar).
  useImperativeHandle(
    forwardedRef,
    () => ({
      focusNextHunk,
      focusPrevHunk,
      acceptCurrent,
      rejectCurrent,
      acceptAll,
    }),
    [focusNextHunk, focusPrevHunk, acceptCurrent, rejectCurrent, acceptAll],
  );

  // Hover-based activation — só esse card responde ao keyboard quando hovered.
  // Evita "qual card pega a tecla?" quando o transcript tem vários edits.
  const [isHovered, setIsHovered] = useState(false);
  const internalNavRef = useRef<HunkNavigable | null>({
    focusNextHunk,
    focusPrevHunk,
    acceptCurrent,
    rejectCurrent,
    acceptAll,
  });
  // Mantém o ref interno em sync com os callbacks atuais.
  useEffect(() => {
    internalNavRef.current = {
      focusNextHunk,
      focusPrevHunk,
      acceptCurrent,
      rejectCurrent,
      acceptAll,
    };
  }, [focusNextHunk, focusPrevHunk, acceptCurrent, rejectCurrent, acceptAll]);

  useHunkKeyboard({ diffViewerRef: internalNavRef, enabled: isHovered });

  return (
    <div
      ref={containerRef}
      className={`edit-tool-diff edit-tool-diff-${variant}${isHovered ? ' is-keyboard-active' : ''}${
        applying ? ' is-applying' : ''
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      tabIndex={-1}
    >
      <header className="edit-tool-diff-head">
        <span className="edit-tool-diff-variant">{variantLabel}</span>
        <span className="edit-tool-diff-path" title={filePath}>
          {shortenPath(filePath)}
        </span>
        {allHunks.length > 1 && (
          <span className="edit-tool-diff-hunk-pos" title="Hunk atual (Alt+J/K pra navegar)">
            {currentIdx + 1}/{allHunks.length}
          </span>
        )}
        <span className="edit-tool-diff-totals">
          <span className="edit-tool-diff-stat-add">+{totals.adds}</span>
          <span className="edit-tool-diff-stat-rem">−{totals.rems}</span>
        </span>
        {isHovered && (
          <span className="edit-tool-diff-kbd-hint" aria-hidden="true">
            <span className="edit-tool-diff-kbd">Alt+J/K</span>
            <span className="edit-tool-diff-kbd">Alt+↵</span>
          </span>
        )}
      </header>
      <div className="edit-tool-diff-hunks">
        {hunkLines.map((lines, idx) => (
          <HunkBlock
            key={idx}
            lines={lines}
            idx={idx}
            total={allHunks.length}
            active={idx === currentIdx}
          />
        ))}
      </div>
    </div>
  );
});

export const EditToolDiff = EditToolDiffImpl;
