/**
 * Catálogo de atalhos do UNDRCOD, agrupado por contexto pra renderização
 * no ShortcutsDialog. Estrutura diferente do `SHORTCUTS_REFERENCE` plano em
 * src/shared/settings-types.ts (este aqui é organizado por seção pra UX).
 *
 * IMPORTANTE: cada atalho tem que refletir um binding REAL no código.
 *   - Bindings globais: App.tsx → useEffect do `Atalhos globais`
 *   - Diff: src/renderer/hooks/useHunkKeyboard.ts
 *   - Palette: src/renderer/components/Palette/Palette.tsx
 *   - Monaco: editor nativo (Ctrl+S é tratado no FilePreview/Monaco)
 *
 * Cada item:
 *   - `keys`: array de tokens — UM por chip kbd (padrão UNDRCOD, NUNCA "Ctrl+K").
 *   - `description`: o que o atalho faz (pt-BR).
 *   - `context`: opcional, contexto onde o atalho só funciona (ex: "dentro do diff viewer").
 */

export interface ShortcutItem {
  keys: string[];
  description: string;
  context?: string;
}

export interface ShortcutGroup {
  id: string;
  title: string;
  items: ShortcutItem[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    id: 'navigation',
    title: 'Navegação',
    items: [
      { keys: ['Ctrl', 'P'], description: 'Quick Open — busca arquivo no workspace' },
      { keys: ['Ctrl', 'Shift', 'P'], description: 'Command Palette — todos os comandos' },
      { keys: ['Ctrl', 'Shift', 'F'], description: 'Grep — busca no conteúdo dos arquivos' },
      { keys: ['Ctrl', 'O'], description: 'Visualização de transcrição' },
      { keys: ['Ctrl', 'E'], description: 'Arquivos abertos recentemente' },
      { keys: ['Alt', '←'], description: 'Voltar (histórico de arquivos)' },
      { keys: ['Alt', '→'], description: 'Avançar (histórico de arquivos)' },
    ],
  },
  {
    id: 'tabs',
    title: 'Tabs',
    items: [
      { keys: ['Ctrl', 'Tab'], description: 'Próxima tab' },
      { keys: ['Ctrl', 'Shift', 'Tab'], description: 'Tab anterior' },
      { keys: ['Ctrl', '1'], description: 'Ir pra tab 1 (...até Ctrl+9)' },
      { keys: ['Ctrl', '0'], description: 'Ir pra última tab' },
      { keys: ['Ctrl', 'W'], description: 'Fechar tab ativa' },
      { keys: ['Ctrl', 'Shift', 'T'], description: 'Reabrir última tab fechada' },
    ],
  },
  {
    id: 'view',
    title: 'View',
    items: [
      { keys: ['Ctrl', 'B'], description: 'Toggle Primary Side Bar (FileTree)' },
      { keys: ['Ctrl', 'Alt', 'B'], description: 'Toggle Secondary Side Bar (Chat)' },
      { keys: ['Ctrl', 'J'], description: 'Toggle Bottom Panel' },
      { keys: ["'"], description: 'Toggle Preview (modo Lovable)' },
    ],
  },
  {
    id: 'file',
    title: 'Arquivo',
    items: [
      { keys: ['Ctrl', 'S'], description: 'Salvar arquivo ativo', context: 'arquivo aberto no editor' },
      { keys: ['Ctrl', 'Shift', 'S'], description: 'Save All — salva todos os dirty files' },
      { keys: ['Ctrl', 'K'], description: 'Save As (chord — pressione e depois S)' },
    ],
  },
  {
    id: 'editor',
    title: 'Editor (Monaco)',
    items: [
      { keys: ['Ctrl', 'L'], description: 'Enviar seleção pro chat (como code block)', context: 'arquivo aberto no editor' },
      { keys: ['Ctrl', 'I'], description: 'Perguntar sobre seleção (prompt skeleton no chat)', context: 'arquivo aberto no editor' },
      { keys: ['Ctrl', 'F2'], description: 'Toggle bookmark na linha atual', context: 'arquivo aberto no editor' },
      { keys: ['F2'], description: 'Próximo bookmark', context: 'arquivo aberto no editor' },
      { keys: ['Shift', 'F2'], description: 'Bookmark anterior', context: 'arquivo aberto no editor' },
      { keys: ['Alt', 'Z'], description: 'Toggle Word Wrap' },
      { keys: ['Ctrl', '='], description: 'Aumentar zoom no editor' },
      { keys: ['Ctrl', '-'], description: 'Diminuir zoom no editor' },
    ],
  },
  {
    id: 'diff',
    title: 'Diff Viewer',
    items: [
      { keys: ['Alt', 'J'], description: 'Próximo hunk', context: 'dentro do diff viewer' },
      { keys: ['Alt', 'K'], description: 'Hunk anterior', context: 'dentro do diff viewer' },
      { keys: ['Alt', 'Enter'], description: 'Aceitar hunk', context: 'dentro do diff viewer' },
      { keys: ['Alt', 'Shift', 'Backspace'], description: 'Rejeitar hunk', context: 'dentro do diff viewer' },
    ],
  },
  {
    id: 'palette',
    title: 'Dentro do Palette',
    items: [
      { keys: ['↑', '↓'], description: 'Navegar itens' },
      { keys: ['Enter'], description: 'Selecionar' },
      { keys: ['Esc'], description: 'Fechar' },
    ],
  },
  {
    id: 'app',
    title: 'Aplicação',
    items: [
      { keys: ['Ctrl', ','], description: 'Abrir Settings' },
      { keys: ['Ctrl', '/'], description: 'Abrir Atalhos (este diálogo)' },
      { keys: ['Ctrl', 'R'], description: 'Recarregar janela' },
      { keys: ['F11'], description: 'Alternar tela cheia' },
      { keys: ['F12'], description: 'Alternar DevTools' },
      { keys: ['Ctrl', '+'], description: 'Aumentar zoom da app' },
      { keys: ['Ctrl', '-'], description: 'Diminuir zoom da app' },
      { keys: ['Ctrl', '0'], description: 'Resetar zoom da app' },
      { keys: ['Ctrl', 'Shift', 'N'], description: 'Nova janela (multi-window)' },
      { keys: ['Ctrl', 'Shift', 'M'], description: 'Abrir Agent Manager' },
    ],
  },
];

/** Total de atalhos, pra exibição no footer/header. */
export const TOTAL_SHORTCUTS = SHORTCUTS.reduce((sum, g) => sum + g.items.length, 0);
