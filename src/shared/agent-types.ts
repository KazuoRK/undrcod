/**
 * Tipos de eventos do agent (subset do output stream-json do Claude CLI).
 * Renderer só conhece ESSES tipos — main filtra e mapeia.
 */

export type AgentEvent =
  | {
      type: 'session_init';
      sessionId: string;
      model: string;
      tools: string[];
      cwd: string;
      /** Slash commands disponiveis (builtin + plugins). Formato: "init", "review", "agent-sdk-dev:new-sdk-app". */
      slashCommands?: string[];
      /** Agents do CLI + plugins. Formato: "Explore", "agent-sdk-dev:agent-sdk-verifier-py". */
      agents?: string[];
      /** Skills carregadas. Formato: "frontend-design", "agent-sdk-dev:new-sdk-app". */
      skills?: string[];
      /** Plugins instalados nessa sessão. */
      plugins?: Array<{ name: string; path: string; source: string }>;
      /** MCP servers ativos (informativo). */
      mcpServers?: Array<{ name: string; status?: string }>;
    }
  | { type: 'turn_start'; sessionId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; toolUseId: string; name: string; index: number }
  | { type: 'tool_use_input_delta'; toolUseId: string; partial: string }
  | { type: 'tool_use_end'; toolUseId: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; result: string; isError: boolean }
  | { type: 'thinking_delta'; text: string }
  | { type: 'turn_complete'; sessionId: string; costUsd?: number; usage?: TokenUsage; stopReason?: string }
  | { type: 'error'; message: string }
  /**
   * Sessao Claude expirou — CLI retornou 401 (authentication_failed).
   * Renderer mostra prompt "Entrar de novo" e oferece dispatch do login flow.
   * status: HTTP status reportado pelo CLI (sempre 401 no caso desse evento).
   */
  | { type: 'auth_expired'; status?: number; message?: string }
  /**
   * Rate limit do plano (429). Plano Max tem janelas de 5h — quando esgotada,
   * UI mostra mensagem dedicada sugerindo aguardar reset ou trocar de modelo.
   */
  | { type: 'rate_limited'; status?: number; message?: string }
  | { type: 'status'; status: string };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface AgentSession {
  sessionId: string;
  cwd: string;
  model: string;
  createdAt: number;
}

/**
 * Eventos historicos extraidos do .jsonl de uma sessão salva.
 * Forma simplificada pro renderer reproduzir o transcript sem reprocessar o stream do CLI.
 * Ordem: cronologica (mesma ordem que aparece no jsonl).
 */
export type HistoryEvent =
  | { kind: 'user'; text: string; timestamp: string }
  | { kind: 'assistant_text'; text: string; timestamp: string }
  | {
      kind: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
      timestamp: string;
    }
  | {
      kind: 'tool_result';
      toolUseId: string;
      result: string;
      isError: boolean;
      timestamp: string;
    }
  | { kind: 'thinking'; text: string; timestamp: string };

export interface SessionHistory {
  sessionId: string;
  events: HistoryEvent[];
  messageCount: number;
  /**
   * Total de eventos disponíveis no .jsonl (independente do quanto foi retornado).
   * Quando lazy-load tá ativo (limit/offset), `events.length` pode ser menor.
   * Renderer compara `events.length` vs `totalEvents` pra decidir se mostra
   * o banner "Carregar mensagens anteriores".
   */
  totalEvents?: number;
  /** Offset (0-based, do início do .jsonl) do primeiro event retornado. */
  returnedOffset?: number;
}

/** Opções pra carregar slice da história (lazy/paginated load). */
export interface ReadSessionHistoryOptions {
  /** Quantos eventos retornar. Sem limit = todos. */
  limit?: number;
  /** Offset absoluto (do início do jsonl). Ignora se fromEnd=true. */
  offset?: number;
  /** Se true, conta a partir do fim (últimos `limit` eventos). Default false. */
  fromEnd?: boolean;
}
