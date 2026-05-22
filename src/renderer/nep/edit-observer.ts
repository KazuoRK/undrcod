/**
 * EditObserver — hook no Monaco `onDidChangeModelContent` que gera
 * `EditDiff` (before/after de UMA linha) pro PatternMatcher consumir.
 *
 * Limitações v1:
 *   - Single-line edits apenas. Multi-line é skipado.
 *   - Debounce de 100ms: keystrokes em rajada colapsam num único diff.
 *   - Não distingue edits feitos por `applyEdits` próprio (callers
 *     externos podem usar `setSuppressed(true)` antes de aplicar).
 *
 * Reference: docs/NEP-STRATEGY.md
 */

import type { editor, IDisposable } from 'monaco-editor';
import type { EditDiff } from './types';

const DEBOUNCE_MS = 100;

export class EditObserver {
  private readonly editor: editor.IStandaloneCodeEditor;
  private readonly model: editor.ITextModel;
  private readonly onEdit: (diff: EditDiff) => void;
  private readonly disposable: IDisposable;

  /** Cache de "estado anterior" das linhas — pra reconstruir o `before`. */
  private readonly lineSnapshot = new Map<number, string>();

  /** Pending debounce state. */
  private pendingLine: number | null = null;
  private pendingBefore: string | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Flag pra ignorar edits programáticos do próprio NEP. */
  private suppressed = false;

  /** Já foi disposto? Evita callbacks após dispose. */
  private disposed = false;

  constructor(
    monacoEditor: editor.IStandaloneCodeEditor,
    onEdit: (diff: EditDiff) => void,
  ) {
    this.editor = monacoEditor;
    this.onEdit = onEdit;

    const model = monacoEditor.getModel();
    if (!model) {
      throw new Error('EditObserver: editor sem model anexado');
    }
    this.model = model;

    // snapshot inicial — populated lazily por linha pra não custar
    // O(N) no construtor de arquivos grandes; popula on-demand no listener.

    // ITextModel só tem `onDidChangeContent`; o editor é quem tem
     // `onDidChangeModelContent`. Usamos a do model (suficiente pra v1).
    this.disposable = this.model.onDidChangeContent((e) => {
      if (this.disposed || this.suppressed) {
        // Sincroniza snapshot mesmo suppressed, senão `before` fica stale.
        this.refreshSnapshotForChanges(e.changes);
        return;
      }
      this.handleChange(e);
    });
  }

  /** Ativa/desativa o filtro de auto-edits (usado antes de `applyEdits`). */
  setSuppressed(value: boolean): void {
    this.suppressed = value;
  }

  /** Remove listener e limpa timers. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.disposable.dispose();
    this.lineSnapshot.clear();
  }

  // ---------- internals ----------

  private handleChange(e: editor.IModelContentChangedEvent): void {
    const changes = e.changes;
    if (changes.length === 0) return;
    const change = changes[0];
    const range = change.range;

    // Single-line only: range em UMA linha + texto novo sem `\n`.
    const spansMultipleLines =
      range.startLineNumber !== range.endLineNumber || change.text.includes('\n');
    if (spansMultipleLines) {
      // ainda sincroniza snapshot pra próximos edits ficarem consistentes
      this.refreshSnapshotForChanges(changes);
      return;
    }

    const lineNumber = range.startLineNumber;

    // Captura `before` ANTES de refresh do snapshot.
    let before: string;
    if (this.lineSnapshot.has(lineNumber)) {
      before = this.lineSnapshot.get(lineNumber) ?? '';
    } else {
      // Primeira vez vendo essa linha: tenta reconstruir a partir do
      // conteúdo atual + reversão da change. Como `range` é pré-edit,
      // pegamos a linha atual e desfazemos o splice.
      before = this.reconstructBefore(lineNumber, range, change.text);
    }

    // Atualiza snapshot pra TODAS linhas afetadas (incluindo a atual).
    this.refreshSnapshotForChanges(changes);

    const after = this.model.getLineContent(lineNumber);

    if (before === after) return; // edit no-op (raro mas possível)

    // Debounce: se já tem pending pra MESMA linha, mantém o `before`
    // original e atualiza o `after` final no fire. Se for outra linha,
    // dispara o anterior imediato e começa novo.
    if (this.pendingLine !== null && this.pendingLine !== lineNumber) {
      this.flushPending();
    }

    if (this.pendingLine === null) {
      this.pendingLine = lineNumber;
      this.pendingBefore = before;
    }
    // (se já era a mesma linha, mantém o `pendingBefore` antigo — captura
    // o estado anterior à RAJADA inteira, não só ao último keystroke)

    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flushPending(), DEBOUNCE_MS);
  }

  private flushPending(): void {
    if (this.disposed) return;
    if (this.pendingLine === null || this.pendingBefore === null) return;

    const line = this.pendingLine;
    const before = this.pendingBefore;
    this.pendingLine = null;
    this.pendingBefore = null;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // `after` é o estado ATUAL — pode ter mudado durante o debounce.
    const after = this.model.getLineContent(line);
    if (before === after) return;

    try {
      this.onEdit({ lineNumber: line, before, after });
    } catch (err) {
      console.warn('[EditObserver] onEdit callback threw:', err);
    }
  }

  /** Atualiza o snapshot com o conteúdo atual das linhas mexidas. */
  private refreshSnapshotForChanges(
    changes: readonly editor.IModelContentChange[],
  ): void {
    // Edits podem ter shiftado linhas; pra simplificar, invalidamos
    // o cache inteiro e populamos só as linhas tocadas com o estado atual.
    // Se vier um edit mais tarde noutra linha, reconstruímos on-demand.
    const lineCount = this.model.getLineCount();
    const touched = new Set<number>();
    for (const c of changes) {
      const start = Math.min(c.range.startLineNumber, lineCount);
      const end = Math.min(c.range.endLineNumber, lineCount);
      for (let ln = start; ln <= end; ln++) touched.add(ln);
    }
    // Como inserts/deletes movem linhas seguintes, mais seguro limpar tudo
    // que NÃO está nas tocadas — caso contrário um snapshot antigo de
    // "linha 50" pode estar referenciando o que agora é linha 52.
    this.lineSnapshot.clear();
    for (const ln of touched) {
      if (ln >= 1 && ln <= lineCount) {
        this.lineSnapshot.set(ln, this.model.getLineContent(ln));
      }
    }
  }

  /**
   * Reconstrói o conteúdo da linha ANTES do edit a partir da linha atual
   * + a `range`/text da change. Usado só na primeira vez que vemos a linha.
   */
  private reconstructBefore(
    lineNumber: number,
    range: editor.IModelContentChange['range'],
    insertedText: string,
  ): string {
    const current = this.model.getLineContent(lineNumber);
    // Cols Monaco são 1-based; conversão pra index 0-based no string.
    const startCol = range.startColumn - 1;
    // No "after" string, o trecho `insertedText` ocupa [startCol, startCol + insertedText.length).
    // Pra recuperar o "before", removemos o inserido e re-inserimos o
    // intervalo original (que não temos diretamente — assumimos vazio,
    // i.e., a change foi um insert puro). Aproximação suficiente pra v1.
    const head = current.slice(0, startCol);
    const tail = current.slice(startCol + insertedText.length);
    return head + tail;
  }
}
