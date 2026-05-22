/**
 * MonacoEditor — wrapper fino sobre @monaco-editor/react.
 *
 * Responsabilidades:
 *   - Mapeia tema UNDRCOD (dark|light) → monaco theme (vs-dark|vs)
 *   - Aplica defaults sensatos (sem minimap, fontSize 13, automaticLayout)
 *   - Expõe onChange / onSave (Ctrl+S detectado via monaco command, NÃO via DOM)
 *
 * NÃO toca em:
 *   - DiffEditor (outro agente)
 *   - keyboard handlers globais (App.tsx Alt+J/K — outro agente)
 *
 * Container precisa de altura explícita — caller põe num flex item.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { loader, type OnMount, type Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import type { editor } from 'monaco-editor';
import { toast } from '../Toast/Toast';
import { NepController } from '../../nep/nep-controller';
import './MonacoEditor.css';

/**
 * Estrutura de uma linha adicionada/removida no inline diff.
 *   - line: 1-indexed (igual Monaco)
 *   - text: conteúdo proposto (informacional — não usado pra renderização, só pro caller)
 */
export interface InlineDiffLine {
  line: number;
  text: string;
}

export interface InlineDiff {
  adds: InlineDiffLine[];
  removes: InlineDiffLine[];
}

/**
 * Helper exportado: dispatcha CustomEvent `undrcod:show-inline-diff` no window.
 * Caller usa isso pra pedir pro Monaco renderizar o diff sem prop drilling.
 *
 * Event detail: { path, diff: { adds, removes } }
 * Monaco escuta e filtra por path (só aplica se o editor montado corresponde).
 */
export function showInlineDiff(path: string, diff: InlineDiff): void {
  window.dispatchEvent(
    new CustomEvent('undrcod:show-inline-diff', { detail: { path, diff } }),
  );
}

/**
 * Helper: limpa o inline diff do path informado.
 */
export function clearInlineDiff(path: string): void {
  window.dispatchEvent(
    new CustomEvent('undrcod:show-inline-diff', { detail: { path, diff: null } }),
  );
}

// Configura @monaco-editor/react pra usar a instância LOCAL do monaco-editor
// (já instalada em node_modules) em vez de baixar da CDN cdn.jsdelivr.net.
// Sem isso, o Electron + Vite dev trava em "carregando editor..." pra sempre
// porque CSP/CDN são bloqueados no contexto file:// do renderer.
loader.config({ monaco });

interface MonacoEditorProps {
  path: string;
  content: string;
  language: string;
  onChange: (newContent: string) => void;
  onSave?: (newContent: string) => void;
  theme: 'dark' | 'light';
  readOnly?: boolean;
  /** Quando true, roda formatDocument do Monaco ANTES de chamar onSave (Ctrl+S). */
  formatOnSave?: boolean;
  /** Quando true, Monaco aplica formatação automática ao colar (paste). Default false. */
  formatOnPaste?: boolean;
  /** Linha pra navegar ao montar (1-indexed). Útil pra abrir arquivo a partir de grep result. */
  gotoLine?: number;
  /** Coluna inicial do match (0-indexed) — quando vem do grep, destaca só o range exato. */
  matchStart?: number;
  /** Coluna final do match (0-indexed, exclusive). Com matchStart, vira range preciso. */
  matchEnd?: number;
  /**
   * Diff inline pra renderizar como decorations (verde = add, vermelho = remove).
   * Quando setado, MonacoEditor pinta as linhas + adiciona Accept/Reject no glyph margin.
   * Quando undefined/null, limpa qualquer diff anterior.
   * Também pode ser controlado externamente via `showInlineDiff(path, diff)` helper.
   */
  inlineDiff?: InlineDiff | null;
  /** Callback quando user clica Accept no glyph margin (linha 1-indexed). */
  onAcceptDiff?: (line: number) => void;
  /** Callback quando user clica Reject no glyph margin (linha 1-indexed). */
  onRejectDiff?: (line: number) => void;
  /** Colore pares de brackets por nível de aninhamento. Default true. */
  bracketPairColorization?: boolean;
  /** Mantém scope (função/class) visível no topo ao scrollar. Default true. */
  stickyScroll?: boolean;
  /** Anima movimento do caret. Default true. */
  smoothCaret?: boolean;
  /** Mostra o minimap lateral. Default false (mantém comportamento original). */
  minimap?: boolean;
  /** Mostra números de linha. Default true. */
  lineNumbers?: boolean;
  /** Renderiza whitespace chars (•, ↹) — útil pra detectar tabs vs spaces. Default false. */
  renderWhitespace?: boolean;
  /** Renderiza chars de controle invisíveis (BOM, zero-width, etc). Default false. */
  renderControlChars?: boolean;
  /** Quebra linhas longas pra caber na largura visível. Default true. */
  wordWrap?: boolean;
  /** Largura da tabulação em espaços (2 ou 4). Default 4.
   *  ATENÇÃO: só afeta render de `\t` + inserção via Tab key. Espaços literais
   *  já gravados no arquivo são sempre 1 col/char — limitação do Monaco/VS Code,
   *  não bug nosso. Pra mudar arquivo existente, rode Format Document. */
  tabSize?: number;
  /** Quando true (default), Monaco detecta indentação do arquivo e usa esse
   *  valor — sobrescrevendo `tabSize`. Quando false, força sempre `tabSize`.
   *  Matches VS Code's `editor.detectIndentation`. */
  detectIndentation?: boolean;
}

const EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  fontSize: 13,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  renderLineHighlight: 'line',
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  fontLigatures: true,
  fontFamily: '"JetBrains Mono", "Cascadia Code", "Consolas", monospace',
  // Garante que padding do topo casa com tab bar do CentralTabs
  padding: { top: 8, bottom: 8 },
  // Habilitado pra renderizar bookmark glyphs (Ctrl+F2).
  glyphMargin: true,
  // Scroll
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
  },
  // Tira a linha vertical fina ao lado do scrollbar (overview ruler border).
  // Default true — desenha 1px border separando código do overview ruler,
  // que destoa do tema dark + custom scrollbar do app.
  overviewRulerBorder: false,
  // UX: tab size vem via prop (default 4) — NÃO hardcode aqui pra não conflitar
  // com o spread no <Editor options={{ ...EDITOR_OPTIONS, tabSize }}/>.
  insertSpaces: true,
  // Hover/suggest widgets renderizam fora do container do editor (position:fixed),
  // evitando clip quando a tooltip estoura a borda direita/inferior do pane.
  // Sem isso, hover de attribute/HSL/symbol fica cortado em telas pequenas.
  fixedOverflowWidgets: true,

  // ====== VS Code-like completion UX ======
  // Defaults do Monaco standalone são conservadores. Esses ajustes alinham
  // o behavior com VS Code/Cursor pra completions, suggest, hover, params.
  //
  // Dispara suggest em `.`, `(`, `<`, etc. (VS Code default).
  suggestOnTriggerCharacters: true,
  // Liga IntelliSense automática conforme user digita (não só `Ctrl+Space`).
  // 'on' nas 3 categorias = comportamento idêntico ao VS Code.
  quickSuggestions: { other: 'on', comments: 'off', strings: 'on' },
  quickSuggestionsDelay: 10, // ms (10 = quase instantâneo)
  // Enter aceita sugestão selecionada. VS Code é 'on' por padrão.
  acceptSuggestionOnEnter: 'on',
  // `.`, `(`, etc. também aceitam (e digitam o char depois). Acelera fluxo.
  acceptSuggestionOnCommitCharacter: true,
  // Tab cycla entre sugestões (igual VS Code).
  tabCompletion: 'on',
  // Hint flutuante quando user tá digitando args de função.
  parameterHints: { enabled: true, cycle: true },
  // Word-based completion como fallback pra linguagens sem LSP completo:
  // sugere palavras vistas em todos os arquivos abertos.
  wordBasedSuggestions: 'allDocuments',
  // Snippets aparecem MISTURADOS no dropdown com símbolos (VS Code 1.85+).
  // Alternativas: 'top' (snippets primeiro), 'bottom' (depois), 'none' (esconde).
  snippetSuggestions: 'inline',
  // Hover delay 300ms — bate com VS Code default.
  hover: { enabled: true, delay: 300, sticky: true },
  // Inlay hints = labels inline pra param names (foo(▸name: "x")), return types, etc.
  // Provider TS expõe automaticamente quando ligado. Pode poluir; 'on' é o default
  // de VS Code mas user pode toggle via setting depois.
  inlayHints: { enabled: 'on' },
  // Liga semantic highlighting (cores baseadas em tipo: const vs let, param vs var).
  // Sem isso só temos syntax highlighting (token-based). Provider TS retorna
  // semantic tokens — Monaco aplica como theme overlay.
  'semanticHighlighting.enabled': true,
  // Suggest widget: mostra detail (signature), documentation (JSDoc), e ícones.
  suggest: {
    showStatusBar: true,
    showInlineDetails: true,
    showIcons: true,
    showWords: true,
    showSnippets: true,
    showMethods: true,
    showFunctions: true,
    showConstructors: true,
    showFields: true,
    showVariables: true,
    showClasses: true,
    showStructs: true,
    showInterfaces: true,
    showModules: true,
    showProperties: true,
    showEvents: true,
    showOperators: true,
    showUnits: true,
    showValues: true,
    showConstants: true,
    showEnums: true,
    showEnumMembers: true,
    showKeywords: true,
    showColors: true,
    showFiles: true,
    showReferences: true,
    showFolders: true,
    showTypeParameters: true,
    // 'inline' é o modo VS Code: snippet preview na linha (não popup).
    insertMode: 'insert',
    filterGraceful: true,
    snippetsPreventQuickSuggestions: false,
    // Lembra escolha anterior pro mesmo prefix (mais previsível).
    selectionMode: 'whenQuickSuggestion',
  },

  // Format on paste/type — defaults false; ligar dá UX nivelo VS Code.
  // (formatOnPaste vem por prop; aqui só formatOnType pra typing real-time.)
  formatOnType: true,
};

export function MonacoEditor({
  path,
  content,
  language,
  onChange,
  onSave,
  theme,
  readOnly = false,
  gotoLine,
  matchStart,
  matchEnd,
  inlineDiff,
  onAcceptDiff,
  onRejectDiff,
  formatOnSave = false,
  formatOnPaste = false,
  bracketPairColorization = true,
  stickyScroll = true,
  smoothCaret = true,
  minimap = false,
  lineNumbers = true,
  wordWrap = true,
  tabSize = 4,
  detectIndentation = true,
  renderWhitespace = false,
  renderControlChars = false,
}: MonacoEditorProps) {
  // Guarda refs do editor + monaco pra registrar Ctrl+S no onMount.
  // Mantém onSave fresco via ref pra evitar re-register quando callback muda.
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  /** Track mount pra useEffect do NEP só rodar depois que o editor existe. */
  const [editorReady, setEditorReady] = useState(false);
  /** Controller do NEP — instanciado por arquivo (binds ao model atual). */
  const nepControllerRef = useRef<NepController | null>(null);
  const onSaveRef = useRef<typeof onSave>(onSave);
  onSaveRef.current = onSave;
  // formatOnSave também via ref — assim alterar o setting não re-registra o keybinding.
  const formatOnSaveRef = useRef(formatOnSave);
  formatOnSaveRef.current = formatOnSave;

  // ---- Inline diff: state + refs ----
  // `externalDiff` é setado quando alguém dispatcha `undrcod:show-inline-diff` no window.
  // Prop `inlineDiff` tem precedência (controlled mode); senão usa state interno.
  const [externalDiff, setExternalDiff] = useState<InlineDiff | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const mouseDisposableRef = useRef<monaco.IDisposable | null>(null);
  const onAcceptRef = useRef(onAcceptDiff);
  const onRejectRef = useRef(onRejectDiff);
  onAcceptRef.current = onAcceptDiff;
  onRejectRef.current = onRejectDiff;

  // Resolve qual diff usar: prop controlada > event externo
  const effectiveDiff: InlineDiff | null =
    inlineDiff !== undefined ? inlineDiff : externalDiff;

  const monacoTheme = theme === 'light' ? 'vs' : 'vs-dark';

  const handleMount = useCallback<OnMount>((editorInstance, monacoInstance: Monaco) => {
    editorRef.current = editorInstance;
    setEditorReady(true);

    // ---- Middle-click pan (drag-to-scroll com botão do meio) ----
    // Pressiona scroll wheel, arrasta pra qualquer direção, solta. Padrão
    // de PDFs / Figma / Photoshop. Monaco não tem isso nativo — manual via
    // mousedown(button=1) + mousemove(deltaX/Y) + setScrollTop/Left.
    {
      const dom = editorInstance.getDomNode();
      if (dom) {
        let panning = false;
        let startX = 0;
        let startY = 0;
        let startScrollLeft = 0;
        let startScrollTop = 0;
        let prevCursor = '';

        const onMouseDown = (e: MouseEvent): void => {
          // button 1 = middle (scroll wheel). 0 = left, 2 = right.
          if (e.button !== 1) return;
          // Bloqueia o comportamento default do browser (auto-scroll widget circular).
          e.preventDefault();
          e.stopPropagation();
          panning = true;
          startX = e.clientX;
          startY = e.clientY;
          startScrollLeft = editorInstance.getScrollLeft();
          startScrollTop = editorInstance.getScrollTop();
          prevCursor = dom.style.cursor;
          dom.style.cursor = 'grabbing';
        };

        const onMouseMove = (e: MouseEvent): void => {
          if (!panning) return;
          e.preventDefault();
          // Delta inverso — arrastar pra direita = scroll pra esquerda
          // (mover "papel" pra direita revela conteúdo da esquerda).
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          editorInstance.setScrollLeft(Math.max(0, startScrollLeft - dx));
          editorInstance.setScrollTop(Math.max(0, startScrollTop - dy));
        };

        const onMouseUp = (e: MouseEvent): void => {
          if (!panning) return;
          if (e.button !== 1) return;
          e.preventDefault();
          panning = false;
          dom.style.cursor = prevCursor;
        };

        const onAuxClick = (e: MouseEvent): void => {
          // Suprime o auxclick (middle-click) que normalmente dispara
          // navegação ou abre link em nova aba — não queremos isso no editor.
          if (e.button === 1) e.preventDefault();
        };

        dom.addEventListener('mousedown', onMouseDown, true);
        // mousemove/up no window pra continuar capturando mesmo se cursor sair do editor.
        window.addEventListener('mousemove', onMouseMove, true);
        window.addEventListener('mouseup', onMouseUp, true);
        dom.addEventListener('auxclick', onAuxClick, true);

        editorInstance.onDidDispose(() => {
          dom.removeEventListener('mousedown', onMouseDown, true);
          window.removeEventListener('mousemove', onMouseMove, true);
          window.removeEventListener('mouseup', onMouseUp, true);
          dom.removeEventListener('auxclick', onAuxClick, true);
        });
      }
    }

    // ---- File metadata → StatusBar ----
    // Emite language/indent/lineEnding/encoding ao mount + ao mudar de modelo/opções.
    // StatusBar escuta `undrcod:editor-metadata` e renderiza os 4 indicadores.
    const emitMetadata = (): void => {
      const model = editorInstance.getModel();
      if (!model) return;
      const opts = model.getOptions();
      const eol = model.getEOL();
      window.dispatchEvent(
        new CustomEvent('undrcod:editor-metadata', {
          detail: {
            language: model.getLanguageId(),
            indentType: opts.insertSpaces ? 'spaces' : 'tabs',
            indentSize: opts.tabSize,
            lineEnding: eol === '\r\n' ? 'CRLF' : 'LF',
            encoding: 'UTF-8',
          },
        }),
      );
    };
    emitMetadata();
    editorInstance.onDidChangeModel(emitMetadata);
    editorInstance.onDidChangeModelOptions(emitMetadata);
    editorInstance.onDidChangeModelLanguage(emitMetadata);

    // ---- Listeners pra trocar line ending / language via StatusBar ----
    const onSetLineEnding = (e: Event): void => {
      const ce = e as CustomEvent<{ lineEnding: 'LF' | 'CRLF' }>;
      const model = editorInstance.getModel();
      if (!model || !ce.detail) return;
      const target =
        ce.detail.lineEnding === 'CRLF'
          ? monacoInstance.editor.EndOfLineSequence.CRLF
          : monacoInstance.editor.EndOfLineSequence.LF;
      model.setEOL(target);
      emitMetadata();
    };
    const onSetLanguage = (e: Event): void => {
      const ce = e as CustomEvent<{ language: string }>;
      const model = editorInstance.getModel();
      if (!model || !ce.detail?.language) return;
      monacoInstance.editor.setModelLanguage(model, ce.detail.language);
      emitMetadata();
    };
    const onSetIndent = (e: Event): void => {
      const ce = e as CustomEvent<{ indentType: 'spaces' | 'tabs'; indentSize: number }>;
      const model = editorInstance.getModel();
      if (!model || !ce.detail) return;
      model.updateOptions({
        insertSpaces: ce.detail.indentType === 'spaces',
        tabSize: ce.detail.indentSize,
      });
      emitMetadata();
    };
    window.addEventListener('undrcod:set-line-ending', onSetLineEnding);
    window.addEventListener('undrcod:set-language', onSetLanguage);
    window.addEventListener('undrcod:set-indent', onSetIndent);
    // Cleanup é tratado no unmount via Monaco dispose — esses listeners ficam até page reload.
    // Como o editor é singleton no componente, OK pra v1.

    // ---- Cursor/selection → StatusBar ----
    // Dispatcha CustomEvent toda vez que cursor move ou seleção muda.
    // StatusBar escuta e renderiza `Ln X, Col Y · N sel`.
    // Também emite blur (selection=null) quando editor perde foco depois de 10s.
    const emitSelection = (): void => {
      const sel = editorInstance.getSelection();
      const model = editorInstance.getModel();
      if (!sel || !model) return;
      const line = sel.positionLineNumber;
      const col = sel.positionColumn;
      const selectedChars = model.getValueLengthInRange(sel);
      const totalLines = model.getLineCount();
      window.dispatchEvent(
        new CustomEvent('undrcod:editor-selection', {
          detail: { line, col, selectedChars, totalLines },
        }),
      );
    };
    editorInstance.onDidChangeCursorSelection(emitSelection);
    editorInstance.onDidFocusEditorText(() => {
      window.dispatchEvent(new CustomEvent('undrcod:editor-focus'));
      emitSelection();
    });
    editorInstance.onDidBlurEditorText(() => {
      window.dispatchEvent(new CustomEvent('undrcod:editor-blur'));
    });
    // emit inicial
    emitSelection();

    // ---- Listener pra "Run Selected Text" (Terminal menu) ----
    // Quando alguém dispatcha `undrcod:editor-get-selection`, respondemos com
    // `undrcod:editor-selection-result` carregando o texto selecionado.
    const onGetSelection = (): void => {
      const sel = editorInstance.getSelection();
      const model = editorInstance.getModel();
      const text = sel && model ? model.getValueInRange(sel) : '';
      window.dispatchEvent(new CustomEvent('undrcod:editor-selection-result', { detail: { text } }));
    };
    window.addEventListener('undrcod:editor-get-selection', onGetSelection);

    // ---- First-time multi-cursor hint ----
    // Detecta quando user ativa multi-cursor pela primeira vez e mostra toast
    // com as combos mais úteis. localStorage flag pra mostrar 1× por instalação.
    // Listener mantém-se ativo só até disparar — depois auto-dispose.
    const HINT_KEY = 'undrcode.hint.multicursor.seen';
    if (typeof localStorage !== 'undefined' && localStorage.getItem(HINT_KEY) == null) {
      const hintDisposable = editorInstance.onDidChangeCursorPosition(() => {
        const selections = editorInstance.getSelections();
        if (selections && selections.length > 1) {
          try { localStorage.setItem(HINT_KEY, 'true'); } catch { /* ignora quota */ }
          toast.info('Multi-cursor ativo', {
            sub: 'Ctrl+Alt+↓ adiciona linha abaixo • Ctrl+D próxima ocorrência',
            ttl: 8000,
          });
          hintDisposable.dispose();
        }
      });
    }

    // ---- View toggles no right-click menu (Minimap, Word Wrap, Line Numbers) ----
    // Adiciona 3 actions no context menu nativo do Monaco. Cada uma toggla o
    // setting equivalente via `undrcodAPI.settings.set()` — FilePreview já tem
    // listener `onChanged` que re-renderiza com a prop atualizada.
    {
      type SettingsAPI = {
        get?: (k: string) => Promise<unknown>;
        set?: (k: string, v: unknown) => Promise<void>;
      };
      const getApi = (): SettingsAPI | null => {
        const w = window as unknown as { undrcodAPI?: { settings?: SettingsAPI } };
        return w.undrcodAPI?.settings ?? null;
      };
      const toggleSetting = async (key: string, defaultValue: boolean): Promise<void> => {
        const api = getApi();
        if (!api?.get || !api?.set) return;
        try {
          const current = await api.get(key);
          const cur = typeof current === 'boolean' ? current : defaultValue;
          await api.set(key, !cur);
        } catch { /* ignore */ }
      };

      editorInstance.addAction({
        id: 'undrcod.toggleMinimap',
        label: 'Toggle Minimap',
        contextMenuGroupId: 'view',
        contextMenuOrder: 1,
        run: () => { void toggleSetting('editorMinimap', true); },
      });
      editorInstance.addAction({
        id: 'undrcod.toggleWordWrap',
        label: 'Toggle Word Wrap',
        contextMenuGroupId: 'view',
        contextMenuOrder: 2,
        // eslint-disable-next-line no-bitwise
        keybindings: [monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.KeyZ],
        run: () => { void toggleSetting('editorWordWrap', true); },
      });
      editorInstance.addAction({
        id: 'undrcod.toggleLineNumbers',
        label: 'Toggle Line Numbers',
        contextMenuGroupId: 'view',
        contextMenuOrder: 3,
        run: () => { void toggleSetting('editorLineNumbers', true); },
      });
    }

    // ---- Bookmarks de linha (Ctrl+F2 toggle, F2 next, Shift+F2 prev) ----
    // Decoração na glyphMargin + persistido em localStorage por arquivo.
    // Sem painel UI — só atalhos + visual.
    {
      const BM_KEY = `undrcode.bookmarks::${path}`;
      const loadBookmarks = (): Set<number> => {
        try {
          const raw = localStorage.getItem(BM_KEY);
          if (!raw) return new Set();
          const arr = JSON.parse(raw) as number[];
          return new Set(arr.filter((n) => typeof n === 'number' && n > 0));
        } catch { return new Set(); }
      };
      const saveBookmarks = (set: Set<number>): void => {
        try {
          if (set.size === 0) localStorage.removeItem(BM_KEY);
          else localStorage.setItem(BM_KEY, JSON.stringify([...set].sort((a, b) => a - b)));
        } catch { /* quota — ignore */ }
      };
      const bookmarks = loadBookmarks();
      let decorationIds: string[] = [];
      const renderDecorations = (): void => {
        const newDecorations: editor.IModelDeltaDecoration[] = [...bookmarks].map((line) => ({
          range: new monacoInstance.Range(line, 1, line, 1),
          options: {
            isWholeLine: false,
            glyphMarginClassName: 'undrcod-bookmark-glyph',
            glyphMarginHoverMessage: { value: `📌 Bookmark linha ${line}` },
            overviewRuler: {
              color: '#5B8DEF',
              position: monacoInstance.editor.OverviewRulerLane.Right,
            },
          },
        }));
        decorationIds = editorInstance.deltaDecorations(decorationIds, newDecorations);
      };
      renderDecorations();

      editorInstance.addAction({
        id: 'undrcod.toggleBookmark',
        label: 'Toggle Bookmark',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 5,
        // eslint-disable-next-line no-bitwise
        keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.F2],
        run: (ed) => {
          const pos = ed.getPosition();
          if (!pos) return;
          if (bookmarks.has(pos.lineNumber)) bookmarks.delete(pos.lineNumber);
          else bookmarks.add(pos.lineNumber);
          saveBookmarks(bookmarks);
          renderDecorations();
        },
      });

      const navBookmark = (dir: 'next' | 'prev'): void => {
        if (bookmarks.size === 0) {
          toast.info('Sem bookmarks — Ctrl+F2 pra marcar a linha atual');
          return;
        }
        const pos = editorInstance.getPosition();
        if (!pos) return;
        const sorted = [...bookmarks].sort((a, b) => a - b);
        let target: number | undefined;
        if (dir === 'next') {
          target = sorted.find((n) => n > pos.lineNumber) ?? sorted[0];
        } else {
          for (let i = sorted.length - 1; i >= 0; i--) {
            if (sorted[i] < pos.lineNumber) { target = sorted[i]; break; }
          }
          if (target === undefined) target = sorted[sorted.length - 1];
        }
        editorInstance.revealLineInCenter(target);
        editorInstance.setPosition({ lineNumber: target, column: 1 });
        editorInstance.focus();
      };

      editorInstance.addAction({
        id: 'undrcod.nextBookmark',
        label: 'Next Bookmark',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 6,
        keybindings: [monacoInstance.KeyCode.F2],
        run: () => navBookmark('next'),
      });

      editorInstance.addAction({
        id: 'undrcod.prevBookmark',
        label: 'Previous Bookmark',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 7,
        // eslint-disable-next-line no-bitwise
        keybindings: [monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.F2],
        run: () => navBookmark('prev'),
      });

      editorInstance.addAction({
        id: 'undrcod.clearBookmarks',
        label: 'Clear All Bookmarks',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 8,
        run: () => {
          if (bookmarks.size === 0) return;
          bookmarks.clear();
          saveBookmarks(bookmarks);
          renderDecorations();
          toast.info('Bookmarks limpos');
        },
      });
    }

    // ---- Editor zoom (font-size) — Cursor/VS Code pattern ----
    // Atalhos: Ctrl/Cmd + = (zoom in), - (zoom out), 0 (reset).
    // Mouse: Ctrl + Wheel (Cursor-style).
    // Range: 6px - 36px. Default 13px. Persistido em localStorage.
    {
      const FONT_MIN = 6;
      const FONT_MAX = 36;
      const FONT_DEFAULT = 13;
      const STORAGE_KEY = 'undrcode.editorFontSize';
      const getCurrent = (): number => {
        const v = editorInstance.getOption(monacoInstance.editor.EditorOption.fontSize);
        return typeof v === 'number' && Number.isFinite(v) ? v : FONT_DEFAULT;
      };
      const setFont = (n: number): void => {
        const clamped = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(n)));
        editorInstance.updateOptions({ fontSize: clamped });
        try { localStorage.setItem(STORAGE_KEY, String(clamped)); } catch { /* ignore */ }
      };
      // Restaurar font-size salvo (se houver)
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const n = parseInt(saved, 10);
          if (Number.isFinite(n)) setFont(n);
        }
      } catch { /* ignore */ }
      // Atalhos via Monaco command (capturados quando editor tem foco)
      // eslint-disable-next-line no-bitwise
      const zoomInKey = monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Equal;
      editorInstance.addCommand(zoomInKey, () => setFont(getCurrent() + 1));
      // eslint-disable-next-line no-bitwise
      const zoomOutKey = monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Minus;
      editorInstance.addCommand(zoomOutKey, () => setFont(getCurrent() - 1));
      // eslint-disable-next-line no-bitwise
      const zoomResetKey = monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Digit0;
      editorInstance.addCommand(zoomResetKey, () => setFont(FONT_DEFAULT));
      // NumpadAdd / NumpadSubtract também (teclado numérico)
      // eslint-disable-next-line no-bitwise
      const zoomInNumpad = monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.NumpadAdd;
      editorInstance.addCommand(zoomInNumpad, () => setFont(getCurrent() + 1));
      // eslint-disable-next-line no-bitwise
      const zoomOutNumpad = monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.NumpadSubtract;
      editorInstance.addCommand(zoomOutNumpad, () => setFont(getCurrent() - 1));

      // Ctrl/Cmd + Mouse Wheel — zoom dinâmico (Cursor pattern)
      const dom = editorInstance.getDomNode();
      if (dom) {
        const onWheel = (e: WheelEvent): void => {
          if (!(e.ctrlKey || e.metaKey)) return;
          e.preventDefault();
          e.stopPropagation();
          // deltaY positivo = scroll pra baixo = zoom out
          const delta = e.deltaY > 0 ? -1 : 1;
          setFont(getCurrent() + delta);
        };
        // passive: false pra poder cancelar default scroll
        dom.addEventListener('wheel', onWheel, { passive: false });
        const sub = editorInstance.onDidDispose(() => {
          dom.removeEventListener('wheel', onWheel);
          sub.dispose();
        });
      }
    }

    // Ctrl+S (e Cmd+S em mac) — chama onSave com conteúdo atual.
    // KeyMod.CtrlCmd cobre os dois OSes.
    // Se formatOnSave estiver ligado, roda `editor.action.formatDocument` primeiro,
    // aguarda completar (settle 50ms) e re-lê o value do model antes de chamar onSave.
    // eslint-disable-next-line no-bitwise
    const keybinding = monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS;
    editorInstance.addCommand(keybinding, () => {
      void (async () => {
        if (formatOnSaveRef.current) {
          const action = editorInstance.getAction('editor.action.formatDocument');
          if (action) {
            try {
              await action.run();
              // Pequena espera pra garantir que o model foi atualizado pelo formatter
              // (alguns formatters aplicam edits async via TextModel.applyEdits).
              await new Promise((resolve) => setTimeout(resolve, 50));
            } catch {
              // Sem formatter pra essa linguagem ou formatter falhou — salva como está.
            }
          }
        }
        const value = editorInstance.getValue();
        onSaveRef.current?.(value);
      })();
    });

    // Navega pra linha específica + seleciona a linha inteira (visual highlight).
    // Robusto a content que carrega async: tenta logo, se não tem linha ainda
    // (model vazio ou < gotoLine linhas) instala listener no onDidChangeModelContent
    // pra re-tentar quando o conteúdo finalizar.
    if (gotoLine && gotoLine > 0) {
      const tryReveal = (): boolean => {
        const model = editorInstance.getModel();
        if (!model || model.getLineCount() < gotoLine) return false;
        // Se matchStart/matchEnd fornecidos (vindo do grep), seleciona RANGE EXATO
        // do match. Senão, seleciona linha inteira como fallback.
        const lineMaxCol = model.getLineLength(gotoLine) + 1;
        const hasMatch = typeof matchStart === 'number' && typeof matchEnd === 'number' && matchEnd > matchStart;
        const range = hasMatch
          ? {
              startLineNumber: gotoLine, startColumn: matchStart + 1, // 0→1 indexed
              endLineNumber: gotoLine, endColumn: Math.min(matchEnd + 1, lineMaxCol),
            }
          : {
              startLineNumber: gotoLine, startColumn: 1,
              endLineNumber: gotoLine, endColumn: lineMaxCol,
            };
        editorInstance.setSelection(range);
        try {
          editorInstance.trigger('reveal', 'editor.unfold', null);
        } catch { /* ignora se action não existe */ }
        editorInstance.revealRangeInCenter(range, monacoInstance.editor.ScrollType.Immediate);
        editorInstance.focus();
        return true;
      };
      if (!tryReveal()) {
        const disposable = editorInstance.onDidChangeModelContent(() => {
          if (tryReveal()) disposable.dispose();
        });
        setTimeout(() => disposable.dispose(), 3000);
      }
    }
  }, [gotoLine, matchStart, matchEnd]);

  // Quando gotoLine muda DEPOIS do mount (ex: user clica em outro grep result do mesmo file).
  useEffect(() => {
    if (gotoLine && gotoLine > 0 && editorRef.current) {
      const ed = editorRef.current;
      const model = ed.getModel();
      if (model && model.getLineCount() >= gotoLine) {
        const lineMaxCol = model.getLineLength(gotoLine) + 1;
        const hasMatch = typeof matchStart === 'number' && typeof matchEnd === 'number' && matchEnd > matchStart;
        const range = hasMatch
          ? {
              startLineNumber: gotoLine, startColumn: matchStart + 1,
              endLineNumber: gotoLine, endColumn: Math.min(matchEnd + 1, lineMaxCol),
            }
          : {
              startLineNumber: gotoLine, startColumn: 1,
              endLineNumber: gotoLine, endColumn: lineMaxCol,
            };
        ed.setSelection(range);
        try { ed.trigger('reveal', 'editor.unfold', null); } catch { /* noop */ }
        ed.revealRangeInCenter(range, monaco.editor.ScrollType.Immediate);
      }
    }
  }, [gotoLine, matchStart, matchEnd]);

  const handleChange = useCallback(
    (value: string | undefined) => {
      // Monaco passa undefined quando o usuário descarta. Tratamos como string vazia.
      onChange(value ?? '');
    },
    [onChange],
  );

  // ---- Listener pra window event `undrcod:show-inline-diff` ----
  // Permite caller externo (ex: agent tool runner) pedir diff sem prop drilling.
  // Filtra por path: ignora events de outros arquivos.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ path: string; diff: InlineDiff | null }>;
      if (!ce.detail || ce.detail.path !== path) return;
      setExternalDiff(ce.detail.diff ?? null);
    };
    window.addEventListener('undrcod:show-inline-diff', handler);
    return () => window.removeEventListener('undrcod:show-inline-diff', handler);
  }, [path]);

  // ---- Listeners pra Edit menu actions (App.tsx dispatcha events) ----
  // Sem filtro de path: aplica no editor ativo (só uma instância montada por vez).
  useEffect(() => {
    const runAction = (actionId: string) => () => {
      const ed = editorRef.current;
      if (!ed) return;
      ed.focus(); // garante que Monaco recebe a ação (não outro input/textarea)
      const action = ed.getAction(actionId);
      if (action) {
        void action.run().catch(() => { /* silencia — feature pode não existir pra linguagem */ });
      }
    };

    // Mapeamento event → Monaco action ID. Cada par registra um listener no window.
    const bindings: Array<[string, string]> = [
      // Edit menu
      ['undrcod:editor-format', 'editor.action.formatDocument'],
      ['undrcod:editor-undo', 'undo'],
      ['undrcod:editor-redo', 'redo'],
      ['undrcod:editor-find', 'actions.find'],
      ['undrcod:editor-replace', 'editor.action.startFindReplaceAction'],
      ['undrcod:editor-comment-line', 'editor.action.commentLine'],
      ['undrcod:editor-comment-block', 'editor.action.blockComment'],
      ['undrcod:editor-cut', 'editor.action.clipboardCutAction'],
      ['undrcod:editor-copy', 'editor.action.clipboardCopyAction'],
      ['undrcod:editor-paste', 'editor.action.clipboardPasteAction'],
      // Selection menu
      ['undrcod:editor-select-all', 'editor.action.selectAll'],
      ['undrcod:editor-expand-selection', 'editor.action.smartSelect.expand'],
      ['undrcod:editor-shrink-selection', 'editor.action.smartSelect.shrink'],
      ['undrcod:editor-copy-line-up', 'editor.action.copyLinesUpAction'],
      ['undrcod:editor-copy-line-down', 'editor.action.copyLinesDownAction'],
      ['undrcod:editor-move-line-up', 'editor.action.moveLinesUpAction'],
      ['undrcod:editor-move-line-down', 'editor.action.moveLinesDownAction'],
      ['undrcod:editor-duplicate-selection', 'editor.action.duplicateSelection'],
      ['undrcod:editor-cursor-above', 'editor.action.insertCursorAbove'],
      ['undrcod:editor-cursor-below', 'editor.action.insertCursorBelow'],
      ['undrcod:editor-cursors-line-ends', 'editor.action.insertCursorAtEndOfEachLineSelected'],
      ['undrcod:editor-add-next-occurrence', 'editor.action.addSelectionToNextFindMatch'],
      ['undrcod:editor-add-prev-occurrence', 'editor.action.addSelectionToPreviousFindMatch'],
      ['undrcod:editor-select-all-occurrences', 'editor.action.selectHighlights'],
      ['undrcod:editor-toggle-column-selection', 'editor.action.toggleColumnSelection'],
      // Go menu — navegação dentro do editor (LSP-dependentes ficam silent fail
      // quando linguagem não suporta — tratado pelo .catch dentro do runAction).
      ['undrcod:editor-goto-definition', 'editor.action.revealDefinition'],
      ['undrcod:editor-goto-declaration', 'editor.action.revealDeclaration'],
      ['undrcod:editor-goto-type-definition', 'editor.action.goToTypeDefinition'],
      ['undrcod:editor-goto-implementations', 'editor.action.goToImplementation'],
      ['undrcod:editor-goto-references', 'editor.action.goToReferences'],
      ['undrcod:editor-goto-line', 'editor.action.gotoLine'],
      ['undrcod:editor-goto-bracket', 'editor.action.jumpToBracket'],
      ['undrcod:editor-next-problem', 'editor.action.marker.next'],
      ['undrcod:editor-prev-problem', 'editor.action.marker.prev'],
      ['undrcod:editor-next-change', 'editor.action.dirtydiff.next'],
      ['undrcod:editor-prev-change', 'editor.action.dirtydiff.previous'],
    ];
    const handlers: Array<[string, () => void]> = bindings.map(([evt, actionId]) => [evt, runAction(actionId)]);
    handlers.forEach(([evt, handler]) => window.addEventListener(evt, handler));
    return () => {
      handlers.forEach(([evt, handler]) => window.removeEventListener(evt, handler));
    };
  }, []);

  // ---- Aplica decorations quando effectiveDiff muda ----
  // deltaDecorations retorna IDs novos; guardamos pra limpar no próximo update.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const model = ed.getModel();
    if (!model) return;

    const newDecorations: editor.IModelDeltaDecoration[] = [];
    if (effectiveDiff) {
      const maxLine = model.getLineCount();
      for (const add of effectiveDiff.adds) {
        if (add.line < 1 || add.line > maxLine) continue;
        newDecorations.push({
          range: new monaco.Range(add.line, 1, add.line, 1),
          options: {
            isWholeLine: true,
            className: 'monaco-inline-add',
            glyphMarginClassName: 'glyph-add',
            glyphMarginHoverMessage: { value: 'Accept / Reject — click glyph margin' },
            linesDecorationsClassName: 'monaco-inline-add-gutter',
            overviewRuler: {
              color: 'rgba(76, 175, 80, 0.6)',
              position: monaco.editor.OverviewRulerLane.Left,
            },
          },
        });
      }
      for (const rem of effectiveDiff.removes) {
        if (rem.line < 1 || rem.line > maxLine) continue;
        newDecorations.push({
          range: new monaco.Range(rem.line, 1, rem.line, 1),
          options: {
            isWholeLine: true,
            className: 'monaco-inline-remove',
            glyphMarginClassName: 'glyph-remove',
            glyphMarginHoverMessage: { value: 'Accept / Reject — click glyph margin' },
            linesDecorationsClassName: 'monaco-inline-remove-gutter',
            overviewRuler: {
              color: 'rgba(229, 115, 115, 0.6)',
              position: monaco.editor.OverviewRulerLane.Left,
            },
          },
        });
      }
    }
    decorationsRef.current = ed.deltaDecorations(decorationsRef.current, newDecorations);

    // Liga glyph margin se temos diff (senão Monaco esconde por default)
    ed.updateOptions({ glyphMargin: Boolean(effectiveDiff && newDecorations.length > 0) });
  }, [effectiveDiff]);

  // ---- Mouse handler no glyph margin: dispara Accept (left side) ou Reject (right side) ----
  // Monaco não expõe Custom Glyph Widgets com botões; convenção: click no glyph margin
  // dispara CustomEvent + onAccept/onReject callback. Caller decide a semântica.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    // Limpa listener antigo (path muda, ou hot reload)
    if (mouseDisposableRef.current) {
      mouseDisposableRef.current.dispose();
      mouseDisposableRef.current = null;
    }
    if (!effectiveDiff) return;

    const diffLines = new Set<number>([
      ...effectiveDiff.adds.map((a) => a.line),
      ...effectiveDiff.removes.map((r) => r.line),
    ]);

    mouseDisposableRef.current = ed.onMouseDown((e) => {
      const target = e.target;
      // GLYPH_MARGIN = 2 — clicou na coluna do "+/-"
      if (target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      const line = target.position?.lineNumber;
      if (!line || !diffLines.has(line)) return;

      // Modifier: Alt = Reject, sem modifier = Accept.
      // Convenção pragmática até termos widgets de verdade.
      const isReject = e.event.altKey || e.event.rightButton;
      if (isReject) {
        onRejectRef.current?.(line);
        window.dispatchEvent(
          new CustomEvent('undrcod:inline-diff-reject', { detail: { path, line } }),
        );
      } else {
        onAcceptRef.current?.(line);
        window.dispatchEvent(
          new CustomEvent('undrcod:inline-diff-accept', { detail: { path, line } }),
        );
      }
    });

    return () => {
      mouseDisposableRef.current?.dispose();
      mouseDisposableRef.current = null;
    };
  }, [effectiveDiff, path]);

  // ---- Sync runtime quando setting de tab/detectIndentation muda ----
  // O wrapper @monaco-editor/react cacheia options no mount; mudar prop não
  // re-aplica automático. Forçamos via `model.updateOptions` ou re-detecta.
  //
  // IMPORTANTE: `tabSize` no Monaco só controla:
  //   1. Quantos espaços a TECLA Tab insere (quando insertSpaces=true)
  //   2. Quantas colunas o CARACTERE `\t` (literal tab, 0x09) ocupa visualmente
  // NÃO afeta espaços literais já no arquivo — cada espaço sempre é 1 coluna.
  // Igual VS Code/Cursor/Antigravity. Pra "mudar" indent de arquivo existente,
  // user precisa rodar Format Document (Shift+Alt+F).
  //
  // Quando `detectIndentation=true` (default VS Code), Monaco infere tabSize do
  // conteúdo do arquivo e ignora o nosso setting pro esse arquivo. Útil pra
  // respeitar convenção do projeto. Quando false, força sempre o setting.
  useEffect(() => {
    const editorInstance = editorRef.current;
    if (!editorInstance) return;
    const model = editorInstance.getModel();
    if (!model) return;
    if (detectIndentation) {
      // Re-roda detecção do Monaco usando o setting como fallback (defaultTabSize
      // pra arquivos sem evidência). API: TextModel.detectIndentation(defaultInsertSpaces, defaultTabSize).
      try {
        model.detectIndentation(true, tabSize);
      } catch {
        // API pode não existir em versões muito antigas — fallback pra setting.
        model.updateOptions({ tabSize, insertSpaces: true });
      }
    } else {
      model.updateOptions({ tabSize, insertSpaces: true });
    }
  }, [tabSize, detectIndentation, content]);

  // ============================================================
  // NEP (Next Edit Prediction) — pattern matcher local
  // ============================================================
  // Cria controller por arquivo. Quando user troca de path, dispose + recria.
  // O controller hooks onDidChangeContent do model atual + renderiza ghost edits.
  // Pra disable: window.localStorage.setItem('undrcode.nep.enabled', 'false') antes
  // do mount, ou via futura UI de settings.
  useEffect(() => {
    if (!editorReady || !path || readOnly) return;
    const editorInstance = editorRef.current;
    if (!editorInstance) return;

    // Lê settings persistidas (default = true). Vazio/falsy → desabilitado.
    const enabledRaw = (() => {
      try {
        const v = window.localStorage.getItem('undrcode.nep.enabled');
        return v === null ? true : v === 'true';
      } catch {
        return true;
      }
    })();
    if (!enabledRaw) return;

    let controller: NepController;
    try {
      controller = new NepController(editorInstance, path, { enabled: true });
      nepControllerRef.current = controller;
    } catch (err) {
      // Defensive: se NEP falhar inicializar, NÃO quebra o editor.
      console.warn('[NEP] falha ao inicializar controller:', err);
      return;
    }

    return () => {
      try {
        controller.dispose();
      } catch (err) {
        console.warn('[NEP] erro no dispose:', err);
      }
      if (nepControllerRef.current === controller) {
        nepControllerRef.current = null;
      }
    };
  }, [editorReady, path, readOnly]);

  // Normaliza o path pra file:/// URI antes de passar pro @monaco-editor/react.
  // Por padrão, ele chama `monaco.Uri.parse(path)` — em paths Windows como
  // `C:\Users\foo`, isso interpreta `C:` como scheme URI, gerando URI ≠ do
  // `monaco.Uri.file(absPath)` que project-context.ts usa. Mismatch quebra
  // cross-file completion (TS worker vê 2 modelos pro mesmo arquivo).
  // Forçar file:// aqui faz ambos compartilharem o mesmo URI canônico.
  const monacoPath = monaco.Uri.file(path).toString();

  return (
    <div className="monaco-editor-wrap">
      <Editor
        path={monacoPath}
        value={content}
        language={language}
        theme={monacoTheme}
        onMount={handleMount}
        onChange={handleChange}
        options={{
          ...EDITOR_OPTIONS,
          readOnly,
          formatOnPaste,
          tabSize,
          // Por padrão usa detecção (igual VS Code). User pode forçar o setting
          // desativando `editorDetectIndentation` no SettingsModal.
          detectIndentation,
          minimap: { enabled: minimap },
          lineNumbers: lineNumbers ? 'on' : 'off',
          wordWrap: wordWrap ? 'on' : 'off',
          renderWhitespace: renderWhitespace ? 'all' : 'none',
          renderControlCharacters: renderControlChars,
          multiCursorModifier: 'ctrlCmd',
          multiCursorMergeOverlapping: true,
          bracketPairColorization: { enabled: bracketPairColorization },
          stickyScroll: { enabled: stickyScroll },
          cursorSmoothCaretAnimation: smoothCaret ? 'on' : 'off',
          // Color decorators: pinta um square ao lado de literals de cor
          // (#hex, rgb(...), hsl(...)) e abre color picker on click. Funciona
          // built-in pra CSS/SCSS/HTML; outros langs usam fallback básico.
          colorDecorators: true,
          colorDecoratorsLimit: 500,
          // Word highlight: realça outras ocorrências da palavra sob o cursor.
          occurrencesHighlight: 'singleFile',
          // Guides: linha sutil que conecta indentação ao bloco pai.
          guides: {
            indentation: true,
            highlightActiveIndentation: true,
            bracketPairs: bracketPairColorization,
            bracketPairsHorizontal: false,
          },
        }}
        loading={
          <div className="monaco-editor-loading">
            <div className="monaco-editor-spinner" />
            <span>carregando editor...</span>
          </div>
        }
      />
    </div>
  );
}
