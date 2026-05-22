/**
 * Command Registry — lista hardcoded dos comandos built-in que aparecem
 * no modo `>` da CommandPalette. Callbacks reais vivem em App.tsx (parent
 * mapeia `id` → handler via switch em `onExecuteCommand`).
 *
 * Mantém os ids ESTÁVEIS — eles são contrato com o parent.
 */

export type CommandCategory = 'workspace' | 'view' | 'git' | 'edit' | 'agent' | 'mcp' | 'plugins' | 'settings';

export interface RegistryCommand {
  id: string;
  title: string;
  description?: string;
  /** Codicon name (sem o prefixo `codicon-`). */
  icon: string;
  category: CommandCategory;
  /** Shortcut tokens pra hint visual ([Ctrl, P], etc). Não é binding real. */
  shortcut?: string[];
  /** Termos extras pra fuzzy (sinônimos, traduções). */
  keywords?: string;
}

export const COMMAND_REGISTRY: RegistryCommand[] = [
  // === Workspace ===
  {
    id: 'workspace.open',
    title: 'Open Workspace...',
    description: 'Escolher pasta como workspace ativo',
    icon: 'folder-opened',
    category: 'workspace',
    keywords: 'abrir pasta projeto folder open',
  },
  {
    id: 'workspace.openFiles',
    title: 'Open Files...',
    description: 'Abrir um ou mais arquivos no editor central',
    icon: 'go-to-file',
    category: 'workspace',
    keywords: 'abrir arquivos files',
  },

  // === View ===
  {
    id: 'view.toggleSidebar',
    title: 'Toggle Primary Side Bar',
    description: 'Mostrar/esconder árvore de arquivos',
    icon: 'layout-sidebar-left',
    category: 'view',
    shortcut: ['Ctrl', 'B'],
    keywords: 'sidebar filetree arvore lateral',
  },
  {
    id: 'view.toggleBottomPanel',
    title: 'Toggle Bottom Panel',
    description: 'Mostrar/esconder painel inferior (Terminal, Problems, etc)',
    icon: 'layout-panel',
    category: 'view',
    shortcut: ['Ctrl', 'J'],
    keywords: 'terminal panel inferior bottom',
  },
  {
    id: 'view.toggleChat',
    title: 'Toggle Chat Pane',
    description: 'Mostrar/esconder painel lateral do agente',
    icon: 'layout-sidebar-right',
    category: 'view',
    shortcut: ['Ctrl', 'Alt', 'B'],
    keywords: 'chat agent agente lateral secondary',
  },
  {
    id: 'view.transcript',
    title: 'Show Transcript',
    description: 'Visualização de transcrição da conversa',
    icon: 'eye',
    category: 'view',
    shortcut: ['Ctrl', 'O'],
    keywords: 'transcripcao historico conversa',
  },
  {
    id: 'view.togglePreview',
    title: 'Toggle Preview',
    description: 'Abrir/fechar webview de preview do dev server',
    icon: 'play',
    category: 'view',
    keywords: 'preview lovable webview',
  },
  {
    id: 'view.customizeLayout',
    title: 'Customize Layout...',
    description: 'Gerenciar quais paineis estão visíveis',
    icon: 'layout',
    category: 'view',
    keywords: 'layout paineis customizar',
  },

  // === Edit ===
  {
    id: 'editor.formatDocument',
    title: 'Format Document',
    description: 'Formata o documento ativo via Monaco (`editor.action.formatDocument`)',
    icon: 'symbol-array',
    category: 'edit',
    shortcut: ['Shift', 'Alt', 'F'],
    keywords: 'format formatar prettier indent indentar beautify',
  },
  {
    id: 'editor.toggleWordWrap',
    title: 'Toggle Word Wrap',
    description: 'Alterna quebra de linha no editor (setting `editorWordWrap`)',
    icon: 'word-wrap',
    category: 'view',
    shortcut: ['Alt', 'Z'],
    keywords: 'word wrap quebra linha line',
  },
  {
    id: 'editor.toggleMinimap',
    title: 'Toggle Minimap',
    description: 'Mostra/esconde o minimap (overview lateral) do Monaco',
    icon: 'map',
    category: 'view',
    keywords: 'minimap miniatura overview preview lateral',
  },
  {
    id: 'editor.toggleLineNumbers',
    title: 'Toggle Line Numbers',
    description: 'Mostra/esconde os números de linha no editor',
    icon: 'list-ordered',
    category: 'view',
    keywords: 'line numbers numeros linha gutter',
  },

  // === Compare ===
  {
    id: 'file.compare',
    title: 'Compare Files...',
    description: 'Selecionar 2 arquivos e abrir diff side-by-side',
    icon: 'diff',
    category: 'workspace',
    keywords: 'diff compare comparar arquivos files',
  },

  // === Chat ===
  {
    id: 'chat.addSelection',
    title: 'Add Selection to Chat',
    description: 'Envia seleção do editor pro chat como code block',
    icon: 'comment',
    category: 'edit',
    shortcut: ['Ctrl', 'L'],
    keywords: 'send selection chat reference code block trecho',
  },
  {
    id: 'chat.askAboutSelection',
    title: 'Ask About Selection',
    description: 'Abre chat com prompt skeleton + seleção pra você digitar a pergunta',
    icon: 'question',
    category: 'edit',
    shortcut: ['Ctrl', 'I'],
    keywords: 'ask question selection trecho duvida sobre',
  },

  // === Git ===
  {
    id: 'git.showDiff',
    title: 'Show Git Diff',
    description: 'Diff do working tree vs HEAD',
    icon: 'git-pull-request',
    category: 'git',
    keywords: 'git diff alteracoes changes',
  },
  {
    id: 'git.commit',
    title: 'Commit Changes...',
    description: 'Abre o CommitDialog pra escrever mensagem e commitar staged files',
    icon: 'git-commit',
    category: 'git',
    keywords: 'git commit',
  },

  // === Settings ===
  {
    id: 'settings.open',
    title: 'Open Settings',
    description: 'Modal de configurações do UNDRCode',
    icon: 'settings-gear',
    category: 'settings',
    shortcut: ['Ctrl', ','],
    keywords: 'config preferences ajustes',
  },
  {
    id: 'settings.reload',
    title: 'Reload Window',
    description: 'Recarrega a janela (Ctrl+R)',
    icon: 'refresh',
    category: 'settings',
    shortcut: ['Ctrl', 'R'],
    keywords: 'reload reiniciar reset window',
  },
  {
    id: 'help.shortcuts',
    title: 'Keyboard Shortcuts',
    description: 'Lista todos os atalhos de teclado',
    icon: 'keyboard',
    category: 'settings',
    shortcut: ['Ctrl', '/'],
    keywords: 'atalhos teclado shortcuts keyboard help ajuda',
  },
  {
    id: 'help.onboarding',
    title: 'Refazer tour de boas-vindas',
    description: 'Revisão dos recursos principais — útil pra relembrar atalhos',
    icon: 'sparkle',
    category: 'settings',
    keywords: 'tour onboarding boas-vindas welcome tutorial intro novato',
  },

  // === Agent ===
  {
    id: 'history.open',
    title: 'Abrir histórico de conversas',
    description: 'Lista sessões salvas do workspace atual pra retomar',
    icon: 'history',
    category: 'agent',
    shortcut: ['Ctrl', 'Shift', 'H'],
    keywords: 'historico conversas sessions sessões retomar resume chat history past',
  },

  // === MCP ===
  {
    id: 'mcp.manage',
    title: 'Manage MCP Servers',
    description: 'Adicionar/remover servidores MCP',
    icon: 'plug',
    category: 'mcp',
    keywords: 'mcp servers connectors conectores',
  },

  // === Plugins ===
  {
    id: 'plugins.marketplace',
    title: 'Plugin Marketplace',
    description: 'Explorar e instalar plugins',
    icon: 'extensions',
    category: 'plugins',
    keywords: 'plugins marketplace extensions',
  },
];

/** Labels legíveis pra header das categorias na lista. */
export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  workspace: 'Workspace',
  view: 'View',
  git: 'Git',
  edit: 'Edit',
  agent: 'Agent',
  mcp: 'MCP',
  plugins: 'Plugins',
  settings: 'Settings',
};
