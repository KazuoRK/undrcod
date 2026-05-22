# Split Editor — Plano de Implementação

_Doc criado: 2026-05-20_
_Referência: Cursor 3.4.20 + VS Code 1.105.1 base_

## Objetivo

Implementar **Split Editor** no UNDRCode:
- **Ctrl+\** — Split Editor Right (dividir verticalmente em 2 grupos lado-a-lado)
- **Alt+\** — Split Editor Down (dividir horizontalmente em 2 grupos cima-baixo)
- Drag tab entre grupos
- Close group quando última tab fecha
- Resize divider entre grupos

## Estado atual UNDRCode (CentralTabs)

**Arquivo:** `src/renderer/App.tsx` + `src/renderer/components/CentralTabs/CentralTabs.tsx`

**Shape:**
```ts
const [centralTabs, setCentralTabs] = useState<CentralTab[]>([]);
const [activeCentralTabId, setActiveCentralTabId] = useState<string | null>(null);

type CentralTab =
  | { id: string; kind: 'file'; path: string; pinned?: boolean; ... }
  | { id: string; kind: 'view'; viewId: CentralViewId; ... }
  | { id: string; kind: 'compare'; leftPath: string; rightPath: string; ... };
```

**Flat array + 1 ID ativo.** Renderiza 1 editor por vez. Não suporta múltiplos grupos.

**Comentário no código (App.tsx:1962):**
```ts
// Editor Layout submenu (Split editor) NÃO incluído — requer refactor grande
```

## Cursor pattern (literal, do bundle)

**Command IDs descobertos em `workbench.desktop.main.js`:**

```js
jfs="workbench.action.splitEditor"              // default split
Son="workbench.action.splitEditorUp"            // split up (group above)
V4t="workbench.action.splitEditorDown"          // split down (group below)
Con="workbench.action.splitEditorLeft"          // split left
z4t="workbench.action.splitEditorRight"         // split right (most common)
Kfs="workbench.action.toggleMaximizeEditorGroup"
NOd="workbench.action.splitEditorInGroup"
MOd="workbench.action.joinEditorInGroup"
mFp="workbench.action.focusFirstSideEditor"
pFp="workbench.action.focusSecondSideEditor"
Tlw="workbench.action.focusLeftGroupWithoutWrap"
Elw="workbench.action.focusRightGroupWithoutWrap"
xlw="workbench.action.focusAboveGroupWithoutWrap"
```

Cursor herda do VS Code completo — sistema de "EditorGroups" recursivo (cada group pode ter splits internos).

## Refactor: state shape proposto

### Versão simples (MVP — 1 split max)

```ts
interface EditorGroup {
  id: string;
  tabs: CentralTab[];
  activeTabId: string | null;
}

interface EditorLayout {
  groups: EditorGroup[];                        // [primary] ou [primary, secondary]
  orientation: 'horizontal' | 'vertical' | null; // null = single, horizontal = side-by-side
  sizes: [number, number] | null;               // [50, 50] = equal split
  focusedGroupId: string;
}

const [editorLayout, setEditorLayout] = useState<EditorLayout>({
  groups: [{ id: 'main', tabs: [], activeTabId: null }],
  orientation: null,
  sizes: null,
  focusedGroupId: 'main',
});
```

**Limitação MVP:** apenas 2 groups max, 1 split max. Sem nesting (Cursor permite recursivo).

### Versão completa (igual Cursor — recursive tree)

```ts
type EditorNode =
  | { type: 'leaf'; group: EditorGroup }
  | { type: 'split'; orientation: 'horizontal' | 'vertical'; children: EditorNode[]; sizes: number[] };

const [editorTree, setEditorTree] = useState<EditorNode>({
  type: 'leaf',
  group: { id: 'main', tabs: [], activeTabId: null },
});
```

**Trade-off:** completa é Cursor-like mas 3-4× mais complexa. **Recomendo MVP**.

## Steps incrementais (MVP)

### Step 1: Refactor state shape sem mudar UX (1-2h)
- Trocar `centralTabs[]` por `editorLayout.groups[0].tabs`
- Trocar `activeCentralTabId` por `editorLayout.groups[0].activeTabId`
- Helpers: `getActiveGroup()`, `getAllTabs()`, `findTabById()`
- Todos os callbacks `setCentralTabs((prev) => ...)` viram `setEditorLayout((prev) => updateGroup(prev, 'main', ...))`
- **Garante:** UI 100% igual ao atual. Tests pass. Build ok.

**Risk:** médio (toca muitos callsites). Pattern: mantém API externa do CentralTabs igual.

### Step 2: Adicionar comando `editor.splitRight` (1h)
- Novo entry no `commandRegistry.ts`:
  ```ts
  { id: 'editor.splitRight', title: 'Split Editor Right', shortcut: ['Ctrl', '\\'], ... }
  { id: 'editor.splitDown', title: 'Split Editor Down', shortcut: ['Alt', '\\'], ... }
  ```
- Handler em App.tsx:
  ```ts
  case 'editor.splitRight':
    setEditorLayout((prev) => addSplitGroup(prev, 'horizontal'));
    break;
  ```
- Helper `addSplitGroup`: cria 2º group com mesma tab ativa duplicada.
- Hotkeys via `useEffect` global keydown.

**Risk:** baixo (só adiciona, não muda existing).

### Step 3: Renderizar 2 grupos lado-a-lado (2-3h)
- App.tsx render: trocar single `<CentralTabs>` por loop sobre `editorLayout.groups`
- Wrap em `<SplitPane orientation>` (já existe `SplitPane` em Layout)
- Cada `CentralTabs` recebe seu `group.tabs` + `group.activeTabId`
- Click em tab num grupo → `setFocusedGroupId(groupId)` + `selectTab(groupId, tabId)`

**Visual:**
```
┌─────────────┬─────────────┐
│ tab1│tab2 X │ tab3│tab4 X │
├─────────────┼─────────────┤
│             │             │
│  Monaco 1   │  Monaco 2   │
│             │             │
└─────────────┴─────────────┘
       ↕ resizer ↕
```

**Risk:** médio (refactor visual). Mitigar: SplitPane component já testado.

### Step 4: Close last tab → close group (1h)
- Quando user fecha última tab de um group:
  - Se há ≥2 groups → remove o group, layout vira `single` se ficar 1
  - Se é o único group → fica como hoje (welcome view)
- Update `focusedGroupId` se o focado fechou.

**Risk:** baixo (edge cases bem mapeados).

### Step 5: Drag-drop tab entre grupos (2-3h) — OPTIONAL polish
- `CentralTab` já tem drag listeners?
  - Verificar: tabs já são draggable pra reorder?
- Drop target: outro CentralTabs container
- Drop dispatch: `moveTabBetweenGroups(fromGroup, toGroup, tabId, insertIndex)`

**Risk:** alto (drag-drop sempre é flaky). Defer pra v2 do split.

### Step 6: Persistência (1h)
- localStorage save `editorLayout` quando muda
- Restore no boot
- Versionar: se shape mudar, fallback pra single group

**Risk:** baixo.

## Estimativa total

- **MVP (steps 1-4):** 5-7h trabalho focado
- **+ Drag-drop (step 5):** +2-3h
- **+ Persistence (step 6):** +1h
- **Total: 8-11h** pro UNDRCode ter Split Editor decente

## Risco geral

- **Step 1** é o mais crítico — refactor sem mudar UX. Se quebrar, tem que voltar atrás.
- **Step 3** mexe no render. Precisa testar zoom, scroll, focus, breadcrumbs.
- **Step 5** (drag-drop) pode ser pulado se ficar instável.

## Testes manuais sugeridos

1. Abrir 1 arquivo → Ctrl+\ → 2 painéis com mesmo arquivo
2. Mudar arquivo no painel direito → painel esquerdo não muda
3. Fechar tab do painel direito (X) → group fecha, volta pra single
4. Ctrl+\ duas vezes → ainda só 2 painéis (MVP limita)
5. Zoom no Monaco → afeta só o painel focado
6. Reload app → layout persiste (após step 6)

## Cursor command IDs pra replicar (subset MVP)

| Cursor cmd | UNDRCode cmd | Shortcut | Phase |
|---|---|---|---|
| `workbench.action.splitEditor` | `editor.split` | Ctrl+\ | Step 2 |
| `workbench.action.splitEditorRight` | `editor.splitRight` | Ctrl+\ | Step 2 |
| `workbench.action.splitEditorDown` | `editor.splitDown` | Alt+\ | Step 2 |
| `workbench.action.focusLeftGroup` | `editor.focusLeftGroup` | Ctrl+K Ctrl+← | Step 3 |
| `workbench.action.focusRightGroup` | `editor.focusRightGroup` | Ctrl+K Ctrl+→ | Step 3 |
| `workbench.action.closeEditorGroup` | `editor.closeGroup` | Ctrl+K W | Step 4 |
| `workbench.action.toggleMaximizeEditorGroup` | `editor.toggleMaximizeGroup` | Ctrl+K M | Polish |

## Próximo passo

Quando voltar, manda:
- **"implementa split editor"** → começo pelo Step 1
- **"continua audit"** → volta pro Shadow & Blur
- **"outra coisa"** → você diz o que quer

Doc atualiza com progresso conforme avanço.

---

## Progresso 2026-05-20 (sessão autônoma)

### ✅ Step 1 — State shape paralelo
**Approach:** state paralelo (não refactor dos 97 callsites originais). Adicionei em `App.tsx` linhas 130-152:
```ts
const [splitTabs, setSplitTabs] = useState<CentralTab[]>([]);
const [activeSplitTabId, setActiveSplitTabId] = useState<string | null>(null);
const [isSplitActive, setIsSplitActive] = useState(false);
const [splitOrientation, setSplitOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
const [focusedEditorGroup, setFocusedEditorGroup] = useState<'primary' | 'secondary'>('primary');
const splitTabsRef = useRef<CentralTab[]>([]);
const activeSplitTabIdRef = useRef<string | null>(null);
```

**Impacto visual:** ZERO. `isSplitActive` default false → nenhum render novo.
**Build:** ✓ passou
**UX:** 100% idêntica ao anterior

### ✅ Step 2 — Comandos no palette + handlers
**Adicionados em `commandRegistry.ts`:**
- `editor.splitRight` (Ctrl+\) — Split Editor Right
- `editor.splitDown` (Alt+\) — Split Editor Down
- `editor.closeOtherGroup` — Close Other Editor Group
- `editor.focusOtherGroup` — Focus Other Editor Group

**Handlers em `App.tsx` `handleCommandExec`:**
- `splitRight/splitDown`: ativa `isSplitActive`, duplica tab ativa pro `splitTabs`, foco vai pro secondary
- `closeOtherGroup`: zera splitTabs, isSplitActive=false, foco volta pro primary
- `focusOtherGroup`: alterna `focusedEditorGroup` entre primary/secondary

**Impacto visual:** ZERO ainda. Comandos só mutam state que NÃO é renderizado.
**Build:** ✓ passou
**UX:** Quando user invoca Ctrl+\ via palette, NADA acontece visualmente (esperado — render é Step 3)

### ⏸ Step 3 — Render 2 grupos (PARADO — precisa supervisão visual)
**Por que parei:** Step 3 mexe em ~100 linhas do JSX principal (`pane-mid-editor`). Sem você reload + screenshot a cada mudança, risco de quebrar functionality silently.

**Pra retomar:**
1. Você reload app
2. Abra Ctrl+Shift+P → procura "Split Editor Right" → confirma que aparece
3. Click → state muda mas UI ainda single (esperado)
4. Me manda OK → eu codo Step 3 com você acompanhando

### 🧪 Como testar o que tá feito (Step 1+2)
1. Reload app
2. Ctrl+Shift+P → digite "split" → deve aparecer 4 comandos novos
3. Cmd executa mas UI não muda (esperado)
4. Sem regressão em nenhuma feature existente

### 📦 Backup
- `C:\Users\taked\Desktop\akai-code\.backups\split-editor-20260520-151508\`
- Arquivos: App.tsx, CentralTabs.tsx, CentralTabs.css, commandRegistry.ts
- Restore: copia de volta se algo quebrar

### ⏭️ Próximos steps (Step 3+)
- Step 3 (render 2 grupos via SplitPane) — ✅ feito 2026-05-20
- Step 4 (close last tab → close group) — ✅ feito junto Step 3 (useEffect auto-close)
- Step 5 (drag-drop tabs entre grupos) — pendente
- Step 6 (persistência localStorage) — pendente

### 🐛 Bugs corrigidos Step 3 (pós primeiro teste)

**Bug 1: Atalho Ctrl+\\ não disparava no teclado BR (ABNT2)**
- `e.key === '\\'` falha em teclados PT-BR porque a tecla física do `\` está em posição diferente
- Fix: usar `e.code === 'Backslash'` (posição física, cross-layout) + fallback `e.key === '\\'`

**Bug 2: Stale closure no handleCommandExec**
- `handleCommandExec` é `useCallback` com deps limitadas (`[handleOpenWorkspace, openGitDiff, handleCompareFiles, ...]`)
- Mexo em `centralTabs`/`isSplitActive` dentro do handler mas elas NÃO estão nas deps
- Resultado: callback captura state vazio inicial — `if (centralTabs.length === 0) break` cancela sempre
- Fix: ler via refs (`centralTabsRef.current`, `activeCentralTabIdRef.current`) que sempre têm valor atual
- Bonus: agora Ctrl+\\ alterna (toggle on/off) igual Cursor
