/**
 * customization-manager — discovery read-only de tudo que customiza o Claude
 * CLI: Rules (CLAUDE.md/AGENTS.md), Skills (SKILL.md), Workflows (slash commands),
 * Agents (agents/*.md) e Hooks (do settings.json).
 *
 * Fontes lidas:
 *   - <cwd>/CLAUDE.md, <cwd>/AGENTS.md                  (workspace rules)
 *   - <cwd>/.claude/CLAUDE.md, CLAUDE.local.md, AGENTS.md
 *   - <cwd>/.claude/{skills,commands,agents}/...
 *   - <cwd>/.claude/settings.json (hooks)
 *   - ~/.claude/CLAUDE.md, AGENTS.md                    (user global rules)
 *   - ~/.claude/{skills,commands,agents}/...            (user global)
 *   - ~/.claude/settings.json (hooks user global)
 *   - ~/.claude/plugins/installed_plugins.json          (mapa installPath dos plugins)
 *     → <installPath>/{skills,commands,agents}/...      (componentes de cada plugin)
 *
 * MCP servers NAO entram aqui — frontend já usa listMcpServers via mcp-config.ts.
 *
 * Contrato: nenhuma função throws. Tudo retorna [] em erro (arquivo não existe,
 * JSON malformado, frontmatter inútil, permissao negada).
 */

import { readFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ---------- Types (também duplicados no preload pra renderer; aqui são a fonte) ----------

export type Scope = 'workspace' | 'user' | 'plugin';

export interface Rule {
  scope: Scope;
  path: string;
  filename: string;
  preview: string;
  bytes: number;
  mtime: number;
}

export interface Skill {
  scope: Scope;
  name: string;
  description?: string;
  version?: string;
  userInvocable?: boolean;
  argumentHint?: string;
  path: string;
  pluginName?: string;
}

export interface Workflow {
  scope: Scope;
  name: string;
  description?: string;
  path: string;
  pluginName?: string;
}

export interface Agent {
  scope: Scope;
  name: string;
  description?: string;
  model?: string;
  tools?: string[];
  path: string;
  pluginName?: string;
}

export interface HookEntry {
  scope: Scope;
  event: string;
  matcher: string;
  command: string;
  type: string;
  timeout?: number;
  sourceSettings: string;
}

export interface CustomizationSummary {
  rules: Rule[];
  skills: Skill[];
  workflows: Workflow[];
  agents: Agent[];
  hooks: HookEntry[];
}

// ---------- Helpers ----------

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

async function readJsonObj<T>(path: string): Promise<T | null> {
  const raw = await readFileSafe(path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function statSafe(path: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const s = await stat(path);
    return { size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}

async function readdirSafe(path: string): Promise<string[]> {
  // readdir já lança ENOENT se o path não existir — o catch resolve isso sem
  // precisar do existsSync síncrono que bloqueia event loop.
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function isDirSafe(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Parser YAML frontmatter manual (sem libs externas). Cobre os formatos reais
 * usados em SKILL.md / agents/*.md / commands/*.md do ecossistema Claude:
 *
 *   ---
 *   key: value
 *   bool-key: true
 *   list-inline: [a, b, c]
 *   list-block:
 *     - item1
 *     - item2
 *   multiline: |
 *     line1
 *     line2
 *   ---
 *
 * Tolerante a aspas opcionais, true/false case-insensitive, e número simples.
 * Retorna { meta: {}, body: text } se não tiver frontmatter (mantem entrada igual).
 */
export function parseFrontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  if (!text || typeof text !== 'string') return { meta: {}, body: text || '' };
  // Frontmatter só se comeca com --- na primeira linha.
  // Aceita \r\n e \n.
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const yamlBody = m[1];
  const rest = m[2] ?? '';
  const meta: Record<string, unknown> = {};

  const lines = yamlBody.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Ignora linha vazia ou comentario
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    // Key indentada (sub-objeto) não suportada — pula
    if (line.startsWith(' ') || line.startsWith('\t')) {
      i++;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/);
    if (!kv) {
      i++;
      continue;
    }
    const key = kv[1];
    const rawValue = kv[2];

    // Block list (`-` em linhas seguintes indentadas)
    if (rawValue.trim() === '' || rawValue.trim() === '|' || rawValue.trim() === '>') {
      // Multiline string ou block list. Item de lista pode ser scalar
      // (string/bool/number); linha solta de multiline string e sempre string.
      const listItems: Array<string | boolean | number> = [];
      const stringLines: string[] = [];
      let j = i + 1;
      let isList = false;
      while (j < lines.length) {
        const next = lines[j];
        // Para no próximo top-level key (sem indent)
        if (next.length > 0 && !next.startsWith(' ') && !next.startsWith('\t')) break;
        const trimmed = next.trim();
        if (!trimmed) {
          j++;
          continue;
        }
        if (trimmed.startsWith('- ')) {
          isList = true;
          listItems.push(parseScalar(trimmed.slice(2).trim()));
        } else {
          stringLines.push(trimmed);
        }
        j++;
      }
      if (isList) {
        meta[key] = listItems;
      } else if (stringLines.length > 0) {
        // Multiline string (| ou >) — junta com newline
        meta[key] = stringLines.join(rawValue.trim() === '>' ? ' ' : '\n');
      }
      i = j;
      continue;
    }

    // Inline list: [a, b, c]
    if (rawValue.trim().startsWith('[') && rawValue.trim().endsWith(']')) {
      const inner = rawValue.trim().slice(1, -1);
      const items = inner
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map(parseScalar);
      meta[key] = items;
      i++;
      continue;
    }

    // Valor escalar inline
    meta[key] = parseScalar(rawValue);
    i++;
  }

  return { meta, body: rest };
}

/** Coerce string YAML pra boolean/number/string. Remove aspas se cercam tudo. */
function parseScalar(raw: string): string | boolean | number {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === 'true') return true;
  if (trimmed.toLowerCase() === 'false') return false;
  // Aspas duplas ou simples cercando inteiro
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  // Numero simples (só se não tiver letras)
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isNaN(n)) return n;
  }
  return trimmed;
}

function metaString(meta: Record<string, unknown>, key: string): string | undefined {
  const v = meta[key];
  if (typeof v === 'string' && v.length > 0) return v;
  return undefined;
}

function metaBool(meta: Record<string, unknown>, key: string): boolean | undefined {
  const v = meta[key];
  if (typeof v === 'boolean') return v;
  return undefined;
}

function metaStringArray(meta: Record<string, unknown>, key: string): string[] | undefined {
  const v = meta[key];
  if (Array.isArray(v)) {
    const out = v.filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (out.length > 0) return out;
  }
  if (typeof v === 'string' && v.length > 0) {
    // "a, b, c" string — split
    return v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return undefined;
}

/** Strip de frontmatter + pega primeiros 240 chars do body, normalizando whitespace. */
function buildPreview(text: string): string {
  const { body } = parseFrontmatter(text);
  // Remove headers markdown e quebras de linha multiplas
  const cleaned = body
    .replace(/^#+\s+/gm, '')
    .replace(/\r/g, '')
    .trim();
  if (cleaned.length <= 240) return cleaned;
  return cleaned.slice(0, 240).trimEnd();
}

// ---------- Plugin installPath discovery ----------

interface InstalledPluginsV2 {
  version?: number;
  plugins?: Record<
    string,
    Array<{ scope?: string; installPath?: string; version?: string }>
  >;
}

/**
 * Le ~/.claude/plugins/installed_plugins.json e retorna { pluginName: installPath }.
 *
 * Formato real (v2):
 *   { "plugins": {
 *       "agent-sdk-dev@claude-plugins-official": [{ installPath: "...\\agent-sdk-dev\\unknown" }],
 *       ...
 *   }}
 *
 * Key tem formato "name@marketplace" — quebramos no '@' pra extrair o nome.
 * Multiplas instalacoes da mesma key (array) — pegamos a primeira como autoritativa.
 */
async function getInstalledPluginPaths(): Promise<Array<{ name: string; installPath: string }>> {
  const path = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
  const parsed = await readJsonObj<InstalledPluginsV2>(path);
  if (!parsed?.plugins || typeof parsed.plugins !== 'object') return [];

  const out: Array<{ name: string; installPath: string }> = [];
  for (const [key, entries] of Object.entries(parsed.plugins)) {
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const first = entries[0];
    if (!first || typeof first !== 'object') continue;
    const installPath = typeof first.installPath === 'string' ? first.installPath : '';
    if (!installPath || !existsSync(installPath)) continue;
    // Key vem como "name@marketplace" — quebra no '@'
    const at = key.indexOf('@');
    const name = at > 0 ? key.slice(0, at) : key;
    out.push({ name, installPath });
  }
  return out;
}

// ---------- listRules ----------

/**
 * Convencoes lidas:
 *   - <cwd>/CLAUDE.md
 *   - <cwd>/AGENTS.md  (convencao crescente do ecossistema multi-agente)
 *   - <cwd>/.claude/CLAUDE.md
 *   - <cwd>/.claude/CLAUDE.local.md
 *   - <cwd>/.claude/AGENTS.md
 *   - ~/.claude/CLAUDE.md
 *   - ~/.claude/AGENTS.md
 *
 * Preview: primeiros 240 chars do body após strip de frontmatter.
 */
export async function listRules(cwd: string): Promise<Rule[]> {
  const home = homedir();
  const candidates: Array<{ path: string; scope: Scope }> = [];

  if (cwd && typeof cwd === 'string') {
    candidates.push({ path: join(cwd, 'CLAUDE.md'), scope: 'workspace' });
    candidates.push({ path: join(cwd, 'AGENTS.md'), scope: 'workspace' });
    candidates.push({ path: join(cwd, '.claude', 'CLAUDE.md'), scope: 'workspace' });
    candidates.push({ path: join(cwd, '.claude', 'CLAUDE.local.md'), scope: 'workspace' });
    candidates.push({ path: join(cwd, '.claude', 'AGENTS.md'), scope: 'workspace' });
  }
  candidates.push({ path: join(home, '.claude', 'CLAUDE.md'), scope: 'user' });
  candidates.push({ path: join(home, '.claude', 'AGENTS.md'), scope: 'user' });

  // Paraleliza todos os candidates — antes era for serial com existsSync sync
  // bloqueante. Agora readFileSafe/statSafe retornam null pra arquivo ausente.
  const results = await Promise.all(
    candidates.map(async (cand) => {
      const [content, st] = await Promise.all([readFileSafe(cand.path), statSafe(cand.path)]);
      if (content === null || st === null) return null;
      const filename = cand.path.split(/[\\/]/).pop() ?? cand.path;
      return {
        scope: cand.scope,
        path: cand.path,
        filename,
        preview: buildPreview(content),
        bytes: st.size,
        mtime: st.mtimeMs,
      } as Rule;
    })
  );
  return results
    .filter((r): r is Rule => r !== null)
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

// ---------- listSkills ----------

/**
 * Lista SKILL.md de:
 *   - <cwd>/.claude/skills/<name>/SKILL.md     (workspace)
 *   - ~/.claude/skills/<name>/SKILL.md          (user)
 *   - <pluginInstallPath>/skills/<name>/SKILL.md (plugin, pluginName setado)
 *
 * Frontmatter: name, description, version, user-invocable, argument-hint, allowed-tools.
 */
export async function listSkills(cwd: string): Promise<Skill[]> {
  const home = homedir();
  const sources: Array<{ dir: string; scope: Scope; pluginName?: string }> = [];

  if (cwd) sources.push({ dir: join(cwd, '.claude', 'skills'), scope: 'workspace' });
  sources.push({ dir: join(home, '.claude', 'skills'), scope: 'user' });

  const plugins = await getInstalledPluginPaths();
  for (const p of plugins) {
    sources.push({
      dir: join(p.installPath, 'skills'),
      scope: 'plugin',
      pluginName: p.name,
    });
  }

  // Paraleliza: cada source roda em paralelo, e dentro de cada source os
  // entries também em paralelo. Sem existsSync sync — readFileSafe retorna
  // null se SKILL.md não existir.
  const perSource = await Promise.all(
    sources.map(async (src) => {
      const entries = await readdirSafe(src.dir);
      const items = await Promise.all(
        entries.map(async (entry) => {
          const folderPath = join(src.dir, entry);
          if (!(await isDirSafe(folderPath))) return null;
          const skillMd = join(folderPath, 'SKILL.md');
          const content = await readFileSafe(skillMd);
          if (content === null) return null;
          const { meta } = parseFrontmatter(content);
          return {
            scope: src.scope,
            name: metaString(meta, 'name') ?? entry,
            description: metaString(meta, 'description'),
            version: metaString(meta, 'version'),
            userInvocable: metaBool(meta, 'user-invocable'),
            argumentHint: metaString(meta, 'argument-hint'),
            path: skillMd,
            pluginName: src.pluginName,
          } as Skill;
        })
      );
      return items.filter((s): s is Skill => s !== null);
    })
  );
  return perSource.flat().sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- listWorkflows (slash commands) ----------

/**
 * Slash commands customizados são .md files em:
 *   - <cwd>/.claude/commands/*.md       (workspace)
 *   - ~/.claude/commands/*.md            (user)
 *   - <pluginInstallPath>/commands/*.md  (plugin)
 *
 * Nome = filename sem extensão (eg 'review.md' -> 'review').
 * Description vem do frontmatter (campo 'description').
 */
export async function listWorkflows(cwd: string): Promise<Workflow[]> {
  const home = homedir();
  const sources: Array<{ dir: string; scope: Scope; pluginName?: string }> = [];

  if (cwd) sources.push({ dir: join(cwd, '.claude', 'commands'), scope: 'workspace' });
  sources.push({ dir: join(home, '.claude', 'commands'), scope: 'user' });

  const plugins = await getInstalledPluginPaths();
  for (const p of plugins) {
    sources.push({
      dir: join(p.installPath, 'commands'),
      scope: 'plugin',
      pluginName: p.name,
    });
  }

  // Paraleliza sources e entries (mesma estratégia de listSkills).
  const perSource = await Promise.all(
    sources.map(async (src) => {
      const entries = await readdirSafe(src.dir);
      const items = await Promise.all(
        entries
          .filter((entry) => entry.endsWith('.md'))
          .map(async (entry) => {
            const filePath = join(src.dir, entry);
            const content = await readFileSafe(filePath);
            if (content === null) return null;
            const { meta } = parseFrontmatter(content);
            const name = entry.replace(/\.md$/i, '');
            return {
              scope: src.scope,
              name,
              description: metaString(meta, 'description'),
              path: filePath,
              pluginName: src.pluginName,
            } as Workflow;
          })
      );
      return items.filter((w): w is Workflow => w !== null);
    })
  );
  return perSource.flat().sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- listAgents ----------

/**
 * Sub-agents customizados são .md files com frontmatter em:
 *   - <cwd>/.claude/agents/*.md       (workspace)
 *   - ~/.claude/agents/*.md            (user)
 *   - <pluginInstallPath>/agents/*.md  (plugin)
 *
 * Frontmatter: name, description, model, tools (array).
 */
export async function listAgents(cwd: string): Promise<Agent[]> {
  const home = homedir();
  const sources: Array<{ dir: string; scope: Scope; pluginName?: string }> = [];

  if (cwd) sources.push({ dir: join(cwd, '.claude', 'agents'), scope: 'workspace' });
  sources.push({ dir: join(home, '.claude', 'agents'), scope: 'user' });

  const plugins = await getInstalledPluginPaths();
  for (const p of plugins) {
    sources.push({
      dir: join(p.installPath, 'agents'),
      scope: 'plugin',
      pluginName: p.name,
    });
  }

  // Paraleliza sources + entries (mesma estratégia de listSkills/listWorkflows).
  const perSource = await Promise.all(
    sources.map(async (src) => {
      const entries = await readdirSafe(src.dir);
      const items = await Promise.all(
        entries
          .filter((entry) => entry.endsWith('.md'))
          .map(async (entry) => {
            const filePath = join(src.dir, entry);
            const content = await readFileSafe(filePath);
            if (content === null) return null;
            const { meta } = parseFrontmatter(content);
            const name = metaString(meta, 'name') ?? entry.replace(/\.md$/i, '');
            return {
              scope: src.scope,
              name,
              description: metaString(meta, 'description'),
              model: metaString(meta, 'model'),
              tools: metaStringArray(meta, 'tools'),
              path: filePath,
              pluginName: src.pluginName,
            } as Agent;
          })
      );
      return items.filter((a): a is Agent => a !== null);
    })
  );
  return perSource.flat().sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- listHooks ----------

/**
 * Hooks vivem em settings.json sob a chave 'hooks', estrutura:
 *   {
 *     "hooks": {
 *       "PreToolUse": [
 *         { "matcher": "Bash|Write", "hooks": [ { "type": "command", "command": "...", "timeout": 10 } ] },
 *         ...
 *       ],
 *       "PostToolUse": [ ... ],
 *       "Stop": [ ... ],
 *       ...
 *     }
 *   }
 *
 * Achatamos o tree em HookEntry[]. Eventos validos:
 *   PreToolUse, PostToolUse, Notification, Stop, SubagentStop, UserPromptSubmit
 */
const VALID_HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SubagentStop',
  'UserPromptSubmit',
];

interface SettingsJson {
  hooks?: Record<string, Array<{
    matcher?: string;
    hooks?: Array<{ type?: string; command?: string; timeout?: number }>;
  }>>;
}

async function readHooksFromSettings(
  settingsPath: string,
  scope: Scope,
): Promise<HookEntry[]> {
  const obj = await readJsonObj<SettingsJson>(settingsPath);
  if (!obj?.hooks || typeof obj.hooks !== 'object') return [];

  const out: HookEntry[] = [];
  for (const [event, groups] of Object.entries(obj.hooks)) {
    if (!VALID_HOOK_EVENTS.includes(event)) continue;
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || typeof group !== 'object') continue;
      const matcher = typeof group.matcher === 'string' ? group.matcher : '';
      const hookList = Array.isArray(group.hooks) ? group.hooks : [];
      for (const h of hookList) {
        if (!h || typeof h !== 'object') continue;
        const command = typeof h.command === 'string' ? h.command : '';
        if (!command) continue;
        out.push({
          scope,
          event,
          matcher,
          command,
          type: typeof h.type === 'string' ? h.type : 'command',
          timeout: typeof h.timeout === 'number' ? h.timeout : undefined,
          sourceSettings: settingsPath,
        });
      }
    }
  }
  return out;
}

export async function listHooks(cwd: string): Promise<HookEntry[]> {
  const home = homedir();
  const sources: Array<{ path: string; scope: Scope }> = [];

  if (cwd) sources.push({ path: join(cwd, '.claude', 'settings.json'), scope: 'workspace' });
  sources.push({ path: join(home, '.claude', 'settings.json'), scope: 'user' });

  const out: HookEntry[] = [];
  for (const src of sources) {
    if (!existsSync(src.path)) continue;
    const hooks = await readHooksFromSettings(src.path, src.scope);
    out.push(...hooks);
  }
  // Ordena por event, depois matcher pra UI ficar previsivel.
  return out.sort((a, b) => {
    if (a.event !== b.event) return a.event.localeCompare(b.event);
    return a.matcher.localeCompare(b.matcher);
  });
}

// ---------- Summary (paralelizado) ----------

export async function getCustomizationSummary(cwd: string): Promise<CustomizationSummary> {
  const [rules, skills, workflows, agents, hooks] = await Promise.all([
    listRules(cwd),
    listSkills(cwd),
    listWorkflows(cwd),
    listAgents(cwd),
    listHooks(cwd),
  ]);
  return { rules, skills, workflows, agents, hooks };
}
