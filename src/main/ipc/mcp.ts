/**
 * IPC bridge pra MCP server discovery + mutation.
 *
 * Eventos:
 *   - mcp:list (cwd)                              -> Array<McpServerEntry>
 *   - mcp:locations (cwd)                         -> McpFileLocations
 *   - mcp:openConfig (scope, cwd)                 -> { path } | { error }
 *   - mcp:addServer (scope, cwd, name, config)    -> { ok: true } | { error }
 *   - mcp:removeServer (scope, cwd, name)         -> { ok: true } | { error }
 *   - mcp:setEnabled (scope, cwd, name, enabled)  -> { ok: true } | { error }
 *
 * Escopo no add/remove/setEnabled:
 *   - 'user'      -> top-level mcpServers em ~/.claude.json
 *   - 'workspace' -> <cwd>/.mcp.json (cria se não existe)
 *   - 'project'   -> projects[<cwd>].mcpServers em ~/.claude.json
 *
 * setEnabled pra scope 'workspace' manipula projects[<cwd>].disabledMcpjsonServers
 * em ~/.claude.json (claude CLI le esse flag pra liga/desliga server do .mcp.json).
 * setEnabled pra scope 'user'/'project' e no-op (esses escopos não tem flag enable;
 * pra desligar, remova o server).
 */

import { ipcMain } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { isAbsolute, join, delimiter } from 'path';
import { homedir, platform } from 'os';
import { spawn } from 'child_process';
import { listMcpServers, getMcpFileLocations } from '../mcp-config';
import { listMcpCatalog } from '../mcp-catalog';

/**
 * Resolve binário absoluto no PATH sem shell. Equivalente a `which`/`where`,
 * em JS puro — sem rodar comando externo. Em Windows tenta extensões de
 * PATHEXT. Retorna path absoluto ou null.
 *
 * MCP server `command` pode vir como nome curto ("uvx", "npx", "python") ou
 * absoluto ("C:\\node\\node.exe"). Se absoluto e existe, usa direto; senão
 * resolve via PATH.
 */
function resolveCommand(command: string): string | null {
  if (!command) return null;
  if (isAbsolute(command)) {
    return existsSync(command) ? command : null;
  }
  const PATH = process.env.PATH || process.env.Path || '';
  if (!PATH) return null;
  const isWin = platform() === 'win32';
  const exts = isWin
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())
    : [''];
  // Se já tem extensão em Windows e existe, respeita.
  for (const dir of PATH.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, command + ext);
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        // permission denied etc — segue
      }
    }
    // Caso o command já carregue extensão própria (ex: "uv.exe"), testa puro.
    const direct = join(dir, command);
    try {
      if (existsSync(direct)) return direct;
    } catch {
      // ignora
    }
  }
  return null;
}

/**
 * Args de MCP server devem ser strings. Com shell:false, args vão direto pro
 * argv do processo — sem expansão. Mas mantemos uma checagem leve pra evitar
 * que args com NUL byte ou newlines causem comportamento estranho em alguns
 * runtimes/CLI parsers. Backslash é legítimo em paths Windows.
 */
function sanitizeMcpArgs(args: unknown): string[] {
  if (!Array.isArray(args)) return [];
  const out: string[] = [];
  for (const a of args) {
    if (typeof a !== 'string') continue;
    if (a.includes('\0') || /[\n\r]/.test(a)) continue;
    out.push(a);
  }
  return out;
}

export type McpOpenScope = 'global' | 'workspace';
export type McpMutateScope = 'user' | 'workspace' | 'project';

/** Schema do server que o renderer envia pra adicionar/editar */
export interface McpServerInput {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
  url?: string;
}

/** JSON parse defensivo. Retorna {} se arquivo não existe / parse falha. */
async function readJsonObj(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {};
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Escreve JSON pretty-printed (2 spaces) — mesmo formato do Claude CLI. */
async function writeJsonObj(path: string, obj: Record<string, unknown>): Promise<void> {
  await writeFile(path, JSON.stringify(obj, null, 2), 'utf-8');
}

/** Sanitiza config — remove keys vazias pra evitar lixo no JSON. */
function sanitizeServer(config: McpServerInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (config.command && typeof config.command === 'string') out.command = config.command;
  if (Array.isArray(config.args) && config.args.length > 0) {
    out.args = config.args.filter((a): a is string => typeof a === 'string' && a.length > 0);
  }
  if (config.env && typeof config.env === 'object') {
    const entries = Object.entries(config.env).filter(
      ([k, v]) => typeof k === 'string' && k.length > 0 && typeof v === 'string',
    );
    if (entries.length > 0) out.env = Object.fromEntries(entries);
  }
  if (config.type && typeof config.type === 'string') out.type = config.type;
  if (config.url && typeof config.url === 'string') out.url = config.url;
  return out;
}

/** Helper: caminho do arquivo pro scope. workspace requer cwd. */
function pathForScope(scope: McpMutateScope, cwd: string): { path: string } | { error: string } {
  if (scope === 'workspace') {
    if (!cwd) return { error: 'Nenhum workspace aberto' };
    return { path: join(cwd, '.mcp.json') };
  }
  // 'user' e 'project' moram ambos em ~/.claude.json
  return { path: join(homedir(), '.claude.json') };
}

async function addServer(
  scope: McpMutateScope,
  cwd: string,
  name: string,
  config: McpServerInput,
): Promise<{ ok: true } | { error: string }> {
  if (!name || typeof name !== 'string') return { error: 'Nome invalido' };
  if (!config || typeof config !== 'object') return { error: 'Config invalida' };
  const r = pathForScope(scope, cwd);
  if ('error' in r) return r;
  try {
    const obj = await readJsonObj(r.path);
    const serverEntry = sanitizeServer(config);
    if (!serverEntry.command && !serverEntry.type) {
      return { error: 'Comando ou tipo obrigatorio' };
    }

    if (scope === 'project') {
      // Modifica projects[cwd].mcpServers em ~/.claude.json
      if (!cwd) return { error: 'Nenhum workspace aberto' };
      const projects =
        obj.projects && typeof obj.projects === 'object'
          ? (obj.projects as Record<string, Record<string, unknown>>)
          : {};
      const project =
        projects[cwd] && typeof projects[cwd] === 'object' ? projects[cwd] : {};
      const servers =
        project.mcpServers && typeof project.mcpServers === 'object'
          ? (project.mcpServers as Record<string, unknown>)
          : {};
      servers[name] = serverEntry;
      project.mcpServers = servers;
      projects[cwd] = project;
      obj.projects = projects;
    } else {
      // 'user' (top-level ~/.claude.json) ou 'workspace' (<cwd>/.mcp.json) —
      // ambos no campo mcpServers do objeto raiz.
      const servers =
        obj.mcpServers && typeof obj.mcpServers === 'object'
          ? (obj.mcpServers as Record<string, unknown>)
          : {};
      servers[name] = serverEntry;
      obj.mcpServers = servers;
    }

    await writeJsonObj(r.path, obj);
    return { ok: true };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

async function removeServer(
  scope: McpMutateScope,
  cwd: string,
  name: string,
): Promise<{ ok: true } | { error: string }> {
  if (!name || typeof name !== 'string') return { error: 'Nome invalido' };
  const r = pathForScope(scope, cwd);
  if ('error' in r) return r;
  try {
    const obj = await readJsonObj(r.path);

    if (scope === 'project') {
      if (!cwd) return { error: 'Nenhum workspace aberto' };
      const projects = obj.projects as Record<string, Record<string, unknown>> | undefined;
      const project = projects?.[cwd];
      const servers = project?.mcpServers as Record<string, unknown> | undefined;
      if (servers && name in servers) {
        delete servers[name];
      }
    } else {
      const servers = obj.mcpServers as Record<string, unknown> | undefined;
      if (servers && name in servers) {
        delete servers[name];
      }
    }

    await writeJsonObj(r.path, obj);
    return { ok: true };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * Liga/desliga server. Só faz sentido pra scope 'workspace' — modifica os
 * arrays enabledMcpjsonServers/disabledMcpjsonServers em projects[<cwd>] do
 * ~/.claude.json. Pra 'user'/'project', e no-op (servers la são binarios:
 * existem = ligados, removidos = desligados).
 */
async function setEnabled(
  scope: McpMutateScope,
  cwd: string,
  name: string,
  enabled: boolean,
): Promise<{ ok: true } | { error: string }> {
  if (!name || typeof name !== 'string') return { error: 'Nome invalido' };
  if (scope !== 'workspace') {
    // No-op silencioso — user/project não tem flag enable separado.
    return { ok: true };
  }
  if (!cwd) return { error: 'Nenhum workspace aberto' };
  try {
    const claudeJsonPath = join(homedir(), '.claude.json');
    const obj = await readJsonObj(claudeJsonPath);
    const projects =
      obj.projects && typeof obj.projects === 'object'
        ? (obj.projects as Record<string, Record<string, unknown>>)
        : {};
    const project =
      projects[cwd] && typeof projects[cwd] === 'object' ? projects[cwd] : {};
    const enabledList = Array.isArray(project.enabledMcpjsonServers)
      ? (project.enabledMcpjsonServers as string[])
      : [];
    const disabledList = Array.isArray(project.disabledMcpjsonServers)
      ? (project.disabledMcpjsonServers as string[])
      : [];

    const enabledSet = new Set(enabledList);
    const disabledSet = new Set(disabledList);

    if (enabled) {
      disabledSet.delete(name);
      enabledSet.add(name);
    } else {
      enabledSet.delete(name);
      disabledSet.add(name);
    }

    project.enabledMcpjsonServers = Array.from(enabledSet);
    project.disabledMcpjsonServers = Array.from(disabledSet);
    projects[cwd] = project;
    obj.projects = projects;
    await writeJsonObj(claudeJsonPath, obj);
    return { ok: true };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * Testa se um MCP server consegue ser spawnado. Faz spawn do command+args, espera
 * ate 5s por qualquer atividade no stdout/stderr (MCP servers normalmente emitem
 * banner JSON-RPC no startup) e mata o processo. Retorna ok se algo saiu, ou se o
 * processo continua vivo apos timeout (alguns servers ficam silenciosos esperando
 * input — isso ainda conta como "spawn funcionou"). Retorna error so se o spawn
 * falhar (ENOENT, exit imediato com erro, etc).
 */
async function testServer(
  command: string,
  args: string[],
  env: Record<string, string> | undefined,
): Promise<{ ok: true; output: string } | { error: string }> {
  if (!command || typeof command !== 'string') {
    return { error: 'Comando invalido' };
  }
  // Caracteres de quebra/null em command nunca são legítimos; rejeita early.
  if (command.includes('\0') || /[\n\r]/.test(command)) {
    return { error: 'Comando contém caracteres inválidos' };
  }
  const safeArgs = sanitizeMcpArgs(args);
  // Merge env do server com env atual (PATH e cia precisam vir do parent)
  const mergedEnv: NodeJS.ProcessEnv = { ...process.env };
  if (env && typeof env === 'object') {
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string') mergedEnv[k] = v;
    }
  }

  // Resolve command pra path absoluto. Se não achar, falha com erro claro
  // em vez de delegar pro shell descobrir. Isso fecha o vetor de RCE: nunca
  // mais um string user-controlled vai pro cmd.exe/sh.
  const resolvedCommand = resolveCommand(command);
  if (!resolvedCommand) {
    return { error: `Comando '${command}' não encontrado no PATH` };
  }

  return new Promise((resolve) => {
    let resolved = false;
    let output = '';
    const finish = (result: { ok: true; output: string } | { error: string }) => {
      if (resolved) return;
      resolved = true;
      try {
        child.kill();
      } catch {
        // ignora — pode ja ter saido
      }
      resolve(result);
    };

    let child: ReturnType<typeof spawn>;
    try {
      // shell:false + binário resolvido elimina interpretação de shell.
      // Args vão direto pro argv do processo.
      child = spawn(resolvedCommand, safeArgs, {
        env: mergedEnv,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      finish({ error: (err as Error).message });
      return;
    }

    child.on('error', (err) => {
      finish({ error: err.message });
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf-8');
      if (output.length > 100) {
        // Ja recebeu algo do server — sucesso.
        finish({ ok: true, output: output.slice(0, 500) });
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      // MCP servers as vezes logam banner no stderr (e.g. "Server starting...")
      output += chunk.toString('utf-8');
    });

    child.on('exit', (code) => {
      // Se saiu com codigo 0 + algum output, ok. Se nao-zero, erro.
      if (code === 0) {
        finish({ ok: true, output: output.slice(0, 500) || '(sem output)' });
      } else if (code !== null) {
        finish({
          error: `Processo saiu com codigo ${code}${output ? `: ${output.slice(0, 300)}` : ''}`,
        });
      }
    });

    // Timeout 5s — se ainda ta vivo e nao houve erro, considera "spawn funcionou"
    // (server esta rodando, possivelmente esperando JSON-RPC handshake no stdin).
    setTimeout(() => {
      if (output.length > 0) {
        finish({ ok: true, output: output.slice(0, 500) });
      } else {
        // Processo vivo mas silencioso — ainda assim, spawn deu certo.
        finish({ ok: true, output: '(server rodando, sem output em 5s)' });
      }
    }, 5000);
  });
}

async function resolveOpenPath(scope: McpOpenScope, cwd: string): Promise<{ path: string } | { error: string }> {
  try {
    if (scope === 'global') {
      // ~/.claude.json — sempre existe se Claude CLI já foi rodado uma vez.
      // Se não existir, cria stub mínimo pra usuário poder editar.
      const p = join(homedir(), '.claude.json');
      if (!existsSync(p)) {
        await writeFile(p, JSON.stringify({ mcpServers: {} }, null, 2), 'utf-8');
      }
      return { path: p };
    }

    // workspace
    if (!cwd) return { error: 'Nenhum workspace aberto' };
    const p = join(cwd, '.mcp.json');
    if (!existsSync(p)) {
      // Cria stub vazio com schema documentado em comentario impossível (JSON não
      // suporta comments — então só o objeto)
      await writeFile(p, JSON.stringify({ mcpServers: {} }, null, 2), 'utf-8');
    }
    return { path: p };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export function registerMcpIPC(): void {
  ipcMain.handle('mcp:list', (_evt, cwd: string) => listMcpServers(cwd ?? ''));

  ipcMain.handle('mcp:locations', (_evt, cwd: string) => getMcpFileLocations(cwd ?? ''));

  ipcMain.handle('mcp:openConfig', (_evt, scope: McpOpenScope, cwd: string) =>
    resolveOpenPath(scope, cwd ?? ''),
  );

  ipcMain.handle(
    'mcp:addServer',
    (_evt, scope: McpMutateScope, cwd: string, name: string, config: McpServerInput) =>
      addServer(scope, cwd ?? '', name, config),
  );

  ipcMain.handle('mcp:removeServer', (_evt, scope: McpMutateScope, cwd: string, name: string) =>
    removeServer(scope, cwd ?? '', name),
  );

  ipcMain.handle(
    'mcp:setEnabled',
    (_evt, scope: McpMutateScope, cwd: string, name: string, enabled: boolean) =>
      setEnabled(scope, cwd ?? '', name, enabled),
  );

  // Catalogo curado de MCPs populares pra UI de 1-click install.
  // Dataset hardcoded (ver mcp-catalog.ts); handler async permite refresh
  // de fonte remota no futuro sem mudar superficie IPC.
  ipcMain.handle('mcp:listCatalog', () => listMcpCatalog());

  // Testa conexao com server — tenta spawn e ve se responde em 5s.
  ipcMain.handle(
    'mcp:test',
    (
      _evt,
      payload: { command: string; args?: string[]; env?: Record<string, string> },
    ) =>
      testServer(
        payload?.command ?? '',
        payload?.args ?? [],
        payload?.env,
      ),
  );
}
