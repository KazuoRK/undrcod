/**
 * PatternMatcher — orquestra a execução de todos os patterns aplicáveis
 * a um `EditDiff` e devolve `EditSuggestion[]` consolidado.
 *
 * Pipeline por diff:
 *   1. getPatternsForLanguage(languageId)
 *   2. pra cada pattern: detect() → findTargets()
 *   3. dedup por (line, startCol, endCol, suggestedText), keep maior conf
 *   4. sort por confidence DESC, line ASC
 *   5. cap em 20 sugestões
 *
 * Resiliência: pattern que joga exception NÃO derruba o matcher — só
 * console.warn e segue. Latência: alvo < 50ms total; warn se um pattern
 * passa de 10ms (sinaliza pattern caro pra otimizar depois).
 */

import type { editor } from 'monaco-editor';
import type { EditDiff, EditSuggestion, PatternContext } from './types';
import { getPatternsForLanguage } from './patterns';

const MAX_SUGGESTIONS = 20;
const SLOW_PATTERN_THRESHOLD_MS = 10;

export class PatternMatcher {
  /** Roda todos os patterns aplicáveis e devolve sugestões consolidadas. */
  process(
    diff: EditDiff,
    model: editor.ITextModel,
    filePath: string,
  ): EditSuggestion[] {
    const languageId = model.getLanguageId();
    const patterns = getPatternsForLanguage(languageId);
    if (patterns.length === 0) return [];

    const fullText = model.getValue();
    const ctx: PatternContext = {
      filePath,
      languageId,
      lineNumber: diff.lineNumber,
      fullText,
      model,
    };

    const collected: EditSuggestion[] = [];

    for (const pattern of patterns) {
      const t0 =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      try {
        const match = pattern.detect(diff.before, diff.after, ctx);
        if (!match) continue;
        const targets = pattern.findTargets(fullText, match, ctx);
        if (targets && targets.length > 0) {
          for (const t of targets) collected.push(t);
        }
      } catch (err) {
        console.warn(`[PatternMatcher] pattern "${pattern.id}" threw:`, err);
      } finally {
        const t1 =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        const elapsed = t1 - t0;
        if (elapsed > SLOW_PATTERN_THRESHOLD_MS) {
          console.warn(
            `[PatternMatcher] pattern "${pattern.id}" levou ${elapsed.toFixed(1)}ms`,
          );
        }
      }
    }

    if (collected.length === 0) return [];

    // Dedup por (line, startCol, endCol, suggestedText), keep maior confidence
    const byKey = new Map<string, EditSuggestion>();
    for (const s of collected) {
      const key = `${s.line}:${s.startCol}:${s.endCol}:${s.suggestedText}`;
      const prev = byKey.get(key);
      if (!prev || s.confidence > prev.confidence) {
        byKey.set(key, s);
      }
    }

    const deduped = Array.from(byKey.values());

    // Sort: confidence DESC, line ASC
    deduped.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.line - b.line;
    });

    if (deduped.length > MAX_SUGGESTIONS) {
      return deduped.slice(0, MAX_SUGGESTIONS);
    }
    return deduped;
  }
}
