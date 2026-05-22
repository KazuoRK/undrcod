import { Menu, MenuItemConstructorOptions, BrowserWindow, shell } from 'electron';

/**
 * Cria o menu nativo do UNDRCOD com os 8 menus do topbar custom
 * (File / Edit / Selection / View / Go / Run / Terminal / Help).
 *
 * Fica escondido por default (autoHideMenuBar=true na window); user aperta Alt
 * pra ver. Cada item customizado dispara um IPC `menu:<action>` pro renderer
 * ouvir via preload (window.undrcodAPI.menu.onAction).
 *
 * IMPORTANTE: items aqui DEVEM espelhar exatamente os arrays do topbar custom
 * em App.tsx (fileMenuItems, editMenuItems, selectionMenuItems, viewMenuItems,
 * goMenuItems, runMenuItems, terminalMenuItems, helpMenuItems). Mudou um lá,
 * mudar o equivalente aqui pra UX consistente quando user usa Alt.
 *
 * Items disabled no topbar (Monaco-handled, debug não implementado, etc) ficam
 * `enabled: false` aqui também. Items com `role:` nativo (cut/copy/paste/undo)
 * funcionam direto via Electron sem precisar de IPC.
 */
export function createAppMenu(win: BrowserWindow): Menu {
  const send = (action: string) => () => win.webContents.send(`menu:${action}`);

  const template: MenuItemConstructorOptions[] = [
    // === File ===
    {
      label: 'File',
      submenu: [
        { label: 'New File', accelerator: 'CmdOrCtrl+N', click: send('newFile') },
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: send('newWindow') },
        { type: 'separator' },
        { label: 'Open Workspace...', accelerator: 'CmdOrCtrl+O', click: send('openFolder') },
        { label: 'Open Recent...', accelerator: 'CmdOrCtrl+E', click: send('openRecent') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Save All', accelerator: 'CmdOrCtrl+Shift+S', click: send('saveAll') },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: send('settings') },
        { type: 'separator' },
        { label: 'Reload Window', accelerator: 'CmdOrCtrl+R', click: send('reloadWindow') },
        { label: 'Exit', click: send('exit') },
      ],
    },

    // === Edit ===
    // Items que tocam o editor dispatcham `menu:editor*` → App.tsx escuta e
    // dispatcha `undrcod:editor-*` que o MonacoEditor consome via getAction.
    // Roles nativos pra Cut/Copy/Paste (cobrem tanto Monaco quanto inputs HTML).
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('editorUndo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Y', click: send('editorRedo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { label: 'Find', accelerator: 'CmdOrCtrl+F', click: send('editorFind') },
        { label: 'Replace', accelerator: 'CmdOrCtrl+H', click: send('editorReplace') },
        { type: 'separator' },
        { label: 'Find in Files', accelerator: 'CmdOrCtrl+Shift+F', click: send('findInFiles') },
        { label: 'Replace in Files', accelerator: 'CmdOrCtrl+Shift+H', click: send('replaceInFiles') },
        { type: 'separator' },
        { label: 'Toggle Line Comment', accelerator: 'CmdOrCtrl+/', click: send('editorCommentLine') },
        { label: 'Toggle Block Comment', accelerator: 'Shift+Alt+A', click: send('editorCommentBlock') },
      ],
    },

    // === Selection — todos os items dispatcham via Monaco actions ===
    {
      label: 'Selection',
      submenu: [
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: send('editorSelectAll') },
        { label: 'Expand Selection', accelerator: 'Shift+Alt+Right', click: send('editorExpandSelection') },
        { label: 'Shrink Selection', accelerator: 'Shift+Alt+Left', click: send('editorShrinkSelection') },
        { type: 'separator' },
        { label: 'Copy Line Up', accelerator: 'Shift+Alt+Up', click: send('editorCopyLineUp') },
        { label: 'Copy Line Down', accelerator: 'Shift+Alt+Down', click: send('editorCopyLineDown') },
        { label: 'Move Line Up', accelerator: 'Alt+Up', click: send('editorMoveLineUp') },
        { label: 'Move Line Down', accelerator: 'Alt+Down', click: send('editorMoveLineDown') },
        { label: 'Duplicate Selection', click: send('editorDuplicateSelection') },
        { type: 'separator' },
        { label: 'Add Cursor Above', accelerator: 'CmdOrCtrl+Alt+Up', click: send('editorCursorAbove') },
        { label: 'Add Cursor Below', accelerator: 'CmdOrCtrl+Alt+Down', click: send('editorCursorBelow') },
        { label: 'Add Cursors to Line Ends', accelerator: 'Shift+Alt+I', click: send('editorCursorsLineEnds') },
        { label: 'Add Next Occurrence', accelerator: 'CmdOrCtrl+D', click: send('editorAddNextOccurrence') },
        { label: 'Add Previous Occurrence', click: send('editorAddPrevOccurrence') },
        { label: 'Select All Occurrences', click: send('editorSelectAllOccurrences') },
        { type: 'separator' },
        { label: 'Toggle Column Selection Mode', click: send('editorToggleColumnSelection') },
      ],
    },

    // === View ===
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+Shift+P', click: send('palette') },
        { label: 'Quick Open', accelerator: 'CmdOrCtrl+P', click: send('quickOpen') },
        { type: 'separator' },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: send('toggleSidebar') },
        { label: 'Toggle Bottom Panel', accelerator: 'CmdOrCtrl+J', click: send('togglePanel') },
        { label: 'Toggle Chat Pane', accelerator: 'CmdOrCtrl+Alt+B', click: send('toggleChat') },
        { type: 'separator' },
        { label: 'Toggle Preview', click: send('togglePreview') },
        { role: 'togglefullscreen' },
      ],
    },

    // === Go ===
    {
      label: 'Go',
      submenu: [
        { label: 'Go to File...', accelerator: 'CmdOrCtrl+P', click: send('quickOpen') },
        { label: 'Go to Symbol...', accelerator: 'CmdOrCtrl+Shift+O', click: send('goToSymbol') },
        // Go to Line — Monaco built-in (Ctrl+G no editor).
        { label: 'Go to Line...', accelerator: 'CmdOrCtrl+G', enabled: false },
        { type: 'separator' },
        { label: 'Recent Files', accelerator: 'CmdOrCtrl+E', click: send('openRecent') },
        { type: 'separator' },
        { label: 'Switch Workspace...', accelerator: 'CmdOrCtrl+Alt+R', click: send('switchWorkspace') },
      ],
    },

    // === Run ===
    {
      label: 'Run',
      submenu: [
        { label: 'Run Tasks...', click: send('runTasks') },
        { type: 'separator' },
        // Debug runtime ainda não implementado — disabled no topbar tb.
        { label: 'Start Debugging', accelerator: 'F5', enabled: false },
        { label: 'Stop Debugging', accelerator: 'Shift+F5', enabled: false },
        { type: 'separator' },
        { label: 'View Output', click: send('viewOutput') },
        { label: 'View Problems', click: send('viewProblems') },
      ],
    },

    // === Terminal ===
    {
      label: 'Terminal',
      submenu: [
        { label: 'New Terminal', accelerator: 'CmdOrCtrl+`', click: send('newTerminal') },
        { label: 'Toggle Terminal Panel', accelerator: 'CmdOrCtrl+J', click: send('togglePanel') },
        { type: 'separator' },
        { label: 'View Ports', click: send('viewPorts') },
      ],
    },

    // === Help ===
    {
      label: 'Help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: send('shortcuts') },
        { label: 'Welcome — Refazer Tour', click: send('welcomeTour') },
        { type: 'separator' },
        {
          label: 'Documentação Claude Code',
          click: () => shell.openExternal('https://docs.claude.com/en/docs/claude-code'),
        },
        {
          label: 'Reportar problema',
          click: () => shell.openExternal('https://github.com/anthropics/claude-code/issues'),
        },
        { type: 'separator' },
        // About — disabled no topbar (placeholder); mantemos mesmo comportamento.
        { label: 'Sobre UNDRCOD', enabled: false },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
