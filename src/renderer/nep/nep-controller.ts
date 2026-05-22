/**
 * NepController — top-level coordinator do NEP. Conecta:
 *
 *   EditObserver → PatternMatcher → SuggestionCache → GhostEditRenderer
 *
 * Expõe API pra React (StatusBar, settings panel) e gerencia lifecycle.
 *
 * Settings dinâmicos: `updateSettings()` aplica em runtime. Quando
 * `enabled: false`, todo o pipeline vira no-op e sugestões existentes
 * são limpas.
 */

import type { editor } from 'monaco-editor';
import type { EditDiff, EditSuggestion, NepSettings } from './types';
import { DEFAULT_NEP_SETTINGS } from './types';
import { EditObserver } from './edit-observer';
import { PatternMatcher } from './pattern-matcher';
import { SuggestionCache } from './suggestion-cache';
import { GhostEditRenderer } from './ghost-edit-renderer';

export class NepController {
  private readonly editor: editor.IStandaloneCodeEditor;
  private filePath: string;
  private settings: NepSettings;

  private readonly observer: EditObserver;
  private readonly matcher: PatternMatcher;
  private readonly cache: SuggestionCache;
  private readonly renderer: GhostEditRenderer;

  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(
    monacoEditor: editor.IStandaloneCodeEditor,
    filePath: string,
    settings?: Partial<NepSettings>,
  ) {
    this.editor = monacoEditor;
    this.filePath = filePath;
    this.settings = { ...DEFAULT_NEP_SETTINGS, ...(settings ?? {}) };

    this.matcher = new PatternMatcher();
    this.cache = new SuggestionCache();
    this.renderer = new GhostEditRenderer(monacoEditor, {
      onAccept: (suggestion) => this.handleAccept(suggestion),
      onDismiss: () => this.handleDismiss(),
    });

    this.observer = new EditObserver(monacoEditor, (diff) => this.handleEdit(diff));
  }

  /** Atualiza settings em runtime (merge parcial). */
  updateSettings(partial: Partial<NepSettings>): void {
    const wasEnabled = this.settings.enabled;
    this.settings = { ...this.settings, ...partial };

    if (wasEnabled && !this.settings.enabled) {
      // desligou: limpa render + cache do arquivo atual
      this.cache.invalidate(this.filePath);
      this.renderer.setSuggestions([]);
      this.notify();
    } else if (!wasEnabled && this.settings.enabled) {
      // ligou: só notifica; sugestões virão no próximo edit
      this.notify();
    } else {
      // reaplica threshold sobre as ativas (caso tenha mudado)
      const cached = this.cache.get(this.filePath) ?? [];
      const filtered = cached.filter(
        (s) => s.confidence >= this.settings.confidenceThreshold,
      );
      this.renderer.setSuggestions(filtered);
      this.notify();
    }
  }

  /** Quantas sugestões ativas existem pro arquivo atual. */
  getActiveCount(): number {
    return this.cache.get(this.filePath)?.length ?? 0;
  }

  /** Atalho pra liga/desliga rápido (StatusBar click). */
  setEnabled(enabled: boolean): void {
    this.updateSettings({ enabled });
  }

  /** Inscreve listener pra mudanças de estado. Devolve unsubscribe. */
  onStateChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Cleanup completo — chamar no unmount do editor. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.dispose();
    this.renderer.dispose();
    this.cache.clear();
    this.listeners.clear();
  }

  // ---------- internals ----------

  private handleEdit(diff: EditDiff): void {
    if (this.disposed) return;
    if (!this.settings.enabled) return;

    const model = this.editor.getModel();
    if (!model) return;

    const suggestions = this.matcher.process(diff, model, this.filePath);
    const filtered = suggestions.filter(
      (s) => s.confidence >= this.settings.confidenceThreshold,
    );

    if (filtered.length === 0) {
      // limpa estado anterior caso existisse
      this.cache.invalidate(this.filePath);
      this.renderer.setSuggestions([]);
      this.notify();
      return;
    }

    this.cache.set(this.filePath, filtered);
    this.renderer.setSuggestions(filtered);
    this.notify();
  }

  private handleAccept(accepted: EditSuggestion): void {
    if (this.disposed) return;
    const current = this.cache.get(this.filePath) ?? [];
    const remaining = current.filter(
      (s) =>
        s.line !== accepted.line ||
        s.startCol !== accepted.startCol ||
        s.endCol !== accepted.endCol ||
        s.suggestedText !== accepted.suggestedText,
    );
    if (remaining.length === 0) {
      this.cache.invalidate(this.filePath);
    } else {
      this.cache.set(this.filePath, remaining);
    }
    this.renderer.setSuggestions(remaining);
    this.notify();
  }

  private handleDismiss(): void {
    if (this.disposed) return;
    this.cache.invalidate(this.filePath);
    this.renderer.setSuggestions([]);
    this.notify();
  }

  private notify(): void {
    for (const cb of this.listeners) {
      try {
        cb();
      } catch (err) {
        console.warn('[NepController] listener threw:', err);
      }
    }
  }
}
