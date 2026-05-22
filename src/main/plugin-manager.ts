import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Plugin Marketplace backend pro Claude Code CLI.
 *
 * Fontes de dados (read path):
 *   1. ~/.claude/plugins/known_marketplaces.json — registry de marketplaces.
 *      Formato:
 *      { "<id>": {
 *          "source": { "source": "github", "repo": "owner/name" } | { ... },
 *          "installLocation": "C:\\...\\<id>",
 *          "lastUpdated": "ISO-8601"
 *        }
 *      }
 *
 *   2. <installLocation>/.claude-plugin/marketplace.json — catálogo de plugins.
 *      Formato:
 *      { "name": "<id>",
 *        "description": "...",
 *        "owner": { "name": "...", "email": "..." },
 *        "plugins": [
 *          { "name", "description", "author": { name, email }, "category",
 *            "source": "..." | { source, url, path?, ref?, sha? },
 *            "homepage" }
 *        ]
 *      }
 *
 *   3. `claude plugin list --json` — installed plugins (autoritativo, [] se nenhum).
 *   4. `claude plugin marketplace list --json` — marketplaces ativos (autoritativo).
 *
 * Mutações (write path):
 *   - Tudo via `claude plugin ...` CLI. Não tocamos JSON direto pra evitar
 *     dessincronizar com o estado interno do CLI (cache, sub-checkout git, etc).
 */

export interface MarketplaceSource {
  source: string; // 'github' | 'url' | 'git-subdir' | 'local' | ...
  repo?: string;
  url?: string;
  path?: string;
  ref?: string;
  sha?: string;
}

export interface Marketplace {
  id: string;
  name: string;
  url?: string;
  source: 'official' | 'custom';
  pluginCount: number;
  lastUpdated?: string;
  installLocation?: string;
}

export interface PluginMeta {
  name: string;
  description?: string;
  author?: string;
  category?: string;
  homepage?: string;
  marketplace: string; // marketplaceId
  source?: string; // github repo, url, ou path local
  installed?: boolean;
  enabled?: boolean;
  /** Numero real de instalacoes (do `claude plugin list --json --available`). */
  installCount?: number;
  /**
   * Lista de URLs de logo em ordem de preferência. Frontend tenta cada um e
   * faz fallback pra codicon se todos falharem. Tipicamente:
   *   1. simple-icons CDN (slug derivado do author)
   *   2. GitHub avatar do org/user extraido do homepage ou source URL
   */
  iconCandidates?: string[];
}

export interface InstalledPlugin {
  name: string;
  marketplace?: string;
  enabled: boolean;
  /** version pode vir "unknown" do CLI quando source e local path — frontend filtra. */
  version?: string;
  scope?: string;
}

/**
 * Inventario de componentes que um plugin traz, parsed do `claude plugin details`.
 * Cada categoria lista os NOMES dos componentes (não implementacao).
 */
export interface PluginDetails {
  name: string;
  description?: string;
  source?: string;
  skills: string[];
  agents: string[];
  commands: string[];
  hooks: string[];
  mcpServers: string[];
  lspServers: string[];
  /** Tokens always-on por sessão (overhead que o plugin adiciona). */
  alwaysOnTokens?: number;
}

const OFFICIAL_MARKETPLACE_ID = 'claude-plugins-official';

// ---------- claude CLI resolver ----------

/**
 * Resolve qual binário usar pra invocar `claude`. Em Windows, claude
 * virou exe nativo (não cli.js). Tentamos:
 *   1. APPDATA/npm/node_modules/.../bin/claude.exe (instalação padrão)
 *   2. claude.cmd via shell (fallback pro PATH resolver)
 */
function resolveClaude(): { command: string; useShell: boolean } {
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA;
    if (appdata) {
      const exe = join(
        appdata,
        'npm',
        'node_modules',
        '@anthropic-ai',
        'claude-code',
        'bin',
        'claude.exe',
      );
      if (existsSync(exe)) {
        return { command: exe, useShell: false };
      }
    }
    return { command: 'claude.cmd', useShell: true };
  }
  return { command: 'claude', useShell: false };
}

/**
 * Spawn `claude <args>` e captura stdout/stderr completo.
 * Timeout default 30s — install/marketplace-add chama git clone que pode demorar.
 */
function runClaude(
  args: string[],
  timeoutMs = 30_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const { command, useShell } = resolveClaude();
    let stdout = '';
    let stderr = '';
    let done = false;

    const finish = (code: number) => {
      if (done) return;
      done = true;
      resolve({ code, stdout, stderr });
    };

    let proc;
    try {
      proc = spawn(command, args, {
        env: process.env,
        windowsHide: true,
        shell: useShell,
      });
    } catch (err) {
      finish(-1);
      stderr = (err as Error).message;
      return;
    }

    const timer = setTimeout(() => {
      try {
        proc.kill('SIGTERM');
      } catch {
        /* noop */
      }
      stderr += `\n[timeout após ${timeoutMs}ms]`;
      finish(-1);
    }, timeoutMs);

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    proc.on('error', (err) => {
      stderr += (err as Error).message;
      clearTimeout(timer);
      finish(-1);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      finish(code ?? -1);
    });
  });
}

// ---------- JSON helpers ----------

async function readJsonObj<T = unknown>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function pluginsRoot(): string {
  return join(homedir(), '.claude', 'plugins');
}

function knownMarketplacesPath(): string {
  return join(pluginsRoot(), 'known_marketplaces.json');
}

/** Tenta extrair string legível de um campo author que pode ser string ou {name,email}. */
function normalizeAuthor(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as { name?: unknown; email?: unknown };
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.email === 'string') return obj.email;
  }
  return undefined;
}

/** Tenta extrair URL/repo legível de um campo source. */
function normalizeSource(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as { url?: unknown; repo?: unknown; path?: unknown };
    if (typeof obj.url === 'string') return obj.url;
    if (typeof obj.repo === 'string') return obj.repo;
    if (typeof obj.path === 'string') return obj.path;
  }
  return undefined;
}

/**
 * Deriva uma lista ordenada de URLs candidatas pra logo do plugin.
 * Estrategia: simple-icons (marcas conhecidas) -> GitHub avatar (org/user) -> nada.
 * Frontend tenta na ordem e faz fallback pra codicon se todos 404.
 *
 * Slug do simple-icons: lowercase + sem espaco/hifen/pontuacao (ex: "Adobe" -> "adobe", "GitHub" -> "github").
 * GitHub org/user: extraido do primeiro segmento de path de uma URL github.com.
 */
function deriveIconCandidates(opts: {
  author?: string;
  homepage?: string;
  source?: string;
  name: string;
}): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (url: string | undefined): void => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push(url);
  };

  // 1) simple-icons via author name
  if (opts.author) {
    const slug = opts.author.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (slug && slug !== 'anthropic') {
      // anthropic não tem logo no simple-icons, vai cair no fallback
      add(`https://cdn.simpleicons.org/${slug}`);
    }
  }

  // 2) Tenta extrair org do homepage OR source (preferindo homepage que costuma
  //    apontar pra docs do parceiro, e source que aponta pra github do plugin).
  const urls = [opts.homepage, opts.source].filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  );
  for (const url of urls) {
    // Match github.com/{org} ou raw.githubusercontent.com/{org}
    const m = url.match(/(?:github\.com|githubusercontent\.com)\/([A-Za-z0-9_.-]+)/i);
    if (m && m[1]) {
      const org = m[1];
      // Tenta simple-icons com o org também (cobre casos tipo "adobe", "asana" em vez de display name)
      const orgSlug = org.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (orgSlug && orgSlug !== 'anthropics' && orgSlug !== 'anthropic') {
        add(`https://cdn.simpleicons.org/${orgSlug}`);
      }
      add(`https://github.com/${org}.png?size=80`);
    }
  }

  // 3) Fallback final: pic do nome do plugin (raro funcionar mas tentamos)
  if (candidates.length === 0 && opts.name) {
    const slug = opts.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (slug) add(`https://cdn.simpleicons.org/${slug}`);
  }

  return candidates;
}

// ---------- Public API ----------

/**
 * Lista marketplaces registrados. Lê known_marketplaces.json e cruza
 * com o catálogo pra contar plugins.
 */
export async function listMarketplaces(): Promise<Marketplace[]> {
  const known = await readJsonObj<Record<string, {
    source?: { source?: string; repo?: string; url?: string };
    installLocation?: string;
    lastUpdated?: string;
  }>>(knownMarketplacesPath());

  if (!known || typeof known !== 'object') return [];

  const out: Marketplace[] = [];
  for (const [id, entry] of Object.entries(known)) {
    if (!entry || typeof entry !== 'object') continue;

    // Conta plugins lendo o catálogo (lazy — pode estar offline/desatualizado)
    let pluginCount = 0;
    const catalogPath = entry.installLocation
      ? join(entry.installLocation, '.claude-plugin', 'marketplace.json')
      : null;
    if (catalogPath) {
      const catalog = await readJsonObj<{ plugins?: unknown[] }>(catalogPath);
      if (catalog && Array.isArray(catalog.plugins)) {
        pluginCount = catalog.plugins.length;
      }
    }

    const src = entry.source;
    const url = src?.repo
      ? `https://github.com/${src.repo}`
      : typeof src?.url === 'string'
        ? src.url
        : undefined;

    out.push({
      id,
      name: id,
      url,
      source: id === OFFICIAL_MARKETPLACE_ID ? 'official' : 'custom',
      pluginCount,
      lastUpdated: entry.lastUpdated,
      installLocation: entry.installLocation,
    });
  }
  return out;
}

/**
 * Lista plugins de UM marketplace. Le o catalogo `marketplace.json` daquele
 * marketplace. Retorna [] se marketplace inexistente.
 *
 * Tambem cruza com `claude plugin list --json --available` pra trazer
 * installCount real (número de instalacoes mundialmente). Cache 60s.
 */
let availableCache: { value: Map<string, number>; expiresAt: number } | null = null;
const AVAILABLE_TTL_MS = 60_000;

async function readAvailableInstallCounts(): Promise<Map<string, number>> {
  if (availableCache && availableCache.expiresAt > Date.now()) {
    return availableCache.value;
  }
  // `claude plugin list --json --available` retorna { installed: [], available: [{pluginId, installCount, ...}] }
  const { code, stdout } = await runClaude(['plugin', 'list', '--json', '--available'], 15_000);
  const out = new Map<string, number>();
  if (code === 0) {
    try {
      const parsed = JSON.parse(stdout) as { available?: unknown };
      if (parsed && Array.isArray(parsed.available)) {
        for (const item of parsed.available) {
          if (!item || typeof item !== 'object') continue;
          const r = item as { name?: unknown; installCount?: unknown };
          if (typeof r.name === 'string' && typeof r.installCount === 'number') {
            out.set(r.name, r.installCount);
          }
        }
      }
    } catch {
      // JSON malformado — ignora, cache vazio expirara em 60s
    }
  }
  availableCache = { value: out, expiresAt: Date.now() + AVAILABLE_TTL_MS };
  return out;
}

export async function listPlugins(marketplaceId: string): Promise<PluginMeta[]> {
  if (!marketplaceId || typeof marketplaceId !== 'string') return [];
  const known = await readJsonObj<Record<string, { installLocation?: string }>>(
    knownMarketplacesPath(),
  );
  const entry = known?.[marketplaceId];
  if (!entry?.installLocation) return [];

  const catalogPath = join(entry.installLocation, '.claude-plugin', 'marketplace.json');
  const catalog = await readJsonObj<{
    plugins?: Array<Record<string, unknown>>;
  }>(catalogPath);
  if (!catalog || !Array.isArray(catalog.plugins)) return [];

  // Cruza com installed/enabled state + installCount real (paralelo pra perf)
  const [installed, installCounts] = await Promise.all([
    listInstalledPlugins(),
    readAvailableInstallCounts(),
  ]);
  const installedByName = new Map(installed.map((p) => [p.name, p]));

  const out: PluginMeta[] = [];
  for (const raw of catalog.plugins) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as {
      name?: unknown;
      description?: unknown;
      author?: unknown;
      category?: unknown;
      homepage?: unknown;
      source?: unknown;
    };
    if (typeof r.name !== 'string' || !r.name) continue;

    const installedEntry = installedByName.get(r.name);
    const author = normalizeAuthor(r.author);
    const homepage = typeof r.homepage === 'string' ? r.homepage : undefined;
    const source = normalizeSource(r.source);
    const iconCandidates = deriveIconCandidates({ author, homepage, source, name: r.name });
    out.push({
      name: r.name,
      description: typeof r.description === 'string' ? r.description : undefined,
      author,
      category: typeof r.category === 'string' ? r.category : undefined,
      homepage,
      source,
      marketplace: marketplaceId,
      installed: !!installedEntry,
      enabled: installedEntry?.enabled,
      installCount: installCounts.get(r.name),
      iconCandidates,
    });
  }
  return out;
}

/**
 * Inventario detalhado de um plugin instalado via `claude plugin details <name>`.
 *
 * Output do CLI não tem --json (testado v2.x), só texto formatado tipo:
 *   agent-sdk-dev
 *     Claude Agent SDK Development Plugin
 *     Source: agent-sdk-dev@claude-plugins-official
 *
 *   Component inventory
 *     Skills (1)  new-sdk-app
 *     Agents (2)  agent-sdk-verifier-py, agent-sdk-verifier-ts
 *     Hooks (0)
 *     MCP servers (0)
 *     LSP servers (0)
 *
 *   Projected token cost
 *     Always-on:   ~169 tok   added to every session
 *     ...
 *
 * Parseamos via regex tolerante. Se a estrutura mudar em versões futuras,
 * retornamos best-effort com campos parciais.
 */
export async function getPluginDetails(name: string): Promise<PluginDetails | null> {
  if (!name || typeof name !== 'string') return null;
  const { code, stdout } = await runClaude(['plugin', 'details', name], 15_000);
  if (code !== 0) return null;
  return parsePluginDetails(name, stdout);
}

/** Helper testavel — parseia o texto stdout de `claude plugin details`. */
export function parsePluginDetails(name: string, text: string): PluginDetails | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  const details: PluginDetails = {
    name,
    skills: [],
    agents: [],
    commands: [],
    hooks: [],
    mcpServers: [],
    lspServers: [],
  };

  // Pega description (segunda linha indentada após o nome)
  // e Source na linha "  Source: <foo>@<marketplace>"
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const line = lines[i];
    const srcMatch = line.match(/^\s*Source:\s*(.+)$/);
    if (srcMatch) {
      details.source = srcMatch[1].trim();
      continue;
    }
    // Description: linha indentada após nome, antes de "Component inventory"
    if (i > 0 && !details.description && line.trim() && !line.includes('Source:') && !line.includes('Component inventory')) {
      details.description = line.trim();
    }
    if (line.includes('Component inventory')) break;
  }

  // Parse "Skills (N)  item1, item2, ..." e similares
  const categoryRegex = /^\s*(Skills|Agents|Commands|Hooks|MCP servers|LSP servers)\s*\((\d+)\)\s*(.*)$/;
  for (const line of lines) {
    const m = line.match(categoryRegex);
    if (!m) continue;
    const category = m[1];
    const count = parseInt(m[2], 10);
    const items = m[3].trim();
    if (count === 0 || !items) continue;
    const parsed = items.split(',').map((s) => s.trim()).filter(Boolean);
    if (category === 'Skills') details.skills = parsed;
    else if (category === 'Agents') details.agents = parsed;
    else if (category === 'Commands') details.commands = parsed;
    else if (category === 'Hooks') details.hooks = parsed;
    else if (category === 'MCP servers') details.mcpServers = parsed;
    else if (category === 'LSP servers') details.lspServers = parsed;
  }

  // Always-on tokens: "  Always-on:   ~169 tok   added to every session"
  const tokMatch = text.match(/Always-on:\s*~?(\d+)\s*tok/i);
  if (tokMatch) {
    details.alwaysOnTokens = parseInt(tokMatch[1], 10);
  }

  return details;
}

/**
 * Lista plugins instalados via `claude plugin list --json`.
 * Tolera várias formas de output (array plano OU {installed, available}).
 */
export async function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  const { code, stdout } = await runClaude(['plugin', 'list', '--json'], 15_000);
  if (code !== 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }

  // Formato 1: { installed: [...], available: [...] }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as { installed?: unknown };
    if (Array.isArray(obj.installed)) parsed = obj.installed;
    else return [];
  }

  if (!Array.isArray(parsed)) return [];

  const out: InstalledPlugin[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as {
      // Formato real do `claude plugin list --json` (testado contra v2.x):
      //   { id: "name@marketplace", version, scope, enabled, installPath, ... }
      id?: unknown;
      name?: unknown;
      pluginId?: unknown;
      marketplace?: unknown;
      marketplaceName?: unknown;
      enabled?: unknown;
      disabled?: unknown;
      version?: unknown;
      scope?: unknown;
    };

    // name pode vir como "name", "pluginId" ou "id" — todos podem ter forma "foo@marketplace"
    let name: string | undefined;
    let marketplace: string | undefined;
    const candidate =
      typeof r.id === 'string' ? r.id :
      typeof r.pluginId === 'string' ? r.pluginId :
      typeof r.name === 'string' ? r.name : undefined;
    if (candidate) {
      const at = candidate.indexOf('@');
      if (at > 0) {
        name = candidate.slice(0, at);
        marketplace = candidate.slice(at + 1);
      } else {
        name = candidate;
      }
    }
    if (!name) continue;

    if (!marketplace) {
      if (typeof r.marketplace === 'string') marketplace = r.marketplace;
      else if (typeof r.marketplaceName === 'string') marketplace = r.marketplaceName;
    }

    // enabled: prioriza campo explícito; senão deriva de disabled
    let enabled = true;
    if (typeof r.enabled === 'boolean') enabled = r.enabled;
    else if (typeof r.disabled === 'boolean') enabled = !r.disabled;

    out.push({
      name,
      marketplace,
      enabled,
      version: typeof r.version === 'string' ? r.version : undefined,
      scope: typeof r.scope === 'string' ? r.scope : undefined,
    });
  }
  return out;
}

/**
 * Instala plugin via `claude plugin install <name>@<marketplaceId>`.
 * Timeout 60s — install pode envolver git clone de plugin externo.
 */
export async function installPlugin(
  name: string,
  marketplaceId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!name || typeof name !== 'string') return { ok: false, error: 'Nome de plugin inválido' };
  if (!marketplaceId || typeof marketplaceId !== 'string') {
    return { ok: false, error: 'Marketplace inválido' };
  }
  const target = `${name}@${marketplaceId}`;
  const { code, stderr } = await runClaude(['plugin', 'install', target], 60_000);
  if (code === 0) {
    // Invalida cache do --available pra próximo list pegar installCount atualizado
    // (e o installed state do plugin instalado)
    availableCache = null;
    return { ok: true };
  }
  return { ok: false, error: stderr.trim() || `claude saiu com código ${code}` };
}

/**
 * Desinstala plugin via `claude plugin uninstall <name> -y`. `-y` pula
 * confirmação interativa do --prune que CLI exige em ambientes não-TTY.
 */
export async function uninstallPlugin(
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!name || typeof name !== 'string') return { ok: false, error: 'Nome de plugin inválido' };
  const { code, stderr } = await runClaude(['plugin', 'uninstall', name, '-y'], 30_000);
  if (code === 0) {
    availableCache = null;
    return { ok: true };
  }
  return { ok: false, error: stderr.trim() || `claude saiu com código ${code}` };
}

/**
 * Liga/desliga plugin via `claude plugin enable|disable <name>`.
 */
export async function setPluginEnabled(
  name: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!name || typeof name !== 'string') return { ok: false, error: 'Nome de plugin inválido' };
  const verb = enabled ? 'enable' : 'disable';
  const { code, stderr } = await runClaude(['plugin', verb, name], 20_000);
  if (code === 0) {
    availableCache = null;
    return { ok: true };
  }
  return { ok: false, error: stderr.trim() || `claude saiu com código ${code}` };
}

/**
 * Adiciona marketplace via `claude plugin marketplace add <source>`.
 * `source` pode ser GitHub repo (owner/name), URL git, ou path local.
 * Timeout 60s — git clone do marketplace.
 */
export async function addMarketplace(
  githubRepo: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!githubRepo || typeof githubRepo !== 'string') {
    return { ok: false, error: 'Repositório inválido' };
  }
  const { code, stderr } = await runClaude(
    ['plugin', 'marketplace', 'add', githubRepo],
    60_000,
  );
  if (code === 0) return { ok: true };
  return { ok: false, error: stderr.trim() || `claude saiu com código ${code}` };
}

/**
 * Remove marketplace via `claude plugin marketplace remove <id>`.
 */
export async function removeMarketplace(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!id || typeof id !== 'string') return { ok: false, error: 'ID inválido' };
  const { code, stderr } = await runClaude(
    ['plugin', 'marketplace', 'remove', id],
    20_000,
  );
  if (code === 0) return { ok: true };
  return { ok: false, error: stderr.trim() || `claude saiu com código ${code}` };
}

/**
 * Atualiza marketplace via `claude plugin marketplace update <id>`.
 * Faz git pull do repo do marketplace + atualiza catálogo. Timeout 60s.
 */
export async function refreshMarketplace(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!id || typeof id !== 'string') return { ok: false, error: 'ID inválido' };
  const { code, stderr } = await runClaude(
    ['plugin', 'marketplace', 'update', id],
    60_000,
  );
  if (code === 0) return { ok: true };
  return { ok: false, error: stderr.trim() || `claude saiu com código ${code}` };
}
