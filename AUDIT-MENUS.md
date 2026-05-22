# UNDRCode vs Cursor — Auditoria menu-por-menu

_Data: 2026-05-18_
_Escopo: cada botão, dropdown, popover e item de context menu em ambos os apps._
_Fontes UNDRCode: `src/renderer/App.tsx` + components/. Fontes Cursor: `cursor-tester/output/cursor-catalog.json` (3.4.20 / VS Code 1.105.1) + conhecimento público._

Legenda:
- `✓` — ambos têm (paridade funcional)
- `≈` — ambos têm mas com label/atalho diferente
- `❌ falta UNDRCode` — Cursor tem, UNDRCode não
- `⚠ extra UNDRCode` — UNDRCode tem, Cursor não
- `?` — incerto, verificar manualmente

---

## Índice

1. [Topbar — File menu](#1-topbar--file-menu)
2. [Topbar — Edit menu](#2-topbar--edit-menu)
3. [Topbar — Selection menu](#3-topbar--selection-menu)
4. [Topbar — View menu](#4-topbar--view-menu)
5. [Topbar — Go menu](#5-topbar--go-menu)
6. [Topbar — Run menu](#6-topbar--run-menu)
7. [Topbar — Terminal menu](#7-topbar--terminal-menu)
8. [Topbar — Help menu](#8-topbar--help-menu)
9. [Sidebar — "Mais opções" (⋯) menu](#9-sidebar--mais-opções--menu)
10. [Topbar — Settings dropdown (UNDRCode-only botão engrenagem)](#10-topbar--settings-dropdown-undrcode-only)
11. [Topbar — Account menu (avatar)](#11-topbar--account-menu-avatar)
12. [Sidebar — Source Control panel](#12-sidebar--source-control-panel)
13. [Sidebar — Search panel](#13-sidebar--search-panel)
14. [Sidebar — File Tree right-click (arquivo)](#14-sidebar--file-tree-right-click-arquivo)
15. [Sidebar — File Tree right-click (pasta)](#15-sidebar--file-tree-right-click-pasta)
16. [Central — Tab right-click](#16-central--tab-right-click)
17. [Central — Editor right-click (Monaco)](#17-central--editor-right-click-monaco)
18. [Chat — Composer "Mode" popover](#18-chat--composer-mode-popover)
19. [Chat — Composer "+" (add context) popover](#19-chat--composer--add-context-popover)
20. [Chat — Composer "Model" popover](#20-chat--composer-model-popover)
21. [Chat — Composer "Snippets" popover (extra UNDRCode)](#21-chat--composer-snippets-popover-extra-undrcode)
22. [Chat — toolbar pane-right (Visualizações)](#22-chat--toolbar-pane-right-visualizações)
23. [Status bar — items clicáveis](#23-status-bar--items-clicáveis)
24. [Status bar — Notification bell](#24-status-bar--notification-bell)
25. [Status bar — Branch picker](#25-status-bar--branch-picker)
26. [Bottom Panel — tabs](#26-bottom-panel--tabs)
27. [Bottom Panel — toolbar](#27-bottom-panel--toolbar)
28. [Command Palette items](#28-command-palette-items)
29. [Sidebar — Primary tab icons](#29-sidebar--primary-tab-icons)
30. [Welcome view](#30-welcome-view)
31. [Window controls (frame)](#31-window-controls-frame)
32. [Resumo executivo](#32-resumo-executivo)

---

## 1. Topbar — File menu

UNDRCode: `App.tsx:1115` `fileMenuItems`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Open Workspace... (Ctrl+O) | Open Folder... (Ctrl+K Ctrl+O) | ≈ atalho diferente |
| Open Recent... (Ctrl+E) | Open Recent (Ctrl+R) | ≈ atalho diferente |
| Save (Ctrl+S) | Save (Ctrl+S) | ✓ |
| Save All (Ctrl+Shift+S) | Save All (Ctrl+K S) | ≈ atalho diferente |
| Settings (Ctrl+,) | Preferences → Settings (Ctrl+,) | ✓ |
| Reload Window (Ctrl+R) | Developer → Reload Window (Ctrl+R) | ✓ |
| Exit | Exit (Ctrl+Q) | ✓ |
| _(vazio)_ | New Text File (Ctrl+N) | ❌ falta UNDRCode |
| _(vazio)_ | New File... (Ctrl+Alt+Win+N) | ❌ falta UNDRCode |
| _(vazio)_ | New Window (Ctrl+Shift+N) | ❌ falta UNDRCode |
| _(vazio)_ | Open File... (Ctrl+O) | ❌ falta UNDRCode (parcial — só via Quick Open) |
| _(vazio)_ | Add Folder to Workspace... | ❌ falta UNDRCode (single-workspace by design) |
| _(vazio)_ | Save Workspace As... | ❌ falta UNDRCode |
| _(vazio)_ | Save As... (Ctrl+Shift+S) | ❌ falta UNDRCode |
| _(vazio)_ | Auto Save (toggle) | ❌ falta UNDRCode |
| _(vazio)_ | Revert File | ❌ falta UNDRCode |
| _(vazio)_ | Close Editor (Ctrl+F4) | ❌ falta UNDRCode (existe como tab close mas não no File menu) |
| _(vazio)_ | Close Folder (Ctrl+K F) | ❌ falta UNDRCode |
| _(vazio)_ | Close Window (Ctrl+Shift+W) | ❌ falta UNDRCode |

---

## 2. Topbar — Edit menu

UNDRCode: `App.tsx:1180` `editMenuItems` (maioria dos items são "disabled — handled pelo Monaco").

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Undo (Ctrl+Z) — _disabled, delega ao Monaco_ | Undo (Ctrl+Z) | ≈ menu placeholder |
| Redo (Ctrl+Y) — _disabled_ | Redo (Ctrl+Y) | ≈ menu placeholder |
| Find in File (Ctrl+F) — _disabled, Monaco built-in_ | Find (Ctrl+F) | ≈ menu placeholder |
| Find in Files (Ctrl+Shift+F) | Find in Files (Ctrl+Shift+F) | ✓ |
| Replace in File (Ctrl+H) — _disabled_ | Replace (Ctrl+H) | ≈ menu placeholder |
| Replace in Files | Replace in Files (Ctrl+Shift+H) | ✓ |
| _(vazio)_ | Cut (Ctrl+X) | ❌ falta UNDRCode |
| _(vazio)_ | Copy (Ctrl+C) | ❌ falta UNDRCode |
| _(vazio)_ | Paste (Ctrl+V) | ❌ falta UNDRCode |
| _(vazio)_ | Find Next (F3) | ❌ falta UNDRCode |
| _(vazio)_ | Find Previous (Shift+F3) | ❌ falta UNDRCode |
| _(vazio)_ | Toggle Line Comment (Ctrl+/) | ❌ falta UNDRCode |
| _(vazio)_ | Toggle Block Comment (Shift+Alt+A) | ❌ falta UNDRCode |
| _(vazio)_ | Emmet: Expand Abbreviation | ❌ falta UNDRCode |

---

## 3. Topbar — Selection menu

UNDRCode: `App.tsx:1229` `selectionMenuItems` (TUDO disabled — não há editor focusable acima do Monaco wrapper).

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Select All (Ctrl+A) — _disabled_ | Select All (Ctrl+A) | ≈ disabled stub |
| Expand Selection (Shift+Alt+→) — _disabled_ | Expand Selection (Shift+Alt+→) | ≈ disabled stub |
| Shrink Selection (Shift+Alt+←) — _disabled_ | Shrink Selection (Shift+Alt+←) | ≈ disabled stub |
| Add Cursor Above (Ctrl+Alt+↑) — _disabled_ | Add Cursor Above (Ctrl+Alt+↑) | ≈ disabled stub |
| Add Cursor Below (Ctrl+Alt+↓) — _disabled_ | Add Cursor Below (Ctrl+Alt+↓) | ≈ disabled stub |
| Add Next Occurrence (Ctrl+D) — _disabled_ | Add Next Occurrence (Ctrl+D) | ≈ disabled stub |
| Move Line Up (Alt+↑) — _disabled_ | Move Line Up (Alt+↑) | ≈ disabled stub |
| Move Line Down (Alt+↓) — _disabled_ | Move Line Down (Alt+↓) | ≈ disabled stub |
| Duplicate Line (Shift+Alt+↓) — _disabled_ | Copy Line Down (Shift+Alt+↓) | ≈ disabled stub |
| _(vazio)_ | Add Cursors to Line Ends (Shift+Alt+I) | ❌ falta UNDRCode |
| _(vazio)_ | Add Cursors to Bottom (Ctrl+Alt+Shift+↓) | ❌ falta UNDRCode |
| _(vazio)_ | Add Cursor to Next Find Match | ❌ falta UNDRCode |
| _(vazio)_ | Select All Occurrences (Ctrl+Shift+L) | ❌ falta UNDRCode |
| _(vazio)_ | Switch to Ctrl+Click for Multi-Cursor | ❌ falta UNDRCode |
| _(vazio)_ | Column Selection Mode | ❌ falta UNDRCode |
| _(vazio)_ | Copy Line Up (Shift+Alt+↑) | ❌ falta UNDRCode |
| _(vazio)_ | Go to Symbol in Editor (Ctrl+Shift+O) | ≈ existe no Go menu UNDRCode |

---

## 4. Topbar — View menu

UNDRCode: `App.tsx:1244` `viewMenuItems`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Command Palette (Ctrl+Shift+P) | Command Palette... (Ctrl+Shift+P) | ✓ |
| Quick Open (Ctrl+P) | _(em Go menu, não View)_ | ≈ localização diferente |
| Toggle Sidebar (Ctrl+B) | Primary Side Bar (Ctrl+B) | ✓ |
| Toggle Bottom Panel (Ctrl+J) | Panel (Ctrl+J) | ✓ |
| Toggle Chat Pane (Ctrl+Alt+B) | Secondary Side Bar (Ctrl+Alt+B) | ✓ |
| Toggle Preview (`'`) | _Embedded Browser via Cursor browser tab_ | ≈ paradigma diferente |
| Toggle Fullscreen (F11) — _hint only_ | Full Screen (F11) | ✓ |
| _(vazio)_ | Zen Mode (Ctrl+K Z) | ❌ falta UNDRCode |
| _(vazio)_ | Centered Layout | ❌ falta UNDRCode |
| _(vazio)_ | Appearance → Menu Bar / Status Bar / Activity Bar / Side Bar toggles | ❌ falta UNDRCode |
| _(vazio)_ | Editor Layout → Split Up/Down/Left/Right (Ctrl+\\) | ❌ falta UNDRCode (sem split editor) |
| _(vazio)_ | Editor Layout → Two/Three/Four Columns | ❌ falta UNDRCode |
| _(vazio)_ | Editor Layout → Grid | ❌ falta UNDRCode |
| _(vazio)_ | Word Wrap (Alt+Z) | ❌ falta UNDRCode |
| _(vazio)_ | Toggle Minimap | ❌ falta UNDRCode |
| _(vazio)_ | Toggle Breadcrumbs | ❌ falta UNDRCode |
| _(vazio)_ | Show Whitespace / Render Control Characters | ❌ falta UNDRCode |
| _(vazio)_ | Open View... (Ctrl+Q) | ❌ falta UNDRCode |
| _(vazio)_ | Show Explorer/Search/SCM/Run/Extensions/Output/Problems/Debug Console/Terminal | ≈ paridade parcial via Bottom Panel + sidebar icons |

---

## 5. Topbar — Go menu

UNDRCode: `App.tsx:1300` `goMenuItems`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Go to File... (Ctrl+P) | Go to File... (Ctrl+P) | ✓ |
| Go to Symbol... (Ctrl+Shift+O) | Go to Symbol in Editor... (Ctrl+Shift+O) | ✓ |
| Go to Line... (Ctrl+G) — _disabled, Monaco built-in_ | Go to Line/Column... (Ctrl+G) | ≈ menu stub |
| Recent Files (Ctrl+E) | _(em File → Open Recent)_ | ≈ localização diferente |
| Switch Workspace... (Ctrl+Alt+R) | Switch Window... (Ctrl+R) | ≈ atalho diferente |
| _(vazio)_ | Back (Alt+←) | ❌ falta UNDRCode |
| _(vazio)_ | Forward (Alt+→) | ❌ falta UNDRCode |
| _(vazio)_ | Last Edit Location (Ctrl+K Ctrl+Q) | ❌ falta UNDRCode |
| _(vazio)_ | Go to Symbol in Workspace... (Ctrl+T) | ❌ falta UNDRCode |
| _(vazio)_ | Go to Definition (F12) | ❌ falta UNDRCode |
| _(vazio)_ | Go to Declaration | ❌ falta UNDRCode |
| _(vazio)_ | Go to Type Definition | ❌ falta UNDRCode |
| _(vazio)_ | Go to Implementations (Ctrl+F12) | ❌ falta UNDRCode |
| _(vazio)_ | Go to References (Shift+F12) | ❌ falta UNDRCode |
| _(vazio)_ | Go to Bracket (Ctrl+Shift+\\) | ❌ falta UNDRCode |
| _(vazio)_ | Next/Previous Problem (F8 / Shift+F8) | ❌ falta UNDRCode |
| _(vazio)_ | Next/Previous Change (Alt+F3 / Alt+Shift+F3) | ❌ falta UNDRCode |

---

## 6. Topbar — Run menu

UNDRCode: `App.tsx:1343` `runMenuItems`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Run Tasks... | Run Task... (Ctrl+Shift+B variants) | ✓ |
| Start Debugging (F5) — _disabled, sem debug runtime_ | Start Debugging (F5) | ≈ stub vs real |
| Stop Debugging (Shift+F5) — _disabled_ | Stop Debugging (Shift+F5) | ≈ stub |
| View Output | _(via View → Output)_ | ≈ localização diferente |
| View Problems | _(via View → Problems)_ | ≈ localização diferente |
| _(vazio)_ | Run Without Debugging (Ctrl+F5) | ❌ falta UNDRCode |
| _(vazio)_ | Restart Debugging (Ctrl+Shift+F5) | ❌ falta UNDRCode |
| _(vazio)_ | Step Over/Into/Out (F10/F11/Shift+F11) | ❌ falta UNDRCode |
| _(vazio)_ | Continue (F5) | ❌ falta UNDRCode |
| _(vazio)_ | Toggle Breakpoint (F9) | ❌ falta UNDRCode |
| _(vazio)_ | New Breakpoint → Function/Conditional/Inline/Logpoint | ❌ falta UNDRCode |
| _(vazio)_ | Enable All Breakpoints / Disable All / Remove All | ❌ falta UNDRCode |
| _(vazio)_ | Install Additional Debuggers... | ❌ falta UNDRCode |
| _(vazio)_ | Add Configuration... (.vscode/launch.json) | ❌ falta UNDRCode |

---

## 7. Topbar — Terminal menu

UNDRCode: `App.tsx:1382` `terminalMenuItems`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| New Terminal (Ctrl+`) | New Terminal (Ctrl+Shift+`) | ≈ atalho diferente |
| Toggle Terminal Panel (Ctrl+J) | _(via View → Panel)_ | ≈ localização diferente |
| View Ports | Ports view | ✓ |
| _(vazio)_ | Split Terminal (Ctrl+Shift+5) | ❌ falta UNDRCode |
| _(vazio)_ | Kill Terminal | ❌ falta UNDRCode (existe como botão na tab Terminal) |
| _(vazio)_ | Run Task... | ≈ existe no Run menu |
| _(vazio)_ | Run Build Task... (Ctrl+Shift+B) | ❌ falta UNDRCode |
| _(vazio)_ | Run Active File | ❌ falta UNDRCode |
| _(vazio)_ | Run Selected Text | ❌ falta UNDRCode |
| _(vazio)_ | Configure Tasks... | ❌ falta UNDRCode |
| _(vazio)_ | Configure Default Build Task | ❌ falta UNDRCode |
| _(vazio)_ | Show Running Tasks | ❌ falta UNDRCode |
| _(vazio)_ | Restart Running Task | ❌ falta UNDRCode |
| _(vazio)_ | Terminate Task | ❌ falta UNDRCode |
| _(vazio)_ | Switch Active Terminal | ❌ falta UNDRCode (single terminal) |
| _(vazio)_ | Rename Terminal | ❌ falta UNDRCode |

---

## 8. Topbar — Help menu

UNDRCode: `App.tsx:1407` `helpMenuItems`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Keyboard Shortcuts (Ctrl+/) | Keyboard Shortcuts Reference (Ctrl+K Ctrl+R) | ≈ atalho diferente |
| Welcome — Refazer Tour | Welcome | ✓ |
| Documentação Claude Code | Documentation | ✓ |
| Reportar problema (GitHub issues) | Report Issue | ✓ |
| Sobre UNDRCode (v0.0.1) — _disabled_ | About | ✓ |
| _(vazio)_ | Show All Commands (Ctrl+Shift+P) | ≈ via View menu UNDRCode |
| _(vazio)_ | Interactive Playground | ❌ falta UNDRCode |
| _(vazio)_ | Video Tutorials | ❌ falta UNDRCode |
| _(vazio)_ | Tips and Tricks | ❌ falta UNDRCode |
| _(vazio)_ | Join Us on YouTube/Twitter/Discord | ❌ falta UNDRCode |
| _(vazio)_ | Check for Updates... | ❌ falta UNDRCode |
| _(vazio)_ | Toggle Developer Tools (Ctrl+Shift+I) | ❌ falta UNDRCode |
| _(vazio)_ | Open Process Explorer | ❌ falta UNDRCode |
| _(vazio)_ | Open Log Folder / Open Logs / Show Logs | ❌ falta UNDRCode |
| _(vazio)_ | Privacy Statement | ❌ falta UNDRCode |
| _(vazio)_ | License | ❌ falta UNDRCode |
| _(vazio)_ | View License | ❌ falta UNDRCode |

---

## 9. Sidebar — "Mais opções" (⋯) menu

UNDRCode: `App.tsx:2543` ContextMenu items. Disparado pelo botão ⋯ na sidebar pane-left.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Configurações (Ctrl+,) | Settings (Ctrl+,) | ✓ |
| Atalhos do teclado (Ctrl+/) | Keyboard Shortcuts | ✓ |
| Histórico de conversas (Ctrl+Shift+H) | Chat History (sidebar) | ✓ |
| Checkpoints | _(via Source Control / Git extensions)_ | ⚠ extra UNDRCode (UI dedicada) |
| Gerenciar snippets (Ctrl+;) | User Snippets | ✓ |
| Limpar estado do workspace | _(via Workspace Storage)_ | ⚠ extra UNDRCode (botão direto) |
| Tema: Akai / Antigravity Dark / Light (cicla) | Color Theme (Ctrl+K Ctrl+T) | ≈ cicla vs picker |

---

## 10. Topbar — Settings dropdown (UNDRCode-only)

UNDRCode: `App.tsx:1455` `settingsMenuItems`. Cursor não tem botão settings separado no topbar — usa só Manage gear na sidebar.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Configurações (Ctrl+,) | Settings (Ctrl+,) | ✓ |
| Atalhos de Teclado (Ctrl+/) | Keyboard Shortcuts (Ctrl+K Ctrl+S) | ✓ |
| Editar UNDERCODE.md | _(via .cursorrules / Rules for AI)_ | ≈ análogo |
| Editar CLAUDE.md | _(via global Rules)_ | ≈ análogo |
| _(vazio)_ | Profile (switch profile) | ❌ falta UNDRCode |
| _(vazio)_ | Themes | ❌ falta UNDRCode (no Mais opções) |
| _(vazio)_ | Extensions / MCP / Connectors | ❌ falta UNDRCode aqui (no ⋯ menu) |

---

## 11. Topbar — Account menu (avatar)

UNDRCode: `App.tsx:1503` `accountMenuItems` + `buildAuthMenuItems`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Logado: email/plano (info) | Account (email + plan info) | ✓ |
| Plano Max/Pro/Free | Pro/Business/Free plan badge | ✓ |
| Sair | Sign Out | ✓ |
| Entrar (se não logado) | Sign In | ✓ |
| Sessão expirada — Entrar de novo | _(re-auth flow)_ | ✓ |
| Docs | Documentation | ✓ |
| Report Issue | Help → Report Issue | ✓ |
| _(vazio)_ | Manage Subscription | ❌ falta UNDRCode |
| _(vazio)_ | Manage Account (cursor.com/dashboard) | ❌ falta UNDRCode |
| _(vazio)_ | Usage / Credits | ❌ falta UNDRCode |
| _(vazio)_ | Team / Invite Members | ❌ falta UNDRCode |
| _(vazio)_ | Switch Account | ❌ falta UNDRCode |

---

## 12. Sidebar — Source Control panel

UNDRCode: `SourceControl.tsx:151`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Commit button (verde, top) | Commit (Ctrl+Enter) | ✓ |
| "vs main" diff cumulativo | _(via Compare With...)_ | ⚠ extra UNDRCode (atalho direto) |
| Refresh (icon) | Refresh | ✓ |
| Branch label (header) | Branch (status bar) | ✓ |
| STAGED CHANGES section + count | Staged Changes section | ✓ |
| CHANGES section + count | Changes section | ✓ |
| File row → click = open diff | File row → click = open diff | ✓ |
| File row → Stage button (+) | Stage Changes (+) | ✓ |
| File row → Unstage button (-) | Unstage Changes (-) | ✓ |
| _(vazio)_ | Discard Changes / Discard All | ❌ falta UNDRCode |
| _(vazio)_ | Stage All / Unstage All | ❌ falta UNDRCode (botões em lote) |
| _(vazio)_ | Commit Staged / Commit All / Commit Amend / Commit Signed | ❌ falta UNDRCode (só plain commit) |
| _(vazio)_ | Pull / Push / Sync (botões dedicados) | ❌ falta UNDRCode |
| _(vazio)_ | Fetch / Fetch From All Remotes | ❌ falta UNDRCode |
| _(vazio)_ | Create Branch / Checkout (via status bar UNDRCode) | ≈ paridade |
| _(vazio)_ | Merge Branch... | ❌ falta UNDRCode |
| _(vazio)_ | Rebase Branch... | ❌ falta UNDRCode |
| _(vazio)_ | Cherry Pick... | ❌ falta UNDRCode |
| _(vazio)_ | Stash / Apply Stash / Pop Stash | ❌ falta UNDRCode |
| _(vazio)_ | View History (graph) | ❌ falta UNDRCode |
| _(vazio)_ | Open in External Terminal | ❌ falta UNDRCode (no SC; existe no FileTree) |
| _(vazio)_ | Source Control Graph view | ❌ falta UNDRCode |
| _(vazio)_ | Source Control Repositories view | ❌ falta UNDRCode |
| _(vazio)_ | AI Commit Message generation (`cursor-commits`) | ❌ falta UNDRCode |

---

## 13. Sidebar — Search panel

UNDRCode: `SearchPanel.tsx`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Toggle "Substituir" (chevron) | Toggle Replace (▼) | ✓ |
| Search input "Buscar no workspace..." | Search input | ✓ |
| Clear (X, Esc) | Clear Search | ✓ |
| Replace input "Substituir por..." | Replace input | ✓ |
| Replace button "Substituir todas" | Replace All | ✓ |
| Substituir em N arquivos | Replace All in Files | ✓ |
| Match Case (Aa) | Match Case (Aa) | ✓ |
| Whole Word (ab\|) | Match Whole Word | ✓ |
| Use Regex (.*) | Use Regular Expression | ✓ |
| Toggle Filters (funnel icon) | Toggle Search Details | ✓ |
| files to include "ex: src/**, *.ts" | files to include | ✓ |
| files to exclude "ex: **/*.test.ts" | files to exclude | ✓ |
| Group by file row → click = expand | Group → expand | ✓ |
| Match row → click = open file at line | Match → open | ✓ |
| _(vazio)_ | Open New Search Editor | ❌ falta UNDRCode |
| _(vazio)_ | Clear Search History | ❌ falta UNDRCode |
| _(vazio)_ | Collapse All / Expand All (groups) | ❌ falta UNDRCode |
| _(vazio)_ | Refresh search | ❌ falta UNDRCode |
| _(vazio)_ | Use Exclude Settings and Ignore Files | ❌ falta UNDRCode |
| _(vazio)_ | Search → AI Search (semantic, codebase) | ❌ falta UNDRCode |

---

## 14. Sidebar — File Tree right-click (arquivo)

UNDRCode: `FileTree.tsx:708` `menuItems`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Abrir | Open | ✓ |
| Mencionar no chat (@) | Add to Chat / Add to Cmd-K | ✓ |
| Explicar este arquivo (AI) | Ask Cursor about this file | ✓ |
| Refatorar este arquivo (AI) | Edit with Cursor (Cmd+K) | ≈ workflow diferente |
| Escrever testes pra este (AI) | _(via custom .cursorrules)_ | ⚠ extra UNDRCode (one-click) |
| Renomear (F2) | Rename... (F2) | ✓ |
| Duplicar | Duplicate | ✓ |
| Apagar (Del) | Delete (Del) | ✓ |
| Copiar caminho | Copy Path (Shift+Alt+C) | ✓ |
| Copiar caminho relativo | Copy Relative Path (Ctrl+K Ctrl+Shift+C) | ✓ |
| Revelar no Explorer | Reveal in File Explorer (Shift+Alt+R) | ✓ |
| Comparar com... | Compare With Selected / Select for Compare | ✓ |
| Abrir com... | Open With... | ✓ |
| _(vazio)_ | Open to the Side (Ctrl+Enter) | ❌ falta UNDRCode (sem split) |
| _(vazio)_ | Reveal in Terminal | ❌ falta UNDRCode |
| _(vazio)_ | Copy | ❌ falta UNDRCode (clipboard file) |
| _(vazio)_ | Paste | ❌ falta UNDRCode |
| _(vazio)_ | Cut | ❌ falta UNDRCode |
| _(vazio)_ | Open in Integrated Terminal | ≈ existe em pasta |
| _(vazio)_ | Open Timeline | ❌ falta UNDRCode (existe Timeline section, sem trigger via context) |
| _(vazio)_ | Add Folder to Workspace | ❌ falta UNDRCode |
| _(vazio)_ | Find in Folder... (Shift+Alt+F) | ❌ falta UNDRCode (existe em pasta) |
| _(vazio)_ | Git submenu → Stage/Unstage/Discard Changes/Open Changes | ❌ falta UNDRCode |
| _(vazio)_ | Download (remote) | ❌ falta UNDRCode |
| _(vazio)_ | Properties | ❌ falta UNDRCode |

---

## 15. Sidebar — File Tree right-click (pasta)

UNDRCode: `FileTree.tsx:879+`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Novo arquivo aqui | New File | ✓ |
| Nova pasta aqui | New Folder | ✓ |
| Mencionar pasta no chat (@) | Add Folder to Chat | ✓ |
| Buscar nesta pasta... | Find in Folder... (Shift+Alt+F) | ✓ |
| Renomear (F2) | Rename... (F2) | ✓ |
| Apagar (Del) | Delete (Del) | ✓ |
| Copiar caminho | Copy Path | ✓ |
| Copiar caminho relativo | Copy Relative Path | ✓ |
| Revelar no Explorer | Reveal in File Explorer | ✓ |
| Abrir terminal aqui | Open in Integrated Terminal | ✓ |
| Definir como workspace | Open Folder | ≈ semelhante |
| _(vazio)_ | Open in New Window | ❌ falta UNDRCode |
| _(vazio)_ | Compare With... | ❌ falta UNDRCode (pasta) |
| _(vazio)_ | Collapse All (root level) | ❌ falta UNDRCode |
| _(vazio)_ | Add Folder to Workspace | ❌ falta UNDRCode (single-workspace) |
| _(vazio)_ | Refresh Explorer | ❌ falta UNDRCode |
| _(vazio)_ | Git submenu (folder-level) | ❌ falta UNDRCode |

---

## 16. Central — Tab right-click

UNDRCode: `CentralTabs.tsx:129` `tabMenuItems`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Fechar (Ctrl+W) | Close (Ctrl+W / Ctrl+F4) | ✓ |
| Fechar outras | Close Others (Ctrl+K U) | ✓ |
| Fechar à direita | Close to the Right | ✓ |
| Fechar todas | Close All | ✓ |
| Fixar tab / Desafixar tab | Pin Editor / Unpin Editor (Ctrl+K Shift+Enter) | ✓ |
| Copiar caminho (file) / Copiar título (view) | Copy Path | ✓ |
| Revelar no FileTree | Reveal in Explorer | ✓ |
| _(vazio)_ | Close Saved | ❌ falta UNDRCode |
| _(vazio)_ | Keep Open / Preview Mode | ❌ falta UNDRCode |
| _(vazio)_ | Split Right / Split Down (Ctrl+\\) | ❌ falta UNDRCode |
| _(vazio)_ | Move Editor (Left/Right/Group/Window) | ❌ falta UNDRCode |
| _(vazio)_ | Copy Relative Path | ❌ falta UNDRCode (existe só "Copiar caminho") |
| _(vazio)_ | Show Opened Editors | ❌ falta UNDRCode |
| _(vazio)_ | Reopen Closed Editor (Ctrl+Shift+T) | ❌ falta UNDRCode |
| _(vazio)_ | Open in New Window | ❌ falta UNDRCode |

---

## 17. Central — Editor right-click (Monaco)

UNDRCode: Monaco default context menu (não customizado em App.tsx).

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Cut / Copy / Paste | Cut / Copy / Paste | ✓ (Monaco default) |
| Go to Definition (F12) | Go to Definition (F12) | ≈ Monaco built-in, sem LSP backend em UNDRCode |
| Peek → Definition/References/Implementations | Peek → ... | ≈ Monaco UI mas vazio |
| Rename Symbol (F2) | Rename Symbol (F2) | ≈ Monaco UI |
| Change All Occurrences (Ctrl+F2) | Change All Occurrences | ≈ Monaco |
| Format Document (Shift+Alt+F) | Format Document | ≈ Monaco |
| Command Palette | Command Palette | ✓ |
| _(vazio)_ | Add to Cursor Chat (selection) | ❌ falta UNDRCode (existe Mention via @, não right-click) |
| _(vazio)_ | Edit with Cursor (Cmd+K) | ❌ falta UNDRCode |
| _(vazio)_ | Ask Cursor about this (selection) | ❌ falta UNDRCode |
| _(vazio)_ | Generate in-line code | ❌ falta UNDRCode (inline AI edit) |
| _(vazio)_ | Quick Fix (Ctrl+.) | ❌ falta UNDRCode (LSP) |
| _(vazio)_ | Source Action... | ❌ falta UNDRCode |
| _(vazio)_ | Refactor... (Ctrl+Shift+R) | ❌ falta UNDRCode |

---

## 18. Chat — Composer "Mode" popover

UNDRCode: `ChatView.tsx:1844` (modo de permissão).

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Solicitar permissões (1) | Ask Mode | ✓ |
| Aceitar edições (2) | Auto Mode | ≈ semântica análoga |
| Modo de planejamento (3) | Plan Mode | ✓ |
| Modo automático (4) | Agent Mode (auto-apply) | ✓ |
| Ignorar permissões — _disabled_ | YOLO Mode (`composer.allowYoloMode`) | ≈ stub vs real |
| _(vazio)_ | Background Agent (`cursor.backgroundAgents.*`) | ❌ falta UNDRCode |
| _(vazio)_ | Manual Mode | ❌ falta UNDRCode |
| _(vazio)_ | Customize Modes... | ❌ falta UNDRCode (Cursor permite criar modes custom) |

---

## 19. Chat — Composer "+" (add context) popover

UNDRCode: `ChatView.tsx:1882`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Adicionar arquivos ou fotos | Add Image / Add Files | ✓ |
| Adicionar pasta | Add Folder | ✓ |
| Comandos de barra (insere /) | Slash commands (/) | ✓ |
| Conectores (submenu MCP servers) | MCP Servers list | ✓ |
| Conectores → Gerenciar conectores... | Manage MCP Servers | ✓ |
| Conectores → Editar .mcp.json do workspace | _(via cursor settings JSON)_ | ⚠ extra UNDRCode (atalho) |
| Plugins | Extensions | ✓ |
| Customizações | _(via Settings)_ | ≈ análogo |
| _(vazio)_ | Add Codebase | ❌ falta UNDRCode |
| _(vazio)_ | Add Web (URL fetch) | ❌ falta UNDRCode |
| _(vazio)_ | Add Docs (Cursor's @Docs system) | ❌ falta UNDRCode |
| _(vazio)_ | Add Git (commit/branch context) | ❌ falta UNDRCode |
| _(vazio)_ | Add Recent Changes | ❌ falta UNDRCode |
| _(vazio)_ | Add Lint Errors | ❌ falta UNDRCode |
| _(vazio)_ | Add Notepads | ❌ falta UNDRCode |
| _(vazio)_ | Add Past Chats | ❌ falta UNDRCode |
| _(vazio)_ | Capture Browser Tab (Cursor Browser) | ❌ falta UNDRCode |
| _(vazio)_ | Voice / Mic (composer.voice.*) | ❌ falta UNDRCode (botão mic UNDRCode não está implementado) |

---

## 20. Chat — Composer "Model" popover

UNDRCode: `ChatView.tsx:1943`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Modelos (section) | Models list | ✓ |
| Opus 4.7 (1) | Claude Opus 4.5+ via subscription | ≈ modelo específico |
| Opus 4.7 1M | _(1M context as add-on)_ | ⚠ extra UNDRCode (atalho 2) |
| Sonnet 4.6 (3) | Claude Sonnet 4.6 | ✓ |
| Haiku 4.5 (4) | Claude Haiku 4.5 | ✓ |
| Opus 4.6 — _Legado_ (5) | _(modelo removido)_ | ⚠ extra UNDRCode |
| Esforço (section) — Baixa/Médio/Alto/Extra alto/Max | Reasoning Effort (low/medium/high) | ≈ UNDRCode tem mais granular |
| Modo rápido (toggle) | Fast Mode / Auto Model | ≈ paridade conceitual |
| _(vazio)_ | GPT-5 / o3 / o4-mini / Gemini 2.5 Pro / Grok | ❌ falta UNDRCode (multi-provider) |
| _(vazio)_ | Custom Models (Cursor API key) | ❌ falta UNDRCode |
| _(vazio)_ | Add Custom Model... | ❌ falta UNDRCode |
| _(vazio)_ | Model Picker shortcut config | ❌ falta UNDRCode |
| _(vazio)_ | Pin model to recent | ❌ falta UNDRCode |

---

## 21. Chat — Composer "Snippets" popover (extra UNDRCode)

UNDRCode: `ChatView.tsx:1820`. Disparado por Ctrl+;.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Lista de snippets salvos do user | _(via @Snippets / .cursor/rules)_ | ⚠ extra UNDRCode (UI dedicada) |
| Empty state → hint pra Mais opções → Gerenciar snippets | _(via JSON edit)_ | ⚠ extra UNDRCode |

---

## 22. Chat — toolbar pane-right (Visualizações)

UNDRCode: `App.tsx:2399` chatview-toolbar + `viewsMenuItems` (1089).

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Visualização de transcrição (Ctrl+O, eye icon) | Show Raw Chat / Logs | ≈ análogo |
| Visualizações button (preview icon → dropdown) | _(via View menu)_ | ⚠ extra UNDRCode (botão dedicado) |
| Visualizações → Histórico de conversas (Shift+Ctrl+F) | Chat History | ✓ |
| Visualizações → Plano | _(via Plan Mode toggle)_ | ≈ análogo |
| Visualizações → Tarefas em segundo plano | Background Agents | ✓ |
| _(vazio)_ | Open Chat in New Pane (`composer.openAsPane`) | ❌ falta UNDRCode |
| _(vazio)_ | Duplicate Chat | ❌ falta UNDRCode |
| _(vazio)_ | Fork Shared Chat | ❌ falta UNDRCode |
| _(vazio)_ | Share Chat (link) | ❌ falta UNDRCode |
| _(vazio)_ | New Chat (Ctrl+L) | ❌ falta UNDRCode (existe via reset session, não botão) |

---

## 23. Status bar — items clicáveis

UNDRCode: `StatusBar.tsx:474+`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| CWD (display only) | _(no status bar)_ | ⚠ extra UNDRCode |
| Branch (click → branch picker) | Branch (click → checkout submenu) | ✓ |
| Branch — ahead/behind indicators (↑N ↓N) | Branch sync indicators | ✓ |
| Dirty count "N unsaved" (click → Save All) | _(no equivalent)_ | ⚠ extra UNDRCode |
| Problems "X errors Y warnings" (click → BottomPanel.problems) | Problems badge (click → Problems view) | ✓ |
| Session ID (display) | _(Cursor não expõe)_ | ⚠ extra UNDRCode |
| Turns counter (display) | _(no equivalent)_ | ⚠ extra UNDRCode |
| Plan/Accept mode badges | _(via mode pill no composer)_ | ≈ localização diferente |
| Memory hint "mem" (UNDERCODE.md loaded) | _(no equivalent)_ | ⚠ extra UNDRCode |
| Indent (click → prompt) | Indent: Spaces/Tabs (click → picker) | ✓ |
| Encoding (click → toast "só UTF-8") | Encoding (click → picker) | ≈ UNDRCode hardcoded |
| Line Ending LF/CRLF (click → prompt) | EOL: LF/CRLF (click → picker) | ✓ |
| Language (click → prompt) | Language Mode (click → picker) | ✓ |
| RAM/CPU/Process indicator | _(no equivalent)_ | ⚠ extra UNDRCode |
| _(vazio)_ | Line/Column (Ln X, Col Y) — _UNDRCode exibe via selection event_ | ≈ existe via editor-selection event |
| _(vazio)_ | Selection char count (X chars selected) | ≈ existe em UNDRCode |
| _(vazio)_ | Tasks running indicator | ❌ falta UNDRCode |
| _(vazio)_ | Background agents indicator | ❌ falta UNDRCode |
| _(vazio)_ | Tweet feedback link | ❌ falta UNDRCode |
| _(vazio)_ | Live Share / Remote / SSH indicator | ❌ falta UNDRCode |
| _(vazio)_ | Sync status (settings sync) | ❌ falta UNDRCode |
| _(vazio)_ | Notifications dot (uses bell icon UNDRCode) | ≈ paridade |
| _(vazio)_ | "0" Errors/Warnings shortcut (zero state) | ❌ falta UNDRCode |

---

## 24. Status bar — Notification bell

UNDRCode: `StatusBar.tsx:610+`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Bell icon com badge (unread count) | Notifications icon (badge) | ✓ |
| Click → dropdown com lista | Click → notifications panel | ✓ |
| "Marcar todas como lidas" | Mark All as Read | ✓ |
| "Limpar" (clearNotifications) | Clear All Notifications | ✓ |
| Item da lista: icon + título + tempo relativo | Item: title + timestamp | ✓ |
| Click no item → marca como lido | Click → focus source | ≈ paridade parcial |
| _(vazio)_ | Do Not Disturb (mute) | ❌ falta UNDRCode |
| _(vazio)_ | Notification settings link | ❌ falta UNDRCode |
| _(vazio)_ | Snooze notification | ❌ falta UNDRCode |

---

## 25. Status bar — Branch picker

UNDRCode: `StatusBar.tsx:242` `branchMenuItems`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Branch atual (disabled, "[name] (atual)") | Current branch (header) | ✓ |
| Lista de branches locais | Local branches | ✓ |
| Lista de remote branches órfãos (até 8) | Remote branches | ✓ |
| Criar nova branch... | Create new branch... | ✓ |
| Abrir Source Control | _(via sidebar)_ | ⚠ extra UNDRCode |
| _(vazio)_ | Create new branch from... | ❌ falta UNDRCode |
| _(vazio)_ | Publish branch | ❌ falta UNDRCode |
| _(vazio)_ | Pull, Push, Sync (no picker) | ❌ falta UNDRCode |
| _(vazio)_ | Checkout to detached HEAD | ❌ falta UNDRCode |
| _(vazio)_ | Checkout tag | ❌ falta UNDRCode |

---

## 26. Bottom Panel — tabs

UNDRCode: `BottomPanel.tsx:187`.

| Tab (UNDRCode) | Tab (Cursor) | Status |
|---|---|---|
| Problems | Problems | ✓ |
| TODOs | _(via Todo Tree extension)_ | ⚠ extra UNDRCode (built-in) |
| Pending Changes (badge) | _(via SCM)_ | ⚠ extra UNDRCode |
| Output | Output | ✓ |
| Debug Console | Debug Console | ✓ |
| Terminal | Terminal | ✓ |
| Tasks | _(via View → Run Task)_ | ⚠ extra UNDRCode (tab dedicada) |
| Ports | Ports | ✓ |
| _(vazio)_ | Comments | ❌ falta UNDRCode |
| _(vazio)_ | Refactor Preview | ❌ falta UNDRCode |
| _(vazio)_ | Test Results | ❌ falta UNDRCode |

---

## 27. Bottom Panel — toolbar

UNDRCode: `BottomPanel.tsx:218+`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Shell label (PowerShell etc) — só na tab Terminal | Shell selector | ≈ Cursor permite trocar |
| Limpar tela (clear-all icon) — só na Terminal | Clear Terminal | ✓ |
| Matar e reiniciar shell (trash icon) — só na Terminal | Kill Terminal | ✓ |
| Maximizar painel / Restaurar tamanho | Maximize Panel / Restore | ✓ |
| Fechar painel (close) | Hide Panel | ✓ |
| _(vazio)_ | Move Panel Position (right/bottom) | ❌ falta UNDRCode |
| _(vazio)_ | New Terminal split | ❌ falta UNDRCode |
| _(vazio)_ | Switch Terminal Profile | ❌ falta UNDRCode |
| _(vazio)_ | Find in Terminal (Ctrl+F) | ❌ falta UNDRCode |
| _(vazio)_ | Toggle Word Wrap (terminal) | ❌ falta UNDRCode |
| _(vazio)_ | Open Settings (terminal-specific gear) | ❌ falta UNDRCode |

---

## 28. Command Palette items

UNDRCode: `commandRegistry.ts:24` (apenas 18 items hardcoded). Cursor: ~1714 workbench.* commands.

| Item (UNDRCode) | Cursor equivalent | Status |
|---|---|---|
| Open Workspace... | workbench.action.files.openFolder | ✓ |
| Open Files... | workbench.action.files.openFile | ✓ |
| Toggle Primary Side Bar (Ctrl+B) | workbench.action.toggleSidebarVisibility | ✓ |
| Toggle Bottom Panel (Ctrl+J) | workbench.action.togglePanel | ✓ |
| Toggle Chat Pane (Ctrl+Alt+B) | composer.openOrToggleSidebar | ✓ |
| Show Transcript (Ctrl+O) | _(no direct equiv)_ | ⚠ extra UNDRCode |
| Toggle Preview | _(via embedded browser)_ | ≈ paradigma diferente |
| Customize Layout... | workbench.action.editLayout | ✓ |
| Show Git Diff | git.openChange | ✓ |
| Commit Changes... | git.commit | ✓ |
| Open Settings | workbench.action.openSettings | ✓ |
| Reload Window (Ctrl+R) | workbench.action.reloadWindow | ✓ |
| Keyboard Shortcuts (Ctrl+/) | workbench.action.openGlobalKeybindings | ✓ |
| Refazer tour de boas-vindas | workbench.action.openWalkthrough | ✓ |
| Abrir histórico de conversas (Ctrl+Shift+H) | composer.openChatHistory | ✓ |
| Manage MCP Servers | cursor.openMcpSettings | ✓ |
| Plugin Marketplace | workbench.extensions.action.showExtensions | ✓ |
| **— ~1690 outros workbench.* commands —** | _(massivo gap)_ | ❌ falta UNDRCode |

Notable Cursor commands ausentes no command palette UNDRCode:

| Cursor command | Status |
|---|---|
| workbench.action.quickOpen | ❌ falta (existe via Ctrl+P direto, sem no Palette) |
| workbench.action.showAllSymbols | ❌ falta |
| workbench.action.gotoLine | ❌ falta |
| workbench.action.findInFiles | ≈ existe via menu |
| workbench.action.tasks.runTask | ❌ falta no Palette |
| workbench.action.debug.start | ❌ falta |
| workbench.action.terminal.new | ❌ falta no Palette |
| workbench.action.openRecent | ❌ falta no Palette |
| workbench.action.closeWindow | ❌ falta |
| workbench.action.zoomIn / zoomOut / zoomReset | ❌ falta |
| workbench.action.toggleZenMode | ❌ falta |
| workbench.action.splitEditor | ❌ falta |
| workbench.action.openColorTheme | ❌ falta |
| workbench.action.openIconTheme | ❌ falta |
| editor.action.formatDocument | ❌ falta no Palette |
| editor.action.rename | ❌ falta no Palette |
| composer.openAsPane | ❌ falta |
| composer.duplicateChat | ❌ falta |
| composer.createNew | ❌ falta |
| composer.find.focus | ❌ falta (find in chat) |
| cursor.installCli | ❌ falta (instalar `undrcode` CLI?) |
| cursor.checkonupdate | ❌ falta |
| cursor.openAdditionalGlassModeWindowDev | n/a (Cursor-specific) |
| cursor.browserView.* | n/a (Cursor browser) |
| cursor.blame | ❌ falta (git blame on hover) |
| cursor.hooks | ❌ falta (custom hooks) |
| cursor.memorymonitor.* | ❌ falta |
| cursor.shadow workspace ops | n/a |

---

## 29. Sidebar — Primary tab icons

UNDRCode: `App.tsx:2192+`.

| Icon (UNDRCode) | Icon (Cursor) | Status |
|---|---|---|
| Files (codicon-files) | Explorer | ✓ |
| Search (codicon-search) | Search | ✓ |
| Source Control (codicon-source-control) | Source Control | ✓ |
| Extensions (codicon-extensions) → opens PluginMarketplace | Extensions view | ✓ |
| Mais opções (codicon-ellipsis) → suspenso menu | _(Manage gear no bottom)_ | ≈ posição diferente |
| _(vazio)_ | Run and Debug (codicon-debug-alt) | ❌ falta UNDRCode |
| _(vazio)_ | Chat (codicon-comment-discussion) — primary icon | ❌ falta UNDRCode (chat é pane-right, não sidebar icon) |
| _(vazio)_ | Background Agents | ❌ falta UNDRCode |
| _(vazio)_ | Cursor Tab Settings / Tunnels | ❌ falta UNDRCode |
| _(vazio)_ | Testing (test explorer) | ❌ falta UNDRCode |
| _(vazio)_ | Accounts (avatar at bottom) | ≈ existe no topbar UNDRCode |
| _(vazio)_ | Manage (gear at bottom) | ≈ existe no topbar UNDRCode |

---

## 30. Welcome view

UNDRCode: `WelcomeView.tsx:295+`.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Logo "_UNDRCOD" wordmark | Cursor logo | ✓ |
| Resume banner "Continuar de onde parou?" | _(via getting started page)_ | ⚠ extra UNDRCode (smart resume) |
| CTA primary "Abrir pasta" | "Open Folder" CTA | ✓ |
| CTA secondary "Preview de dev" | _(no equivalent)_ | ⚠ extra UNDRCode |
| CTA secondary "Clonar repositório" | "Clone Git Repository" CTA | ✓ |
| Lista vertical "Workspaces" com pin | "Recent" list | ≈ pin é extra UNDRCode |
| Show more / Show less toggle | _(via "More..." link)_ | ✓ |
| Pin / Unpin button por workspace | _(via workspace settings)_ | ⚠ extra UNDRCode |
| _(vazio)_ | "Connect via SSH" CTA | ❌ falta UNDRCode |
| _(vazio)_ | "Open Codespace" CTA | ❌ falta UNDRCode |
| _(vazio)_ | "Start" walkthrough cards | ❌ falta UNDRCode |
| _(vazio)_ | "Customize" walkthrough cards | ❌ falta UNDRCode |
| _(vazio)_ | "Learn" walkthrough cards (tour video) | ❌ falta UNDRCode (tem tour mas via Help) |
| _(vazio)_ | "Show welcome page on startup" toggle | ❌ falta UNDRCode |

---

## 31. Window controls (frame)

UNDRCode: `App.tsx:47` WindowControls.

| Item (UNDRCode) | Item (Cursor) | Status |
|---|---|---|
| Minimizar | Minimize | ✓ |
| Maximizar / Restaurar | Maximize / Restore | ✓ |
| Fechar | Close | ✓ |

---

## 32. Resumo executivo

### Total de items mapeados

| App | Itens (aprox.) |
|---|---:|
| UNDRCode | ~145 items clicáveis distintos (8 menus topbar × 5–10 items + 12 painéis/popovers) |
| Cursor | ~280 items distintos nos mesmos contextos + 1714 workbench.* commands no Palette |

**Paridade funcional dos items que UNDRCode tem:** ~75% têm equivalente Cursor (✓ + ≈).
**Gap absoluto:** Cursor tem ~130 items que UNDRCode não tem (❌).
**Extras UNDRCode:** ~18 items unique (⚠).

### Top 10 itens faltando no UNDRCode (priorizado por uso comum)

1. **New File / New Window** no File menu — falta comando óbvio pra criar arquivo solto sem context de pasta.
2. **Editor Layout → Split Right/Down (Ctrl+\\)** — sem split editor; bloqueia paridade com fluxo "compare side-by-side" do Cursor.
3. **Go to Definition / References / Implementations (F12, Shift+F12)** — sem LSP backend, todo Go menu pós-Symbol está vazio.
4. **Back / Forward (Alt+←/→)** — navegação por histórico de cursor entre arquivos.
5. **Reopen Closed Editor (Ctrl+Shift+T)** — falta no tab context menu, alto uso diário.
6. **Format Document (Shift+Alt+F)** no command palette + Edit menu.
7. **Toggle Word Wrap (Alt+Z)** no View menu.
8. **Discard Changes / Stage All / Pull / Push / Sync** botões dedicados no Source Control panel.
9. **AI Commit Message generation** — Cursor tem `cursor-commits` extension dedicada; UNDRCode faz commit manual.
10. **Add Codebase / Add Web / Add Docs** no composer "+" — context types além de arquivo/pasta.

### Top 5 itens UNIQUE do UNDRCode (não existem em Cursor padrão)

1. **"vs main" diff cumulativo** no Source Control header — atalho de 1 clique pra revisar todo trabalho da branch contra main.
2. **Dirty count "N unsaved" na status bar** com click → Save All — feedback visível de unsaved + ação one-click.
3. **Tema cicla no Mais opções menu** (Akai → Antigravity Dark → Light → Akai) — sem precisar abrir picker modal.
4. **Snippets popover dedicado (Ctrl+;)** no composer — biblioteca de prompts salvos com inserção no caret.
5. **RAM/CPU/Process indicator na status bar** — telemetria local visível sem abrir Task Manager.

### Localização do output

`C:\Users\taked\Desktop\akai-code\AUDIT-MENUS.md`
