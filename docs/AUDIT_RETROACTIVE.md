# AUDIT RETROACTIVE — UNDRCode vs Cursor (CSS Inspector)

Bundle Cursor: `C:/Users/taked/AppData/Local/Programs/cursor/resources/app/out/vs/workbench/workbench.desktop.main.js`
Nosso código: `C:\Users\taked\Desktop\akai-code\src\renderer\components\PreviewView\PreviewView.tsx`
Data: 2026-05-19

---

## SEÇÃO 1 — Position (PositionSection @ L2024)

**GATE 0 (visual)**: Cursor template `efw` tem: 1 header button (pin/toggle absolute) + 3 inputs X/Y/Z + 1 rotation input + 3 rotation buttons (rotate90 + flipH + flipV) = **8 elementos**. Nosso: 8. ✅

**GATE 1 (template)**: Classes batem (`css-rotation-row`, `css-rotation-inputs`, `css-rotation-actions`). ✅

**GATE 2 (handlers/derives)**:
- Cursor `positionXValue`/`positionYValue` vem de getter exposto pelo store (computed CSS `left`/`top` ?? rect). Nosso usa `parsePx(allStyles['left']) ?? rect.x`. ✅
- Cursor `onPositionChange` faz `if (!l() ...) return` (early-return se NÃO absolute). Nosso replica. ✅
- Cursor `onRotateQuarterTurn` NÃO existe explicitamente no XG0 — só chama `n.onRotateQuarterTurn()` (delegado ao store).

**GATE 3 (conditionals)**:
- Cursor: X/Y/Z ficam disabled (`disabled=true`) e classe `css-position-disabled` quando NÃO absolute. ✅
- Cursor: Rotation row é SEMPRE editável (não depende de absolute). ✅
- Cursor: tooltip dinâmico no toggle pin: `"Enable absolute positioning" ↔ "Disable absolute positioning"`. ✅

### DIFFs encontrados (ordenado por severidade):
1. **[BUG]** L2105 `onZIndexChange` faz `if (value.trim() === '')` → aplica `'auto'`. Cursor não tem esse fallback, só faz parseFloat e chama `f(rt)`. Nada crítico mas diverge.
2. **[VISUAL]** L2168 ícone do absolute-toggle é `codicon-pin`. Cursor usa `lt.absolutePosition` (codicon proprietário). Trade-off documentado.
3. **[VISUAL]** L2257 botão rotate usa `codicon-debug-step-over` (Cursor `lt.rotate`). L2266 flipH = `codicon-arrow-swap` (Cursor `lt.flipHorizontal`). L2275 flipV = `codicon-arrow-both` (Cursor `lt.flipVertical`). Aproximações OK.
4. **[BUG]** `onPositionChange` L2091: `value === ''` → aplica `prop, ''` (clear). Cursor não faz isso — só faz `n.onPositionChange(prop, value)`. O store deve lidar. Não é bug grave.

### Quick wins (fixes de 5min)
- Remover early-return em `onZIndexChange` pro empty string (não bate com Cursor).
- Mudar `codicon-debug-step-over` por `codicon-refresh` (mais próximo de "rotate") OU usar SVG inline custom.

### Refactors profundos (>15min)
- Implementar `Mmw` (flip helper) idêntico ao Cursor: Cursor extrai matrix decomposition em vez de regex match. Nosso está OK pra cases simples.

---

## SEÇÃO 2 — Layout Flow (LayoutFlowButtons @ L3295)

**GATE 0 (visual)**: Cursor array `hpw` tem **4 modes**: wrap, column, row, grid (nessa ordem). Nosso: 4 na MESMA ordem (wrap/column/row/grid). ✅

**GATE 1 (template)**: Cursor renderiza cada botão via `$pw` (não extraído mas é `<button class="css-flow-button">` no Jpw → `css-flow-grid`). Nosso usa `className="preview-flow-buttons"` + `preview-flow-btn`. **DIFFERS** — não usa classes `css-flow-*`.

**GATE 2 (handlers)**:
- Cursor `Ca` (onLayoutModeChange) está no store — não no JS extraído (XG0/YG0). Mas no YG0 vemos só `n.onLayoutModeChange(aa.mode)` e o store é quem aplica CSS. Nosso `setMode` aplica `display/flex-direction/flex-wrap` direto. ⚠️ **OK funcionalmente** mas duplicação se store tiver lógica extra.
- Cursor ícones vêm de `aa.codicon` (Fn.asClassName(aa.codicon)). Nosso usa SVG inline custom. **DIFFERS** visualmente mas é trade-off documentado.

**GATE 3 (conditionals)**:
- Cursor tooltip via `mouseenter` (showHover/hideHover) custom. Nosso usa `title=`. ⚠️ Comportamento OK, visual de tooltip diferente.
- Cursor: button ativa via `classList.toggle("active", ...)` quando `n.layoutMode() === aa.mode`. Nosso: `is-active`. **CLASSE DIFERENTE** — Cursor usa `active`, nosso usa `is-active`.

### DIFFs encontrados:
1. **[VISUAL]** Classes wrappers divergem: `preview-flow-buttons`/`preview-flow-btn` em vez de `css-flow-grid`/`css-flow-button` (não extraído mas implícito no template Jpw). Quebra naming convention do protocolo.
2. **[VISUAL]** Classe ativa é `is-active` (nosso) vs `active` (Cursor). Não bate com convenção do Cursor.
3. **[VISUAL]** Ícones são SVGs inline. Cursor usa codicons proprietários (`lt.freeform`, `lt.flowCol`, `lt.flowRow`, `lt.layoutGrid`). OK como trade-off mas SVGs ficam "fora do design system".
4. **[MISSING FEATURE]** Sem tooltip-on-hover compacto estilo Cursor (`showHover`). Só usa `title=` HTML padrão.

### Quick wins (fixes de 5min)
- Renomear `preview-flow-buttons` → `css-flow-grid` e `preview-flow-btn` → `css-flow-button`.
- Renomear classe `is-active` → `active`.

### Refactors profundos (>15min)
- Migrar SVGs inline pra codicons aproximados (`codicon-layout`, `codicon-three-bars`, etc).
- Implementar tooltip hover custom igual `showHover` do Cursor (compact appearance).

---

## SEÇÃO 3 — Layout FlexExtras (FlexExtras @ L2968)

**GATE 0 (visual)**: Cursor template `Tpw` tem: 9-cell alignment grid + 1 gap input. Nosso: 9-cell + 1 gap input. ✅

**GATE 1 (template)**: Cursor classes: `css-alignment-gap-row`, `css-alignment-control`, `css-control-label`, `css-alignment-grid`, `css-gap-control`, `css-input-group`, `css-input-label-draggable css-gap-label-icon`. Nosso bate (`css-alignment-grid-row` adicional não existe no Cursor — Cursor renderiza 9 cells flat dentro de `css-alignment-grid`, usa CSS grid pra layout 3x3).

### DIFFs encontrados:
1. **[BUG/VISUAL]** L3014-3035: Nosso encapsula cada row em `<div className="css-alignment-grid-row">`. Cursor renderiza os 9 botões DIRETOS dentro de `css-alignment-grid` (sem wrappers de row). Vai dar layout errado se CSS depender disso.
2. **[BUG]** L2993 `onCellClick(col, row)` aplica `justify-content: JUSTIFY[row]` e `align-items: ALIGN[col]`. Cursor handler `R(ie, te)` (jG0 L18) é mais complexo: tem branch `v()` (isAutoGap = space-between) que altera mapping. **Quando gap=auto**, Cursor só aplica `align-items` (não toca `justify-content`). Nosso ignora isso → reseta auto-gap involuntariamente.
3. **[MISSING FEATURE]** Cursor jG0 tem **hover state** com setters `i/s/a` (hovered cell guess preview) — mostra ícone "preview" quando passa mouse antes de clicar. Nosso só mostra dot vs ícone, sem hover preview.
4. **[MISSING FEATURE]** Cursor jG0 tem branch column: quando `flexDirection === 'column'` E não-auto, swap dos índices row↔col para apply. Vide `O3n[ie]` vs `O3n[te]`. Nosso só faz `flat mapping` (row → justify, col → align). Pode dar layout invertido em column flex.
5. **[BUG]** L3062: Gap input quando recebe `auto` aplica `gap: 0px` E `justify-content: space-between`. Cursor (jG0 L25 `z()`) NÃO aplica `gap: 0px` — só `gap: "auto"` (que CSS-wise é mesmo que `gap: normal`/computed 0). E aplica `justify-content: space-between`. **Resultado idêntico mas escrita diferente** — bugzinho se user inspecionar inline style.
6. **[MISSING FEATURE]** Cursor `aria-label` por cell: `"justify-content: X, align-items: Y"` OU (autoGap) `"align-items: X"`. Nosso só faz formato single (`justify-content: ${X}, align-items: ${Y}`).
7. **[MISSING FEATURE]** Cursor exibe `data-space-between="true"` no `css-alignment-grid` quando auto-gap. Nosso não.

### Quick wins (fixes de 5min)
- Remover `<div className="css-alignment-grid-row">` wrappers — flat 9 botões direto.
- Adicionar `data-space-between` no grid quando `isAutoGap`.
- Mudar título do gap input pra `"Gap (auto = space-between)"` quando autoGap.

### Refactors profundos (>15min)
- Implementar handler `R(col, row)` com branches `isAutoGap` (só align) e `isColumn` (swap eixos). Provavelmente é a causa de bugs reportados no grid de alinhamento em column flex.
- Implementar hover-preview de ícone (state `hoverCell` que mostra ícone proposto antes do click).

---

## SEÇÃO 4 — Layout GridExtras (GridExtras @ L3085)

**GATE 0 (visual)**: Cursor template `Apw` tem: trigger button "C × R" + 2 inputs gap (column-gap + row-gap). Picker menu (xpw) tem: header com 2 inputs C/R + cells grid. Nosso: trigger + 2 gap inputs + picker menu. ✅

**GATE 1 (template)**:
- Cursor `Apw`: classes `css-alignment-gap-row`, `css-alignment-control`, `css-grid-dimensions-trigger`, `css-grid-dimensions-label`, `css-gap-control`, `css-grid-gap-inputs`, `css-input-group`, `css-input-label-draggable css-gap-label-icon` (e `--row` no row gap). Nosso bate em quase tudo. ✅
- L3130 `css-grid-picker-trigger-wrap` — Cursor NÃO tem essa classe. Wrapper extra inventado.

**GATE 2 (handlers)**:
- Cursor `S(F, U)` aplica grid via store `n.onGridColumnsChange(F)` + `n.onGridRowsChange(U)`. Nosso `setGrid(cols, rows)` aplica `grid-template-columns/rows: repeat(N, 1fr)`. **HUGE DIFF**: Cursor delega ao store que provavelmente preserva tracks existentes (e.g., `1fr 200px 1fr` → mantém quando muda só count). Nosso SOBRESCREVE pra `repeat(N, 1fr)` SEMPRE — destrói custom tracks.
- Cursor `Xpw=11, Zpw=8` (11 cols × 8 rows no picker). Nosso `MAX_C=11, MAX_R=8`. ✅

**GATE 3 (conditionals)**:
- Cursor menu: hover sobre cell mostra "ghost selection" via `o()` state. Cursor desenha label numérico `${col}, ${row}` flutuante em cima da cell hovered (`Ipw`). Nosso: só atualiza inputs C/R com hoverPos, NÃO mostra label flutuante. **MISSING**.
- Cursor: ao mouseleave do cells container, limpa `o()`. Nosso faz isso bem.

### DIFFs encontrados:
1. **[BUG MAJOR]** L3116-3117: Sempre escreve `repeat(N, 1fr)`, **destruindo** tracks customizadas. Cursor delega ao store que preserva.
2. **[MISSING FEATURE]** Sem label flutuante `col, row` no hover sobre cells do picker.
3. **[VISUAL]** L3130 wrapper `css-grid-picker-trigger-wrap` é inventado — Cursor não usa.
4. **[VISUAL]** Picker menu posicionado via `position:absolute` no nosso. Cursor usa `hpe` (popover component) com anchor "top-left", portal mount, marginToOverflowRoot. Comportamento ≠ em modais/scroll.
5. **[MISSING FEATURE]** Cursor expõe `aria-expanded` no trigger button. Nosso só tem `aria-haspopup="menu"` sem `aria-expanded`.

### Quick wins (fixes de 5min)
- Adicionar `aria-expanded={menuOpen}` no trigger.
- Remover wrapper `css-grid-picker-trigger-wrap`.

### Refactors profundos (>15min)
- Preservar tracks customizadas: ler valor atual de `grid-template-columns`, fazer manipulação smart (adicionar 1fr no fim quando aumenta, remover último quando diminui).
- Implementar label flutuante `col, row` durante hover no picker (`Ipw` template).
- Migrar menu pra um popover component (igual `hpe`) com portal + overflow handling.

---

## SEÇÃO 5 — Dimensions (DimensionInput @ L4413)

**GATE 0 (visual)**: Cursor template `Rpw`: 1 label W/H + 1 input + 1 dropdown button. Nosso: 1 ScrubLabel + 1 input + 1 button trigger. ✅

**GATE 1 (template)**:
- Cursor: `<div class=css-input-group>` (não `css-dimension-group`). Nosso L4473 adiciona `css-dimension-group` extra — não é canon do Cursor template.
- Cursor: `<div class="css-input-field css-input-field--with-dropdown">`. Nosso L4481: só `css-input-field`. **MISSING modifier class**.
- Cursor: `<span class=css-input-suffix>px</span>` STATIC. Nosso esconde "px" e usa label custom (`fit/fill/px`) no dropdown button. **DIFFERS** — Cursor sempre mostra "px" mas usa `data-hidden` em outros lugares pra esconder.
- Cursor: `<button type=button class=css-input-dropdown>` (com classe `css-input-dropdown`). Nosso usa `css-dimension-mode-toggle`. **CLASSE DIFERENTE**.

**GATE 2 (handlers)**:
- Cursor `dr` (L154 do YG0): button click handler `ts` faz `Vr.setPosition({x: rect.left/right, y: rect.bottom+4})` baseado em dimension (W=left, H=right). E usa `hpe` popover component com anchor "top-left" pra W e "top-right" pra H. Nosso usa div absolute + click outside. **DIFFERS**.
- Cursor: quando mode é `fit`/`fill`, input vira `readOnly` (não `disabled`) e `type=text`. Nosso usa `disabled={mode !== 'fixed'}`. **DIFFERS** — disabled bloqueia foco; readOnly permite mas não edita. Cursor permite blur+focus ainda.
- Cursor: `data-dimension-mode` attr no `css-input-field--with-dropdown`. Nosso não tem.

**GATE 3 (conditionals)**:
- Cursor: `data-hidden="true"` no suffix quando mode != fixed (esconde "px" via CSS). Nosso remove conditional `displayInput` (mostra "Fit"/"Fill" no input em vez de suffix).
- Cursor: dropdown menu (`hpe`) tem **width=180**. Nosso: hardcoded CSS.
- Cursor: anchor `top-left` pra W e `top-right` pra H — diferença posicional. Nosso usa `position:absolute` simples.

### DIFFs encontrados:
1. **[BUG]** L4488 `disabled={mode !== 'fixed'}` deve ser `readOnly={mode !== 'fixed'}` (Cursor).
2. **[VISUAL MAJOR]** Classe button: `css-dimension-mode-toggle` em vez de `css-input-dropdown` (não bate com Cursor).
3. **[VISUAL]** Falta classe `css-input-field--with-dropdown` no field.
4. **[VISUAL]** Falta classe `css-dimension-group` foi inventada (não existe no Cursor).
5. **[MISSING FEATURE]** Sem `data-dimension-mode` attr no field.
6. **[VISUAL]** Suffix "px" não aparece — Cursor sempre renderiza só esconde via `data-hidden`.
7. **[BUG]** Anchor é igual pra W e H. Cursor usa "top-left" pra W e "top-right" pra H — menu abre lados diferentes.
8. **[VISUAL]** Width menu hardcoded vs Cursor explícito 180px.

### Quick wins (fixes de 5min)
- Trocar `disabled` por `readOnly` no input.
- Renomear classe button → `css-input-dropdown`.
- Adicionar `css-input-field--with-dropdown` no field wrapper.
- Adicionar `data-dimension-mode={mode}` no field.

### Refactors profundos (>15min)
- Migrar menu absolute → popover component com anchor configurável (top-left vs top-right por dimension).
- Aplicar `data-hidden` no suffix em vez de remover.

---

## SEÇÃO 6 — Padding (PaddingEditor @ L3488)

**GATE 0 (visual)**: Cursor: 2-input mode = 2 inputs (vertical/horizontal). 4-input mode = 4 inputs (top/right/bottom/left, ordem array `Hpw`). Header = label + toggle button. Nosso: idem. ✅

**GATE 1 (template)**:
- Cursor `_4p` (single input): `<div class=css-input-group><label class="css-input-label-draggable css-padding-label-icon">`. Nosso L3542/L3576: `<div className="css-input-group">` SEM modifier `css-padding-label-icon` no label. **MISSING class**.
- Cursor `Gpw`: `<div class=css-padding-axis-row>`. Nosso L3569: `css-padding-axis-row`. ✅
- Cursor `Upw`: `<div class=css-padding-grid>`. Nosso L3537: `css-padding-grid`. ✅
- Cursor 2-input: input é `type=number min=0`. Nosso L3554/3586: `type=text inputMode=numeric`. **DIFFERS** mas funcionalmente equivalente.

**GATE 2 (handlers)**:
- Cursor `wi` (vertical/horizontal): aplica via store `n.onLinkedPaddingChange(axis, val)`. Aria-label dinâmico: `"Padding top and bottom"` ou `"Padding left and right"`. Nosso `applyVertical/Horizontal`. ✅
- Cursor `Fi` (per-side): aplica via `n.onPaddingChange(side, val)`. Title sempre `"Padding ${side}"`. Nosso: idem.
- Cursor: ScrubLabel `getValue` = `Math.round(paddingTopValue())` (sempre top no vertical). Nosso usa `t`. ✅
- Cursor: `data-mismatch="true"` no `css-input-group` quando `Ln(axis)` (top !== bottom OU left !== right). Nosso L3573 idem. ✅
- Cursor: title dinâmico no axis com formato `"Padding top ${X}px · bottom ${Y}px"`. Nosso L3574 mostra mensagem PT-BR "mismatch — clique pra editar separado". **DIFFERS** — fica PT-BR.

**GATE 3 (conditionals)**:
- Cursor toggle button: classes `css-padding-mode-toggle` + `active` quando expanded. Ícone `lt.padAll` SEMPRE (não muda no toggle). Nosso L3528: `css-edit-sides-toggle` + `is-active`. Ícone alterna `symbol-array` ↔ `symbol-namespace`. **DIFFERS** em classe E ícone.

### DIFFs encontrados:
1. **[VISUAL]** L3528 classe `css-edit-sides-toggle` em vez de `css-padding-mode-toggle`.
2. **[VISUAL]** Classe ativa `is-active` em vez de `active` (Cursor).
3. **[VISUAL]** L3533 ícone alterna 2 codicons (`symbol-array`/`symbol-namespace`). Cursor mantém UM ícone (`lt.padAll`) e marca via classe `active`.
4. **[VISUAL]** L3549/3582/3610 falta classe `css-padding-label-icon` no label.
5. **[VISUAL]** L3554/3586/3613 input é `type=text inputMode=numeric` em vez de `type=number min=0`.
6. **[BUG]** L3574 mensagem em PT-BR ("clique pra editar separado") em vez do formato Cursor `"Padding top ${X}px · bottom ${Y}px"`. Vai vazar PT pra UI inglesa.
7. **[VISUAL]** Ícones nas per-side: arrow-up/right/down/left. Cursor usa `lt.padTop/padRight/padBottom/padLeft` (codicons proprietários).
8. **[VISUAL]** No 2-input vertical, nosso L3582 usa `arrow-both rotate(90deg)`. Cursor usa `lt.padVertical` direto.

### Quick wins (fixes de 5min)
- Renomear classe `css-edit-sides-toggle` → `css-padding-mode-toggle`.
- Trocar `is-active` → `active`.
- Fixar ícone único (`codicon-symbol-namespace` ou similar pra padAll) e usar só classe.
- Adicionar `css-padding-label-icon` no label.
- Reescrever title pro formato inglês: `Padding top ${X}px · bottom ${Y}px`.

### Refactors profundos (>15min)
- Migrar input `text` → `type=number min=0` (mas perder `inputmode=numeric`? não, `<input type=number>` já tem teclado numérico no mobile).

---

## SEÇÃO 7 — Margin (MarginEditor @ L3950)

**GATE 0 (visual)**: Cursor template Cursor S4p (single input) idêntico em estrutura ao `_4p` do padding mas com classe `css-margin-label-icon`. Wrappers `Wpw` (axis row) e `qpw` (grid) usam `css-margin-axis-row` / `css-margin-grid`. **8 elementos no 4-input mode**, **4 no 2-input**. Nosso bate em count.

**GATE 1 (template)**:
- Cursor `S4p` input: `<input type=text inputmode=numeric>`. Nosso L4034: idem. ✅
- Cursor: wrapper axis `Wpw=css-margin-axis-row`. Nosso L4046: usa `css-padding-axis-row` (REUTILIZADO do padding). **WRONG CLASS** — Cursor distingue padding/margin via classe wrapper diferente.
- Cursor: wrapper grid `qpw=css-margin-grid`. Nosso L4017: `css-padding-grid`. **WRONG CLASS** — idem.
- Cursor: label classe `css-margin-label-icon`. Nosso L4029: nada. **MISSING**.

**GATE 2 (handlers)**:
- Cursor `ni` (linked): `value.trim().toLowerCase() === "auto"` → onLinkedMarginChange(axis, "auto"). Senão `parseFloat`, aplica `Math.round(n).toString()`. Senão revert. Nosso `applyVertical/Horizontal` L3975: idem. ✅
- Cursor `wr/sr`: handler per-side similar. `Ii(side)`: `value.trim().toLowerCase() === "auto"` → `onMarginChange(side, "auto")`. Senão parseFloat. Nosso `applyPerSide` L3995: idem. ✅
- Cursor: classe `css-number-input--mode-token` quando `si(axis)` (auto). Nosso L4066: `tAuto && bAuto`. ✅ semanticamente.
- Cursor: `data-hidden="true"` no suffix quando auto (esconde "px"). Nosso L4070: `!(tAuto && bAuto) && <span>`. ✅

**GATE 3 (conditionals)**:
- Cursor: tooltip dinâmico `"Margin top ${X} · bottom ${Y}"` quando mismatch. Nosso L4052: usa `formatVal(t, tAuto)` que gera `"auto"` ou `"${Math.round(n)}px"`. ✅ ENGLISH formato bate.
- Cursor toggle: classe `css-margin-mode-toggle` + `active`. Nosso L4009: `css-edit-sides-toggle` + `is-active`. **DIFFERS** (mesmo bug do padding).
- Cursor: per-side button quando expanded. **NÃO tem** branch que esconde "px" suffix per-side quando individual auto. Cursor S4p sempre tem `<span class=css-input-suffix>px</span>` STATIC, e usa `data-hidden` pra esconder. Nosso L4039 esconde por conditional render. **DIFFERS** mas funcionalmente equivalente.

### DIFFs encontrados:
1. **[BUG/VISUAL]** L4017/L4046 usa `css-padding-grid`/`css-padding-axis-row` em vez de `css-margin-grid`/`css-margin-axis-row`. Causa de bugs futuros se CSS depender de diferenciação.
2. **[VISUAL]** L4023/L4055/L4081 falta classe `css-margin-label-icon` no label.
3. **[VISUAL]** L4009 classe `css-edit-sides-toggle` em vez de `css-margin-mode-toggle`.
4. **[VISUAL]** L4013 ícone alterna `symbol-array`/`symbol-namespace`. Cursor mantém único.
5. **[VISUAL]** L4046 wrapper `css-padding-controls` em vez de `css-margin-controls` (L4004). Idem.

### Quick wins (fixes de 5min)
- Renomear todas classes `padding-*` no MarginEditor pra `margin-*`.
- Adicionar `css-margin-label-icon` nos labels.
- Renomear `css-edit-sides-toggle` → `css-margin-mode-toggle` no margin.

### Refactors profundos (>15min)
- Já está OK. Maior dor é o code-duplication entre PaddingEditor/MarginEditor (poderiam compartilhar componente base com `propPrefix` + `acceptAuto` flag).

---

## SEÇÃO 8 — Clip content + Border box (ClipContentCheckbox/BorderBoxCheckbox @ L4255/L4278)

**GATE 0 (visual)**: Cursor template Jpw inclui inline: `<div class=css-toggle-row><label class=css-toggle><span>Clip content</span></label></div>` (clip) e `<div class=css-padding-box-sizing><label class=css-toggle><span>Border box></span></label></div>`. Cursor renderiza `dpe` (toggle switch component) dentro. **2 elementos cada** (label + switch). Nosso usa `CursorToggleRow` que renderiza 1 button com span dentro. Estrutura ≠ mas count = 2.

**GATE 1 (template)**:
- Cursor: `<div class=css-toggle-row>` → `<label class=css-toggle>` → `<span>Clip content</span>` + componente `dpe`. Nosso L4230: `<div class=wrapperClass>` → `<button role=switch>` (não `<label>`!) → `<span>` + `<span class=css-switch>`. **DIFFERS** — Cursor usa `<label>` (que tem semântica de form), nosso usa `<button role=switch>`.

**GATE 2 (handlers)**:
- Cursor: `n.onClipContentToggle(!n.isClipContentEnabled())` no click → store aplica `overflow: hidden ↔ visible`. Cursor derive `Gy`: `qn("overflow").trim().toLowerCase() === "hidden"`. Nosso L4262: `value === 'hidden' || value === 'clip'` (sem trim/lowercase). **DIFFERS** — Cursor SÓ `hidden`. `'clip'` é extensão nossa.
- Cursor: `n.onBoxSizingToggle(!n.isBorderBoxSizing())` → `ni("box-sizing", mr ? "border-box" : "content-box")`. Derive `$y`: `qn("box-sizing").trim().toLowerCase() === "border-box"`. Nosso L4287: `(value || '').trim().toLowerCase() === 'border-box'`. ✅

**GATE 3 (conditionals)**:
- Cursor: foco no switch via `ref` (`Ze?.focus()` após toggle). Nosso L4237: só click no botão. **MISSING** — explicit focus.
- Cursor: toggle component `dpe` renderiza thumb com animação. Nosso renderiza `css-switch-thumb` similar. ✅

### DIFFs encontrados:
1. **[BUG]** L4262 derive aceita `value === 'clip'` como toggle. Cursor SÓ `'hidden'`. Vai marcar clip como hidden incorretamente. Remover branch `'clip'`.
2. **[BUG]** Sem `.trim().toLowerCase()` no derive do Clip content. Cursor faz isso (`Gy`). Pode falhar em case-mismatch ou whitespace.
3. **[VISUAL]** Estrutura HTML: `<button role=switch>` em vez de `<label>` + componente switch interno. Acessibilidade diferente.
4. **[MISSING FEATURE]** `Ze?.focus()` após toggle (acessibilidade — caret volta pro switch após click no label/row).
5. **[VISUAL]** L4226 wrapper class é param (`'css-toggle-row' | 'css-padding-box-sizing'`). Cursor template hardcoded — OK semanticamente.

### Quick wins (fixes de 5min)
- L4262: trocar `value === 'hidden' || value === 'clip'` por `(value || '').trim().toLowerCase() === 'hidden'`.
- L4234: adicionar `ref` pro switch e chamar `.focus()` após `onChange`.

### Refactors profundos (>15min)
- Considerar usar `<label>` HTML nativo com input checkbox hidden + visual switch (igual Cursor `dpe`). Melhora form semantics e a11y.

---

## SEÇÃO 9 — Appearance (AppearanceSection @ L3736)

**GATE 0 (visual)**: Cursor template `Vmw`: header com title + **2 botões header** (theme picker + visibility toggle). Body = `css-appearance-grid` com 2 blocks (Opacity + Corner Radius). Corner Radius tem 1 input + 1 toggle button (edit corners). Quando expanded: 4 inputs corner. **Total 7 elementos no compact mode, 11 no expanded**. Nosso: ✅ batey count (2 header + 1 opacity + 1 radius + 1 toggle + (4 expanded)).

**GATE 1 (template)**:
- Cursor: `<div class=css-section-header-actions>`. Nosso L3789: ✅.
- Cursor: `<button aria-label="Change theme" aria-haspopup=menu>`. Nosso usa `<ThemePickerButton>` component. ✅ semanticamente.
- Cursor: Opacity input `type=number min=0 max=100`. Nosso L3827: ✅.
- Cursor: Corner radius input `class=css-number-input min=0 inputmode=numeric` (sem `type=` explicit — Solid puxa do `Ls(nt,"type",zt)` que alterna entre `text` e `number`). Nosso L3863: alterna ✅.
- Cursor: `<span class=css-input-suffix title="Drag to adjust opacity" aria-label="Drag to adjust opacity">%</span>`. Nosso L3842: ✅.
- Cursor: `<button class=css-corner-toggle-button aria-label="Edit corners">`. Nosso L3883: ✅.

**GATE 2 (handlers)**:
- Cursor `U(W)`: `t.browserViewStore.getView(viewId)?.emulateColorScheme(W).catch(...)`. **Usa Electron BrowserView.emulateColorScheme API** pra mudar dark mode no webview. Nosso `ThemePickerButton` L3656: usa `executeJavaScript` pra adicionar classe `dark` no `<body>`. **DIFFERS MAJOR** — Cursor usa API CDP nativa, nosso só hack via class. Pode não pegar `@media (prefers-color-scheme)` queries.
- Cursor `R()` (toggle corners): `u(W => !W)`. Nosso L3887: idem.
- Cursor `L()` (visibility tooltip dinâmico): `n.isElementVisible() ? "Hide element" : "Show element"`. Nosso L3796: ✅.
- Cursor opacity onChange: aplica `n.onOpacityChange(value)` que recebe **string já tratada** (0-100 from input). Internal converte pra 0-1. Nosso L3815: aplica direto `${clamped / 100}`. ✅
- Cursor: `nt.addEventListener("focus", tt => { n.isCornerRadiusMixed() && tt.currentTarget.select() })`. Nosso L3868: ✅.

**GATE 3 (conditionals)**:
- Cursor: input type alterna `text` (mixed) vs `number` (uniform). Nosso L3863: ✅.
- Cursor: classe `css-number-input--mode-token` quando mixed. Nosso L3865: ✅.
- Cursor: 4 corner inputs em ordem `Kmw=["topLeft","topRight","bottomRight","bottomLeft"]`. Nosso L3894: ✅ (mesma ordem).
- Cursor: ícones por corner `Qmw={...}` (não extraído explicitamente — assumi codicons proprietários). Nosso L3895 usa `arrow-small-left/right/down/up`. **DIVERGE** em ícone mas semanticamente OK.
- Cursor: `data-active="true"` no corner toggle button quando expanded. Nosso L3883: usa classe `is-active`. **DIFFERS** — Cursor usa data-attr, nosso classe.

### DIFFs encontrados:
1. **[BUG MAJOR]** L3656 ThemePickerButton usa `executeJavaScript` pra add classe `dark`. Cursor usa **`browserViewStore.getView(viewId).emulateColorScheme()`** — API CDP nativa que dispara `prefers-color-scheme` corretamente. Nossa abordagem não funciona em sites que usam CSS `@media (prefers-color-scheme: dark)`.
2. **[VISUAL]** L3823 ícone opacity = `codicon-symbol-color`. Cursor usa `lt.opacity`. Aproximação OK.
3. **[VISUAL]** L3858 ícone corner = `codicon-symbol-misc`. Cursor usa `lt.corners`. OK.
4. **[VISUAL]** L3886 toggle button usa `is-active` classe. Cursor usa `data-active="true"` attr. **DIFFERS** convenção.
5. **[VISUAL]** L3889 ícone do toggle de corners = `codicon-symbol-misc` (mesmo do label). Cursor usa `lt.corners` também — mas é o **mesmo** em ambos lugares. ✅ semanticamente.
6. **[BUG]** Sem aria-pressed alternativo no toggle pin de corners além do `aria-pressed={editCorners}`. Cursor tem `aria-pressed`, `aria-expanded`, `data-active` no mesmo botão (overdone, mas é o que Cursor faz). Nosso L3886-3887 só `aria-pressed`. Acessibilidade subótima.
7. **[VISUAL]** L3895-3898 ícones per-corner = `arrow-small-left/right/down/up`. Cursor `Qmw` mapping (proprietário). Visual diferente.
8. **[BUG/MINOR]** L3853 ScrubLabel pro radius geral: `getValue={() => Math.round(isMixed ? 0 : radiusOverall)}` — retorna 0 quando mixed. Cursor scrub label: `getValue={() => Math.round(n.cornerRadiusValue())}` — usa o computed (que talvez não seja 0). User dragging quando Mixed começa de 0 em vez de o radius shorthand atual. **Minor bug UX**.

### Quick wins (fixes de 5min)
- L3886: trocar classe `is-active` → adicionar `data-active="true"` atributo.
- L3886-7: adicionar `aria-expanded={editCorners}` além de `aria-pressed`.
- L3853: mudar `Math.round(isMixed ? 0 : radiusOverall)` → `Math.round(radiusOverall)` (usar shorthand parsed value mesmo em Mixed).

### Refactors profundos (>15min)
- **Reescrever ThemePickerButton pra usar BrowserView.emulateColorScheme()** via IPC ao main process. Hoje usamos `executeJavaScript` que não dispara media query — só funciona com sites que usam `.dark` class manual. Bug grave.
- Implementar codicons mais próximos dos `lt.corners`, `lt.opacity`, `lt.symbolColor` originais (ou SVGs inline custom).

---

## Sumário geral

**Bugs críticos** (afetam funcionalidade):
1. Section 4 — `GridExtras` sobrescreve `grid-template-columns/rows` pra `repeat(N, 1fr)` SEMPRE, destruindo tracks customizadas.
2. Section 9 — `ThemePickerButton` usa `executeJavaScript(.dark class)` em vez de `BrowserView.emulateColorScheme()`. Não dispara media queries.
3. Section 8 — `ClipContentCheckbox` derive aceita `'clip'` (não Cursor) e falta `.trim().toLowerCase()`.
4. Section 5 — `DimensionInput` usa `disabled` em vez de `readOnly` no input.
5. Section 3 — `FlexExtras` ignora branch `isAutoGap` e `isColumn` no handler — gera reset involuntário de space-between e mapping invertido em column flex.

**Bugs visuais sistemáticos** (não funcionais mas quebram protocolo de classes):
- Section 2,6,7,9 — convenção `is-active` (nosso) vs `active` (Cursor) ou `data-active` (Cursor em algumas).
- Section 7 — MarginEditor reusa classes `css-padding-*` em vez de `css-margin-*`.
- Section 5 — DimensionInput inventou classes `css-dimension-mode-toggle`, `css-dimension-group` (não existem no Cursor).
- Section 2 — LayoutFlowButtons usa wrapper `preview-flow-*` (não `css-flow-*`).

**Missing features** (Cursor tem, nosso não):
- Hover preview de ícone nas cells de alignment (Section 3).
- Label flutuante `col, row` no grid picker (Section 4).
- Tooltips compactos `showHover` custom em todos hovers (Section 2, 4, etc).
- BrowserView API nativa pra theme switching (Section 9).
- `data-space-between` attr no alignment grid (Section 3).
- ARIA `aria-expanded` no grid trigger (Section 4).

**Quick wins recomendados** (ordem):
1. Reescrever ThemePickerButton com BrowserView.emulateColorScheme (Section 9).
2. Preservar tracks no GridExtras (Section 4).
3. Fixar handler de alignment em column flex + autoGap (Section 3).
4. Renomear classes pra bater protocolo (Sections 2,5,6,7,9).
5. Trocar `disabled` por `readOnly` no DimensionInput (Section 5).
