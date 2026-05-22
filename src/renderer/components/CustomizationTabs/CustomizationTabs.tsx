/**
 * CustomizationTabs — modal pra inventariar tudo que o usuário customizou
 * pro Claude na pasta .claude/. 5 tabs:
 *
 *   - Rules     — CLAUDE.md / UNDERCODE.md (workspace + user + plugins)
 *   - Workflows — slash commands custom (.claude/commands/*.md)
 *   - Skills    — agent skills com nome/descrição/version (.claude/skills/*)
 *   - Hooks     — settings.json hooks (event matchers + commands)
 *   - MCP       — servers MCP configurados (reusa window.undrcodAPI?.mcp.list)
 *
 * IPC: window.undrcodAPI?.customization.summary(cwd) -> { rules, skills, workflows, agents, hooks }
 *
 * Defensive: se a API ainda não existe no preload (build antigo), mostra
 * "Funcionalidade indisponível — reinicie o app".
 *
 * Esc:
 *   1. fecha sub-menu/feedback se houver
 *   2. limpa search se preenchida
 *   3. fecha modal
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './CustomizationTabs.css';

// ============================================================================
// Tipos — mirror do backend (ainda não implementado, mas API contract definido)
// ============================================================================

type Scope = 'workspace' | 'user' | 'plugin';

interface Rule {
  scope: Scope;
  path: string;
  filename: string;
  preview: string;
  bytes: number;
  mtime: number;
  pluginName?: string;
}

interface Skill {
  scope: Scope;
  name: string;
  description?: string;
  version?: string;
  userInvocable?: boolean;
  argumentHint?: string;
  path: string;
  pluginName?: string;
}

interface Workflow {
  scope: Scope;
  name: string;
  description?: string;
  path: string;
  pluginName?: string;
}

interface Agent {
  scope: Scope;
  name: string;
  description?: string;
  model?: string;
  tools?: string[];
  path: string;
  pluginName?: string;
}

interface HookEntry {
  scope: Scope;
  event: string;
  matcher: string;
  command: string;
  type: string;
  timeout?: number;
  sourceSettings: string;
  pluginName?: string;
}

interface CustomizationSummary {
  rules: Rule[];
  skills: Skill[];
  workflows: Workflow[];
  agents: Agent[];
  hooks: HookEntry[];
}

interface CustomizationAPI {
  summary?: (cwd: string) => Promise<CustomizationSummary>;
}

// McpServer — mesma shape que window.undrcodAPI?.mcp.list retorna. Aqui o scope
// inclui 'project' (terceira opção do CLI), que tratamos visualmente como 'user'.
interface McpServerEntry {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  status: 'configured' | 'unknown';
  scope: 'workspace' | 'user' | 'project';
  type?: string;
  sourcePath: string;
}

// ============================================================================
// Props
// ============================================================================

type TabId = 'rules' | 'workflows' | 'skills' | 'hooks' | 'mcp';

interface CustomizationTabsProps {
  open: boolean;
  cwd: string;
  onClose: () => void;
  /** Callback pra abrir o McpManager modal (botao "Abrir gerenciador" na tab MCP). */
  onOpenMcpManager?: () => void;
}

interface TabSpec {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabSpec[] = [
  { id: 'rules', label: 'Rules', icon: 'book' },
  { id: 'workflows', label: 'Workflows', icon: 'symbol-event' },
  { id: 'skills', label: 'Skills', icon: 'sparkle' },
  { id: 'hooks', label: 'Hooks', icon: 'bell' },
  { id: 'mcp', label: 'MCP', icon: 'plug' },
];

// ============================================================================
// Helpers
// ============================================================================

/** Safe-get da API customization (preload pode estar desatualizado). */
function getCustomizationAPI(): CustomizationAPI | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = window.undrcodAPI?.customization as CustomizationAPI | undefined;
  return api && typeof api.summary === 'function' ? api : null;
}

/** Substitui homedir/cwd no path pra ficar mais legivel (ex: "~/.claude/..."). */
function shortenPath(path: string, cwd: string): string {
  if (!path) return '';
  const normalized = path.replace(/\\/g, '/');
  const normalizedCwd = cwd.replace(/\\/g, '/');
  if (normalizedCwd && normalized.startsWith(normalizedCwd + '/')) {
    return '.' + normalized.slice(normalizedCwd.length);
  }
  // Tenta detectar home (Windows: C:/Users/foo/, Unix: /home/foo/).
  const homeMatch = normalized.match(/^([A-Za-z]:\/Users\/[^/]+|\/Users\/[^/]+|\/home\/[^/]+)(\/.*)?$/);
  if (homeMatch && homeMatch[2]) {
    return '~' + homeMatch[2];
  }
  return normalized;
}

/** Trunca middle pra path muito longos (ex: ".claude/plugins/.../foo.md"). */
function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor((max - 3) / 2);
  return text.slice(0, half) + '...' + text.slice(-half);
}

/** Formata mtime relativa em pt-BR. */
function relativeTime(mtime: number): string {
  if (!mtime) return '';
  const ms = mtime > 1e12 ? mtime : mtime * 1000;
  const diff = Date.now() - ms;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'agora mesmo';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `há ${weeks} ${weeks === 1 ? 'semana' : 'semanas'}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `há ${months} ${months === 1 ? 'mês' : 'meses'}`;
  const years = Math.floor(days / 365);
  return `há ${years} ${years === 1 ? 'ano' : 'anos'}`;
}

/** Mapeia scope CLI MCP ('project') pra visual ('user'). */
function mcpScopeForBadge(s: McpServerEntry['scope']): Scope {
  if (s === 'project') return 'user';
  return s;
}

/** Lowercase substring match em todos os campos textuais. */
function matchesQuery(query: string, ...fields: Array<string | undefined>): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  for (const f of fields) {
    if (f && f.toLowerCase().includes(q)) return true;
  }
  return false;
}

/** Abre external URL via electron shell. */
function openExternal(url: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = window.undrcodAPI?.openExternal;
  if (typeof fn === 'function') fn(url);
}

// ============================================================================
// Component
// ============================================================================

export function CustomizationTabs({ open, cwd, onClose, onOpenMcpManager }: CustomizationTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('rules');
  const [summary, setSummary] = useState<CustomizationSummary | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [search, setSearch] = useState('');
  const [copiedWorkflow, setCopiedWorkflow] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // --------------------------------------------------------------------------
  // Detecta disponibilidade da API ao abrir
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    const api = getCustomizationAPI();
    setAvailable(api !== null);
  }, [open]);

  // --------------------------------------------------------------------------
  // Carrega summary + MCP servers ao abrir
  // --------------------------------------------------------------------------
  const refresh = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    try {
      const api = getCustomizationAPI();
      if (api?.summary) {
        try {
          const data = await api.summary(cwd);
          setSummary(data);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[CustomizationTabs] summary falhou:', err);
          setSummary({ rules: [], skills: [], workflows: [], agents: [], hooks: [] });
        }
      } else {
        setSummary({ rules: [], skills: [], workflows: [], agents: [], hooks: [] });
      }

      // MCP reusa API existente
      const mcpList = window.undrcodAPI?.mcp?.list;
      if (typeof mcpList === 'function') {
        try {
          const rows = await mcpList(cwd);
          setMcpServers(rows);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[CustomizationTabs] mcp.list falhou:', err);
          setMcpServers([]);
        }
      } else {
        setMcpServers([]);
      }
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    if (!open || available !== true) return;
    refresh();
  }, [open, available, refresh]);

  // --------------------------------------------------------------------------
  // Esc — 2 níveis: limpa search primeiro, depois fecha modal
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (copiedWorkflow) {
          setCopiedWorkflow(null);
          return;
        }
        if (search) {
          setSearch('');
          return;
        }
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, search, copiedWorkflow]);

  // --------------------------------------------------------------------------
  // Reset state ao fechar
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!open) {
      setSearch('');
      setActiveTab('rules');
      setCopiedWorkflow(null);
      setSummary(null);
      setMcpServers([]);
    }
  }, [open]);

  // Foca search ao abrir (depois do mount-in animation)
  useEffect(() => {
    if (open && available === true) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, available]);

  // --------------------------------------------------------------------------
  // Counts por tab (sem filtro) — pros badges no tab bar
  // --------------------------------------------------------------------------
  const counts = useMemo(
    () => ({
      rules: summary?.rules.length ?? 0,
      workflows: summary?.workflows.length ?? 0,
      skills: summary?.skills.length ?? 0,
      hooks: summary?.hooks.length ?? 0,
      mcp: mcpServers.length,
    }),
    [summary, mcpServers],
  );

  // --------------------------------------------------------------------------
  // Listas filtradas por search (case-insensitive em name/desc/path)
  // --------------------------------------------------------------------------
  const filteredRules = useMemo(
    () =>
      (summary?.rules ?? []).filter((r) =>
        matchesQuery(search, r.filename, r.preview, r.path, r.pluginName),
      ),
    [summary, search],
  );

  const filteredWorkflows = useMemo(
    () =>
      (summary?.workflows ?? []).filter((w) =>
        matchesQuery(search, w.name, w.description, w.path, w.pluginName),
      ),
    [summary, search],
  );

  const filteredSkills = useMemo(
    () =>
      (summary?.skills ?? []).filter((s) =>
        matchesQuery(search, s.name, s.description, s.path, s.pluginName, s.argumentHint),
      ),
    [summary, search],
  );

  const filteredHooks = useMemo(
    () =>
      (summary?.hooks ?? []).filter((h) =>
        matchesQuery(search, h.event, h.matcher, h.command, h.sourceSettings, h.pluginName),
      ),
    [summary, search],
  );

  const filteredMcp = useMemo(
    () =>
      mcpServers.filter((m) =>
        matchesQuery(search, m.name, m.command, m.args.join(' '), m.sourcePath),
      ),
    [mcpServers, search],
  );

  // --------------------------------------------------------------------------
  // Counter na tab ativa (depois do filtro)
  // --------------------------------------------------------------------------
  const filteredCount = useMemo(() => {
    switch (activeTab) {
      case 'rules': return filteredRules.length;
      case 'workflows': return filteredWorkflows.length;
      case 'skills': return filteredSkills.length;
      case 'hooks': return filteredHooks.length;
      case 'mcp': return filteredMcp.length;
    }
  }, [activeTab, filteredRules, filteredWorkflows, filteredSkills, filteredHooks, filteredMcp]);

  // --------------------------------------------------------------------------
  // Action: copy slash command
  // --------------------------------------------------------------------------
  const handleCopyWorkflow = useCallback((name: string) => {
    const text = `/${name}`;
    try {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedWorkflow(name);
        setTimeout(() => {
          setCopiedWorkflow((curr) => (curr === name ? null : curr));
        }, 1600);
      }).catch(() => {/* swallow */});
    } catch {
      // ignore (clipboard API pode estar bloqueada)
    }
  }, []);

  if (!open) return null;

  return (
    <div className="cust-tabs-backdrop" onClick={onClose}>
      <div
        className="cust-tabs-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Customizações"
      >
        {/* ----------------------------------------------------------------
            Header
        ---------------------------------------------------------------- */}
        <div className="cust-tabs-header">
          <div className="cust-tabs-header-top">
            <div className="cust-tabs-title">
              <span>Customizações</span>
              <span className="cust-tabs-title-accent">.claude/</span>
            </div>
            <span className="cust-tabs-cwd" title={cwd}>
              {shortenPath(cwd, cwd)}
            </span>
            <button
              type="button"
              className="cust-tabs-close"
              onClick={onClose}
              title="Fechar (Esc)"
              aria-label="Fechar"
            >
              <i className="codicon codicon-close" />
            </button>
          </div>

          {available !== false && (
            <div className="cust-tabs-search-row">
              <div className="cust-tabs-search">
                <i className="codicon codicon-search cust-tabs-search-icon" />
                <input
                  ref={searchInputRef}
                  type="text"
                  className="cust-tabs-search-input"
                  placeholder={`Pesquisar em ${labelForTab(activeTab).toLowerCase()}...`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Pesquisar"
                />
                {search && (
                  <button
                    type="button"
                    className="cust-tabs-search-clear"
                    onClick={() => setSearch('')}
                    title="Limpar (Esc)"
                    aria-label="Limpar busca"
                  >
                    <i className="codicon codicon-close" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ----------------------------------------------------------------
            Unavailable state — preload sem customization API
        ---------------------------------------------------------------- */}
        {available === false ? (
          <div className="cust-tabs-unavailable">
            <i className="codicon codicon-warning cust-tabs-unavailable-icon" />
            <div className="cust-tabs-unavailable-title">Funcionalidade indisponível</div>
            <div className="cust-tabs-unavailable-msg">
              Reinicie o app pra atualizar o preload e habilitar o painel de customizações.
            </div>
          </div>
        ) : (
          <>
            {/* --------------------------------------------------------
                Tab bar
            -------------------------------------------------------- */}
            <div className="cust-tabs-tabbar" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === t.id}
                  className={`cust-tabs-tab ${activeTab === t.id ? 'is-active' : ''}`}
                  onClick={() => setActiveTab(t.id)}
                >
                  <i className={`codicon codicon-${t.icon} cust-tabs-tab-icon`} />
                  <span>{t.label}</span>
                  <span className="cust-tabs-tab-count">{counts[t.id]}</span>
                </button>
              ))}
              <span className="cust-tabs-tab-spacer" />
              {activeTab === 'mcp' && onOpenMcpManager && (
                <button
                  type="button"
                  className="cust-tabs-tab-action"
                  onClick={onOpenMcpManager}
                  title="Abrir gerenciador completo de MCP"
                >
                  <i className="codicon codicon-settings-gear" />
                  Abrir gerenciador
                </button>
              )}
            </div>

            {/* --------------------------------------------------------
                Body
            -------------------------------------------------------- */}
            <div className="cust-tabs-body" role="tabpanel">
              {loading ? (
                <LoadingSkeleton />
              ) : (
                <TabContent
                  tab={activeTab}
                  cwd={cwd}
                  rules={filteredRules}
                  workflows={filteredWorkflows}
                  skills={filteredSkills}
                  hooks={filteredHooks}
                  mcp={filteredMcp}
                  hasSearch={search.length > 0}
                  copiedWorkflow={copiedWorkflow}
                  onCopyWorkflow={handleCopyWorkflow}
                  onClearSearch={() => setSearch('')}
                  onOpenMcpManager={onOpenMcpManager}
                />
              )}
            </div>

            {/* --------------------------------------------------------
                Footer
            -------------------------------------------------------- */}
            <div className="cust-tabs-footer">
              <span className="cust-tabs-footer-stats">
                {filteredCount} {filteredCount === 1 ? 'item' : 'itens'}
                {search && counts[activeTab] !== filteredCount && (
                  <> de {counts[activeTab]}</>
                )}
                {' em '}
                <strong style={{ color: 'var(--fg-secondary)' }}>{labelForTab(activeTab)}</strong>
              </span>
              <button
                type="button"
                className="cust-tabs-footer-btn"
                onClick={refresh}
                title="Recarregar inventário"
              >
                <i className={`codicon codicon-refresh ${loading ? 'codicon-modifier-spin' : ''}`} />
                Atualizar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Tab content (switch per tab)
// ============================================================================

interface TabContentProps {
  tab: TabId;
  cwd: string;
  rules: Rule[];
  workflows: Workflow[];
  skills: Skill[];
  hooks: HookEntry[];
  mcp: McpServerEntry[];
  hasSearch: boolean;
  copiedWorkflow: string | null;
  onCopyWorkflow: (name: string) => void;
  onClearSearch: () => void;
  onOpenMcpManager?: () => void;
}

function TabContent({
  tab,
  cwd,
  rules,
  workflows,
  skills,
  hooks,
  mcp,
  hasSearch,
  copiedWorkflow,
  onCopyWorkflow,
  onClearSearch,
  onOpenMcpManager,
}: TabContentProps) {
  // ----- Empty state shared logic -----
  const items: number =
    tab === 'rules' ? rules.length :
    tab === 'workflows' ? workflows.length :
    tab === 'skills' ? skills.length :
    tab === 'hooks' ? hooks.length :
    mcp.length;

  if (items === 0) {
    return <EmptyState tab={tab} hasSearch={hasSearch} onClearSearch={onClearSearch} onOpenMcpManager={onOpenMcpManager} />;
  }

  // ----- Render grid per tab -----
  switch (tab) {
    case 'rules':
      return (
        <div className="cust-tabs-grid">
          {rules.map((r) => (
            <RuleCard key={`${r.scope}:${r.path}`} rule={r} cwd={cwd} />
          ))}
        </div>
      );
    case 'workflows':
      return (
        <div className="cust-tabs-grid">
          {workflows.map((w) => (
            <WorkflowCard
              key={`${w.scope}:${w.path}`}
              workflow={w}
              cwd={cwd}
              copied={copiedWorkflow === w.name}
              onCopy={() => onCopyWorkflow(w.name)}
            />
          ))}
        </div>
      );
    case 'skills':
      return (
        <div className="cust-tabs-grid">
          {skills.map((s) => (
            <SkillCard key={`${s.scope}:${s.path}`} skill={s} cwd={cwd} />
          ))}
        </div>
      );
    case 'hooks':
      return (
        <div className="cust-tabs-grid">
          {hooks.map((h, idx) => (
            <HookCard key={`${h.sourceSettings}:${h.event}:${h.matcher}:${idx}`} hook={h} cwd={cwd} />
          ))}
        </div>
      );
    case 'mcp':
      return (
        <div className="cust-tabs-grid">
          {mcp.map((m) => (
            <McpCard key={`${m.scope}:${m.name}`} server={m} cwd={cwd} />
          ))}
        </div>
      );
  }
}

// ============================================================================
// Card components per tab
// ============================================================================

function RuleCard({ rule, cwd }: { rule: Rule; cwd: string }) {
  return (
    <div className="cust-tabs-card">
      <div className="cust-tabs-card-icon">
        <i className="codicon codicon-book" />
      </div>
      <div className="cust-tabs-card-body">
        <div className="cust-tabs-card-header">
          <span className="cust-tabs-card-name" title={rule.filename}>{rule.filename}</span>
          <ScopeBadge scope={rule.scope} pluginName={rule.pluginName} />
        </div>
        {rule.preview && (
          <div className="cust-tabs-card-preview" title={rule.preview}>
            {rule.preview.length > 240 ? rule.preview.slice(0, 240) + '...' : rule.preview}
          </div>
        )}
        <div className="cust-tabs-card-meta">
          <span className="cust-tabs-card-meta-path" title={rule.path}>
            {truncateMiddle(shortenPath(rule.path, cwd), 80)}
          </span>
          {rule.mtime > 0 && (
            <span className="cust-tabs-card-meta-item">
              <i className="codicon codicon-history" />
              {relativeTime(rule.mtime)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkflowCard({
  workflow,
  cwd,
  copied,
  onCopy,
}: {
  workflow: Workflow;
  cwd: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      className="cust-tabs-card is-clickable"
      onClick={onCopy}
      title={`Copiar /${workflow.name}`}
    >
      <div className="cust-tabs-card-icon">
        <i className="codicon codicon-symbol-event" />
      </div>
      <div className="cust-tabs-card-body">
        <div className="cust-tabs-card-header">
          <span className="cust-tabs-card-name">
            <span className="cust-tabs-card-name-slash">/</span>{workflow.name}
          </span>
          <ScopeBadge scope={workflow.scope} pluginName={workflow.pluginName} />
        </div>
        <div
          className={`cust-tabs-card-description ${workflow.description ? '' : 'cust-tabs-card-description-empty'}`}
        >
          {workflow.description || 'Sem descrição'}
        </div>
        <div className="cust-tabs-card-meta">
          <span className="cust-tabs-card-meta-path" title={workflow.path}>
            {truncateMiddle(shortenPath(workflow.path, cwd), 80)}
          </span>
        </div>
      </div>
      <div className="cust-tabs-card-actions">
        {copied ? (
          <span className="cust-tabs-card-feedback" aria-live="polite">
            <i className="codicon codicon-check" />
            Copiado!
          </span>
        ) : (
          <i className="codicon codicon-copy" style={{ color: 'var(--fg-muted)', fontSize: 14 }} />
        )}
      </div>
    </button>
  );
}

function SkillCard({ skill, cwd }: { skill: Skill; cwd: string }) {
  return (
    <div className="cust-tabs-card">
      <div className="cust-tabs-card-icon">
        <i className="codicon codicon-sparkle" />
      </div>
      <div className="cust-tabs-card-body">
        <div className="cust-tabs-card-header">
          <span className="cust-tabs-card-name" title={skill.name}>{skill.name}</span>
          <ScopeBadge scope={skill.scope} pluginName={skill.pluginName} />
          {skill.version && <span className="cust-tabs-version">v{skill.version}</span>}
        </div>
        {skill.description && (
          <div className="cust-tabs-card-description is-3lines" title={skill.description}>
            {skill.description}
          </div>
        )}
        <div className="cust-tabs-card-meta">
          {skill.userInvocable && (
            <span className="cust-tabs-card-meta-item" title="Invocável via slash command">
              <i className="codicon codicon-symbol-event" />
              <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>/{skill.name}</span>
            </span>
          )}
          {skill.argumentHint && (
            <span className="cust-tabs-card-meta-arg" title="Argument hint">
              {skill.argumentHint}
            </span>
          )}
          <span className="cust-tabs-card-meta-path" title={skill.path}>
            {truncateMiddle(shortenPath(skill.path, cwd), 72)}
          </span>
        </div>
      </div>
    </div>
  );
}

function HookCard({ hook, cwd }: { hook: HookEntry; cwd: string }) {
  return (
    <div className="cust-tabs-card">
      <div className="cust-tabs-card-icon">
        <i className="codicon codicon-bell" />
      </div>
      <div className="cust-tabs-card-body">
        <div className="cust-tabs-card-header">
          <span className="cust-tabs-card-event">{hook.event}</span>
          {hook.matcher && hook.matcher !== '*' && (
            <span className="cust-tabs-matcher" title={`Matcher: ${hook.matcher}`}>{hook.matcher}</span>
          )}
        </div>
        <div className="cust-tabs-card-command" title={hook.command}>
          {hook.command}
        </div>
        <div className="cust-tabs-card-meta">
          <ScopeBadge scope={hook.scope} pluginName={hook.pluginName} />
          {hook.type && <span className="cust-tabs-card-meta-arg">{hook.type}</span>}
          {typeof hook.timeout === 'number' && (
            <span className="cust-tabs-card-meta-item" title="Timeout em segundos">
              <i className="codicon codicon-watch" />
              {hook.timeout}s
            </span>
          )}
          <span className="cust-tabs-card-meta-path" title={hook.sourceSettings}>
            {truncateMiddle(shortenPath(hook.sourceSettings, cwd), 72)}
          </span>
        </div>
      </div>
    </div>
  );
}

function McpCard({ server, cwd }: { server: McpServerEntry; cwd: string }) {
  const statusKind: 'enabled' | 'disabled' | 'unknown' =
    server.status === 'unknown' ? 'unknown' : (server.enabled ? 'enabled' : 'disabled');
  const statusLabel = statusKind === 'enabled' ? 'ativo' : statusKind === 'disabled' ? 'desligado' : 'desconhecido';
  const cmdLine = [server.command, ...server.args].join(' ').trim();
  const typeLabel = server.type || (cmdLine ? 'stdio' : 'http');

  return (
    <div className="cust-tabs-card">
      <div className="cust-tabs-card-icon">
        <i className="codicon codicon-plug" />
      </div>
      <div className="cust-tabs-card-body">
        <div className="cust-tabs-card-header">
          <span className="cust-tabs-card-name" title={server.name}>{server.name}</span>
          <ScopeBadge scope={mcpScopeForBadge(server.scope)} />
          <span className={`cust-tabs-status is-${statusKind}`}>{statusLabel}</span>
        </div>
        {cmdLine && (
          <div className="cust-tabs-card-command" title={cmdLine}>
            {cmdLine}
          </div>
        )}
        <div className="cust-tabs-card-meta">
          <span className="cust-tabs-card-meta-arg">{typeLabel}</span>
          <span className="cust-tabs-card-meta-path" title={server.sourcePath}>
            {truncateMiddle(shortenPath(server.sourcePath, cwd), 72)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Shared sub-components
// ============================================================================

function ScopeBadge({ scope, pluginName }: { scope: Scope; pluginName?: string }) {
  return (
    <span className={`cust-tabs-badge is-${scope}`} title={`Escopo: ${labelForScope(scope)}${pluginName ? ` (${pluginName})` : ''}`}>
      {labelForScope(scope)}
      {scope === 'plugin' && pluginName && (
        <span className="cust-tabs-badge-plugin-name">({pluginName})</span>
      )}
    </span>
  );
}

function EmptyState({
  tab,
  hasSearch,
  onClearSearch,
  onOpenMcpManager,
}: {
  tab: TabId;
  hasSearch: boolean;
  onClearSearch: () => void;
  onOpenMcpManager?: () => void;
}) {
  if (hasSearch) {
    return (
      <div className="cust-tabs-empty">
        <div className="cust-tabs-empty-icon">
          <i className="codicon codicon-search" />
        </div>
        <div className="cust-tabs-empty-title">Nenhum resultado</div>
        <div className="cust-tabs-empty-msg">
          Tente outro termo ou limpe o filtro pra ver tudo.
        </div>
        <button type="button" className="cust-tabs-empty-action" onClick={onClearSearch}>
          <i className="codicon codicon-close" />
          Limpar busca
        </button>
      </div>
    );
  }

  const spec = emptyStateForTab(tab);
  return (
    <div className="cust-tabs-empty">
      <div className="cust-tabs-empty-icon">
        <i className={`codicon codicon-${spec.icon}`} />
      </div>
      <div className="cust-tabs-empty-title">{spec.title}</div>
      <div className="cust-tabs-empty-msg">{spec.message}</div>
      {tab === 'mcp' && onOpenMcpManager ? (
        <button type="button" className="cust-tabs-empty-action" onClick={onOpenMcpManager}>
          <i className="codicon codicon-add" />
          Adicionar conector
        </button>
      ) : (
        <button
          type="button"
          className="cust-tabs-empty-action"
          onClick={() => openExternal(spec.docsUrl)}
        >
          <i className="codicon codicon-link-external" />
          Abrir docs
        </button>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="cust-tabs-skeleton-grid">
      {[0, 1, 2].map((i) => (
        <div key={i} className="cust-tabs-skeleton-card">
          <div className="cust-tabs-skeleton-icon" />
          <div className="cust-tabs-skeleton-lines">
            <div className="cust-tabs-skeleton-line is-w-60" />
            <div className="cust-tabs-skeleton-line is-w-90" />
            <div className="cust-tabs-skeleton-line is-w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Static labels / config
// ============================================================================

function labelForTab(tab: TabId): string {
  switch (tab) {
    case 'rules': return 'Rules';
    case 'workflows': return 'Workflows';
    case 'skills': return 'Skills';
    case 'hooks': return 'Hooks';
    case 'mcp': return 'MCP';
  }
}

function labelForScope(scope: Scope): string {
  switch (scope) {
    case 'workspace': return 'workspace';
    case 'user': return 'user';
    case 'plugin': return 'plugin';
  }
}

interface EmptyStateSpec {
  icon: string;
  title: string;
  message: string;
  docsUrl: string;
}

function emptyStateForTab(tab: TabId): EmptyStateSpec {
  switch (tab) {
    case 'rules':
      return {
        icon: 'book',
        title: 'Nenhuma regra configurada ainda',
        message: 'Adicione um CLAUDE.md no workspace ou em ~/.claude/ pra dar instruções persistentes pro Claude.',
        docsUrl: 'https://docs.claude.com/en/docs/claude-code/memory',
      };
    case 'workflows':
      return {
        icon: 'symbol-event',
        title: 'Nenhum workflow configurado ainda',
        message: 'Crie um arquivo Markdown em .claude/commands/ pra definir um slash command custom (ex: /deploy, /review).',
        docsUrl: 'https://docs.claude.com/en/docs/claude-code/slash-commands',
      };
    case 'skills':
      return {
        icon: 'sparkle',
        title: 'Nenhuma skill configurada ainda',
        message: 'Adicione uma pasta com SKILL.md em .claude/skills/ pra dar conhecimento especializado ao Claude.',
        docsUrl: 'https://docs.claude.com/en/docs/claude-code/skills',
      };
    case 'hooks':
      return {
        icon: 'bell',
        title: 'Nenhum hook configurado ainda',
        message: 'Configure hooks no settings.json pra disparar comandos automaticamente em eventos (PreToolUse, PostToolUse, etc).',
        docsUrl: 'https://docs.claude.com/en/docs/claude-code/hooks',
      };
    case 'mcp':
      return {
        icon: 'plug',
        title: 'Nenhum conector MCP configurado ainda',
        message: 'Adicione conectores MCP pra dar ao Claude acesso a tools externas (browser, calendário, Slack, etc).',
        docsUrl: 'https://docs.claude.com/en/docs/claude-code/mcp',
      };
  }
}
