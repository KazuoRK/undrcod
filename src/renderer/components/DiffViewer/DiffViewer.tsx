import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DiffEditor, type MonacoDiffEditor } from '@monaco-editor/react';
import {
  hunksToBeforeAfter,
  inferMonacoLanguage,
  type DiffHunk,
} from './diffParser';
import { confirmDialog } from '../ConfirmDialog/ConfirmDialog';
import './DiffViewer.css';

/**
 * Imperative handle exposto via ref pra outros agents (ex: keyboard navigator
 * com Alt+J/K) chamarem ações no DiffViewer sem precisar duplicar state global.
 */
export interface DiffViewerHandle {
  /** Avança pro próximo hunk (wrap-around). No-op se 0 hunks. */
  focusNextHunk: () => void;
  /** Volta pro hunk anterior (wrap-around). No-op se 0 hunks. */
  focusPrevHunk: () => void;
  /** Dispara onAccept(currentHunkIndex), se prop dada. */
  acceptCurrent: () => void;
  /** Dispara onReject(currentHunkIndex), se prop dada. */
  rejectCurrent: () => void;
  /** Indice 0-based do hunk atual. -1 se 0 hunks. */
  getCurrentHunkIndex: () => number;
  /** Total de hunks. */
  getHunkCount: () => number;
}

export interface DiffViewerProps {
  /** Path do arquivo (usado pra title + inferência de linguagem). */
  filePath: string;
  /** Hunks do `git:diff` IPC pro arquivo em questão. */
  hunks: DiffHunk[];
  /** Tema visual — controla `vs-dark` vs `vs` no Monaco. */
  theme: 'dark' | 'light';
  /** Callback ao aceitar um hunk individual. */
  onAccept?: (hunkIndex: number) => void;
  /** Callback ao rejeitar um hunk individual. */
  onReject?: (hunkIndex: number) => void;
  /**
   * Callback ao rejeitar TODOS os hunks do arquivo. Equivalente a
   * `git checkout HEAD -- <file>`. Confirmação via confirmDialog é
   * disparada antes deste callback ser chamado.
   */
  onRejectAll?: () => void;
  /**
   * Mensagem de erro vinda do parent (ex: falha do `git apply`).
   * Quando não-null, renderiza banner vermelho no fim do navbar.
   * null/undefined = sem erro.
   */
  error?: string | null;
  /** Override do height (default: 100%). */
  height?: string | number;
}

/**
 * DiffViewer — renderiza diff git side-by-side com Monaco's DiffEditor.
 *
 * Construído pra hunk-level review: barra de navegação no topo + atalhos
 * keyboard expostos via ref (outro agent wire-up de Alt+J/K).
 *
 * NÃO está integrado ao App.tsx — é o parent que decide quando renderizar.
 */
export const DiffViewer = forwardRef<DiffViewerHandle, DiffViewerProps>(
  (
    {
      filePath,
      hunks,
      theme,
      onAccept,
      onReject,
      onRejectAll,
      error,
      height = '100%',
    },
    ref,
  ) => {
    const diffEditorRef = useRef<MonacoDiffEditor | null>(null);
    const [currentHunk, setCurrentHunk] = useState(0);

    // Memoize porque hunks pode ser array novo a cada render do parent, mas
    // o conteudo derivado só precisa recalcular quando os hunks REAIS mudam.
    const { before, after, hunkStartAfterLines } = useMemo(
      () => hunksToBeforeAfter(hunks),
      [hunks],
    );

    const language = useMemo(() => inferMonacoLanguage(filePath), [filePath]);
    const monacoTheme = theme === 'dark' ? 'vs-dark' : 'vs';

    const hunkCount = hunks.length;

    /**
     * Centraliza um hunk no editor modified (lado direito) usando
     * revealLineInCenter. Se o editor ainda não montou, no-op silencioso.
     */
    const revealHunk = useCallback(
      (idx: number) => {
        const editor = diffEditorRef.current;
        if (!editor || idx < 0 || idx >= hunkStartAfterLines.length) return;
        const line = hunkStartAfterLines[idx];
        // getModifiedEditor() retorna o IStandaloneCodeEditor do lado direito
        editor.getModifiedEditor().revealLineInCenter(line);
        // Posiciona cursor também — facilita visual feedback
        editor.getModifiedEditor().setPosition({ lineNumber: line, column: 1 });
      },
      [hunkStartAfterLines],
    );

    const goToHunk = useCallback(
      (idx: number) => {
        if (hunkCount === 0) return;
        const wrapped = ((idx % hunkCount) + hunkCount) % hunkCount;
        setCurrentHunk(wrapped);
        revealHunk(wrapped);
      },
      [hunkCount, revealHunk],
    );

    const focusNextHunk = useCallback(() => {
      goToHunk(currentHunk + 1);
    }, [currentHunk, goToHunk]);

    const focusPrevHunk = useCallback(() => {
      goToHunk(currentHunk - 1);
    }, [currentHunk, goToHunk]);

    const acceptCurrent = useCallback(() => {
      if (hunkCount === 0) return;
      onAccept?.(currentHunk);
    }, [currentHunk, hunkCount, onAccept]);

    const rejectCurrent = useCallback(() => {
      if (hunkCount === 0) return;
      onReject?.(currentHunk);
    }, [currentHunk, hunkCount, onReject]);

    /**
     * Reject all (file) — pede confirmação destrutiva antes de chamar onRejectAll.
     * Equivale a `git checkout HEAD -- <file>` — apaga TODAS as alterações
     * locais do arquivo. Sem confirmação seria fácil perder trabalho.
     */
    const rejectAllFile = useCallback(async () => {
      if (!onRejectAll) return;
      const ok = await confirmDialog({
        title: 'Descartar todas as alterações?',
        message: `Isso vai reverter ${filePath} pro estado do HEAD. Todas as alterações locais nesse arquivo serão perdidas.`,
        confirmLabel: 'Descartar tudo',
        cancelLabel: 'Cancelar',
        destructive: true,
      });
      if (!ok) return;
      onRejectAll();
    }, [filePath, onRejectAll]);

    // Expõe API imperativa pro parent / keyboard agent
    useImperativeHandle(
      ref,
      () => ({
        focusNextHunk,
        focusPrevHunk,
        acceptCurrent,
        rejectCurrent,
        getCurrentHunkIndex: () => (hunkCount === 0 ? -1 : currentHunk),
        getHunkCount: () => hunkCount,
      }),
      [
        focusNextHunk,
        focusPrevHunk,
        acceptCurrent,
        rejectCurrent,
        currentHunk,
        hunkCount,
      ],
    );

    const handleMount = useCallback(
      (editor: MonacoDiffEditor) => {
        diffEditorRef.current = editor;
        // Auto-reveal do primeiro hunk depois do mount inicial.
        if (hunkCount > 0) {
          // setTimeout pra dar tempo do layout estabilizar (automaticLayout)
          setTimeout(() => revealHunk(0), 0);
        }
      },
      [hunkCount, revealHunk],
    );

    if (hunkCount === 0) {
      return (
        <div className="diff-viewer diff-viewer--empty">
          <div className="diff-viewer__empty-state">
            <div className="diff-viewer__empty-title">No changes</div>
            <div className="diff-viewer__empty-sub">{filePath}</div>
          </div>
        </div>
      );
    }

    return (
      <div className="diff-viewer">
        <div className="diff-viewer__navbar">
          <div className="diff-viewer__path" title={filePath}>
            {filePath}
          </div>
          <div className="diff-viewer__hunk-counter">
            hunk <span className="diff-viewer__hunk-num">{currentHunk + 1}</span>
            /{hunkCount}
          </div>
          <div className="diff-viewer__nav-spacer" />
          <button
            type="button"
            className="diff-viewer__btn"
            onClick={focusPrevHunk}
            disabled={hunkCount < 2}
            title="Previous hunk"
          >
            <span className="diff-viewer__btn-label">Previous</span>
            <span className="kbd-row">
              <kbd className="kbd">Alt</kbd>
              <kbd className="kbd">K</kbd>
            </span>
          </button>
          <button
            type="button"
            className="diff-viewer__btn"
            onClick={focusNextHunk}
            disabled={hunkCount < 2}
            title="Next hunk"
          >
            <span className="diff-viewer__btn-label">Next</span>
            <span className="kbd-row">
              <kbd className="kbd">Alt</kbd>
              <kbd className="kbd">J</kbd>
            </span>
          </button>
          <button
            type="button"
            className="diff-viewer__btn diff-viewer__btn--reject"
            onClick={rejectCurrent}
            disabled={!onReject}
            title="Reject this hunk — reverte só esse hunk no working tree"
          >
            <span className="diff-viewer__btn-label">Reject</span>
            <span className="kbd-row">
              <kbd className="kbd">Alt</kbd>
              <kbd className="kbd">Shift</kbd>
              <kbd className="kbd">⌫</kbd>
            </span>
          </button>
          <button
            type="button"
            className="diff-viewer__btn diff-viewer__btn--accept"
            onClick={acceptCurrent}
            disabled={!onAccept}
            title="Accept this hunk — mantém o hunk e avança"
          >
            <span className="diff-viewer__btn-label">Accept</span>
            <span className="kbd-row">
              <kbd className="kbd">Alt</kbd>
              <kbd className="kbd">⏎</kbd>
            </span>
          </button>
          <div className="diff-viewer__btn-divider" aria-hidden="true" />
          <button
            type="button"
            className="diff-viewer__btn diff-viewer__btn--reject-all"
            onClick={rejectAllFile}
            disabled={!onRejectAll}
            title="Reject all (file) — reverte o arquivo inteiro pro HEAD"
          >
            <i className="codicon codicon-discard diff-viewer__btn-icon" />
            <span className="diff-viewer__btn-label">Reject all (file)</span>
          </button>
        </div>
        {error && (
          <div className="diff-viewer__error" role="alert">
            <i className="codicon codicon-error diff-viewer__error-icon" />
            <span className="diff-viewer__error-text">{error}</span>
          </div>
        )}
        <div className="diff-viewer__editor-wrap">
          <DiffEditor
            height={height}
            language={language}
            original={before}
            modified={after}
            theme={monacoTheme}
            onMount={handleMount}
            options={{
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              fontSize: 13,
              automaticLayout: true,
              enableSplitViewResizing: true,
              scrollBeyondLastLine: false,
              ignoreTrimWhitespace: false,
            }}
          />
        </div>
      </div>
    );
  },
);

DiffViewer.displayName = 'DiffViewer';
