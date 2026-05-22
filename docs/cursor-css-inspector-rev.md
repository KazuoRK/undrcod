# Cursor CSS Inspector — Engenharia Reversa

Fonte: `C:/Users/taked/AppData/Local/Programs/cursor/resources/app/out/vs/workbench/workbench.desktop.main.js`
Versão: Cursor 3.4.20 (vscode 1.105.1 base)

Todas as funções extraídas via análise do bundle minificado em volta do binding `isAbsolutePositioned:Si` (offset 27,618,396 do arquivo de 56MB).

---

## Helpers fundamentais (assumidos)

| Minificado | Função | Notas |
|---|---|---|
| `qn(prop)` | Lê CSS computed style por nome | `qn("left")` → "23px" ou "auto" |
| `si(prop)` | Variante de `qn` (talvez raw style sem fallback computed) | Usado por `ro(min-/max-)` |
| `ni(prop, value, opts?)` | Aplica style ao elemento alvo | `opts.overrideOriginalValue` pra preservar histórico |
| `BZ(str)` | Parser de pixel — retorna `number` ou `null` | `BZ("23px")` → 23, `BZ("auto")` → null |
| `wr()` | Checkpoint pra undo history | Chamado ANTES de cada mudança importante |
| `He(fn)` | Computed memo (Solid.js) | Reactive primitive |

## Transform helpers

| Minificado | Função |
|---|---|
| `Lmw(transformStr)` | Extrai ângulo de rotação do transform |
| `Nmw(transformStr, deg)` | Reconstrói transform com nova rotação |
| `Mmw(transformStr, axis)` | Toggle scaleX(-1) ou scaleY(-1) |

---

## 1. Position section

### `rs` — positionXValue
```js
He(() => {
  const mr = BZ(qn("left"));
  return mr !== null ? mr : n.elementInfo?.rect.left ?? 0
})
```
**Semântica**: parseia CSS `left`. Se vier "auto"/inválido, fallback pra `rect.left` (getBoundingClientRect.left, viewport-relative, SEM scroll).

### `Cs` — positionYValue
```js
He(() => {
  const mr = BZ(qn("top"));
  return mr !== null ? mr : n.elementInfo?.rect.top ?? 0
})
```

### `Bs` — zIndexValue
```js
He(() => {
  const mr = BZ(qn("z-index"));
  return mr !== null ? mr : 0
})
```
**Semântica**: parseia z-index, fallback 0 (NÃO auto).

### `Dl` — rotationValue
```js
He(() => Lmw(qn("transform")))
```

### `Si` — isAbsolutePositioned
```js
He(() => qn("position") === "absolute")  // implícito, baseado em uso
```

### `Ro` — onAbsolutePositionToggle
```js
mr => {
  if (mr !== Si()) {
    if (mr) {
      ni("position", "absolute");
      return;
    }
    ni("position", "static");
    ni("left", "");
    ni("top", "");
  }
}
```
**Crítico**: toggle ON só seta `position: absolute`. NÃO mexe em left/top/width/height. CSS `left: auto` mantém posição visual original. Toggle OFF zera left/top.

### `Lm` — onPositionChange
```js
(mr, ys) => {
  if (ys === "") {
    ni(mr, "");
    return;
  }
  const la = parseFloat(ys);
  Number.isNaN(la) || (Si() && (wr(), ni(mr, `${la}px`)))
}
```
**Semântica**: aplica left/top SÓ se `Si()` (já absolute). String vazia → limpa. Senão parseia, descarta NaN, aplica como Npx. Chama `wr()` (history checkpoint) antes.

### `Uf` — onZIndexChange
```js
mr => {
  if (!Si()) return;
  if (mr.trim() === "") {
    ni("z-index", "auto");
    return;
  }
  const ys = parseFloat(mr);
  if (Number.isNaN(ys)) return;
  wr();
  const la = Math.round(ys);
  ni("z-index", `${la}`)
}
```
**Semântica**: só edita se absolute. Vazio → "auto". Senão arredonda inteiro, aplica sem unidade.

### `c0` — onRotationChange
```js
mr => {
  const ys = parseFloat(mr);
  if (Number.isNaN(ys)) return;
  const la = qn("transform");
  const pu = Nmw(la, ys);
  ni("transform", pu)
}
```

### `c_` — onRotateQuarterTurn
```js
() => {
  const mr = Dl();
  const ys = Number.isFinite(mr) ? mr : 0;
  c0((ys + 90).toString())
}
```
**Crítico**: ACUMULA `+ 90` sempre. Sem clamp `% 360`. 20 cliques = 1800°.

### `X_` — flipAxis helper
```js
mr => {
  const ys = qn("transform");
  const la = Mmw(ys, mr);  // mr = "horizontal" | "vertical"
  ni("transform", la)
}
```

### `Gf` / `xp` — flipH / flipV
```js
Gf = () => X_("horizontal")
xp = () => X_("vertical")
```

---

## 2. Dimensions section

### `Ma` / `eu` — widthValue / heightValue
```js
Ma = He(() => {
  const mr = BZ(qn("width"));
  return mr !== null ? mr : n.elementInfo?.rect.width ?? 0
})
eu = He(() => {
  const mr = BZ(qn("height"));
  return mr !== null ? mr : n.elementInfo?.rect.height ?? 0
})
```

### `mu` / `ap` / `Mg` / `Rg` — minWidth / maxWidth / minHeight / maxHeight
```js
mu = He(() => ro("min-width"))
ap = He(() => ro("max-width"))
Mg = He(() => ro("min-height"))
Rg = He(() => ro("max-height"))
```
Helper `ro(prop)` = `BZ(si(prop))` — parseia raw style (não computed).

### `ch` / `Gh` — widthMode / heightMode
```js
ch = He(() => Qu("width"))
Gh = He(() => Qu("height"))
```
Helper `Qu(prop)`: retorna "fixed" | "fit" | "fill" baseado no valor CSS.

### `fb` — setDimensionMode
```js
(mr, ys) => {  // mr = prop, ys = mode
  switch (ys) {
    case "fixed": {
      const la = Math.max(0, Math.round(_v(mr)));
      ni(mr, `${la}px`);
      return;
    }
    case "fit": ni(mr, "fit-content"); return;
    case "fill": ni(mr, "100%"); return;
  }
}
```
Helper `_v(mr)` = `mr === "width" ? Ma() : eu()` — pega valor atual.

### `Hp` — applyPixelDimension (W/H/min/max)
```js
(mr, ys, la) => {
  const pu = ys.trim();
  if (!pu) { ni(mr, ""); return }
  const Jp = BZ(pu);
  if (Jp === null) return;
  const Bw = (!la?.allowNegative && Jp < 0) ? 0 : Jp;
  ni(mr, `${Bw}px`)
}
```
**Semântica**: clamp pra não-negativo (a menos que `allowNegative: true`), sempre aplica como Npx.

---

## 3. Padding/Margin

### Values
```js
so = He(() => us("padding-top"))
Ba = He(() => us("padding-right"))
ic = He(() => us("padding-bottom"))
gc = He(() => us("padding-left"))
dd = He(() => lu("margin-top"))  // 'lu' helper diferente de 'us'!
// (margem-right/bottom/left seguem mesmo padrão com lu)
```
Helper `us(prop)` = `BZ(qn(prop)) ?? 0` — padding sempre tem fallback 0.
Helper `lu(prop)` = `BZ(qn(prop))` SEM `?? 0` — margin pode ser negativo, "auto", etc, então não clampa em 0.

### `Pg` — applyPaddingMargin
```js
(mr, ys) => {
  if (ys === "") { ni(mr, "auto"); return }
  const la = parseFloat(ys);
  Number.isNaN(la) || ni(mr, `${la}px`)
}
```
**Semântica**: vazio → "auto". Float válido → `Npx`. NaN → ignora.

---

## 4. Gap (flex/grid)

```js
Mr = He(() => BZ(qn("gap")) ?? 0)
Dr = He(() => BZ(qn("column-gap")) ?? Mr())
// row-gap analogo
```
**Semântica**: column-gap/row-gap caem pra `gap` shorthand se não setados explicitamente.

---

## 5. Typography

### Values
```js
ia = He(() => qn("font-family") || "")
Na = He(() => n.availableFontFamilies ?? [])

ks = He(() => {
  const mr = qn("font-weight").trim().toLowerCase();
  if (!mr || mr === "normal") return "400";
  if (mr === "bold") return "700";
  const ys = parseInt(mr, 10);
  return Number.isNaN(ys)
    ? "400"
    : Math.min(900, Math.max(100, Math.round(ys / 100) * 100)).toString()
})

go = He(() => BZ(qn("font-size")) ?? 0)
ko = He(() => qn("line-height").trim())
aa = He(() => qn("letter-spacing").trim())

Pl = He(() => {  // text-align
  switch (qn("text-align").trim().toLowerCase()) {
    case "center": return "center";
    case "right": case "end": return "right";
    default: return "left"
  }
})

kl = He(() => {  // vertical-align
  const mr = qn("vertical-align").trim().toLowerCase();
  return mr === "middle" || mr === "center" ? "middle"
       : mr === "bottom" || mr === "baseline" ? "bottom"
       : "top"
})
```

### Handlers
```js
Ll = (mr, ys) => { ni("font-family", mr, { overrideOriginalValue: ys }) }
td = mr => { ni("font-weight", mr.trim() || "") }
// font-size, line-height, letter-spacing usam Fm helper
```

---

## 6. Universal CSS apply helper

### `Fm` — applyCssWithKeywords
```js
(mr, ys, la) => {
  const pu = ys.trim();
  if (!pu) { ni(mr, ""); return }
  const Jp = la?.allowedKeywords ?? [];
  const Bw = pu.toLowerCase();
  const LS = Jp.find(ree => ree.toLowerCase() === Bw);
  if (LS) { ni(mr, LS); return }  // match keyword exato
  const mT = pu.match(/^(-?\d+(?:\.\d+)?)(?:\s*)([a-z%]*)$/i);
  if (!mT) return;
  let B3 = parseFloat(mT[1]);
  if (Number.isNaN(B3)) return;
  if (!la?.allowNegative && B3 < 0) B3 = 0;
  const lA = hu(B3);  // format number sem trailing zeros
  const lN = mT[2].toLowerCase();
  const dx = la?.allowedUnits?.map(ree => ree.toLowerCase());
  if (lN) {
    if (dx && dx.length > 0 && !dx.includes(lN)) return;
    ni(mr, `${lA}${lN}`);
    return;
  }
  if (la?.allowUnitless) { ni(mr, lA); return }
  const m$ = la?.defaultUnit ?? (dx && dx.length === 1 ? dx[0] : "px");
  ni(mr, `${lA}${m$}`)
}
```
**Semântica**: parser robusto pra CSS values com:
- whitelist de keywords (ex: `["auto", "fit-content"]`)
- whitelist de units (`["px", "em", "%"]`)
- `allowNegative`, `allowUnitless`, `defaultUnit`
- formato de número via `hu()` (sem trailing zeros)

### `hu` — formatNumber
```js
mr => {
  if (!Number.isFinite(mr)) return "0";
  const ys = Number.parseFloat(mr.toFixed(4));
  return Number.isInteger(ys), ys.toString()
}
```

---

## 7. Diffs críticos vs UNDRCode atual

| Comportamento | Cursor | UNDRCode hoje |
|---|---|---|
| X/Y values | `rect.left/top` puro (SEM scroll) | ✅ corrigido |
| Toggle "Enable absolute" | Só seta `position: absolute` | ✅ corrigido |
| `onPositionChange` quando static | NOOP | ✅ corrigido (returns early) |
| Rotate 90° | Acumula `+ 90` sem clamp | ✅ corrigido |
| z-index quando static | NOOP | ✅ corrigido |
| z-index vazio | Aplica "auto" | ⚠️ verificar |
| Padding fallback | `?? 0` (sempre número) | ⚠️ verificar |
| Margin fallback | sem `?? 0` (pode ser auto/negativo) | ⚠️ verificar |
| Dimension mode | "fixed" / "fit" / "fill" | ⚠️ "fixed" tem clamp em 0 |
| Font weight | clamp 100-900 step 100 | ⚠️ verificar |
| text-align "end" | normaliza pra "right" | ⚠️ verificar |
| vertical-align | top/middle/bottom (baseline=bottom) | ⚠️ verificar |
| Universal apply | helper `Fm` com keywords + units whitelist | ⚠️ não temos equivalente |

---

## 8. Ainda pendente (faltou extrair)

- **Fill section** (`backgroundColorValue`, layered backgrounds, gradient handlers)
- **Border section** (border-width/style/color, border-radius per-corner)
- **Effects** (box-shadow editor, opacity, filter)
- **Layout mode handler** (block/flex/grid/inline switching)
- **Live-edit pipeline** (como `ni()` realmente aplica — inline style? CSS-in-JS? stylesheet injection?)
- **Undo/redo** (`wr()` mecânica completa)
- **Element selection / picker** (algoritmo de hover highlight, click capture)

Pra extrair: rodar `python docs/_extract.py` com mais targets, ou ampliar `_cursor-chunk.txt`.

---

## 9. Comandos pra explorar mais

```bash
# Achar nome minificado de uma function (use string única do source)
F="C:/Users/taked/AppData/Local/Programs/cursor/resources/app/out/vs/workbench/workbench.desktop.main.js"
grep -oE "STRING_UNIQUE.{0,80}" "$F" | head -3

# Extrair um chunk em volta de uma string
python -c "
f = open('$F', encoding='utf-8', errors='ignore').read()
idx = f.find('STRING_PROCURADA')
print(f[max(0,idx-5000):idx+5000])
" > /tmp/chunk.txt

# Rodar extrator de funções
python docs/_extract.py
```
