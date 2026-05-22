/**
 * fuzzyMatch — char-by-char fuzzy scorer com bônus pra:
 *   - consecutive matches (sequência contínua é melhor que esparsa)
 *   - word-start matches (match em início de palavra/CamelHump/separator vale mais)
 *   - matches no começo da string (prefixo)
 *
 * Match é case-insensitive. Retorna {score, matchedIndices} pra highlighting.
 * score === 0 ⇒ não houve match completo (caller deve filtrar).
 *
 * Não é Smith-Waterman nem fzf-completo — é o suficiente pra command palette
 * com ~50-500 itens. Para listas maiores (filesystem grep), o backend já filtra
 * pelo query antes de chegar aqui.
 */

export interface FuzzyResult {
  score: number;
  /** Índices na STRING ORIGINAL (não na query) onde o match casou — pra bold/highlight */
  matchedIndices: number[];
}

const SCORE_MATCH = 16;
const SCORE_CONSECUTIVE = 10;     // bônus extra quando o char anterior também casou
const SCORE_WORD_START = 8;       // bônus quando casa no início de palavra/CamelHump
const SCORE_PREFIX = 6;           // bônus extra quando casa no índice 0
const PENALTY_GAP = -1;           // pequeno custo por char pulado

function isWordBoundary(prev: string | undefined, curr: string): boolean {
  if (prev === undefined) return true;
  // separadores típicos (path, snake/kebab, espaços)
  if (/[\s/\\\-_.:]/.test(prev)) return true;
  // CamelHump: lower → Upper transition
  if (prev === prev.toLowerCase() && prev !== prev.toUpperCase() &&
      curr === curr.toUpperCase() && curr !== curr.toLowerCase()) {
    return true;
  }
  return false;
}

export function fuzzyMatch(target: string, query: string): FuzzyResult {
  if (!query) return { score: 1, matchedIndices: [] }; // query vazia → tudo passa, sem highlight
  if (!target) return { score: 0, matchedIndices: [] };

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact substring shortcut — caso super comum, recompensa fortemente.
  const idx = t.indexOf(q);
  if (idx !== -1) {
    const matched: number[] = [];
    for (let i = 0; i < q.length; i++) matched.push(idx + i);
    let bonus = 0;
    if (idx === 0) bonus += SCORE_PREFIX * 3;
    else if (isWordBoundary(target[idx - 1], target[idx])) bonus += SCORE_WORD_START * 2;
    return {
      score: SCORE_MATCH * q.length + SCORE_CONSECUTIVE * (q.length - 1) + bonus,
      matchedIndices: matched,
    };
  }

  // Char-by-char (greedy left-to-right). Caso geral pra typos / abbreviations.
  let score = 0;
  let prevMatched = -2;
  const matched: number[] = [];
  let ti = 0;

  for (let qi = 0; qi < q.length; qi++) {
    const qc = q[qi];
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === qc) { found = ti; break; }
      ti++;
    }
    if (found === -1) return { score: 0, matchedIndices: [] };

    let charScore = SCORE_MATCH;
    if (found === prevMatched + 1) charScore += SCORE_CONSECUTIVE;
    if (isWordBoundary(target[found - 1], target[found])) charScore += SCORE_WORD_START;
    if (found === 0) charScore += SCORE_PREFIX;

    // gap penalty
    const gap = found - prevMatched - 1;
    if (gap > 0 && prevMatched >= 0) charScore += PENALTY_GAP * gap;

    score += charScore;
    matched.push(found);
    prevMatched = found;
    ti = found + 1;
  }

  return { score: Math.max(1, score), matchedIndices: matched };
}

/**
 * Ranqueia uma lista de itens. Itens com score=0 são filtrados.
 * Stable sort — empate preserva ordem original (insertion order do registry).
 */
export function fuzzyRank<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
): Array<{ item: T; result: FuzzyResult }> {
  return items
    .map((item, i) => ({ item, i, result: fuzzyMatch(getText(item), query) }))
    .filter((x) => x.result.score > 0)
    .sort((a, b) => {
      if (b.result.score !== a.result.score) return b.result.score - a.result.score;
      return a.i - b.i;
    })
    .map(({ item, result }) => ({ item, result }));
}
