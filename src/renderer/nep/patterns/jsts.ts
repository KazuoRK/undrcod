/**
 * JavaScript / TypeScript patterns.
 *
 * 10 patterns: js-var-to-const, js-require-to-import, js-then-to-await,
 * js-func-to-arrow, js-concat-to-template, ts-add-type-annotation,
 * ts-any-to-type, ts-optional-chain, js-console-cleanup, js-equality-strict.
 */

import type { EditPattern, EditSuggestion, PatternMatch } from '../types';
import { escapeRegex, findTokenLocations } from '../types';

const JS_LANGS = ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'];
const TS_LANGS = ['typescript', 'typescriptreact'];

/**
 * js-var-to-const — detecta troca de `var` por `let`/`const` na linha e
 * propaga pra outras declarações `var` do arquivo, usando o keyword que
 * o user acabou de escolher.
 */
const jsVarToConst: EditPattern = {
  id: 'js-var-to-const',
  name: 'var → let/const',
  languages: JS_LANGS,
  detect(before, after) {
    const beforeVar = /\bvar\s+/.test(before);
    if (!beforeVar) return null;
    const afterLet = /\blet\s+/.test(after);
    const afterConst = /\bconst\s+/.test(after);
    if (!afterLet && !afterConst) return null;
    // só sugere forward (var → let/const)
    const newKeyword = afterConst ? 'const' : 'let';
    return {
      patternId: 'js-var-to-const',
      oldToken: 'var',
      newToken: newKeyword,
      sourceLine: 0,
    };
  },
  findTargets(fileContent, match, ctx) {
    const lines = fileContent.split('\n');
    const out: EditSuggestion[] = [];
    const re = /\bvar\b(?=\s+[A-Za-z_$])/g;
    const limit = Math.min(lines.length, 2000);
    for (let i = 0; i < limit; i++) {
      const lineNumber = i + 1;
      if (lineNumber === ctx.lineNumber) continue;
      const lineText = lines[i];
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lineText)) !== null) {
        out.push({
          line: lineNumber,
          startCol: m.index + 1,
          endCol: m.index + 4,
          currentText: 'var',
          suggestedText: match.newToken,
          confidence: 0.8,
          patternId: 'js-var-to-const',
        });
        if (out.length >= 50) return out;
      }
    }
    return out;
  },
};

/**
 * js-require-to-import — detecta `const X = require('mod')` virando
 * `import X from 'mod'` (ou destructured) e sugere a mesma reescrita em
 * outros requires do arquivo, preservando nome e path do módulo.
 */
const jsRequireToImport: EditPattern = {
  id: 'js-require-to-import',
  name: 'require → import',
  languages: JS_LANGS,
  detect(before, after) {
    const reqRe = /\bconst\s+(\{[^}]+\}|[A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/;
    const impRe = /\bimport\s+(?:\{[^}]+\}|[A-Za-z_$][\w$]*|\*\s+as\s+[A-Za-z_$][\w$]*)\s+from\s+['"][^'"]+['"]/;
    if (!reqRe.test(before)) return null;
    if (!impRe.test(after)) return null;
    return {
      patternId: 'js-require-to-import',
      oldToken: 'require',
      newToken: 'import',
      sourceLine: 0,
    };
  },
  findTargets(fileContent, _match, ctx) {
    const lines = fileContent.split('\n');
    const out: EditSuggestion[] = [];
    const reqRe = /^(\s*)const\s+(\{[^}]+\}|[A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*(['"])([^'"]+)\3\s*\)\s*;?\s*$/;
    const limit = Math.min(lines.length, 2000);
    for (let i = 0; i < limit; i++) {
      const lineNumber = i + 1;
      if (lineNumber === ctx.lineNumber) continue;
      const lineText = lines[i];
      const m = reqRe.exec(lineText);
      if (!m) continue;
      const indent = m[1];
      const binding = m[2];
      const quote = m[3];
      const modulePath = m[4];
      const isDestructured = binding.startsWith('{');
      const importLine = isDestructured
        ? `${indent}import ${binding} from ${quote}${modulePath}${quote};`
        : `${indent}import ${binding} from ${quote}${modulePath}${quote};`;
      out.push({
        line: lineNumber,
        startCol: 1,
        endCol: lineText.length + 1,
        currentText: lineText,
        suggestedText: importLine,
        confidence: 0.75,
        patternId: 'js-require-to-import',
      });
      if (out.length >= 50) return out;
    }
    return out;
  },
};

/**
 * js-then-to-await — detecta `.then(x => ...)` virando `const x = await ...`
 * e flagga outros `.then(` no arquivo como candidatos pra reescrita.
 * Heurístico — confidence baixa, user vai precisar revisar.
 */
const jsThenToAwait: EditPattern = {
  id: 'js-then-to-await',
  name: '.then() → await',
  languages: JS_LANGS,
  detect(before, after) {
    if (!/\.then\s*\(/.test(before)) return null;
    if (!/\bawait\b/.test(after)) return null;
    if (/\.then\s*\(/.test(after)) return null;
    return {
      patternId: 'js-then-to-await',
      oldToken: '.then',
      newToken: 'await',
      sourceLine: 0,
    };
  },
  findTargets(fileContent, _match, ctx) {
    const lines = fileContent.split('\n');
    const out: EditSuggestion[] = [];
    const thenRe = /([A-Za-z_$][\w$.]*)\.then\s*\(\s*(?:\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*)?/g;
    const limit = Math.min(lines.length, 2000);
    for (let i = 0; i < limit; i++) {
      const lineNumber = i + 1;
      if (lineNumber === ctx.lineNumber) continue;
      const lineText = lines[i];
      thenRe.lastIndex = 0;
      const m = thenRe.exec(lineText);
      if (!m) continue;
      const callee = m[1];
      const argName = m[2] ?? 'result';
      // sugere uma reescrita aproximada — user revisa
      const indentMatch = /^(\s*)/.exec(lineText);
      const indent = indentMatch ? indentMatch[1] : '';
      const suggested = `${indent}const ${argName} = await ${callee};`;
      out.push({
        line: lineNumber,
        startCol: 1,
        endCol: lineText.length + 1,
        currentText: lineText,
        suggestedText: suggested,
        confidence: 0.55,
        patternId: 'js-then-to-await',
      });
      if (out.length >= 50) return out;
    }
    return out;
  },
};

/**
 * js-func-to-arrow — detecta `function name(args) {}` virando
 * `const name = (args) => {}` e sugere o mesmo pra outras declarações
 * top-level. Skippa funções dentro de classes (heurística por indent).
 */
const jsFuncToArrow: EditPattern = {
  id: 'js-func-to-arrow',
  name: 'function → arrow',
  languages: JS_LANGS,
  detect(before, after) {
    const fnRe = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/;
    const arrowRe = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\(?[^)]*\)?\s*=>/;
    const beforeMatch = fnRe.exec(before);
    if (!beforeMatch) return null;
    const afterMatch = arrowRe.exec(after);
    if (!afterMatch) return null;
    if (beforeMatch[1] !== afterMatch[1]) return null;
    return {
      patternId: 'js-func-to-arrow',
      oldToken: 'function',
      newToken: 'const',
      sourceLine: 0,
    };
  },
  findTargets(fileContent, _match, ctx) {
    const lines = fileContent.split('\n');
    const out: EditSuggestion[] = [];
    // só top-level / module-level — pula linhas muito indentadas (provável método de classe)
    const fnRe = /^(\s*)(export\s+)?(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/;
    const limit = Math.min(lines.length, 2000);
    for (let i = 0; i < limit; i++) {
      const lineNumber = i + 1;
      if (lineNumber === ctx.lineNumber) continue;
      const lineText = lines[i];
      const m = fnRe.exec(lineText);
      if (!m) continue;
      const indent = m[1];
      // heurística: > 2 níveis de indent provavelmente é método
      if (indent.length > 4) continue;
      const exp = m[2] ?? '';
      const asyncKw = m[3] ?? '';
      const name = m[4];
      const args = m[5];
      const replaced = `${indent}${exp}const ${name} = ${asyncKw}(${args}) =>`;
      const matchEnd = m.index + m[0].length;
      out.push({
        line: lineNumber,
        startCol: 1,
        endCol: matchEnd + 1,
        currentText: lineText.slice(0, matchEnd),
        suggestedText: replaced,
        confidence: 0.6,
        patternId: 'js-func-to-arrow',
      });
      if (out.length >= 50) return out;
    }
    return out;
  },
};

/**
 * js-concat-to-template — detecta concat com `+` virando template literal
 * e flagga outras linhas com pattern de concat (`"x" + y` ou `y + "x"`)
 * como candidatas. Heurístico, só marca pro user revisar.
 */
const jsConcatToTemplate: EditPattern = {
  id: 'js-concat-to-template',
  name: 'concat → template literal',
  languages: JS_LANGS,
  detect(before, after) {
    const concatRe = /["'][^"']*["']\s*\+\s*\w+|\w+\s*\+\s*["'][^"']*["']/;
    if (!concatRe.test(before)) return null;
    if (!/`[^`]*\$\{[^}]+\}[^`]*`/.test(after)) return null;
    return {
      patternId: 'js-concat-to-template',
      oldToken: '+',
      newToken: '`',
      sourceLine: 0,
    };
  },
  findTargets(fileContent, _match, ctx) {
    const lines = fileContent.split('\n');
    const out: EditSuggestion[] = [];
    const concatRe = /(["'][^"']*["']\s*\+\s*[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*\s*\+\s*["'][^"']*["'])/;
    const limit = Math.min(lines.length, 2000);
    for (let i = 0; i < limit; i++) {
      const lineNumber = i + 1;
      if (lineNumber === ctx.lineNumber) continue;
      const lineText = lines[i];
      const m = concatRe.exec(lineText);
      if (!m) continue;
      out.push({
        line: lineNumber,
        startCol: m.index + 1,
        endCol: m.index + m[0].length + 1,
        currentText: m[0],
        suggestedText: m[0], // placeholder — user revisa
        confidence: 0.55,
        patternId: 'js-concat-to-template',
      });
      if (out.length >= 50) return out;
    }
    return out;
  },
};

/**
 * ts-add-type-annotation — detecta `useState()` recebendo generic
 * (`useState<Type>()`) e sugere o mesmo generic em outros `useState(`
 * do arquivo que ainda não têm.
 */
const tsAddTypeAnnotation: EditPattern = {
  id: 'ts-add-type-annotation',
  name: 'add generic type',
  languages: TS_LANGS,
  detect(before, after) {
    const callRe = /\b(useState|useRef|useMemo|useCallback|useReducer)\b/;
    const beforeMatch = callRe.exec(before);
    if (!beforeMatch) return null;
    const fnName = beforeMatch[1];
    // before NÃO tem generic, after TEM
    const beforeHasGeneric = new RegExp(`\\b${fnName}\\s*<`).test(before);
    const afterHasGeneric = new RegExp(`\\b${fnName}\\s*<([^>]+)>`).exec(after);
    if (beforeHasGeneric) return null;
    if (!afterHasGeneric) return null;
    return {
      patternId: 'ts-add-type-annotation',
      oldToken: fnName,
      newToken: `${fnName}<${afterHasGeneric[1]}>`,
      sourceLine: 0,
      meta: { fnName, generic: afterHasGeneric[1] },
    };
  },
  findTargets(fileContent, match, ctx) {
    const fnName = (match.meta?.fnName as string) ?? 'useState';
    const generic = (match.meta?.generic as string) ?? '';
    if (!generic) return [];
    const lines = fileContent.split('\n');
    const out: EditSuggestion[] = [];
    // procura `useState(` SEM generic (não seguido de `<`)
    const re = new RegExp(`\\b${escapeRegex(fnName)}\\b(?!\\s*<)(?=\\s*\\()`, 'g');
    const limit = Math.min(lines.length, 2000);
    for (let i = 0; i < limit; i++) {
      const lineNumber = i + 1;
      if (lineNumber === ctx.lineNumber) continue;
      const lineText = lines[i];
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lineText)) !== null) {
        out.push({
          line: lineNumber,
          startCol: m.index + 1,
          endCol: m.index + fnName.length + 1,
          currentText: fnName,
          suggestedText: `${fnName}<${generic}>`,
          confidence: 0.75,
          patternId: 'ts-add-type-annotation',
        });
        if (out.length >= 50) return out;
      }
    }
    return out;
  },
};

/**
 * ts-any-to-type — detecta `: any` sendo trocado por tipo específico e
 * sugere o mesmo tipo em outros `: any` do arquivo. Confidence baixa
 * porque outros locais podem precisar de tipo diferente.
 */
const tsAnyToType: EditPattern = {
  id: 'ts-any-to-type',
  name: ': any → : Type',
  languages: TS_LANGS,
  detect(before, after) {
    const anyRe = /:\s*any\b/;
    if (!anyRe.test(before)) return null;
    // after tem `:` seguido de algo que NÃO é any
    const newTypeRe = /:\s*([A-Za-z_$][\w$<>[\],\s|&]*?)(?=[=;,)\]}]|$)/;
    const afterMatch = newTypeRe.exec(after);
    if (!afterMatch) return null;
    const newType = afterMatch[1].trim();
    if (newType === 'any' || !newType) return null;
    return {
      patternId: 'ts-any-to-type',
      oldToken: 'any',
      newToken: newType,
      sourceLine: 0,
      meta: { newType },
    };
  },
  findTargets(fileContent, match, ctx) {
    const newType = (match.meta?.newType as string) ?? match.newToken;
    const lines = fileContent.split('\n');
    const out: EditSuggestion[] = [];
    const anyRe = /:\s*any\b/g;
    const limit = Math.min(lines.length, 2000);
    for (let i = 0; i < limit; i++) {
      const lineNumber = i + 1;
      if (lineNumber === ctx.lineNumber) continue;
      const lineText = lines[i];
      anyRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = anyRe.exec(lineText)) !== null) {
        // localizar exatamente o "any" dentro do match
        const matched = m[0];
        const anyOffset = matched.lastIndexOf('any');
        const startCol = m.index + anyOffset + 1;
        out.push({
          line: lineNumber,
          startCol,
          endCol: startCol + 3,
          currentText: 'any',
          suggestedText: newType,
          confidence: 0.5,
          patternId: 'ts-any-to-type',
        });
        if (out.length >= 50) return out;
      }
    }
    return out;
  },
};

/**
 * ts-optional-chain — detecta `obj.prop` virando `obj?.prop` e sugere
 * a mesma reescrita pros outros accesses do mesmo `obj.prop` no arquivo.
 */
const tsOptionalChain: EditPattern = {
  id: 'ts-optional-chain',
  name: '.prop → ?.prop',
  languages: TS_LANGS,
  detect(before, after) {
    // pattern: obj.prop em before, obj?.prop em after, mesmo obj+prop
    const accessRe = /([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g;
    const beforeMatches: Array<{ obj: string; prop: string }> = [];
    let m: RegExpExecArray | null;
    accessRe.lastIndex = 0;
    while ((m = accessRe.exec(before)) !== null) {
      beforeMatches.push({ obj: m[1], prop: m[2] });
    }
    if (beforeMatches.length === 0) return null;

    const optRe = /([A-Za-z_$][\w$]*)\?\.([A-Za-z_$][\w$]*)/g;
    const afterOpts: Array<{ obj: string; prop: string }> = [];
    optRe.lastIndex = 0;
    while ((m = optRe.exec(after)) !== null) {
      afterOpts.push({ obj: m[1], prop: m[2] });
    }

    // encontrar um par que era `.` antes e virou `?.` depois
    for (const opt of afterOpts) {
      const found = beforeMatches.find((b) => b.obj === opt.obj && b.prop === opt.prop);
      if (!found) continue;
      // confirmar que before NÃO tinha `?.` pra esse par
      const beforeOptRe = new RegExp(`\\b${escapeRegex(opt.obj)}\\?\\.${escapeRegex(opt.prop)}\\b`);
      if (beforeOptRe.test(before)) continue;
      return {
        patternId: 'ts-optional-chain',
        oldToken: `${opt.obj}.${opt.prop}`,
        newToken: `${opt.obj}?.${opt.prop}`,
        sourceLine: 0,
        meta: { obj: opt.obj, prop: opt.prop },
      };
    }
    return null;
  },
  findTargets(fileContent, match, ctx) {
    const obj = (match.meta?.obj as string) ?? '';
    const prop = (match.meta?.prop as string) ?? '';
    if (!obj || !prop) return [];
    const lines = fileContent.split('\n');
    const out: EditSuggestion[] = [];
    const re = new RegExp(`\\b${escapeRegex(obj)}\\.${escapeRegex(prop)}\\b`, 'g');
    const limit = Math.min(lines.length, 2000);
    for (let i = 0; i < limit; i++) {
      const lineNumber = i + 1;
      if (lineNumber === ctx.lineNumber) continue;
      const lineText = lines[i];
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lineText)) !== null) {
        // skip se já é `?.` (não deveria, mas defensive)
        const before = lineText.slice(Math.max(0, m.index + obj.length - 1), m.index + obj.length + 1);
        if (before.includes('?')) continue;
        out.push({
          line: lineNumber,
          startCol: m.index + 1,
          endCol: m.index + m[0].length + 1,
          currentText: `${obj}.${prop}`,
          suggestedText: `${obj}?.${prop}`,
          confidence: 0.6,
          patternId: 'ts-optional-chain',
        });
        if (out.length >= 50) return out;
      }
    }
    return out;
  },
};

/**
 * js-console-cleanup — detecta linha com `console.log(...)` sendo deletada
 * (after vazio) e sugere deletar outras `console.log` do arquivo. Útil
 * pra limpeza pré-commit.
 */
const jsConsoleCleanup: EditPattern = {
  id: 'js-console-cleanup',
  name: 'remove console.log',
  languages: JS_LANGS,
  detect(before, after) {
    if (!/console\.log\s*\(.*\)/.test(before)) return null;
    // after vazio ou sem console.log
    const afterTrim = (after ?? '').trim();
    if (afterTrim === '' || !/console\.log/.test(after)) {
      return {
        patternId: 'js-console-cleanup',
        oldToken: 'console.log',
        newToken: '',
        sourceLine: 0,
      };
    }
    return null;
  },
  findTargets(fileContent, _match, ctx) {
    const lines = fileContent.split('\n');
    const out: EditSuggestion[] = [];
    const logRe = /console\.log\s*\([^)]*\)\s*;?/;
    const limit = Math.min(lines.length, 2000);
    for (let i = 0; i < limit; i++) {
      const lineNumber = i + 1;
      if (lineNumber === ctx.lineNumber) continue;
      const lineText = lines[i];
      if (!logRe.test(lineText)) continue;
      // se a linha inteira é só o console.log (eventualmente com indent), sugere deletar tudo
      const isOnlyLog = /^\s*console\.log\s*\([^)]*\)\s*;?\s*$/.test(lineText);
      if (isOnlyLog) {
        out.push({
          line: lineNumber,
          startCol: 1,
          endCol: lineText.length + 1,
          currentText: lineText,
          suggestedText: '',
          confidence: 0.65,
          patternId: 'js-console-cleanup',
        });
      } else {
        // linha tem outras coisas — sugere remover só a call
        const m = logRe.exec(lineText);
        if (!m) continue;
        out.push({
          line: lineNumber,
          startCol: m.index + 1,
          endCol: m.index + m[0].length + 1,
          currentText: m[0],
          suggestedText: '',
          confidence: 0.55,
          patternId: 'js-console-cleanup',
        });
      }
      if (out.length >= 50) return out;
    }
    return out;
  },
};

/**
 * js-equality-strict — detecta `==` virando `===` (ou `!=` → `!==`) e
 * sugere o mesmo tightening em outras comparações loose do arquivo.
 */
const jsEqualityStrict: EditPattern = {
  id: 'js-equality-strict',
  name: '== → ===',
  languages: JS_LANGS,
  detect(before, after) {
    const looseEq = /(?<![=!])={2}(?!=)/;
    const looseNeq = /!=(?!=)/;
    const strictEq = /={3}/;
    const strictNeq = /!={2}/;

    if (looseEq.test(before) && strictEq.test(after) && !looseEq.test(after)) {
      return {
        patternId: 'js-equality-strict',
        oldToken: '==',
        newToken: '===',
        sourceLine: 0,
      };
    }
    if (looseNeq.test(before) && strictNeq.test(after) && !looseNeq.test(after)) {
      return {
        patternId: 'js-equality-strict',
        oldToken: '!=',
        newToken: '!==',
        sourceLine: 0,
      };
    }
    return null;
  },
  findTargets(fileContent, match, ctx) {
    const lines = fileContent.split('\n');
    const out: EditSuggestion[] = [];
    const re = match.oldToken === '==' ? /(?<![=!])={2}(?!=)/g : /!=(?!=)/g;
    const limit = Math.min(lines.length, 2000);
    for (let i = 0; i < limit; i++) {
      const lineNumber = i + 1;
      if (lineNumber === ctx.lineNumber) continue;
      const lineText = lines[i];
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lineText)) !== null) {
        out.push({
          line: lineNumber,
          startCol: m.index + 1,
          endCol: m.index + m[0].length + 1,
          currentText: match.oldToken,
          suggestedText: match.newToken,
          confidence: 0.8,
          patternId: 'js-equality-strict',
        });
        if (out.length >= 50) return out;
      }
    }
    return out;
  },
};

export const JS_TS_PATTERNS: EditPattern[] = [
  jsVarToConst,
  jsRequireToImport,
  jsThenToAwait,
  jsFuncToArrow,
  jsConcatToTemplate,
  tsAddTypeAnnotation,
  tsAnyToType,
  tsOptionalChain,
  jsConsoleCleanup,
  jsEqualityStrict,
];

// suppress unused import warning for findTokenLocations / PatternMatch in case
// patterns get refactored — they're part of the documented helpers API.
void findTokenLocations;
void (null as unknown as PatternMatch);
