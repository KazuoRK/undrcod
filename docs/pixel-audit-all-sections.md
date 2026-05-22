# Pixel Audit — Todas as Sections do CSS Inspector

**Data:** 2026-05-19
**Source:** `workbench.desktop.main.css` extraído do Cursor 3.4.20
**Compared vs:** `src/renderer/components/PreviewView/PreviewView.css`
**Output JSON intermediário:** `docs/cursor-css-rules.json` (14k rules total)

---

## PA-0 — Globais (afetam TODAS sections)

### Tokens de cor do Cursor (mapeamento canônico)

| Token Cursor | Uso | Nosso equivalente | Status |
|---|---|---|---|
| `--vscode-foreground` | text principal | `var(--fg-default)` | ✅ ok |
| `--cursor-text-primary` | text forte (idêntico a fg) | `var(--fg-default)` | ✅ |
| `--cursor-text-secondary` | text labels, suffix de section | `var(--fg-muted)` | ❌ um pouco mais claro |
| `--cursor-text-tertiary` | text muted (suffix px/%, toggle inactive) | precisa ter | ❌ NÃO TEMOS |
| `--cursor-icon-secondary` | icons em buttons | `var(--fg-muted)` | ✅ |
| `--cursor-bg-primary` | bg base inspector | `var(--bg-base)` | ✅ |
| `--cursor-bg-secondary` | bg hover/active leve | `var(--bg-elevated)` | ✅ |
| `--cursor-bg-tertiary` | bg de input fields | precisa ter | ❌ usamos elevated |
| `--cursor-bg-quaternary` | bg hover de dropdowns | precisa ter | ❌ |
| `--cursor-stroke-tertiary` | borders de inputs/dropdowns | `var(--border-subtle)` | ✅ |
| `--cursor-stroke-quaternary` | section dividers | `var(--border-subtle)` | ✅ |
| `--vscode-focusBorder` | focus rings | `var(--accent)` | ✅ |
| `--vscode-textLink-foreground` | accent text (active states) | `var(--accent)` | ✅ |

**P0 GLOBAL:** Faltam 3 tokens (`--cursor-text-tertiary`, `--cursor-bg-tertiary`, `--cursor-bg-quaternary`) que dão hierarquia visual ao Cursor. Sem eles tudo fica chapado.

---

## Section Header (base de todas)

### Cursor
```css
.css-section-title { font-size: 12px; font-weight: 600; color: var(--vscode-foreground); }
.css-section-body { display: flex; flex-direction: column; gap: 12px; }
.css-section-actions { display: flex; align-items: center; gap: 6px; }
.css-section-action { width: 24px; height: 24px; border-radius: 4px; border: 1px solid transparent; }
.css-section-action .codicon { font-size: 14px; }
.css-section-action:hover { background: var(--cursor-bg-secondary); }
.css-section-header { display: flex; align-items: center; justify-content: space-between; }
.css-section-header.clickable { cursor: pointer; }
.css-section-header-actions { display: flex; align-items: center; gap: 0; }  /* GAP ZERO! */
```

### Nosso
```css
.css-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-muted); }
.css-section-body { display: flex; flex-direction: column; gap: 6px; }
.css-section-actions { display: flex; gap: 4px; }
.css-section-action { width: 24px; height: 24px; padding: 0; }
.css-section-action .codicon { font-size: 14px; }
.css-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; gap: 8px; }
.css-section-header-actions { display: flex; gap: 4px; }
```

### Diff list

| ID | Severity | Diff | Fix |
|---|---|---|---|
| SH-1 | **P0** | Title em UPPERCASE + letter-spacing + muted color | Remover `text-transform: uppercase`, remover `letter-spacing`, mudar pra 12px, color `var(--fg-default)` |
| SH-2 | **P0** | Section body gap 6px (metade do Cursor) | Mudar `gap: 6px` → `gap: 12px` |
| SH-3 | P1 | section-actions gap 4px ≠ 6px | Mudar pra 6px |
| SH-4 | P1 | section-header-actions gap 4px ≠ 0 | Mudar pra 0 |
| SH-5 | P2 | Header margin-bottom 8px (Cursor não tem — usa body gap) | Remover margin-bottom |

---

## 1) Position Section

### Cursor
```css
.css-position-disabled { opacity: .5; }
.css-position-mode-toggle.active { background: transparent; color: var(--vscode-textLink-foreground); }
/* Cursor pin button quando active: SÓ muda cor, NÃO muda background */
```

### Nosso
```css
.css-section-action.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.css-position-mode-toggle ... /* não temos override específico */
```

### Diff list

| ID | Severity | Diff | Fix |
|---|---|---|---|
| POS-1 | **P0** | Pin button active no nosso fica com bg accent solid; Cursor só muda cor pra link-color | Adicionar `.css-position-mode-toggle.active` que mantém bg transparent, muda só cor pra `var(--accent)` |
| POS-2 | P2 | Disabled state usa opacity 0.5 — confirmar que aplica em todos descendants | OK, já temos |

---

## 2) Layout + Dimensions + Padding + Margin

### Cursor
```css
/* Padding controls */
.css-padding-controls { display: flex; flex-direction: column; gap: 8px; }
.css-padding-grid { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.css-padding-mode-toggle { width: 26px; height: 26px; border-radius: 6px; }  /* 26px! não 24 */
.css-padding-mode-toggle.active { background: transparent; color: var(--vscode-textLink-foreground); }
.css-padding-mode-toggle .codicon { font-size: 14px; }
.css-padding-label-icon { width: 20px; height: 20px; color: var(--cursor-text-secondary); }
.css-padding-label-icon .codicon { font-size: 12px; }

/* Margin idem mas com css-margin-* */

/* Dimensions */
.css-dimension-menu-item { font-size: 12px; padding: 2px 8px 2px 4px; }
.css-dimension-menu-item:hover { background: var(--cursor-bg-tertiary); }
.css-dimension-menu-icon { width: 20px; height: 20px; }
```

### Nosso (snippet)
```css
.css-input-group { background: var(--bg-elevated); border-radius: 4px; padding: 0 6px; height: 28px; }
.css-control-label { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-muted); }
```

### Diff list

| ID | Severity | Diff | Fix |
|---|---|---|---|
| LAY-1 | **P0** | `.css-input-group` height 28px (Cursor é 24px) | Mudar pra 24px |
| LAY-2 | **P0** | `.css-input-group` padding `0 6px` (Cursor é `2px 6px 2px 4px`) | Ajustar padding |
| LAY-3 | **P0** | `.css-input-group` bg = `--bg-elevated` (Cursor é `--cursor-bg-tertiary` mais escuro que secondary) | Criar token `--bg-input` mais escuro que elevated |
| LAY-4 | **P0** | `.css-control-label` em UPPERCASE + monospace (Cursor é normal + sans, font-size 10px, weight 500) | Remover uppercase + letter-spacing + font-mono |
| LAY-5 | P1 | Mode toggle buttons 24×24 (Cursor é 26×26) | Mudar pra 26×26 |
| LAY-6 | P1 | Mode toggle active = accent bg (Cursor = só cor link) | Mudar pra só cor |
| LAY-7 | P1 | Cursor usa `--cursor-bg-tertiary` no hover do dimension menu | Implementar quando tiver o token |

---

## 3) Appearance Section

### Cursor
```css
.css-appearance-grid { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.css-corner-radius-row { align-items: stretch; display: flex; gap: 8px; }
.css-corner-toggle-button { width: 24px; height: 24px; border-radius: 6px; }
.css-corner-toggle-button[data-active="true"] { background: transparent; color: var(--vscode-textLink-foreground); }
.css-corner-grid { display: grid; gap: 8px; grid-column: span 2; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.css-corner-input { align-items: center; gap: 6px; }
.css-corner-preview { width: 16px; height: 16px; border: 1px solid var(--vscode-widget-border); }
.css-corner-preview[data-corner="top-left"] { border-top-left-radius: 8px; }  /* etc */
```

### Nosso

Não temos `.css-corner-preview` (small icon visual de cada canto).

### Diff list

| ID | Severity | Diff | Fix |
|---|---|---|---|
| APP-1 | **P0** | Falta `.css-corner-preview` (16×16 box com border 1px que mostra qual canto está sendo editado) | Adicionar elemento visual no per-corner mode |
| APP-2 | P1 | Corner toggle button active = só cor (Cursor) vs bg accent (nosso) | Mudar pra só cor |
| APP-3 | P2 | grid gap 8px confirmar | OK |

---

## 4) Text (Typography)

### Cursor
```css
.css-typography-body { display: flex; flex-direction: column; gap: 12px; }
.css-typography-color-row { display: flex; align-items: center; gap: 8px; }
.css-typography-row { gap: 8px; align-items: stretch; }
.css-typography-field { display: flex; flex: 1 1 0; flex-direction: column; gap: 4px; min-width: 0; }
.css-typography-field-label { display: block; margin-bottom: 4px; }
.css-typography-label-icon { color: var(--cursor-text-secondary); width: 16px; height: 16px; }
.css-typography-align-row { display: flex; flex-wrap: nowrap; gap: 6px; margin-top: 6px; }

.css-font-dropdown { background: transparent; border: 1px solid var(--cursor-stroke-tertiary); border-radius: 6px; padding: 3px 8px; font-size: 12px; }
.css-font-dropdown:hover { background: var(--cursor-bg-quaternary); }

.css-font-menu-surface { border-radius: 6px; box-shadow: 0 4px 18px rgba(0,0,0,.3); padding: 6px; }
.css-font-search { background: var(--vscode-input-background); border-radius: 4px; padding: 4px 26px 4px 6px; font-size: 12px; }
.css-font-list { max-height: 240px; }
.css-font-item { height: 24px; padding: 4px 6px; border-radius: 4px; font-size: 12px; }
.css-font-item.active, .css-font-item:hover { background: var(--cursor-bg-secondary); }
.css-font-item .codicon { color: var(--vscode-focusBorder); font-size: 12px; }
```

### Diff list

| ID | Severity | Diff | Fix |
|---|---|---|---|
| TXT-1 | **P0** | typography-body gap 12px ≠ 6px nosso | Mudar pra 12px |
| TXT-2 | P1 | typography-field gap 4px entre label e input | Garantir 4px |
| TXT-3 | P1 | font-dropdown border-radius 6px (não 4) + padding 3px 8px (não default) | Verificar nosso |
| TXT-4 | P1 | font-menu tem padding 6px + shadow 0 4px 18px rgba(0,0,0,0.3) | Implementar shadow |
| TXT-5 | P2 | font-search background `--vscode-input-background` (distinto do font-list bg) | Confirmar |
| TXT-6 | P2 | font-item active usa accent color no chevron (`var(--vscode-focusBorder)`) | Confirmar |

---

## 5) Background

### Cursor
```css
.css-fill-controls { display: flex; flex-direction: column; gap: 12px; }
.css-fill-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.css-gradient-type-button {
  background: transparent;
  border: 1px solid var(--cursor-stroke-tertiary);
  border-radius: 6px;
  padding: 3px 6px;
  font-size: 12px;
  gap: 6px;
  width: 100%;
}
.css-gradient-type-button:hover { background: var(--cursor-bg-quaternary); }
.css-gradient-type-label { flex: 1; text-align: left; }
```

### Diff list

| ID | Severity | Diff | Fix |
|---|---|---|---|
| BG-1 | **P0** | gradient-type-button border-radius 6px + padding `3px 6px` | Verificar nosso usa estes valores |
| BG-2 | **P0** | Hover usa `--cursor-bg-quaternary` (tom específico de hover de dropdown) | Adicionar token |
| BG-3 | P1 | fill-controls gap 12px (Cursor) vs nosso indefinido | Garantir 12px |
| BG-4 | P1 | fill-row gap 8px | Garantir |

---

## 6) Border (Stroke)

### Cursor (já tinha auditado parcialmente)
```css
.css-stroke-row { gap: 12px; align-items: center; display: flex; flex-wrap: wrap; }
.css-stroke-row-actions { display: flex; gap: 6px; }
.css-stroke-action {
  width: 26px;
  height: 26px;
  border-radius: 6px;  /* 6px! não 4 */
  border: 1px solid transparent;
  color: var(--cursor-text-secondary);
}
.css-stroke-action.active, .css-stroke-action:hover:not(:disabled) {
  background: transparent;  /* NÃO MUDA BG! */
  color: var(--vscode-foreground);  /* só muda cor */
}
.css-stroke-controls { display: flex; flex-direction: column; gap: 12px; }
.css-stroke-meta-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.css-stroke-field-label { color: var(--cursor-text-secondary); font-size: 11px; margin-bottom: 4px; }
.css-stroke-weight-input {
  display: flex;
  align-items: center;
  background: var(--cursor-bg-tertiary);
  border: 1px solid transparent;
  border-radius: 4px;
  gap: 6px;
  min-height: 24px;
  min-width: 100px;
  padding: 0 8px 0 4px;
}
.css-stroke-weight-input:focus-within { border-color: var(--vscode-focusBorder); }
.css-stroke-weight-drag {
  background: transparent;
  border: none;
  cursor: ew-resize;
  color: var(--cursor-icon-secondary);
}
.css-stroke-weight-drag:hover, .css-stroke-weight-drag[data-dragging="true"] {
  color: var(--vscode-foreground);
}
.css-stroke-weight-input .css-number-input {
  background: transparent;
  border: none;
  width: 24px;
  text-align: left;
}
.css-stroke-weight-input .css-input-suffix {
  position: static;  /* IMPORTANTE: dentro do weight-input, suffix é static não absolute */
  color: var(--cursor-text-secondary);
  font-size: 11px;
}
.css-stroke-side-button { display: flex; align-items: flex-end; margin-left: auto; }
.css-stroke-side-trigger-button {
  width: 26px; height: 26px; border-radius: 6px;
  margin-top: 18px;  /* aligned com input baseline */
}
.css-stroke-side-trigger-button:hover { background: var(--cursor-bg-secondary); color: var(--vscode-foreground); }
.css-stroke-side-trigger-button .codicon { font-size: 14px; }
```

### Diff list

| ID | Severity | Diff | Fix |
|---|---|---|---|
| BRD-1 | **P0** | stroke-action border-radius 6px (Cursor) — provavelmente nosso é 4 | Mudar pra 6px |
| BRD-2 | **P0** | stroke-action active **NÃO muda background**, só muda color pra foreground | Reescrever active style |
| BRD-3 | **P0** | stroke-action é **26×26** (não 24) | Mudar dimensão |
| BRD-4 | **P0** | stroke-weight-input é container distinto do input-group default — bg `--cursor-bg-tertiary`, height 24, padding `0 8px 0 4px`, gap 6px, min-width 100px | Criar estilo específico |
| BRD-5 | P1 | stroke-side-trigger-button tem `margin-top: 18px` pra alinhar com label "Weight" | Adicionar margin-top |
| BRD-6 | P1 | stroke-field-label tem `margin-bottom: 4px` + font-size 11px | Adicionar |
| BRD-7 | P2 | weight-input number-input é width 24px text-align left | Confirmar |
| BRD-8 | P2 | suffix dentro de weight-input é `position: static` não absolute | Override pra weight-input |

**Screenshot reference do user:** Border header + Solid dropdown + color row (swatch + hex + 100 + % + eye + minus) + label "Weight" embaixo. **Confirmado:** sem editor de gradient quando solid (que era o caso na screenshot).

---

## 7) Shadow & Blur

### Cursor
```css
.css-effects-body { display: flex; flex-direction: column; gap: 12px; }
.css-effects-list { display: flex; flex-direction: column; gap: 8px; }
.css-effect-entry {
  width: 100%;
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
}
.css-effects-empty {
  border: 1px dashed var(--vscode-widget-border);
  border-radius: 6px;
  color: var(--cursor-text-secondary);
  font-size: 12px;
  justify-content: space-between;
  padding: 10px;
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
}
.css-effects-icon-button {
  width: 24px; height: 24px; border-radius: 6px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--cursor-icon-secondary);
}
.css-effects-icon-button:hover { background: var(--cursor-bg-secondary); }
.css-effects-icon-drop-shadow > .codicon {
  border-radius: 2px;
  box-shadow: 0 2px 0 0 var(--cursor-bg-primary);  /* visual de drop shadow no ícone! */
}
.css-effects-type-select-wrapper { display: flex; flex: 1; min-width: 0; }
.css-effects-type-select-container {
  display: flex; align-items: center;
  background: var(--vscode-input-background);
  border: 1px solid var(--cursor-stroke-tertiary);
  border-radius: 6px;
  height: 24px;
  width: 100%;
}
.css-effects-type-select {
  background: transparent;
  border: none !important;
  font-size: 12px;
  padding: 0 32px 0 10px;
  height: 100%;
}
.css-effects-type-select-adornment {
  position: absolute;
  right: 0; top: 0; bottom: 0;
  width: 28px;
  cursor: pointer;
  color: var(--cursor-text-secondary);
}
.css-effects-row-actions { display: flex; gap: 6px; }
.css-effects-controls { display: flex; flex-direction: column; gap: 10px; }
.css-effects-parameters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}
.css-effects-color-row { display: flex; flex-direction: column; gap: 8px; }
```

### Nosso (vou olhar)
Tenho versão própria que difere bastante. Vou comparar nas action items.

### Diff list

| ID | Severity | Diff | Fix |
|---|---|---|---|
| SHA-1 | **P0** | Empty state Cursor é `1px dashed border + padding 10px + flex` (no nosso é background hover) | Reescrever empty state |
| SHA-2 | **P0** | effects-icon-button 24×24 border-radius 6px (verificar nosso) | Confirmar |
| SHA-3 | **P0** | type-select-container tem altura **24px** com border + bg input — não é só transparent | Mudar nossa implementação |
| SHA-4 | **P0** | adornment do select é position:absolute right (chevron à direita) | Posicionar absolute right |
| SHA-5 | P1 | `.css-effects-icon-drop-shadow > .codicon` tem efeito visual de drop-shadow no próprio ícone (`box-shadow: 0 2px 0 0`) — DETALHE BACANA do Cursor | Adicionar |
| SHA-6 | P1 | effects-parameters é grid auto-fit minmax 140px (responsivo) | Não 1fr 1fr |
| SHA-7 | P2 | effects-color-row é flex-direction COLUMN (não row) | Mudar |
| SHA-8 | P2 | row-actions gap 6px | Confirmar |

---

## 8) React Components (Properties + Children)

### Cursor (38 rules — só vou listar o essencial)

```css
.css-react-section { /* mesmo que css-inspector-section */ }
/* Cursor tem 38 rules específicas pra React — propriedades de tipo, syntax highlighting, etc */
```

(Não vou auditar agora pq é caso especial — só aparece quando React Fiber detectado.)

---

## CONSOLIDATED ACTION ITEMS (priorizados)

### 🔴 P0 — Fixes que aplicar PRIMEIRO (visíveis imediatamente)

#### Globais (afeta TUDO)
1. **SH-1**: Section title — remover uppercase + letter-spacing, mudar pra 12px, color `var(--fg-default)`
2. **SH-2**: Section body gap 6px → 12px
3. **LAY-1**: `.css-input-group` height 28px → 24px
4. **LAY-2**: `.css-input-group` padding `0 6px` → `2px 6px 2px 4px`
5. **LAY-3**: Adicionar tokens `--bg-input` (mais escuro que elevated) + `--bg-hover-dropdown`
6. **LAY-4**: `.css-control-label` — remover uppercase + monospace + letter-spacing. Color `--cursor-text-secondary` equivalent. Font-size 10px font-weight 500.

#### Position
7. **POS-1**: Pin button active = só cor link, NÃO bg accent

#### Border
8. **BRD-1**: stroke-action border-radius 6px (não 4)
9. **BRD-2**: stroke-action active SÓ muda color (sem bg accent)
10. **BRD-3**: stroke-action 26×26 (não 24)
11. **BRD-4**: Criar `.css-stroke-weight-input` separado do `.css-input-group` default

#### Background
12. **BG-1**: gradient-type-button border-radius 6px + padding 3px 6px
13. **BG-2**: hover usa `--cursor-bg-quaternary`

#### Appearance
14. **APP-1**: Adicionar `.css-corner-preview` (16×16 box visual de cada canto)

#### Text
15. **TXT-1**: typography-body gap 12px (não 6)

#### Shadow & Blur
16. **SHA-1**: Empty state com border dashed + padding 10px
17. **SHA-2**: type-select-container com bg input + border + height 24
18. **SHA-3**: adornment chevron absolute right

### 🟡 P1 — Fixes visíveis com olhar atento (batch separado)

- **SH-3, SH-4**: section-actions gap 6px, section-header-actions gap 0
- **LAY-5, LAY-6, LAY-7**: mode toggle buttons 26×26 + active só cor + hover tertiary bg
- **APP-2**: Corner toggle active só cor
- **TXT-2 a TXT-4**: typography-field gap, font-dropdown border + padding, font-menu shadow
- **BG-3, BG-4**: fill-controls gap 12px, fill-row gap 8px
- **BRD-5, BRD-6**: stroke-side-trigger margin-top 18px, stroke-field-label margin-bottom 4px
- **SHA-5 a SHA-6**: drop-shadow icon effect, effects-parameters auto-fit grid

### 🟢 P2 — Backlog (sutil)

- SH-5: section header margin-bottom 0
- POS-2: disabled opacity
- APP-3: confirm grid gap 8px
- TXT-5, TXT-6: font-search bg, font-item active chevron color
- BRD-7, BRD-8: weight-input number width + suffix position static
- SHA-7, SHA-8: effects-color-row direction column, row-actions gap

---

## Estimativa de impacto

- **P0** (~18 items): ~2h pra aplicar — diff visual notável após
- **P1** (~12 items): ~1.5h pra aplicar — refinamento
- **P2** (~10 items): ~1h pra aplicar — polish final

**Total: ~4-5h** de aplicação pra alcançar fidelidade visual ~95% com Cursor.

## Próximos passos sugeridos

1. Aplicar P0 globais (Section Header + Input Group + Control Label) — destrava o resto
2. Aplicar P0 por section
3. Build + screenshot comparison
4. Iterar P1 em batch separado
5. P2 só após confirmar visualmente que P0+P1 está colando
