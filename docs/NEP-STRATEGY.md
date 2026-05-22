# Next Edit Prediction (NEP) — Strategy Document

> UNDRCode · Maio 2026

## Resumo executivo

Inline autocomplete (ghost text estilo Copilot) via CLI do Claude e **inviavel** — TTFT medido de **8-18 segundos** (benchmark real, Spike A, 20/05/2026). O plano Max tambem nao comporta o volume de requests necessario (~950-1900/dia).

A alternativa: **Next Edit Prediction** — detectar o que o usuario acabou de editar e sugerir automaticamente onde mais no arquivo precisa da mesma mudanca. Sem IA, sem custo, sem latencia.

---

## Decisao: por que NEP e nao inline autocomplete

| Criterio | Inline Autocomplete | NEP (nossa estrategia) |
|----------|---------------------|------------------------|
| TTFT via CLI | 8-18s (inviavel) | N/A (nao usa CLI) |
| Custo | API separada ~$5-15/mes OU rate limit do Max | **$0** |
| Dependencia | CLI + internet + plano ativo | **Nenhuma** (roda offline) |
| GPU | Modelo local precisa GPU | **Nao precisa** |
| Cobertura | ~90% (modelo FIM treinado) | **~75%** (patterns + Monaco LS) |
| Diferencial | Todo mundo ja faz igual | **Proativo, zero custo, zero config** |

### Benchmark que matou inline autocomplete (20/05/2026)

```
One-shot Haiku via CLI (--output-format stream-json --verbose):

  small  (10 linhas):   TTFT mediana =  8.757ms  (range 4.261-9.624s)
  medium (50+20 linhas): TTFT mediana = 16.508ms  (range 14.391-20.931s)
  large  (100+50 linhas): TTFT mediana = 18.284ms  (range 13.866-25.976s)

  Causa: CLI injeta ~50K-85K tokens de system prompt + tool definitions
         por request. O prompt do usuario representa ~10 tokens.
```

---

## Arquitetura

```
                     Usuario edita codigo
                            |
                            v
                  +-------------------+
                  |   EditObserver    |  (Monaco onDidChangeModelContent)
                  |   Diff detector   |
                  +-------------------+
                            |
                            v
           +--------------------------------+
           |       Pattern Matcher          |
           |                                |
           |  1. Monaco Language Service    |  <-- rename/references (preciso)
           |     findRenameLocations()      |
           |     getReferencesAtPosition()  |
           |                                |
           |  2. Pattern Table (regex)      |  <-- 60+ padroes predefinidos
           |     detect() -> findTargets()  |
           |                                |
           |  3. [Opcional] Tier 2 IA       |  <-- CLI Haiku background
           |     opt-in, consome rate limit |
           +--------------------------------+
                            |
                            v
                  +-------------------+
                  |  Suggestion Cache |  (LRU, max 10 por arquivo)
                  +-------------------+
                            |
                            v
                  +-------------------+
                  | Ghost Edit Render |  (Monaco decorations API)
                  |                   |
                  | - Gutter dots     |  (indicador dourado)
                  | - Inline diff     |  (vermelho/verde)
                  | - Tab aceita      |
                  | - Tab Tab Tab     |  (pula pra proxima)
                  | - Esc descarta    |
                  +-------------------+
```

### Componentes

| Componente | Arquivo | Responsabilidade |
|-----------|---------|------------------|
| `EditObserver` | `src/renderer/nep/edit-observer.ts` | Escuta edits do Monaco, gera diffs |
| `PatternMatcher` | `src/renderer/nep/pattern-matcher.ts` | Orquestra LS + patterns, gera sugestoes |
| `PatternRegistry` | `src/renderer/nep/patterns/index.ts` | Tabela de padroes registrados |
| `SuggestionCache` | `src/renderer/nep/suggestion-cache.ts` | LRU cache de sugestoes pendentes |
| `GhostEditRenderer` | `src/renderer/nep/ghost-edit-renderer.ts` | Renderiza decorations no Monaco |
| `NepStatusBar` | `src/renderer/nep/nep-status.ts` | "3 edits sugeridos" no statusbar |

### Separacao de tiers

```
Tier 1A — Monaco Language Service (precisao maxima)
  Quando: rename de simbolo detectado
  Como:   findRenameLocations() / getReferencesAtPosition()
  Custo:  $0, ~5-20ms
  Cobre:  rename, find references

Tier 1B — Pattern Table (cobertura ampla)
  Quando: edit casa com um padrao registrado
  Como:   regex + heuristicas no arquivo atual
  Custo:  $0, ~1-5ms
  Cobre:  type annotations, syntax modernization, string replace, etc.

Tier 2 — CLI Claude background (opt-in)
  Quando: usuario ativa toggle, edit nao casou com Tier 1
  Como:   CLI Haiku --input-format stream-json
  Custo:  rate limit do plano Max (~2K tokens/request)
  Cobre:  refactoring estrutural, padroes complexos
  Cap:    max 15 requests/hora (configuravel)
```

---

## Pattern Table

### Interface

```typescript
interface EditPattern {
  /** Identificador unico */
  id: string;
  /** Nome legivel */
  name: string;
  /** Linguagens onde aplica ('*' = todas) */
  languages: string[];
  /**
   * Analisa o diff e retorna Match se o padrao casou.
   * Recebe: texto antes, texto depois, contexto do arquivo.
   */
  detect(before: string, after: string, ctx: PatternContext): PatternMatch | null;
  /**
   * Dado o match, busca outros lugares no arquivo pra aplicar.
   * Retorna lista de sugestoes de edit.
   */
  findTargets(fileContent: string, match: PatternMatch, ctx: PatternContext): EditSuggestion[];
}

interface PatternContext {
  filePath: string;
  languageId: string;
  /** Numero da linha editada (1-based) */
  lineNumber: number;
  /** Conteudo completo do arquivo */
  fullText: string;
  /** Modelo do Monaco (pra LS queries) */
  model: monaco.editor.ITextModel;
}

interface PatternMatch {
  patternId: string;
  /** Token/texto original */
  oldToken: string;
  /** Token/texto novo */
  newToken: string;
  /** Metadata extra pro findTargets */
  meta?: Record<string, unknown>;
}

interface EditSuggestion {
  /** Linha onde a sugestao aplica */
  line: number;
  /** Coluna inicial */
  startCol: number;
  /** Coluna final */
  endCol: number;
  /** Texto atual nessa posicao */
  currentText: string;
  /** Texto sugerido */
  suggestedText: string;
  /** Confianca 0-1 */
  confidence: number;
  /** ID do padrao que gerou */
  patternId: string;
}
```

### Catalogo de padroes — Release 1 (20 padroes)

#### Universais (qualquer linguagem)

| ID | Padrao | Deteccao | Busca |
|----|--------|----------|-------|
| `u-rename` | Rename de token | Diff: token A vira B (word boundary) | Grep `\bA\b` no arquivo |
| `u-string-replace` | Trocar string literal | `"textoA"` → `"textoB"` | Grep `"textoA"` |
| `u-number-replace` | Trocar numero | `3000` → `3001` | Grep `3000` (word boundary) |
| `u-typo-fix` | Corrigir typo | Levenshtein ≤ 2 num token | Grep token original |
| `u-operator-swap` | Trocar operador | `==` → `===`, `!=` → `!==` | Grep operador antigo |
| `u-comment-update` | Atualizar comentario | Padrao `// vN` ou `/* texto */` | Grep padrao antigo |

#### JavaScript / TypeScript

| ID | Padrao | Deteccao | Busca |
|----|--------|----------|-------|
| `js-var-to-const` | `var` → `let`/`const` | Keyword swap | Outros `var ` no arquivo |
| `js-require-to-import` | `require()` → `import` | Statement pattern | Outros `require(` |
| `js-then-to-await` | `.then()` → `async/await` | Chain removed | Outros `.then(` |
| `js-func-to-arrow` | `function` → arrow | Declaration mudou | Outras `function ` nao-metodo |
| `js-concat-to-template` | `"a" + b` → `` `a${b}` `` | String concat removida | Outros `" +` ou `+ "` |
| `ts-add-type-annotation` | `useState()` → `useState<T>()` | Generic adicionado | Outros `useState()` sem `<` |
| `ts-any-to-type` | `: any` → `: TipoReal` | Type annotation melhorada | Outros `: any` |
| `ts-optional-chain` | `obj.prop` → `obj?.prop` | `?.` adicionado | Outros acessos ao mesmo obj |
| `js-console-cleanup` | `console.log` removido | Linha com `console.log` deletada | Outros `console.log` |
| `js-equality-strict` | `==` → `===` | Operador trocado | Outros `==` (nao `===`) |

#### React

| ID | Padrao | Deteccao | Busca |
|----|--------|----------|-------|
| `react-add-type-usestate` | `useState()` sem tipo → com tipo | `<T>` adicionado apos useState | Outros `useState(` sem `<` |
| `react-inline-to-class` | `style={{}}` → className | style prop removida | Outros `style={{` |

#### CSS

| ID | Padrao | Deteccao | Busca |
|----|--------|----------|-------|
| `css-px-to-rem` | `16px` → `1rem` | Unidade trocada | Outros valores em `px` |
| `css-hex-to-var` | `#c9a961` → `var(--gold)` | Hex virou var() | Outros hex iguais |

### Catalogo — Release 2 (+ 20 padroes)

| ID | Padrao |
|----|--------|
| `js-default-to-named-export` | `export default` → `export const` |
| `js-callback-to-promise` | Callback pattern → async/await |
| `js-object-assign-to-spread` | `Object.assign` → `{ ...obj }` |
| `js-foreach-to-forof` | `.forEach()` → `for...of` |
| `ts-add-return-type` | Funcao sem return type → com return type |
| `ts-interface-add-field` | Campo adicionado → propagar em implementacoes |
| `react-did-mount-to-effect` | `componentDidMount` → `useEffect` |
| `react-this-state-to-hook` | `this.state.x` → `useState` |
| `react-this-props-destruct` | `this.props.x` → destructured |
| `react-class-to-functional` | Class component → functional |
| `css-important-cleanup` | `!important` removido |
| `css-margin-to-token` | Valor hardcoded → design token |
| `css-shorthand` | `margin: 8px 8px 8px 8px` → `margin: 8px` |
| `html-class-rename` | className trocado → outros elementos com classe antiga |
| `json-key-rename` | Chave de objeto renomeada → outras ocorrencias |
| `u-url-replace` | URL trocada → outras ocorrencias |
| `u-env-var-rename` | Variavel de ambiente renomeada |
| `u-version-bump` | Versao trocada → outros arquivos |
| `u-add-error-handling` | try/catch adicionado → funcoes similares |
| `u-negate-condition` | Condicao negada + branches invertidos |

### Catalogo — Release 3 (+ 20 padroes, multi-arquivo)

| ID | Padrao |
|----|--------|
| `xf-rename-export` | Export renomeado → imports em outros arquivos |
| `xf-add-param` | Parametro adicionado → call sites |
| `xf-move-file` | Arquivo movido → imports com path antigo |
| `xf-change-return-type` | Return type mudou → consumidores |
| `xf-rename-css-class` | Classe CSS renomeada → JSX/HTML |
| ... | (expandir conforme uso) |

---

## UX

### Ghost Edit visual

```
   10 │ const [loading, setLoading] = useState<boolean>(false);  ← edit do usuario
   11 │ const [error, setError] = useState(null);
      │                           useState<string | null>(null)   ← ghost edit (cinza)
   12 │ const [users, setUsers] = useState([]);
 ● 12 │                           useState<User[]>([])            ← ghost edit (cinza)
```

- **Gutter dot** (●) dourado nas linhas com sugestao pendente
- **Ghost text** cinza mostrando a mudanca sugerida
- **Tab** aceita a sugestao e pula pro proximo dot
- **Esc** descarta todas as sugestoes
- **Ctrl+Shift+Enter** aceita todas de uma vez

### StatusBar

```
┌────────────────────────────────────────────────────┐
│ main ↑0 ↓0  │  0 errors  0 warnings  │  NEP: 3 ●  │
└────────────────────────────────────────────────────┘
```

Click no "NEP: 3 ●" abre quick pick com lista dos edits sugeridos.

### Configuracoes

```jsonc
// settings.json
{
  "nep.enabled": true,           // liga/desliga NEP
  "nep.tier2.enabled": false,    // Tier 2 IA (opt-in)
  "nep.tier2.maxPerHour": 15,    // cap de requests IA/hora
  "nep.tier2.model": "haiku",    // modelo pro Tier 2
  "nep.showGutterDots": true,    // dots dourados na gutter
  "nep.autoAcceptRename": false, // aceitar renames automaticamente
  "nep.multiFile": false         // Release 3: busca cross-arquivo
}
```

### Atalhos

| Atalho | Acao |
|--------|------|
| `Tab` (quando ghost edit visivel) | Aceita sugestao, pula pra proxima |
| `Esc` | Descarta todas as sugestoes |
| `Ctrl+Shift+Enter` | Aceita todas de uma vez |
| `Alt+]` | Proxima sugestao (sem aceitar) |
| `Alt+[` | Sugestao anterior |
| `Ctrl+Alt+N` | Toggle NEP on/off |

---

## Fluxo de dados

```
1. Usuario edita linha 10: getUser → fetchUser
                |
2. EditObserver captura:
   before = "  const user = getUser(id);"
   after  = "  const user = fetchUser(id);"
                |
3. PatternMatcher testa:
   a) Monaco LS: "rename de simbolo?"
      → findRenameLocations('getUser', pos) retorna posicoes
      → SE retornou: usa essas (precisao maxima)
      → SENAO: fallback pra regex
   b) Pattern Table: u-rename detecta tokenA='getUser', tokenB='fetchUser'
      → grep /\bgetUser\b/ no arquivo
      → encontra linhas 45, 89, 112
      → filtra: linha 10 ja editada, remove
      → resultado: linhas 45, 89, 112
                |
4. SuggestionCache armazena 3 sugestoes
                |
5. GhostEditRenderer:
   → adiciona gutter dots nas linhas 45, 89, 112
   → quando cursor chega na linha 45:
     mostra ghost edit "getUser(uid)" → "fetchUser(uid)"
                |
6. Usuario aperta Tab:
   → aplica edit na linha 45
   → cursor pula pra linha 89
   → mostra ghost edit na linha 89
                |
7. Tab de novo → aplica linha 89, pula pra 112
   Tab de novo → aplica linha 112, sugestoes esgotadas
                |
8. SuggestionCache limpa, gutter dots removidos
```

---

## Comparativo competitivo

| Feature | JetBrains | Cursor Tab | Copilot NES | **UNDRCode NEP** |
|---------|-----------|------------|-------------|------------------|
| Deteccao automatica | ❌ Manual | ✅ | ✅ | ✅ |
| Tab-Tab-Tab flow | ❌ Dialog | ✅ | ✅ | ✅ |
| Precisa IA | ❌ AST puro | ✅ Modelo custom | ✅ Modelo custom | **❌ Opcional** |
| Custo | $0 (incluso no IDE) | $20/mes | $10/mes | **$0** |
| Funciona offline | ✅ | ❌ | ❌ | **✅** |
| Precisa GPU | ❌ | ❌ (cloud) | ❌ (cloud) | **❌** |
| Rename preciso | ✅ AST | ✅ Modelo | ✅ Modelo | ✅ **Monaco LS** |
| Patterns extensiveis | ❌ Fixos | ❌ Modelo | ❌ Modelo | ✅ **Tabela aberta** |
| Qualidade refactoring complexo | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ (sem IA) |
| Latencia | ~50ms | ~200-400ms | ~200-400ms | **~1-20ms** |

### Onde ganhamos
- **Zero custo, zero config, zero dependencia**
- **Funciona offline**
- **Mais rapido** (1-20ms vs 200-400ms)
- **Tabela extensivel** por comunidade

### Onde perdemos
- **Refactoring estrutural complexo** (extract function, inline variable) — so com Tier 2 IA
- **Cobertura de edge cases** — modelo treinado pega mais variantes
- **Multi-arquivo** (Release 3, nao v1)

---

## Plano de implementacao

### Sprint 1 — Foundation (3-4 dias)

- [ ] `EditObserver`: hook no Monaco `onDidChangeModelContent`, gera diffs
- [ ] `PatternMatcher`: orquestrador com pipeline LS → Patterns → Cache
- [ ] `PatternRegistry`: sistema de registro + 6 padroes universais
- [ ] `SuggestionCache`: LRU com invalidacao por edit
- [ ] `GhostEditRenderer`: decorations basicas (ghost text + gutter dot)
- [ ] Keybindings: Tab aceita, Esc descarta
- [ ] Testes unitarios pros 6 padroes

### Sprint 2 — JS/TS Patterns (3-4 dias)

- [ ] 10 padroes JavaScript/TypeScript
- [ ] 2 padroes React
- [ ] 2 padroes CSS
- [ ] Integracao Monaco LS pra rename (findRenameLocations)
- [ ] StatusBar "NEP: N ●"
- [ ] Tab-Tab-Tab flow completo (aceitar + pular)
- [ ] Ctrl+Shift+Enter (aceitar todos)
- [ ] Setting `nep.enabled` em settings.json

### Sprint 3 — Polish + Tier 2 (4-5 dias)

- [ ] + 20 padroes (Release 2)
- [ ] Tier 2 IA opt-in (CLI Haiku background com cap/hora)
- [ ] Configuracoes completas no settings
- [ ] Alt+]/[ pra navegar sugestoes
- [ ] Confidence threshold (sugestoes com confianca < 0.5 nao mostram)
- [ ] Animacao suave no ghost text (fade in 150ms)
- [ ] Metricas locais (aceites vs rejeicoes, salvas em localStorage)

### Sprint 4 — Multi-arquivo (futuro)

- [ ] Release 3: patterns cross-arquivo
- [ ] Grep em arquivos importados
- [ ] Rename export → update imports
- [ ] Move file → update paths

---

## Riscos e mitigacoes

| Risco | Probabilidade | Mitigacao |
|-------|--------------|-----------|
| Falso positivo (sugestao errada) | Media | Confidence threshold + facil descarte (Esc) |
| Falso negativo (nao detecta) | Baixa pra rename, media pra outros | Tabela extensivel, Tier 2 como fallback |
| Tab conflict com autocomplete | Alta | Ghost edit so aparece quando NAO tem autocomplete ativo |
| Performance com arquivos grandes | Baixa | Grep limitado a 1000 linhas, timeout 50ms |
| Monaco LS nao disponivel | Baixa | Fallback pra regex |

---

## Metricas de sucesso

| Metrica | Target v1 |
|---------|-----------|
| Padroes de edit detectados | ≥ 70% dos renames + replaces |
| Falsos positivos | < 10% |
| Aceite de sugestoes (Tab) | ≥ 40% |
| Latencia detect → ghost | < 50ms |
| Overhead de CPU | < 2% |

---

## Conclusao

NEP via pattern matching local e a estrategia correta pro UNDRCode porque:

1. **Custo zero** — nao consome rate limit, nao precisa API, nao precisa GPU
2. **Latencia zero** — 1-20ms vs 200-400ms dos concorrentes
3. **Funciona sempre** — offline, sem conta, sem plano
4. **Extensivel** — comunidade pode adicionar padroes
5. **Diferenciador real** — combina proatividade do Cursor com precisao do JetBrains

O Tier 2 com IA fica como bonus opt-in pra usuarios que querem cobertura maxima e aceitam o trade-off de rate limit.
