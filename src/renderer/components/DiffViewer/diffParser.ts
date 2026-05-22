/**
 * Diff parsing helpers — converte hunks do `git:diff` IPC em duas strings
 * completas (before/after) prontas pra Monaco DiffEditor.
 *
 * IMPORTANT: o git diff só nos da hunks (regiões alteradas), não o arquivo
 * inteiro. Quando montamos before/after a partir só dos hunks, o resultado
 * NÃO é o conteudo completo do arquivo — é só o "scope" dos hunks reconstruido.
 * O DiffEditor do Monaco vai mostrar diff entre essas duas strings, que é
 * exatamente o que queremos pra hunk-level review.
 *
 * Pra preservar continuidade visual entre hunks, separamos com uma linha
 * "..." se o número de linhas pulado for > 0.
 */

/**
 * '\\' = "\ No newline at end of file" marker do git diff. Não renderiza no Monaco
 * mas é importante manter pra reconstruir patches válidos (ver patchGenerator.ts).
 */
export type DiffLineType = '+' | '-' | ' ' | '\\';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffHunk {
  /** Header git no formato "@@ -A,B +C,D @@ optional context" */
  header: string;
  lines: DiffLine[];
}

export interface LineMapEntry {
  /** 1-based no before-string, null se a linha só existe no after */
  beforeLine: number | null;
  /** 1-based no after-string, null se a linha só existe no before */
  afterLine: number | null;
  type: DiffLineType;
  /** Indice do hunk a que essa linha pertence (0-based). null pra separadores. */
  hunkIndex: number | null;
}

export interface HunksToBeforeAfterResult {
  before: string;
  after: string;
  lineMap: LineMapEntry[];
  /**
   * Pra cada hunk, qual a linha 1-based no `after`-string onde ele começa
   * (primeira linha do hunk, seja contexto ou '+'). Usado pra revealLineInCenter.
   */
  hunkStartAfterLines: number[];
  /** Mesma coisa, mas pro `before`-string. */
  hunkStartBeforeLines: number[];
}

/**
 * Parse de "@@ -A,B +C,D @@" — retorna { beforeStart, beforeCount, afterStart, afterCount }.
 * Count é opcional no formato git (default = 1 se omitido).
 */
export function parseHunkHeader(header: string): {
  beforeStart: number;
  beforeCount: number;
  afterStart: number;
  afterCount: number;
} {
  // Regex tolerante: @@ -A[,B] +C[,D] @@
  const m = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!m) {
    return { beforeStart: 1, beforeCount: 0, afterStart: 1, afterCount: 0 };
  }
  return {
    beforeStart: parseInt(m[1], 10),
    beforeCount: m[2] ? parseInt(m[2], 10) : 1,
    afterStart: parseInt(m[3], 10),
    afterCount: m[4] ? parseInt(m[4], 10) : 1,
  };
}

/**
 * Converte uma array de hunks em { before, after, lineMap }.
 *
 * - `before` = concatenação de todas linhas ` ` + `-` (com separador "..." entre hunks)
 * - `after`  = concatenação de todas linhas ` ` + `+` (com separador "..." entre hunks)
 * - `lineMap` mapeia cada linha gerada de volta pro contexto original (linha no arquivo)
 *
 * Linhas de separador ("..." entre hunks não-adjacentes) aparecem em AMBAS as strings
 * pra manter o alinhamento visual do DiffEditor.
 */
export function hunksToBeforeAfter(hunks: DiffHunk[]): HunksToBeforeAfterResult {
  const beforeLines: string[] = [];
  const afterLines: string[] = [];
  const lineMap: LineMapEntry[] = [];
  const hunkStartAfterLines: number[] = [];
  const hunkStartBeforeLines: number[] = [];

  // Track última posição "real" no arquivo (pra calcular se precisa separador entre hunks)
  let lastBeforeEnd = 0;
  let lastAfterEnd = 0;

  hunks.forEach((hunk, hunkIdx) => {
    const { beforeStart, afterStart } = parseHunkHeader(hunk.header);

    // Se não é o primeiro hunk e tem gap real entre o fim do hunk anterior
    // e o começo desse, insere uma linha "..." em ambos os lados.
    if (hunkIdx > 0) {
      const gapBefore = beforeStart - lastBeforeEnd - 1;
      const gapAfter = afterStart - lastAfterEnd - 1;
      if (gapBefore > 0 || gapAfter > 0) {
        const sep = `        ⋯ (${Math.max(gapBefore, gapAfter)} lines skipped)`;
        beforeLines.push(sep);
        afterLines.push(sep);
        lineMap.push({
          beforeLine: beforeLines.length,
          afterLine: afterLines.length,
          type: ' ',
          hunkIndex: null,
        });
      }
    }

    // 1-based positions no nosso before/after-string onde esse hunk começa
    hunkStartBeforeLines.push(beforeLines.length + 1);
    hunkStartAfterLines.push(afterLines.length + 1);

    // Tracker do counter "real" do arquivo dentro desse hunk
    let curBefore = beforeStart - 1; // será incrementado antes de uso
    let curAfter = afterStart - 1;

    for (const ln of hunk.lines) {
      if (ln.type === ' ') {
        curBefore += 1;
        curAfter += 1;
        beforeLines.push(ln.text);
        afterLines.push(ln.text);
        lineMap.push({
          beforeLine: beforeLines.length,
          afterLine: afterLines.length,
          type: ' ',
          hunkIndex: hunkIdx,
        });
      } else if (ln.type === '-') {
        curBefore += 1;
        beforeLines.push(ln.text);
        lineMap.push({
          beforeLine: beforeLines.length,
          afterLine: null,
          type: '-',
          hunkIndex: hunkIdx,
        });
      } else if (ln.type === '+') {
        curAfter += 1;
        afterLines.push(ln.text);
        lineMap.push({
          beforeLine: null,
          afterLine: afterLines.length,
          type: '+',
          hunkIndex: hunkIdx,
        });
      }
    }

    lastBeforeEnd = curBefore;
    lastAfterEnd = curAfter;
  });

  return {
    before: beforeLines.join('\n'),
    after: afterLines.join('\n'),
    lineMap,
    hunkStartAfterLines,
    hunkStartBeforeLines,
  };
}

/**
 * Computa hunks entre duas strings arbitrárias (ex: 2 arquivos quaisquer)
 * no MESMO formato que o git diff retorna — header "@@ -A,B +C,D @@" + lines
 * com type ' ' | '+' | '-' — pra que possam ser passadas direto pro DiffViewer
 * sem precisar de um caminho de renderização separado.
 *
 * Algoritmo: LCS (Longest Common Subsequence) line-by-line via DP O(N*M).
 * Adequado pra arquivos pequenos/médios (< ~5k linhas cada). Pra arquivos
 * gigantes seria preferível Myers, mas o caso de uso aqui (compare 2 arquivos
 * no FileTree) raramente justifica.
 *
 * Hunks são gerados agrupando edits contíguas com `context` linhas de contexto
 * em volta — mesma convenção do `git diff -U3` (default = 3 linhas).
 */
export function computeDiffBetweenStrings(
  left: string,
  right: string,
  context = 3,
): DiffHunk[] {
  const a = left.length === 0 ? [] : left.split('\n');
  const b = right.length === 0 ? [] : right.split('\n');

  // === LCS DP ===
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length de a[i..] vs b[j..]
  // Usa Int32Array flat pra performance / footprint
  const dp = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const idx = i * (m + 1) + j;
      if (a[i] === b[j]) {
        dp[idx] = dp[(i + 1) * (m + 1) + (j + 1)] + 1;
      } else {
        const down = dp[(i + 1) * (m + 1) + j];
        const right_ = dp[i * (m + 1) + (j + 1)];
        dp[idx] = down > right_ ? down : right_;
      }
    }
  }

  // === Backtrack pra gerar diff ops ===
  type Op = { type: ' ' | '+' | '-'; text: string; aLine: number; bLine: number };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: ' ', text: a[i], aLine: i + 1, bLine: j + 1 });
      i++;
      j++;
    } else {
      const down = dp[(i + 1) * (m + 1) + j];
      const right_ = dp[i * (m + 1) + (j + 1)];
      if (down >= right_) {
        ops.push({ type: '-', text: a[i], aLine: i + 1, bLine: j + 1 });
        i++;
      } else {
        ops.push({ type: '+', text: b[j], aLine: i + 1, bLine: j + 1 });
        j++;
      }
    }
  }
  while (i < n) {
    ops.push({ type: '-', text: a[i], aLine: i + 1, bLine: j + 1 });
    i++;
  }
  while (j < m) {
    ops.push({ type: '+', text: b[j], aLine: i + 1, bLine: j + 1 });
    j++;
  }

  if (ops.length === 0) return [];

  // === Agrupa em hunks ===
  // Encontra runs de edits ('+'/'-') e expande com `context` linhas em volta.
  // Hunks adjacentes (gap <= 2*context) são merged.
  const isEdit = (op: Op) => op.type !== ' ';
  const editIdxs: number[] = [];
  ops.forEach((op, idx) => {
    if (isEdit(op)) editIdxs.push(idx);
  });
  if (editIdxs.length === 0) return [];

  // Agrupa edit indexes em ranges com merge baseado em context
  const ranges: Array<{ start: number; end: number }> = [];
  for (const idx of editIdxs) {
    const last = ranges[ranges.length - 1];
    if (last && idx - last.end <= context * 2) {
      last.end = idx;
    } else {
      ranges.push({ start: idx, end: idx });
    }
  }

  // Expande cada range com context + monta DiffHunk
  const hunks: DiffHunk[] = [];
  for (const r of ranges) {
    const start = Math.max(0, r.start - context);
    const end = Math.min(ops.length - 1, r.end + context);
    const slice = ops.slice(start, end + 1);

    // Calcula header counts: linhas no `a` (' '+'-') e no `b` (' '+'+')
    let aStart = slice[0].aLine;
    let bStart = slice[0].bLine;
    // Edge case: se a primeira op é '+' (insert), aLine pode estar 1 além do
    // último a-line consumido. Para hunks puramente insert no início, força 1.
    if (slice[0].type === '+' && start === 0 && r.start === 0) {
      aStart = a.length === 0 ? 0 : 1;
    }
    if (slice[0].type === '-' && start === 0 && r.start === 0) {
      bStart = b.length === 0 ? 0 : 1;
    }
    let aCount = 0;
    let bCount = 0;
    const lines: DiffLine[] = [];
    for (const op of slice) {
      lines.push({ type: op.type, text: op.text });
      if (op.type === ' ' || op.type === '-') aCount++;
      if (op.type === ' ' || op.type === '+') bCount++;
    }
    // Git convention: counts de 0 usam start 0 (em vez de 1)
    if (aCount === 0) aStart = Math.max(0, aStart - 1);
    if (bCount === 0) bStart = Math.max(0, bStart - 1);

    const header = `@@ -${aStart},${aCount} +${bStart},${bCount} @@`;
    hunks.push({ header, lines });
  }

  return hunks;
}

/**
 * Infere uma linguagem Monaco a partir da extensão do path.
 * Lista minimal — o DiffEditor usa só pra syntax highlight do diff.
 */
export function inferMonacoLanguage(path: string): string {
  const m = path.match(/\.([^./\\]+)$/);
  if (!m) return 'plaintext';
  const ext = m[1].toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    jsonc: 'json',
    md: 'markdown',
    mdx: 'markdown',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    hpp: 'cpp',
    cc: 'cpp',
    cs: 'csharp',
    rb: 'ruby',
    php: 'php',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    ps1: 'powershell',
    psm1: 'powershell',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini',
    ini: 'ini',
    xml: 'xml',
    sql: 'sql',
    swift: 'swift',
    kt: 'kotlin',
    kts: 'kotlin',
    vue: 'html',
    svelte: 'html',
  };
  return map[ext] ?? 'plaintext';
}
