/**
 * Project context — registra arquivos do workspace como Monaco models pra
 * destravar cross-file completion, jump-to-definition, find references.
 *
 * Por que existe:
 *   - Sem isso, Monaco TS worker só "vê" o arquivo aberto no editor ativo.
 *     `import { Button } from './Button'` aparece como "Cannot find module"
 *     mesmo quando Button.tsx existe ao lado.
 *   - VS Code resolve isso porque TS Server roda fora do editor e lê do disco
 *     diretamente. Monaco standalone roda TUDO no browser → precisamos passar
 *     os arquivos como TextModels pra ele indexar.
 *
 * Estratégia:
 *   1. Quando workspace abre, anda recursivamente em `cwd` via fs.listDir
 *      pegando todo arquivo .ts/.tsx/.d.ts/.js/.jsx/.json relevante.
 *   2. Cria Monaco model pra cada um (com URI file:// correto pra TS resolver
 *      imports relativos).
 *   3. Quando arquivo muda no disco (chokidar via fs.onWatcherEvent), atualiza
 *      o model correspondente.
 *   4. Quando trocar de workspace, dispose tudo e re-carrega.
 *
 * Limites pragmáticos:
 *   - maxFiles=2000 (proteção contra projetos absurdos)
 *   - ignora node_modules/dist/build/.next/out por padrão
 *   - max 500KB por arquivo (arquivos minified/generated pesam o worker à toa)
 *   - timeout total 30s (se demorar mais, aborta com warning)
 *
 * Não tenta:
 *   - resolver `paths` do tsconfig (TS worker faz só baseline NodeJs resolution)
 *   - watch automático sub-pastas que entram depois (basta re-load workspace)
 *   - registrar arquivos de node_modules (.d.ts) — Monaco já vem com lib.d.ts
 *     embutida; pra types de terceiros precisaria carregar manualmente
 *     (out of scope V1).
 */

import * as monaco from 'monaco-editor';

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  'out',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.git',
  '.svn',
  '.hg',
  'coverage',
  '.nyc_output',
  '__pycache__',
  '.pytest_cache',
  '.venv',
  'venv',
  'target', // Rust
  '.idea',
  '.vscode',
  '.vs',
  // UNDRCOD dev artifacts
  '.undrcod-code',
  '.checkpoints',
]);

const SUPPORTED_EXT = new Set([
  '.ts', '.tsx', '.d.ts',
  '.js', '.jsx', '.mjs', '.cjs',
  '.json',
]);

const MAX_FILES = 2000;
const MAX_FILE_BYTES = 500 * 1024; // 500KB
const TIMEOUT_MS = 30_000;

interface RegistryEntry {
  model: monaco.editor.ITextModel;
  uri: monaco.Uri;
}

const registered = new Map<string, RegistryEntry>();
let currentWorkspace: string | null = null;
let watcherUnsub: (() => void) | null = null;
/**
 * Flag pra evitar 2 loads simultâneos do MESMO workspace.
 * React StrictMode dispara useEffect 2x em dev — sem isso, walk + 730 createModel
 * roda em paralelo, gerando "duplicate URI" errors e desperdiçando CPU.
 */
let loadingFor: string | null = null;

function getLanguageForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.ts') || lower.endsWith('.d.ts')) return 'typescript';
  if (lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.mjs') || lower.endsWith('.cjs') || lower.endsWith('.js')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  return 'plaintext';
}

function getExt(path: string): string {
  const lower = path.toLowerCase();
  // .d.ts é um caso especial — pega a "extensão" como .d.ts pra log
  if (lower.endsWith('.d.ts')) return '.d.ts';
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot) : '';
}

/**
 * Walk recursivo via fs.listDir. Retorna lista plana de paths absolutos.
 * Para quando atinge MAX_FILES ou TIMEOUT_MS (em qualquer um dos casos
 * o context fica "parcial" — completion ainda funciona, só não vê tudo).
 */
async function walkWorkspace(root: string, deadline: number): Promise<string[]> {
  const result: string[] = [];
  const queue: string[] = [root];

  while (queue.length > 0 && result.length < MAX_FILES && Date.now() < deadline) {
    const dir = queue.shift()!;
    let entries: Array<{ name: string; path: string; type: 'file' | 'dir' }>;
    try {
      entries = await window.undrcodAPI.fs.listDir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.type === 'dir') {
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name.length > 1) {
          // pulamos hidden dirs (.git, .vscode, etc) — exceções já no IGNORED_DIRS
          // mas como fallback geral também ignoramos
          if (!IGNORED_DIRS.has(entry.name)) continue;
        }
        queue.push(entry.path);
      } else {
        const ext = getExt(entry.path);
        if (!SUPPORTED_EXT.has(ext)) continue;
        result.push(entry.path);
        if (result.length >= MAX_FILES) break;
      }
    }
  }

  return result;
}

/**
 * Tenta criar/atualizar um Monaco model pra um arquivo específico.
 *
 * Cuidados:
 *   - Race condition: getModel(uri) pode retornar null e logo depois outro
 *     code path (chokidar, editor mount) cria o mesmo URI → createModel
 *     throw "two models with same URI". Try/catch fallback pra getModel +
 *     setValue.
 *   - @monaco-editor/react usa `monaco.Uri.parse(path)` no `<Editor path>`
 *     prop. MonacoEditor.tsx agora normaliza pra `Uri.file(path).toString()`
 *     ANTES de passar, então os URIs ficam iguais.
 */
async function loadFile(absPath: string): Promise<void> {
  try {
    const r = await window.undrcodAPI.fs.readFile(absPath);
    if ('error' in r) return;
    if (r.content.length > MAX_FILE_BYTES) return; // pula arquivos enormes (minified, etc)

    const uri = monaco.Uri.file(absPath);
    const language = getLanguageForPath(absPath);

    // Tenta getModel primeiro pra evitar erro de URI duplicado.
    let model = monaco.editor.getModel(uri);
    if (model) {
      // Já existe (criado por @monaco-editor/react ou por chamada anterior).
      // Atualiza só se conteúdo diferiu — evita dirty falso no editor.
      if (model.getValue() !== r.content) {
        model.setValue(r.content);
      }
      registered.set(absPath, { model, uri });
      return;
    }

    // Tenta createModel — pode dar erro se outro code path criou no meio do tempo.
    try {
      model = monaco.editor.createModel(r.content, language, uri);
      registered.set(absPath, { model, uri });
    } catch {
      // Race: outro code path criou. Re-pega e atualiza conteúdo.
      const existing = monaco.editor.getModel(uri);
      if (existing) {
        if (existing.getValue() !== r.content) existing.setValue(r.content);
        registered.set(absPath, { model: existing, uri });
      }
    }
  } catch {
    // arquivo sumiu, sem permissão, etc — pula silenciosamente
  }
}

/**
 * Limpa todos os models registrados pelo project-context.
 * IMPORTANTE: NÃO dispose models que o MonacoEditor está usando ativamente
 * (ele tem reference própria) — esses serão recriados pelo @monaco-editor/react
 * automaticamente quando user reabrir o arquivo.
 */
function clearAll(): void {
  for (const { model } of registered.values()) {
    try {
      // model.isAttachedToEditor() seria ideal mas Monaco standalone não expõe.
      // Como workaround: tenta dispose; se editor ainda usa, Monaco re-cria sob demanda.
      if (!model.isDisposed()) model.dispose();
    } catch {
      // ignore
    }
  }
  registered.clear();
}

/**
 * Carrega TODOS os arquivos suportados do workspace como Monaco models.
 * Chamado quando workspace abre/muda. Retorna número de arquivos carregados.
 *
 * Não bloqueia: roda async em background. Editor já funciona durante a carga,
 * só vai destravar cross-file completion conforme arquivos vão chegando.
 */
export async function loadProjectContext(workspaceRoot: string): Promise<void> {
  if (!workspaceRoot) return;

  // Idempotente — 3 casos:
  //   1. Mesmo workspace já está sendo carregado AGORA (race do StrictMode)
  //   2. Mesmo workspace já foi carregado (segunda chamada redundante)
  if (loadingFor === workspaceRoot) return;
  if (currentWorkspace === workspaceRoot && registered.size > 0) return;

  // Se troca de workspace, limpa o anterior primeiro.
  if (currentWorkspace && currentWorkspace !== workspaceRoot) {
    clearAll();
    if (watcherUnsub) {
      watcherUnsub();
      watcherUnsub = null;
    }
  }
  currentWorkspace = workspaceRoot;
  loadingFor = workspaceRoot;

  try {

  const t0 = performance.now();
  const deadline = Date.now() + TIMEOUT_MS;

  // 1. Walk workspace
  const files = await walkWorkspace(workspaceRoot, deadline);
  // eslint-disable-next-line no-console
  console.log(`[ProjectContext] Found ${files.length} files in ${workspaceRoot} (${Math.round(performance.now() - t0)}ms)`);

  // 2. Load em batches paralelos pra não estourar IPC
  const BATCH_SIZE = 20;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    if (Date.now() > deadline) {
      // eslint-disable-next-line no-console
      console.warn(`[ProjectContext] Timeout — loaded ${registered.size}/${files.length}`);
      break;
    }
    await Promise.all(files.slice(i, i + BATCH_SIZE).map(loadFile));
  }

  // eslint-disable-next-line no-console
  console.log(`[ProjectContext] Loaded ${registered.size} models in ${Math.round(performance.now() - t0)}ms`);

  // 3. Subscribe pro watcher (chokidar) — sync em tempo real quando arquivos mudam
  if (!watcherUnsub && window.undrcodAPI?.fs?.onWatcherEvent) {
    watcherUnsub = window.undrcodAPI.fs.onWatcherEvent((data) => {
      if (data.event === 'change' || data.event === 'add') {
        const ext = getExt(data.path);
        if (SUPPORTED_EXT.has(ext)) void loadFile(data.path);
      } else if (data.event === 'unlink') {
        const entry = registered.get(data.path);
        if (entry) {
          try { if (!entry.model.isDisposed()) entry.model.dispose(); } catch { /* noop */ }
          registered.delete(data.path);
        }
      }
    });
  }

  } finally {
    // Limpa flag mesmo se walkWorkspace lançou — senão fica travado.
    if (loadingFor === workspaceRoot) loadingFor = null;
  }
}

/** Stats pra DevTools / debug. */
export function getProjectContextStats(): { workspace: string | null; modelCount: number } {
  return {
    workspace: currentWorkspace,
    modelCount: registered.size,
  };
}

/** Limpa quando user fecha workspace explicitamente. */
export function clearProjectContext(): void {
  clearAll();
  if (watcherUnsub) {
    watcherUnsub();
    watcherUnsub = null;
  }
  currentWorkspace = null;
}
