# UNDRCOD — Codebase Reference

Este arquivo é auto-carregado pelo `claude` CLI quando user edita UNDRCOD. Contém contexto profundo de arquitetura, convenções e gotchas. Pra contexto universal (qualquer projeto), ver `src/main/undrcode-system-prompt.ts`.

---

## O que é

**UNDRCOD** é um IDE desktop pra Claude Code — wrapper Electron rico que estende o `claude` CLI base com UI completa. **Não é fork do VS Code**. Stack from-scratch:

- **Electron 31** (main + preload + renderer multi-process)
- **electron-vite 2** (dev/build pipeline)
- **React 18** + **TypeScript 5.5 strict**
- **Monaco editor 0.50** (editor library, sem extension host)
- **xterm 5** + **node-pty** (terminal)
- **marked** + **prismjs** (markdown + syntax highlight no chat)

Brand: **UNDRCOD** (all-caps). Sempre. Não use "Akai Code" (antigo) nem "UNDRCode" (variante errada).

---

## Layout dos paines (App.tsx)

```
┌──────────────────────────────────────────────────────────────┐
│ Topbar (menus File/Edit/View/Selection/Go/Run/Terminal)     │
├────────────┬──────────────────────────┬──────────────────────┤
│            │  CentralTabs             │ ChatSessionTabs      │
│ pane-left  │  (file tabs)             │ (chat sessions)      │
│            ├──────────────────────────┤                      │
│ FileTree   │                          │ ChatView             │
│ Search     │  Monaco editor           │ (composer + msgs)    │
│ Git        │  OR FilePreview          │                      │
│ Plugins    │  OR PreviewView          │                      │
│            │  OR DiffViewer           │                      │
│ Outline    │  OR CompareFiles         │                      │
│ Timeline   │                          │                      │
├────────────┴──────────────────────────┴──────────────────────┤
│ Bottom panel (Terminal / Problems / Output)                  │
├──────────────────────────────────────────────────────────────┤
│ StatusBar (cwd + session info + dirty count)                 │
└──────────────────────────────────────────────────────────────┘
```

Tokens de tamanho: `--pane-topbar-height` (36px), `--bp-ws-sm/md` (breakpoints).

---

## Architecture — 3 processos do Electron

### 1. Main process (`src/main/`)
- `index.ts` — bootstrap, BrowserWindow, registrar todos os IPC handlers
- `agent-manager.ts` — spawn do `claude` CLI por session, stream-json parser, retry/dedup
- `plugin-manager.ts` — shell-out `claude plugin <cmd>`, lê `~/.claude/plugins/known_marketplaces.json` + `marketplace.json`
- `claude-sessions.ts` — lê `~/.claude/projects/<encoded-cwd>/` (encoding `[^a-zA-Z0-9-]→-`)
- `customization-manager.ts` — discovery de rules/skills/workflows/agents/hooks (workspace + user + plugins)
- `permission-mcp-server.ts` — MCP server local que faz bridge das permission requests pro renderer
- `terminal.ts` — node-pty spawn por session
- `preview-view.ts` — gerencia WebContentsView pro Preview pane
- `auth-claude.ts` — sniffer pra detectar status de auth (logged in / expired)
- `ipc/*.ts` — handlers organizados por área

### 2. Preload (`src/preload/`)
- `index.ts` — expõe `window.undrcodAPI` via `contextBridge.exposeInMainWorld`
- `preview-webview.ts` — preload específico do `<webview>` do Preview

**CRÍTICO**: `electron.vite.config.ts > preload > rollupOptions.output.manualChunks = () => null`. Sandbox do Electron não consegue `require()` chunks externos, então TUDO inline em cada entry. Sem isso, `window.undrcodAPI` fica undefined.

### 3. Renderer (`src/renderer/`)
- `App.tsx` — root, layout, todos os menus de topbar, IPC wiring (4900+ linhas, ainda manageable mas zoneada)
- `index.tsx` — entry point
- `index.html` — bootstrap

Vite alias:
- `@renderer` → `src/renderer`
- `@shared` → `src/shared`
- `@main` (só no main config) → `src/main`

---

## Componentes principais

### ChatView (`src/renderer/components/ChatView/`)
O componente coração — composer + stream de mensagens com markdown, code blocks (Prism), tool cards, permission cards, todo checklist, CSS edit chips.

- `ChatView.tsx` — 4000+ linhas, item rendering, streaming logic, mention autocomplete, CSS chips, evento listeners
- `PermissionCard.tsx` — gate de aprovação inline pra tool calls (já redesigned como "system call signature" com risk classes)
- `ComposerPopover.tsx` — popover de tools (mention, mic, etc) ao lado do composer
- `MentionAutocomplete.tsx` — autocomplete de @file/@folder
- `lightMarkdown()` — regex-based markdown inline DURANTE streaming (bold/italic/code/strike) — evita O(N²) do marked.parse a cada delta

### MonacoEditor (`src/renderer/components/MonacoEditor/`)
Wrapper sobre `@monaco-editor/react` + Monaco. Configurado pra VS Code-like behavior (semantic highlighting, inlay hints, snippets inline, hover, parameter hints). Integra com NEP via `NepController` (overlay scrollbar não-aplicado aqui — só nos tabs).

Suporta inline diff visual (`showInlineDiff(path, { adds, removes })`) — usado pelo agente pra mostrar mudanças antes de aplicar.

### Sidebar (FileTree / SearchPanel / GitPanel / InstalledPluginsList)
4 tabs trocáveis via activity bar de ícones. Estado em localStorage `undrcode.primarySidebarTab`.

### CentralTabs (`src/renderer/components/CentralTabs/`)
Tabs do pane-mid. Cada tab pode ser `file` (FilePreview→MonacoEditor), `view` (preview/diff/files/tasks/plan), ou `compare` (DiffEditor com 2 paths).

### CSS Inspector (`src/renderer/components/PreviewView/`)
**Feature signature do UNDRCOD**: user inspeciona elementos no Preview pane (WebContentsView), edita CSS ao vivo, edits acumulam num popover (`EditsPopover`). Pode mandar todos pro chat como contexto. Bubbles `cssChanges` aparecem no transcript com path/seletor/changes.

Implementado via:
- Preload injetado no WebContentsView (`preview-webview.ts`)
- `executeJavaScript` direto pra apply edits (não usa `<webview>` mais — V3 pattern do Cursor)
- IPC `previewView:*` (createView, applyEdit, takeScreenshot, etc)

### NEP — Next Edit Prediction (`src/renderer/nep/`)
Detector LOCAL de edit patterns. User renomeia `getUser` → `fetchUser`, NEP detecta e sugere onde mais no arquivo aplicar.

- `types.ts` — interfaces (EditPattern, PatternMatch, EditSuggestion)
- `edit-observer.ts` — hook em `model.onDidChangeContent`, debounce 100ms
- `pattern-matcher.ts` — roda patterns aplicáveis, dedup, sort confidence
- `suggestion-cache.ts` — LRU 10 files
- `ghost-edit-renderer.ts` — Monaco decorations (gutter dots + ghost text inline) + key bindings (Tab/Esc/Alt+]/Alt+[/Ctrl+Shift+Enter)
- `nep-controller.ts` — wire de tudo
- `patterns/universal.ts` — 6 patterns universais (rename, string, number, typo, operator, comment)
- `patterns/jsts.ts` — 10 patterns JS/TS (var-to-const, require-to-import, then-to-await, etc)

Doc completa: `docs/NEP-STRATEGY.md` (461 linhas, com plano de releases + tier 2 AI opt-in pro futuro).

### Plugin Marketplace + Skills (`src/renderer/components/PluginMarketplace/` + `InstalledPluginsList/`)
- Plugins = bundles do Claude Code (slash commands, agents, hooks, MCP, skills). Installa via `claude plugin install <name>@<marketplace>`.
- Skills curadas = catálogo de 10 skills recomendadas em `src/shared/curated-skills.ts`. Installa via `npx skills add <source>`.
- Sidebar `InstalledPluginsList` mostra ambas as listas.
- Modal `PluginMarketplace` é o marketplace cheio com categorias, search, sort.

### OverlayScrollbar (`src/renderer/components/OverlayScrollbar/`)
Scrollbar custom estilo Cursor — esconde nativa, renderiza thumb absolute como sibling do scroll container, fade-in só no hover do parent (`.has-overlay-scrollbar`). Suporta horizontal + vertical. Aplicado em: ChatSessionTabs, CentralTabs, FileTree.

---

## IPC Contract

Window globals expostos:
- `window.undrcodAPI` — main API surface
- `window.undrcodBrowser` — Preview/browser stuff
- `window.__undrcodInspector` — CSS inspector internal API

Áreas do `undrcodAPI`:

| Área | Métodos | File |
|---|---|---|
| `auth` | `status`, `loginOpen`, `logout` | `auth-claude.ts` |
| `claude` | `listProjectSessions`, `loadSession`, `deleteSession`, ... | `claude-sessions.ts` |
| `agent` | `start`, `cancel`, `respondPermission`, ... | `agent-manager.ts` |
| `plugins` | `listMarketplaces`, `listPlugins`, `install`, `uninstall`, `setEnabled`, ... | `plugin-manager.ts` |
| `skills` | `installCurated(source, skillFilter?)` | `ipc/skills.ts` |
| `customization` | `summary`, `listRules`, `listSkills`, `listWorkflows`, `listAgents`, `listHooks` | `customization-manager.ts` |
| `mcp` | `list`, `add`, `remove`, `getCatalog` | `mcp.ts` |
| `fs` | `read`, `write`, `list`, `stat`, `watch`, ... | `ipc/fs.ts` |
| `terminal` | `start`, `write`, `resize`, `kill` | `terminal.ts` |
| `previewView` | `create`, `destroy`, `setUrl`, `applyEdit`, ... | `preview-view.ts` |
| `whisper` | `start`, `stop`, `cancel` | `whisper.ts` |
| `system` | `openExternal`, `showItemInFolder`, `getVersion`, ... | `ipc/system.ts` |
| `checkpoint` | `list`, `save`, `restore`, `delete` | `ipc/checkpoint.ts` |
| `settings` | `get`, `set`, `getAll` | `ipc/settings.ts` |

Padrão de naming: `<area>:<method>` no IPC channel (ex: `plugins:listInstalled`, `agent:respondPermission`).

---

## Design tokens

Definidos em `src/renderer/styles/global.css` no `:root, html[data-theme="undrcod"]`. Acessar via `var(...)`.

### Cores

```
--bg-base       #0d0d0d   /* canvas atrás dos cards */
--bg-panel      #141414   /* topbar, statusbar */
--bg-card       #1a1a1a   /* pane-left/right/chatview */
--bg-elevated   #1f1f1f   /* hover, dropdown, popover */
--bg-input      #161616
--bg-active     #262626
--bg-hover-dropdown #2a2a2a

--fg-primary    #e4e4e7
--fg-secondary  #b8b8bd
--fg-muted      #7a7a82
--fg-tertiary   #5e5e64
--fg-disabled   #4d4d52

--accent              #4F8FFA   /* Antigravity Blue — DEFAULT */
--accent-50..900      (escala 50→900)
--accent-hover        #6FA6FF
--accent-soft         color-mix(in oklab, accent 14%, transparent)
--accent-glow         rgba(79,143,250,0.22)
--accent-gradient     linear-gradient(135deg, #4F8FFA 0%, #6FA6FF 100%)

--border-subtle  #232328
--border-strong  #34343a
--border-focus   var(--accent)

--green-400 #7aae66 (DEFAULT)  + escala 50..900
--red-500   #de5555 + escala
--red-600   #cb3d3d (DEFAULT)
--orange-400 #e8975f (DEFAULT) + escala
```

### Espaço, raio, tipografia, motion

```
--space-1..8      4 / 8 / 12 / 16 / 24 / 36 / 48 / 64 px
--radius-sm/md/lg/xl/2xl/3xl/pill   4 / 6 / 8 / 10 / 12 / 16 / 9999 px

--font-body       'Geist', system-ui ...
--font-mono       'Geist Mono', Consolas, ui-monospace
--font-display    'Fraunces', serif

--duration-instant  80ms
--duration-fast    140ms
--duration-base    180ms
--duration-slow    280ms
--ease-out-expo    cubic-bezier(0.16, 1, 0.3, 1)
--ease-out-quart   cubic-bezier(0.25, 1, 0.5, 1)
```

### Theme

Só **um tema** ativo: `undrcod` (dark, Antigravity Blue accent). Não tem light/warm/etc. Aliases legacy (`data-theme="antigravity-dark"`, `champagne`) apontam pro mesmo bloco.

---

## Eventos DOM custom

Prefixo `undrcod:`. Componentes ouvem via `window.addEventListener`. Lista parcial:

- `undrcod:plugins-changed` — sidebar de plugins precisa refresh
- `undrcod:export-transcript` — ChatView serializa items como markdown na clipboard
- `undrcod:terminal-to-chat` — terminal output vira input do chat
- `undrcod:show-inline-diff` — MonacoEditor renderiza diff inline
- `undrcod:attach-css-changes` — CSS Inspector apply → chat chip
- `undrcod:open-more-menu` — activity bar "..." menu
- `undrcod:apply-code-block` — code block "aplicar" button
- `undrcod:tree-refresh` — FileTreeItem refresh por dir
- `undrcod:plugins-changed` — broadcast quando user install/uninstall

---

## Convenções

### TypeScript

- `strict: true` em tsconfig
- Sem `any` (use `unknown` se precisa)
- Função `void` quando retorno irrelevante (não `Promise<any>`)
- Tipos exportados via `interface` quando objeto, `type` quando union/alias
- Discriminated unions pra eventos (ex: `ChatItem`)

### React

- Components funcionais, hooks
- `useCallback` em handlers passados pra children pesados
- `useMemo` em derived state caro (filters, sorts em listas grandes)
- `React.lazy()` + `Suspense` em modais pesados (PluginMarketplace, SettingsModal, etc) — economiza initial bundle
- Refs pra DOM (ex: scrollRef pro OverlayScrollbar)

### CSS

- Sempre tokens, nunca hex hardcoded (exceção: fallback no `color-mix(..., var(--green-400, #7aae66) ...)`)
- BEM-ish: `.component-name__element--modifier` ou nested `.component-name .child`
- `position: relative` no parent quando filho usa `position: absolute`
- Mobile-first via media queries só quando necessário (Electron geralmente fixed width)
- `--ease-out-expo` é o easing padrão. Nunca bounce/elastic.

### Comentários

- Em **pt-BR**, lowercase casual (matches Rafael's style)
- Explicar "por que" não "o que" (código já diz o que)
- Quando há gotcha não-óbvio (Electron sandbox, race conditions, etc), comentar em destaque

### Naming

- Files: PascalCase pra components (`ChatView.tsx`), kebab-case pra utils/modules (`agent-manager.ts`, `claude-sessions.ts`)
- IPC channels: `<area>:<method>` (`plugins:listInstalled`)
- localStorage keys: `undrcod.<feature>.<key>` ou `undrcod:<feature>-state` (varia, sem padrão único — mais comum `undrcod.foo` com ponto)
- Eventos: `undrcod:event-name` (sempre dois pontos + kebab-case)

---

## Build & dev

```bash
npm run dev          # electron-vite dev --watch (HMR pro renderer)
npm run build        # electron-vite build (output em out/)
npm run package      # build + electron-builder --dir (sem instalador)
npm run dist         # build + electron-builder (gera instalador NSIS/DMG/AppImage)
npm run typecheck    # tsc --noEmit
```

**HMR**: renderer só. Preload e main mudanças → restart app inteiro.

**Vite config gotchas**:
- preload `manualChunks: () => null` (sandbox)
- preload `treeshake.moduleSideEffects: true` (senão Rollup remove `exposeInMainWorld`)
- renderer `manualChunks` separa monaco/prism/react-dom/xterm/etc em chunks paralelos pro load mais rápido

**Build issues conhecidos**:
- Native modules (`node-pty`) precisam rebuild pra Electron via `electron-rebuild`. Geralmente postinstall faz.
- Sharp + png-to-ico (devDependencies) são apenas pro `build/icons/generate-icons.js` (gera ico/png do svg do logo)

---

## Storage local

```
~/.claude/                              # storage do Claude CLI
├── projects/<encoded-cwd>/             # sessions por workspace
│   └── <session-id>.jsonl              # cada linha = 1 event
├── plugins/
│   ├── known_marketplaces.json         # registry de marketplaces
│   └── cache/<marketplace>/<plugin>/<version>/
├── skills/<name>/SKILL.md              # skills user-level
├── commands/<name>.md                  # slash commands user-level
├── agents/<name>.md                    # subagents user-level
└── settings.json                       # config CLI

<workspace>/.claude/                    # workspace-level customizations
├── skills/, commands/, agents/, hooks  # mesma estrutura
└── settings.json                       # config workspace-only
```

UNDRCOD lê tudo isso via `customization-manager.ts` + `claude-sessions.ts`.

---

## Gotchas

### Encoding de cwd → pasta do Claude
```js
cwd.replace(/[^a-zA-Z0-9-]/g, '-')
```
**Não é só `[\\/:]`** — Claude CLI substitui QUALQUER não-alfanumérico (espaços, acentos, etc) por `-`. Bug histórico: antes era `[\\/:]` só → workspaces com espaços (`claude code ds`) ou acentos (`Estático`) não eram encontrados → histórico aparecia vazio.

### Preload + sandbox + manualChunks
Sem `manualChunks: () => null` no preload, `window.undrcodAPI` fica undefined em produção. Detalhe documentado no `electron.vite.config.ts`.

### `marked.parse()` durante streaming
É O(N²) por delta no texto acumulado. Antes era bypassed (texto cru durante streaming → bold só aparecia depois). Agora `lightMarkdown()` regex inline cobre bold/italic/code/strike em tempo real, marked.parse só roda quando streaming termina.

### Native scrollbar vs overlay
CSS global tem `*::-webkit-scrollbar { height: 10px !important }`. Pra ter scrollbar fina/custom num componente específico precisa de override com especificidade alta (`.parent .child::-webkit-scrollbar { ... !important }`).

### Session-id conflicts
`claude` CLI rejeita spawn duplicado com mesmo session-id ("already in use"). Mitigação em `agent-manager.ts`: `sessionExistsInCli()` varre TODOS subdirs de `~/.claude/projects/` (não confia no cwd) + atomic guard (`spawningSessions` Set) entre `has` check e `set`.

### Permission MCP server
Permissions do agente vêm via MCP server local (`permission-mcp-server.ts`). UNDRCOD spawnа esse server e o `claude` CLI consulta ele em vez de prompt CLI default. Bridge: server emite IPC pro renderer, user responde via `PermissionCard`, IPC volta pro server, server responde pro CLI.

---

## Memória persistente (Rafael)

User tem memória global em `~/.claude/projects/.../MEMORY.md` (não no UNDRCOD). Inclui:
- Estilo de escrita (lowercase pt-BR, sem pontuação)
- Preferências (UNDRCOD all-caps, Cursor first check pattern, Pixel Audit protocol)
- Workspaces dele (Akai móveis, design system, etc)
- Quirks de PowerShell 5.1 que travam scripts

Quando dúvida sobre tom/estilo: lowercase, direto, sem floreio. Quando ele pede pra copiar Cursor: bundle em `C:\Users\taked\AppData\Local\Programs\cursor\resources\app\out\main.js`, copia literal.

---

## Quick start pra agentes novos

1. Ler este arquivo completo (já fez)
2. `App.tsx` pra entender layout + menus
3. `src/main/agent-manager.ts` pra entender como o CLI é spawned
4. `src/renderer/components/ChatView/ChatView.tsx` (lê só primeiras ~500 linhas; arquivo é gigante)
5. Antes de implementar feature nova: **abrir bundle do Cursor** e ver se eles têm pattern equivalente
6. Toda mudança no renderer → `npm run typecheck` antes de declarar done
