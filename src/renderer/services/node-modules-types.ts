/**
 * Carrega declarations (.d.ts) do node_modules pra Monaco TS worker.
 *
 * Por que existe:
 *   - Sem isso, `import React from 'react'` mostra "Cannot find module 'react'"
 *     mesmo o pkg estando instalado. Monaco standalone NÃO lê node_modules
 *     do disco — só tem `lib.d.ts` (DOM + ES builtins) embedded.
 *   - VS Code resolve via TS Server que roda fora do browser. Aqui no Monaco
 *     browser-only, precisamos injetar os types manualmente via `addExtraLib`.
 *
 * Estratégia:
 *   1. Ler package.json do workspace, juntar deps + devDeps + peerDeps.
 *   2. Pra cada pkg:
 *      a) Tentar carregar `node_modules/<pkg>/package.json` → ler `types`/`typings`
 *         field → carregar esse .d.ts.
 *      b) Tentar `node_modules/@types/<pkg>/index.d.ts` (DefinitelyTyped).
 *      c) Se nenhum, pkg fica sem types — completion ainda funciona via fallback
 *         de inferência (Monaco assume `any`).
 *   3. Injetar via `addExtraLib(content, virtualPath)` onde virtualPath simula
 *      o local real (`file:///node_modules/<pkg>/index.d.ts`). TS worker resolve
 *      imports automático.
 *
 * Limites pragmáticos:
 *   - MAX_PACKAGES=100 (cobre 99% dos projetos sem queimar memória do worker)
 *   - MAX_TYPE_SIZE=200KB por pkg (filtra types absurdos tipo @types/lodash 1MB+)
 *   - TIMEOUT_MS=30s (se demorar mais, aborta — completion ainda funciona com o que carregou)
 *   - Só carrega ENTRY POINT (index.d.ts). Submódulos (`react-dom/server`) podem
 *     não funcionar até v2 — funciona pra 80% dos imports.
 *
 * Idempotente: tracking de já-carregados via Set evita reload em re-trigger.
 */

import * as monaco from 'monaco-editor';

const MAX_PACKAGES = 100;
const MAX_TYPE_BYTES = 200 * 1024;
const TIMEOUT_MS = 30_000;

interface LoadedLib {
  pkgName: string;
  virtualPath: string;
  bytes: number;
  disposable: monaco.IDisposable;
}

const loaded = new Map<string, LoadedLib>();
let currentWorkspace: string | null = null;
/** StrictMode double-fire guard (igual project-context.ts). */
let loadingFor: string | null = null;

interface PkgJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  types?: string;
  typings?: string;
  main?: string;
  exports?: Record<string, unknown> | string;
}

function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')))
    .filter((p) => p.length > 0)
    .join('/');
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const r = await window.undrcodAPI.fs.readFile(path);
    if ('error' in r) return null;
    return JSON.parse(r.content) as T;
  } catch {
    return null;
  }
}

async function readTextSafe(path: string, maxBytes: number): Promise<string | null> {
  try {
    const r = await window.undrcodAPI.fs.readFile(path);
    if ('error' in r) return null;
    if (r.content.length > maxBytes) return null;
    return r.content;
  } catch {
    return null;
  }
}

/**
 * Tenta achar o entry .d.ts dum pkg específico. Ordem de fallback:
 *   1. `types` no package.json (campo TypeScript moderno)
 *   2. `typings` (campo antigo, ainda usado)
 *   3. `index.d.ts` na raiz (convenção)
 *   4. Substitui `main` por `.d.ts` (alguns pkgs fazem dist/index.js → dist/index.d.ts)
 *
 * Retorna { content, virtualPath } ou null se não achou.
 */
async function tryLoadPackageTypes(
  workspaceRoot: string,
  pkgName: string,
): Promise<{ content: string; virtualPath: string } | null> {
  const pkgDir = joinPath(workspaceRoot, 'node_modules', pkgName);
  const pkgJson = await readJson<PkgJson>(joinPath(pkgDir, 'package.json'));
  if (!pkgJson) return null;

  const candidates: string[] = [];
  if (typeof pkgJson.types === 'string') candidates.push(pkgJson.types);
  if (typeof pkgJson.typings === 'string') candidates.push(pkgJson.typings);
  candidates.push('index.d.ts');
  if (typeof pkgJson.main === 'string') {
    // Tenta variantes: main.js → main.d.ts, dist/main.js → dist/main.d.ts
    candidates.push(pkgJson.main.replace(/\.[mc]?jsx?$/, '.d.ts'));
    candidates.push(pkgJson.main.replace(/\.[mc]?jsx?$/, '') + '.d.ts');
  }

  for (const rel of candidates) {
    const absPath = joinPath(pkgDir, rel);
    const content = await readTextSafe(absPath, MAX_TYPE_BYTES);
    if (!content) continue;
    // Virtual path importante: TS worker usa pra resolver `import 'pkg'` →
    // mapeia pra esse arquivo. Forma `file:///node_modules/<pkg>/index.d.ts`
    // imita o que VS Code faz internamente.
    const virtualPath = `file:///node_modules/${pkgName}/${rel.replace(/^\.\//, '')}`;
    return { content, virtualPath };
  }
  return null;
}

/**
 * Tenta carregar types da DefinitelyTyped (`@types/<pkg>`).
 * Vários pkgs (lodash, node, etc) NÃO embarcam types — vem só via @types.
 */
async function tryLoadAtTypes(
  workspaceRoot: string,
  pkgName: string,
): Promise<{ content: string; virtualPath: string } | null> {
  // Convenção @types: scoped pkg `@foo/bar` vira `@types/foo__bar`
  const atTypesName = pkgName.startsWith('@')
    ? `@types/${pkgName.slice(1).replace('/', '__')}`
    : `@types/${pkgName}`;

  const dir = joinPath(workspaceRoot, 'node_modules', atTypesName);
  const indexPath = joinPath(dir, 'index.d.ts');
  const content = await readTextSafe(indexPath, MAX_TYPE_BYTES);
  if (!content) return null;
  return { content, virtualPath: `file:///node_modules/${atTypesName}/index.d.ts` };
}

/**
 * Loop principal — carrega types pra TODOS os pkgs do package.json
 * do workspace. Roda em background, sem bloquear UI.
 */
export async function loadNodeModulesTypes(workspaceRoot: string): Promise<void> {
  if (!workspaceRoot) return;

  // Idempotente — 3 casos: já carregando, já carregado, ou troca de workspace.
  if (loadingFor === workspaceRoot) return;
  if (currentWorkspace === workspaceRoot && loaded.size > 0) return;

  // Se trocou workspace, dispose de tudo do anterior.
  if (currentWorkspace && currentWorkspace !== workspaceRoot) {
    clearNodeModulesTypes();
  }
  currentWorkspace = workspaceRoot;
  loadingFor = workspaceRoot;

  try {

  const t0 = performance.now();
  const deadline = Date.now() + TIMEOUT_MS;

  // 1. Read package.json do workspace
  const pkgJsonPath = joinPath(workspaceRoot, 'package.json');
  const pkgJson = await readJson<PkgJson>(pkgJsonPath);
  if (!pkgJson) {
    // eslint-disable-next-line no-console
    console.log('[NodeTypes] No package.json — skip');
    return;
  }

  const allDeps = {
    ...pkgJson.dependencies,
    ...pkgJson.devDependencies,
    ...pkgJson.peerDependencies,
  };
  const pkgNames = Object.keys(allDeps).slice(0, MAX_PACKAGES);

  // 2. Pra cada pkg, tenta carregar (own types OU @types)
  let loadedCount = 0;
  let skippedCount = 0;
  for (const pkgName of pkgNames) {
    if (Date.now() > deadline) {
      // eslint-disable-next-line no-console
      console.warn(`[NodeTypes] Timeout — loaded ${loadedCount}/${pkgNames.length}`);
      break;
    }
    if (loaded.has(pkgName)) {
      skippedCount++;
      continue;
    }

    // Pula `@types/*` na lista de deps (vamos carregar atrelado ao pkg real).
    if (pkgName.startsWith('@types/')) continue;

    // Tenta own types primeiro, depois @types.
    let result = await tryLoadPackageTypes(workspaceRoot, pkgName);
    if (!result) result = await tryLoadAtTypes(workspaceRoot, pkgName);
    if (!result) continue;

    try {
      const disposable = monaco.languages.typescript.typescriptDefaults.addExtraLib(
        result.content,
        result.virtualPath,
      );
      // JS também — TS worker pode atender ambos.
      monaco.languages.typescript.javascriptDefaults.addExtraLib(
        result.content,
        result.virtualPath,
      );
      loaded.set(pkgName, {
        pkgName,
        virtualPath: result.virtualPath,
        bytes: result.content.length,
        disposable,
      });
      loadedCount++;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[NodeTypes] Failed addExtraLib for ${pkgName}:`, e);
    }
  }

  // 3. Total stats
  const totalBytes = [...loaded.values()].reduce((sum, l) => sum + l.bytes, 0);
  // eslint-disable-next-line no-console
  console.log(
    `[NodeTypes] Loaded ${loadedCount} pkgs (${skippedCount} cached, ${pkgNames.length - loadedCount - skippedCount} no types) — ${Math.round(totalBytes / 1024)}KB in ${Math.round(performance.now() - t0)}ms`,
  );

  } finally {
    if (loadingFor === workspaceRoot) loadingFor = null;
  }
}

/** Limpa todas as libs injetadas (troca de workspace). */
export function clearNodeModulesTypes(): void {
  for (const lib of loaded.values()) {
    try { lib.disposable.dispose(); } catch { /* noop */ }
  }
  loaded.clear();
}

/** Stats pra DevTools. */
export function getNodeModulesTypesStats(): {
  workspace: string | null;
  pkgCount: number;
  totalKB: number;
} {
  const totalBytes = [...loaded.values()].reduce((sum, l) => sum + l.bytes, 0);
  return {
    workspace: currentWorkspace,
    pkgCount: loaded.size,
    totalKB: Math.round(totalBytes / 1024),
  };
}
