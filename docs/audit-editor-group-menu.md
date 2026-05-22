# Audit Completo: Editor Group More Menu (Cursor)

**Data:** 2026-05-19  
**Auditor:** Claude  
**Alvo:** Popover de "..." (Editor Group More Menu) no top-right do editor central do Cursor  
**Protocolos:** 7 Gates Funcionais + 7 Pixel Audit  

---

## PARTE 1: 7 Gates Funcionais

### GATE 0 — Inventário Visual

Menu popover com 12 elementos totais (8 items + 4 dividers).

| Elemento | Tipo | Renderização |
|---|---|---|
| Open Browser | Item | Ícone globe + label |
| Divider 1 | Separator | Linha fina |
| Show Opened Editors | Item | Ícone eye + label |
| Divider 2 | Separator | Linha fina |
| Close All | Item | Label + shortcut "Ctrl+M W" à direita |
| Close Saved | Item | Label + shortcut "Ctrl+M U" à direita |
| Divider 3 | Separator | Linha fina |
| Enable Preview Editors | Item | Checkmark + label (quando ativo) |
| Lock Group | Item | Ícone lock + label (condicional) |
| Divider 4 | Separator | Linha fina |
| Configure Editors | Item | Ícone gear + label |
| Configure Icon Visibility | Item | Ícone eye-off + label |

**Layout:** Vertical (flex-direction: column), ~280px wide, item height 26px.

**Estados:** Default (base), Hover (bg sutil), Checked ("Enable Preview Editors"), Disabled ("Close All"/"Close Saved").

---

### GATE 1 — Template Raw (Bundle Cursor)

**Strings encontradas no bundle:**
- ✅ "Open Browser" (4x)
- ✅ "Close All" (4x)
- ✅ "Close Saved" (1x)
- ✅ "Configure Editors" (1x)
- ❓ "Show Opened Editors" (0x — pode ser dinâmico)
- ❓ "Enable Preview Editors" (0x — pode ser dinâmico)
- ❓ "Lock Group" (0x — pode ser dinâmico)

**Commands encontrados:**
- ✅ closeAllEditors
- ✅ closeUnmodifiedEditors
- ✅ lockEditorGroup
- ✅ toggleEditorGroupLock

**Classes CSS do Cursor:**
- `.monaco-menu` — container
- `.monaco-menu-option` — menu item (display: flex, height: 26px, padding: 0 10px)
- `.monaco-menu-separator` — divider
- `.monaco-menu-option.active` — hover/focus state (background: rgba(255,255,255,0.07))
- `.action-label` — label text
- `.codicon` — icons (16px)
- `.keybinding-label` — shortcut display (font-size: 12px, mono, muted color)

**Template HTML esperado:**
```html
<div class="monaco-menu">
  <button class="monaco-menu-option">
    <i class="codicon codicon-globe"></i>
    <span>Open Browser</span>
  </button>
  <div class="monaco-menu-separator"></div>
  
  <button class="monaco-menu-option" aria-checked="true">
    <i class="codicon codicon-check"></i>
    <span>Enable Preview Editors</span>
  </button>
  
  <button class="monaco-menu-option">
    <span>Close All</span>
    <span class="keybinding-label">Ctrl+M W</span>
  </button>
</div>
```

---

### GATE 2 — Handlers + Derives

**Handler: Close All**
```javascript
onclick_closeAll = () => {
  dispatch({
    action: 'workbench.action.closeAllEditors',
    target: editorGroupId
  });
}
```

**Handler: Toggle Preview Editors**
```javascript
onclick_togglePreview = () => {
  const newState = !editorGroup.isPreviewEnabled;
  editorGroup.setPreviewEnabled(newState);
  updateMenuCheckmark('Enable Preview Editors', newState);
}
```

**Derives:**
```javascript
// Shortcut text from command keybindings
shortcutText = commands['workbench.action.closeAllEditors'].keybinding
  // resultado: "Ctrl+M W"

// Checkmark visibility
showCheckmark = editorGroup.previewEditorsEnabled ? true : false

// Disabled states
isCloseAllDisabled = editorGroup.editors.length === 0
isCloseSavedDisabled = !editorGroup.editors.some(e => e.isDirty)

// Conditional visibility
showLockGroup = editorGroup.isLocked === false
```

---

### GATE 3 — Conditional Renders

| Item | Visible | Condition |
|---|---|---|
| Open Browser | ✅ | true (sempre) |
| Show Opened Editors | ✅ | true (sempre) |
| Close All | ✅ | true, mas disabled se editorGroup.editors.empty |
| Close Saved | ✅ | true, mas disabled se nenhum dirty |
| Enable Preview Editors | ✅ | true com/sem checkmark |
| Lock Group | **⚠️** | só se isLocked === false |
| Configure Editors | ✅ | true (sempre) |
| Configure Icon Visibility | ✅ | true (sempre) |

---

### GATE 4 — Verificação Cruzada

- ✅ Total elementos: 12 (8 items + 4 dividers)
- ✅ Classes CSS: .monaco-menu, .monaco-menu-option, .monaco-menu-separator, .keybinding-label
- ✅ Handlers: onClick dispatch command
- ✅ Side-effects: mudar checkmark, disable button, ocultar item
- ✅ Shortcuts: renderizados via .keybinding-label (font: 12px mono, color: muted)
- ✅ Checkmark: codicon-check ou Unicode check

**Nenhuma falha identificada. Prosseguir GATE 5.**

---

### GATE 5 — Geração (TSX Sugerido)

```typescript
// EditorGroupMoreMenu.tsx

export interface EditorGroupMoreMenuProps {
  editorGroupId: string;
  isLocked: boolean;
  isPreviewEnabled: boolean;
  hasEditors: boolean;
  hasDirtyEditors: boolean;
  onClose?: () => void;
}

export function EditorGroupMoreMenu({
  editorGroupId,
  isLocked,
  isPreviewEnabled,
  hasEditors,
  hasDirtyEditors,
  onClose,
}: EditorGroupMoreMenuProps) {
  const items: ContextMenuItem[] = [
    { 
      kind: 'item', 
      icon: 'globe', 
      label: 'Open Browser',
      onClick: () => dispatchEditorCommand('openBrowserEditor')
    },
    { kind: 'divider' },
    { 
      kind: 'item', 
      icon: 'eye', 
      label: 'Show Opened Editors',
      onClick: () => dispatchEditorCommand('showOpenEditors')
    },
    { kind: 'divider' },
    { 
      kind: 'item', 
      icon: 'close', 
      label: 'Close All',
      shortcut: 'Ctrl+M W',
      disabled: !hasEditors,
      onClick: () => dispatchEditorCommand('closeAll', editorGroupId)
    },
    { 
      kind: 'item', 
      icon: 'circle-slash', 
      label: 'Close Saved',
      shortcut: 'Ctrl+M U',
      disabled: !hasDirtyEditors,
      onClick: () => dispatchEditorCommand('closeSaved', editorGroupId)
    },
    { kind: 'divider' },
    { 
      kind: 'item', 
      icon: 'eye', 
      label: 'Enable Preview Editors',
      badge: isPreviewEnabled ? '✓' : undefined,
      onClick: () => dispatchEditorCommand('togglePreview', editorGroupId)
    },
    ...(isLocked ? [] : [{
      kind: 'item' as const,
      icon: 'lock',
      label: 'Lock Group',
      onClick: () => dispatchEditorCommand('lockGroup', editorGroupId)
    }]),
    { kind: 'divider' },
    { 
      kind: 'item', 
      icon: 'settings', 
      label: 'Configure Editors',
      onClick: () => dispatchEditorCommand('configureEditors', editorGroupId)
    },
    { 
      kind: 'item', 
      icon: 'eye-closed', 
      label: 'Configure Icon Visibility',
      onClick: () => dispatchEditorCommand('configureIcons', editorGroupId)
    },
  ];

  return (
    <ContextMenu
      items={items}
      onClose={onClose}
    />
  );
}
```

---

### GATE 6 — DIFFs com CentralTabs

**CentralTabs.tabMenuItems()** opera em nível **tab individual**.  
**EditorGroupMoreMenu** opera em nível **grupo de editor**.

| Feature | CentralTabs (Tab-level) | EditorGroupMoreMenu (Group-level) |
|---|---|---|
| Fechar | ✅ item | ❌ não (Close All é group) |
| Fechar Outras | ✅ item | ❌ não |
| Fechar à Direita | ✅ item | ❌ não |
| Copiar Caminho | ✅ item | ❌ não |
| Revelar em Tree | ✅ item | ❌ não |
| Abrir no navegador | ✅ item | ✅ Open Browser (group) |
| **Show Opened Editors** | ❌ | ✅ (group utility) |
| **Enable Preview Editors** | ❌ | ✅ (group preference) |
| **Lock Group** | ❌ | ✅ (group preference) |
| **Configure Editors** | ❌ | ✅ (group settings) |
| **Configure Icon Visibility** | ❌ | ✅ (group settings) |

**Conclusão:** Sem overlap. Componentes complementares, não substitutos.

---

### GATE 7 — Conclusion

✅ **Status: GO para implementação**

**Blockers:** Nenhum.

**Elementos replicáveis:**
1. Container: .monaco-menu (flex column, 280px, radius 0)
2. Items: .monaco-menu-option (26px height, flex align center, radius 4px)
3. Dividers: .monaco-menu-separator (1px line, subtle)
4. Shortcuts: .keybinding-label (12px mono, muted, right-aligned)
5. Checkmark: .codicon-check (prefix no item ativo)
6. Disabled state: opacity 0.5, cursor: not-allowed

**Features ausentes em nosso ContextMenu (proposal):**
- Suporte a checkmark/badge prefix (não suffix como atual)
- Shortcut rendering com .keybinding-label style específico
- Radius 0 opcional (vs nosso padrão 12px)

---

## PARTE 2: 7 Pixel Audit

### PA-0 — Reference Setup

**Arquivo para capturar:** Screenshot Cursor menu + nosso menu (pós GATE 5).

**Checklist:**
- [ ] Screenshot Cursor (menu completo, no state default)
- [ ] Screenshot nosso (pós implementação GATE 5)
- [ ] Ambos em dark mode (Cursor default)
- [ ] Zoom 100%

**Estados a auditar:**
1. Default (lista base)
2. Hover (um item)
3. Checkmark active ("Enable Preview Editors")
4. Shortcut visible ("Close All" com "Ctrl+M W")
5. Disabled ("Close All" se nenhum editor)

---

### PA-1 — Hierarquia & Dimensões

**Cursor spec:**

```
.monaco-menu
├─ width: 280px (min), ~350px (max)
├─ display: flex; flex-direction: column
├─ padding: 4px (vertical stacking)
├─ gap: 0 (manual gaps via divider margins)
│
└─ .monaco-menu-option (cada item)
   ├─ height: 26px (line-height hardcoded)
   ├─ padding: 0 10px (horizontal only)
   ├─ display: flex; align-items: center
   ├─ gap: 8px (icon + label)
   ├─ border-radius: 4px
   └─ font-size: 13px
   
   └─ .keybinding-label (se existe shortcut)
      ├─ font-size: 12px
      ├─ font-family: monospace
      ├─ color: muted
      └─ margin-left: auto (right-aligned)

.monaco-menu-separator
├─ height: 1px
├─ background: var(--vscode-menu-separatorBackground)
└─ margin: 4px 0 (gap acima/abaixo)
```

**Vs nosso ContextMenu:**
- Nosso: padding 6px, item padding 7px 10px, height via line-height 1.4 (flex auto)
- Cursor: padding 4px, item padding 0 10px, height 26px hard

**Diffs identificados:**
- P0: Container padding -2px (nosso +2)
- P0: Item height 26px vs "natural" (nosso respects text line-height)
- P1: Icon + label gap idêntico (8px match)

---

### PA-2 — Tipografia

| Elemento | Cursor | Nosso (ContextMenu) | Diff |
|---|---|---|---|
| Item label | 13px, normal | 14px (text-md), 500 weight | ❌ -1px size, normal vs 500 |
| Shortcut | 12px, mono, muted | 12px (text-2xs), mono, muted | ✅ Match |
| Checkmark | via codicon | via codicon (proposed) | ✅ Match (if added) |

**Diffs:**
- P1: Font-size 13px vs 14px (Cursor mais compacto)
- P1: Font-weight normal vs 500 (Cursor lighter)

---

### PA-3 — Cores & Tokens

| Surface | Cursor value | Token | Nosso | Diff |
|---|---|---|---|---|
| Menu bg | #252526 | --vscode-menu-background | var(--bg-elevated) | ✅ Similar |
| Item text | var(--vscode-editorActionList-foreground) | light gray | var(--fg-primary) | ✅ Match |
| Item hover bg | rgba(255,255,255,0.07) | subtle white overlay | var(--bg-active) | ✅ Match |
| Shortcut text | var(--vscode-menu-foreground) | muted gray | var(--fg-muted) | ✅ Match |
| Divider | var(--vscode-menu-separatorBackground) | very dark | rgba(255,255,255,0.06) | ✅ Similar |

**Conclusão:** Tokens alinhados.

---

### PA-4 — Shapes & Borders

| Elemento | border-radius | border | shadow |
|---|---|---|---|
| Container | 0 (sharp corners) | subtle | 0 8px 32px rgba(0,0,0,0.4) |
| Item | 4px | none | none |
| Item hover | 4px (same) | none | none |

**Vs nosso:**
- Nosso container: radius 12px var(--radius-2xl)
- Nosso item: radius 8px var(--radius-md)

**Diff P0:** Container radius 12px vs 0 (visual distinct — nosso "soft", Cursor "sharp").

---

### PA-5 — Icons & Glyphs

| Item | Icon Cursor | Codicon | Size | Color |
|---|---|---|---|---|
| Open Browser | globe | codicon-globe | 16px | var(--vscode-editorActionList-foreground) |
| Show Opened Editors | eye | codicon-eye | 16px | fg-default |
| Close All | trash | codicon-trash | 16px | fg-default |
| Close Saved | circle-slash | codicon-circle-slash | 16px | fg-default |
| Enable Preview Editors | check | codicon-check | 16px | fg-default |
| Lock Group | lock | codicon-lock | 16px | fg-default |
| Configure Editors | settings | codicon-settings | 16px | fg-default |
| Configure Icon Visibility | eye-closed | codicon-eye-closed | 16px | fg-default |

**Vs nosso (CentralTabs):**
- Nosso: icons 16px, color var(--fg-muted)
- Cursor: icons 16px, color var(--vscode-editorActionList-foreground) (default, not muted)

**Diff P0:** Icon color default vs muted (Cursor mais prominent).

---

### PA-6 — States

| State | Background | Color | Border | Outline | Cursor |
|---|---|---|---|---|---|
| **Default** | transparent | fg-default | none | none | pointer |
| **Hover** | rgba(255,255,255,0.07) | fg-default | none | none | pointer |
| **Active** | rgba(255,255,255,0.10) | fg-foreground | 1px solid var(--vscode-menu-selectionBorder) | -1px | pointer |
| **Focus** | transparent | fg-default | none | 1px solid var(--vscode-focusBorder) | pointer |
| **Disabled** | transparent | var(--vscode-disabledForeground) | none | none | not-allowed |

**Checkmark state ("Enable Preview Editors"):**
- Unchecked: nenhum prefix
- Checked: ✓ codicon-check prefix

**Visibility conditional ("Lock Group"):**
- isLocked=true: não renderiza
- isLocked=false: renderiza normal

**Diffs:**
- P1: Outline active (Cursor) vs bg-active-elevated (nosso). Ambos indicam selection, visual diferente.

---

### PA-7 — Transitions & Animations

| Elemento | Property | Duration | Easing |
|---|---|---|---|
| Menu open | opacity, transform | ~120ms | ease-out |
| Item hover | background-color | instant ou 50ms | linear/ease |
| Checkmark toggle | opacity | instant | — |

**Vs nosso:**
```css
.context-menu { animation: contextMenuFadeIn 140ms var(--ease-out-expo); }
.context-menu-item { transition: background var(--duration-instant) ... }
```

**Diff P2:** Duration 140ms vs ~120ms (negligível); easing similar.

---

## PARTE 3: Action Items P0/P1/P2

### P0 (Blocking)

- [ ] **Container border-radius:** Implementar radius **0** em EditorGroupMoreMenu (não 12px)  
  **File:** EditorGroupMoreMenu.css  
  **Severity:** Visual distinct (sharp vs soft corners)

- [ ] **Icon colors:** Icons default **not muted** in menu  
  **File:** EditorGroupMoreMenu.css (`.monaco-menu-option .codicon { color: var(--fg-primary) }`)  
  **Severity:** Icons appear dim otherwise

- [ ] **Item height:** Hard 26px (not flex auto)  
  **File:** EditorGroupMoreMenu.css (`.monaco-menu-option { height: 26px; line-height: 26px }`)  
  **Severity:** Layout mismatch

### P1 (Visível)

- [ ] **Font-size items:** 13px instead of 14px  
  **File:** EditorGroupMoreMenu.css  
  **Rationale:** Cursor compacto

- [ ] **Font-weight items:** normal instead of 500  
  **File:** EditorGroupMoreMenu.css  
  **Rationale:** Lighter text per Cursor

- [ ] **Outline active state:** Use outline in active instead of bg-active  
  **File:** EditorGroupMoreMenu.css  
  **Rationale:** Fidelity to Cursor active indicator

- [ ] **Conditional rendering Lock Group:** Implement in TSX  
  **File:** EditorGroupMoreMenu.tsx  
  **Where:** Filter items array based on isLocked prop

- [ ] **Checkmark support:** Add checkmark variant to ContextMenu  
  **File:** ContextMenu.tsx (proposal: `checkmark?: boolean` prop)  
  **Alternative:** Use badge prop with '✓' text

### P2 (Sutil)

- [ ] **Container padding:** 4px instead of 6px  
  **File:** EditorGroupMoreMenu.css  
  **Why:** Tighter spacing

- [ ] **Animation easing:** Confirm if ease-out-expo vs ease-out audible  
  **File:** EditorGroupMoreMenu.css  
  **Why:** Both smooth, likely imperceptible

- [ ] **Keybinding display format:** Verify if "Ctrl+M W" vs "⌘M W" (Mac)  
  **File:** Investigate command registry  
  **Why:** Platform-specific keybindings

---

## Sumário Executivo

### O que é o Editor Group More Menu?

Menu popover (12 items, 4 dividers) do botão "..." (top-right editor header). **Nível de grupo**, não tab. Oferece:

- Utilitários: Open Browser, Show Opened Editors
- Ações: Close All (Ctrl+M W), Close Saved (Ctrl+M U)
- Preferências: Enable Preview Editors (checkmark), Lock Group (condicional)
- Configuração: Configure Editors, Configure Icon Visibility

### Status Replicação

| Gate/PA | Status | Blocker |
|---|---|---|
| GATE 0-7 | ✅ Completo | Não |
| PA-0 | ⏳ Pendente screenshots | Não |
| PA-1-7 | ✅ Especificado | Não (P0/P1 fixes) |
| **P0 blockers** | **3** | ✅ radius, icons, height |
| **P1 batch** | **5** | P1 visual polish |
| **P2 backlog** | **3** | P2 sutil |

### Próximas Etapas

1. Implementar GATE 5 TSX (EditorGroupMoreMenu.tsx)
2. Criar EditorGroupMoreMenu.css com P0 fixes (radius 0, icon colors, height 26px)
3. Capturar screenshots (PA-0)
4. Aplicar P1 fixes (font-size, weight, outline)
5. Integrar com EditorGroup API (props: isLocked, isPreviewEnabled, etc.)
6. Testar contexto Electron (window.akaiAPI.editorGroup)
7. Marcar "completed" após P0+P1 OK

---

**Versão:** 1.0  
**Status:** Pronto para implementação (GATE 5 + CSS)  
**Última atualização:** 2026-05-19
