/**
 * Snippets pack — VS Code-like prefixes pra TypeScript/JavaScript/React.
 *
 * Por que existe:
 *   - Monaco standalone vem SEM snippets pré-instalados (só palavras-reservadas
 *     da linguagem). VS Code carrega `built-in/snippets/` da própria distro
 *     + extensions populares.
 *   - Esses 15 são os mais usados em projetos React/TS — cobrem ~90% do uso
 *     diário sem precisar instalar extension.
 *
 * Como funciona:
 *   - `registerCompletionItemProvider` injeta items no dropdown nativo do Monaco
 *   - `${1:placeholder}` é a syntax LSP padrão; Tab cycla entre placeholders
 *   - `${1/regex/replace/}` permite transformação (ex: capitalizar 1a letra
 *     pro `setState` do useState)
 *   - `kind: Snippet` faz aparecer com ícone de tesoura no dropdown
 *
 * Pra adicionar mais snippets:
 *   - Cole o JSON do VS Code marketplace (snippets têm formato compatível)
 *   - Ou edite as arrays TS_SNIPPETS / JS_SNIPPETS abaixo
 *
 * Ref: VS Code snippet syntax — https://code.visualstudio.com/docs/editor/userdefinedsnippets
 */

import * as monaco from 'monaco-editor';

interface Snippet {
  prefix: string;
  body: string;
  description: string;
}

/** Snippets pra TypeScript + TSX (também aplicados em JS/JSX). */
const COMMON_SNIPPETS: Snippet[] = [
  // === React ===
  {
    prefix: 'rfc',
    body: `export function \${1:Name}() {\n  return (\n    <div>\${2:content}</div>\n  );\n}`,
    description: 'React Function Component',
  },
  {
    prefix: 'rfce',
    body: `interface \${1:Name}Props {\n  \${2:// props}\n}\n\nexport function \${1}({ \${3} }: \${1}Props) {\n  return (\n    <div>\${4:content}</div>\n  );\n}`,
    description: 'React Function Component with Props interface',
  },
  {
    prefix: 'usestate',
    body: `const [\${1:state}, set\${1/(.*)/\${1:/capitalize}/}] = useState(\${2:initial});`,
    description: 'React useState hook',
  },
  {
    prefix: 'useeffect',
    body: `useEffect(() => {\n  \${1:// effect}\n  return () => {\n    \${2:// cleanup}\n  };\n}, [\${3:deps}]);`,
    description: 'React useEffect with cleanup',
  },
  {
    prefix: 'usememo',
    body: `const \${1:value} = useMemo(() => \${2:computeValue}, [\${3:deps}]);`,
    description: 'React useMemo',
  },
  {
    prefix: 'usecallback',
    body: `const \${1:handler} = useCallback((\${2:args}) => {\n  \${3:// body}\n}, [\${4:deps}]);`,
    description: 'React useCallback',
  },
  {
    prefix: 'useref',
    body: `const \${1:ref} = useRef<\${2:HTMLDivElement}>(null);`,
    description: 'React useRef (typed)',
  },

  // === Logging / debugging ===
  {
    prefix: 'clog',
    body: `console.log(\${1:value});`,
    description: 'console.log',
  },
  {
    prefix: 'clogv',
    body: `console.log('\${1:label}:', \${1});`,
    description: 'console.log with label (named variable)',
  },
  {
    prefix: 'cwarn',
    body: `console.warn(\${1:value});`,
    description: 'console.warn',
  },
  {
    prefix: 'cerr',
    body: `console.error(\${1:value});`,
    description: 'console.error',
  },
  {
    prefix: 'ctable',
    body: `console.table(\${1:value});`,
    description: 'console.table',
  },

  // === Control flow ===
  {
    prefix: 'tryc',
    body: `try {\n  \${1}\n} catch (\${2:err}) {\n  \${3:// handle}\n}`,
    description: 'try/catch block',
  },
  {
    prefix: 'tryf',
    body: `try {\n  \${1}\n} catch (\${2:err}) {\n  \${3:// handle}\n} finally {\n  \${4:// cleanup}\n}`,
    description: 'try/catch/finally block',
  },
  {
    prefix: 'foreach',
    body: `\${1:items}.forEach((\${2:item}) => {\n  \${3}\n});`,
    description: 'Array.forEach',
  },
  {
    prefix: 'fori',
    body: `for (let \${1:i} = 0; \${1} < \${2:array}.length; \${1}++) {\n  \${3:// body}\n}`,
    description: 'classic for loop',
  },
  {
    prefix: 'forof',
    body: `for (const \${1:item} of \${2:iterable}) {\n  \${3:// body}\n}`,
    description: 'for...of loop',
  },

  // === Functions ===
  {
    prefix: 'asfn',
    body: `async function \${1:name}(\${2:args}) {\n  \${3}\n}`,
    description: 'async function',
  },
  {
    prefix: 'arrow',
    body: `const \${1:name} = (\${2:args}) => {\n  \${3}\n};`,
    description: 'arrow function',
  },
  {
    prefix: 'asarrow',
    body: `const \${1:name} = async (\${2:args}) => {\n  \${3}\n};`,
    description: 'async arrow function',
  },

  // === Imports ===
  {
    prefix: 'imp',
    body: `import { \${1} } from '\${2:module}';`,
    description: 'import named',
  },
  {
    prefix: 'impd',
    body: `import \${1:defaultExport} from '\${2:module}';`,
    description: 'import default',
  },
  {
    prefix: 'impa',
    body: `import * as \${1:alias} from '\${2:module}';`,
    description: 'import * as',
  },

  // === TypeScript ===
  {
    prefix: 'iface',
    body: `interface \${1:Name} {\n  \${2:// fields}\n}`,
    description: 'TypeScript interface',
  },
  {
    prefix: 'tdef',
    body: `type \${1:Name} = \${2:any};`,
    description: 'TypeScript type alias',
  },
  {
    prefix: 'enum',
    body: `enum \${1:Name} {\n  \${2:Member} = '\${3:value}',\n}`,
    description: 'TypeScript enum',
  },

  // === Promise / async ===
  {
    prefix: 'awaitt',
    body: `const \${1:result} = await \${2:promise};`,
    description: 'await expression',
  },
  {
    prefix: 'prom',
    body: `new Promise((resolve, reject) => {\n  \${1:// body}\n});`,
    description: 'Promise constructor',
  },
];

const JSX_SNIPPETS: Snippet[] = [
  {
    prefix: 'frag',
    body: `<>\n  \${1:content}\n</>`,
    description: 'React Fragment',
  },
  {
    prefix: 'div.',
    body: `<div className="\${1:class}">\n  \${2:content}\n</div>`,
    description: 'div with className',
  },
  {
    prefix: 'btn',
    body: `<button onClick={() => \${1:handler}}>\n  \${2:label}\n</button>`,
    description: 'button with onClick',
  },
  {
    prefix: 'map',
    body: `{\${1:items}.map((\${2:item}) => (\n  <\${3:div} key={\${2}.\${4:id}}>\${5}</\${3}>\n))}`,
    description: 'JSX .map() with key',
  },
];

const PYTHON_SNIPPETS: Snippet[] = [
  {
    prefix: 'def',
    body: `def \${1:name}(\${2:args}):\n    \${3:pass}`,
    description: 'function definition',
  },
  {
    prefix: 'class',
    body: `class \${1:Name}:\n    def __init__(self, \${2:args}):\n        \${3:pass}`,
    description: 'class with __init__',
  },
  {
    prefix: 'main',
    body: `if __name__ == "__main__":\n    \${1:main()}`,
    description: 'main guard',
  },
  {
    prefix: 'fori',
    body: `for \${1:i} in range(\${2:n}):\n    \${3:pass}`,
    description: 'for i in range',
  },
  {
    prefix: 'tryc',
    body: `try:\n    \${1}\nexcept \${2:Exception} as \${3:e}:\n    \${4:pass}`,
    description: 'try/except',
  },
];

const CSS_SNIPPETS: Snippet[] = [
  {
    prefix: 'flexcol',
    body: `display: flex;\nflex-direction: column;\n\${1}`,
    description: 'flex column',
  },
  {
    prefix: 'flexcenter',
    body: `display: flex;\nalign-items: center;\njustify-content: center;\n\${1}`,
    description: 'flex centered',
  },
  {
    prefix: 'grid',
    body: `display: grid;\ngrid-template-columns: \${1:repeat(3, 1fr)};\ngap: \${2:16px};\n\${3}`,
    description: 'CSS grid',
  },
  {
    prefix: 'abs',
    body: `position: absolute;\ntop: \${1:0};\nleft: \${2:0};\n\${3}`,
    description: 'absolute positioning',
  },
];

let registered = false;

function makeProvider(snippets: Snippet[]): monaco.languages.CompletionItemProvider {
  return {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(
        position.lineNumber, word.startColumn,
        position.lineNumber, word.endColumn,
      );
      return {
        suggestions: snippets.map((s) => ({
          label: s.prefix,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: s.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: { value: `**${s.description}**\n\n\`\`\`\n${s.body.replace(/\$\{\d+:?([^}]*)\}/g, '$1')}\n\`\`\`` },
          range,
          detail: 'Snippet',
          // Boost: snippets aparecem antes de palavras genéricas com mesmo prefix.
          sortText: `0_${s.prefix}`,
        })),
      };
    },
  };
}

export function registerSnippets(): void {
  if (registered) return;
  registered = true;

  // TS/JS/TSX/JSX → common + jsx
  monaco.languages.registerCompletionItemProvider(
    ['typescript', 'javascript'],
    makeProvider([...COMMON_SNIPPETS, ...JSX_SNIPPETS]),
  );

  // Python
  monaco.languages.registerCompletionItemProvider('python', makeProvider(PYTHON_SNIPPETS));

  // CSS/SCSS/LESS
  monaco.languages.registerCompletionItemProvider(['css', 'scss', 'less'], makeProvider(CSS_SNIPPETS));

  // eslint-disable-next-line no-console
  console.log('[Monaco] Snippets registered:', {
    typescript: COMMON_SNIPPETS.length + JSX_SNIPPETS.length,
    python: PYTHON_SNIPPETS.length,
    css: CSS_SNIPPETS.length,
  });
}
