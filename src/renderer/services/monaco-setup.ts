/**
 * Monaco TypeScript/JavaScript configuration — VS Code-like defaults.
 *
 * Por que existe:
 *   - Monaco vem com compiler defaults conservadores (ES5, sem JSX, sem strict).
 *   - Em projetos modernos (React/TS), isso causa "false positives" — código
 *     correto aparece como erro porque o worker não entende async/await,
 *     optional chaining, JSX, etc.
 *
 * Esta função reconfigura o worker pra:
 *   - TypeScript ES2022 + JSX (react-jsx) + strict
 *   - JavaScript com checkJs (validação básica em .js também)
 *   - Diagnostics completos (semantic + syntax + suggestions)
 *   - eagerModelSync — TS worker vê models adicionados ao Monaco editor sem
 *     precisar abrir cada arquivo manualmente
 *
 * Roda UMA vez, antes do primeiro Editor montar. Idempotente (set duas vezes
 * sobrescreve; sem erro).
 *
 * Ref: Cursor faz isso no fork via packaging do TS server completo. Aqui
 * usamos o TS worker embedded do Monaco — quase mesma DX pra arquivos TS/JS
 * sem precisar fork do VS Code.
 */

import * as monaco from 'monaco-editor';

let configured = false;

export function configureMonacoTypeScript(): void {
  if (configured) return;
  configured = true;

  // ---- TypeScript ----
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    strict: true,
    isolatedModules: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    allowJs: true,
    typeRoots: ['node_modules/@types'],
    lib: ['dom', 'dom.iterable', 'es2020'],
    // Habilita import/auto-import de paths absolutos (configurado via
    // tsconfig.json no projeto do user — Monaco não lê isso automaticamente
    // mas project-context.ts pode injetar mais tarde).
    baseUrl: '.',
  });

  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
    // Suprime erros de "Cannot find module 'X'" pra imports que ainda não foram
    // carregados como Monaco models. Quando project-context.ts registrar todos
    // os arquivos do workspace, esses erros somem naturalmente — sem isso,
    // arquivos abertos antes do registry rodar mostrariam squiggles falsos.
    diagnosticCodesToIgnore: [
      2307, // Cannot find module
      2304, // Cannot find name (LSP loads outros arquivos lazy)
    ],
  });

  // Sync agressivo: TS worker re-indexa quando models são criados/destruídos.
  monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);

  // ---- JavaScript (mesmas configs, sem strict) ----
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    allowJs: true,
    checkJs: false, // se ligar, .js gera muitos warnings em projetos legados
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
  });

  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });

  monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);

  // ---- JSON schemas (auto-complete em package.json, tsconfig.json, etc.) ----
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: true, // tsconfig permite // comments
    schemas: [
      {
        uri: 'https://json.schemastore.org/package',
        fileMatch: ['package.json', '**/package.json'],
      },
      {
        uri: 'https://json.schemastore.org/tsconfig',
        fileMatch: ['tsconfig.json', 'tsconfig.*.json', '**/tsconfig.json', '**/tsconfig.*.json'],
      },
      {
        uri: 'https://json.schemastore.org/eslintrc',
        fileMatch: ['.eslintrc', '.eslintrc.json'],
      },
      {
        uri: 'https://json.schemastore.org/prettierrc',
        fileMatch: ['.prettierrc', '.prettierrc.json'],
      },
    ],
    enableSchemaRequest: true, // baixa schemas da web automaticamente
  });

  // eslint-disable-next-line no-console
  console.log('[Monaco] TypeScript/JavaScript/JSON configured (VS Code-like defaults)');
}

/**
 * Atualiza compiler options de TS especificamente — útil se quiser sobrescrever
 * de runtime (ex: workspace tem tsconfig.json com target diferente).
 *
 * Lê tsconfig.json do workspace e aplica `compilerOptions` no monaco TS worker.
 * Falha silenciosamente se arquivo não existe ou não parseia.
 */
export async function syncCompilerOptionsFromTsconfig(workspaceRoot: string): Promise<void> {
  try {
    const sep = workspaceRoot.includes('\\') ? '\\' : '/';
    const tsconfigPath = `${workspaceRoot}${sep}tsconfig.json`;
    const r = await window.undrcodAPI?.fs.readFile(tsconfigPath);
    if (!r || 'error' in r) return;

    // Strip comments (// e /* */) — tsconfig permite mas JSON.parse não.
    const stripped = r.content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const parsed = JSON.parse(stripped) as { compilerOptions?: Record<string, unknown> };
    const opts = parsed.compilerOptions;
    if (!opts) return;

    // Mapeia subset comum (target/jsx/strict/module) pro enum do Monaco.
    const targetMap: Record<string, monaco.languages.typescript.ScriptTarget> = {
      es3: monaco.languages.typescript.ScriptTarget.ES3,
      es5: monaco.languages.typescript.ScriptTarget.ES5,
      es6: monaco.languages.typescript.ScriptTarget.ES2015,
      es2015: monaco.languages.typescript.ScriptTarget.ES2015,
      es2016: monaco.languages.typescript.ScriptTarget.ES2016,
      es2017: monaco.languages.typescript.ScriptTarget.ES2017,
      es2018: monaco.languages.typescript.ScriptTarget.ES2018,
      es2019: monaco.languages.typescript.ScriptTarget.ES2019,
      es2020: monaco.languages.typescript.ScriptTarget.ES2020,
      es2021: monaco.languages.typescript.ScriptTarget.ES2020,
      es2022: monaco.languages.typescript.ScriptTarget.ES2020,
      esnext: monaco.languages.typescript.ScriptTarget.ESNext,
    };

    const jsxMap: Record<string, monaco.languages.typescript.JsxEmit> = {
      preserve: monaco.languages.typescript.JsxEmit.Preserve,
      react: monaco.languages.typescript.JsxEmit.React,
      'react-native': monaco.languages.typescript.JsxEmit.ReactNative,
      'react-jsx': monaco.languages.typescript.JsxEmit.ReactJSX,
      'react-jsxdev': monaco.languages.typescript.JsxEmit.ReactJSXDev,
    };

    const current = monaco.languages.typescript.typescriptDefaults.getCompilerOptions();
    const next: monaco.languages.typescript.CompilerOptions = { ...current };

    if (typeof opts.target === 'string') {
      const mapped = targetMap[(opts.target as string).toLowerCase()];
      if (mapped !== undefined) next.target = mapped;
    }
    if (typeof opts.jsx === 'string') {
      const mapped = jsxMap[(opts.jsx as string).toLowerCase()];
      if (mapped !== undefined) next.jsx = mapped;
    }
    if (typeof opts.strict === 'boolean') next.strict = opts.strict;
    if (Array.isArray(opts.lib)) next.lib = opts.lib as string[];

    // ---- paths / baseUrl alias resolution ----
    // Workspaces modernos (Vite/Next/CRA) usam aliases tipo:
    //   "baseUrl": ".", "paths": { "@/*": ["src/*"] }
    // Sem isso, Monaco TS worker mostra "Cannot find module '@/components/Button'"
    // mesmo o arquivo existindo. Aplicamos absoluto pra worker resolver via Models.
    //
    // Monaco TextModel URIs são `file:///<path>` então convertemos baseUrl/paths
    // pra absoluto baseado no workspaceRoot. Ex: baseUrl '.' + workspace
    // '/C:/Users/x/proj' = baseUrl 'file:///C:/Users/x/proj'.
    const norm = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');
    if (typeof opts.baseUrl === 'string') {
      const baseUrlAbs = opts.baseUrl === '.' || opts.baseUrl === './'
        ? norm
        : opts.baseUrl.startsWith('./')
          ? `${norm}/${opts.baseUrl.slice(2)}`
          : opts.baseUrl;
      next.baseUrl = baseUrlAbs;
    } else {
      // Defaults to workspace root quando paths é definido sem baseUrl explícito.
      // tsc também tem esse comportamento desde TS 4.1.
      if (opts.paths && typeof opts.paths === 'object') next.baseUrl = norm;
    }
    if (opts.paths && typeof opts.paths === 'object') {
      // Reescreve paths relativos pra absolutos baseados no baseUrl resolvido.
      const rawPaths = opts.paths as Record<string, string[]>;
      const baseForPaths = next.baseUrl || norm;
      const resolvedPaths: Record<string, string[]> = {};
      for (const [alias, targets] of Object.entries(rawPaths)) {
        if (!Array.isArray(targets)) continue;
        resolvedPaths[alias] = targets.map((t) => {
          // Se já absoluto ou começa com node_modules, deixa como tá.
          if (t.startsWith('/') || /^[A-Z]:[/\\]/i.test(t)) return t;
          // Senão, resolve relativo ao baseUrl.
          const stripped = t.replace(/^\.\//, '');
          return `${baseForPaths}/${stripped}`;
        });
      }
      next.paths = resolvedPaths;
    }

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions(next);
    // eslint-disable-next-line no-console
    console.log('[Monaco] Synced compiler options from workspace tsconfig.json', {
      target: next.target,
      jsx: next.jsx,
      strict: next.strict,
      baseUrl: next.baseUrl,
      paths: next.paths ? Object.keys(next.paths) : null,
    });
  } catch {
    // tsconfig não existe, está mal-formado, ou IPC falhou — fallback pros defaults.
  }
}
