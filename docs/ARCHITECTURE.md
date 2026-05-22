# Arquitetura

## Visão geral (high-level)

```
┌─────────────────────────────────────────────────────────┐
│                  Akai Code (Electron)                    │
├──────────────────────────────────────────────────────────┤
│ Main Process (Node.js, full system access)               │
│   ├─ Window manager                                       │
│   ├─ File system access (lê/escreve workspace)            │
│   ├─ PTY manager (spawna processos `claude`)              │
│   └─ IPC handlers (responde renderer requests)            │
├──────────────────────────────────────────────────────────┤
│ Preload (security bridge, contextIsolation=true)         │
│   └─ Expõe API segura via contextBridge                  │
├──────────────────────────────────────────────────────────┤
│ Renderer (Chromium, React UI, sandboxed)                 │
│   ├─ App Layout (3 painéis configuráveis)                │
│   ├─ File Tree (drag source HTML5)                       │
│   ├─ Terminal (xterm.js, conectado a PTY via IPC)        │
│   ├─ Editor (Monaco, opcional)                           │
│   └─ Settings/UI state                                    │
└──────────────────────────────────────────────────────────┘
```

## Layout da UI (wireframe)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ✶ Akai Code   [arquivo] [editar] [view]                  Rafael ▼  ─ □ ✕│
├────────────┬───────────────────────────────┬────────────────────────────┤
│            │                               │                            │
│  📁 FILES  │   📝 EDITOR (Monaco)          │   💬 CHAT CLAUDE           │
│            │                               │   (terminal xterm.js       │
│  ▼ akai    │   colchao_idea.html (mod)     │    rodando `claude`)       │
│   ▶ design │   <html>                      │                            │
│   ▶ posts  │     <head>...                 │   > Como vou rodar         │
│   ▶ assets │     <body>                    │     o projeto?             │
│            │       <div class="card">      │                            │
│  📄 brief  │         ...                   │   Claude: Pra rodar...     │
│  📄 specs  │   </html>                     │                            │
│            │                               │   ┌──────────────────────┐│
│  [+ tab]   │                               │   │ Digite ou arraste... ││
│  [+ pasta] │                               │   └──────────────────────┘│
│            │                               │                            │
│            │                               │   ⓘ Sessão: site-akai      │
│            │                               │   Tokens: 3.2k / Max 200k  │
└────────────┴───────────────────────────────┴────────────────────────────┘
```

**Pontos chave:**
- 3 painéis, redimensionáveis (resize gutters arrastáveis)
- Painel esquerdo (File Tree) **sempre visível**
- Painel central (Editor) opcional — pode esconder
- Painel direito (Chat) **sempre visível** — é a estrela do show
- Drag de arquivo/pasta da esquerda → drop no Chat = vira `@path/` automático

## Fluxo de dados

### 1. App boot
```
Electron main process inicia
  ↓
Cria BrowserWindow (com preload)
  ↓
Renderer carrega React app
  ↓
React mount: <App />
  ↓
useEffect inicial: pede ao main process pra abrir último workspace
  ↓
File Tree popula com children de workspace.path
```

### 2. Spawn de sessão Claude
```
User clica "Nova sessão" ou app abre com sessão default
  ↓
Renderer: window.akaiAPI.spawnClaude({ cwd, sessionId })
  ↓
Preload: ipcRenderer.invoke('claude:spawn', ...)
  ↓
Main: criar node-pty processo rodando `claude` na cwd
  ↓
Main retorna ptyId
  ↓
Renderer: xterm.js attach via IPC streaming
  ↓
PTY output → IPC → Renderer → xterm.write()
  ↓
User digita no xterm → onData → IPC → PTY stdin
```

### 3. Drag-drop de pasta pro chat
```
User arrasta pasta no File Tree (HTML5 dragstart)
  ↓
Pasta tem data-path attribute
  ↓
User solta no Chat (xterm container ondrop)
  ↓
Calculamos path relativo ao workspace
  ↓
Formatamos: "@src/components/"
  ↓
Escrevemos no PTY stdin como se fosse digitação
  ↓
Aparece no input do `claude`
```

### 4. Comando "Send to Claude" (botão)
```
User seleciona pasta + clica botão ✶
  ↓
Renderer: pega path + sessão ativa
  ↓
Mesmo fluxo de drag-drop a partir do "Formatamos"
```

## Módulos do código

### `src/main/`
- `index.ts` — Electron app lifecycle, BrowserWindow creation
- `ipc/claude.ts` — handlers pra spawn/write/read/kill de processos `claude`
- `ipc/fs.ts` — handlers pra ler workspace tree, abrir arquivos
- `ipc/settings.ts` — handlers pra salvar/carregar settings (electron-store)
- `pty-manager.ts` — abstração sobre node-pty (gerencia múltiplas sessões)

### `src/preload/`
- `index.ts` — `contextBridge.exposeInMainWorld('akaiAPI', { ... })`

### `src/renderer/`
- `App.tsx` — root component, layout dos 3 painéis
- `components/FileTree/` — file tree com drag, expand, hover ações
- `components/Terminal/` — wrapper de xterm.js conectado via IPC
- `components/Editor/` — wrapper de Monaco
- `components/Layout/` — split panes resizable
- `state/` — hooks de estado compartilhado (sessions, workspace, settings)
- `styles/` — Tailwind ou CSS modules

### `src/shared/`
- `types.ts` — interfaces compartilhadas main/renderer (PTY, FsNode, Session, etc.)
- `constants.ts`

## Segurança (Electron best practices)

- `contextIsolation: true` — renderer não acessa node directly
- `nodeIntegration: false` — Node only no main process
- `sandbox: true` — renderer roda em sandbox Chromium
- Preload expõe **apenas API específica** via contextBridge
- IPC valida inputs (paths, IDs) antes de operar
- File ops checam que path tá dentro do workspace permitido

## Performance

### Virtualização do terminal output
xterm.js já faz isso por padrão — só renderiza viewport visível. Mantém histórico em memória mas não no DOM.

### Lazy loading de painéis
Monaco pesa ~5MB carregado. Lazy import via `React.lazy(() => import('./Editor'))`.

### IPC streaming, não polling
PTY output flui via IPC events (push), não renderer polling main. Latência sub-50ms típica.

### Workspace tree caching
File tree carregado uma vez no boot, atualizado via `chokidar` watching. Não re-lê sistema a cada render.
