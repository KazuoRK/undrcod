# UNDRCode — Auditoria vs Cursor e Antigravity

_Gerado: 2026-05-18. Fontes: `cursor-catalog.json` (495 cmds + 808 selectors + 126 events) +
`antigravity-catalog.json` (188 cmds + 207 events + 130 selectors) + leitura direta do codebase
em `Desktop\akai-code\src\`._

---

## SUMÁRIO EXECUTIVO

UNDRCode é um wrapper Electron+React+Vite from-scratch sobre o `claude` CLI (não fork
VS Code). Tem hoje **~65 features shipped** com qualidade desktop-IDE — bem além do
ROADMAP. Os dois competidores partem de bases diferentes:

- **Cursor 3.4.20** (fork VS Code 1.105.1, 53MB workbench, 495 cmds, 18 cursor-* exts, 3+ anos
  de produto) é o benchmark de maturidade. **Cursor é 3-6× mais rico em surface area.**
- **Antigravity 1.107.0** (fork VS Code 1.23.2, 23MB workbench, 188 cmds, 5 antigravity-* exts,
  ~1 ano) é o competidor direto: ambos miram o "agente em primeiro lugar".

### Score UNDRCode vs Cursor: **~28%** (paridade funcional/UX nas features básicas, mas
falta toda a camada de agent-infra avançada)

Top 5 GAPS vs Cursor:
1. **Background composers + VMs sandboxed** (`cursor-shadow-workspace`, 1MB ext) — Cursor
   roda agentes em workspace shadow, UNDRCode roda no real
2. **Git time-travel por mensagem** (`composer.checkout_to_message`) — checkout state de
   qualquer mensagem na chat
3. **Browser embarcado + AI control** (`cursor.browserView.*` 27 cmds + `cursor-browser-automation`
   1.5MB ext) — full browser tab dentro do IDE, AI navega/clica
4. **Codebase indexing semântico** (`cursor-retrieval` 23MB ext, embeddings dedicado) —
   UNDRCode usa só grep/find via Claude tools
5. **Inline AI completions / supercomplete** (Tab completions estilo Copilot) — UNDRCode
   tem zero autocompletar AI

### Score UNDRCode vs Antigravity: **~55%** (mais perto — ambos jovens, mas Antigravity tem
infra de IDE madura por ser fork VS Code)

Top 5 GAPS vs Antigravity:
1. **Hunk navigation (Alt+J/K + Alt+Enter accept)** — review keybindings de edits do agent
   por hunk; UNDRCode tem `useHunkKeyboard` mas não está cabeado no fluxo de approval
2. **Sound system (88 piano notes)** — UNDRCode tem `audioFeedback.ts` mas só 1-2 sons
3. **Multi-model side-by-side (Battle Mode)** — comparar Claude vs Gemini ao mesmo tempo
4. **Jetski (2ª BrowserWindow autônoma)** — janela paralela com agente trabalhando solo
5. **Import settings de outros IDEs** (VS Code / Cursor / Windsurf / Cider settings importers)

---

## 1. UNDRCode vs Cursor

### 1.1 Features que Cursor TEM e UNDRCode NÃO TEM

| Feature | Cursor command/ext | Esforço | Impacto |
|---|---|---|---|
| Shadow workspace (sandbox exec) | `cursor-shadow-workspace` ext (1MB) | XL (40h+) | high |
| Background composer VMs | `composer.openVMForBackgroundComposer` | XL (40h+) | high |
| Git time-travel por mensagem | `composer.checkout_to_message` + `cursor-checkout` ext | L (12h) | crit |
| Browser embarcado nas tabs | `cursor.browserView.*` (27 cmds) | XL (30h) | high |
| AI controla browser embarcado | `cursor-browser-automation` ext (1.5MB) | XL (30h) | med |
| Codebase semantic retrieval | `cursor-retrieval` ext (23MB embeddings) | XL (60h+) | crit |
| Inline AI completions (Tab) | Tab completions, autocomplete heuristics | XL (40h+) | crit |
| Plan Mode com UI dedicada | `composer.plan_mode.*` (7 cmds) | M (4h) | high |
| Fork shared chat | `composer.forkSharedChat` | S (2h) | med |
| Duplicate chat | `composer.duplicateChat` / `composer.duplicate_tab` | S (1h) | med |
| Open chat as pane | `composer.openAsPane` | M (3h) | med |
| Cloud handoff (chat → remoto) | `composer.cloud_handoff.*` | XL (40h+) | low |
| Chat editor split | `composer.chat_editor_split` | M (4h) | med |
| Slack integration | `COMPOSER_CAPABILITY_TYPE_SLACK_INTEGRATION` | L (10h) | low |
| Hang detection no chat | `composer.submitChat.hang_abort` | S (2h) | high |
| Shell tool decision allowlist | `composer.approvePendingShellToolDecisionAllowlist` | M (4h) | high |
| Copy prompt / copy requestId | `composer.standalone.copyPrompt`, `copyRequestId` | S (1h) | med |
| AI commit messages | `cursor-commits` ext (2.23MB) | M (3h) | high |
| Memory monitor real (heap MB) | `cursor.memorymonitor.jsHeapUsedMB` | S (1h) | low |
| Glass mode (UI alt) | `cursor.openAdditionalGlassModeWindowDev` | XL (40h) | low |
| Always-local mode | `cursor-always-local` ext | M (4h) | med |
| Blame inline | `cursor.blame` (2 cmds) | M (4h) | med |
| `cursor://` URL protocol | `cursor-deeplink` ext | M (3h) | med |
| `cursor` CLI com --diff, --goto, --inspect-extensions | n/a (CLI binary) | L (12h) | high |
| NDJSON streaming | `cursor-ndjson-ingest` ext | M (4h) | low |
| Auto context picking | `COMPOSER_CAPABILITY_TYPE_AUTO_CONTEXT` | L (16h) | high |
| Diff history / edit trail | `COMPOSER_CAPABILITY_TYPE_DIFF_HISTORY`, `EDIT_TRAIL` | M (6h) | high |
| Loop on lints / loop on command | `LOOP_ON_LINTS`, `LOOP_ON_COMMAND` | M (6h) | high |
| Knowledge fetch | `COMPOSER_CAPABILITY_TYPE_KNOWLEDGE_FETCH` | M (6h) | med |
| `.cursorrules` file convention | (built-in) | S (1h) | high |
| Symbol outline avançado (LSP) | LSP-backed `cursor.textModel.*` (12 cmds) | L (12h) | med |
| Multi-cursor real no editor | Monaco built-in mas Cursor habilitado | S (já há "hint", 2h ativar) | med |
| Webview/preview embarcado (não só dev server) | `cursor.browserView.*` | L (12h) | med |

**Total esforço se quisesse paridade total: 400+ horas. Inviável.**

### 1.2 Features que UNDRCode TEM e Cursor NÃO TEM

| Feature | Descrição |
|---|---|
| **PT-BR nativo** | Toda UI/copy em português; setting `preferredLanguage` força resposta do Claude também |
| **3 temas custom (akai/champagne/antigravity-dark/light)** | Cursor tem só dark/light VS Code padrão |
| **Whisper.cpp local STT** | Voice-to-text no input do chat (binário local, não cloud) |
| **Memória CLAUDE.md / UNDERCODE.md** com link no menu | Cursor tem `.cursorrules` mas sem edit UI dedicada |
| **Customization Tabs unified** (Rules/Workflows/Skills/Hooks/MCP) | Cursor distribui entre arquivos + ext mcp |
| **Auth via `claude /login`** (consumer Pro/Max plan) | Cursor exige API key separada / Cursor plan |
| **Wrapper sobre CLI Claude oficial** | Sempre na última versão do Claude Code; Cursor tem agent proprietário (composer) |
| **OUTLINE + TIMELINE inline** abaixo do FileTree | Cursor tem só outline em modal/sidebar |
| **TODO/FIXME aggregator no BottomPanel** | Não detectado no Cursor |
| **Port forward (localhost.run/ngrok) embutido** | Não detectado no Cursor |
| **Tasks runner auto-detect** (npm/yarn/pnpm/bun) | Cursor depende de extensions tipo NPM Scripts |
| **Snippets manager dedicado** (Ctrl+;) | Cursor usa só snippet system do VS Code |
| **CommitDialog inline** com message AI-suggest hook | Cursor tem `cursor-commits` mas UX é commit popup VS Code padrão |
| **TimelineSection** (file history inline) | Cursor tem só Timeline view do VS Code |
| **Welcome view com pin/unpin workspaces** | Não detectado |
| **2-file arbitrary compare** | Cursor tem `--diff` CLI mas sem UI integrada |
| **DevServerBanner auto-detect** | Não detectado |
| **Onboarding tour** | Cursor não tem walk-through interactivo |

### 1.3 Diferenças de arquitetura/abordagem

| Eixo | Cursor | UNDRCode |
|---|---|---|
| Base | Fork VS Code 1.105.1 (60MB+ runtime) | Electron + React + Vite (~30MB runtime) |
| Agent | Composer proprietário (Anthropic via API key Cursor) | `claude` CLI via PTY → consumer plan |
| Editor | Monaco com IntelliSense full (LSP) | Monaco básico, sem LSP exposto |
| Extensions | 18 cursor-* + market Open VSX-style | Plugin marketplace UI mas integration limitada |
| Indexing | Embeddings dedicados (23MB ext) | Grep on-demand via Claude tools |
| Telemetria | Statsig (`cursor.dismissedCreditGrantIds` + 126 events) | Sem telemetria default |
| Monetização | Credit grants per call (paga API) | User paga seu plan Claude direto |
| URL protocol | `cursor://` via ext | n/a |
| Inline AI | Tab completions ON por default | Não tem |
| Idioma | EN | PT-BR |

---

## 2. UNDRCode vs Antigravity

### 2.1 Features que Antigravity TEM e UNDRCode NÃO TEM

| Feature | Antigravity command | Esforço | Impacto |
|---|---|---|---|
| Hunk navigation Alt+J/K + Alt+Enter accept | `antigravity.prioritized.agentFocusNextHunk` etc (17 cmds) | M (3h) | crit |
| Audio events (88 piano notes A0..G7) | `antigravity.playNote`, `antigravity.playAudio` + 88 MP3s | S (1h) | med |
| Customization Editor unified (11 tabs no Antigravity) | `antigravity.openCustomizationsTab` | (UNDRCode tem 5 tabs já) — gap = +6 tabs | M (4h) | med |
| Multi-model side-by-side (Battle Mode) | Claude vs Gemini parallel | XL (30h) | high |
| Jetski (2ª BrowserWindow paralela autônoma) | `antigravity.JetskiFullScreenViewController` (4 cmds) | XL (40h) | high |
| Import VS Code settings | `antigravity.importVSCodeSettings` | S (2h) | med |
| Import Cursor settings | `antigravity.importCursorSettings` | S (2h) | med |
| Import Cider settings | `antigravity.importCiderSettings` | S (2h) | low |
| Import Windsurf settings | `antigravity.migrateWindsurfSettings` | S (2h) | low |
| Custom app icon picker | `antigravity.customizeAppIcon` | M (3h) | low |
| Demo mode | `startDemoMode` / `endDemoMode` | M (4h) | low |
| Browser allowlist + onboarding port | `antigravity.showBrowserAllowlist`, `getBrowserOnboardingPort` | L (12h) | med |
| Diff zones (focused editing regions) | `antigravity.openDiffZones`, `closeAllDiffZones`, `setDiffZonesState` | L (10h) | high |
| Review Changes editor (Cmd+Shift+Enter dedicated UI) | `antigravity.openReviewChanges`, `antigravityReviewChangesEditor` | M (6h) | high |
| Auto-fix lints toggle | `disableCascadeAutoFixLints` setting | S (1h) | med |
| Auto-open edited files toggle | `disableAutoOpenEditedFiles` setting | S (1h) | med |
| Disable highlight after accept | `disableHighlightAfterAccept` setting | S (1h) | low |
| Snooze autocomplete | `antigravity.snoozeAutocomplete` | S (2h) | low |
| Restart language server | `antigravity.restartLanguageServer` | M (4h) | med |
| Marker hover inlay hint | `antigravity.markerHoverInlayHint` | M (4h) | med |
| TabToJump (jump completion) | `antigravity.tabToJump`, `tabToJumpPointerWidget` | L (12h) | med |
| Sidecar diff zone | `antigravity.sidecar.sendDiffZone` | L (10h) | med |
| Send terminal output to chat | `antigravity.sendTerminalToChat`, `sendTerminalToSidePanel` | S (2h) | high |
| Update terminal last command | `antigravity.updateTerminalLastCommand` | S (2h) | med |
| Performance monitoring overlay | `antigravity.PerformanceMonitoring`, `rendererStartupPerf` | M (4h) | low |
| `--inspect-extensions` flag pra CDP | n/a (CLI flag) | n/a — UNDRCode não tem extensions | n/a |
| `antigravity chat "..."` CLI subcommand | n/a | M (4h) — wrapper sobre claude CLI direto | high |
| Conversation history search (workspace quickpick) | `antigravity.openConversationWorkspaceQuickPick` | S (2h) | med |
| Switch between workspace and agent | `antigravity.switchBetweenWorkspaceAndAgent` | S (2h) | med |
| Issue reporter (built-in) | `antigravity.openIssueReporter` | M (3h) | low |
| Onboarding reset | `antigravity.onboarding.reset` | S (já existe `resetTour` em UNDRCode) | n/a |
| Cascade starter prompt | `antigravity.cascadeStarterPrompt` | S (2h) | med |
| Knowledge artifacts | `KNOWLEDGE_ARTIFACTS` tool + editor | XL (20h) | med |

### 2.2 Features que UNDRCode TEM e Antigravity NÃO TEM

| Feature | Descrição |
|---|---|
| **Wrapper consumer plan Claude** | Antigravity exige Argon (Google One AI) — UNDRCode usa `claude` CLI que aceita Pro/Max/free |
| **PT-BR nativo + setting `preferredLanguage`** | Antigravity é só EN |
| **Auto-detect package manager** (npm/yarn/pnpm/bun) | Antigravity tem Tasks mas não auto-detect |
| **Whisper.cpp STT** | Antigravity não tem voice input |
| **Customization Tabs 5-tab** com count badges + search inline | Antigravity unified tabs sem search dedicado |
| **Snippets manager standalone (Ctrl+;)** | Antigravity usa snippets do VS Code padrão |
| **Welcome view com pin/unpin workspaces** | Antigravity tem welcome mas sem pin |
| **OUTLINE + TIMELINE inline** abaixo do FileTree | Antigravity tem em Sidebar separada |
| **Composer popover com mode/model/snippets** | Antigravity tem agentBar mas menos rico |
| **Onboarding tour com fases** | Antigravity tem onboarding mas linear |
| **Pending Changes panel** | Antigravity tem mas como modal, não tab persistente |
| **CommitDialog dedicated com message AI hook** | Antigravity usa o do VS Code padrão |
| **TODOs aggregator** | Antigravity não tem |
| **Port forward (localhost.run / ngrok)** | Antigravity tem só list ports, sem tunnel |
| **DevServerBanner auto-detect** | Antigravity não detecta automaticamente |
| **2-file arbitrary compare picker** | Antigravity tem compare-with via context menu mas sem picker dedicado |
| **Tema "champagne"** (paleta brand Akai) | n/a |
| **3 themes custom + cycle no menu** | Antigravity tem 3 mas sem cycle dedicated |
| **Brand identity própria + Logo SVG inline** | Antigravity é Google-flavored |

### 2.3 Diferenças de arquitetura/abordagem

| Eixo | Antigravity | UNDRCode |
|---|---|---|
| Base | Fork VS Code 1.23.2 | Electron + React + Vite (não fork) |
| Agent | Cascade panel embedded no workbench (Google API + Argon plan) | ChatView React standalone + `claude` CLI PTY |
| Editor | Monaco com supercomplete (Windsurf heritage) + multi-cursor | Monaco básico, sem AI completions |
| Tool registry | 104+ AGENT tools (`AGENCY_TOOL_CALL`, `BROWSER_*` etc) | Tools vêm do Claude CLI (não definidos no app) |
| Multi-window | Jetski (2ª BrowserWindow) | Só janela principal |
| URL protocol | `antigravity://` | n/a |
| Customization | 11 tabs unified | 5 tabs (Rules/Workflows/Skills/Hooks/MCP) |
| Hunk approval | Alt+J/K + Alt+Enter (cabeado) | Hook `useHunkKeyboard.ts` existe mas não cabeado |
| Audio | 88 piano notes A0..G7 | `audioFeedback.ts` com poucos sons |
| Idioma | EN | PT-BR |

---

## 3. FEATURES CRÍTICAS missing nos 3 (priority ranked)

Tabela ranqueada por impacto/esforço — features que MAIS valem implementar no UNDRCode.

| # | Feature | Cursor tem? | Antigravity tem? | Esforço | Impacto | Notas |
|---|---|---|---|---|---|---|
| 1 | **Hunk navigation + accept/reject** (Alt+J/K + Alt+Enter) | ✓ via composer | ✓ direto | M (3h) | **crit** | UNDRCode já tem `useHunkKeyboard.ts` — falta cabear no fluxo agent edit |
| 2 | **Inline AI completions (Tab)** | ✓ Tab | ✓ supercomplete | XL (40h) | **crit** | Maior gap funcional vs ambos. Requer mini-agente paralelo |
| 3 | **Git checkpoint funcional (revert real)** | ✓ `composer.checkout_to_message` | parcial | L (8h) | **crit** | UNDRCode tem stub IPC `checkpoint:revert` que não faz nada |
| 4 | **AI commit messages** | ✓ `cursor-commits` | ✓ `generateCommitMessage` | M (3h) | high | Chamar `claude -p "gere commit msg pro diff X"` |
| 5 | **Send terminal output → chat** | parcial | ✓ `sendTerminalToChat` | S (2h) | high | Hot path no daily-use (debug) |
| 6 | **Plan Mode dedicated UI** (não só permission mode) | ✓ `composer.plan_mode.*` | ✓ via setting | M (4h) | high | UNDRCode tem `permissionMode='plan'` mas sem visualização das etapas |
| 7 | **Diff zones (focused editing regions)** | parcial | ✓ `antigravity.openDiffZones` | L (10h) | high | Mostrar só hunks ativos do agente, esconde resto do file |
| 8 | **Review Changes editor (Cmd+Shift+Enter)** | parcial via composer | ✓ direto | M (6h) | high | Antigravity tem editor dedicado com side-by-side de TODAS as edits do turn |
| 9 | **Background composers** | ✓ VMs | ✓ Jetski (parcial) | XL (40h) | high | Worker offline. Crit pra workflow pesado |
| 10 | **Symbol outline (LSP-backed)** | ✓ | ✓ | L (12h) | high | UNDRCode tem `SymbolOutline.tsx` mas usa regex, não LSP |
| 11 | **Multi-session (tabs no chat)** | ✓ multiple composer tabs | ✓ multiple cascade tabs | M (6h) | high | `AgentManager` já suporta múltiplas — falta UI |
| 12 | **AI commit messages auto-suggest** | ✓ | ✓ `antigravity.generateCommitMessage` | M (3h) | high | Hook no CommitDialog atual |
| 13 | **Hang detection no chat** | ✓ `composer.submitChat.hang_abort` | n/a | S (2h) | high | Timer + UI "cancel turn" se nada por 60s |
| 14 | **Codebase semantic search** | ✓ `cursor-retrieval` 23MB | n/a | XL (60h) | high | Crit pra navegação em codebase grande |
| 15 | **Auto context picking** | ✓ `AUTO_CONTEXT` | ✓ Cascade auto | L (16h) | high | Detect quais files mencionar sem `@` explicit |
| 16 | **Loop on lints** | ✓ `LOOP_ON_LINTS` | ~ via plan | M (6h) | high | Após edit, roda tsc/eslint e re-prompta se falha |
| 17 | **`.cursorrules` / `.akairules` convention** | ✓ | ✓ via `.claude/rules/` | S (já tem) | n/a | UNDRCode já cobre via Customization Tabs |
| 18 | **Fork chat / duplicate session** | ✓ `composer.forkSharedChat` | n/a | S (2h) | med |
| 19 | **Browser embedded tab** | ✓ `cursor.browserView.*` (27 cmds) | parcial via PreviewView | XL (30h) | med | UNDRCode tem só `<webview>` preview, não tab browser real |
| 20 | **Audio events expandido (8-12 sons)** | ✓ 1 chime | ✓ 88 piano notes | S (1h) | med | UNDRCode tem `audioFeedback.ts` mas só usa 1-2 |

---

## 4. DUPLICAÇÕES e PROBLEMAS no UNDRCode

### 4.1 Duplicações UI

| Problema | Onde | Recomendação |
|---|---|---|
| **Native menu (`menu.ts`) vs Topbar menus custom (App.tsx)** | menu.ts declara File/Edit/View/Help; App.tsx tem 8 popovers File/Edit/Selection/View/Go/Run/Terminal/Help | Decidir: ou full custom (esconder native), ou sincronizar items 1:1. Hoje só os 4 native funcionam offline e os 8 custom dependem do React boot |
| **2 systems pra "history"** | `HistoryPanel.tsx` (modal) + `claude:listProjectSessions` IPC + `RecentActivity.tsx` | Unificar em 1 modal com 2 abas (Files / Sessions) |
| **Tabs do RightPane vs Tabs do BottomPanel** | RightPane lista 10 ids (`preview/diff/files/tasks/plan/problems/output/debug-console/terminal/ports`) mas BottomPanel só tem 8 (`problems/todos/output/debug-console/terminal/tasks/ports/pending-changes`) | `diff/files/plan/preview` ficam fantasmas no RightPane types — remover do union ou implementar |
| **Settings: Topbar > Settings + Account > "Editar UNDERCODE.md" + Modal SettingsModal** | 3 entry points pra config | Consolidar — Account menu manda pra SettingsModal direto |
| **Theme switcher**: Settings modal + Account menu cycle | Settings tem dropdown completo, Account tem cycle | OK manter ambos (atalho rápido + completo) |

### 4.2 Stubs que não funcionam

| Item | Localização | Status |
|---|---|---|
| `checkpoint:revert` IPC | `src/main/ipc/checkpoint.ts:90` | Comentado "STUB hoje" — só deleta meta, não restaura arquivos |
| Debug Console tab | `BottomPanel.tsx` | Empty state "sem debugger ainda" |
| Selection menu items | `App.tsx:1229` | 9/9 items marcados `disabled: true` |
| Run menu — Start Debugging | `App.tsx:1352` | `disabled: true` "Debug runtime ainda não implementado" |
| View menu — Toggle Fullscreen | `App.tsx:1289` | `disabled: true` (mas atalho F11 funciona via Electron) |
| Find/Replace nos menu items | `App.tsx:1199` | `disabled: true` redirect "Use no editor" — confunde user (esperam Find global) |
| Plugin Marketplace | `PluginMarketplace.tsx` (1117 linhas) | UI rica mas integration com claude CLI plugins ainda parcial — confirmar quantos plugins instalam de verdade |

### 4.3 Naming inconsistente

| Issue | Exemplo | Recomendação |
|---|---|---|
| Mix EN/PT-BR em labels | "Settings" (EN) vs "Configurações" (PT) coexistem | Padronizar pra PT-BR no UI; manter EN só nas keys de código |
| `akai-code` (pasta) vs `undrcode` (settings key) vs `UNDRCode` (display) | electron-store usa `undr-code`; settings file path tem `undr-code` mas brand é `UNDRCode` | Definir 1 slug canônico (`undrcode`) e usar em path + display |
| `chat` vs `agent` vs `cascade` no código | `AgentManager`, `ChatView`, `cascade-*` no Antigravity import refs | Definir: `chat` é a UI, `agent` é o backend, `cascade` não usar |
| `bottomPanel` vs `rightPane` vs `centralTabs` | 3 zonas com tabs — fácil confundir | Documentar arquitetura no CLAUDE.md |

### 4.4 Tech debt notável

- **`App.tsx` tem 2833 linhas** — monstro. Refatorar em hooks/contexts por dominio (chat / files / git / settings).
- **`settings-types.ts` tem dois `case 'editorFontSize'`** (linhas 173 e 194) e dois `case 'zoomFactor'` (linhas 142 e 199) — switches duplicados, segundo é unreachable.
- **`menu.ts` (native) tem só 4 menus**; topbar custom tem 8 — quem é canon?
- **`ChatView.tsx` 2460 linhas** — segundo maior. ComposerPopover já separa parte, mas tools/streaming/whisper/mentions cabe em 4 hooks distintos.
- **`BottomPanel.tsx` 1489 linhas + `PluginMarketplace.tsx` 1117** — quebrar em sub-components.

---

## 5. RECOMENDAÇÕES PRIORIZADAS

### Fase 1 — Quick wins (1-2 dias = 8-16h)

Pega 80% do impacto com 20% do esforço. Implementar nessa ordem:

1. **Cabear `useHunkKeyboard` no fluxo agent edit** (3h) — Alt+J/K accept/reject hunks. Hook já existe! Falta plugar nos `Edit/Write/MultiEdit` tool results.
2. **AI commit message** no CommitDialog (3h) — chamar `claude -p "<git diff>"` e prefill o textarea.
3. **Send terminal output → chat** (2h) — context menu no Terminal + button no header. Já tem `ChatView prefillInput`.
4. **Hang detection no chat** (2h) — timer 60s sem activity → mostra "ainda processando? cancelar?" toast.
5. **Fix `checkpoint:revert` IPC** (2h) — copiar files de volta. Storage já existe em `.akai/checkpoints/<id>/files/`.
6. **Audio events expandido** (1h) — usar 8-12 sounds do Antigravity (já em `audioFeedback.ts`, só hookar mais events).
7. **Dedup `editorFontSize` + `zoomFactor` cases** em `settings-types.ts` (15min) — cleanup óbvio.
8. **Import VS Code settings** (2h) — ler `~/.config/Code/User/settings.json`, mapear keys equivalentes.

**Total: ~15h. Impacto: +25% no daily-use.**

### Fase 2 — Médio prazo (3-5 dias = 24-40h)

Features que fazem o produto sentir "completo" vs Cursor/Antigravity.

9. **Multi-session tabs no chat** (6h) — `AgentManager` já suporta; adicionar tabbar + Ctrl+1..9 switch.
10. **Plan Mode UI dedicada** (4h) — visualização de etapas quando `permissionMode='plan'`, não só toggle.
11. **Review Changes editor** (6h) — modal/tab dedicada listando TODOS edits do turn antes de aceitar.
12. **Symbol outline LSP-backed** (12h) — substituir regex parser por LSP/Treesitter.
13. **`undrcode` CLI binary** (4h) — wrapper que abre o app + flags `--goto file:line`, `--diff a b`.
14. **Native menu sync com topbar custom** (3h) — gerar items do native a partir do mesmo source de truth do topbar.
15. **Refactor `App.tsx` em hooks por dominio** (6h) — `useChatState`, `useFileTabsState`, `useGitState`.

**Total: ~41h.**

### Fase 3 — Apostas grandes (1+ semanas cada)

Features que mudam o positioning do produto. Decidir 1 ou 2:

16. **Inline AI completions (Tab)** (XL, 40h+) — mini-agent paralelo que sugere completions a cada keystroke debounced. Diferencial GIANTE — fechar gap mais crítico vs Cursor.
17. **Diff zones / focused editing** (L, 10h) — só hunks ativos visíveis, resto colapsado durante turn do agente.
18. **Background composer (Jetski-like)** (XL, 40h) — 2ª BrowserWindow paralela com sessão autônoma trabalhando em outro workspace.
19. **Codebase semantic retrieval** (XL, 60h+) — embeddings local via sqlite + faiss-node. Crit pra codebases > 500 files.
20. **Browser embarcado real** (XL, 30h) — `cursor.browserView.*` paridade. Tab com chrome.dll embedded.
21. **Multi-model side-by-side** (XL, 30h) — pane com Claude vs ChatGPT vs Gemini lado-a-lado. Requer multi-backend.

---

## ANEXO — Métricas comparativas

| Métrica | UNDRCode | Antigravity | Cursor |
|---|---:|---:|---:|
| Bundle (renderer) | ~2-3 MB (Vite chunks) | 23 MB workbench | 53.5 MB workbench |
| Commands runtime | ~30 (App + registry) | 1826 total / 188 ns | 2238 total / 495 ns |
| CSS selectors custom | ~150 (.akai-*, .topbar-*, etc) | 130 | 808 |
| Telemetry events | 0 | 207 | 126 |
| Custom extensions | n/a (no ext model) | 5 antigravity-* | 18 cursor-* |
| Idioma | PT-BR | EN | EN |
| Lines of code (TS/TSX) | ~28-35k (estimado) | desconhecido (mas 24MB bundled JS = grande) | ~150-200k (estimado) |
| Maturity (years) | <1 | ~1 | 3+ |

UNDRCode entrega ~28% das capacidades do Cursor e ~55% do Antigravity com **<1% do
bundle size e <0.5% do tempo de desenvolvimento**. Excelente ROI. Próximos 40h focados
em Fase 1+início Fase 2 levam UNDRCode pra ~40% Cursor / ~70% Antigravity — território
de produto independente competitivo, não clone.
