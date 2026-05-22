/**
 * UNDRCOD user settings — schema compartilhado entre main, preload e renderer.
 *
 * Persistido em electron-store (~/.config/undr-code/config.json em Linux,
 * %APPDATA%\undr-code\config.json em Windows).
 *
 * Estrutura plana (sem nesting) — chaves agrupadas por section só na UI,
 * não no storage. Isso simplifica get/set/migrations.
 *
 * Defensive: cada key tem default. Faltando ou tipo invalido → cai pro default
 * silenciosamente (validacao no main process).
 */

/**
 * Tema visual. Único valor canônico: 'undrcod' (dark + Antigravity Blue).
 *
 * Os outros valores ('champagne', 'antigravity-dark') existem só como aliases
 * legados pra não quebrar localStorage de instalações antigas — todos são
 * normalizados pra 'undrcod' no boundary de validação.
 *
 * Compat: MonacoEditor/DiffViewer aceitam só 'dark' | 'light' — mapeamento
 * fixo em 'dark' (não tem mais light mode).
 */
export type ThemeMode = 'undrcod' | 'champagne' | 'antigravity-dark';

/** Alias canônico (recomendado pra novos consumers). */
export type Theme = ThemeMode;
export type ChatFontSize = 'sm' | 'md' | 'lg';
export type ChatMode = 'default' | 'plan' | 'acceptEdits';
export type ChatEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/**
 * Idioma preferido pras respostas do assistant.
 * - 'auto': detecta heurística no prompt do user e força só quando bate pt-BR.
 *   Pra prompts em inglês deixa o Claude responder em inglês (comportamento default).
 * - 'pt-BR': sempre força resposta em português brasileiro (append system prompt).
 * - 'en': sempre força resposta em inglês.
 */
export type PreferredLanguage = 'auto' | 'pt-BR' | 'en';

export interface UndrSettings {
  // Aparencia
  theme: ThemeMode;
  zoomFactor: number;
  chatFontSize: ChatFontSize;
  showMemoryMonitor: boolean;

  // Chat
  defaultChatMode: ChatMode;
  defaultEffort: ChatEffort;
  showThinkingBlocks: boolean;
  autoScroll: boolean;
  /** Idioma preferido pras respostas do assistant. Default 'auto'. */
  preferredLanguage: PreferredLanguage;

  // Editor
  editorFontSize: number;
  editorTabWidth: number;
  /**
   * Quando true (default, igual VS Code), Monaco DETECTA a indentação do arquivo
   * aberto e usa esse valor pro tabSize/insertSpaces — ignorando `editorTabWidth`
   * pra esse arquivo específico. Quando false, força sempre o setting.
   *
   * NOTA IMPORTANTE: `editorTabWidth` só afeta como o caractere TAB (`\t`) é
   * renderizado E quantos espaços a tecla Tab insere. Arquivos já gravados com
   * espaços literais (ex: XML com 2 espaços) NÃO mudam o visual — cada espaço
   * é sempre 1 coluna, qualquer editor Monaco/VS Code/Cursor se comporta assim.
   * Pra "reformatar" um arquivo desses, use Shift+Alt+F (Format Document).
   */
  editorDetectIndentation: boolean;
  editorWordWrap: boolean;
  /** Auto-save de arquivos dirty: 'off' não salva auto, 'afterDelay' salva depois de X ms,
   *  'onFocusChange' salva quando user troca de tab/perde foco no editor. Default 'off'. */
  autoSave: 'off' | 'afterDelay' | 'onFocusChange';
  /** Delay em ms pro modo afterDelay. Default 1500ms. */
  autoSaveDelay: number;
  /** Quando true, roda `editor.action.formatDocument` do Monaco antes de salvar (Ctrl+S).
   *  Equivalente a "Shift+Alt+F" manual + save. Default false. */
  formatOnSave: boolean;
  /** Quando true, Monaco aplica formatação automática ao colar (paste). Default false.
   *  Mapeia direto pra option `formatOnPaste` do editor. */
  formatOnPaste: boolean;
  /** Colore pares de brackets por nível de aninhamento. Default true. */
  bracketPairColorization: boolean;
  /** Mantém scope (função/class) visível no topo ao scrollar. Default true. */
  stickyScroll: boolean;
  /** Animação suave do caret ao mover. Default true. */
  smoothCaret: boolean;
  /** Mostra o minimap (overview lateral) do Monaco. Default true. */
  editorMinimap: boolean;
  /** Mostra números de linha no editor. Default true. */
  editorLineNumbers: boolean;
  /** Renderiza caracteres de whitespace (•, ↹) — útil pra detectar tabs vs spaces. Default false. */
  editorRenderWhitespace: boolean;
  /** Renderiza caracteres de controle invisíveis. Default false. */
  editorRenderControlChars: boolean;
  /** Mostra a status bar no rodapé do app. Default true. */
  showStatusBar: boolean;

  // Workspace
  recentWorkspacesMax: number;
  autoDetectDevServer: boolean;

  // Audio
  /** Toca sons sutis em transicoes do agent (tool use, done, error). Default off. */
  audioEnabled: boolean;
}

export const DEFAULT_SETTINGS: UndrSettings = {
  // Aparencia
  theme: 'undrcod',
  zoomFactor: 1.1,
  chatFontSize: 'md',
  showMemoryMonitor: false,

  // Chat
  defaultChatMode: 'default',
  defaultEffort: 'medium',
  showThinkingBlocks: true,
  autoScroll: true,
  preferredLanguage: 'auto',

  // Editor
  editorFontSize: 14,
  editorTabWidth: 4,
  editorDetectIndentation: true,
  editorWordWrap: false,
  autoSave: 'off',
  autoSaveDelay: 1500,
  formatOnSave: false,
  formatOnPaste: false,
  bracketPairColorization: true,
  stickyScroll: true,
  smoothCaret: true,
  editorMinimap: true,
  editorLineNumbers: true,
  editorRenderWhitespace: false,
  editorRenderControlChars: false,
  showStatusBar: true,

  // Workspace
  recentWorkspacesMax: 15,
  autoDetectDevServer: true,

  // Audio
  audioEnabled: false,
};

/**
 * Valida valor pra uma key especifica. Retorna o value coerced se valido,
 * ou null se invalido (caller usa default).
 */
export function validateSetting<K extends keyof UndrSettings>(
  key: K,
  value: unknown,
): UndrSettings[K] | null {
  switch (key) {
    case 'theme': {
      // Único valor canônico = 'undrcod'. Aliases legados ('champagne',
      // 'antigravity-dark', 'dark', 'warm', 'light') são normalizados pra 'undrcod'
      // — pra não quebrar localStorage/electron-store de instalações antigas.
      if (value === 'undrcod') {
        return 'undrcod' as UndrSettings[K];
      }
      if (
        value === 'champagne' ||
        value === 'antigravity-dark' ||
        value === 'dark' ||
        value === 'warm' ||
        value === 'light'
      ) {
        return 'undrcod' as UndrSettings[K];
      }
      return null;
    }
    case 'zoomFactor': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      const clamped = Math.max(0.5, Math.min(2.5, value));
      return clamped as UndrSettings[K];
    }
    case 'chatFontSize':
      return (value === 'sm' || value === 'md' || value === 'lg' ? value : null) as UndrSettings[K] | null;
    case 'showMemoryMonitor':
    case 'showThinkingBlocks':
    case 'autoScroll':
    case 'editorWordWrap':
    case 'autoDetectDevServer':
    case 'audioEnabled':
    case 'formatOnSave':
    case 'formatOnPaste':
    case 'bracketPairColorization':
    case 'stickyScroll':
    case 'smoothCaret':
    case 'editorMinimap':
    case 'editorLineNumbers':
    case 'editorRenderWhitespace':
    case 'editorRenderControlChars':
    case 'showStatusBar':
    case 'editorDetectIndentation':
      return (typeof value === 'boolean' ? value : null) as UndrSettings[K] | null;
    case 'defaultChatMode':
      return (value === 'default' || value === 'plan' || value === 'acceptEdits'
        ? value
        : null) as UndrSettings[K] | null;
    case 'defaultEffort':
      return (value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max'
        ? value
        : null) as UndrSettings[K] | null;
    case 'preferredLanguage':
      return (value === 'auto' || value === 'pt-BR' || value === 'en'
        ? value
        : null) as UndrSettings[K] | null;
    case 'editorFontSize': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      const clamped = Math.max(10, Math.min(28, Math.round(value)));
      return clamped as UndrSettings[K];
    }
    case 'editorTabWidth':
      return (value === 2 || value === 4 ? value : null) as UndrSettings[K] | null;
    case 'autoSave':
      return (value === 'off' || value === 'afterDelay' || value === 'onFocusChange'
        ? value : null) as UndrSettings[K] | null;
    case 'autoSaveDelay': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      // 250ms até 30s — fora disso vira default.
      const clamped = Math.max(250, Math.min(30_000, Math.round(value)));
      return clamped as UndrSettings[K];
    }
    case 'recentWorkspacesMax': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      const clamped = Math.max(1, Math.min(50, Math.round(value)));
      return clamped as UndrSettings[K];
    }
    default:
      return null;
  }
}

/** Lista canonica de atalhos do UNDRCOD pra section "Atalhos" (só visualização). */
export const SHORTCUTS_REFERENCE: Array<{ id: string; label: string; keys: string[] }> = [
  { id: 'toggle-left', label: 'Alternar barra lateral primaria (Arquivos)', keys: ['Ctrl', 'B'] },
  { id: 'toggle-right', label: 'Alternar barra lateral secundaria (Chat)', keys: ['Ctrl', 'Alt', 'B'] },
  { id: 'toggle-panel', label: 'Alternar painel inferior', keys: ['Ctrl', 'J'] },
  { id: 'transcript', label: 'Visualizacao de transcrição', keys: ['Ctrl', 'O'] },
  { id: 'settings', label: 'Abrir configurações', keys: ['Ctrl', ','] },
  { id: 'preview', label: 'Alternar preview (modo Lovable)', keys: ["'"] },
  { id: 'reload', label: 'Recarregar janela', keys: ['Ctrl', 'R'] },
  { id: 'devtools', label: 'Alternar DevTools', keys: ['F12'] },
  { id: 'fullscreen', label: 'Alternar tela cheia', keys: ['F11'] },
  { id: 'zoom-in', label: 'Aumentar zoom', keys: ['Ctrl', '+'] },
  { id: 'zoom-out', label: 'Diminuir zoom', keys: ['Ctrl', '-'] },
  { id: 'zoom-reset', label: 'Resetar zoom', keys: ['Ctrl', '0'] },
];
