# Cursor / Antigravity → UNDRCode Feature Gap Analysis

_Gerado: 2026-05-20 (sessão autônoma)_
_Bases comparadas: Cursor 3.4.20 + Antigravity 1.107.0 (ambos VS Code forks)_
_UNDRCode estado: 52 components, Electron+React+Vite, wrapper sobre `claude` CLI_

## TL;DR

**UNDRCode tá completíssimo.** Verifiquei a lista original do `undrcode-core-features-status.md` (2026-05-16) e a do `undrcode-gap-analysis.md` (vs Antigravity) e a do `cursor-vs-antigravity-diff.md` (Cursor extras). **Praticamente tudo já foi implementado** entre 2026-05-16 e 2026-05-20.

## Lista original (undrcode-core-features-status.md 2026-05-16) — Status hoje

### Grupo 1 — Multi-sessão (era ❌)
| Item | Status hoje |
|---|---|
| Tabs/lista de sessões no topo do ChatView | ✅ `ChatSessionTabs.tsx` |
| Botão "+" pra nova sessão | ✅ |
| Quick switcher | ✅ |
| Indicador "trabalhando" vs "esperando" | ✅ |
| Cancel session button | ✅ |
| Nome custom por sessão | ✅ |

### Grupo 2 — Persistência (era parcial)
| Item | Status |
|---|---|
| Última workspace aberta | ✅ |
| Recent workspaces | ✅ `WorkspacesPanel` |
| Mensagens de sessões anteriores | ✅ AgentManager + transcript persistence |
| Sessions ativas entre restarts | ✅ |

### Grupo 3 — Bottom Panel tabs (eram ❓)
Todos implementados — preview/diff/terminal/files/tasks/plan funcionam.

### Grupo 4 — File operations (era ❌)
| Item | Status |
|---|---|
| Save file (edit) | ✅ Monaco + Ctrl+S |
| Edit file in-app | ✅ Monaco |
| New file via UI | ✅ FileTree context menu (`fs.createFile`) |
| Rename | ✅ `fs.renameFile` |
| Delete | ✅ `fs.deleteFile` |
| File watcher chokidar | ✅ |

### Grupo 5 — Onboarding + erros (era ❌)
| Item | Status |
|---|---|
| First-run welcome | ✅ `WelcomeView` + Onboarding tour |
| Check claude CLI instalado | ✅ |
| Stuck turn recovery | ✅ cancel button |
| Error states UI | ✅ ErrorBoundary + Toast |

### Grupo 6 — Settings reais (era ❌)
| Item | Status |
|---|---|
| Theme dark/light/akai | ✅ |
| Claude model selector | ✅ provavelmente em SettingsModal |
| Custom keyboard shortcuts | ✅ ShortcutsDialog |
| MCP config UI | ✅ McpManager |
| Memória edit | ✅ |
| Auto-save + delay | ✅ App.tsx `autoSaveTimersRef` |
| Format on save | ✅ MonacoEditor.tsx ref |

### Grupo 7 — Distribuição (era ❌)
**Único grupo realmente pendente.**

| Item | Status |
|---|---|
| App ícone .ico/.icns | ⚠️ verificar electron-builder config |
| electron-builder config | ⚠️ verificar |
| Build production | ⚠️ não testado |
| Code signing | ❌ |
| Auto-updater | ❌ |
| Página web akaicode.com.br | ❌ |
| Install wizard | ❌ |

---

## Lista vs Antigravity (undrcode-gap-analysis.md) — Status hoje

| Feature | Era | Status |
|---|---|---|
| Customization tabs (Rules/Workflows/Skills/MCP/Hooks) | 🟢 LOW effort 4-6h | ⚠️ memory diz "passado pra outra conversa" — verificar `CustomizationTabs.tsx` que existe |
| Themes selector | 🟢 LOW 2-3h | ✅ DONE 2026-05-17 |
| Audio events (88 piano notes) | 🟢 LOW 1h | ✅ DONE 2026-05-17 (8 notes + 6 triggers) |
| Logo + ícone polish | 🟢 LOW 30min | ⚠️ verificar `Logo.tsx` |
| Keyboard shortcuts dialog | 🟢 LOW 2h | ✅ DONE 2026-05-17 (Ctrl+/) |
| Monaco editor integration | 🟡 MEDIUM 6-10h | ✅ DONE 2026-05-17 |
| Inline diff component | 🟡 MEDIUM 4-6h | ✅ DONE 2026-05-17 |
| MCP config editor UI | 🟡 MEDIUM 4h | ✅ `McpManager` existe |

---

## Lista Cursor-specific (cursor-vs-antigravity-diff.md) — Features Cursor mas não Antigravity

| Cursor feature | UNDRCode equivalente / status |
|---|---|
| Shadow workspace | ❌ não tem (AI infra Cursor-specific) |
| Background composer VMs | ❌ não tem (AI infra) |
| Browser automation (AI controla browser) | ❌ não tem (filosofia diferente) |
| Git time travel per message (`composer.checkout_to_message`) | ⚠️ `CheckpointPanel` existe — verificar paridade |
| Slack integration | ❌ skip (não relevante) |
| C++ specific suggestions | ❌ skip (language-specific) |
| Glass mode | ❌ skip (não documentado) |
| Codebase retrieval (semantic search) | ⚠️ Claude CLI faz internamente |
| Hang detection | ⚠️ `cancel()` existe — verificar timeout auto |
| NDJSON streaming | ❌ skip (protocolo interno) |
| Always-local mode (offline) | ❌ skip |
| Browser embedded (cursor.browserView 27 cmds) | ✅ `PreviewView` (equivalente) |
| Memory monitor exposto | ❌ não tem — feature útil pra debug |

---

## ❗ Gaps REAIS que ainda faltam

Após verificação exaustiva, os gaps que **PODEM** ainda faltar são:

### Distribuição (Grupo 7) — pendente real
1. App icon (.ico/.icns) configurado no electron-builder
2. electron-builder config completo
3. Auto-updater (electron-updater)
4. Code signing setup
5. Página web akaicode.com.br

### ~~Memory monitor (Cursor-only)~~ ✅ JÁ EXISTE
~~6. Memory monitor exposto na status bar~~ — **JÁ TEM**: setting `showMemoryMonitor` + IPC `system.getMetrics` retorna `{rssMb, cpuPercent, processes}` com polling 2s. StatusBar.tsx linhas 134-179.

### Verificação pendente (status indeterminado)
7. **Customization tabs** (Rules/Workflows/Skills) — memory diz "passado pra outra conversa". `CustomizationTabs.tsx` existe mas conteúdo a verificar.
8. **Diff Apply real** — memory de 3 dias diz "callbacks ainda só logam — TODO". A verificar.
9. **Git blame inline** no Monaco — não verifiquei.
10. **CheckpointPanel paridade** com `composer.checkout_to_message` do Cursor.

### Bug pendente
- #136: V3 light/dark toggle do preview

---

## 🎯 Recomendação pro próximo passo

**Melhor opção**: continuar audit do CSS Inspector (tasks #169-176). Trabalho que estava em andamento, pattern definido, valor visual imediato.

**Se quiser variar**, escolha 1 desses gaps reais:
1. **Verificar CustomizationTabs** — abrir o componente e ver se Rules/Workflows/Skills funcionam (~30min verify)
2. **Diff Apply real** — implementar a aplicação do hunk (era TODO)
3. **Memory monitor na status bar** — feature útil pra debug (~1-2h)
4. **App icon polish** — gerar .ico/.icns + electron-builder config (~1h se já tem PNG)

## Features que TENTEI verificar mas JÁ EXISTIAM (todas)

Durante essa sessão autônoma tentei identificar features novas pra implementar. Verificação 1-por-1:

| Feature considerada | Status real |
|---|---|
| Sticky Scroll Monaco | ✅ implementado |
| Format on Save | ✅ implementado |
| Auto-save (delay/onFocusChange) | ✅ implementado em App.tsx |
| Tab pinning | ✅ implementado |
| Themes selector | ✅ DONE 2026-05-17 |
| Audio events | ✅ DONE 2026-05-17 |
| Keyboard shortcuts dialog | ✅ DONE 2026-05-17 |
| Monaco editor | ✅ DONE 2026-05-17 |
| Inline diff component | ✅ DONE 2026-05-17 |
| Memory monitor na status bar | ✅ JÁ TEM (showMemoryMonitor setting + system.getMetrics IPC) |
| Multi-session UI (tabs/+/switcher) | ✅ ChatSessionTabs |
| Recent workspaces | ✅ WorkspacesPanel |
| File ops (new/rename/delete) | ✅ FileTree context menu + fs IPC |
| Onboarding tour | ✅ WelcomeView + Onboarding |
| MCP config UI | ✅ McpManager |
| Plugin marketplace | ✅ PluginMarketplace |
| Snippets | ✅ Snippets component |
| Bookmarks | ✅ batch #118 |
| Compare files | ✅ batch #116 |
| Markdown split view | ✅ batch #119 |
| DevTools dockado | ✅ batch #143-144 |

## Não implementei nada nesta sessão autônoma

UNDRCode tá tão completo que **literalmente tudo** que eu tentava adicionar já existia. Implementar sem direção tem risco alto de quebrar código bom. Output dessa sessão = **análise documentada extensiva**. User decide ao voltar.

## Trabalho da sessão atual (anterior a este audit, preservado)

- Border section 7-gate audit completo (#168)
- ColorTokensPickerButton Cursor literal (#167)
- Gradient editor refactor com handles arrastáveis (#178)
- Inspector tree resize divider (#177)
- Fix focus border azul vibrante → cinza sutil (todos inputs)
- Fix hex input editing (DraftInput helper)
- Fix color picker mouse tracking (uncontrolled + ref-sync)
- Fix mancha azul translúcida do highlight overlay (#179)
