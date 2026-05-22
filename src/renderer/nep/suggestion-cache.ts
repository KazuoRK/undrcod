/**
 * SuggestionCache — LRU simples por filePath.
 *
 * `get()` move o entry pro topo (most-recent). `set()` em cima de capacidade
 * ejeta o least-recently-used. Default = 10 arquivos.
 *
 * Não persiste — vive só na memória do renderer.
 */

import type { EditSuggestion } from './types';

const DEFAULT_MAX_FILES = 10;

export class SuggestionCache {
  private readonly maxFiles: number;
  /** Map mantém ordem de inserção; explora isso pra LRU. */
  private readonly store = new Map<string, EditSuggestion[]>();

  constructor(maxFiles: number = DEFAULT_MAX_FILES) {
    this.maxFiles = Math.max(1, maxFiles);
  }

  /** Lê sugestões e marca o arquivo como most-recently-used. */
  get(filePath: string): EditSuggestion[] | undefined {
    if (!this.store.has(filePath)) return undefined;
    const value = this.store.get(filePath);
    // Re-insert pra mover pro fim (most-recent).
    this.store.delete(filePath);
    if (value !== undefined) this.store.set(filePath, value);
    return value;
  }

  /** Grava sugestões. Ejeta o LRU se passar do cap. */
  set(filePath: string, suggestions: EditSuggestion[]): void {
    if (this.store.has(filePath)) {
      this.store.delete(filePath);
    }
    this.store.set(filePath, suggestions);
    while (this.store.size > this.maxFiles) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }

  /** Remove o entry de um arquivo. */
  invalidate(filePath: string): void {
    this.store.delete(filePath);
  }

  /** Esvazia o cache inteiro. */
  clear(): void {
    this.store.clear();
  }
}
