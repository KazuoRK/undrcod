/**
 * mcp-catalog — dataset hardcoded de MCP servers populares pra UI de
 * 1-click install (paridade com Windsurf/Cursor catalog).
 *
 * Cada entry foi VALIDADA contra npm/pypi/github oficial em 2026-05.
 * Quando o pacote não existe ou não e claro qual o canonico, preferi
 * dropar a inventar — qualidade > quantidade.
 *
 * Pacotes archived (gitlab, postgres, slack, gdrive, puppeteer, etc.)
 * ainda funcionam via npx mas não recebem updates desde 2025; estão
 * marcados com `official: false` (foram movidos pra servers-archived)
 * exceto onde o vendor original ainda mantem ativamente.
 *
 * Transport: stdio em tudo. Servers remotos (http/sse) requerem auth
 * separada e não tao no escopo deste catalogo inicial.
 *
 * Categoria: usado pelo McpManager pra agrupar/filtrar no catalogo.
 *
 * Nada aqui faz IO nem throw — listMcpCatalog e helpers retornam
 * sempre dados defensivos.
 */

export interface McpCatalogAuthField {
  /** Nome da env var (ou flag) — ex: "GITHUB_PERSONAL_ACCESS_TOKEN" */
  name: string;
  /** Label humano pra UI — ex: "Personal Access Token" */
  label: string;
  /** Tipo do input no form */
  type: 'password' | 'text' | 'url';
  /** Se a UI deve bloquear submit sem esse campo */
  required: boolean;
  /** Hint curto exibido abaixo do input */
  help?: string;
}

export interface McpCatalogEntry {
  /** Slug interno (usado como name por default). Ex: "github", "filesystem" */
  id: string;
  /** Nome amigavel pra UI. Ex: "GitHub", "Filesystem" */
  displayName: string;
  /** Descricao 1-2 frases */
  description: string;
  /** Categoria pra agrupar/filtrar */
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
  /** Comando do CLI (geralmente "npx" ou "uvx") */
  command: string;
  /** Args do comando, já com -y se aplicavel */
  args: string[];
  /**
   * Auth fields necessarios — se vazio, o MCP não precisa de credenciais.
   * UI usa esses fields pra montar form estruturado (input password etc).
   */
  authFields: McpCatalogAuthField[];
  /** Tipo de transport — informativo, todos do catalog inicial são stdio */
  transport: 'stdio' | 'http' | 'sse';
  /** Se e mantido oficialmente pelo fabricante (badge azul) */
  official: boolean;
  /** Mantido pelo vendor principal — ex: "Anthropic", "GitHub", "Slack" */
  vendor?: string;
  /** URL pra docs */
  homepage?: string;
  /** Slug pra logo (simple-icons) — opcional, frontend tem fallback */
  iconSlug?: string;
  /** Termos de busca extra (alem do nome) */
  keywords?: string[];
}

/**
 * Catalogo curado — 19 servers populares cobrindo as principais categorias.
 *
 * Notes sobre escolhas:
 *  - filesystem: requer pelo menos UM path; deixamos placeholder "/path/to/dir"
 *    que UI substitui antes de salvar.
 *  - github: archived em maio/2025 mas npx ainda funciona; oficial moderno e
 *    HTTP remoto (api.githubcopilot.com) que requer fluxo de OAuth/PAT diferente.
 *    Stdio archived ainda e a opção de menor friccao pra 1-click install.
 *  - sqlite: NAO existe @modelcontextprotocol/server-sqlite no npm.
 *    Anthropic publica via PyPI (mcp-server-sqlite) — usamos uvx.
 *  - fetch: idem sqlite — só existe via PyPI/uvx.
 *  - time: idem.
 *  - brave-search: usamos o @brave/brave-search-mcp-server moderno
 *    (mantido pela Brave) em vez do archived @modelcontextprotocol/server-brave-search.
 *  - notion: env var oficial e NOTION_TOKEN (NAO NOTION_API_KEY como o brief sugeria).
 *  - stripe: requer --tools=all + STRIPE_SECRET_KEY via env (alternativa: --api-key arg).
 *  - sentry: env var oficial e SENTRY_ACCESS_TOKEN (NAO SENTRY_AUTH_TOKEN como
 *    o brief sugeria — esse e em forks third-party).
 *  - figma: não incluido. Não existe pacote npm oficial @figma/mcp; oficial e
 *    remote HTTP server (mcp.figma.com) fora do escopo stdio. Incluir
 *    figma-developer-mcp third-party seria enganoso.
 */
export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: 'filesystem',
    displayName: 'Filesystem',
    description:
      'Read and write local files in directories you allow. Reference server mantido pela Anthropic.',
    category: 'storage',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/dir'],
    authFields: [],
    transport: 'stdio',
    official: true,
    vendor: 'Anthropic',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    keywords: ['files', 'fs', 'disk', 'read', 'write', 'directory'],
  },
  {
    id: 'github',
    displayName: 'GitHub',
    description:
      'Repository management, file operations, PRs and issues via GitHub REST API. Use Personal Access Token.',
    category: 'devtools',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    authFields: [
      {
        name: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'Personal Access Token',
        type: 'password',
        required: true,
        help: 'Crie em github.com/settings/tokens — escopos repo + read:user costumam bastar.',
      },
    ],
    transport: 'stdio',
    official: false,
    vendor: 'GitHub',
    homepage: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/github',
    iconSlug: 'github',
    keywords: ['git', 'pr', 'issues', 'repos', 'octocat'],
  },
  {
    id: 'gitlab',
    displayName: 'GitLab',
    description:
      'GitLab API access — projects, merge requests, files. Suporta self-hosted via GITLAB_API_URL.',
    category: 'devtools',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gitlab'],
    authFields: [
      {
        name: 'GITLAB_PERSONAL_ACCESS_TOKEN',
        label: 'Personal Access Token',
        type: 'password',
        required: true,
        help: 'GitLab > User Settings > Access Tokens. Escopo api recomendado.',
      },
      {
        name: 'GITLAB_API_URL',
        label: 'GitLab API URL',
        type: 'url',
        required: false,
        help: 'Default https://gitlab.com/api/v4 — mude se for self-hosted.',
      },
    ],
    transport: 'stdio',
    official: false,
    vendor: 'GitLab',
    homepage: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/gitlab',
    iconSlug: 'gitlab',
    keywords: ['git', 'mr', 'merge request', 'pipelines'],
  },
  {
    id: 'postgres',
    displayName: 'PostgreSQL',
    description:
      'Read-only acesso ao Postgres — inspecionar schema e rodar queries SELECT. Connection string como arg.',
    category: 'database',
    command: 'npx',
    args: [
      '-y',
      '@modelcontextprotocol/server-postgres',
      'postgresql://user:password@localhost:5432/database',
    ],
    authFields: [],
    transport: 'stdio',
    official: false,
    vendor: 'Anthropic',
    homepage: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/postgres',
    iconSlug: 'postgresql',
    keywords: ['db', 'sql', 'database', 'postgresql', 'psql'],
  },
  {
    id: 'sqlite',
    displayName: 'SQLite',
    description:
      'Read/write em SQLite local. Caminho do .db via --db-path. Distribuido como Python package via uvx.',
    category: 'database',
    command: 'uvx',
    args: ['mcp-server-sqlite', '--db-path', '/path/to/database.db'],
    authFields: [],
    transport: 'stdio',
    official: true,
    vendor: 'Anthropic',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
    iconSlug: 'sqlite',
    keywords: ['db', 'sql', 'database', 'embedded'],
  },
  {
    id: 'slack',
    displayName: 'Slack',
    description:
      'Postar mensagens, ler canais e usuários via Slack Web API. Precisa de Bot Token (xoxb-).',
    category: 'communication',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    authFields: [
      {
        name: 'SLACK_BOT_TOKEN',
        label: 'Bot Token',
        type: 'password',
        required: true,
        help: 'Token comeca com xoxb-. Crie um Slack app e instale no workspace.',
      },
      {
        name: 'SLACK_TEAM_ID',
        label: 'Team ID',
        type: 'text',
        required: true,
        help: 'ID do workspace (comeca com T). Veja em api.slack.com/methods/team.info.',
      },
    ],
    transport: 'stdio',
    official: false,
    vendor: 'Slack',
    homepage: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/slack',
    iconSlug: 'slack',
    keywords: ['chat', 'message', 'channel', 'team'],
  },
  {
    id: 'google-drive',
    displayName: 'Google Drive',
    description: 'Listar e ler arquivos do Drive (Docs, Sheets, PDFs). Usa OAuth credentials JSON.',
    category: 'storage',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gdrive'],
    authFields: [
      {
        name: 'GDRIVE_CREDENTIALS_PATH',
        label: 'Credentials JSON path',
        type: 'text',
        required: true,
        help: 'Path absoluto pro .gdrive-server-credentials.json (gerado pelo fluxo auth).',
      },
    ],
    transport: 'stdio',
    official: false,
    vendor: 'Anthropic',
    homepage: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/gdrive',
    iconSlug: 'googledrive',
    keywords: ['gdrive', 'docs', 'sheets', 'google'],
  },
  {
    id: 'fetch',
    displayName: 'Fetch',
    description:
      'Fetch HTTP simples — baixa URL e retorna conteudo (markdown auto). Python via uvx.',
    category: 'web',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    authFields: [],
    transport: 'stdio',
    official: true,
    vendor: 'Anthropic',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    keywords: ['http', 'url', 'web', 'scrape', 'request'],
  },
  {
    id: 'brave-search',
    displayName: 'Brave Search',
    description:
      'Web search via Brave Search API — web, local, images, videos, news. Free tier 2k queries/mes.',
    category: 'web',
    command: 'npx',
    args: ['-y', '@brave/brave-search-mcp-server'],
    authFields: [
      {
        name: 'BRAVE_API_KEY',
        label: 'API Key',
        type: 'password',
        required: true,
        help: 'Pegue em brave.com/search/api — tier free e suficiente pra teste.',
      },
    ],
    transport: 'stdio',
    official: true,
    vendor: 'Brave',
    homepage: 'https://github.com/brave/brave-search-mcp-server',
    iconSlug: 'brave',
    keywords: ['search', 'web', 'google', 'serp'],
  },
  {
    id: 'puppeteer',
    displayName: 'Puppeteer',
    description:
      'Browser automation com Puppeteer — navegar, screenshot, JS eval em páginas. Sem auth.',
    category: 'automation',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    authFields: [],
    transport: 'stdio',
    official: false,
    vendor: 'Anthropic',
    homepage: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/puppeteer',
    keywords: ['browser', 'scrape', 'screenshot', 'headless', 'chrome'],
  },
  {
    id: 'memory',
    displayName: 'Memory',
    description: 'Knowledge graph persistente pra agente lembrar entre sessões. Sem auth.',
    category: 'productivity',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    authFields: [
      {
        name: 'MEMORY_FILE_PATH',
        label: 'Memory file path',
        type: 'text',
        required: false,
        help: 'Path do .jsonl que persiste o knowledge graph. Default: memory.jsonl ao lado do server.',
      },
    ],
    transport: 'stdio',
    official: true,
    vendor: 'Anthropic',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    keywords: ['knowledge', 'graph', 'persist', 'context'],
  },
  {
    id: 'time',
    displayName: 'Time',
    description: 'Time e timezone conversions — útil pra agendamento, fuso, formato ISO. Sem auth.',
    category: 'productivity',
    command: 'uvx',
    args: ['mcp-server-time'],
    authFields: [],
    transport: 'stdio',
    official: true,
    vendor: 'Anthropic',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
    keywords: ['clock', 'date', 'timezone', 'tz', 'now'],
  },
  {
    id: 'sequentialthinking',
    displayName: 'Sequential Thinking',
    description:
      'Helper pra reasoning estruturado em multiplas etapas — prompt scaffolding pra problemas complexos.',
    category: 'productivity',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    authFields: [],
    transport: 'stdio',
    official: true,
    vendor: 'Anthropic',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    keywords: ['reasoning', 'chain of thought', 'cot', 'think', 'plan'],
  },
  {
    id: 'playwright',
    displayName: 'Playwright',
    description:
      'Browser automation moderno via Playwright — Chromium/Firefox/WebKit. Mantido pela Microsoft.',
    category: 'automation',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    authFields: [],
    transport: 'stdio',
    official: true,
    vendor: 'Microsoft',
    homepage: 'https://github.com/microsoft/playwright-mcp',
    iconSlug: 'playwright',
    keywords: ['browser', 'e2e', 'testing', 'automation', 'chromium', 'webkit'],
  },
  {
    id: 'notion',
    displayName: 'Notion',
    description:
      'Ler/escrever/buscar páginas e databases do Notion. Integration token (não OAuth). Lembre de compartilhar páginas com a integration.',
    category: 'productivity',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    authFields: [
      {
        name: 'NOTION_TOKEN',
        label: 'Integration Token',
        type: 'password',
        required: true,
        help: 'Comeca com ntn_. Crie em notion.só/profile/integrations. Compartilhe páginas com a integration.',
      },
    ],
    transport: 'stdio',
    official: true,
    vendor: 'Notion',
    homepage: 'https://github.com/makenotion/notion-mcp-server',
    iconSlug: 'notion',
    keywords: ['docs', 'database', 'pages', 'wiki'],
  },
  {
    id: 'linear',
    displayName: 'Linear',
    description:
      'Linear issue tracker — listar, criar, atualizar issues e projects via GraphQL API.',
    category: 'productivity',
    command: 'npx',
    args: ['-y', 'linear-mcp-server'],
    authFields: [
      {
        name: 'LINEAR_API_KEY',
        label: 'API Key',
        type: 'password',
        required: true,
        help: 'Linear > Settings > API > Personal API keys > New API key.',
      },
    ],
    transport: 'stdio',
    official: false,
    vendor: 'Linear',
    homepage: 'https://www.npmjs.com/package/linear-mcp-server',
    iconSlug: 'linear',
    keywords: ['issues', 'tickets', 'project management', 'pm', 'agile'],
  },
  {
    id: 'stripe',
    displayName: 'Stripe',
    description:
      'Stripe API — criar customers, products, payment links, subscriptions. Recomendado usar Restricted API Key.',
    category: 'finance',
    command: 'npx',
    args: ['-y', '@stripe/mcp', '--tools=all'],
    authFields: [
      {
        name: 'STRIPE_SECRET_KEY',
        label: 'Secret Key',
        type: 'password',
        required: true,
        help: 'Comeca com sk_test_ ou sk_live_. Use Restricted API Key (rk_) sempre que possível.',
      },
    ],
    transport: 'stdio',
    official: true,
    vendor: 'Stripe',
    homepage: 'https://github.com/stripe/agent-toolkit',
    iconSlug: 'stripe',
    keywords: ['payments', 'billing', 'invoice', 'subscription', 'checkout'],
  },
  {
    id: 'sentry',
    displayName: 'Sentry',
    description:
      'Buscar e analisar issues/events do Sentry. Integration com error tracking. Token via env ou device-code auth.',
    category: 'devtools',
    command: 'npx',
    args: ['-y', '@sentry/mcp-server@latest'],
    authFields: [
      {
        name: 'SENTRY_ACCESS_TOKEN',
        label: 'Access Token',
        type: 'password',
        required: false,
        help: 'Opcional — se vazio, o server abre browser pra device-code auth. Crie em sentry.io/settings/account/api/auth-tokens.',
      },
    ],
    transport: 'stdio',
    official: true,
    vendor: 'Sentry',
    homepage: 'https://github.com/getsentry/sentry-mcp',
    iconSlug: 'sentry',
    keywords: ['errors', 'monitoring', 'crashes', 'apm', 'observability'],
  },
  {
    id: 'everything',
    displayName: 'Everything (Reference)',
    description:
      'Reference server da Anthropic — exercita TODA feature do MCP protocol (prompts, tools, resources, sampling). Util pra testar clients.',
    category: 'devtools',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    authFields: [],
    transport: 'stdio',
    official: true,
    vendor: 'Anthropic',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everything',
    keywords: ['test', 'reference', 'demo', 'debug', 'example'],
  },
];

/**
 * Lista o catalogo inteiro. Async pra deixar room pra fetch de remote
 * catalog no futuro sem mudar superficie da API.
 *
 * Nunca throw — em qualquer erro inesperado, retorna [].
 */
export async function listMcpCatalog(): Promise<McpCatalogEntry[]> {
  try {
    // Clone defensivo — main → IPC serializa de qualquer jeito, mas
    // garantir que renderer não pega referência compartilhada.
    return MCP_CATALOG.map((entry) => ({
      ...entry,
      args: [...entry.args],
      authFields: entry.authFields.map((f) => ({ ...f })),
      keywords: entry.keywords ? [...entry.keywords] : undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Lookup por id. Retorna null (nunca throw) se não encontrar.
 */
export function getMcpCatalogEntry(id: string): McpCatalogEntry | null {
  try {
    if (!id || typeof id !== 'string') return null;
    const found = MCP_CATALOG.find((e) => e.id === id);
    if (!found) return null;
    return {
      ...found,
      args: [...found.args],
      authFields: found.authFields.map((f) => ({ ...f })),
      keywords: found.keywords ? [...found.keywords] : undefined,
    };
  } catch {
    return null;
  }
}
