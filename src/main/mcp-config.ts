/**
 * mcp-config — discovery e parse de MCP servers configurados pra Claude Code CLI.
 *
 * Claude Code armazena configs de MCP em tres lugares (em ordem de precedencia):
 *   1) `<cwd>/.mcp.json`              workspace-shared (committed no repo)
 *   2) `~/.claude/.mcp.json`          legado (Linux/Mac convention) — se existir
 *   3) `~/.claude.json`               principal no Windows; tem `mcpServers` no topo
 *                                     (escopo "user") + per-project em
 *                                     `projects[<cwd>].mcpServers` (escopo "local")
 *                                     + flags `enabledMcpjsonServers` /
 *                                     `disabledMcpjsonServers` que ligam/desligam
 *                                     os servers herdados do `.mcp.json` workspace.
 *
 * Merge: workspace `.mcp.json` overrides home; per-project no `~/.claude.json`
 * overrides top-level. Sempre tolerante a arquivo inexistente / JSON malformado.
 *
 * Tudo no main process — renderer recebe só o resultado serializado via IPC.
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface McpServerEntry {
  /** Nome do server (key no objeto mcpServers) */
  name: string;
  /** Executavel — geralmente "npx", "node", "python", caminho absoluto, ou tipo "http"/"sse" */
  command: string;
  /** Args do comando (vazio pra HTTP/SSE) */
  args: string[];
  /** Se ta habilitado no escopo atual. Servers de `.mcp.json` podem ser desabilitados
   *  via disabledMcpjsonServers no ~/.claude.json */
  enabled: boolean;
  /** "configured" = achamos config valida. "unknown" = parsing parcial / desconhecido */
  status: 'configured' | 'unknown';
  /** De qual arquivo veio (informativo pra UI). 'workspace' | 'user' | 'project' */
  scope: 'workspace' | 'user' | 'project';
  /** URL/type pra servers HTTP/SSE (opcional, alguns servers usam "type":"http") */
  type?: string;
  /** Path absoluto do arquivo de origem */
  sourcePath: string;
}

export interface McpFileLocations {
  /** ~/.claude.json — o principal no Windows (existe se Claude CLI já foi rodado) */
  userConfigJson: string | null;
  /** ~/.claude/.mcp.json — legado, raro em Windows */
  userMcpJson: string | null;
  /** <cwd>/.mcp.json — workspace-shared */
  workspaceMcpJson: string | null;
}

/** Resultado bruto do JSON parse — schema do `.mcp.json` */
interface RawMcpConfig {
  mcpServers?: Record<string, RawMcpServer>;
}

interface RawMcpServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Pra servers HTTP/SSE em vez de stdio (ex: "type":"http", "url":"https://...") */
  type?: string;
  url?: string;
}

/** Schema parcial de ~/.claude.json — só o que a gente le */
interface ClaudeJson {
  mcpServers?: Record<string, RawMcpServer>;
  projects?: Record<string, ClaudeJsonProject>;
}

interface ClaudeJsonProject {
  mcpServers?: Record<string, RawMcpServer>;
  enabledMcpjsonServers?: string[];
  disabledMcpjsonServers?: string[];
}

async function readJsonSafe<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeServer(
  name: string,
  raw: RawMcpServer,
  scope: McpServerEntry['scope'],
  sourcePath: string,
  enabled: boolean,
): McpServerEntry {
  const command = typeof raw.command === 'string' && raw.command.length > 0
    ? raw.command
    : (typeof raw.type === 'string' ? raw.type : '');
  const args = Array.isArray(raw.args) ? raw.args.filter((a): a is string => typeof a === 'string') : [];
  return {
    name,
    command,
    args,
    enabled,
    status: command.length > 0 ? 'configured' : 'unknown',
    scope,
    type: typeof raw.type === 'string' ? raw.type : undefined,
    sourcePath,
  };
}

export function getMcpFileLocations(cwd: string): McpFileLocations {
  const home = homedir();
  const userConfigJson = join(home, '.claude.json');
  const userMcpJson = join(home, '.claude', '.mcp.json');
  const workspaceMcpJson = cwd ? join(cwd, '.mcp.json') : null;
  return {
    userConfigJson: existsSync(userConfigJson) ? userConfigJson : null,
    userMcpJson: existsSync(userMcpJson) ? userMcpJson : null,
    workspaceMcpJson: workspaceMcpJson && existsSync(workspaceMcpJson) ? workspaceMcpJson : null,
  };
}

/**
 * Lista todos os MCP servers visiveis pro `cwd`, mergeando os tres escopos.
 * Workspace overrides user; per-project overrides top-level user.
 * Servers de `.mcp.json` workspace respeitam o flag enabled/disabled do per-project.
 */
export async function listMcpServers(cwd: string): Promise<McpServerEntry[]> {
  const locs = getMcpFileLocations(cwd);
  const merged = new Map<string, McpServerEntry>();

  // Helper: aplica um set de servers no map (overriding por nome)
  const apply = (
    servers: Record<string, RawMcpServer> | undefined,
    scope: McpServerEntry['scope'],
    sourcePath: string,
    enabledOverride?: (name: string) => boolean,
  ): void => {
    if (!servers) return;
    for (const [name, raw] of Object.entries(servers)) {
      if (!raw || typeof raw !== 'object') continue;
      const enabled = enabledOverride ? enabledOverride(name) : true;
      merged.set(name, normalizeServer(name, raw, scope, sourcePath, enabled));
    }
  };

  // 1) ~/.claude.json — top-level (escopo "user", global)
  let claudeJson: ClaudeJson | null = null;
  if (locs.userConfigJson) {
    claudeJson = await readJsonSafe<ClaudeJson>(locs.userConfigJson);
    apply(claudeJson?.mcpServers, 'user', locs.userConfigJson);
  }

  // 2) ~/.claude/.mcp.json — legado, mesmo escopo "user"
  if (locs.userMcpJson) {
    const userMcp = await readJsonSafe<RawMcpConfig>(locs.userMcpJson);
    apply(userMcp?.mcpServers, 'user', locs.userMcpJson);
  }

  // 3) <cwd>/.mcp.json — workspace-shared. Mas respeita enabled/disabled flags
  // do per-project no ~/.claude.json (Claude CLI só usa server do .mcp.json
  // se ta em enabledMcpjsonServers, ou se não ta em disabledMcpjsonServers).
  if (locs.workspaceMcpJson) {
    const projectMeta = claudeJson?.projects?.[cwd];
    const enabledList = projectMeta?.enabledMcpjsonServers ?? [];
    const disabledList = projectMeta?.disabledMcpjsonServers ?? [];
    const wsMcp = await readJsonSafe<RawMcpConfig>(locs.workspaceMcpJson);
    apply(wsMcp?.mcpServers, 'workspace', locs.workspaceMcpJson, (name) => {
      if (disabledList.includes(name)) return false;
      // Se a lista enabled ta vazia, assume todos enabled por default
      if (enabledList.length === 0) return true;
      return enabledList.includes(name);
    });
  }

  // 4) ~/.claude.json projects[cwd].mcpServers — escopo "project" (precedencia maxima)
  // sourcePath garantido: se chegamos aqui, locs.userConfigJson e o arquivo lido.
  // Fallback explicito pra path canonico evita string vazia quebrar UI de "abrir config".
  if (claudeJson?.projects?.[cwd]?.mcpServers) {
    const projectSourcePath = locs.userConfigJson || join(homedir(), '.claude.json');
    apply(claudeJson.projects[cwd].mcpServers, 'project', projectSourcePath);
  }

  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}
