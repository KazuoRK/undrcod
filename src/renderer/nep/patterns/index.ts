/**
 * Pattern Registry — registra todos os patterns disponíveis e fornece
 * lookup por language.
 *
 * Patterns são organizados por arquivo:
 *   - universal.ts — 6 patterns que aplicam a qualquer linguagem
 *   - jsts.ts      — 10 patterns específicos de JavaScript/TypeScript
 *
 * Pra adicionar um novo pattern: cria no arquivo certo, exporta, e adiciona
 * em `ALL_PATTERNS` aqui.
 */

import type { EditPattern } from '../types';
import { UNIVERSAL_PATTERNS } from './universal';
import { JS_TS_PATTERNS } from './jsts';

export const ALL_PATTERNS: EditPattern[] = [
  ...UNIVERSAL_PATTERNS,
  ...JS_TS_PATTERNS,
];

/**
 * Retorna patterns aplicáveis a uma linguagem. Inclui:
 *   - Patterns com `languages: ['*']` (universais)
 *   - Patterns que listam essa language explicitamente
 *
 * Match é case-insensitive nos language ids ('typescript' === 'TypeScript').
 */
export function getPatternsForLanguage(languageId: string): EditPattern[] {
  const lang = languageId.toLowerCase();
  return ALL_PATTERNS.filter((p) =>
    p.languages.some((l) => l === '*' || l.toLowerCase() === lang),
  );
}

/** Lookup por id. */
export function getPatternById(id: string): EditPattern | undefined {
  return ALL_PATTERNS.find((p) => p.id === id);
}
