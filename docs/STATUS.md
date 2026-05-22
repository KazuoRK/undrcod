# Status / Handoff

Estado atual do projeto, atualizado a cada sessão.

---

## Última sessão: 2026-05-16 (madrugada)

**Quem fez:** Claude (mock dev senior)
**Tempo gasto total:** ~1h30 (Fase 0 + Fase 1 + Fase 2)

### O que foi feito

**Fase 0 — Foundation (✅ COMPLETA — confirmada visualmente)**

- Estrutura + docs + Electron + Vite + React + TS
- Splash screen abre com `npm run dev`

**Fase 1 — Terminal embed (✅ COMPLETA — confirmada visualmente)**

- `pty-manager.ts` gerenciando processos `claude` via node-pty
- IPC `claude:spawn/write/resize/kill` + eventos `claude:data/exit`
- `Terminal.tsx` (xterm.js) embedded
- Topbar com logo + cwd + status badge
- **Print do Rafael:** Claude v2.1.143 rodando no app, autenticado como Claude Max ✓

**Fase 2 — FileTree + Drag-drop (✅ COMPLETA — confirmada visualmente + drag-drop testado)**

- `src/main/ipc/fs.ts` — `fs:listDir`, `readFile`, `writeFile`, `stat`, `dialog:openWorkspace`
- `src/renderer/components/FileTree/FileTree.tsx` — tree com expand/collapse
  - Hidden files filtrados (exceto `.vscode`, `.github`, `.claude`)
  - `node_modules` sempre escondido
  - Pastas primeiro na ordenação
  - Drag source HTML5 (`draggable=true` + `dataTransfer`)
- `src/renderer/components/Layout/SplitPane.tsx` — divider redimensionável horizontal
  - Min 200px left / 500px right
  - Trigger window resize ao soltar divider (pra Terminal refit)
- **Drag-drop no Terminal:**
  - Aceita drops com `application/x-akai-path`
  - Formata path como `@relative/` (pasta com /, arquivo sem)
  - Escreve no PTY como se fosse digitação
  - Overlay visual durante drag-over
- `App.tsx` refeito com layout SplitPane: FileTree esquerda + Terminal direita
- Botão "trocar pasta" no topbar abre dialog OpenDirectory

### Como testar (Fase 2)

```powershell
cd C:\Users\taked\Desktop\akai-code
npm run dev
```

Esperado:
1. Janela abre com **2 painéis**: FileTree (esquerda) + Terminal (direita)
2. FileTree mostra arquivos do `$HOME` (default)
3. Click no path no topbar → dialog "Open Directory" pra trocar workspace
4. Click em pasta no tree → expande/colapsa
5. **Arrasta pasta do tree pro terminal** → overlay laranja aparece → solta → `@pasta/` aparece no input do `claude`

### Erros possíveis

- Se app não atualizar com hot reload, `Ctrl+R` na janela do app (ou fecha + `npm run dev` de novo)
- FileTree vazio → cwd pode ser inválido. Tenta trocar workspace via topbar.

### Decisões pendentes

- [ ] Salvar último workspace usado (electron-store) — abre na mesma pasta
- [ ] Memorizar largura do SplitPane
- [ ] Ícone do app (.ico)
- [ ] Multi-arquivo drag-drop (atual = 1 por drop)

### Plano da próxima sessão (Fase 3)

**Objetivo:** persistência + polish

1. `electron-store` pra salvar:
   - Último workspace
   - Largura SplitPane
   - Tamanho/posição da janela
2. Auto-load do último workspace no boot
3. Multi-sessão: tabs no terminal pra rodar 2-3 sessões paralelas
4. (opcional) Editor Monaco no centro: click em arquivo no tree abre

### Arquivos da sessão atual

**Adicionados:**
- `src/main/ipc/fs.ts`
- `src/renderer/components/FileTree/FileTree.tsx` + `.css`
- `src/renderer/components/Layout/SplitPane.tsx` + `.css`

**Modificados:**
- `src/main/index.ts` (registra FS IPC)
- `src/preload/index.ts` (API fs + dialog)
- `src/renderer/App.tsx` (SplitPane layout)
- `src/renderer/components/Terminal/Terminal.tsx` (drag-drop handlers)
- `src/renderer/components/Terminal/Terminal.css` (drop overlay)
- `src/renderer/styles/global.css` (cwd button)
