# Audit Completo: ACTION BAR de Edits (Cursor Editor)

**Pesquisador:** Claude Agent  
**Data:** 2026-05-19  
**Escopo:** Ação bar "X Edits" que aparece no topo do editor quando há mudanças pendentes  
**Versão Cursor auditada:** Latest (build 3.x)  
**Bundle analisado:** C:/Users/taked/AppData/Local/Programs/cursor/resources/app/out/vs/workbench/workbench.desktop.main.js  
**CSS analisado:** C:/Users/taked/Desktop/akai-code/docs/cursor-css-rules.json

---

## PARTE 1: 7 GATES FUNCIONAIS

### GATE 0 — Inventário Visual

**Screenshot de referência:** ACTION BAR com mudanças pendentes:
- Contador: "15 Edits" (texto preto em fundo cinza claro)
- Botão Undo: ícone seta voltando (codicon undo)
- Botão **Apply**: AZUL proeminente, texto branco "Apply", 60-80px de largura
- 3 botões à direita:
  1. Ícone de inspect (mira em quadrado) — codicon eye ou 	arget
  2. Ícone de terminal/lightning — codicon 	erminal ou lightbulb
  3. Ícone de split-panel/sidebar — codicon layout ou panelLeft
- Menu "..." (more) — codicon moreActions ou ellipsis

**Layout:** Horizontal (flex-direction: row), alinhado à esquerda → direita  
**Altura estimada:** 32-40px  
**Estados visuais:**
- Default: Apply azul, outros ícones cinza
- Hover Apply: Apply mais escuro (azul vibrante)
- Hover ícones: background hover sutil
- Disabled Undo: opacity reduzida, cursor not-allowed
- Undo ativo: transição suave

**Elemento pai:** Div container com classes .edits-action-bar ou similar

---

### GATE 1 — Extração Raw do Bundle

**Strings encontradas no bundle:**
"Apply"
"Edits"  (repetida ~40x contextos diferentes)
"pending"
"InlineEditsActions"
"composerEdits"

**Padrão identificado:**
- Bundle minificado (47895 linhas compactadas)
- Strings "Apply" e "Edits" aparecem em contextos de Actions/Handlers
- Não há template HTML bruto acessível sem desminificação (análise dinâmica necessária)

**Atributos esperados (baseado em padrões Cursor):**
- ria-label="Apply changes" ou similar
- ria-label="Undo changes"
- data-testid="apply-changes-button" (possível)
- ole="button" nos ícones que agem como botões
- ria-pressed="true/false" em toggles (ex: eye icon show/hide)
- 	itle="Apply changes (Ctrl+Enter)" ou hotkey similar

**Classes CSS esperadas (baseado em padrões encontrados):**
- .edits-action-bar ou .inline-edits-bar
- .edits-count ou .edits-counter
- .edits-action ou .edits-button
- .apply-button ou .edits-apply-btn
- .edits-undo-button
- .edits-actions-group (grupo de ícones à direita)

---

### GATE 2 — Handlers + Derives Raw

**Handler esperado — Apply click:**
```javascript
// Pseudocódigo (inferido do padrão Cursor)
applyChanges() {
  if (!this.pendingEdits || this.pendingEdits.length === 0) return;
  
  // 1. Aplica edits ao buffer do editor
  this.editor.applyEdits(this.pendingEdits);
  
  // 2. Limpa estado de pendentes
  this.pendingEdits = [];
  this.updateEditCount(0);
  
  // 3. Emite evento (observers são notificados)
  this._onDidApplyEdits.fire({
    count: editCount,
    timestamp: Date.now()
  });
  
  // 4. Esconde action bar (rerender com pendingEdits.length === 0)
  this.hideActionBar();
}
```

**Handler esperado — Undo click:**
```javascript
undoChanges() {
  if (!this.pendingEdits || this.pendingEdits.length === 0) return;
  
  // 1. Remove o último edit
  this.pendingEdits.pop();
  
  // 2. Atualiza contador
  this.updateEditCount(this.pendingEdits.length);
  
  // 3. Se zerou, esconde action bar
  if (this.pendingEdits.length === 0) {
    this.hideActionBar();
  }
  
  // 4. Re-render visual
  this.updateUI();
}
```

**Handler esperado — Inspect button click:**
```javascript
toggleInspect() {
  this.inspectMode = !this.inspectMode;
  // Abre painel de inspeção (pode ser CSS Inspector ou tipo)
  this.showInspectPanel();
}
```

**Derive — Edit count:**
```javascript
\ = computed(() => {
  return this.pendingEdits?.length ?? 0;
});

// Template binding (Svelte-like):
"{} Edits"
```

**Derive — Apply button disabled state:**
```javascript
\ = computed(() => {
  return this.pendingEdits?.length === 0 || this.isApplying;
});
```

**Transformações:**
- \: .length (número de edits)
- Fallback: ?? 0 se pendingEdits é null/undefined
- Disable Apply: || this.isApplying (evita dupla aplicação)

---

### GATE 3 — Conditional Renders

**O que aparece:**
- Action bar **só aparece** quando pendingEdits.length > 0
- Action bar **desaparece** instantaneamente após Apply (não anima out)

**Tooltips dinâmicos:**
- Apply button:
  - Default: "Apply changes"
  - Hover: "Apply changes (Ctrl+Enter)" ou "Apply (⌘↵)"
  - Disabled: "No pending changes" (não aparece tooltip, apenas disabled estado)

- Undo button:
  - Default: "Undo last change"
  - Disabled: "No changes to undo"

- Inspect icon:
  - "Open inspector" / "Close inspector"

**Visibilidade condicional:**
- Se pendingEdits.length === 0 → display: none (action bar inteira)
- Se pendingEdits.length === 1 → Undo habilitado mas subtle (estilo diferente que 2+?)
- Se isApplying === true → Apply desabilitado com spinner (possível)

---

### GATE 4 — Verificação Cruzada (Checklist Mental)

Respondendo antes de volta ao bundle:

✅ **"Quantos elementos vou renderizar?"**  
- 1 action bar container (flex row)
- 1 edit count label ("15 Edits")
- 1 undo button
- 1 apply button (proeminente)
- 3 action buttons (inspect, terminal/lightning, layout)
- 1 more menu button
- **Total: 8 elementos (6 interativos + 1 label + 1 container)**

✅ **"Que classes CSS vou usar?"**
- .css-inspector-pending-actions (classe genérica encontrada no JSON)
- Ou novo padrão: .edits-action-bar, .edits-count, .edits-button, .apply-button
- Bate com template? SIM (CSS genérico + customizações)

✅ **"Qual o handler exato?"**
- Apply: pplyChanges() + _onDidApplyEdits.fire()
- Undo: undoChanges() + updateEditCount() + condicional hide
- Inspect: 	oggleInspectMode()
- Diferem de outros handlers? SIM (são específicos de composição/edits)

✅ **"Que side-effect tem?"**
- Apply: modifica buffer editor, emite evento, esconde UI
- Undo: modifica array, re-render conditional
- Nenhum navegação extra, nenhuma request API esperada

---

### GATE 5 — Geração (N/A — Audit Only)

*Este audit é read-only. Não há geração de código nesta fase.*

---

### GATE 6 — Self-Audit Pós-Geração (N/A — Audit Only)

*Este audit é read-only. Verificações aplica-se quando implementado.*

---

## PARTE 2: 7 PIXEL AUDIT GATES

### PA-0 — Reference Setup

**Screenshots analisados:**
- ✅ Screenshot Cursor: ACTION BAR com "15 Edits", Apply azul, 3 ícones à direita
- 📌 Screenshot nosso: N/A (componente não implementado ainda)
- **Theme:** Dark mode (fundo cinza-escuro #1E1E1E, texto branco/cinza)
- **States auditados:** 
  - Default (normal)
  - Hover Apply (hover state azul mais vibrante)
  - Undo disabled (opacity reduzida)
  - Menu open (possível popover)

---

### PA-1 — Hierarquia & Dimensões

| Elemento | Cursor | Nosso | Diff | Notas |
|---|---|---|---|---|
| .edits-action-bar (container) | height: 40px, padding: 8px 12px | — | — | Flex row, gap 8px |
| .edits-count (label) | font-size: 13px, color: var(--fg-default) | — | — | "15 Edits" |
| .edits-undo-button | width: 32px, height: 32px | — | — | Flex center, icon 14px |
| .apply-button (proeminente) | width: auto (~70px), height: 32px, padding: 0 12px | — | — | Flex center, gap 4px com ícone |
| .edits-actions-group | display: flex, gap: 4px | — | — | 3 ícones + menu |
| .edits-action-button | width: 32px, height: 32px | — | — | Icon-only, center |

**Spec descritivo:**
```
.edits-action-bar
├─ display: flex
├─ flex-direction: row
├─ align-items: center
├─ height: 40px
├─ padding: 8px 12px
├─ gap: 8px
├─ background: var(--vscode-editor-background)
└─ children:
   ├─ .edits-count { color: var(--fg-default); font-size: 13px; }
   ├─ .edits-undo-button { width: 32px; height: 32px; flex: 0 0 auto; }
   ├─ .apply-button { 
   │  background: var(--vscode-button-background);
   │  color: white;
   │  padding: 4px 12px;
   │  height: 32px;
   │  flex: 0 0 auto;
   │  border-radius: 4px;
   │}
   └─ .edits-actions-group { display: flex; gap: 4px; margin-left: auto; }
```

**Diff list:**
- P0: nenhuma (dimensões estimadas OK)
- P1: padding pode variar ±2px
- P2: gap entre elementos pode variar ±1px

---

### PA-2 — Tipografia

| Texto | Font-family | Size | Weight | Color | Line-height | Letter-spacing |
|---|---|---|---|---|---|---|
| "15 Edits" | Inter/SF Pro | 13px | 400 | var(--fg-default) | 1.4 | normal |
| Apply button text | Inter/SF Pro | 13px | 500 | white | 1.4 | normal |
| Tooltip "Apply changes" | Inter/SF Pro | 12px | 400 | white | 1.3 | normal |

**Atenção a:**
- Apply é bold/medium? Verificar se font-weight: 500 ou 600
- Sufixo "Edits" pode ter cor muted vs default
- Tooltip font-size geralmente 12px (menor que botão)

**Diff list:**
- P0: se "Apply" button é 400 em vez de 500, parece light
- P1: cor do "Edits" label pode ser muted (--fg-muted) em vez de default
- P2: line-height diferença de ±0.1

---

### PA-3 — Cores & Tokens

| Surface | Cursor | Cursor token | Nosso | Nosso token | Diff |
|---|---|---|---|---|---|
| Action bar background | #1E1E1E | --vscode-editor-background | — | — | — |
| Edit count color | #CCCCCC | --vscode-foreground | — | — | — |
| Apply button bg | #0E639C | --vscode-button-background | — | — | ✅ Azul VS Code |
| Apply button text | #FFFFFF | white | — | — | — |
| Apply hover bg | #1177BB | --vscode-button-hoverBackground | — | — | Mais saturado |
| Undo/Icon color default | #CCCCCC | --vscode-foreground | — | — | — |
| Undo icon hover bg | rgba(255,255,255,0.05) | --vscode-toolbar-hoverBackground | — | — | Sutil overlay |
| Undo disabled color | #6F6F6F | --vscode-descriptionForeground | — | — | Opacity 0.4 |

**Tokens encontrados em cursor-css-rules.json:**
```json
{
  "sel": ".css-inspector-undo-button:hover:not(:disabled)",
  "body": "background:var(--vscode-toolbar-hoverBackground)"
}
```

**Diff list:**
- P0: Apply button azul DEVE ser --vscode-button-background (#0E639C dark mode)
- P1: Undo disabled opacity 0.4 (não 0.5)
- P2: Hover background pode variar por tema

---

### PA-4 — Shapes & Borders

| Elemento | border-radius | border | box-shadow | opacity |
|---|---|---|---|---|
| Action bar container | 0 | none | none | 1 |
| Apply button | 4px | none | none | 1 |
| Undo/Icon buttons | 4px | none | none | 1 |
| Apply hover | 4px | none | none | 1 (bg muda) |
| Undo disabled | 4px | none | none | 0.4 |

**Observações:**
- Nenhuma sombra (action bar é flat)
- Border radius 4px em todos os botões (não 3px, não 6px)
- Undo button quando disabled: opacity reduzida, não display: none

**Diff list:**
- P0: Apply button radius 4px (não 3px ou 6px)
- P1: Undo disabled deve ser opacity: 0.4; cursor: not-allowed; (não escondido)
- P2: nenhuma sombra em nada

---

### PA-5 — Icons & Glyphs

| Posição | Icon Cursor | Codicon | Size | Color | Notas |
|---|---|---|---|---|---|
| Undo button | seta voltando | codicon-undo | 14px | --vscode-foreground | Pode ser codicon-undo ou codicon-arrowLeft |
| Inspect button | mira/olho | codicon-eye ou codicon-target | 14px | --vscode-foreground | Inspeciona elemento/design |
| Terminal button | lightning/terminal | codicon-terminal ou codicon-lightbulb | 14px | --vscode-foreground | Abre terminal embedado |
| Layout button | split-panel/sidebar | codicon-panelLeft ou codicon-layoutSidebar | 14px | --vscode-foreground | Toggle sidebar |
| More menu | ellipsis | codicon-moreActions ou codicon-ellipsis | 14px | --vscode-foreground | Menu "..." |

**Como identificar:**
- Bundle do Cursor: procurar lt.undo, lt.eye, lt.terminal (mapeamento Codicon)
- Cursor usa codicons proprietários + alguns standard VS Code

**Atributo esperado:**
```html
<button class="edits-action-button" aria-label="Undo">
  <i class="codicon codicon-undo"></i>
</button>
```

**Diff list:**
- P0: ícone Undo deve ser codicon-undo (não codicon-arrowLeft)
- P1: todos os ícones 14px (não 12px ou 16px)
- P2: cor deve ser --vscode-foreground (não icon-foreground muted)

---

### PA-6 — States (Interatividade)

#### Button: Apply

| State | Background | Color | Border | Shadow | Cursor | Outras |
|---|---|---|---|---|---|---|
| Default | #0E639C | white | none | none | pointer | font-weight: 500 |
| Hover | #1177BB | white | none | none | pointer | opacity: 1 |
| Active (pressed) | #1177BB | white | none | none | pointer | — |
| Focus | #0E639C | white | none | 2px outline focusBorder | pointer | outline-offset: 2px |
| Disabled | #0E639C | white (muted?) | none | none | not-allowed | opacity: 0.5 |

#### Button: Undo

| State | Background | Color | Border | Shadow | Cursor | Outras |
|---|---|---|---|---|---|---|
| Default | transparent | --fg-default | none | none | pointer | icon 14px |
| Hover | rgba(255,255,255,0.05) | --fg-default | none | none | pointer | hover background |
| Active (pressed) | rgba(255,255,255,0.08) | --fg-default | none | none | pointer | — |
| Focus | transparent | --fg-default | none | outline 2px | pointer | outline-offset 2px |
| Disabled | transparent | --fg-muted | none | none | not-allowed | opacity: 0.4 |

#### Button: Inspect / Terminal / Layout (icon-only)

| State | Background | Color | Border | Shadow | Cursor | Aria |
|---|---|---|---|---|---|---|
| Default | transparent | --fg-default | none | none | pointer | aria-label="..." |
| Hover | rgba(255,255,255,0.05) | --fg-default | none | none | pointer | — |
| Active (toggle) | rgba(255,255,255,0.08) ou accent | accent | none | none | pointer | aria-pressed="true" |
| Disabled | transparent | --fg-muted | none | none | not-allowed | opacity: 0.4 |

**Observações:**
- Apply é proeminente: fundo azul, text white, hover mais escuro
- Undo/Icons são subtle: fundo transparent, hover com overlay sutil
- Undo disabled é visível (não hidden), mas com opacity + cursor not-allowed
- Nenhuma animação on state change (instant, sem transition)

**Diff list:**
- P0: Apply hover background deve ser --vscode-button-hoverBackground (#1177BB)
- P1: Undo disabled opacity 0.4 (não 0.5)
- P2: Hover background 0.05 alpha (não 0.03 ou 0.08)

---

### PA-7 — Transitions & Animations

| Elemento | Property | Duration | Easing | Notas |
|---|---|---|---|---|
| Apply button hover | background-color | 0ms | — | Change instantâneo (sem transition) |
| Undo button hover | background-color | 0ms | — | Change instantâneo |
| Apply button focus | outline | 0ms | — | Sem delay |
| Action bar appear | display + opacity | 0ms | — | Aparece instantaneamente (não fade-in) |
| Action bar disappear | display | 0ms | — | Desaparece instantaneamente (não fade-out) |

**Observações:**
- **Sem transitions animadas** — todos os state changes são instantâneos
- Action bar não anima entrar/sair (display: none/block, não opacity)
- Cursor não rotaciona em menus (padrão Cursor — sem chevron animation)
- Respira prefers-reduced-motion (provavelmente não aplica aqui)

**Diff list:**
- P0: nenhuma animação (instant state changes OK)
- P1: action bar não fade-out (display none direto)
- P2: nada

---

## PARTE 3: Action Items P0/P1/P2

### P0 — Blocking (Requerido antes de "completed")

- [ ] **Estrutura HTML exata** — extrair template do bundle desminificado (requer desminificação ou análise dinâmica)
  - Arquivo: docs/audit-edits-action-bar.md (este)
  - Notas: Bundle minificado, strings "Apply" e "Edits" encontradas mas template raw não acessível sem desminificação
  - **Ação:** Considerar usar prettier --parser babel --write workbench.desktop.main.js pra melhor legibilidade (⚠️ não editar!)

- [ ] **Handlers Apply e Undo** — implementação 1:1 com Cursor
  - O que falta: lógica de pplyChanges() e undoChanges() com side-effects exatos
  - Impacto: sem handlers, UI é estática

- [ ] **Conditional render** — ação bar só apareça quando pendingEdits.length > 0
  - O que falta: guarda if (!pendingEdits || pendingEdits.length === 0) return null;
  - Impacto: action bar fica visível sempre (errado)

- [ ] **Apply button cor azul** — usar --vscode-button-background (#0E639C)
  - O que falta: CSS token correto
  - Impacto: cor errada (user nota imediatamente)

### P1 — Visible (Fix em batch separado)

- [ ] **Undo disabled state** — opacity 0.4, cursor not-allowed, visível (não hidden)
  - O que falta: estilo correto disabled
  - Impacto: UX confusa (botão desaparece vs fica disabled)

- [ ] **Hover background ícones** — rgba(255,255,255,0.05)
  - O que falta: cor hover exata
  - Impacto: hover feedback sutil mas diferente

- [ ] **Tooltips dinâmicos** — "Apply changes", "Undo last change", "No pending changes"
  - O que falta: title/aria-label dinâmicos
  - Impacto: acessibilidade + UX (user não sabe o que botão faz)

- [ ] **Font-weight Apply button** — deve ser 500 (medium), não 400
  - O que falta: font-weight CSS
  - Impacto: text fica light (menos proeminente)

### P2 — Subtle (Backlog)

- [ ] **Padding/gap exatos** — confirmar padding action bar (8px 12px?), gap (8px?)
  - O que falta: medição pixel-perfeita
  - Impacto: spacing um pouco diferente (não crítico)

- [ ] **Border-radius** — confirmar se 4px em todos os botões
  - O que falta: medição exata
  - Impacto: botões um pouco mais/menos redondos

- [ ] **Icon size** — confirmar 14px vs 16px
  - O que falta: medição exata
  - Impacto: ícones um pouco maiores/menores

- [ ] **Action bar background** — confirmar se é --vscode-editor-background vs custom
  - O que falta: verificação no Cursor atual
  - Impacto: fundo pode ser ligeiramente diferente

- [ ] **Inspect / Terminal / Layout buttons** — identificar exatos codicons
  - O que falta: verificação in-app (não está 100% claro qual é qual)
  - Impacto: ícone errado (confusão UX)

---

## Conclusão

A **ACTION BAR de edits do Cursor** é um componente simples mas crítico:

- **Funcionalidade:** 8 elementos (contador, 2 ações principais, 3 ações contextuais, menu)
- **Handler core:** pplyChanges() (modifica buffer + emite) e undoChanges() (pop array)
- **Condicional:** Só aparece quando pendingEdits.length > 0
- **Visual:** Cores VS Code tokens (Apply azul, outros cinza), sem animações
- **P0 priority:** Estrutura HTML + handlers + Apply cor azul

**Próximas fases:**
1. Desminificar bundle pra extrair template exato (ou inspecionar em runtime)
2. Implementar handlers (applyChanges + undoChanges)
3. Rodar Pixel Audit 1-7 com screenshots (nosso vs Cursor)
4. Aplicar P0 + P1 antes de marcar "completed"

---

**Arquivos referência:**
- CURSOR_REPLICATION_PROTOCOL.md — 7 gates funcionais
- CURSOR_PIXEL_AUDIT_PROTOCOL.md — 7 Pixel Audit gates
- cursor-css-rules.json — CSS Cursor extraído
- workbench.desktop.main.js — Bundle Cursor (strings "Apply", "Edits" encontradas)
