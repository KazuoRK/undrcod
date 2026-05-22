import { contextBridge, ipcRenderer, clipboard } from 'electron';
import type { AgentEvent, SessionHistory, ReadSessionHistoryOptions } from '../shared/agent-types';
import type { AuthStatus } from '../main/auth-claude';
import type { UndrSettings } from '../shared/settings-types';

/**
 * API exposed to renderer via window.undrcodAPI.
 * Mantém superfície MÍNIMA — só o que renderer precisa.
 * Validação de input acontece no main process.
 */
const api = {
  agent: {
    createSession: (): Promise<{ sessionId: string }> =>
      ipcRenderer.invoke('agent:createSession'),

    /** Adota session existente (do disco do Claude CLI) — próxima send usa --resume */
    adoptSession: (sessionId: string): Promise<{ sessionId: string }> =>
      ipcRenderer.invoke('agent:adoptSession', sessionId),

    /** Reseta state da session (próxima send cria nova com --session-id) */
    forgetSession: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke('agent:forgetSession', sessionId),

    send: (opts: {
      sessionId: string;
      cwd: string;
      prompt: string;
      /** Aplica `--permission-mode` no spawn do `claude` (vale só pro turn em diante). */
      permissionMode?: string;
      /**
       * ID UI do modelo a aplicar via `--model` no spawn. Valores aceitos:
       * 'opus' | 'opus-1m' | 'sonnet' | 'haiku' | 'opus-legacy'.
       * Main faz o mapeamento pro slug que o CLI aceita.
       */
      model?: string;
      /**
       * Effort level (`--effort` no CLI). Aceita: low | medium | high | xhigh | max.
       * Sem effort, default do CLI frequentemente NÃO emite thinking blocks.
       * Pra ver "Pensou X..." na transcrição, usar high+ é recomendado.
       */
      effort?: string;
      /**
       * Idioma preferido pra resposta: 'auto' | 'pt-BR' | 'en'. Default 'auto'.
       * Em 'auto', main aplica heurística no prompt pra decidir se força pt-BR.
       */
      preferredLanguage?: 'auto' | 'pt-BR' | 'en';
    }): Promise<{ turnId: string } | { error: string }> =>
      ipcRenderer.invoke('agent:send', opts),

    cancel: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke('agent:cancel', sessionId),

    /**
     * Permission requests inline (modo `ask` / `acceptEdits`).
     *
     * Quando o CLI quer executar uma tool de risco, manda payload pro nosso
     * MCP server `undrcode_permission`, que abre TCP pro main, que faz
     * broadcast desse evento pra todas as windows. Renderer decide qual
     * ChatView renderiza o card (atualmente: todas — quem clicar primeiro
     * resolve via respondPermission, demais cards saem do estado).
     */
    onPermissionRequest: (
      cb: (req: {
        requestId: string;
        toolName: string;
        input: Record<string, unknown>;
        toolUseId: string | null;
      }) => void,
    ): (() => void) => {
      const handler = (
        _: unknown,
        req: {
          requestId: string;
          toolName: string;
          input: Record<string, unknown>;
          toolUseId: string | null;
        },
      ) => cb(req);
      ipcRenderer.on('agent:permission-request', handler);
      return () => ipcRenderer.removeListener('agent:permission-request', handler);
    },

    /**
     * Responde a um pedido pendente. `decision.behavior`:
     *   - 'allow': libera execucao com `updatedInput` (default = input original).
     *   - 'deny': bloqueia com `message` explicando.
     * Retorna false se requestId nao existe mais (timeout ou outra window respondeu).
     */
    respondPermission: (
      requestId: string,
      decision: {
        behavior: 'allow' | 'deny';
        updatedInput?: Record<string, unknown>;
        message?: string;
      },
    ): Promise<boolean> => ipcRenderer.invoke('agent:respondPermission', requestId, decision),

    /**
     * One-shot `claude -p "<prompt>"` no cwd, timeout 30s. Retorna texto raw
     * (stdout trim). Usado pelo CommitDialog pra gerar mensagem de commit.
     */
    oneshot: (cwd: string, prompt: string): Promise<{ text: string } | { error: string }> =>
      ipcRenderer.invoke('agent:oneshot', cwd, prompt),

    onEvent: (sessionId: string, cb: (event: AgentEvent) => void): (() => void) => {
      const handler = (_: unknown, id: string, event: AgentEvent) => {
        if (id === sessionId) cb(event);
      };
      ipcRenderer.on('agent:event', handler);
      return () => ipcRenderer.removeListener('agent:event', handler);
    }
  },

  claude: {
    spawn: (opts: { cwd: string }): Promise<{ ptyId: string } | { error: string }> =>
      ipcRenderer.invoke('claude:spawn', opts),

    write: (ptyId: string, data: string): Promise<boolean> =>
      ipcRenderer.invoke('claude:write', ptyId, data),

    resize: (ptyId: string, cols: number, rows: number): Promise<boolean> =>
      ipcRenderer.invoke('claude:resize', ptyId, cols, rows),

    kill: (ptyId: string): Promise<boolean> =>
      ipcRenderer.invoke('claude:kill', ptyId),

    list: (): Promise<Array<{ ptyId: string; cwd: string; startedAt: number }>> =>
      ipcRenderer.invoke('claude:list'),

    /** Lista sessões salvas do Claude CLI pra um workspace especifico */
    listProjectSessions: (cwd: string): Promise<Array<{
      sessionId: string;
      title: string;
      firstTimestamp: string;
      lastTimestamp: string;
      messageCount: number;
      cwd: string;
    }>> => ipcRenderer.invoke('claude:listProjectSessions', cwd),

    /** Lista todos os workspaces que tem sessões salvas no ~/.claude/projects */
    listKnownWorkspaces: (): Promise<Array<{ path: string; sessionCount: number; lastUsed: string }>> =>
      ipcRenderer.invoke('claude:listKnownWorkspaces'),

    /**
     * Snapshot INSTANTÂNEO de sessions de um workspace, lendo direto do cache do main.
     * Retorna null se não tem cache. Renderer chama isso pra evitar mostrar
     * "Carregando..." em remounts (cache persistido em disco entre boots).
     */
    getSessionsSnapshot: (cwd: string): Promise<Array<{
      sessionId: string;
      title: string;
      firstTimestamp: string;
      lastTimestamp: string;
      messageCount: number;
      cwd: string;
    }> | null> => ipcRenderer.invoke('claude:getSessionsSnapshot', cwd),

    /** Snapshot de TODOS os workspaces de uma vez. Boot rápido. */
    getAllSessionsSnapshots: (): Promise<Record<string, Array<{
      sessionId: string;
      title: string;
      firstTimestamp: string;
      lastTimestamp: string;
      messageCount: number;
      cwd: string;
    }>>> => ipcRenderer.invoke('claude:getAllSessionsSnapshots'),

    /**
     * Le historico de uma sessão salva (parseando o .jsonl).
     * Sem `options` retorna tudo (legacy). Com options.limit/fromEnd retorna
     * só um slice — usado pra lazy load das últimas N msgs em conversas grandes.
     * Resposta inclui `totalEvents` pra renderer mostrar banner "carregar mais".
     */
    readSessionHistory: (
      sessionId: string,
      cwd: string,
      options?: ReadSessionHistoryOptions,
    ): Promise<SessionHistory> =>
      ipcRenderer.invoke('claude:readSessionHistory', sessionId, cwd, options),

    onData: (ptyId: string, cb: (data: string) => void): (() => void) => {
      const handler = (_: unknown, id: string, data: string) => {
        if (id === ptyId) cb(data);
      };
      ipcRenderer.on('claude:data', handler);
      return () => ipcRenderer.removeListener('claude:data', handler);
    },

    onExit: (ptyId: string, cb: (code: number) => void): (() => void) => {
      const handler = (_: unknown, id: string, code: number) => {
        if (id === ptyId) cb(code);
      };
      ipcRenderer.on('claude:exit', handler);
      return () => ipcRenderer.removeListener('claude:exit', handler);
    }
  },

  /** Terminal interativo (shell powershell/bash) — pra Bottom Panel Terminal tab */
  terminal: {
    spawn: (opts: { cwd: string; cols?: number; rows?: number }): Promise<{ termId: string } | { error: string }> =>
      ipcRenderer.invoke('terminal:spawn', opts),

    write: (termId: string, data: string): Promise<boolean> =>
      ipcRenderer.invoke('terminal:write', termId, data),

    resize: (termId: string, cols: number, rows: number): Promise<boolean> =>
      ipcRenderer.invoke('terminal:resize', termId, cols, rows),

    kill: (termId: string): Promise<boolean> =>
      ipcRenderer.invoke('terminal:kill', termId),

    onData: (termId: string, cb: (data: string) => void): (() => void) => {
      const handler = (_: unknown, id: string, data: string) => {
        if (id === termId) cb(data);
      };
      ipcRenderer.on('terminal:data', handler);
      return () => ipcRenderer.removeListener('terminal:data', handler);
    },

    onExit: (termId: string, cb: (code: number) => void): (() => void) => {
      const handler = (_: unknown, id: string, code: number) => {
        if (id === termId) cb(code);
      };
      ipcRenderer.on('terminal:exit', handler);
      return () => ipcRenderer.removeListener('terminal:exit', handler);
    },
  },

  fs: {
    /**
     * SECURITY (P0): registra o cwd ativo da window no main process. Todo
     * handler fs:* valida que paths recebidos ficam DENTRO desse cwd (mais
     * ~/.claude/ read-only). Sem chamar isso, writes falham com NO_ACTIVE_CWD.
     * Renderer chama isso após resolver workspace (settings.lastWorkspace,
     * dialog:openWorkspace, etc) e a cada troca de workspace.
     */
    setActiveCwd: (cwd: string): Promise<{ ok: true; cwd?: string } | { error: string }> =>
      ipcRenderer.invoke('fs:setActiveCwd', cwd),
    listDir: (path: string): Promise<Array<{ name: string; path: string; type: 'file' | 'dir' }>> =>
      ipcRenderer.invoke('fs:listDir', path),
    readFile: (path: string): Promise<{ content: string } | { error: string }> =>
      ipcRenderer.invoke('fs:readFile', path),
    writeFile: (path: string, content: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('fs:writeFile', path, content),
    /** Grava bytes binários (image paste, attachments) decodificando base64 no main. */
    writeBinaryFromBase64: (path: string, base64: string): Promise<{ ok: true; path: string } | { error: string }> =>
      ipcRenderer.invoke('fs:writeBinaryFromBase64', path, base64),
    stat: (path: string): Promise<{ isDirectory: boolean; isFile: boolean; size: number; mtime: number } | { error: string }> =>
      ipcRenderer.invoke('fs:stat', path),
    /** Revela arquivo/pasta no Explorer (Windows) / Finder (Mac) / Files (Linux). */
    revealInOs: (path: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke('fs:revealInOs', path),
    /** Lê binário como data URL (base64). Usado pra preview de imagens (CSP-safe). */
    readFileAsDataUrl: (path: string): Promise<{ dataUrl: string } | { error: string }> =>
      ipcRenderer.invoke('fs:readFileAsDataUrl', path),
    /** Fuzzy file search (Ctrl+P) — retorna até 50 results ordenados por score. */
    searchFiles: (cwd: string, query: string): Promise<Array<{ path: string; relPath: string; score: number }>> =>
      ipcRenderer.invoke('fs:searchFiles', cwd, query),
    /** Grep content across workspace files. Retorna até 200 matches (file:line). */
    grepContent: (cwd: string, query: string): Promise<Array<{ path: string; relPath: string; line: number; text: string; matchStart: number; matchEnd: number }>> =>
      ipcRenderer.invoke('fs:grepContent', cwd, query),
    /** Find & Replace global no workspace. Aplica replace in-place em todos os arquivos que casam. */
    replaceInFiles: (
      cwd: string,
      query: string,
      replacement: string,
      opts: {
        matchCase: boolean;
        wholeWord: boolean;
        regex: boolean;
        includeGlob?: string;
        excludeGlob?: string;
      },
    ): Promise<{ ok: true; filesChanged: number; totalReplacements: number } | { error: string }> =>
      ipcRenderer.invoke('fs:replaceInFiles', cwd, query, replacement, opts),
    /** Cria arquivo vazio (ou com conteúdo inicial). Falha se já existir. */
    createFile: (path: string, content?: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('fs:createFile', path, content ?? ''),
    /** Cria pasta. Falha se já existir. */
    createDir: (path: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('fs:createDir', path),
    /** Deleta arquivo OU pasta (recursive). Cuidado — destrutivo. */
    delete: (path: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('fs:delete', path),
    /** Renomeia/move arquivo OU pasta. oldPath e newPath absolutos. */
    rename: (oldPath: string, newPath: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('fs:rename', oldPath, newPath),
    /** Inicia file watcher (chokidar) no workspace. Re-call mata o anterior.
     * Eventos chegam via `fs:onWatcherEvent` listener abaixo. */
    watchWorkspace: (cwd: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('fs:watchWorkspace', cwd),
    /** Para o watcher ativo. */
    unwatchWorkspace: (): Promise<{ ok: true }> =>
      ipcRenderer.invoke('fs:unwatchWorkspace'),
    /** Subscribe pra eventos do watcher. Retorna função de unsubscribe. */
    onWatcherEvent: (
      cb: (data: { event: 'change' | 'add' | 'unlink' | 'addDir' | 'unlinkDir' | 'error'; path: string }) => void,
    ): (() => void) => {
      const listener = (_: unknown, data: { event: 'change' | 'add' | 'unlink' | 'addDir' | 'unlinkDir' | 'error'; path: string }) => cb(data);
      ipcRenderer.on('fs:watcher-event', listener);
      return () => ipcRenderer.removeListener('fs:watcher-event', listener);
    },
  },

  git: {
    /**
     * Diff do working tree vs HEAD. Retorna { files: [] } se cwd não for repo git.
     */
    diff: (cwd: string): Promise<{
      files: Array<{
        path: string;
        hunks: Array<{
          header: string;
          lines: Array<{ type: '+' | '-' | ' '; text: string }>;
        }>;
      }>;
    }> => ipcRenderer.invoke('git:diff', cwd),

    /**
     * Diff cumulativo entre <branchName> e HEAD (merge-base...HEAD).
     * Defensivo: se branch não existir, retorna { files: [] }.
     */
    diffVsBranch: (cwd: string, branchName: string): Promise<{
      files: Array<{
        path: string;
        hunks: Array<{
          header: string;
          lines: Array<{ type: '+' | '-' | ' '; text: string }>;
        }>;
      }>;
    }> => ipcRenderer.invoke('git:diffVsBranch', cwd, branchName),

    /** Aplica patch no working tree (reverse=true reverte). Usado pelo DiffViewer pra accept/reject hunk. */
    applyPatch: (cwd: string, patchText: string, reverse: boolean): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('git:applyPatch', cwd, patchText, reverse),

    /**
     * Aplica o N-ésimo hunk do `git diff HEAD -- <file>` byte-for-byte
     * (re-roda o diff no main e fatia o hunk pelo index, sem reconstrução).
     * Usado pelo botão "reject hunk" pra evitar bugs de roundtrip em CRLF/BOM
     * com nosso parser de DiffLine[].
     */
    applyHunkByIndex: (
      cwd: string,
      filePath: string,
      hunkIndex: number,
      reverse: boolean,
    ): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('git:applyHunkByIndex', cwd, filePath, hunkIndex, reverse),

    /** Reverte arquivo inteiro pro HEAD. Equivalente a `git checkout HEAD -- <file>`. */
    checkoutFile: (cwd: string, filePath: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('git:checkoutFile', cwd, filePath),

    /** Status do working tree + branch info. Retorna estado vazio se não for repo git. */
    status: (cwd: string): Promise<{
      branch: string;
      upstream?: string;
      ahead: number;
      behind: number;
      files: Array<{
        path: string;
        indexStatus: string;
        worktreeStatus: string;
        staged: boolean;
        renamedFrom?: string;
      }>;
    }> => ipcRenderer.invoke('git:status', cwd),

    /** Adiciona arquivo ao index (git add). */
    stage: (cwd: string, filePath: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('git:stage', cwd, filePath),

    /** Remove arquivo do index (git reset HEAD --). */
    unstage: (cwd: string, filePath: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('git:unstage', cwd, filePath),

    /** Cria commit com mensagem. Retorna hash curto em sucesso. */
    commit: (cwd: string, message: string): Promise<{ ok: true; hash: string } | { error: string }> =>
      ipcRenderer.invoke('git:commit', cwd, message),

    /** Stage TODOS os arquivos modificados/untracked (`git add -A`). */
    stageAll: (cwd: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('git:stageAll', cwd),

    /** Unstage TODOS os arquivos do index (`git reset HEAD`). */
    unstageAll: (cwd: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('git:unstageAll', cwd),

    /**
     * Descarta mudancas de UM arquivo (`git checkout -- <file>`).
     * DESTRUTIVO. Caller deve confirmar.
     */
    discardFile: (cwd: string, filePath: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('git:discardFile', cwd, filePath),

    /**
     * Descarta TODAS as mudancas (`git checkout -- .` + `git clean -fd`).
     * MASS DESTRUCTIVE. Caller deve confirmar com modal destrutivo.
     */
    discardAll: (cwd: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('git:discardAll', cwd),

    /** `git pull` — captura output combinado pra exibir em toast. */
    pull: (cwd: string): Promise<{ ok: true; output: string } | { error: string }> =>
      ipcRenderer.invoke('git:pull', cwd),

    /** `git push` (com fallback --set-upstream se branch nova). */
    push: (cwd: string): Promise<{ ok: true; output: string } | { error: string }> =>
      ipcRenderer.invoke('git:push', cwd),

    /** `git fetch --all --prune` — atualiza refs remotos sem mexer no working tree. */
    fetch: (cwd: string): Promise<{ ok: true; output: string } | { error: string }> =>
      ipcRenderer.invoke('git:fetch', cwd),

    /**
     * `git diff --cached --no-color` como string crua. Usado pelo CommitDialog
     * pra alimentar o LLM (gerar mensagem AI). Retorna { diff: '' } se nada staged.
     */
    diffStaged: (cwd: string): Promise<{ diff: string }> =>
      ipcRenderer.invoke('git:diffStaged', cwd),

    /** Lista todas as branches (locais + remote tracking) com flag isCurrent. */
    branches: (cwd: string): Promise<
      { ok: true; branches: Array<{ name: string; isCurrent: boolean; isRemote: boolean; lastCommit?: string }> }
      | { error: string }
    > => ipcRenderer.invoke('git:branches', cwd),

    /** Switch pra outra branch. Se for remote (origin/foo), cria local trackeando. */
    checkout: (cwd: string, branchName: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('git:checkout', cwd, branchName),

    /** Cria nova branch (e checa out nela). fromBranch opcional como base. */
    createBranch: (cwd: string, branchName: string, fromBranch?: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('git:createBranch', cwd, branchName, fromBranch),

    /**
     * Histórico git do arquivo ativo (--follow, max 200 commits). Usado pela
     * TimelineSection inline na sidebar. Retorna { ok, commits: [] } se cwd não
     * for repo git ou file não tracked — nunca bloqueia a UI.
     */
    fileHistory: (cwd: string, filePath: string): Promise<{
      ok: true;
      commits: Array<{
        hash: string;
        shortHash: string;
        subject: string;
        author: string;
        timestamp: number;
      }>;
    }> => ipcRenderer.invoke('git:fileHistory', cwd, filePath),
  },

  /** Output channels — pra Bottom Panel tab "Output" */
  output: {
    subscribe: (): Promise<{
      channels: string[];
      buffer: Record<string, Array<{ timestamp: string; level: 'info' | 'warn' | 'error'; text: string }>>;
    }> => ipcRenderer.invoke('output:subscribe'),

    /** Renderer enviando log próprio pro buffer "Renderer" (intercept de console.*) */
    rendererLog: (level: 'info' | 'warn' | 'error', text: string): void => {
      ipcRenderer.send('output:renderer-log', level, text);
    },

    onLog: (
      cb: (channel: string, line: { timestamp: string; level: 'info' | 'warn' | 'error'; text: string }) => void,
    ): (() => void) => {
      const handler = (
        _: unknown,
        channel: string,
        line: { timestamp: string; level: 'info' | 'warn' | 'error'; text: string },
      ) => cb(channel, line);
      ipcRenderer.on('output:log', handler);
      return () => ipcRenderer.removeListener('output:log', handler);
    },
  },

  /** Ports detector — netstat/lsof wrapper pra tab "Ports" */
  ports: {
    list: (): Promise<Array<{ port: number; address: string; process?: string }>> =>
      ipcRenderer.invoke('ports:list'),
  },

  /** Problems — tsc --noEmit no cwd pra tab "Problems" */
  problems: {
    check: (cwd: string): Promise<{
      files: Array<{
        path: string;
        errors: Array<{ line: number; col: number; code: string; message: string }>;
      }>;
    }> => ipcRenderer.invoke('problems:check', cwd),
  },

  /** MCP servers — lista servers configurados pra Claude CLI no cwd atual */
  mcp: {
    /** Lista servers visiveis pro cwd (merge de ~/.claude.json + <cwd>/.mcp.json) */
    list: (cwd: string): Promise<Array<{
      name: string;
      command: string;
      args: string[];
      enabled: boolean;
      status: 'configured' | 'unknown';
      scope: 'workspace' | 'user' | 'project';
      type?: string;
      sourcePath: string;
    }>> => ipcRenderer.invoke('mcp:list', cwd),

    /** Resolve path do arquivo de config (cria stub vazio se não existir). */
    openConfig: (scope: 'global' | 'workspace', cwd: string): Promise<{ path: string } | { error: string }> =>
      ipcRenderer.invoke('mcp:openConfig', scope, cwd),

    /** Diagnostico — quais arquivos de config existem (informativo). */
    locations: (cwd: string): Promise<{
      userConfigJson: string | null;
      userMcpJson: string | null;
      workspaceMcpJson: string | null;
    }> => ipcRenderer.invoke('mcp:locations', cwd),

    /** Adiciona ou substitui server. Escreve no JSON apropriado pro scope. */
    addServer: (
      scope: 'user' | 'workspace' | 'project',
      cwd: string,
      name: string,
      config: {
        command: string;
        args?: string[];
        env?: Record<string, string>;
        type?: string;
        url?: string;
      },
    ): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('mcp:addServer', scope, cwd, name, config),

    /** Remove server do scope dado. */
    removeServer: (
      scope: 'user' | 'workspace' | 'project',
      cwd: string,
      name: string,
    ): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('mcp:removeServer', scope, cwd, name),

    /**
     * Liga/desliga server. Pra scope 'workspace', manipula
     * disabledMcpjsonServers/enabledMcpjsonServers em projects[<cwd>] do
     * ~/.claude.json. Pra 'user'/'project' e no-op silencioso (esses
     * escopos não tem flag enable — remova pra desligar).
     */
    setEnabled: (
      scope: 'user' | 'workspace' | 'project',
      cwd: string,
      name: string,
      enabled: boolean,
    ): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('mcp:setEnabled', scope, cwd, name, enabled),

    /**
     * Catalogo curado de ~20 MCPs populares pra UI de 1-click install.
     * Renderer consome pra montar grid/cards com badges (official/vendor),
     * categorias e form auth dinâmico. Hardcoded no main process.
     *
     * Type duplicado inline — preload não compartilha runtime imports com
     * o resto do main (só compile-time). Manter sincronizado com
     * `McpCatalogEntry` em src/main/mcp-catalog.ts.
     */
    listCatalog: (): Promise<Array<{
      id: string;
      displayName: string;
      description: string;
      category:
        | 'database'
        | 'devtools'
        | 'productivity'
        | 'communication'
        | 'storage'
        | 'web'
        | 'automation'
        | 'design'
        | 'finance'
        | 'other';
      command: string;
      args: string[];
      authFields: Array<{
        name: string;
        label: string;
        type: 'password' | 'text' | 'url';
        required: boolean;
        help?: string;
      }>;
      transport: 'stdio' | 'http' | 'sse';
      official: boolean;
      vendor?: string;
      homepage?: string;
      iconSlug?: string;
      keywords?: string[];
    }>> => ipcRenderer.invoke('mcp:listCatalog'),

    /**
     * Testa se um server consegue ser spawnado. Spawn do command+args com timeout
     * 5s. Retorna { ok: true, output } se processo iniciou (mesmo silencioso),
     * { error } se spawn falhou ou processo saiu com codigo nao-zero.
     */
    test: (payload: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }): Promise<{ ok: true; output: string } | { error: string }> =>
      ipcRenderer.invoke('mcp:test', payload),
  },

  /**
   * Plugin Marketplace — wrapper sobre `claude plugin ...` CLI.
   * Leitura cruza known_marketplaces.json + marketplace.json + `plugin list --json`.
   * Toda mutação passa pelo CLI pra manter cache/git checkout consistente.
   */
  plugins: {
    /** Lista marketplaces registrados (lê ~/.claude/plugins/known_marketplaces.json) */
    listMarketplaces: (): Promise<Array<{
      id: string;
      name: string;
      url?: string;
      source: 'official' | 'custom';
      pluginCount: number;
      lastUpdated?: string;
      installLocation?: string;
    }>> => ipcRenderer.invoke('plugins:listMarketplaces'),

    /** Lista plugins do catálogo de UM marketplace (lê <install>/.claude-plugin/marketplace.json) */
    listPlugins: (marketplaceId: string): Promise<Array<{
      name: string;
      description?: string;
      author?: string;
      category?: string;
      homepage?: string;
      marketplace: string;
      source?: string;
      installed?: boolean;
      enabled?: boolean;
      installCount?: number;
      iconCandidates?: string[];
    }>> => ipcRenderer.invoke('plugins:listPlugins', marketplaceId),

    /** Inventario detalhado de UM plugin instalado (Skills/Agents/Commands/Hooks/MCP/LSP + tokens always-on). */
    getDetails: (name: string): Promise<{
      name: string;
      description?: string;
      source?: string;
      skills: string[];
      agents: string[];
      commands: string[];
      hooks: string[];
      mcpServers: string[];
      lspServers: string[];
      alwaysOnTokens?: number;
    } | null> => ipcRenderer.invoke('plugins:getDetails', name),

    /** Lista plugins instalados via `claude plugin list --json` */
    listInstalled: (): Promise<Array<{
      name: string;
      marketplace?: string;
      enabled: boolean;
      version?: string;
      scope?: string;
    }>> => ipcRenderer.invoke('plugins:listInstalled'),

    /** Instala plugin (`claude plugin install <name>@<marketplaceId>`) */
    install: (name: string, marketplaceId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('plugins:install', name, marketplaceId),

    /** Desinstala plugin (`claude plugin uninstall <name>`) */
    uninstall: (name: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('plugins:uninstall', name),

    /** Liga/desliga plugin (`claude plugin enable|disable <name>`) */
    setEnabled: (name: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('plugins:setEnabled', name, enabled),

    /** Adiciona marketplace custom (`claude plugin marketplace add <repo>`) */
    addMarketplace: (githubRepo: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('plugins:addMarketplace', githubRepo),

    /** Remove marketplace (`claude plugin marketplace remove <id>`) */
    removeMarketplace: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('plugins:removeMarketplace', id),

    /** Atualiza marketplace via git pull (`claude plugin marketplace update <id>`) */
    refreshMarketplace: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('plugins:refreshMarketplace', id),
  },

  /**
   * SKILLs — install via `npx skills add` (CLI oficial da Anthropic).
   * Diferente de plugins: skills são markdown SKILL.md files que estendem
   * o agente. Catalogadas em src/shared/curated-skills.ts.
   */
  skills: {
    /** Instala skill curada — shell-out npx em background (cwd = homedir). */
    installCurated: (
      source: string,
      skillFilter?: string,
    ): Promise<{ ok: boolean; error?: string; output?: string }> =>
      ipcRenderer.invoke('skills:installCurated', source, skillFilter),
  },

  /**
   * Customization — discovery read-only de Rules, Skills, Workflows, Agents e
   * Hooks que customizam o Claude CLI (workspace `.claude/` + user `~/.claude/`
   * + plugins instalados). Tipos duplicados inline (preload não compartilha
   * types com renderer no runtime, só no compile-time).
   */
  customization: {
    /** Tudo de uma vez (5 listas em paralelo). MCP NAO entra aqui — use mcp.list. */
    summary: (cwd: string): Promise<{
      rules: Array<{
        scope: 'workspace' | 'user' | 'plugin';
        path: string;
        filename: string;
        preview: string;
        bytes: number;
        mtime: number;
      }>;
      skills: Array<{
        scope: 'workspace' | 'user' | 'plugin';
        name: string;
        description?: string;
        version?: string;
        userInvocable?: boolean;
        argumentHint?: string;
        path: string;
        pluginName?: string;
      }>;
      workflows: Array<{
        scope: 'workspace' | 'user' | 'plugin';
        name: string;
        description?: string;
        path: string;
        pluginName?: string;
      }>;
      agents: Array<{
        scope: 'workspace' | 'user' | 'plugin';
        name: string;
        description?: string;
        model?: string;
        tools?: string[];
        path: string;
        pluginName?: string;
      }>;
      hooks: Array<{
        scope: 'workspace' | 'user' | 'plugin';
        event: string;
        matcher: string;
        command: string;
        type: string;
        timeout?: number;
        sourceSettings: string;
      }>;
    }> => ipcRenderer.invoke('customization:summary', cwd),

    listRules: (cwd: string): Promise<Array<{
      scope: 'workspace' | 'user' | 'plugin';
      path: string;
      filename: string;
      preview: string;
      bytes: number;
      mtime: number;
    }>> => ipcRenderer.invoke('customization:listRules', cwd),

    listSkills: (cwd: string): Promise<Array<{
      scope: 'workspace' | 'user' | 'plugin';
      name: string;
      description?: string;
      version?: string;
      userInvocable?: boolean;
      argumentHint?: string;
      path: string;
      pluginName?: string;
    }>> => ipcRenderer.invoke('customization:listSkills', cwd),

    listWorkflows: (cwd: string): Promise<Array<{
      scope: 'workspace' | 'user' | 'plugin';
      name: string;
      description?: string;
      path: string;
      pluginName?: string;
    }>> => ipcRenderer.invoke('customization:listWorkflows', cwd),

    listAgents: (cwd: string): Promise<Array<{
      scope: 'workspace' | 'user' | 'plugin';
      name: string;
      description?: string;
      model?: string;
      tools?: string[];
      path: string;
      pluginName?: string;
    }>> => ipcRenderer.invoke('customization:listAgents', cwd),

    listHooks: (cwd: string): Promise<Array<{
      scope: 'workspace' | 'user' | 'plugin';
      event: string;
      matcher: string;
      command: string;
      type: string;
      timeout?: number;
      sourceSettings: string;
    }>> => ipcRenderer.invoke('customization:listHooks', cwd),
  },

  /**
   * Whisper.cpp transcription — main process roda binario local sobre WAV
   * 16kHz mono 16-bit PCM. Renderer captura via MediaRecorder/AudioContext
   * e manda os bytes pra transcrever; checkSetup avisa se binario/modelo
   * faltam (rode scripts/setup-whisper.ps1).
   */
  whisper: {
    checkSetup: (): Promise<
      | { ok: true; binary: string; model: string }
      | { ok: false; reason: 'no-binary' | 'no-model'; expectedDir: string }
    > => ipcRenderer.invoke('whisper:checkSetup'),
    transcribe: (
      wavBytes: ArrayBuffer | Uint8Array,
    ): Promise<{ ok: true; text: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('whisper:transcribe', { wavBytes }),
  },

  /**
   * Checkpoint snapshots — antes de cada agent turn, snapshot real dos
   * arquivos dirty (estilo Cursor/Antigravity). `create` copia arquivos
   * via git diff/ls-files; `revert` restaura do snapshot. `list` traz
   * fileCount pra UI exibir quantos arquivos cada snapshot guarda.
   */
  checkpoint: {
    create: (cwd: string, label: string): Promise<{ ok: true; id: string; fileCount: number } | { ok: false; error: string }> =>
      ipcRenderer.invoke('checkpoint:create', cwd, label),
    list: (cwd: string): Promise<{ ok: true; checkpoints: Array<{ id: string; ts: number; label: string; fileCount: number }> }> =>
      ipcRenderer.invoke('checkpoint:list', cwd),
    revert: (cwd: string, id: string): Promise<{ ok: true; restored: number } | { ok: false; error: string }> =>
      ipcRenderer.invoke('checkpoint:revert', cwd, id),
    delete: (cwd: string, id: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('checkpoint:delete', cwd, id),
  },

  dialog: {
    openWorkspace: (): Promise<{ canceled: true } | { canceled: false; path: string }> =>
      ipcRenderer.invoke('dialog:openWorkspace'),
    openFiles: (): Promise<{ canceled: true } | { canceled: false; paths: string[] }> =>
      ipcRenderer.invoke('dialog:openFiles'),
    openFolder: (): Promise<{ canceled: true } | { canceled: false; path: string }> =>
      ipcRenderer.invoke('dialog:openFolder'),
    /** Save As dialog — retorna path escolhido (não escreve). Caller chama fs.writeFile depois. */
    saveFile: (
      suggestedName?: string,
      defaultDir?: string,
    ): Promise<{ canceled: true } | { canceled: false; path: string }> =>
      ipcRenderer.invoke('dialog:saveFile', suggestedName, defaultDir),
  },

  /** Utility: home directory pra workspace default */
  getCwd: (): Promise<string> => ipcRenderer.invoke('app:getCwd'),

  /** System info — username (os.userInfo()) e platform */
  getSystemInfo: (): Promise<{ username: string; platform: string; homedir: string }> =>
    ipcRenderer.invoke('app:getSystemInfo'),

  /** Path file:// do preload script attachado ao <webview> do PreviewView. */
  getPreviewPreload: (): Promise<string> => ipcRenderer.invoke('app:getPreviewPreload'),

  /** Attach DevTools de um <webview> (target) noutro <webview> (host) — fica
   * embedado como painel à direita ao invés de abrir janela separada. Renderer
   * passa os webContentsId via webview.getWebContentsId(). */
  previewAttachDevtools: (targetId: number, hostId: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('preview:attachDevtools', targetId, hostId),
  previewDetachDevtools: (targetId: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('preview:detachDevtools', targetId),
  /** Subscribe pra evento de fechamento da janela de devtools (quando user clica X).
   * Retorna função de unsubscribe. */
  onPreviewDevtoolsWindowClosed: (cb: (targetId: number) => void): (() => void) => {
    const listener = (_evt: unknown, targetId: number): void => cb(targetId);
    ipcRenderer.on('preview:devtools-window-closed', listener);
    return () => { ipcRenderer.removeListener('preview:devtools-window-closed', listener); };
  },

  /** Emula prefers-color-scheme no webview do preview via CDP nativo.
   * `system` remove a emulação. */
  previewEmulateColorScheme: (targetId: number, scheme: 'light' | 'dark' | 'system'): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('preview:emulateColorScheme', targetId, scheme),

  /** Bloqueia/libera input events no guest webContents via CDP
   * (Input.setIgnoreInputEvents). Usado pra que clicks dentro do webview
   * fechem ContextMenu/popovers abertos no host — o BrowserView nativo come
   * o evento antes do DOM host, então só CDP no nível renderer guest dropa. */
  previewSetIgnoreInput: (targetId: number, ignore: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('preview:setIgnoreInput', targetId, ignore),

  /** === NEW: WebContentsView-based preview (Cursor pattern) === */
  previewView: {
    create: (initialUrl: string, bounds: { x: number; y: number; width: number; height: number }): Promise<{ ok: boolean; viewId?: number; error?: string }> =>
      ipcRenderer.invoke('previewView:create', initialUrl, bounds),
    destroy: (viewId: number): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('previewView:destroy', viewId),
    setBounds: (viewId: number, bounds: { x: number; y: number; width: number; height: number }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('previewView:setBounds', viewId, bounds),
    hide: (viewId: number): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('previewView:hide', viewId),
    show: (viewId: number): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('previewView:show', viewId),
    loadURL: (viewId: number, url: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('previewView:loadURL', viewId, url),
    back: (viewId: number): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('previewView:back', viewId),
    forward: (viewId: number): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('previewView:forward', viewId),
    reload: (viewId: number, ignoreCache?: boolean): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('previewView:reload', viewId, ignoreCache),
    canGoBack: (viewId: number): Promise<{ ok: boolean; canGoBack: boolean }> =>
      ipcRenderer.invoke('previewView:canGoBack', viewId),
    canGoForward: (viewId: number): Promise<{ ok: boolean; canGoForward: boolean }> =>
      ipcRenderer.invoke('previewView:canGoForward', viewId),
    getURL: (viewId: number): Promise<{ ok: boolean; url: string }> =>
      ipcRenderer.invoke('previewView:getURL', viewId),
    executeJavaScript: (viewId: number, code: string, userGesture?: boolean): Promise<{ ok: boolean; result: unknown; error?: string }> =>
      ipcRenderer.invoke('previewView:executeJavaScript', viewId, code, userGesture),
    setZoomFactor: (viewId: number, factor: number): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('previewView:setZoomFactor', viewId, factor),
    getZoomFactor: (viewId: number): Promise<{ ok: boolean; factor: number }> =>
      ipcRenderer.invoke('previewView:getZoomFactor', viewId),
    openDevTools: (viewId: number, mode: 'right' | 'bottom' | 'undocked' | 'detach' = 'right'): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('previewView:openDevTools', viewId, mode),
    closeDevTools: (viewId: number): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('previewView:closeDevTools', viewId),
    isDevToolsOpened: (viewId: number): Promise<{ ok: boolean; isOpen: boolean }> =>
      ipcRenderer.invoke('previewView:isDevToolsOpened', viewId),
    insertCSS: (viewId: number, css: string): Promise<{ ok: boolean; key: string | null; error?: string }> =>
      ipcRenderer.invoke('previewView:insertCSS', viewId, css),
    removeInsertedCSS: (viewId: number, key: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('previewView:removeInsertedCSS', viewId, key),
    getWebContentsId: (viewId: number): Promise<{ ok: boolean; id: number }> =>
      ipcRenderer.invoke('previewView:getWebContentsId', viewId),
    emulateColorScheme: (viewId: number, scheme: 'light' | 'dark' | 'system'): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('previewView:emulateColorScheme', viewId, scheme),
    /** Subscribe a TODOS os eventos de uma view específica. Callback recebe channel + args. */
    onEvent: (viewId: number, cb: (channel: string, ...args: unknown[]) => void): (() => void) => {
      const channels = [
        'previewView:event:loading-start',
        'previewView:event:loading-stop',
        'previewView:event:dom-ready',
        'previewView:event:did-navigate',
        'previewView:event:did-navigate-in-page',
        'previewView:event:page-title-updated',
        'previewView:event:did-fail-load',
        'previewView:event:devtools-opened',
        'previewView:event:devtools-closed',
      ];
      const listener = (channel: string) => (_evt: unknown, vId: number, ...args: unknown[]): void => {
        if (vId === viewId) cb(channel, ...args);
      };
      const wrapped = channels.map((ch) => {
        const l = listener(ch);
        ipcRenderer.on(ch, l);
        return { ch, l };
      });
      return () => {
        for (const { ch, l } of wrapped) ipcRenderer.removeListener(ch, l);
      };
    },
  },

  /** Clipboard API nativa do Electron — não depende de focus do documento.
   * `navigator.clipboard.writeText()` falha silenciosamente quando context
   * menu fecha (perde focus). Esta API funciona sempre. */
  clipboard: {
    writeText: (text: string): void => clipboard.writeText(text),
    readText: (): string => clipboard.readText(),
  },

  /** Auth do Claude CLI — detecta OAuth (~/.claude/.credentials.json) ou ANTHROPIC_API_KEY env */
  auth: {
    getStatus: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:getStatus'),
    login: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('auth:login'),
    /** canceled = user clicou Cancelar no dialog nativo de confirmacao do main. */
    logout: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('auth:logout'),
  },

  /** System metrics — RAM/CPU do app (statusbar memory monitor widget) */
  system: {
    getMetrics: (): Promise<{ rssMb: number; cpuPercent: number; processes: number }> =>
      ipcRenderer.invoke('system:metrics'),
  },

  /** Abre URL externa no browser padrao do sistema (via shell.openExternal) */
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),

  /** Window controls (custom titlebar) */
  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    maximize: (): void => ipcRenderer.send('window:maximize'),
    close: (): void => ipcRenderer.send('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    /** Abre uma nova janela do UNDRCOD (multi-window). Cada janela tem state isolado. */
    openNew: (): Promise<{ ok: true; count: number; id: number }> =>
      ipcRenderer.invoke('window:openNew'),
    /** Abre janela em modo Agent Manager (chat-only, sem editor/files).
     *  Equivalente ao "Open Agent Manager" do Antigravity/Cursor. */
    openAgentManager: (): Promise<{ ok: true; count: number; id: number }> =>
      ipcRenderer.invoke('window:openAgentManager'),
    /** Toggle fullscreen da janela atual (F11). */
    toggleFullScreen: (): void => ipcRenderer.send('window:toggleFullScreen'),
    isFullScreen: (): Promise<boolean> => ipcRenderer.invoke('window:isFullScreen'),
    /** Zoom controls — Ctrl+= / Ctrl+- / Ctrl+0. */
    zoomIn: (): void => ipcRenderer.send('window:zoomIn'),
    zoomOut: (): void => ipcRenderer.send('window:zoomOut'),
    zoomReset: (): void => ipcRenderer.send('window:zoomReset'),
    /** Toggle DevTools (F12 / Ctrl+Shift+I). */
    toggleDevTools: (): void => ipcRenderer.send('window:toggleDevTools'),
    onMaximizedChange: (cb: (maximized: boolean) => void): (() => void) => {
      const handler = (_: unknown, maximized: boolean) => cb(maximized);
      ipcRenderer.on('window:maximized', handler);
      return () => ipcRenderer.removeListener('window:maximized', handler);
    }
  },

  /**
   * Native menu (File/Edit/Selection/View/Go/Run/Terminal/Help) — main process
   * dispara IPC `menu:<action>` quando user clica num item. Renderer assina UMA
   * vez via onAction; o callback recebe o action string ("settings",
   * "openFolder", etc) sem o prefixo "menu:". Retorna função pra unsubscribe
   * (use no cleanup do useEffect). Lista de canais espelha menu.ts no main.
   */
  menu: {
    onAction: (cb: (action: string) => void): (() => void) => {
      const channels = [
        // File
        'menu:newFile',
        'menu:newWindow',
        'menu:openFolder',
        'menu:openRecent',
        'menu:save',
        'menu:saveAll',
        'menu:settings',
        'menu:reloadWindow',
        'menu:exit',
        // Edit
        'menu:editorUndo',
        'menu:editorRedo',
        'menu:editorFind',
        'menu:editorReplace',
        'menu:editorCommentLine',
        'menu:editorCommentBlock',
        'menu:find',
        'menu:findInFiles',
        'menu:replaceInFiles',
        // Selection
        'menu:editorSelectAll',
        'menu:editorExpandSelection',
        'menu:editorShrinkSelection',
        'menu:editorCopyLineUp',
        'menu:editorCopyLineDown',
        'menu:editorMoveLineUp',
        'menu:editorMoveLineDown',
        'menu:editorDuplicateSelection',
        'menu:editorCursorAbove',
        'menu:editorCursorBelow',
        'menu:editorCursorsLineEnds',
        'menu:editorAddNextOccurrence',
        'menu:editorAddPrevOccurrence',
        'menu:editorSelectAllOccurrences',
        'menu:editorToggleColumnSelection',
        // View
        'menu:palette',
        'menu:quickOpen',
        'menu:toggleSidebar',
        'menu:togglePanel',
        'menu:toggleChat',
        'menu:togglePreview',
        // Go
        'menu:goToSymbol',
        'menu:switchWorkspace',
        // Run
        'menu:runTasks',
        'menu:viewOutput',
        'menu:viewProblems',
        // Terminal
        'menu:newTerminal',
        'menu:viewPorts',
        // Help
        'menu:shortcuts',
        'menu:welcomeTour',
        'menu:about',
      ];
      const handlers: Array<{ channel: string; handler: (...args: unknown[]) => void }> = [];
      channels.forEach((ch) => {
        const handler = (): void => cb(ch.replace('menu:', ''));
        ipcRenderer.on(ch, handler);
        handlers.push({ channel: ch, handler });
      });
      return () => handlers.forEach(({ channel, handler }) => ipcRenderer.removeListener(channel, handler));
    },
  },

  /** User settings persistidas em electron-store */
  settings: {
    get: <K extends keyof UndrSettings>(key: K): Promise<UndrSettings[K] | undefined> =>
      ipcRenderer.invoke('settings:get', key),

    all: (): Promise<UndrSettings | null> => ipcRenderer.invoke('settings:all'),

    set: <K extends keyof UndrSettings>(
      key: K,
      value: UndrSettings[K],
    ): Promise<{ ok: true; value: UndrSettings[K] } | { ok: false; error: string }> =>
      ipcRenderer.invoke('settings:set', key, value),

    /** Reseta uma key (se dada) ou todas as settings (se omitida) pros defaults. */
    reset: (
      key?: keyof UndrSettings,
    ): Promise<
      | { ok: true; value?: UndrSettings[keyof UndrSettings]; snapshot?: UndrSettings }
      | { ok: false; error: string }
    > => ipcRenderer.invoke('settings:reset', key),

    /**
     * Lê settings.json do VS Code (Win/Linux/Mac) e mapeia as keys equivalentes
     * pro schema UNDRCOD. Retorna { ok, imported } sem aplicar — caller decide
     * quando chamar set() em cada key. Aceita comments e trailing commas no JSON.
     */
    importFromVSCode: (): Promise<
      | { ok: true; source: string; imported: Partial<UndrSettings> }
      | { ok: false; error: string }
    > => ipcRenderer.invoke('settings:importFromVSCode'),

    /** Eventos broadcast pelo main quando uma setting muda. */
    onChanged: <K extends keyof UndrSettings>(
      cb: (key: K, value: UndrSettings[K]) => void,
    ): (() => void) => {
      const handler = (_: unknown, key: K, value: UndrSettings[K]) => cb(key, value);
      ipcRenderer.on('settings:changed', handler);
      return () => ipcRenderer.removeListener('settings:changed', handler);
    },

    /** Evento broadcast pelo main quando todas settings são resetadas. */
    onResetAll: (cb: (snapshot: UndrSettings) => void): (() => void) => {
      const handler = (_: unknown, snapshot: UndrSettings) => cb(snapshot);
      ipcRenderer.on('settings:reset-all', handler);
      return () => ipcRenderer.removeListener('settings:reset-all', handler);
    },
  },

  /**
   * CLI bridge. O binário `undrcode` envia comandos ao main process via
   * named pipe / UDS, e o main forwarda como evento `cli:command`. Renderer
   * escuta aqui pra abrir arquivos, diffs, etc.
   */
  cli: {
    onCommand: (
      cb: (
        cmd:
          | { kind: 'open'; path: string }
          | { kind: 'goto'; path: string; line: number; col?: number }
          | { kind: 'diff'; left: string; right: string }
          | { kind: 'focus' },
      ) => void,
    ): (() => void) => {
      const handler = (_: unknown, cmd: Parameters<typeof cb>[0]) => cb(cmd);
      ipcRenderer.on('cli:command', handler);
      return () => ipcRenderer.removeListener('cli:command', handler);
    },
  },
};

export type UNDRCODAPI = typeof api;

contextBridge.exposeInMainWorld('undrcodAPI', api);

// Intercepta console.* do renderer e empurra pro buffer "Renderer" do Output panel.
// Mantem comportamento original (chrome devtools continua recebendo).
{
  const fmt = (args: unknown[]): string =>
    args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.stack ?? a.message;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');

  const origLog = console.log.bind(console);
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: unknown[]) => {
    try { ipcRenderer.send('output:renderer-log', 'info', fmt(args)); } catch { /* noop */ }
    origLog(...args);
  };
  console.info = (...args: unknown[]) => {
    try { ipcRenderer.send('output:renderer-log', 'info', fmt(args)); } catch { /* noop */ }
    origInfo(...args);
  };
  console.warn = (...args: unknown[]) => {
    try { ipcRenderer.send('output:renderer-log', 'warn', fmt(args)); } catch { /* noop */ }
    origWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    try { ipcRenderer.send('output:renderer-log', 'error', fmt(args)); } catch { /* noop */ }
    origError(...args);
  };
}
