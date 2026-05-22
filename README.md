# Akai Code

Desktop app prático pra Claude Code — pra criadores, designers e devs que querem velocidade sem ritual de IDE.

> "VS Code não é prático" — Rafael, founder

## Visão

Um wrapper Electron sobre o `claude` CLI, focado em **5 princípios não-negociáveis**:

1. **Click é tudo** — drag-drop generoso, botões grandes, mouse-first
2. **Zero ritual** — abre, clica numa pasta, ela vai pro Claude. Fim.
3. **PT-BR nativo** — não é tradução, é idioma de origem
4. **Visual claro** — não terminal-em-esteroides, mas IDE-em-PT-BR-pra-humanos
5. **Performance > features** — virtualização do output, zero lag em 1000+ mensagens

## Por que existe

Concorrentes (Opcode, Claudia, Claude Code Desktop oficial) são:
- Dev-centric (você precisa entender "subagent", "MCP", "/commands")
- Lentos com histórico longo (memory leaks documentados)
- Em inglês
- Sem multi-sessão visual (kanban)
- Sem branding/whitelabel

Akai Code mira o **vazio entre Cursor (caro, complexo) e Claude Code CLI (terminal puro)**: a ferramenta que um designer/criador BR consegue usar pra automatizar workflows sem aprender VS Code.

## Estado atual

🟡 **Alpha — em construção solo**

- ✅ Decisões arquiteturais
- ✅ Estrutura de projeto
- ⏳ Terminal embed funcional
- ⏳ File tree + drag-drop
- ⏳ Editor Monaco
- ⏳ Multi-sessão kanban
- ⏳ Branding Akai

## Como rodar (quando estiver pronto)

```bash
npm install
npm run dev
```

Pré-requisitos:
- Node.js 20+
- `claude` CLI instalado e autenticado (`npm install -g @anthropic-ai/claude-code` + `claude /login`)

## Stack

- **Electron** (desktop wrapper)
- **React + TypeScript** (UI)
- **Vite + electron-vite** (build)
- **xterm.js + node-pty** (terminal embed pro `claude` CLI)
- **Monaco** (editor)

Detalhes em [docs/DECISIONS.md](docs/DECISIONS.md).

## Roadmap

[docs/ROADMAP.md](docs/ROADMAP.md)

## Licença

MIT. Vê [LICENSE](LICENSE).
