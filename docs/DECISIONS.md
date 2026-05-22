# Architecture Decision Records (ADRs)

Decisões tomadas, com contexto + alternativas consideradas. Quando alguém pergunta "por que isso é assim?", a resposta tá aqui.

---

## ADR-001: Electron, não Tauri nem fork VS Code

**Contexto:** queremos app desktop standalone com chat Claude + drag-drop + file tree.

**Alternativas consideradas:**

| Opção | Tempo MVP | Pros | Contras |
|---|---|---|---|
| Electron + xterm + node-pty | 2-3 semanas | Ecosystem maduro, devs entendem, JS/TS direto, IPC fácil | 80MB binary, RAM 300MB+ |
| Tauri + Rust backend | 3-4 semanas | 10MB binary, performance, Opcode/Claudia usam | Curva Rust, menos devs, IPC mais formal |
| Fork Code-OSS | 3-6 meses | Herda IDE features, marketplace, polish | Source code 1M+ linhas, build complexo, mantém fork forever |
| Monaco standalone (sem Electron) | 1-2 semanas | Web app, leve | Sem FS local, sem terminal, sem desktop integration |

**Decisão:** Electron.

**Justificativa:**
- MVP em semanas, não meses
- JS/TS direto (você não sabe Rust)
- IPC simples via `contextBridge` + `ipcRenderer`
- 80MB binary é OK pra criadores/designers (não target dev minimalist)
- Quando crescer e fizer sentido performance: migra pra Tauri ou fork VS Code

**Trade-off aceito:** binary maior + RAM maior. Mitigação: virtualização do terminal output (xterm.js já faz), lazy loading de componentes.

---

## ADR-002: React + TypeScript, não Svelte/Vue/Solid

**Contexto:** precisamos framework de UI pro renderer.

**Decisão:** React + TypeScript com `strict: false`.

**Justificativa:**
- React = ecosystem maior (xterm-for-react, monaco-editor-react existem prontos)
- TS = type safety nos pontos críticos (IPC, models de dados)
- `strict: false` = produtividade > rigor inicial. Apertar depois quando estável.

**Alternativas:**
- Svelte: menor bundle, syntax linda, mas menos libs Electron-compatible
- Vue: igualmente válido, mas React ganha em material de aprendizado
- Solid: muito novo, ecosystem pequeno

**Trade-off aceito:** bundle maior que Svelte. Mitigação: code splitting via Vite.

---

## ADR-003: Wrappear `claude` CLI, não chamar API direta

**Contexto:** o app precisa interagir com Claude.

**Alternativas:**

| Opção | Pros | Contras |
|---|---|---|
| Wrap `claude` CLI via node-pty | Auth de graça (OAuth Claude Max), TODAS features (subagents, hooks, MCP, plugins, /commands), updates da Anthropic vêm automático | Performance overhead pequeno, parsing de output |
| Chamar API Anthropic direto via @anthropic-ai/sdk | Mais controle, sem dependência do CLI | Reimplementa subagents, hooks, MCP, plugins do zero (6+ meses de trabalho) |

**Decisão:** Wrap CLI.

**Justificativa:**
- Usuário não precisa configurar API key — usa Claude Max que já paga
- TODAS features Claude Code disponíveis dia 1
- Updates Anthropic chegam grátis
- Menos código pra manter

**Trade-off aceito:** dependência de `claude` CLI instalado. Mitigação: instalador da app verifica e oferece instalar automaticamente.

---

## ADR-004: Estado local com useState/useReducer, não Redux/Zustand AGORA

**Contexto:** state management do React.

**Decisão:** começa com useState/useReducer. Adiciona Zustand quando state global > 5 stores ou quando prop drilling virar dor.

**Justificativa:** YAGNI. MVP solo não tem complexidade de estado que justifique store global.

---

## ADR-005: MIT License

**Contexto:** futura comercialização? Open source?

**Decisão:** MIT.

**Justificativa:**
- Permite comercialização sem amarras
- Comunidade pode contribuir
- Compatível com dependências (Electron, xterm.js, Monaco — tudo MIT/Apache)
- Se quiser fechar parte premium depois, modelo open-core funciona

**Alternativas rejeitadas:**
- AGPL: força open source de derivados. Ruim pra comercialização futura.
- Proprietary closed: cedo demais pra fechar.

---

## ADR-006: PT-BR como idioma de origem (não tradução)

**Contexto:** mercado-alvo Brasil.

**Decisão:** strings em PT-BR direto no código (i18n vem só quando expandir).

**Justificativa:**
- Concorrentes 100% em inglês — gap real
- Refactor pra i18n é mecânico depois (extrair strings → JSON)
- MVP precisa de iteração rápida, não rigor i18n

---

## ADR-007: Build com Vite + electron-vite

**Contexto:** build tool.

**Decisão:** Vite + electron-vite plugin.

**Justificativa:**
- HMR rápido no dev
- Build de produção otimizado
- Suporte TS nativo
- electron-vite resolve a parte tricky de Electron (main + preload + renderer separados)

**Alternativa rejeitada:** webpack + electron-forge. Funciona mas mais lento, mais config.

---

## Decisões pendentes (decide com Rafael amanhã)

- [ ] Nome final do produto (Akai Code? AkaiOps? OutroNome?)
- [ ] Branding visual — paleta exata Akai (champagne + dark earth — pegar do design system existente)
- [ ] Ícone do app (Phosphor sparkle? Logo Akai custom?)
- [ ] Modelo de pricing (free open-source vs free + premium features?)
- [ ] Auto-updater (electron-updater?) — pra v1 não, pra v2 sim
- [ ] Telemetry opt-in (saber o que usuários fazem) — privacy first
