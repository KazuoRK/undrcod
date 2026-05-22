# Roadmap

Fases incrementais. Cada fase entrega valor sozinha. Nunca entrega 100% antes de começar a próxima.

## Fase 0 — Foundation (esta noite + amanhã)

**Objetivo:** projeto compila, abre janela vazia, doc claro.

- [x] Estrutura de pastas
- [x] DECISIONS.md, ARCHITECTURE.md, ROADMAP.md
- [ ] `package.json` com deps + scripts
- [ ] `tsconfig.json`, `vite.config.ts`, `electron.vite.config.ts`
- [ ] Main process boilerplate (cria janela vazia)
- [ ] Preload script vazio (com contextBridge stub)
- [ ] Renderer com React + "Hello Akai Code"
- [ ] Script `npm run dev` funcional
- [ ] `.gitignore`

**Entregável:** `npm install && npm run dev` abre janela Electron com "Hello".

---

## Fase 1 — Terminal embed funcional (próxima sessão)

**Objetivo:** clicar "nova sessão" e ver Claude rodando dentro do app.

- [ ] Instalar `node-pty` + `xterm` + `@xterm/addon-fit`
- [ ] PtyManager (main): spawn/kill/write
- [ ] IPC channels: `claude:spawn`, `claude:write`, `claude:data`, `claude:exit`
- [ ] Terminal component (renderer): xterm.js attach IPC
- [ ] Botão "Nova sessão" no UI
- [ ] Sessão default rodando no `cwd` do workspace

**Entregável:** abrir app → click "Nova sessão" → `claude` rodando, posso conversar.

---

## Fase 2 — File Tree esquerdo

- [ ] Componente FileTree com expand/collapse
- [ ] Lê workspace via IPC `fs:list`
- [ ] Watcher (chokidar) pra refresh automático
- [ ] Estilo Akai (champagne/dark)
- [ ] Botão "abrir pasta" no header

**Entregável:** tree à esquerda, click expande pastas, atualiza quando arquivos mudam.

---

## Fase 3 — Drag-drop pasta → terminal

**Objetivo:** o pedido original do Rafael.

- [ ] FileTree items com `draggable=true` + `dragstart` setando path
- [ ] Terminal container com `ondrop` capturando drop
- [ ] Formatador: path absoluto → `@relative/` ao workspace
- [ ] Escrever no PTY como se fosse digitação
- [ ] Visual feedback durante drag (cursor, highlight)

**Entregável:** arrasta pasta da esquerda → solta no chat → vira `@path/` no input.

---

## Fase 4 — Editor Monaco (opcional)

- [ ] Painel central com Monaco
- [ ] Tabs de arquivos abertos
- [ ] Click em arquivo no FileTree → abre na Monaco
- [ ] Save (Ctrl+S) → escreve no FS via IPC
- [ ] Sync com FS watcher (se mudou externamente, recarrega)

**Entregável:** posso editar arquivos sem sair do app.

---

## Fase 5 — Multi-sessão visual

**Objetivo:** o diferencial competitivo principal.

- [ ] Tabs de sessões no topo do painel direito
- [ ] Botão "+" cria nova sessão (mesmo workspace ou outro)
- [ ] Cada sessão = PTY próprio
- [ ] Quick switcher (Ctrl+1, Ctrl+2, etc.)
- [ ] Indicador visual de "trabalhando" vs "esperando input"

**Entregável:** rodar 3 sessões paralelas, switchar entre elas.

---

## Fase 6 — Polish + branding Akai

- [ ] Paleta Akai (champagne #C9A961, dark earth #1c130e)
- [ ] Logo + ícone do app
- [ ] Splash screen
- [ ] Settings UI (font size, theme, workspace default)
- [ ] Keyboard shortcuts customizáveis
- [ ] Tooltips em PT-BR

**Entregável:** parece produto, não protótipo.

---

## Fase 7 — Distribuição

- [ ] Build com electron-builder (Windows .exe, depois Mac/Linux)
- [ ] Code signing (chato mas necessário pra evitar SmartScreen)
- [ ] Auto-updater
- [ ] Página web simples akaicode.com.br

**Entregável:** instalador .exe que qualquer pessoa baixa e roda.

---

## Backlog (depois do v1)

- Kanban de sessões (diferencial competitivo)
- Mobile companion (web responsivo pra ver sessões remoto)
- Templates de prompts (Akai-specific: criar arte, gerar copy, etc.)
- Histórico searchable
- Export de sessão (markdown)
- Integração Affinity Designer (mesma sessão Claude operando ambos)
- Plugin marketplace próprio
- White-label pra outras marcas
- Telemetry opt-in
