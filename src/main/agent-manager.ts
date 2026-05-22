import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { existsSync, writeFileSync, readdirSync } from 'fs';
import { homedir, tmpdir } from 'os';
import type { AgentEvent } from '../shared/agent-types';
import { permissionBridge } from './permission-mcp-server';
import { UNDRCOD_SYSTEM_PROMPT } from './undrcode-system-prompt';

/**
 * Verifica se uma session existe no storage local do CLI em QUALQUER projects dir.
 *
 * IMPORTANTE: o CLI faz `statSync(<sessionsDir>/<id>.jsonl)` quando recebe
 * `--session-id <uuid>`. Se o arquivo existe, ele REJEITA com:
 *     "Error: Session ID <id> is already in use."
 *
 * O <sessionsDir> que o CLI usa depende do cwd que ELE resolve (process.cwd()
 * + env normalization). Pode NÃO bater com o cwd que UNDRCOD passou no
 * spawn. Por isso varremos TODOS os subdirs de ~/.claude/projects/ procurando
 * o jsonl — se acharmos em qualquer um, sabemos que precisamos usar `--resume`
 * em vez de `--session-id` pra evitar o "already in use" do CLI.
 *
 * Performance: readdirSync é síncrono mas só lista nomes (~5ms pra 50 dirs).
 * Aceitável no critical path do spawn.
 */
function sessionExistsInCli(sessionId: string, _cwd: string): boolean {
  const projectsRoot = join(homedir(), '.claude', 'projects');
  try {
    const entries = readdirSync(projectsRoot);
    for (const dir of entries) {
      const jsonlPath = join(projectsRoot, dir, `${sessionId}.jsonl`);
      if (existsSync(jsonlPath)) return true;
    }
  } catch { /* projects root ausente — primeira vez do CLI */ }
  return false;
}

/**
 * Gerencia conversações com `claude` CLI em modo stream-json.
 * Cada user prompt → 1 spawn de `claude -p ... --output-format stream-json`.
 * Multi-turn via `--session-id <uuid>` (persistência built-in do Claude Code).
 */

interface ActiveTurn {
  sessionId: string;
  proc: ChildProcess;
  buffer: string;
  /**
   * Marca quando o CLI já emitiu uma falha de autenticação (401) via stream-json.
   * Quando true, o handler de 'exit' suprime o evento generico
   * "claude saiu com codigo N" — auth_expired já foi enviado pro renderer.
   */
  authFailed?: boolean;
  /**
   * Acumulador completo do stderr do processo. Usado pra incluir contexto real
   * no error final quando o CLI sai com código != 0 (antes só emitíamos linhas
   * que continham "error"/"failed", perdíamos mensagens tipo "argument list
   * too long" ou stack traces de crash).
   */
  stderrBuf?: string;
}

/**
 * Tenta extrair indicacao de 401/authentication_failed de uma mensagem
 * stream-json. Retorna { status, message } se reconhecer, senao null.
 *
 * Formatos observados no CLI:
 *   1. {"type":"system","subtype":"api_retry","error_status":401,"error":"authentication_failed"}
 *   2. {"type":"result","is_error":true,"api_error_status":401,...}
 *   3. {"type":"system","subtype":"api_error","error":"authentication_failed",...}
 *
 * Defensive: msg pode ser qualquer formato; só retorna match em campos exatos.
 */
function detectAuthFailure(msg: any): { status?: number; message?: string } | null {
  if (!msg || typeof msg !== 'object') return null;

  const errStr = typeof msg.error === 'string' ? msg.error : undefined;
  const errStatus = typeof msg.error_status === 'number' ? msg.error_status : undefined;
  const apiErrStatus = typeof msg.api_error_status === 'number' ? msg.api_error_status : undefined;
  const status = errStatus ?? apiErrStatus;

  // Match por status 401 OR string "authentication_failed" (cobre variantes do CLI)
  if (status === 401 || (errStr && errStr.toLowerCase().includes('authentication_failed'))) {
    return { status: status ?? 401, message: errStr };
  }
  return null;
}

/**
 * Detecta rate-limit do plano (429) no stream-json.
 *
 * Stream-json emite tipicamente:
 *   { error_status: 429, error: "rate_limit_exceeded" }
 *   OU { api_error_status: 429, ... }
 *   OU resultado final com is_error:true e api_error_status:429
 *
 * Plano Max tem janelas de 5h — quando esgotada, retorna 429. UI mostra
 * "Cota do Max esgotada, reset em ~X" via evento rate_limited dedicado.
 */
function detectRateLimit(msg: any): { status?: number; message?: string } | null {
  if (!msg || typeof msg !== 'object') return null;
  const errStr = typeof msg.error === 'string' ? msg.error : undefined;
  const errStatus = typeof msg.error_status === 'number' ? msg.error_status : undefined;
  const apiErrStatus = typeof msg.api_error_status === 'number' ? msg.api_error_status : undefined;
  const status = errStatus ?? apiErrStatus;

  if (status === 429 || (errStr && /rate.?limit/i.test(errStr))) {
    return { status: status ?? 429, message: errStr };
  }
  return null;
}

interface ClaudeResolved {
  command: string;
  prefixArgs: string[];
}

/**
 * Mapeia o ID interno do UI pro valor que `claude --model <X>` aceita.
 *
 * O CLI aceita aliases curtos (`opus`, `sonnet`, `haiku`) pra família mais
 * recente, OU o nome completo do modelo (`claude-opus-4-6`, `claude-opus-4-7[1m]`).
 * Manter sincronizado com o popover de modelo no ChatView (slugMap interno).
 *
 * Retorna null se o ID não bater com nenhum modelo conhecido (ignora flag).
 */
function mapModelToCli(model: string): string | null {
  switch (model) {
    case 'opus':
      return 'opus';
    case 'opus-1m':
      // Variante 1M context window — CLI aceita o slug entre colchetes.
      return 'opus[1m]';
    case 'sonnet':
      return 'sonnet';
    case 'haiku':
      return 'haiku';
    case 'opus-legacy':
      // Opus 4.6 — nome completo porque o alias `opus` resolve pro mais novo.
      return 'claude-opus-4-6';
    default:
      return null;
  }
}

/**
 * Mapeia o ID interno do UI pro valor que `claude --permission-mode <X>` aceita.
 * Retorna null se o ID não bater com nenhum mode conhecido (ignora flag).
 */
/**
 * Heurística simples pra detectar se um prompt está em pt-BR.
 * Critérios (qualquer match → true):
 *   1. Tem caractere acentuado (á-ú/Á-Ú/ç/Ç/ã/õ/etc) — quase exclusivo de pt/es/fr,
 *      e pt-BR é o caso comum no UNDRCOD.
 *   2. Tem palavra-chave frequente pt-BR ("você", "não", "está", "como", "faz",
 *      "criar", "mostra", "olá", "oi", "teste", "arquivo", "pasta", etc).
 *
 * False positives aceitáveis pra force-PT em casos ambíguos. Usuários
 * estrangeiros que digitarem em inglês sem nenhuma dessas keywords
 * (caso comum) NÃO vão ter o force-PT aplicado.
 */
function looksLikePtBr(text: string): boolean {
  if (!text) return false;
  // 1. Acentos — match imediato
  if (/[áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ]/.test(text)) return true;
  // 2. Palavras-chave frequentes em pt-BR (case-insensitive, word-boundary)
  const lower = text.toLowerCase();
  const ptKeywords = /\b(você|nao|sim|olá|oi|teste|testar|arquivo|pasta|criar|fazer|mostra|abrir|fechar|salvar|ler|escrever|rodar|executar|como|pra|para|com|sem|mas|também|porque|então|aqui|ali|tudo|nada|certo|errado|melhor|pior|antes|depois|agora|nunca|sempre|talvez|qual|onde|quem|que|esse|essa|isso|aquilo|meu|minha|seu|sua|nosso|nossa)\b/;
  return ptKeywords.test(lower);
}

function mapPermissionModeToCli(mode: string): string | null {
  // CLI 2.1.x aceita: acceptEdits, auto, bypassPermissions, default, dontAsk, plan
  // (NÃO aceita 'ask' — esse era o nome antigo. Agora é 'default' que faz prompt.)
  switch (mode) {
    case 'askPermissions':
    case 'ask':
      // 'default' = modo que pergunta. O --permission-prompt-tool intercepta
      // o prompt e manda pro permission MCP server → UI inline do UNDRCOD.
      return 'default';
    case 'acceptEdits':
    case 'edit':
      return 'acceptEdits';
    case 'plan':
      return 'plan';
    case 'auto':
    case 'bypassPermissions':
      return 'bypassPermissions';
    case 'default':
      return 'default';
    default:
      return null;
  }
}

/**
 * Resolve como executar `claude`. Ordem de preferência no Windows:
 *   1. claude.exe nativo (versão atual ~228MB) — shell:false, quoting correto via Node
 *   2. cli.js antigo via `node cli.js` (versões pre-exe)
 *   3. claude.cmd via shell:true (fallback FINAL, BUG-PRONE — args com espaco
 *      são split em palavras pelo cmd.exe porque shell:true não quota auto)
 *
 * IMPORTANTE: shell:true no Windows não faz quoting automático — prompts
 * multi-palavra ("quero criar app") chegam como args separados, e o CLI
 * pega só o primeiro como valor do -p. Por isso priorizamos sempre o exe.
 */
function resolveClaudeCommand(): ClaudeResolved {
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA;
    if (appdata) {
      const base = join(appdata, 'npm', 'node_modules', '@anthropic-ai', 'claude-code');
      // 1) claude.exe nativo (versão atual)
      const exe = join(base, 'bin', 'claude.exe');
      if (existsSync(exe)) {
        return { command: exe, prefixArgs: [] };
      }
      // 2) cli.js antigo (pre-exe)
      const cliJs = join(base, 'cli.js');
      if (existsSync(cliJs)) {
        return { command: 'node', prefixArgs: [cliJs] };
      }
    }
    // 3) Fallback: shell=true vai resolver .cmd, mas escape menos seguro
    return { command: 'claude.cmd', prefixArgs: [] };
  }
  return { command: 'claude', prefixArgs: [] };
}

class AgentManager {
  private turns = new Map<string, ActiveTurn>();
  private eventListeners = new Set<(sessionId: string, event: AgentEvent) => void>();
  private sessionToTurn = new Map<string, string>(); // sessionId -> turnId
  private startedSessions = new Set<string>(); // sessions que já tiveram pelo menos 1 turn
  /**
   * Guard ATÔMICO contra spawns paralelos da mesma session. Setado SÍNCRONO
   * antes de qualquer await em sendPrompt, deletado em exit/error. Sem ele
   * havia janela entre `sessionToTurn.has` check e o `set` (que só roda
   * DEPOIS do `await permissionBridge.start()` e do `spawn`), e duas calls
   * concorrentes (StrictMode duplo-mount, IPC duplicado, retry sobreposto)
   * conseguiam ambas spawnar o CLI com o mesmo session-id → "already in use".
   */
  private spawningSessions = new Set<string>();

  /**
   * Cria uma session ID nova (UUID v4). Não spawna processo ainda — só registra.
   */
  createSession(): string {
    return randomUUID();
  }

  /**
   * "Adota" uma session existente do disco do Claude CLI. Marca como startedSessions
   * pra próxima mensagem usar --resume (continuar) em vez de --session-id (criar nova).
   */
  adoptSession(sessionId: string): void {
    this.startedSessions.add(sessionId);
  }

  /**
   * Reseta o estado de uma session — próxima send vira "first turn" (cria nova).
   * Util quando o user faz "Nova conversa" depois de ter usado a mesma sessionId.
   */
  forgetSession(sessionId: string): void {
    this.startedSessions.delete(sessionId);
    this.sessionToTurn.delete(sessionId);
  }

  /**
   * Manda um prompt do user e stream eventos.
   * Reutiliza session se existir; senão Claude cria ao receber o session-id.
   *
   * permissionMode opcional: aplica `--permission-mode <mode>` no spawn args.
   * Valores aceitos pelo CLI: 'ask' | 'edit' | 'plan' | 'default' | 'bypassPermissions'.
   * Note: --resume não revalida o mode original — passa-se no novo spawn pra sobrescrever
   * o mode do turn em diante.
   *
   * model opcional: ID UI ('opus' | 'opus-1m' | 'sonnet' | 'haiku' | 'opus-legacy').
   * Mapeado via `mapModelToCli` pro slug que `claude --model <X>` aceita. Aplica
   * por-turn — assim como permissionMode, --resume não revalida então passa-se
   * a cada send pra refletir a escolha atual do popover.
   */
  async sendPrompt(opts: {
    sessionId: string;
    cwd: string;
    prompt: string;
    permissionMode?: string;
    model?: string;
    /** Effort level passado como `--effort <X>`. Aceita: low | medium | high | xhigh | max.
     *  Sem effort, CLI usa default (geralmente baixo demais pra emitir thinking blocks). */
    effort?: string;
    /** Idioma preferido: 'auto' | 'pt-BR' | 'en'. Default 'auto'. */
    preferredLanguage?: 'auto' | 'pt-BR' | 'en';
  }): Promise<{ turnId: string } | { error: string }> {
    const { sessionId, cwd, prompt, permissionMode, model, effort, preferredLanguage } = opts;

    // Se já tem turn ativo nessa sessão, rejeita
    if (this.sessionToTurn.has(sessionId)) {
      console.warn(`[agent] sendPrompt rejected: session ${sessionId.slice(0,8)} já tem turn ativo`);
      return { error: 'Já tem um turn rodando nessa sessão. Aguarda ou cancela.' };
    }

    // GUARD ATÔMICO contra duplicate-spawn: se outra invocação já passou pelo
    // primeiro guard mas ainda não chegou ao `sessionToTurn.set`, this.spawning
    // já tem o sessionId. Cobre a janela do `await permissionBridge.start()`
    // (~50-200ms) onde StrictMode/IPC dup/retry consegue entrar 2×.
    if (this.spawningSessions.has(sessionId)) {
      console.warn(`[agent] sendPrompt rejected: session ${sessionId.slice(0,8)} já está spawnando (race condition guard)`);
      return { error: 'Já tem um turn iniciando nessa sessão. Aguarda.' };
    }
    this.spawningSessions.add(sessionId);

    const turnId = randomUUID();
    const spawnStartedAt = Date.now();
    console.log(`[agent] spawn START session=${sessionId.slice(0,8)} turn=${turnId.slice(0,8)} ts=${spawnStartedAt} retryCount=${(opts as { __retryCount?: number }).__retryCount ?? 0}`);
    const resolved = resolveClaudeCommand();
    // DECISÃO --session-id vs --resume é baseada NO JSONL REAL DO CLI,
    // não em startedSessions in-memory. Razões:
    //   1. Restart do main limpa startedSessions, mas o CLI ainda tem o jsonl
    //      de sessions anteriores. Sem este check, tentar --session-id resulta
    //      em "Session ID is already in use".
    //   2. localStorage do renderer persiste session IDs entre boots, então
    //      tabs/conversas voltam com ID já conhecido pelo CLI.
    //   3. Ghost sessions (ID no localStorage mas sem jsonl) precisam vir
    //      como --session-id pra serem criadas. Esse caso é coberto também.
    // Resumo: existe jsonl → --resume. Senão → --session-id (cria).
    const cliHasSession = sessionExistsInCli(sessionId, cwd);
    const isFirstTurn = !cliHasSession;
    if (cliHasSession && !this.startedSessions.has(sessionId)) {
      // Sincroniza in-memory tracking pra próximas decisões internas baterem.
      this.startedSessions.add(sessionId);
    }
    console.log(`[agent] session ${sessionId.slice(0,8)} cliHasSession=${cliHasSession} → ${isFirstTurn ? '--session-id (new)' : '--resume (existing)'}`);

    // Primeiro turn: --session-id <novo>. Próximos: --resume <existing>.
    const sessionFlags = isFirstTurn
      ? ['--session-id', sessionId]
      : ['--resume', sessionId];

    // Mode flag: só inclui quando explicitamente passado.
    // Mapeia IDs internos do UI pros valores que o CLI aceita.
    const modeFlag: string[] = [];
    if (permissionMode) {
      const cliMode = mapPermissionModeToCli(permissionMode);
      if (cliMode) modeFlag.push('--permission-mode', cliMode);
    }

    // Permission MCP setup — quando user escolhe `ask` ou `acceptEdits`, plugamos
    // nosso MCP server (`undrcode_permission`) e apontamos
    // `--permission-prompt-tool` pra ele. Daí o CLI delega TODO prompt de
    // permissao via approval_prompt → bridge TCP → renderer → card inline.
    //
    // Em `bypassPermissions`/`plan`/sem mode, NAO mexe — fluxo existente
    // (auto-allow ou plan read-only) continua funcionando intocado.
    const permFlags: string[] = [];
    const needsBridge =
      permissionMode === 'ask' ||
      permissionMode === 'askPermissions' ||
      permissionMode === 'acceptEdits' ||
      permissionMode === 'edit';
    if (needsBridge) {
      try {
        const { port, token } = await permissionBridge.start();
        const scriptPath = permissionBridge.getScriptPath();
        const mcpConfigPath = join(tmpdir(), `undrcode-perm-mcp-${randomUUID()}.json`);
        const mcpConfig = {
          mcpServers: {
            undrcode_permission: {
              command: 'node',
              args: [scriptPath],
              env: {
                UNDRCODE_PERM_BRIDGE_PORT: String(port),
                UNDRCODE_PERM_BRIDGE_TOKEN: token,
              },
            },
          },
        };
        writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig), 'utf-8');
        permFlags.push(
          '--mcp-config',
          mcpConfigPath,
          '--permission-prompt-tool',
          'mcp__undrcode_permission__approval_prompt',
        );
        console.log('[agent] permission MCP enabled, config:', mcpConfigPath);
      } catch (err: any) {
        // Falha em iniciar bridge nao deve travar o turn — segue sem MCP,
        // CLI vai cair no fluxo default (que em modo `ask` sem TTY trava;
        // log pra debugar caso aconteca).
        console.error('[agent] failed to start permission bridge:', err?.message);
      }
    }

    // Model flag: idem — só inclui quando passado e mapeável.
    // Permite ao popover do composer (Opus/Sonnet/Haiku/Opus-1M/Opus-legacy)
    // efetivamente trocar de modelo no spawn do CLI.
    const modelFlag: string[] = [];
    if (model) {
      const cliModel = mapModelToCli(model);
      if (cliModel) modelFlag.push('--model', cliModel);
    }

    // Effort flag — controla extended thinking. Sem isso, CLI usa default que
    // frequentemente NÃO emite thinking_delta events (sem reasoning visível).
    // Valores CLI: low | medium | high | xhigh | max. Pra thinking aparecer,
    // recomenda-se high+. Passa direto sem mapeamento.
    const effortFlag: string[] = [];
    if (effort && ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) {
      effortFlag.push('--effort', effort);
    }

    // Language flag: append-system-prompt forçando idioma quando aplicável.
    //   'auto': aplica force-pt-BR só se o prompt parece pt-BR (heurística).
    //           Pra prompts em inglês → nada (Claude responde inglês default).
    //   'pt-BR': aplica sempre.
    //   'en': aplica sempre.
    // Append (não substitui) o system existente do CLI — não interfere com plugins.
    const PT_BR_PROMPT = 'Responda sempre em português brasileiro, com gramática e acentuação corretas. Use inglês apenas para termos técnicos consagrados (nomes de bibliotecas, comandos, APIs).';
    const EN_PROMPT = 'Always respond in English regardless of the user prompt language.';
    const languageFlag: string[] = [];
    const lang = preferredLanguage ?? 'auto';
    if (lang === 'pt-BR') {
      languageFlag.push('--append-system-prompt', PT_BR_PROMPT);
    } else if (lang === 'en') {
      languageFlag.push('--append-system-prompt', EN_PROMPT);
    } else if (lang === 'auto' && looksLikePtBr(prompt)) {
      languageFlag.push('--append-system-prompt', PT_BR_PROMPT);
    }

    // HÍBRIDO ARGV / STDIN — espelha pattern do Cursor.
    //
    // Cursor (bundle workbench.desktop.main.js): serializa contexto + chips em
    // JSON.stringify único no campo `extra` da metadata, manda inline no body
    // do request HTTP (limite ~megabytes). Sem fragmentação, sem split.
    //
    // Nós: CLI argv tem limite. No Windows com shell=true (claude.cmd) =
    // ~8191 chars. Prompts CSS com chips Tailwind passam disso fácil.
    //
    // Estratégia: prompt PEQUENO (< 6000 chars) vai via argv -p (rápido, padrão).
    // Prompt GRANDE vai via stdin (limite ~64MB no Node). Cursor pattern com
    // transport diferente — mesma filosofia "tudo numa única mensagem".
    //
    // Como invocar via stdin: omite o `-p <text>` totalmente. Claude CLI lê
    // stdin quando nenhum prompt posicional/flag é fornecido (padrão Unix).
    const PROMPT_STDIN_THRESHOLD = 6000;
    const useStdin = prompt.length > PROMPT_STDIN_THRESHOLD;

    const args = [
      ...resolved.prefixArgs,
      // Só inclui -p <prompt> quando vai por argv. Via stdin, omite o flag.
      ...(useStdin ? [] : ['-p', prompt]),
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      // Injeta contexto do UNDRCOD em TODO spawn — agent sempre sabe que tá
      // rodando dentro da IDE, conhece features que só existem via UI
      // (CSS Inspector, PermissionCard, NEP, etc) e respeita convenções
      // do codebase. Conteúdo em src/main/undrcode-system-prompt.ts.
      '--append-system-prompt',
      UNDRCOD_SYSTEM_PROMPT,
      ...languageFlag,
      ...modeFlag,
      ...permFlags,
      ...modelFlag,
      ...effortFlag,
      ...sessionFlags
    ];

    // DEBUG: log o spawn pra rastrear bugs tipo "mandei prompt e nada veio".
    console.log(
      '[agent] spawn:', resolved.command,
      'promptLen:', prompt.length,
      'transport:', useStdin ? 'STDIN' : 'argv',
      'cwd:', cwd,
    );

    let proc: ChildProcess;
    try {
      proc = spawn(resolved.command, args, {
        cwd,
        env: process.env,
        windowsHide: true,
        // shell=true só se cair no fallback claude.cmd (sem cli.js detectado)
        shell: resolved.command.endsWith('.cmd'),
        // Quando vai via stdin, precisa abrir stdin pipe (default é 'ignore'
        // pra processos sem input). 'pipe' deixa proc.stdin disponível.
        stdio: useStdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      // CRÍTICO: libera o guard atômico em caminho de falha — senão a session
      // fica permanentemente bloqueada sem turn ativo nem registro de spawn.
      this.spawningSessions.delete(sessionId);
      return { error: `Falha ao spawnar claude: ${err.message}` };
    }

    // Escreve prompt via stdin e fecha. Claude CLI lê stdin até EOF, parseia
    // como prompt, daí processa normalmente. Async — não bloqueia.
    if (useStdin && proc.stdin) {
      proc.stdin.on('error', (err) => {
        console.error('[agent] stdin write error:', err.message);
      });
      proc.stdin.write(prompt, 'utf-8', () => {
        proc.stdin?.end();
      });
    }

    const turn: ActiveTurn = {
      sessionId,
      proc,
      buffer: '',
      // Acumulador de stderr inteiro pra incluir no error final quando exit code != 0.
      // Antes só emitíamos linhas que continham "error"/"failed" — perdia mensagens
      // importantes tipo "argument list too long" do shell ou crash do CLI.
      stderrBuf: ''
    };
    this.turns.set(turnId, turn);
    this.sessionToTurn.set(sessionId, turnId);
    this.startedSessions.add(sessionId);
    // Spawn registrado em sessionToTurn — pode liberar o guard atômico.
    // A partir daqui, qualquer call concorrente bate no guard `sessionToTurn.has`.
    this.spawningSessions.delete(sessionId);
    console.log(`[agent] spawn OK session=${sessionId.slice(0,8)} pid=${proc.pid} elapsed=${Date.now() - spawnStartedAt}ms`);

    // Emit "user msg sent" pra UI saber
    this.emit(sessionId, { type: 'turn_start', sessionId });

    proc.stdout?.on('data', (chunk: Buffer) => {
      turn.buffer += chunk.toString('utf-8');
      this.processBuffer(turn, sessionId);
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      turn.stderrBuf += text;
      const trimmed = text.trim();
      // CLI joga warnings no stderr — só passa adiante se parecer erro real
      if (trimmed.toLowerCase().includes('error') || trimmed.toLowerCase().includes('failed')) {
        this.emit(sessionId, { type: 'error', message: trimmed });
      }
    });

    proc.on('exit', (code) => {
      const stderrSnippet = (turn.stderrBuf || '').trim().slice(-500);
      const fullOutput = (turn.stderrBuf || '') + ' ' + turn.buffer;
      console.log('[agent] proc exit code:', code, 'buffer len:', turn.buffer.length, 'authFailed:', turn.authFailed, 'stderr:', stderrSnippet);
      // Processa qualquer buffer remanescente
      this.processBuffer(turn, sessionId);
      this.turns.delete(turnId);
      this.sessionToTurn.delete(sessionId);

      // RETRY em "already in use": CLI tem lock interno que demora alguns ms
      // pra liberar entre turns consecutivos do mesmo session ID. Se 2 prompts
      // vêm próximos, o 2º falha com esse erro. Detecta + retry 1 vez após 1.5s.
      // Sem retry, user via erro vermelho e tinha que recriar a conversa.
      //
      // IMPORTANTE: força `startedSessions` para que o retry use --resume em
      // vez de --session-id. Se o jsonl já existe (caso comum quando a
      // primeira tentativa criou parcialmente), --session-id falha de novo.
      // Já a retry com --resume aceita continuar a session existente.
      const isAlreadyInUse = /already in use/i.test(fullOutput);
      const retryCount = (opts as { __retryCount?: number }).__retryCount ?? 0;
      if (code !== 0 && isAlreadyInUse && retryCount < 2 && !turn.authFailed) {
        console.log(`[agent] detectado "already in use" — retry #${retryCount + 1} em 1500ms (sessionId=${sessionId.slice(0,8)})`);
        // Marca a session como já-iniciada pra próxima decisão ser --resume.
        // O check definitivo continua sendo o jsonl (sessionExistsInCli), mas
        // garantimos in-memory também por consistência.
        this.startedSessions.add(sessionId);
        setTimeout(() => {
          this.sendPrompt({ ...opts, __retryCount: retryCount + 1 } as typeof opts).catch((err) => {
            console.error('[agent] retry sendPrompt threw:', err);
          });
        }, 1500);
        return;
      }

      // Quando o CLI já sinalizou 401 via stream-json, NAO emite o erro generico
      // de exit code — o renderer já recebeu auth_expired e mostra UI dedicada.
      if (code !== 0 && code !== null && !turn.authFailed) {
        // Inclui últimos 500 chars do stderr no error pro user/dev ver causa real
        // (ex: "argument list too long" quando o prompt CSS estoura argv Windows).
        const msg = stderrSnippet
          ? `claude saiu com código ${code}: ${stderrSnippet}`
          : `claude saiu com código ${code}`;
        this.emit(sessionId, { type: 'error', message: msg });
      }
    });

    proc.on('error', (err) => {
      console.error('[agent] proc error:', err.message, 'code:', (err as NodeJS.ErrnoException).code);
      this.emit(sessionId, { type: 'error', message: `proc error: ${err.message}` });
      this.turns.delete(turnId);
      this.sessionToTurn.delete(sessionId);
      // Defesa em profundidade: se proc.error dispara antes do registro
      // (raro, mas possível em Windows com EACCES/ENOENT do spawn delayed),
      // libera o guard atômico pra não travar a session.
      this.spawningSessions.delete(sessionId);
    });

    return { turnId };
  }

  /**
   * Processa buffer linha-por-linha, parseia JSON e emite eventos.
   */
  private processBuffer(turn: ActiveTurn, sessionId: string): void {
    const lines = turn.buffer.split('\n');
    // Última linha pode estar incompleta — preserva no buffer
    turn.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        this.handleClaudeMessage(obj, sessionId, turn);
      } catch (err) {
        // JSON inválido — pode ser linha que não é JSON (header, etc). Ignora.
      }
    }
  }

  /**
   * Mapeia mensagem do Claude CLI pra evento AgentEvent simples.
   * `turn` opcional pra permitir marcar authFailed e suprimir erro generico no exit.
   */
  private handleClaudeMessage(msg: any, sessionId: string, turn?: ActiveTurn): void {
    if (!msg || typeof msg !== 'object') return;

    // --- auth failure (401) — detecta cedo antes de qualquer outro dispatch ---
    // Rate limit (429) — UI mostra mensagem dedicada com info de reset
    const rateLimit = detectRateLimit(msg);
    if (rateLimit) {
      if (turn) turn.authFailed = true; // reuso flag pra suprimir exit-code generico
      this.emit(sessionId, {
        type: 'rate_limited',
        status: rateLimit.status,
        message: rateLimit.message,
      });
      return;
    }

    const authFail = detectAuthFailure(msg);
    if (authFail) {
      if (turn) turn.authFailed = true;
      this.emit(sessionId, {
        type: 'auth_expired',
        status: authFail.status,
        message: authFail.message,
      });
      // Marca turn como auth-failed pra exit handler suprimir "saiu com codigo N"
      // generico. Mensagens subsequentes da mesma linha (raras) caem pelo return.
      return;
    }

    // --- system events ---
    if (msg.type === 'system' && msg.subtype === 'init') {
      this.emit(sessionId, {
        type: 'session_init',
        sessionId: msg.session_id || sessionId,
        model: msg.model,
        tools: msg.tools || [],
        // Slash commands disponiveis nessa sessão (inclui builtin + plugins).
        // Formato: "init", "review", "agent-sdk-dev:new-sdk-app", etc.
        slashCommands: Array.isArray(msg.slash_commands) ? msg.slash_commands : [],
        // Agents/skills/plugins disponiveis — usados pelo UI pra mostrar inventario na sidebar
        agents: Array.isArray(msg.agents) ? msg.agents : [],
        skills: Array.isArray(msg.skills) ? msg.skills : [],
        plugins: Array.isArray(msg.plugins) ? msg.plugins : [],
        mcpServers: Array.isArray(msg.mcp_servers) ? msg.mcp_servers : [],
        cwd: msg.cwd
      });
      return;
    }
    if (msg.type === 'system' && msg.subtype === 'status') {
      this.emit(sessionId, { type: 'status', status: msg.status });
      return;
    }

    // --- stream_event (Anthropic-style fine-grained) ---
    if (msg.type === 'stream_event' && msg.event) {
      const ev = msg.event;

      if (ev.type === 'content_block_start') {
        const block = ev.content_block;
        if (block?.type === 'tool_use') {
          this.emit(sessionId, {
            type: 'tool_use_start',
            toolUseId: block.id,
            name: block.name,
            index: ev.index
          });
        }
        return;
      }

      if (ev.type === 'content_block_delta') {
        const delta = ev.delta;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          this.emit(sessionId, { type: 'text_delta', text: delta.text });
        } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          this.emit(sessionId, { type: 'thinking_delta', text: delta.thinking });
        } else if (delta?.type === 'input_json_delta') {
          // Tool input chunks — concatena no UI se quiser
          this.emit(sessionId, {
            type: 'tool_use_input_delta',
            toolUseId: '',
            partial: delta.partial_json || ''
          });
        }
        return;
      }

      if (ev.type === 'message_stop') {
        // Pega usage/cost de outros eventos. message_stop sozinho não tem.
        return;
      }
      return;
    }

    // --- assistant (mensagem completa) ---
    if (msg.type === 'assistant' && msg.message?.content) {
      const blocks = Array.isArray(msg.message.content) ? msg.message.content : [];
      for (const block of blocks) {
        if (block.type === 'tool_use') {
          this.emit(sessionId, {
            type: 'tool_use_end',
            toolUseId: block.id,
            name: block.name,
            input: block.input || {}
          });
        }
      }
      return;
    }

    // --- user (tool result chegando) ---
    if (msg.type === 'user' && msg.message?.content) {
      const blocks = Array.isArray(msg.message.content) ? msg.message.content : [];
      for (const block of blocks) {
        if (block.type === 'tool_result') {
          const content = Array.isArray(block.content)
            ? block.content.map((c: any) => c.text || JSON.stringify(c)).join('')
            : typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);
          this.emit(sessionId, {
            type: 'tool_result',
            toolUseId: block.tool_use_id,
            result: content,
            isError: !!block.is_error
          });
        }
      }
      return;
    }

    // --- result (fim do turn) ---
    if (msg.type === 'result') {
      this.emit(sessionId, {
        type: 'turn_complete',
        sessionId: msg.session_id || sessionId,
        costUsd: msg.total_cost_usd,
        usage: msg.usage
          ? {
              inputTokens: msg.usage.input_tokens || 0,
              outputTokens: msg.usage.output_tokens || 0,
              cacheReadInputTokens: msg.usage.cache_read_input_tokens || 0,
              cacheCreationInputTokens: msg.usage.cache_creation_input_tokens || 0
            }
          : undefined,
        stopReason: msg.stop_reason
      });
      return;
    }
  }

  cancel(sessionId: string): boolean {
    const turnId = this.sessionToTurn.get(sessionId);
    if (!turnId) return false;
    const turn = this.turns.get(turnId);
    if (!turn) return false;
    try {
      turn.proc.kill('SIGTERM');
    } catch {}
    this.turns.delete(turnId);
    this.sessionToTurn.delete(sessionId);
    return true;
  }

  cancelAll(): void {
    for (const [, turn] of this.turns) {
      try {
        turn.proc.kill('SIGTERM');
      } catch {}
    }
    this.turns.clear();
    this.sessionToTurn.clear();
    // Note: NÃO limpa startedSessions — pode resumir depois
  }

  onEvent(cb: (sessionId: string, event: AgentEvent) => void): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  private emit(sessionId: string, event: AgentEvent): void {
    for (const cb of this.eventListeners) cb(sessionId, event);
  }
}

export const agentManager = new AgentManager();
