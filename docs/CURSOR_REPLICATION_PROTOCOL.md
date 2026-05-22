# Protocolo de replicação do Cursor → UNDRCode

**Leitura obrigatória antes de qualquer geração de código que toca CSS Inspector ou clones de UI do Cursor.**

Cada gate é bloqueador. Pular = bug.

---

## GATE 0 — Inventário visual (1-3 min)

Antes de tocar código, com o screenshot do user em mãos:

- [ ] **Contar elementos**: quantos botões, inputs, labels, ações no header. Número exato. Se você falar "1 botão" e tem 2, parou aqui.
- [ ] **Layout direction**: vertical (column), horizontal (row), grid de N colunas?
- [ ] **Estados visuais**: active, hover, focus, disabled, "Mixed", "auto", placeholders, revealed, hidden.

## GATE 1 — Extração raw do bundle

Bundle alvo: `C:/Users/taked/AppData/Local/Programs/cursor/resources/app/out/vs/workbench/workbench.desktop.main.js`

- [ ] **Template HTML raw**: `grep -oE "NAMEmw=st.{0,3000}" bundle.js`. **Não infira.** Copie da string.
- [ ] **Atributos especiais**: aria-label dinâmicos, aria-haspopup, aria-pressed, aria-expanded, role, data-*, title, inputmode, min, max, type.
- [ ] **Classes CSS**: liste todas. Você replica essas (não inventa novas `preview-*`).

## GATE 2 — Handlers + Derives raw

- [ ] Handler raw (apply/onChange). Exemplo:
  ```js
  rb = mr => { ni("box-sizing", mr ? "border-box" : "content-box") }
  ```
- [ ] Derive raw (computed value). Exemplo:
  ```js
  $y = He(() => qn("box-sizing").trim().toLowerCase() === "border-box")
  ```
- [ ] **Transformações no derive**: `.trim()`, `.toLowerCase()`, fallback `?? 0`, `?? "auto"`, `parseFloat`, `Math.round`, clamps.
- [ ] **Side-effects do handler**: aplica >1 prop? Em qual ordem? Limpa outras?

## GATE 3 — Conditional renders

- [ ] **O que aparece/some** ao clicar (modos expanded, Mixed, mode-token).
- [ ] **Tooltips dinâmicos**: "Edit sides" ↔ "Edit vertical/horizontal", "Show element" ↔ "Hide element".

## GATE 4 — Verificação cruzada

Responda mentalmente, sem voltar ao bundle:

- "Quantos elementos vou renderizar? Por que esse número?"
- "Que classes CSS vou usar? Bate com o template?"
- "Qual o handler exato? Como difere do que já tenho?"
- "Que side-effect tem ao clicar?"

Se travou em algum, volte aos gates 0-3.

## GATE 5 — Geração

Regras de ouro:

- Classes `css-*` do Cursor (não inventar novas)
- Estrutura HTML idêntica ao template extraído
- Handler 1:1 (mesma ordem de calls, mesmas props)
- Derive 1:1 (mesmo trim/lowercase/fallback)
- Não adicionar features que Cursor não tem
- Não pular features que Cursor tem

## GATE 6 — Self-audit pós-geração

Antes de marcar completed:

- [ ] DIFFs explícitos vs Cursor (ex: codicon proprietário substituído por equivalent)
- [ ] Features Cursor NÃO implementadas (declare)
- [ ] "Cobre TODOS os elementos visíveis do screenshot?"

---

## Bugs documentados (vieram de pular o protocolo)

1. **Border Box não toggleava** → `box-sizing` faltava no `USEFUL_PROPS` do preload
2. **Appearance só 1 botão no header (tinha 2)** → não contei
3. **Padding/Margin sem mismatch indicator** → pulei `data-mismatch`
4. **Layout extras em wrap (Freeform)** → Cursor só mostra em row/column/grid
5. **Grid picker 8×11 (era 11×8)** → não conferi `Xpw=11, Zpw=8`
6. **Position X com `+scrollX`** → Cursor não faz isso
7. **Rotate 90° trava em 180°** → parseei do computed matrix, faltou inline transform priority

Todos: **mesma causa raiz** — não auditei elemento-por-elemento.

---

## Arquivos chave

- `docs/cursor-sections/` — 28 funções + templates raw extraídos
- `docs/cursor-css-inspector-rev.md` — doc consolidado com handlers traduzidos
- `docs/_extract_sections.py` — script de extração (re-rodar pra adicionar componentes)

## Ordem canônica (CSS Inspector)

1. Position
2. Layout (Flow + extras condicionais)
3. Dimensions (W/H + modes + Add Min/Max)
4. Padding
5. Clip content
6. Margin
7. Border box
8. Appearance (Opacity + Corner Radius + 2 botões header)
9. Fill
10. Stroke
11. Effects
12. Typography
