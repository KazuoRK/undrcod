/**
 * GhostEditRenderer — camada visual do NEP (Next Edit Prediction).
 *
 * Responsabilidades:
 *   - Renderiza ghost text (texto sugerido em cinza/italic) na linha CURRENT
 *   - Renderiza gutter dots (bolinhas accent) em todas as linhas com sugestao
 *   - Registra keybindings no Monaco (Tab/Esc/Alt+]/Alt+[/Ctrl+Shift+Enter)
 *   - Aplica edits no model via applyEdits (preserva undo)
 *
 * NAO gerencia:
 *   - Quais sugestoes existem (job do controller — quem chama setSuggestions)
 *   - Geracao das sugestoes (job dos patterns / PatternMatcher)
 *
 * Reference: docs/NEP-STRATEGY.md, secao UX
 */

import * as monaco from 'monaco-editor';
import type { editor, IDisposable } from 'monaco-editor';
import type { EditSuggestion } from './types';

interface GhostEditCallbacks {
  onAccept?: (suggestion: EditSuggestion, index: number) => void;
  onAcceptAll?: () => void;
  onDismiss?: () => void;
  onNavigate?: (index: number) => void;
}

/** Flag global pra injetar o <style> uma unica vez por documento. */
let stylesInjected = false;

/**
 * Injeta as regras CSS do ghost edit + gutter dots no <head> uma unica vez.
 * Idempotente — chamadas subsequentes sao no-op.
 */
function injectStyles(): void {
  if (stylesInjected) return;
  if (typeof document === 'undefined') return; // SSR guard, paranoia

  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-undrcod-nep', 'ghost-edit-renderer');
  styleEl.textContent = `
    .nep-gutter-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent, #4F8FFA);
      margin-left: 4px;
      margin-top: 7px;
      box-shadow: 0 0 4px color-mix(in oklab, var(--accent, #4F8FFA) 50%, transparent);
    }
    .nep-gutter-dot.is-current {
      background: var(--accent, #4F8FFA);
      transform: scale(1.3);
      box-shadow: 0 0 8px color-mix(in oklab, var(--accent, #4F8FFA) 70%, transparent);
    }
    .nep-ghost-text-inline {
      color: var(--fg-muted, #7a7a82) !important;
      opacity: 0.6;
      font-style: italic;
    }
  `;
  document.head.appendChild(styleEl);
  stylesInjected = true;
}

export class GhostEditRenderer {
  private editor: editor.IStandaloneCodeEditor;
  private callbacks: GhostEditCallbacks;

  /** Sugestoes ativas. Vazio = nada renderizado. */
  private suggestions: EditSuggestion[] = [];
  /** Indice da sugestao "current" (ghost text visivel). -1 se nao tem. */
  private currentIndex = -1;

  /** IDs das decorations atuais — pra deltaDecorations limpar. */
  private decorationIds: string[] = [];

  /** Context key que liga/desliga o Tab handler. */
  private hasSuggestionsCtx: monaco.editor.IContextKey<boolean>;

  /** Disposables das addCommand / addAction registrados. */
  private disposables: IDisposable[] = [];

  /** Flag pra evitar re-entry quando applyEdits dispara onDidChangeModelContent. */
  private isApplyingEdit = false;

  constructor(
    monacoEditor: editor.IStandaloneCodeEditor,
    callbacks: GhostEditCallbacks,
  ) {
    this.editor = monacoEditor;
    this.callbacks = callbacks;

    injectStyles();

    // Context key — usada pra gating do Tab. False ate ter sugestao ativa.
    this.hasSuggestionsCtx = monacoEditor.createContextKey<boolean>(
      'nepHasSuggestions',
      false,
    );

    this.registerKeybindings();
  }

  // ── API publica ────────────────────────────────────────────────────────────

  setSuggestions(suggestions: EditSuggestion[]): void {
    this.suggestions = suggestions.slice();
    this.currentIndex = suggestions.length > 0 ? 0 : -1;
    this.hasSuggestionsCtx.set(suggestions.length > 0);
    this.render();
  }

  clear(): void {
    this.suggestions = [];
    this.currentIndex = -1;
    this.hasSuggestionsCtx.set(false);
    this.decorationIds = this.editor.deltaDecorations(this.decorationIds, []);
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  acceptCurrent(): void {
    if (this.currentIndex < 0 || this.currentIndex >= this.suggestions.length) {
      return;
    }
    const suggestion = this.suggestions[this.currentIndex];
    const index = this.currentIndex;

    const applied = this.applySuggestion(suggestion);
    if (!applied) {
      // Sugestao stale (texto na posicao mudou) — pula pra proxima.
      this.advanceAfterAccept(index, false);
      return;
    }

    this.callbacks.onAccept?.(suggestion, index);
    this.advanceAfterAccept(index, true);
  }

  dispose(): void {
    this.clear();
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        // ignore — editor pode ja ter sido destruido
      }
    }
    this.disposables = [];
  }

  // ── Interno ────────────────────────────────────────────────────────────────

  /**
   * Re-valida sugestoes restantes apos um accept — checa se o (line, currentText)
   * ainda bate com o conteudo do model. Sugestoes stale sao removidas.
   *
   * Assume single-line replacements (per spec v1) — nao tenta ajustar line shifts.
   */
  private revalidateSuggestions(): void {
    const model = this.editor.getModel();
    if (!model) {
      this.suggestions = [];
      return;
    }
    this.suggestions = this.suggestions.filter((s) => {
      if (s.line < 1 || s.line > model.getLineCount()) return false;
      const lineText = model.getLineContent(s.line);
      // Confere se o slice (startCol..endCol) ainda contem currentText.
      // Cols sao 1-based, exclusive end — substring usa 0-based, exclusive end.
      const actual = lineText.substring(s.startCol - 1, s.endCol - 1);
      return actual === s.currentText;
    });
  }

  /**
   * Avanca o currentIndex apos um accept (ou skip de stale). Re-renderiza ou clear.
   */
  private advanceAfterAccept(acceptedIndex: number, didApply: boolean): void {
    // Remove a sugestao aceita do array.
    this.suggestions.splice(acceptedIndex, 1);

    // Se aplicamos um edit, re-valida o resto (texto pode ter shiftado em casos edge).
    if (didApply) {
      this.revalidateSuggestions();
    }

    if (this.suggestions.length === 0) {
      this.clear();
      return;
    }

    // Mantem o mesmo index (proxima sugestao "tomou o lugar" da aceita).
    // Clamp pra nao estourar.
    this.currentIndex = Math.min(acceptedIndex, this.suggestions.length - 1);
    this.render();
  }

  /**
   * Aplica um edit ao model via applyEdits — preserva undo history.
   * Retorna false se a posicao nao bate mais com currentText (stale).
   */
  private applySuggestion(suggestion: EditSuggestion): boolean {
    const model = this.editor.getModel();
    if (!model) return false;

    if (suggestion.line < 1 || suggestion.line > model.getLineCount()) return false;
    const lineText = model.getLineContent(suggestion.line);
    const actual = lineText.substring(
      suggestion.startCol - 1,
      suggestion.endCol - 1,
    );
    if (actual !== suggestion.currentText) return false;

    const range = new monaco.Range(
      suggestion.line,
      suggestion.startCol,
      suggestion.line,
      suggestion.endCol,
    );

    this.isApplyingEdit = true;
    try {
      model.applyEdits([
        {
          range,
          text: suggestion.suggestedText,
          forceMoveMarkers: true,
        },
      ]);
    } finally {
      this.isApplyingEdit = false;
    }
    return true;
  }

  /**
   * Aplica todas as sugestoes restantes em UMA transacao no model.
   * Aplica de baixo pra cima pra nao invalidar cols das sugestoes acima.
   */
  private applyAllSuggestions(): void {
    const model = this.editor.getModel();
    if (!model) return;

    const validEdits: editor.IIdentifiedSingleEditOperation[] = [];
    // Ordena desc por (line, startCol) — bottom-up pra preservar offsets.
    const sorted = this.suggestions.slice().sort((a, b) => {
      if (a.line !== b.line) return b.line - a.line;
      return b.startCol - a.startCol;
    });

    for (const s of sorted) {
      if (s.line < 1 || s.line > model.getLineCount()) continue;
      const lineText = model.getLineContent(s.line);
      const actual = lineText.substring(s.startCol - 1, s.endCol - 1);
      if (actual !== s.currentText) continue;
      validEdits.push({
        range: new monaco.Range(s.line, s.startCol, s.line, s.endCol),
        text: s.suggestedText,
        forceMoveMarkers: true,
      });
    }

    if (validEdits.length === 0) return;

    this.isApplyingEdit = true;
    try {
      model.pushEditOperations([], validEdits, () => null);
    } finally {
      this.isApplyingEdit = false;
    }
  }

  /**
   * Re-renderiza decorations baseado no estado atual (suggestions + currentIndex).
   * Idempotente.
   */
  private render(): void {
    if (this.suggestions.length === 0) {
      this.decorationIds = this.editor.deltaDecorations(this.decorationIds, []);
      return;
    }

    const newDecorations: editor.IModelDeltaDecoration[] = [];

    // 1) Gutter dot em CADA sugestao
    this.suggestions.forEach((s, idx) => {
      const isCurrent = idx === this.currentIndex;
      newDecorations.push({
        range: new monaco.Range(s.line, 1, s.line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: isCurrent
            ? 'nep-gutter-dot is-current'
            : 'nep-gutter-dot',
          stickiness:
            monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });
    });

    // 2) Ghost text inline APENAS na current
    if (this.currentIndex >= 0 && this.currentIndex < this.suggestions.length) {
      const cur = this.suggestions[this.currentIndex];
      // Range "vazio" no fim do texto que sera substituido — Monaco renderiza
      // o "after" content depois desse ponto.
      const ghostRange = new monaco.Range(
        cur.line,
        cur.endCol,
        cur.line,
        cur.endCol,
      );
      newDecorations.push({
        range: ghostRange,
        options: {
          after: {
            content: ` ${cur.suggestedText}`,
            inlineClassName: 'nep-ghost-text-inline',
          },
          stickiness:
            monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });
    }

    this.decorationIds = this.editor.deltaDecorations(
      this.decorationIds,
      newDecorations,
    );
  }

  /**
   * Registra todos os keybindings na editor. Cada um respeita context keys
   * pra nao roubar atalho default quando NEP nao esta ativo.
   */
  private registerKeybindings(): void {
    // Tab — accept current. Gated por:
    //   nepHasSuggestions: temos sugestao visivel
    //   !editorTabMovesFocus: usuario nao esta em modo "Tab moves focus"
    //   !suggestWidgetVisible: autocomplete nao esta aberto (senao Tab vai pro autocomplete)
    //   !inlineSuggestionVisible: inline completion (Copilot-like) nao ta visivel
    const tabDisp = this.editor.addCommand(
      monaco.KeyCode.Tab,
      () => {
        this.acceptCurrent();
      },
      'nepHasSuggestions && !editorTabMovesFocus && !suggestWidgetVisible && !inlineSuggestionVisible',
    );
    // addCommand pode retornar string (id) ou null em algumas versions.
    // Wrappa em disposable defensivo se for IDisposable-like.
    if (tabDisp && typeof (tabDisp as unknown as IDisposable).dispose === 'function') {
      this.disposables.push(tabDisp as unknown as IDisposable);
    }

    // Escape — dismiss all
    this.disposables.push(
      this.editor.addAction({
        id: 'undrcod.nep.dismiss',
        label: 'NEP: Dismiss suggestions',
        keybindings: [monaco.KeyCode.Escape],
        precondition:
          'nepHasSuggestions && !suggestWidgetVisible && !inlineSuggestionVisible && !findWidgetVisible',
        run: () => {
          this.callbacks.onDismiss?.();
          this.clear();
        },
      }),
    );

    // Alt+] — next suggestion (sem accept)
    this.disposables.push(
      this.editor.addAction({
        id: 'undrcod.nep.next',
        label: 'NEP: Next suggestion',
        keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.BracketRight],
        precondition: 'nepHasSuggestions',
        run: () => {
          this.navigate(1);
        },
      }),
    );

    // Alt+[ — previous suggestion
    this.disposables.push(
      this.editor.addAction({
        id: 'undrcod.nep.prev',
        label: 'NEP: Previous suggestion',
        keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.BracketLeft],
        precondition: 'nepHasSuggestions',
        run: () => {
          this.navigate(-1);
        },
      }),
    );

    // Ctrl+Shift+Enter — accept all
    this.disposables.push(
      this.editor.addAction({
        id: 'undrcod.nep.acceptAll',
        label: 'NEP: Accept all suggestions',
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
        ],
        precondition: 'nepHasSuggestions',
        run: () => {
          this.callbacks.onAcceptAll?.();
          this.applyAllSuggestions();
          this.clear();
        },
      }),
    );
  }

  /**
   * Move o currentIndex por `delta` (+1 = next, -1 = prev). Wraps around.
   * Re-renderiza pra mover o ghost text + atualizar o gutter dot highlight.
   */
  private navigate(delta: number): void {
    if (this.suggestions.length === 0) return;
    const n = this.suggestions.length;
    this.currentIndex = (this.currentIndex + delta + n) % n;

    // Reveal a linha da nova current — quality of life pro user.
    const cur = this.suggestions[this.currentIndex];
    if (cur) {
      this.editor.revealLineInCenterIfOutsideViewport(cur.line);
    }

    this.callbacks.onNavigate?.(this.currentIndex);
    this.render();
  }
}
