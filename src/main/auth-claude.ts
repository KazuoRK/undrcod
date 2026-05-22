/**
 * auth-claude — detector de autenticação do Claude CLI.
 *
 * Estrategia:
 *   1. Tenta ler `~/.claude/.credentials.json` (formato OAuth do `claude login`).
 *   2. Se não existir, checa env var `ANTHROPIC_API_KEY`.
 *   3. Caso contrario, retorna { loggedIn: false, source: 'none' }.
 *
 * Formato esperado do .credentials.json (verificado via docs Anthropic):
 *   {
 *     "claudeAiOauth": {
 *       "accessToken": "sk-ant-...",
 *       "refreshToken": "...",
 *       "expiresAt": "ISO date" | number (epoch ms),
 *       "scopes": ["..."],
 *       "subscriptionType": "max" | "pro" | "free"
 *     }
 *   }
 *
 * Defensive: se claude CLI não existe no PATH, runLogin/runLogout falham
 * graciosamente. getAuthStatus NUNCA throws — sempre retorna AuthStatus valido.
 */

import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';

export type AuthSource = 'oauth' | 'apikey' | 'none';

export interface AuthStatus {
  loggedIn: boolean;
  source: AuthSource;
  email?: string;
  plan?: string;
  /** ISO string do timestamp de expiracao (se conhecido). */
  expiresAt?: string;
  /** Timestamp epoch em ms (mesmo valor de expiresAt, mas numerico). Util pro renderer comparar com Date.now(). */
  expiresAtMs?: number;
  /**
   * true quando expiresAtMs < Date.now() no momento da leitura.
   * loggedIn=true && expired=true significa: existe credencial no disco, mas o
   * token OAuth já expirou — Claude CLI vai retornar 401. UI deve oferecer
   * "Entrar de novo" em vez de tratar como sessão valida.
   */
  expired?: boolean;
}

const CREDENTIALS_PATH = join(homedir(), '.claude', '.credentials.json');

/**
 * Le e parseia ~/.claude/.credentials.json se existir.
 * Não throws — retorna null em qualquer erro (arquivo ausente, JSON malformado, etc).
 */
async function readOAuthCredentials(): Promise<AuthStatus | null> {
  let raw: string;
  try {
    raw = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
  } catch {
    // arquivo não existe ou sem permissao — não logado via OAuth
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn('[auth-claude] .credentials.json malformado:', (err as Error).message);
    return null;
  }

  // Estrutura defensiva — varias variantes do formato
  const root = parsed as Record<string, unknown>;
  const oauth = (root.claudeAiOauth ?? root.oauth ?? root) as Record<string, unknown>;

  const accessToken = typeof oauth.accessToken === 'string' ? oauth.accessToken : undefined;
  if (!accessToken) return null;

  const subscriptionType = typeof oauth.subscriptionType === 'string'
    ? oauth.subscriptionType
    : typeof oauth.plan === 'string'
      ? oauth.plan
      : undefined;

  const emailRaw = typeof oauth.email === 'string'
    ? oauth.email
    : typeof oauth.accountEmail === 'string'
      ? oauth.accountEmail
      : undefined;

  let expiresAt: string | undefined;
  let expiresAtMs: number | undefined;
  const exp = oauth.expiresAt;
  if (typeof exp === 'number' && Number.isFinite(exp)) {
    // epoch ms — formato canonico do Claude CLI
    expiresAtMs = exp;
    try { expiresAt = new Date(exp).toISOString(); } catch { /* invalid date */ }
  } else if (typeof exp === 'string') {
    expiresAt = exp;
    const parsed = Date.parse(exp);
    if (Number.isFinite(parsed)) expiresAtMs = parsed;
  }

  // Checa se token já expirou. Se não tivermos expiresAtMs (faltou no JSON ou
  // string inparseavel), assumimos NAO expirado pra não quebrar contas que
  // historicamente não tinham esse campo.
  const expired = typeof expiresAtMs === 'number' && expiresAtMs < Date.now();

  return {
    loggedIn: true,
    source: 'oauth',
    email: emailRaw,
    plan: subscriptionType,
    expiresAt,
    expiresAtMs,
    expired,
  };
}

/**
 * Le info adicional via `claude auth status --json` — email, orgName, plan.
 *
 * O `.credentials.json` NAO armazena email/orgName (politica Anthropic, só
 * tokens + plan). Pra exibir essas infos na UI a gente shell-out pro CLI que
 * faz lookup com a API e retorna:
 *   { loggedIn, authMethod, apiProvider, email, orgId, orgName, subscriptionType }
 *
 * Cachea por 30s pra não spawnar `claude` a cada open do popover.
 * Timeout 4s pra não travar UI se CLI tiver lento/offline.
 * Defensive: erro silencioso retorna null — caller fallbacka pro credentials.json puro.
 */
interface CliAuthStatus {
  email?: string;
  orgName?: string;
  plan?: string;
  loggedIn?: boolean;
}

let cliStatusCache: { value: CliAuthStatus | null; expiresAt: number } | null = null;
const CLI_STATUS_TTL_MS = 30_000;

async function readAuthStatusFromCli(): Promise<CliAuthStatus | null> {
  if (cliStatusCache && cliStatusCache.expiresAt > Date.now()) {
    return cliStatusCache.value;
  }

  const bin = claudeBin();
  return new Promise((resolve) => {
    let resolved = false;
    let stdout = '';
    const finish = (val: CliAuthStatus | null): void => {
      if (resolved) return;
      resolved = true;
      cliStatusCache = { value: val, expiresAt: Date.now() + CLI_STATUS_TTL_MS };
      resolve(val);
    };

    let child;
    try {
      child = spawn(bin, ['auth', 'status', '--json'], {
        windowsHide: true,
        shell: process.platform === 'win32', // .cmd precisa shell no Windows
      });
    } catch {
      finish(null);
      return;
    }

    const timer = setTimeout(() => {
      try { child!.kill(); } catch { /* noop */ }
      finish(null);
    }, 4000);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });

    child.on('error', () => {
      clearTimeout(timer);
      finish(null);
    });

    child.on('exit', (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) {
        finish(null);
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        const out: CliAuthStatus = {
          email: typeof parsed.email === 'string' ? parsed.email : undefined,
          orgName: typeof parsed.orgName === 'string' ? parsed.orgName : undefined,
          plan: typeof parsed.subscriptionType === 'string' ? parsed.subscriptionType : undefined,
          loggedIn: typeof parsed.loggedIn === 'boolean' ? parsed.loggedIn : undefined,
        };
        finish(out);
      } catch {
        finish(null);
      }
    });
  });
}

/** Invalida o cache do CLI status. Chamado após login/logout. */
function invalidateCliStatusCache(): void {
  cliStatusCache = null;
}

/**
 * Status atual de autenticação com Claude.
 * Nunca throws — fallback final e { loggedIn: false, source: 'none' }.
 *
 * Combina:
 *   - .credentials.json local (rapido, sincrono via fs) — fonte de verdade pra expiresAt/expired
 *   - `claude auth status --json` (assincrono, cached 30s) — adiciona email/orgName
 *
 * Se o CLI estiver offline/lento, retorna só o que tem do credentials.json.
 */
export async function getAuthStatus(): Promise<AuthStatus> {
  const oauth = await readOAuthCredentials();
  if (oauth) {
    // Enriquece com email/orgName via shell-out (best-effort)
    const cli = await readAuthStatusFromCli();
    if (cli) {
      return {
        ...oauth,
        email: oauth.email ?? cli.email,
        plan: oauth.plan ?? cli.plan,
      };
    }
    return oauth;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && apiKey.trim().length > 0) {
    return { loggedIn: true, source: 'apikey' };
  }

  return { loggedIn: false, source: 'none' };
}

/**
 * Resolve o caminho ABSOLUTO do executavel claude.
 *
 * Windows: o `claude.cmd` mora em `%APPDATA%\npm\claude.cmd`. O cmd.exe que
 * spawnamos pra OAuth herda o PATH do Electron main process, e esse PATH
 * NEM SEMPRE inclui `AppData\Roaming\npm` (depende de como o Electron foi
 * launched). Tentamos:
 *   1. %APPDATA%\npm\claude.cmd (instalação padrao via npm i -g)
 *   2. %APPDATA%\npm\claude (sem extensão, raro mas possível)
 *   3. fallback `claude.cmd` literal (com shell:true vai usar PATH)
 *
 * Unix: `claude` no PATH, sem path resolution especial.
 */
function claudeBin(): string {
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA;
    if (appdata) {
      const cmd = join(appdata, 'npm', 'claude.cmd');
      if (existsSync(cmd)) return cmd;
      const noExt = join(appdata, 'npm', 'claude');
      if (existsSync(noExt)) return noExt;
    }
    return 'claude.cmd';
  }
  return 'claude';
}

/**
 * Spawna o fluxo de login do Claude CLI numa janela de terminal VISIVEL.
 *
 * Comando real: `claude auth login` — `claude login` direto NAO EXISTE
 * como subcomando top-level (verificado em CLI v2.x: subcomandos são
 * `agents | auth | doctor | install | mcp | plugin | project | setup-token | ultrareview | update`).
 *
 * Por que janela visível:
 * - `claude auth login` imprime instrucoes OAuth (abre browser + mostra URL pra copiar caso browser não tenha)
 * - Pode pedir input (--email, escolha de --claudeai vs --console)
 * - Sem janela visível, user fica sem feedback nenhum se algo der errado
 *
 * Windows: usa cmd.exe /k pra manter janela aberta após o comando.
 * Mac/Linux: tenta os terminais conhecidos em ordem (gnome-terminal, konsole, xterm, Terminal.app via osascript).
 *
 * Retorna ok:true assim que conseguimos spawnar a janela — NAO esperamos
 * o OAuth completar. Renderer revalida via window-focus / re-check periodico.
 */
export function runLogin(): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    try {
      if (process.platform === 'win32') {
        // No Windows, Electron e GUI app — spawn direto de cmd.exe NAO cria
        // janela de console visível (o stdin/stdout vao pro void). E `claude
        // auth login` precisa de STDIN interativo pra colar o codigo OAuth
        // depois que o browser autoriza ("Paste code here if prompted >").
        //
        // Solucao: `cmd /c start ...` usa o comando `start` do Windows que faz
        // fork DE VERDADE em janela nova de console, completamente desacoplada
        // do parent process (com seu próprio stdin/stdout/stderr ligado ao
        // console novo). Sintaxe:
        //   cmd /c start "<title>" cmd /k <command>
        //
        // - `cmd /c`     executa um comando e sai
        // - `start`      lanca em janela nova (title vai como primeiro arg literal)
        // - `cmd /k`     mantem a janela aberta após o comando terminar
        //
        // CRITICO: usamos o path ABSOLUTO do claude.cmd via claudeBin(). O PATH
        // do cmd.exe spawnado pelo Electron não inclui sempre `%APPDATA%\npm`,
        // então `claude.cmd` literal falha com "não reconhecido". Resolvendo
        // absoluto via APPDATA garante que funciona independente do PATH.
        const claudePath = claudeBin();
        // Title VAZIO ("") pra evitar quirk do `start` Windows: se o primeiro
        // arg não tem aspas perfeitas, ele tenta interpretar como executavel.
        // Node faz seu próprio quoting que pode quebrar 'Claude Login' literal
        // em alguns ambientes (Electron specifically), causando o `start` a
        // confundir "Login\..." como nome de arquivo não encontrado.
        // Solucao consagrada: `start "" <cmd>` — o "" e title vazio reconhecido.
        const child = spawn(
          'cmd.exe',
          ['/c', 'start', '""', 'cmd.exe', '/k', claudePath, 'auth', 'login'],
          {
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
          },
        );
        child.on('error', (err: Error) => {
          resolve({ ok: false, error: err.message });
        });
        // Desreferencia pra main poder fechar sem matar o terminal
        child.unref();
        // Resolve imediato — janela ta aberta, user toma conta dali.
        // setTimeout 100ms pra dar chance do 'error' acima disparar primeiro caso spawn falhe.
        setTimeout(() => resolve({ ok: true }), 100);
        return;
      }

      // Mac: usa osascript pra abrir Terminal.app com o comando
      if (process.platform === 'darwin') {
        const cmd = 'claude auth login';
        const child = spawn('osascript', ['-e', `tell app "Terminal" to do script "${cmd}"`], {
          detached: true,
          stdio: 'ignore',
        });
        child.on('error', (err: Error) => resolve({ ok: false, error: err.message }));
        child.unref();
        setTimeout(() => resolve({ ok: true }), 100);
        return;
      }

      // Linux: tenta terminais comuns. Se nenhum existir, fallback pra spawn direto
      // (claude vai imprimir URL no stderr, que vai pro buffer mas user não ve).
      const linuxTerminals = ['gnome-terminal', 'konsole', 'xterm'];
      for (const term of linuxTerminals) {
        try {
          const child = spawn(term, ['-e', 'claude', 'auth', 'login'], {
            detached: true,
            stdio: 'ignore',
          });
          child.on('error', () => { /* tenta próximo */ });
          child.unref();
          setTimeout(() => resolve({ ok: true }), 100);
          return;
        } catch {
          continue;
        }
      }
      // Fallback Linux sem terminal grafico: spawn direto, browser abre via xdg-open
      const child = spawn(claudeBin(), ['auth', 'login'], {
        detached: true,
        stdio: 'ignore',
      });
      child.on('error', (err: Error) => resolve({ ok: false, error: err.message }));
      child.unref();
      setTimeout(() => resolve({ ok: true }), 100);
    } catch (err) {
      resolve({ ok: false, error: (err as Error).message });
    }
  });
}

/**
 * Logout — apaga ~/.claude/.credentials.json diretamente via fs.unlink.
 *
 * NAO usa `claude logout` (que na verdade e `claude auth logout` — subcomando
 * aninhado), pra evitar dependencia de versão do CLI e prompts interativos.
 *
 * Defensive:
 *   - Idempotente: ENOENT (arquivo já não existe) retorna { ok: true }.
 *   - NAO mexe em ANTHROPIC_API_KEY (env var fora do nosso controle).
 *   - Qualquer outro erro de IO retorna { ok: false, error }.
 */
export async function runLogout(): Promise<{ ok: boolean; error?: string }> {
  try {
    await fs.unlink(CREDENTIALS_PATH);
    invalidateCliStatusCache();
    return { ok: true };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    // ENOENT = arquivo não existia. Idempotente — consideramos sucesso.
    if (e.code === 'ENOENT') {
      invalidateCliStatusCache();
      return { ok: true };
    }
    return { ok: false, error: e.message };
  }
}
