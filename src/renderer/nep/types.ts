/**
 * NEP (Next Edit Prediction) — types compartilhados.
 *
 * Reference: docs/NEP-STRATEGY.md
 *
 * Estratégia: detectar o que o user acabou de editar e sugerir
 * automaticamente onde mais no arquivo precisa da mesma mudança.
 * Sem IA, $0 custo, ~1-20ms latência.
 *
 * Pipeline:
 *   EditObserver (Monaco onDidChangeModelContent)
 *     → diff (before, after, lineNumber)
 *     → PatternMatcher.process(diff, model)
 *         → Monaco LS (Tier 1A, opcional v1)
 *         → PatternRegistry.detectAll(diff)
 *             → cada pattern.detect() retorna PatternMatch | null
 *             → pattern.findTargets() retorna EditSuggestion[]
 *         → SuggestionCache.set(filePath, suggestions)
 *         → GhostEditRenderer.render(suggestions)
 */

import type { editor } from 'monaco-editor';

/** Contexto passado pros patterns no detect/findTargets. */
export interface PatternContext {
  filePath: string;
  /** Monaco language id: 'typescript', 'javascript', 'css', etc. */
  languageId: string;
  /** Número da linha editada (1-based, igual Monaco). */
  lineNumber: number;
  /** Conteúdo completo do arquivo após o edit. */
  fullText: string;
  /** Modelo Monaco — pra LS queries (findRenameLocations etc). */
  model: editor.ITextModel;
}

/** Resultado do detect() — o pattern reconheceu a mudança. */
export interface PatternMatch {
  /** Pattern id (mesmo do EditPattern.id). */
  patternId: string;
  /** Token/texto original (antes do edit). */
  oldToken: string;
  /** Token/texto novo (depois do edit). */
  newToken: string;
  /** Linha onde o edit aconteceu (1-based). */
  sourceLine: number;
  /** Meta extra opcional pro findTargets. */
  meta?: Record<string, unknown>;
}

/** Uma sugestão de edit pendente — onde aplicar a mesma mudança. */
export interface EditSuggestion {
  /** Linha onde a sugestão aplica (1-based). */
  line: number;
  /** Coluna inicial (1-based, Monaco-style). */
  startCol: number;
  /** Coluna final (1-based, exclusive). */
  endCol: number;
  /** Texto atual nessa posição. */
  currentText: string;
  /** Texto sugerido. */
  suggestedText: string;
  /** Confiança 0-1. Sugestões < 0.5 são filtradas. */
  confidence: number;
  /** Pattern id que gerou. */
  patternId: string;
}

/** Diff capturado pelo EditObserver. */
export interface EditDiff {
  /** Linha onde o edit aconteceu (1-based). Se multi-line, a primeira. */
  lineNumber: number;
  /** Conteúdo da linha ANTES do edit. */
  before: string;
  /** Conteúdo da linha DEPOIS do edit. */
  after: string;
}

/** Interface pública de um pattern. Patterns implementam isso. */
export interface EditPattern {
  /** Identificador único (kebab-case por convenção). */
  id: string;
  /** Nome legível pro user. */
  name: string;
  /** Languages onde aplica. '*' = todas. */
  languages: string[];
  /**
   * Tenta reconhecer o pattern no diff. Retorna match ou null.
   * Deve ser RÁPIDO (< 5ms ideal) — chamado em todo keystroke.
   */
  detect(before: string, after: string, ctx: PatternContext): PatternMatch | null;
  /**
   * Dado o match, busca outras posições no arquivo pra aplicar a mesma mudança.
   * Pode usar regex no fullText OU Monaco LS via ctx.model. Retorna lista.
   * Sugestões devem EXCLUIR a linha onde o edit original aconteceu.
   */
  findTargets(fileContent: string, match: PatternMatch, ctx: PatternContext): EditSuggestion[];
}

/** Estado interno do controller — exposto pro UI (StatusBar etc). */
export interface NepState {
  enabled: boolean;
  /** Sugestões ativas no arquivo atual. */
  activeSuggestions: EditSuggestion[];
  /** Índice da sugestão "current" (highlighted), -1 se nenhuma. */
  currentIndex: number;
}

/** Settings — controla comportamento do NEP. */
export interface NepSettings {
  enabled: boolean;
  showGutterDots: boolean;
  /** Confidence mínima pra render. Defaults 0.5. */
  confidenceThreshold: number;
  /** Tier 2 (IA opt-in) — não implementado v1, deixado pro futuro. */
  tier2Enabled: boolean;
  tier2MaxPerHour: number;
}

export const DEFAULT_NEP_SETTINGS: NepSettings = {
  enabled: true,
  showGutterDots: true,
  confidenceThreshold: 0.5,
  tier2Enabled: false,
  tier2MaxPerHour: 15,
};

/** Helpers — utility comum aos patterns. */

/** Escapa um string pra uso seguro em RegExp. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Word-boundary regex match. Retorna posições (1-based line/col) no texto. */
export interface TokenLocation {
  line: number;
  startCol: number;
  endCol: number;
  /** Texto completo da linha (pra patterns que precisam contexto). */
  lineText: string;
}

/**
 * Busca todas as ocorrências de `token` no texto (word-boundary por padrão).
 * Retorna array de TokenLocation. Linhas 1-based, cols 1-based.
 *
 * Limit: para após `maxResults` matches OU `maxLines` linhas — proteção
 * contra arquivos gigantes que travariam o UI.
 */
export function findTokenLocations(
  fullText: string,
  token: string,
  options: {
    wordBoundary?: boolean;
    maxResults?: number;
    maxLines?: number;
    /** Linha pra EXCLUIR (a origem do edit, não queremos sugerir nela). */
    excludeLine?: number;
  } = {},
): TokenLocation[] {
  const {
    wordBoundary = true,
    maxResults = 50,
    maxLines = 2000,
    excludeLine = -1,
  } = options;

  const escaped = escapeRegex(token);
  const pattern = wordBoundary ? `\\b${escaped}\\b` : escaped;
  const re = new RegExp(pattern, 'g');

  const lines = fullText.split('\n');
  const limit = Math.min(lines.length, maxLines);
  const results: TokenLocation[] = [];

  for (let i = 0; i < limit; i++) {
    const lineNumber = i + 1;
    if (lineNumber === excludeLine) continue;
    const lineText = lines[i];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lineText)) !== null) {
      results.push({
        line: lineNumber,
        startCol: m.index + 1,
        endCol: m.index + m[0].length + 1,
        lineText,
      });
      if (results.length >= maxResults) return results;
    }
  }
  return results;
}
