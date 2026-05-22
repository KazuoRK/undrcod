# Pixel Audit 1-7 — Protocolo Visual

> Protocolo paralelo aos 7 gates funcionais (`CURSOR_REPLICATION_PROTOCOL.md`).
> Os gates funcionais cobrem TEMPLATE / HANDLERS / CONDITIONALS / LÓGICA.
> Os Pixel Audit gates (PA) cobrem **APENAS** fidelidade visual.
>
> Use os dois lado a lado: gate funcional garante que faz a coisa certa,
> Pixel Audit garante que **parece igual**.

---

## Quando usar

- Após implementar uma section/component com os 7 gates funcionais
- Quando o user envia screenshot dizendo "visualmente está diferente"
- Antes de marcar uma section como "completed"
- Sempre que houver dúvida sobre dimensões, cores, spacing exato

## Inputs

1. **Screenshot do Cursor** (REQUIRED — source of truth)
2. **Screenshot do nosso** (REQUIRED — current state)
3. **Acesso ao bundle do Cursor** (`workbench.desktop.main.js`) pra inspecionar CSS quando necessário
4. **Acesso ao CSS do Cursor** (`workbench.desktop.main.css`) pra valores exatos de tokens

## Output por gate

Cada gate produz:
1. **Tabela Cursor vs Nosso** (2 colunas) — comparação propriedade a propriedade
2. **Spec descritivo** — referência completa pra futura consulta
3. **Diff list priorizada** — P0 (blocking) / P1 (visível) / P2 (sutil)

---

## PA-0 — Reference Setup

**Objetivo:** Estabelecer source-of-truth visual antes de comparar.

**Checklist:**
- [ ] Screenshot Cursor capturado (full section, sem cortes)
- [ ] Screenshot nosso capturado no mesmo state (vazio vs com dados)
- [ ] Ambos no mesmo zoom level (preferencialmente 100%)
- [ ] Notar tema (light/dark) — Cursor light pode mascarar diffs visíveis no dark
- [ ] Listar TODOS os states a auditar (default, hover ativo, menu aberto, etc.)

**Output:**
```markdown
### PA-0 Reference
- Cursor screenshot: <path or attached>
- Nosso screenshot: <path or attached>
- Theme: light | dark
- States auditados: [default, hover, menu-open, ...]
```

---

## PA-1 — Hierarquia & Dimensões

**Objetivo:** Mapear cada elemento espacial — tamanho, padding, gap, posição relativa.

**Tabela:**

| Elemento | Cursor | Nosso | Diff |
|---|---|---|---|
| Section width | 280px | 280px | ✅ |
| Section padding | 12px 16px | 8px 12px | ❌ -4px V, -4px H |
| Header height | 32px | 36px | ❌ +4px |
| Body padding-top | 8px | 4px | ❌ -4px |
| Gap entre elementos | 8px | 6px | ❌ -2px |
| Icon size | 14px | 16px | ❌ +2px |

**Como medir:**
- Inspecionar via DevTools (computed styles) ou estimar pela screenshot
- Reproduzir hierarquia: `parent > child > grandchild` com box-model de cada
- Notar `display` (flex/grid/block) e direção

**Spec descritivo:**
```
.css-inspector-section
├─ display: flex; flex-direction: column;
├─ padding: 12px 16px;
├─ gap: 8px;
└─ .css-section-header
   ├─ height: 32px
   ├─ display: flex; justify-content: space-between
   └─ .css-section-title { font-size: 11px; ... }
```

**Diff list:**
- P0: section padding inteiro errado (impacto alto)
- P1: header height +4px (visível mas não crítico)
- P2: icon size +2px (sutil)

---

## PA-2 — Tipografia

**Objetivo:** Cada texto (label, value, button text) com specs completos.

**Tabela:**

| Texto | Font-family | Size | Weight | Color | Line-height | Letter-spacing |
|---|---|---|---|---|---|---|
| Section title "Border" | Inter | 11px | 600 | var(--fg-default) | 1.2 | 0.5px |
| Type dropdown "Solid" | Inter | 11px | 400 | var(--fg-default) | 16px | normal |
| Hex value "#E2E1DA" | JetBrains Mono | 11px | 400 | var(--fg-default) | normal | normal |
| Opacity "100" | Inter | 11px | 400 | var(--fg-default) | normal | normal |
| Suffix "%" | Inter | 11px | 400 | var(--fg-muted) | normal | normal |
| Label "Weight" | Inter | 10px | 500 | var(--fg-muted) | normal | uppercase 0.5px |

**Como medir:**
- DevTools → Computed → font-family/font-size/font-weight/color/line-height/letter-spacing
- Ou: comparar visualmente com text de referência conhecido

**Atenção a:**
- `text-transform: uppercase` em labels
- `font-variant-numeric: tabular-nums` em números (alinha colunas)
- `font-feature-settings` (ligaturas, etc.)
- Cor diferente entre `value` e `suffix` (% / px geralmente é muted)

**Diff list:**
- P0: font-weight errado no title (parece muito light/bold)
- P1: cor do suffix igual à do value (deveria ser muted)
- P2: line-height um pouco diferente

---

## PA-3 — Cores & Tokens

**Objetivo:** Cada background/border/text com cor exata + mapeamento pro nosso token.

**Tabela:**

| Surface | Cursor | Cursor token | Nosso | Nosso token | Diff |
|---|---|---|---|---|---|
| Section bg | #1E1E1E | --color-surface | #1A1A1A | --bg-base | ❌ -4 lightness |
| Input bg | #2D2D2D | --color-input | #252525 | --bg-elevated | ❌ -8 lightness |
| Input border | #3F3F3F | --color-border-subtle | #2F2F2F | --border-subtle | ❌ -16 lightness |
| Hover bg | rgba(255,255,255,0.05) | --color-hover-bg | rgba(255,255,255,0.03) | --hover-bg | ❌ -0.02 alpha |
| Active accent | #007ACC | --color-accent | #4F8FCC | --accent | ❌ hue shift |
| Muted text | #888888 | --color-fg-muted | #6F6F6F | --fg-muted | ❌ -25 lightness |

**Como medir:**
- DevTools color picker → eyedropper na screenshot
- Bundle do Cursor: `grep` por CSS vars em `workbench.desktop.main.css`
- Comparar variáveis lado a lado com `:root` do nosso

**Atenção a:**
- Cor pode ser `rgba(white, 0.05)` (não opaca) — efeito é diferente em backgrounds diferentes
- Tokens semânticos vs literais: `--accent` vs `#007ACC`
- Dark mode: cores totalmente diferentes do light mode

**Diff list:**
- P0: section bg diferente o suficiente pra notar (mudar `--bg-base`)
- P1: muted text muito apagado (ajustar `--fg-muted`)
- P2: accent hue shift sutil (não crítico)

---

## PA-4 — Shapes & Borders

**Objetivo:** border-radius, border-width/style/color, box-shadow, opacity.

**Tabela:**

| Elemento | border-radius | border | box-shadow | opacity |
|---|---|---|---|---|
| Section | 0 | none | none | 1 |
| Input field | 4px | 1px solid var(--border-subtle) | none | 1 |
| Button | 3px | none | none | 1 |
| Dropdown menu | 6px | 1px solid var(--border-default) | 0 8px 24px rgba(0,0,0,0.4) | 1 |
| Hover state | mesmo | mesmo | mesmo | 1 (bg muda) |

**Como medir:**
- DevTools → Computed → border-radius / border / box-shadow
- Inspecionar `:hover`, `:focus`, `[aria-expanded="true"]` states separadamente

**Atenção a:**
- Border radius diferente por elemento (input 4px, button 3px, menu 6px)
- Shadow só em elementos elevados (menus, popups, modals)
- Border 1px subtle vs 1px default (cor diferente)
- `outline` separado de `border` (focus rings)

**Diff list:**
- P0: nossos buttons com radius 6px (Cursor é 3px) — parece "mais redondo"
- P1: input border sem cor visível (Cursor tem 1px subtle, dá frame)
- P2: shadow menos pronunciado em menus

---

## PA-5 — Icons & Glyphs

**Objetivo:** Cada ícone identificado, dimensionado, colorido corretamente.

**Tabela:**

| Posição | Icon Cursor | Codicon | Size | Color | Nosso ícone |
|---|---|---|---|---|---|
| Section header — palette | symbol-color | codicon-symbol-color | 14px | var(--fg-default) | ✅ |
| Section header — add | add | codicon-add | 14px | var(--fg-default) | ✅ |
| Type dropdown chevron | chevron-down | codicon-chevron-down | 12px | var(--fg-muted) | ❌ 14px |
| Color row — eye | eye | codicon-eye | 12px | var(--fg-default) | ✅ |
| Color row — remove | chrome-minimize | codicon-chrome-minimize | 12px | var(--fg-default) | ❌ usando codicon-dash |
| Weight drag handle | weight | (não tem codicon) | 12px | var(--fg-muted) | ❌ usando ruler |

**Como medir:**
- Inspecionar `<i class="codicon codicon-XXX">` no DOM ou template
- Bundle do Cursor: identificar `lt.XXX` references (mapeam pra codicons)
- Ver `Fn.asClassName(lt.add)` → "codicon codicon-add"

**Atenção a:**
- Codicon name exato — variações sutis tipo `codicon-eye` vs `codicon-eye-closed`
- Cursor às vezes usa codicons custom não disponíveis no nosso (weight, etc.) — substituir pelo mais próximo
- Tamanho do ícone vs tamanho do button (button pode ser 24x24 com icon 12px centralizado)

**Diff list:**
- P0: ícone errado (usando dash em vez de chrome-minimize)
- P1: size 14px quando deveria ser 12px (parece grande demais)
- P2: cor errada (default em vez de muted)

---

## PA-6 — States (o que muda ao clicar)

**Objetivo:** Para cada elemento interativo, documentar TODOS os states visuais.

**Tabela por elemento:**

### Exemplo: Section header button (+)

| State | Background | Color | Border | Shadow | Cursor | Outras |
|---|---|---|---|---|---|---|
| Default | transparent | var(--fg-default) | none | none | pointer | — |
| Hover | rgba(255,255,255,0.05) | var(--fg-default) | none | none | pointer | — |
| Active (pressed) | rgba(255,255,255,0.08) | var(--fg-default) | none | none | pointer | — |
| Focus | transparent | var(--fg-default) | none | none + outline 2px | pointer | outline-offset 2px |
| Disabled | transparent | var(--fg-muted) | none | none | not-allowed | opacity 0.5 |

### Exemplo: Type dropdown

| State | Visual change |
|---|---|
| Default | Show current label + chevron-down |
| Hover | Background hover-bg |
| Active (clicked) | `aria-expanded="true"`, menu abre below |
| Menu open | Background hover-bg permanece, chevron NÃO rotaciona (Cursor não rotaciona) |
| Selected item | Mostra checkmark à direita do label no menu |
| Disabled | Opacity 0.5, cursor not-allowed |

### Exemplo: Color row eye toggle

| State | Background | Icon | Aria |
|---|---|---|---|
| Visible (active) | accent ou subtle bg | codicon-eye | aria-pressed=true |
| Hidden | transparent | codicon-eye-closed | aria-pressed=false |

**Como medir:**
- Hover/active no DevTools (`:hov` toggle)
- Disparar focus via tab key + screenshot
- Click & hold pra capturar pressed state
- Para dropdowns: abrir menu, capturar posição + dimensões + animation

**Atenção a:**
- Hover background NÃO é o mesmo que active (sutil diferença alpha)
- Focus ring: outline ou box-shadow simulado
- `aria-expanded` muda o visual? (chevron rotation, bg change)
- `data-selected`, `data-active`, `is-active` — qual o pattern aplicado?

**Diff list:**
- P0: chevron rotaciona quando menu aberto (Cursor não rotaciona)
- P1: focus ring usando outline em vez de box-shadow (parece diferente)
- P2: hover bg um pouco mais escuro que deveria

---

## PA-7 — Transitions & Animations

**Objetivo:** Duração, easing, propriedades animadas, micro-interactions.

**Tabela:**

| Elemento | Property | Duration | Easing | Notas |
|---|---|---|---|---|
| Button hover | background-color | 100ms | ease-out | — |
| Menu open | opacity + transform | 150ms | ease-out | translateY(-4px) → 0 |
| Chevron rotate | transform | 120ms | ease-in-out | NÃO usado no Cursor (no Border) |
| Section collapse | display (instant) | 0ms | — | Cursor não anima collapse |
| Color swatch change | background | 0ms | — | mudança instantânea |
| Tooltip appear | opacity | 200ms | ease-out | delay 500ms antes de mostrar |
| Drag scrub | transform: translateX | 0ms | — | follows cursor instantly |

**Como medir:**
- DevTools → Performance → record interaction → ver paint/animation timeline
- Computed → `transition` shorthand → parse
- Reduzir motion no SO + verificar se animation respeita `prefers-reduced-motion`

**Atenção a:**
- Transitions ESTÃO definidas mas pode estar transitionando propriedades erradas
- Easing `ease-out` ≠ `ease` ≠ `linear`
- Spring vs cubic-bezier (Cursor às vezes usa `cubic-bezier(0.4, 0, 0.2, 1)` material design)
- Animação no `mount` (entrar) vs `unmount` (sair) podem ser diferentes
- Delay (`transition-delay`) — tooltip não aparece imediatamente

**Diff list:**
- P0: collapse anima quando não deveria (parece lento)
- P1: hover transition é instant em vez de 100ms (parece "clicado")
- P2: tooltip sem delay aparece imediatamente

---

## Template de Pixel Audit Report

Crie um arquivo `pixel-audit-<section>.md` por section auditada:

```markdown
# Pixel Audit: <Section Name>

**Date:** 2026-MM-DD
**Auditor:** Claude
**Cursor version:** 3.4.20 (build XXX)
**State audited:** default | hover | menu-open | ...

## PA-0 Reference
[screenshots side-by-side]

## PA-1 Hierarquia
<tabela>
<spec>
<diffs>

## PA-2 Tipografia
<tabela>
<diffs>

## PA-3 Cores
<tabela>
<diffs>

## PA-4 Shapes
<tabela>
<diffs>

## PA-5 Icons
<tabela>
<diffs>

## PA-6 States
<tabela por elemento>
<diffs>

## PA-7 Transitions
<tabela>
<diffs>

## Consolidated Action Items

### P0 (blocking — fix antes de marcar completed)
- [ ] <descrição + qual gate + file:line>
- [ ] ...

### P1 (visível — fix em batch separado)
- [ ] ...

### P2 (sutil — backlog)
- [ ] ...
```

---

## Workflow recomendado

1. **Implementar com 7 gates funcionais** → logic + handlers OK
2. **Capturar screenshots** lado a lado (Cursor vs nosso)
3. **Rodar Pixel Audit 1-7** → identificar diffs visuais
4. **Aplicar P0 + P1** → revisar visual
5. **Aplicar P2** quando houver tempo
6. **Marcar section como** "completed" só após P0+P1 zerados

## Anti-patterns a evitar

- ❌ "Parece igual" sem medir (estimativa visual é traiçoeira)
- ❌ Pular PA-6 (states) — 50% dos diffs reportados pelo user são state-related
- ❌ Confiar só no dark mode — light mode pode revelar diffs ocultos
- ❌ Auditar enquanto edita — separar audit (read-only) de fix (write)
- ❌ Não capturar screenshot — sem reference visual, audit é especulação
- ❌ Esquecer hover/focus/active — esses são onde a UI "se sente" diferente
