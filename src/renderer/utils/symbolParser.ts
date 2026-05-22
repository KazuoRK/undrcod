/**
 * symbolParser — extrator regex-based de símbolos top-level (funções, classes,
 * constantes, interfaces, types, métodos) por linguagem.
 *
 * Não é um parser AST — é heurística por regex em multiline mode. Suficiente
 * pra outline (Ctrl+Shift+O) onde precisão > completude. Falsos positivos são
 * tolerados (ex: linha comentada com `function x`).
 */

export type SymbolKind = 'function' | 'class' | 'method' | 'const' | 'interface' | 'type';

export interface ParsedSymbol {
  name: string;
  kind: SymbolKind;
  line: number; // 1-indexed
}

/** Detecta a linguagem a partir do path (extensão). Fallback 'plain'. */
export function detectLang(path: string): string {
  const ext = path.toLowerCase().split('.').pop() || '';
  if (['ts', 'tsx', 'mts', 'cts'].includes(ext)) return 'ts';
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'js';
  if (ext === 'py') return 'py';
  if (['go'].includes(ext)) return 'go';
  if (['rs'].includes(ext)) return 'rust';
  if (['java', 'kt', 'kts'].includes(ext)) return 'java';
  if (['c', 'cc', 'cpp', 'cxx', 'h', 'hpp'].includes(ext)) return 'c';
  if (['rb'].includes(ext)) return 'rb';
  if (['php'].includes(ext)) return 'php';
  if (['cs'].includes(ext)) return 'cs';
  if (['css', 'scss', 'sass', 'less'].includes(ext)) return 'css';
  return 'plain';
}

interface PatternSpec {
  re: RegExp;
  kind: SymbolKind;
  /** Qual capture group contém o nome. Default 1. */
  group?: number;
}

const TS_JS_PATTERNS: PatternSpec[] = [
  // export? async? function foo
  { re: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+(\w+)/gm, kind: 'function' },
  // export default function foo
  { re: /^export\s+default\s+(?:async\s+)?function\s*\*?\s+(\w+)/gm, kind: 'function' },
  // export? abstract? class Foo
  { re: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/gm, kind: 'class' },
  // export? interface Foo
  { re: /^(?:export\s+)?interface\s+(\w+)/gm, kind: 'interface' },
  // export? type Foo =
  { re: /^(?:export\s+)?type\s+(\w+)\s*=/gm, kind: 'type' },
  // export? const|let|var foo = (...) =>  OR  = async (...) =>  OR  = function
  { re: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|<[^>]+>\s*\([^)]*\))\s*(?::\s*[^=]+)?=>/gm, kind: 'const' },
  { re: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/gm, kind: 'const' },
  // enum
  { re: /^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/gm, kind: 'type' },
];

const PY_PATTERNS: PatternSpec[] = [
  { re: /^(?:async\s+)?def\s+(\w+)/gm, kind: 'function' },
  { re: /^\s+(?:async\s+)?def\s+(\w+)/gm, kind: 'method' },
  { re: /^class\s+(\w+)/gm, kind: 'class' },
];

const GO_PATTERNS: PatternSpec[] = [
  { re: /^func\s+(?:\([^)]+\)\s+)?(\w+)/gm, kind: 'function' },
  { re: /^type\s+(\w+)\s+struct/gm, kind: 'class' },
  { re: /^type\s+(\w+)\s+interface/gm, kind: 'interface' },
  { re: /^type\s+(\w+)\s+/gm, kind: 'type' },
];

const RUST_PATTERNS: PatternSpec[] = [
  { re: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm, kind: 'function' },
  { re: /^(?:pub\s+)?struct\s+(\w+)/gm, kind: 'class' },
  { re: /^(?:pub\s+)?enum\s+(\w+)/gm, kind: 'type' },
  { re: /^(?:pub\s+)?trait\s+(\w+)/gm, kind: 'interface' },
  { re: /^(?:pub\s+)?type\s+(\w+)/gm, kind: 'type' },
];

const JAVA_PATTERNS: PatternSpec[] = [
  { re: /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?class\s+(\w+)/gm, kind: 'class' },
  { re: /^\s*(?:public|private|protected)?\s*interface\s+(\w+)/gm, kind: 'interface' },
  { re: /^\s*(?:public|private|protected)\s+(?:static\s+)?[\w<>,\s\[\]]+\s+(\w+)\s*\([^)]*\)\s*\{?/gm, kind: 'method' },
];

const C_PATTERNS: PatternSpec[] = [
  { re: /^[\w*\s]+?\s(\w+)\s*\([^)]*\)\s*\{/gm, kind: 'function' },
  { re: /^struct\s+(\w+)/gm, kind: 'class' },
  { re: /^typedef\s+(?:struct\s+)?\w+\s+(\w+);/gm, kind: 'type' },
];

const RB_PATTERNS: PatternSpec[] = [
  { re: /^\s*def\s+(?:self\.)?(\w+)/gm, kind: 'function' },
  { re: /^\s*class\s+(\w+)/gm, kind: 'class' },
  { re: /^\s*module\s+(\w+)/gm, kind: 'class' },
];

const PHP_PATTERNS: PatternSpec[] = [
  { re: /^\s*(?:public|private|protected|static)?\s*function\s+(\w+)/gm, kind: 'function' },
  { re: /^\s*(?:abstract\s+)?class\s+(\w+)/gm, kind: 'class' },
  { re: /^\s*interface\s+(\w+)/gm, kind: 'interface' },
];

const CS_PATTERNS: PatternSpec[] = [
  { re: /^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?(?:abstract\s+)?class\s+(\w+)/gm, kind: 'class' },
  { re: /^\s*(?:public|private|protected|internal)?\s*interface\s+(\w+)/gm, kind: 'interface' },
  { re: /^\s*(?:public|private|protected|internal)\s+(?:static\s+)?[\w<>,\s\[\]]+\s+(\w+)\s*\([^)]*\)/gm, kind: 'method' },
];

const CSS_PATTERNS: PatternSpec[] = [
  // .class, #id, --token: simplified, captura selectors top-level
  { re: /^([.#@:][\w-]+(?:[\s,][\w-.#:]+)*)\s*\{/gm, kind: 'const' },
];

function patternsFor(lang: string): PatternSpec[] {
  switch (lang) {
    case 'ts':
    case 'js': return TS_JS_PATTERNS;
    case 'py': return PY_PATTERNS;
    case 'go': return GO_PATTERNS;
    case 'rust': return RUST_PATTERNS;
    case 'java': return JAVA_PATTERNS;
    case 'c': return C_PATTERNS;
    case 'rb': return RB_PATTERNS;
    case 'php': return PHP_PATTERNS;
    case 'cs': return CS_PATTERNS;
    case 'css': return CSS_PATTERNS;
    default: return [];
  }
}

/**
 * Extrai símbolos de um arquivo. Ordena por linha. Deduplica por (name, line).
 * Não percorre arquivos > 1MB pra evitar travar o renderer com regex.
 */
export function parseSymbols(content: string, langOrPath: string): ParsedSymbol[] {
  if (!content) return [];
  if (content.length > 1_000_000) return [];

  // Aceita ou lang direto ('ts', 'py') ou path (.ts, .py).
  const lang = langOrPath.includes('.') || langOrPath.includes('/') || langOrPath.includes('\\')
    ? detectLang(langOrPath)
    : langOrPath;

  const patterns = patternsFor(lang);
  if (patterns.length === 0) return [];

  // Pre-calcula offsets das newlines pra mapear index → line.
  const lineStarts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  const indexToLine = (idx: number): number => {
    // Binary search
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1; // 1-indexed
  };

  const seen = new Set<string>();
  const out: ParsedSymbol[] = [];

  for (const spec of patterns) {
    const re = new RegExp(spec.re.source, spec.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const name = m[spec.group ?? 1];
      if (!name) continue;
      const line = indexToLine(m.index);
      const key = `${name}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, kind: spec.kind, line });
    }
  }

  out.sort((a, b) => a.line - b.line);
  return out;
}

/** Codicon (já carregado pela app) por kind. */
export function iconForKind(kind: SymbolKind): string {
  switch (kind) {
    case 'function': return 'codicon-symbol-function';
    case 'method': return 'codicon-symbol-method';
    case 'class': return 'codicon-symbol-class';
    case 'interface': return 'codicon-symbol-interface';
    case 'type': return 'codicon-symbol-misc';
    case 'const': return 'codicon-symbol-variable';
    default: return 'codicon-symbol-misc';
  }
}
