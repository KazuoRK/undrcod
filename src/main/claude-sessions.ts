/**
 * Lê o storage local do Claude CLI pra listar sessões por workspace.
 *
 * Path: ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 * Encoding: replace [\\/:] por '-' (ex: "C:\\Users\\taked\\Desktop\\Claude" -> "C--Users-taked-Desktop-Claude")
 *
 * Cada .jsonl é uma sessão. Cada linha = um event JSON
 * (user/assistant/tool/queue-operation/etc).
 *
 * Pra UI, extraímos só metadados (primeira user msg como title + timestamps)
 * sem carregar o arquivo inteiro em memória.
 */

import { readdir, stat, readFile, writeFile, mkdir, open as fsOpen } from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { app } from 'electron';
import type { HistoryEvent, SessionHistory, ReadSessionHistoryOptions } from '../shared/agent-types';

/**
 * Cache de meta por path. Key = jsonlPath, value = { mtimeMs, meta }.
 *
 * PERSISTÊNCIA EM DISCO: cache é também salvo em `<userData>/sessions-meta.json`
 * e carregado no boot. Sem isso, toda vez que abre o app precisa re-extrair
 * 39 arquivos jsonl (alguns 138MB+). Com persistência, primeira vez é lenta,
 * próximas são INSTANTÂNEAS (só stat + lookup no Map).
 *
 * Invalida quando mtime do arquivo muda — se o CLI escreve numa session, só
 * essa entry vira stale (re-extrai), o resto continua válido.
 */
const metaCache = new Map<string, { mtimeMs: number; meta: SessionMeta }>();

/**
 * Cache PERSISTIDO da lista por-workspace (resultado de listSessionsForWorkspace).
 * Key = workspacePath. Value = lista ordenada de SessionMeta + timestamp do snapshot.
 *
 * O cache em meta-por-arquivo já é rápido, MAS o renderer ainda paga IPC roundtrip
 * + stat de N arquivos a cada call. Esse cache de lista permite o renderer pegar
 * a lista INTEIRA num único IPC sem precisar stat-ar nada se já tem snapshot
 * recente. O backend ainda re-valida no background pra invalidar entries velhas.
 */
interface ListSnapshot { ts: number; sessions: SessionMeta[] }
const listSnapshotCache = new Map<string, ListSnapshot>();

/** Path do arquivo de cache persistente. Lazy-resolved porque app pode não estar pronto no import. */
function metaCachePath(): string {
  return join(app.getPath('userData'), 'sessions-meta.json');
}

/** Path do cache de listas por-workspace. */
function listCachePath(): string {
  return join(app.getPath('userData'), 'sessions-lists.json');
}

let cacheLoaded = false;
let cacheLoadingPromise: Promise<void> | null = null;
let cacheSaveTimer: NodeJS.Timeout | null = null;
let listCacheSaveTimer: NodeJS.Timeout | null = null;

/** Carrega o cache do disco. Idempotente — só carrega uma vez. */
async function ensureCacheLoaded(): Promise<void> {
  if (cacheLoaded) return;
  if (cacheLoadingPromise) return cacheLoadingPromise;
  cacheLoadingPromise = (async () => {
    const t0 = Date.now();
    try {
      const raw = await readFile(metaCachePath(), 'utf8');
      const parsed = JSON.parse(raw) as Record<string, { mtimeMs: number; meta: SessionMeta }>;
      for (const [path, entry] of Object.entries(parsed)) {
        if (entry && typeof entry.mtimeMs === 'number' && entry.meta) {
          metaCache.set(path, entry);
        }
      }
    } catch {
      // Cache ausente ou corrompido — começa vazio, será populado on-demand.
    }
    // Carrega também o cache de listas
    try {
      const raw = await readFile(listCachePath(), 'utf8');
      const parsed = JSON.parse(raw) as Record<string, ListSnapshot>;
      for (const [k, v] of Object.entries(parsed)) {
        if (v && Array.isArray(v.sessions)) listSnapshotCache.set(k, v);
      }
    } catch { /* ignora */ }
    const elapsed = Date.now() - t0;
    console.log(`[claude-sessions] cache loaded: ${metaCache.size} meta entries, ${listSnapshotCache.size} list snapshots in ${elapsed}ms`);
    cacheLoaded = true;
  })();
  return cacheLoadingPromise;
}

/**
 * PRE-WARM PUBLIC API: chamada no boot do main (após app.whenReady) pra
 * popular os caches em memória ANTES do renderer pedir. Evita o cold-start
 * onde o primeiro IPC tem que esperar readFile do JSON.
 *
 * 2 fases:
 *  1. SYNC-ish: carrega caches persistidos do disco (sessions-meta.json +
 *     sessions-lists.json). Pra workspaces já vistos antes, `listSnapshotCache`
 *     fica populado e o renderer pega via getAllSessionsSnapshots em <5ms.
 *  2. DEEP (fire-and-forget): em segundo plano, chama listKnownWorkspaces +
 *     listSessionsForWorkspace pra TODOS os workspaces, populando
 *     listSnapshotCache mesmo no primeiríssimo boot (sem cache persistido).
 *     Quando o renderer pedir minutos depois, é instantâneo.
 *
 *     Setimmediate yields entre cada workspace pra não bloquear main thread.
 */
export async function prewarmSessionsCache(): Promise<void> {
  await ensureCacheLoaded();

  // DEEP PREWARM em background — não bloqueia o caller (boot do main).
  // Sem isso, o primeiríssimo boot do app (cache vazio) tem renderer esperando
  // listSessionsForWorkspace fazer todo o trabalho I/O on-demand.
  setImmediate(() => {
    void deepPrewarmSessionLists();
  });
}

/**
 * Roda em background após boot pra POPULAR listSnapshotCache com dados frescos
 * de TODOS workspaces conhecidos. Sem precisar do renderer pedir.
 *
 * - Throttle: 1 workspace por vez (concurrency=1) com 30ms gap.
 *   Não satura I/O do Windows nem compete com a UI thread durante boot.
 * - Snapshot fresh fica disponível IMEDIATAMENTE pro renderer via
 *   getAllSessionsSnapshots — sem custar nada além do trabalho que já
 *   ia acontecer assim que o user abrisse o painel.
 */
async function deepPrewarmSessionLists(): Promise<void> {
  const t0 = Date.now();
  try {
    const workspaces = await listKnownWorkspaces();
    let warmed = 0;
    for (const ws of workspaces) {
      try {
        // Reuse via in-flight cache. Se já está rodando do renderer, dedup.
        await listSessionsForWorkspace(ws.path);
        warmed++;
      } catch { /* ignora workspace falho */ }
      // Yield event loop pra IPC do renderer poder rodar entre cada workspace.
      await new Promise((r) => setImmediate(r));
    }
    const elapsed = Date.now() - t0;
    console.log(`[prewarm] deep warmed ${warmed}/${workspaces.length} workspaces in ${elapsed}ms`);
  } catch (err) {
    console.error('[prewarm] deep failed', err);
  }
}

/** Persiste o cache no disco. Debounced 500ms pra coalescer bursts de updates. */
function scheduleCacheSave(): void {
  if (cacheSaveTimer) return;
  cacheSaveTimer = setTimeout(async () => {
    cacheSaveTimer = null;
    try {
      const path = metaCachePath();
      await mkdir(dirname(path), { recursive: true });
      const obj: Record<string, { mtimeMs: number; meta: SessionMeta }> = {};
      for (const [k, v] of metaCache) obj[k] = v;
      await writeFile(path, JSON.stringify(obj), 'utf8');
    } catch { /* ignora — cache é best-effort */ }
  }, 500);
}

/** Persiste o cache de listas por workspace. Debounced 800ms. */
function scheduleListCacheSave(): void {
  if (listCacheSaveTimer) return;
  listCacheSaveTimer = setTimeout(async () => {
    listCacheSaveTimer = null;
    try {
      const path = listCachePath();
      await mkdir(dirname(path), { recursive: true });
      const obj: Record<string, ListSnapshot> = {};
      for (const [k, v] of listSnapshotCache) obj[k] = v;
      await writeFile(path, JSON.stringify(obj), 'utf8');
    } catch { /* ignora */ }
  }, 800);
}

export interface SessionMeta {
  sessionId: string;
  title: string;             // primeira user message (truncada)
  firstTimestamp: string;    // ISO string
  lastTimestamp: string;
  messageCount: number;      // linhas que são type=user OU type=assistant
  cwd: string;               // workspace path (do JSONL, não do encoding)
}

/** Encode workspace path no formato que o Claude CLI usa pra nome de pasta.
 *
 * Claude CLI substitui TODO caractere não-alfanumérico por `-` (não só
 * `[\\/:]`). Confirmado contra `~/.claude/projects/`:
 *   - `C:\Users\taked\Desktop\Claude\claude code ds` (com espaço)
 *     → `C--Users-taked-Desktop-Claude-claude-code-ds` (espaços viram `-`)
 *   - `C:\...\Asimov Academy\Site Estático IA` (com acentos)
 *     → `c--Users-taked-Desktop-Asimov-Academy-Site-Est-tico-IA`
 *     (acentos viram `-` também)
 *
 * Antes, regex `[\\/:]` deixava espaços+acentos passar → procurava no
 * diretório errado → "Sem conversas neste workspace" mesmo com sessions
 * gravadas. Fix: `[^a-zA-Z0-9-]` casa o comportamento real do CLI.
 */
export function encodeCwdPath(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9-]/g, '-');
}

/** Path base do storage Claude */
function claudeProjectsRoot(): string {
  return join(homedir(), '.claude', 'projects');
}

/**
 * HEAD_READ_BUFFER_SIZE: bytes a ler do começo do arquivo numa única
 * fs.read(). 64KB é sweet spot:
 *  - Grande o suficiente: cobre >50 linhas JSONL típicas, inclusive eventos
 *    tool_use / tool_result que podem ser 2-5KB cada.
 *  - Pequeno o suficiente: 1 syscall, sem múltiplos round-trips.
 *
 * BENCHMARK (`bench-io.mjs` rodado contra os arquivos reais do workspace):
 *   Arquivo de 133MB lendo 50 linhas:
 *     fs.open+read       = 10ms cold / 2-6ms warm
 *     createReadStream+rl = 17ms cold / 5ms warm
 *   Promise.all dos 40 files:
 *     STREAM 41ms cold / 33ms warm  vs  FSREAD 30ms cold / 21ms warm
 *   Ganho ~30-40% por arquivo + elimina overhead de iterator readline.
 *
 * Os 5-20s observados NÃO são I/O puro (I/O total dos 40 arquivos é <50ms
 * cold). I/O agora ainda mais barato; gargalo restante está em IPC / React /
 * cache logic (outros agentes).
 */
const HEAD_READ_BUFFER_SIZE = 64 * 1024;

/** Le primeira linha que match type=user pra extrair title */
async function extractSessionMeta(jsonlPath: string, sessionId: string): Promise<SessionMeta | null> {
  // Garante cache disco carregado antes do primeiro stat (idempotente, no-op após boot)
  if (!cacheLoaded) await ensureCacheLoaded();
  try {
    // === I/O TIMING ANCHORS ===
    // T0: pre-stat. T1: pos-stat. T2: pos-fs.open. T3: pos-read+parse.
    // T0->T1 = stat cost. T1->T2 = open cost. T2->T3 = read+parse cost.
    const T0 = Date.now();

    // 1. STAT primeiro — barato (~0.1ms) e dá mtime pra cache invalidation
    //    + lastTimestamp (mtime do arquivo = momento da última escrita do CLI,
    //    bom o suficiente pra ordenar a lista cronologicamente).
    const st = await stat(jsonlPath);
    const T1 = Date.now();
    if (st.size === 0) return null;

    // 2. CACHE HIT: se mtime não mudou desde a última leitura, retorna direto.
    //    Persistido em disco — depois do 1º boot é instantâneo até CLI escrever.
    //    Tolerância de 1ms pra cobrir precisão floating-point de mtimeMs entre
    //    JSON roundtrip (1779393381652.9038) e fresh stat (pode ter drift).
    const cached = metaCache.get(jsonlPath);
    if (cached && Math.abs(cached.mtimeMs - st.mtimeMs) < 1) {
      return cached.meta;
    }

    // 3. SINGLE-SHOT HEAD READ: fs.open + fs.read(buffer, 0, 64KB) DIRETO.
    //    Substitui createReadStream + readline.createInterface, que tinha:
    //      - Stream constructor + libuv chunking
    //      - Readline Interface (split regex + EventEmitter setup)
    //      - Async iterator (microtask por linha)
    //      - rl.close() + stream.destroy() (cleanup syscalls)
    //    1 syscall de 64KB cobre tudo pra arquivos JSONL deste formato
    //    (queremos ~50 linhas do INÍCIO; mesmo em arquivo de 138MB).
    //
    //    Title resolution priority:
    //      1. Primeira `type:"user"` com message.content text
    //      2. Primeiro `type:"queue-operation"` enqueue com `content`
    //      3. `type:"ai-title"` com `aiTitle`
    //      4. '(sem mensagem)' — sessão vazia/corrompida
    let title = '';
    let queueTitle = '';
    let aiTitle = '';
    let firstTimestamp = '';
    let cwd = '';
    let messageCount = 0;
    let linesScanned = 0;
    let bytesScanned = 0;

    const MAX_LINES_TO_SCAN = 50;
    const readSize = Math.min(HEAD_READ_BUFFER_SIZE, st.size);

    const fh = await fsOpen(jsonlPath, 'r');
    const T2 = Date.now();
    let headText: string;
    let bytesRead = 0;
    try {
      const buf = Buffer.allocUnsafe(readSize);
      const result = await fh.read(buf, 0, readSize, 0);
      bytesRead = result.bytesRead;
      headText = buf.toString('utf8', 0, bytesRead);
    } finally {
      await fh.close();
    }

    // Split em linhas usando '\n' literal (~2x mais rápido que /\r?\n/).
    // Se readSize < st.size, descartamos a última (possivelmente truncada).
    const rawLines = headText.split('\n');
    const linesArr = (readSize < st.size && rawLines.length > 0)
      ? rawLines.slice(0, -1)
      : rawLines;

    for (const lineRaw of linesArr) {
      const line = lineRaw.endsWith('\r') ? lineRaw.slice(0, -1) : lineRaw;
      if (!line.trim()) continue;
      linesScanned++;
      bytesScanned += Buffer.byteLength(line, 'utf8') + 1;

      // Quick count via string match — evita JSON.parse no hot path.
      if (line.includes('"type":"user"') || line.includes('"type":"assistant"')) {
        messageCount++;
      }

      try {
        const event = JSON.parse(line);

        if (typeof event.timestamp === 'string') {
          if (!firstTimestamp) firstTimestamp = event.timestamp;
        }
        if (!cwd && typeof event.cwd === 'string') cwd = event.cwd;

        // Title (prioridade 1) — primeira type:"user" com texto válido
        if (!title && event.type === 'user' && event.message) {
          let text = '';
          const content = event.message.content;
          if (typeof content === 'string') text = content;
          else if (Array.isArray(content)) {
            const first = content.find((c: { type?: string; text?: string }) => c.type === 'text');
            if (first?.text) text = first.text;
          }
          if (text && !text.startsWith('[Request interrupted')) {
            title = text.replace(/\s+/g, ' ').slice(0, 80).trim();
            if (text.length > 80) title += '…';
          }
        }

        // Fallback prioridade 2 — queue-operation enqueue com content
        if (!queueTitle && event.type === 'queue-operation' && event.operation === 'enqueue' && typeof event.content === 'string') {
          const text = event.content;
          if (text && !text.startsWith('[Request interrupted')) {
            queueTitle = text.replace(/\s+/g, ' ').slice(0, 80).trim();
            if (text.length > 80) queueTitle += '…';
          }
        }

        // Fallback prioridade 3 — ai-title (sessions stub)
        if (!aiTitle && event.type === 'ai-title' && typeof event.aiTitle === 'string') {
          aiTitle = event.aiTitle.replace(/\s+/g, ' ').slice(0, 80).trim();
          if (event.aiTitle.length > 80) aiTitle += '…';
        }
      } catch {
        // ignora linha malformada (ou JSON parcial truncado no fim do buffer)
      }

      // AGGRESSIVE EARLY EXIT: assim que tem title + cwd + firstTimestamp, PARA.
      const hasTitle = title || queueTitle || aiTitle;
      if (hasTitle && cwd && firstTimestamp) break;
      if (linesScanned >= MAX_LINES_TO_SCAN) break;
    }

    const T3 = Date.now();

    // Resolve title pela prioridade
    const resolvedTitle = title || queueTitle || aiTitle || '(sem mensagem)';

    // messageCount EXTRAPOLADO via byte rate.
    let finalMessageCount = messageCount;
    if (bytesScanned > 0 && st.size > bytesScanned) {
      const rate = messageCount / bytesScanned;
      finalMessageCount = Math.round(rate * st.size);
    }

    const meta: SessionMeta = {
      sessionId,
      title: resolvedTitle,
      firstTimestamp,
      // mtime do arquivo = última escrita do CLI. Bom o suficiente pra
      // ordenação cronológica.
      lastTimestamp: st.mtime.toISOString(),
      messageCount: finalMessageCount,
      cwd,
    };

    // Atualiza cache
    metaCache.set(jsonlPath, { mtimeMs: st.mtimeMs, meta });
    scheduleCacheSave();
    const totalMs = T3 - T0;
    if (totalMs > 50) {
      const statMs = T1 - T0;
      const openMs = T2 - T1;
      const readParseMs = T3 - T2;
      const sizeMB = (st.size / 1024 / 1024).toFixed(1);
      console.log(`[claude-sessions] extractSessionMeta ${sessionId.slice(0, 8)} took ${totalMs}ms (size=${sizeMB}MB lines=${linesScanned} bytes=${bytesRead} | stat=${statMs}ms open=${openMs}ms readparse=${readParseMs}ms)`);
    }
    return meta;
  } catch {
    return null;
  }
}

/**
 * In-flight dedupe pra listSessionsForWorkspace (mesma estratégia de
 * listKnownWorkspaces). Múltiplos panels podem pedir as sessions do mesmo
 * workspace simultaneamente no boot.
 */
const sessionsListInflight = new Map<string, Promise<SessionMeta[]>>();

/**
 * Lista todas as sessões salvas pra um workspace específico.
 * Ordenadas por lastTimestamp descendente (mais recente primeiro).
 *
 * Já paralelizado via Promise.all + cache mtime no extractSessionMeta.
 * Adiciona dedupe in-flight pra calls concorrentes sobre o mesmo workspace.
 */
/**
 * Faz o trabalho de fato — readdir + scan paralelo dos jsonl. Extraído pra
 * reuso entre fresh fetch (await pelo caller) e stale-while-revalidate
 * (fire-and-forget em background).
 */
function doListSessionsRefresh(workspacePath: string): Promise<SessionMeta[]> {
  const existing = sessionsListInflight.get(workspacePath);
  if (existing) return existing;

  const promise = (async () => {
    const t0 = Date.now();
    const encoded = encodeCwdPath(workspacePath);
    const projectDir = join(claudeProjectsRoot(), encoded);

    try {
      const entries = await readdir(projectDir);
      const jsonlFiles = entries.filter((f) => f.endsWith('.jsonl'));
      const tReaddir = Date.now() - t0;

      // CONCURRENCY LIMIT: 39 file streams paralelos no Windows saturam I/O
      // queue + thread pool do libuv. Cap em 8 paralelos = sweet spot pra HDD
      // moderno + Windows NTFS. SSD pode ir até 16, mas 8 é safe.
      const CONCURRENCY = 8;
      const sessions: (SessionMeta | null)[] = new Array(jsonlFiles.length);
      let nextIdx = 0;
      let cacheHits = 0;
      let cacheMisses = 0;
      const workers = Array.from({ length: Math.min(CONCURRENCY, jsonlFiles.length) }, async () => {
        while (true) {
          const idx = nextIdx++;
          if (idx >= jsonlFiles.length) break;
          const f = jsonlFiles[idx];
          const sessionId = f.replace(/\.jsonl$/, '');
          const fullPath = join(projectDir, f);
          // Track cache hit/miss usando estado pre-call
          const hadCache = metaCache.has(fullPath);
          const result = await extractSessionMeta(fullPath, sessionId);
          if (hadCache && result && metaCache.get(fullPath)?.meta === result) cacheHits++;
          else cacheMisses++;
          sessions[idx] = result;
        }
      });
      await Promise.all(workers);

      const finalSessions = sessions
        .filter((s): s is SessionMeta => s !== null)
        // GHOST FILTER: o Claude CLI cria .jsonl stub com só `{type:"ai-title"}`
        // pra cada sessão potencial — quando o user nunca interagiu, o arquivo
        // tem 0 user/assistant messages mas existe no disco. Não devem aparecer
        // na lista. messageCount === 0 = ghost.
        .filter((s) => s.messageCount > 0)
        .sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp));

      // Persiste snapshot
      listSnapshotCache.set(workspacePath, { ts: Date.now(), sessions: finalSessions });
      scheduleListCacheSave();

      const elapsed = Date.now() - t0;
      console.log(`[claude-sessions] listSessionsForWorkspace ${workspacePath} took ${elapsed}ms (readdir=${tReaddir}ms, ${jsonlFiles.length} files, ${cacheHits} hits, ${cacheMisses} misses, returned ${finalSessions.length})`);

      return finalSessions;
    } catch {
      return []; // pasta não existe = sem sessões
    } finally {
      sessionsListInflight.delete(workspacePath);
    }
  })();

  sessionsListInflight.set(workspacePath, promise);
  return promise;
}

export async function listSessionsForWorkspace(workspacePath: string): Promise<SessionMeta[]> {
  // Garante cache disco carregado ANTES de tentar in-flight match
  await ensureCacheLoaded();

  const existing = sessionsListInflight.get(workspacePath);
  if (existing) return existing;

  // FAST PATH + STALE-WHILE-REVALIDATE.
  //
  // FRESH (<60s): retorna direto SEM tocar disco.
  // STALE (<10min): retorna cache E dispara revalidação async — UI não bloqueia
  //   e os dados ficam até ~10min de idade. Quando o background refresh termina,
  //   o cache é atualizado e a próxima chamada já pega o novo. Esse trade-off
  //   é OK porque o CLI escreve no JSONL ativamente (mtime muda) — a única
  //   diferença visível é "messageCount" e "lastTimestamp" daquela sessão.
  //
  // Sem stale-while-revalidate, qualquer fechamento+reabertura de tab depois de
  // 5s ia pagar o stat() de N arquivos. No workspace Claude com 39 sessions
  // (algumas 138MB), mesmo só os stats levam ~100-300ms no Windows.
  const snapshot = listSnapshotCache.get(workspacePath);
  const SNAPSHOT_FRESH_MS = 60_000;
  const SNAPSHOT_STALE_MS = 10 * 60_000;
  const age = snapshot ? Date.now() - snapshot.ts : Infinity;
  if (snapshot && age < SNAPSHOT_FRESH_MS) {
    console.log(`[claude-sessions] FAST snapshot for ${workspacePath} (${snapshot.sessions.length} sessions, ${age}ms old)`);
    return snapshot.sessions;
  }
  if (snapshot && age < SNAPSHOT_STALE_MS) {
    // STALE — serve cache, dispara revalidação background. Caller não espera.
    console.log(`[claude-sessions] STALE snapshot for ${workspacePath} (${snapshot.sessions.length} sessions, ${age}ms old) — revalidando em background`);
    setImmediate(() => {
      if (sessionsListInflight.has(workspacePath)) return;
      void doListSessionsRefresh(workspacePath);
    });
    return snapshot.sessions;
  }

  return doListSessionsRefresh(workspacePath);
}

/**
 * SYNC SNAPSHOT: retorna o cache de lista IMEDIATAMENTE se existe (sem await).
 * Renderer chama isso pra evitar mostrar "Carregando..." quando temos dados
 * em cache. Caller deve disparar `listSessionsForWorkspace` em paralelo pra
 * revalidar.
 */
export function getCachedSessionsSnapshot(workspacePath: string): SessionMeta[] | null {
  const snap = listSnapshotCache.get(workspacePath);
  return snap ? snap.sessions : null;
}

/**
 * Retorna TODOS os snapshots de uma vez. Útil pro boot do renderer:
 * 1 IPC roundtrip popula a UI inteira instantaneamente.
 */
export function getAllCachedSessionsSnapshots(): Record<string, SessionMeta[]> {
  const out: Record<string, SessionMeta[]> = {};
  for (const [k, v] of listSnapshotCache) out[k] = v.sessions;
  return out;
}

/**
 * Cache + in-flight dedupe pra listKnownWorkspaces.
 *
 * O resultado dessa função é chamado 4× em paralelo no boot do app (App.tsx,
 * AgentManager, Palette, WelcomeView). Sem dedupe, cada caller dispara N
 * streams I/O concorrentes nos mesmos arquivos — Windows não lida bem com
 * isso e o resultado fica 4× mais lento.
 *
 * `inflightPromise` faz coalescing: se já tem uma chamada em vôo, os outros
 * 3 callers só awaitam a mesma Promise. `cachedResult` invalida após 10s
 * (suficiente pra cobrir o boot inteiro sem ficar stale demais).
 */
let knownWorkspacesCache: { ts: number; data: Array<{ path: string; sessionCount: number; lastUsed: string }> } | null = null;
let knownWorkspacesInflight: Promise<Array<{ path: string; sessionCount: number; lastUsed: string }>> | null = null;
const KNOWN_WORKSPACES_TTL_MS = 10_000;

/**
 * Lista TODOS os workspaces que tem sessões salvas no Claude storage.
 * Util pra mostrar "projetos conhecidos" mesmo se não estão nos recents do UNDRCOD.
 *
 * Otimizações:
 * - Cache 10s pra absorver bursts do boot (4 callers paralelos).
 * - In-flight Promise dedupe: callers concorrentes compartilham 1 fetch.
 * - Promise.all paralelizando o scan de cada workspace (era for serial).
 */
export async function listKnownWorkspaces(): Promise<Array<{ path: string; sessionCount: number; lastUsed: string }>> {
  // Cache hit dentro do TTL: retorna direto sem tocar disco
  const now = Date.now();
  if (knownWorkspacesCache && (now - knownWorkspacesCache.ts) < KNOWN_WORKSPACES_TTL_MS) {
    return knownWorkspacesCache.data;
  }
  // In-flight dedupe: já tem chamada rolando, awaita a mesma Promise
  if (knownWorkspacesInflight) {
    return knownWorkspacesInflight;
  }

  knownWorkspacesInflight = (async () => {
    const root = claudeProjectsRoot();
    try {
      const entries = await readdir(root);

      // PARALELIZADO: processa todos os workspaces em paralelo via Promise.all.
      // Era `for serial` que acumulava 30+ workspaces × 10-50ms = 300ms-1.5s.
      // Agora roda em paralelo limitado pelo CPU/disco = ~100-200ms total.
      const results = await Promise.all(
        entries.map(async (encoded) => {
          const dir = join(root, encoded);
          try {
            const dirStat = await stat(dir);
            if (!dirStat.isDirectory()) return null;
            const files = await readdir(dir);
            const jsonl = files.filter((f) => f.endsWith('.jsonl'));
            if (jsonl.length === 0) return null;

            // Le primeiro jsonl pra extrair cwd real (mais confiavel que decoding reverso).
            // Streaming + early break ao achar cwd — não carrega arquivo inteiro em RAM.
            const firstJsonl = join(dir, jsonl[0]);
            let cwd: string | null = null;
            try {
              const stream = createReadStream(firstJsonl, { encoding: 'utf8' });
              const rl = createInterface({ input: stream, crlfDelay: Infinity });
              let scanned = 0;
              try {
                for await (const line of rl) {
                  if (!line.trim()) continue;
                  scanned++;
                  if (scanned > 50) break;
                  try {
                    const event = JSON.parse(line);
                    if (typeof event.cwd === 'string' && event.cwd.length > 0) {
                      cwd = event.cwd;
                      break;
                    }
                  } catch { /* skip malformed line */ }
                }
              } finally {
                rl.close();
                stream.destroy();
              }
            } catch { /* ignora erro de stream */ }

            if (!cwd) {
              // Fallback: decodifica path do nome da pasta (C--Users-x → C:\Users\x).
              cwd = encoded.replace(/^([A-Za-z])--/, '$1:\\').replace(/-/g, '\\');
            }

            return {
              path: cwd,
              sessionCount: jsonl.length,
              lastUsed: dirStat.mtime.toISOString(),
            };
          } catch {
            return null;
          }
        })
      );

      const filtered = results
        .filter((r): r is { path: string; sessionCount: number; lastUsed: string } => r !== null)
        .sort((a, b) => b.lastUsed.localeCompare(a.lastUsed));

      knownWorkspacesCache = { ts: Date.now(), data: filtered };
      return filtered;
    } catch {
      return [];
    } finally {
      knownWorkspacesInflight = null;
    }
  })();

  return knownWorkspacesInflight;
}

/** Invalida o cache de known workspaces (chamar quando sabe que mudou — novo workspace, etc) */
export function invalidateKnownWorkspacesCache(): void {
  knownWorkspacesCache = null;
}

/** Extrai texto cru de `message.content` (string ou array de blocos). */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const blocks = content as Array<{ type?: string; text?: string }>;
    const textBlock = blocks.find((b) => b.type === 'text' && typeof b.text === 'string');
    return textBlock?.text ?? '';
  }
  return '';
}

/** Serializa conteudo de tool_result pra string (passa-through se já for string). */
function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/**
 * Le o .jsonl de uma sessão especifica e retorna eventos prontos pro renderer
 * reproduzir o transcript. Filtra ruidos do CLI (queue-operation, system init).
 *
 * Formato do Claude CLI jsonl (relevante aqui):
 *  - { type: 'user', message: { content: string | Array<{type:'text', text} | {type:'tool_result', tool_use_id, content, is_error}> } }
 *  - { type: 'assistant', message: { content: Array<{type:'text',text} | {type:'tool_use',id,name,input} | {type:'thinking',thinking}> } }
 *  - { type: 'queue-operation' | 'system' } -> filtrado
 *
 * Tool results normalmente vem ANINHADOS dentro de user messages com content[].
 * Cobrimos ambos os casos (nested + standalone) pra robustez.
 */
/**
 * Yieldar event loop a cada N linhas processadas, pra outras callbacks
 * (renderer IPC responses, file watch, etc) poderem rodar entre chunks.
 *
 * Antes: parse síncrono de 5000+ linhas bloqueava main thread ~100-300ms.
 * Sessions grandes do agente (rico em tool_use/tool_result) renderem renderer
 * todo travado esperando.
 *
 * Com setImmediate a cada 200 linhas, main thread libera entre batches.
 * Total parse time mesmo, mas APP NÃO TRAVA durante o processamento.
 */
function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
const PARSE_BATCH_SIZE = 200;

export async function readSessionHistory(
  sessionId: string,
  cwd: string,
  options?: ReadSessionHistoryOptions,
): Promise<SessionHistory> {
  const encoded = encodeCwdPath(cwd);
  const jsonlPath = join(claudeProjectsRoot(), encoded, `${sessionId}.jsonl`);

  try {
    const t0 = Date.now();

    // STREAMING READ: createReadStream + readline. Não materializa o arquivo
    // inteiro em string nem array de linhas. Pra fromEnd=true (caso UI default),
    // usa ringbuffer das últimas N linhas — só essas serão parseadas depois.
    //
    // Antes: readFile 5MB + split + slice = 10MB+ RAM allocada + 50ms só pro
    // split. Agora: stream 64KB chunks, ringbuffer holds last N lines = ~50KB.
    const wantLimit = options?.limit !== undefined && options.limit > 0;
    const wantFromEnd = wantLimit && options!.fromEnd;
    const wantOffset = wantLimit && !options!.fromEnd ? (options!.offset ?? 0) : 0;
    const limit = wantLimit ? options!.limit! : Infinity;

    let totalLines = 0;
    let lines: string[] = [];

    // Ringbuffer config: pra fromEnd, guarda apenas as últimas `limit` linhas.
    // Pra offset-based, guarda da linha `offset` até `offset + limit`.
    const ringMode = wantFromEnd;
    const stream = createReadStream(jsonlPath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
        totalLines++;

        if (!wantLimit) {
          // Carrega tudo (sem limite)
          lines.push(line);
        } else if (ringMode) {
          // fromEnd: ringbuffer das últimas N linhas
          lines.push(line);
          if (lines.length > limit) lines.shift();
        } else {
          // offset-based: pula até `offset`, pega até `offset + limit`
          const currentIdx = totalLines - 1;
          if (currentIdx >= wantOffset && currentIdx < wantOffset + limit) {
            lines.push(line);
          } else if (currentIdx >= wantOffset + limit) {
            // Já temos o slice todo, mas continuamos lendo pra computar totalLines.
            // Streaming até EOF é necessário pra messageCount correto.
          }
        }
      }
    } finally {
      rl.close();
      stream.destroy();
    }

    const returnedOffset = wantFromEnd
      ? Math.max(0, totalLines - lines.length)
      : wantOffset;

    const events: HistoryEvent[] = [];
    let messageCount = 0;
    let batchCounter = 0;

    for (const line of lines) {
      // Yield event loop a cada N linhas — sem isso, parse de 5000 linhas
      // bloqueia main thread inteiramente até completar.
      batchCounter++;
      if (batchCounter >= PARSE_BATCH_SIZE) {
        batchCounter = 0;
        await yieldEventLoop();
      }
      try {
        const raw = JSON.parse(line);
        const ts = typeof raw.timestamp === 'string' ? raw.timestamp : '';

        // Filtra eventos de housekeeping do CLI
        if (raw.type === 'queue-operation' || raw.type === 'system') continue;

        if (raw.type === 'user' && raw.message) {
          const msgContent = raw.message.content;
          if (Array.isArray(msgContent)) {
            // user message com array de blocks — pode conter tool_result inline
            for (const block of msgContent as Array<{
              type?: string;
              text?: string;
              tool_use_id?: string;
              content?: unknown;
              is_error?: boolean;
            }>) {
              if (block.type === 'tool_result') {
                events.push({
                  kind: 'tool_result',
                  toolUseId: block.tool_use_id ?? '',
                  result: stringifyToolResult(block.content),
                  isError: !!block.is_error,
                  timestamp: ts,
                });
              } else if (
                block.type === 'text' &&
                typeof block.text === 'string' &&
                block.text.length > 0 &&
                !block.text.startsWith('[Request interrupted')
              ) {
                events.push({ kind: 'user', text: block.text, timestamp: ts });
                messageCount++;
              }
            }
          } else if (typeof msgContent === 'string') {
            if (msgContent.length > 0 && !msgContent.startsWith('[Request interrupted')) {
              events.push({ kind: 'user', text: msgContent, timestamp: ts });
              messageCount++;
            }
          }
        } else if (raw.type === 'assistant' && raw.message) {
          const blocks = Array.isArray(raw.message.content) ? raw.message.content : [];
          let countedThisMessage = false;
          for (const block of blocks as Array<{
            type?: string;
            text?: string;
            id?: string;
            name?: string;
            input?: Record<string, unknown>;
            thinking?: string;
          }>) {
            if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
              events.push({ kind: 'assistant_text', text: block.text, timestamp: ts });
              countedThisMessage = true;
            } else if (block.type === 'tool_use') {
              events.push({
                kind: 'tool_use',
                id: block.id ?? '',
                name: block.name ?? 'Unknown',
                input: (block.input as Record<string, unknown>) ?? {},
                timestamp: ts,
              });
              countedThisMessage = true;
            } else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.length > 0) {
              events.push({ kind: 'thinking', text: block.thinking, timestamp: ts });
              countedThisMessage = true;
            }
          }
          if (countedThisMessage) messageCount++;
        } else if (raw.type === 'tool_result' || raw.toolUseResult) {
          // Fallback pra formato standalone (raro mas possível em versões antigas do CLI).
          const tur = raw.toolUseResult ?? raw;
          events.push({
            kind: 'tool_result',
            toolUseId: tur.tool_use_id ?? '',
            result: stringifyToolResult(tur.content),
            isError: !!tur.is_error,
            timestamp: ts,
          });
        }
      } catch {
        // pula linha malformada
      }
    }

    const elapsed = Date.now() - t0;
    if (elapsed > 200) {
      console.log(
        `[claude-sessions] readSessionHistory ${sessionId.slice(0, 8)} took ${elapsed}ms (${lines.length}/${totalLines} lines, ${events.length} events)`,
      );
    }
    return {
      sessionId,
      events,
      messageCount,
      totalEvents: totalLines,
      returnedOffset,
    };
  } catch {
    // Arquivo não existe ou erro de leitura — retorna vazio em vez de propagar.
    return { sessionId, events: [], messageCount: 0, totalEvents: 0, returnedOffset: 0 };
  }
}
