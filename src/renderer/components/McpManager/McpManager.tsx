/**
 * McpManager — modal pra gerenciar MCP servers do Claude Code.
 *
 * Substitui o "abrir ~/.claude.json no FilePreview" antigo. Mostra lista
 * de servers configurados (vindos de window.undrcodAPI?.mcp.list), com botoes
 * pra adicionar, editar, remover e ligar/desligar.
 *
 * Escopos:
 *   - user      → ~/.claude.json (top-level mcpServers)
 *   - workspace → <cwd>/.mcp.json (committed no repo)
 *   - project   → projects[<cwd>].mcpServers em ~/.claude.json
 *
 * Defensive: se window.undrcodAPI?.mcp.addServer não existe (preload antigo),
 * mostra mensagem instruindo restart.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { confirmDialog } from '../ConfirmDialog/ConfirmDialog';
import { toast } from '../Toast/Toast';
import { McpCatalogBrowser, type McpCatalogEntry } from './McpCatalogBrowser';
import './McpManager.css';
import './McpCatalogBrowser.css';

interface McpServer {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  status: 'configured' | 'unknown';
  scope: 'workspace' | 'user' | 'project';
  type?: string;
  sourcePath: string;
}

type McpScope = 'user' | 'workspace' | 'project';

interface McpManagerProps {
  open: boolean;
  onClose: () => void;
  cwd: string;
  /** Callback pra abrir o arquivo JSON cru no FilePreview (fallback "editar manualmente"). */
  onOpenRawJson?: (scope: 'global' | 'workspace') => void;
}

/** State do form de add/edit. Nome separado pra detectar renomeio. */
interface ServerFormState {
  /** Nome original (pra detectar rename quando editing). null = novo server. */
  originalName: string | null;
  /** Scope original (pra mover entre escopos se mudou). null = novo. */
  originalScope: McpScope | null;
  name: string;
  command: string;
  argsText: string;
  envText: string;
  scope: McpScope;
}

const EMPTY_FORM: ServerFormState = {
  originalName: null,
  originalScope: null,
  name: '',
  command: '',
  argsText: '',
  envText: '',
  scope: 'user',
};

export function McpManager({ open, onClose, cwd, onOpenRawJson }: McpManagerProps) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [form, setForm] = useState<ServerFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Catalog browser state — quando aberto, replace lista com sub-view
  const [browseOpen, setBrowseOpen] = useState(false);
  // Entry selecionada via catalogo (pra mostrar header + auth fields no form)
  const [selectedCatalogEntry, setSelectedCatalogEntry] =
    useState<McpCatalogEntry | null>(null);
  // Valores dos auth fields (controlled inputs) — key = field.name (env var)
  const [authValues, setAuthValues] = useState<Record<string, string>>({});
  // Test results por server key — key = `${scope}:${name}`.
  // Status 'idle' = nunca testado, 'testing' = spinner, 'ok' = verde, 'err' = vermelho.
  const [testStatus, setTestStatus] = useState<
    Record<string, { state: 'testing' | 'ok' | 'err'; message?: string }>
  >({});

  // Detecta se a API mutavel esta disponível (defensive: preload velho).
  useEffect(() => {
    if (!open) return;
    const api = window.undrcodAPI?.mcp;
    const hasMutators =
      api &&
      typeof api.addServer === 'function' &&
      typeof api.removeServer === 'function' &&
      typeof api.setEnabled === 'function';
    setAvailable(Boolean(hasMutators));
  }, [open]);

  // Carrega lista de servers
  const refresh = useCallback(async () => {
    const fn = window.undrcodAPI?.mcp?.list;
    if (typeof fn !== 'function') {
      setServers([]);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    try {
      const rows = await fn(cwd);
      setServers(rows);
    } catch (err) {
      console.warn('[McpManager] list falhou:', err);
      setServers([]);
    } finally {
      setLoaded(true);
    }
  }, [cwd]);

  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open, refresh]);

  // Esc fecha (ou cancela form se aberto). Quando o catalog browser ta aberto,
  // ele tem seu próprio handler com stopPropagation pra interceptar antes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Catalogo aberto = deixa o handler dele cuidar
        if (browseOpen) return;
        e.preventDefault();
        if (form) {
          setForm(null);
          setFormError(null);
          setSelectedCatalogEntry(null);
          setAuthValues({});
        } else {
          onClose();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, form, browseOpen]);

  // Reset form quando modal fecha
  useEffect(() => {
    if (!open) {
      setForm(null);
      setFormError(null);
      setBrowseOpen(false);
      setSelectedCatalogEntry(null);
      setAuthValues({});
    }
  }, [open]);

  const openAddForm = useCallback(() => {
    setFormError(null);
    setSelectedCatalogEntry(null);
    setAuthValues({});
    setForm({
      ...EMPTY_FORM,
      // Default pra workspace se temos cwd, senao user
      scope: cwd ? 'workspace' : 'user',
    });
  }, [cwd]);

  const openEditForm = useCallback((srv: McpServer) => {
    setFormError(null);
    setSelectedCatalogEntry(null);
    setAuthValues({});
    // Le env do servidor — esta no arquivo de origem, não no McpServer entry.
    // Como não temos no entry, vai vazio (a UI não mostra env atual em edit).
    // Edge case: user pode adicionar env via form, mas se já existia, sera substituido.
    setForm({
      originalName: srv.name,
      originalScope: srv.scope,
      name: srv.name,
      command: srv.command,
      argsText: srv.args.join(', '),
      envText: '',
      scope: srv.scope,
    });
  }, []);

  // Catalog browser controls
  const openBrowse = useCallback(() => {
    setFormError(null);
    setBrowseOpen(true);
  }, []);

  const closeBrowse = useCallback(() => {
    setBrowseOpen(false);
  }, []);

  /**
   * Handler quando user escolhe um conector no catalogo.
   * Fecha browser, popula form com command/args, prepara authValues vazios
   * pra renderizar os campos estruturados.
   */
  const handleCatalogPick = useCallback(
    (entry: McpCatalogEntry) => {
      setBrowseOpen(false);
      setSelectedCatalogEntry(entry);
      // Inicializa authValues com keys vazias pra cada field
      const init: Record<string, string> = {};
      for (const f of entry.authFields) init[f.name] = '';
      setAuthValues(init);
      setFormError(null);
      setForm({
        originalName: null,
        originalScope: null,
        name: entry.id,
        command: entry.command,
        argsText: entry.args.join(' '),
        envText: '', // populado a partir de authValues no save
        scope: cwd ? 'workspace' : 'user',
      });
    },
    [cwd],
  );

  /** Fallback do estado "catalogo indisponível" → abre form manual em branco */
  const handleCatalogFallback = useCallback(() => {
    setBrowseOpen(false);
    openAddForm();
  }, [openAddForm]);

  const handleDelete = useCallback(
    async (srv: McpServer) => {
      const api = window.undrcodAPI?.mcp;
      if (!api?.removeServer) return;
      const ok = await confirmDialog({
        title: 'Remover conector',
        message: `Remover "${srv.name}" do escopo ${labelForScope(srv.scope)}?`,
        confirmLabel: 'Remover',
        destructive: true,
      });
      if (!ok) return;
      setBusy(true);
      try {
        const res = await api.removeServer(srv.scope, cwd, srv.name);
        if ('error' in res) {
          console.warn('[McpManager] remove falhou:', res.error);
        }
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [cwd, refresh],
  );

  const handleToggle = useCallback(
    async (srv: McpServer) => {
      const api = window.undrcodAPI?.mcp;
      if (!api?.setEnabled) return;
      // setEnabled só funciona pra scope workspace. Pra outros, no-op.
      if (srv.scope !== 'workspace') return;
      setBusy(true);
      try {
        const res = await api.setEnabled(srv.scope, cwd, srv.name, !srv.enabled);
        if ('error' in res) {
          console.warn('[McpManager] toggle falhou:', res.error);
        }
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [cwd, refresh],
  );

  const handleTest = useCallback(async (srv: McpServer) => {
    const api = window.undrcodAPI?.mcp;
    const key = `${srv.scope}:${srv.name}`;
    if (typeof api?.test !== 'function') {
      toast.error('Funcao de teste indisponivel', { sub: 'Reinicie o app pra atualizar' });
      return;
    }
    setTestStatus((prev) => ({ ...prev, [key]: { state: 'testing' } }));
    try {
      const res = await api.test({ command: srv.command, args: srv.args });
      if ('error' in res) {
        setTestStatus((prev) => ({
          ...prev,
          [key]: { state: 'err', message: res.error },
        }));
        toast.error(`${srv.name}: falha no teste`, { sub: res.error });
      } else {
        setTestStatus((prev) => ({
          ...prev,
          [key]: { state: 'ok', message: res.output },
        }));
        toast.success(`${srv.name}: conexao OK`);
      }
    } catch (err) {
      const msg = (err as Error).message;
      setTestStatus((prev) => ({
        ...prev,
        [key]: { state: 'err', message: msg },
      }));
      toast.error(`${srv.name}: erro inesperado`, { sub: msg });
    }
  }, []);

  const handleFormSave = useCallback(async () => {
    if (!form) return;
    const api = window.undrcodAPI?.mcp;
    if (!api?.addServer || !api?.removeServer) return;

    const name = form.name.trim();
    if (!name) {
      setFormError('Nome obrigatorio');
      return;
    }
    if (!form.command.trim()) {
      setFormError('Comando obrigatorio');
      return;
    }

    // Args: se veio do catalogo (sem virgula no input), parse por whitespace.
    // Senao, parse legacy CSV. Detectamos pela presenca do catalog entry.
    const args = selectedCatalogEntry
      ? form.argsText.split(/\s+/).map((s) => s.trim()).filter((s) => s.length > 0)
      : form.argsText
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

    // Parse env (KEY=VALUE por linha) — modo "extra envs" alem dos auth fields
    const env: Record<string, string> = {};
    for (const line of form.envText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) {
        setFormError(`Linha de env invalida: "${trimmed}" (use KEY=VALUE)`);
        return;
      }
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim();
      if (!k) {
        setFormError(`Linha de env invalida: "${trimmed}"`);
        return;
      }
      env[k] = v;
    }

    // Se temos catalog entry, valida e mescla auth fields no env.
    // Auth fields tem precedencia sobre env free-form (se houver colisao).
    if (selectedCatalogEntry) {
      for (const field of selectedCatalogEntry.authFields) {
        const val = (authValues[field.name] ?? '').trim();
        if (field.required && !val) {
          setFormError(`"${field.label}" e obrigatorio`);
          return;
        }
        if (val) env[field.name] = val;
      }
    }

    // Valida que workspace requer cwd
    if (form.scope === 'workspace' && !cwd) {
      setFormError('Sem workspace aberto — escolha outro escopo');
      return;
    }
    if (form.scope === 'project' && !cwd) {
      setFormError('Sem workspace aberto — escolha outro escopo');
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      // Edge case: renomeou ou mudou escopo → remove o original antes do add.
      // Sem isso, ficaria server duplicado com nome novo + antigo.
      const renamed = form.originalName && form.originalName !== name;
      const movedScope = form.originalScope && form.originalScope !== form.scope;
      if (form.originalName && form.originalScope && (renamed || movedScope)) {
        await api.removeServer(form.originalScope, cwd, form.originalName);
      }

      const addRes = await api.addServer(form.scope, cwd, name, {
        command: form.command.trim(),
        args,
        env: Object.keys(env).length > 0 ? env : undefined,
      });

      if ('error' in addRes) {
        setFormError(addRes.error);
        setBusy(false);
        return;
      }

      setForm(null);
      setSelectedCatalogEntry(null);
      setAuthValues({});
      await refresh();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [form, cwd, refresh, selectedCatalogEntry, authValues]);

  if (!open) return null;

  return (
    <div className="mcp-mgr-backdrop" onClick={onClose}>
      <div
        className="mcp-mgr-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Gerenciar conectores MCP"
      >
        {/* Header — escondido quando catalog browser ta aberto (ele tem seu próprio) */}
        {!browseOpen && (
          <div className="mcp-mgr-header">
            <span className="mcp-mgr-title">
              {form
                ? form.originalName
                  ? `Editar conector "${form.originalName}"`
                  : 'Adicionar conector'
                : 'Conectores MCP'}
            </span>
            <div className="mcp-mgr-header-actions">
              {!form && available !== false && servers.length > 0 && (
                <>
                  <button
                    type="button"
                    className="mcp-mgr-browse-btn"
                    onClick={openBrowse}
                    disabled={busy}
                    title="Procurar conectores populares"
                  >
                    <i className="codicon codicon-search" />
                    Procurar conectores
                  </button>
                  <button
                    type="button"
                    className="mcp-mgr-btn mcp-mgr-btn-sm"
                    onClick={openAddForm}
                    disabled={busy}
                  >
                    <i className="codicon codicon-add" />
                    Adicionar conector
                  </button>
                </>
              )}
              <button
                type="button"
                className="mcp-mgr-close"
                onClick={onClose}
                title="Fechar (Esc)"
              >
                <i className="codicon codicon-close" />
              </button>
            </div>
          </div>
        )}

        {available === false ? (
          <div className="mcp-mgr-unavailable">
            <i className="codicon codicon-warning mcp-mgr-unavailable-icon" />
            <div className="mcp-mgr-unavailable-title">Funcionalidade indisponível</div>
            <div className="mcp-mgr-unavailable-msg">
              A ponte de gerenciamento de MCP não esta carregada. Reinicie o app pra atualizar o preload.
            </div>
          </div>
        ) : browseOpen ? (
          <McpCatalogBrowser
            onSelect={handleCatalogPick}
            onBack={closeBrowse}
            onFallbackToManual={handleCatalogFallback}
          />
        ) : form ? (
          <div className="mcp-mgr-body">
            <FormView
              form={form}
              onChange={setForm}
              hasCwd={Boolean(cwd)}
              catalogEntry={selectedCatalogEntry}
              authValues={authValues}
              onAuthChange={setAuthValues}
            />
            {formError && <div className="mcp-mgr-form-error">{formError}</div>}
          </div>
        ) : !loaded ? (
          <div className="mcp-mgr-loading">Carregando conectores...</div>
        ) : servers.length === 0 ? (
          <div className="mcp-mgr-empty">
            <i className="codicon codicon-plug mcp-mgr-empty-icon" />
            <div className="mcp-mgr-empty-title">Nenhum conector configurado</div>
            <div className="mcp-mgr-empty-msg">
              Adicione um conector MCP pra extender o Claude com tools externos
              (browser, calendário, etc).
            </div>
            <button
              type="button"
              className="mcp-mgr-browse-btn"
              onClick={openBrowse}
              disabled={busy}
            >
              <i className="codicon codicon-search" />
              Procurar conectores
            </button>
            <button
              type="button"
              className="mcp-mgr-link-btn"
              onClick={openAddForm}
              disabled={busy}
            >
              Adicionar manualmente
            </button>
          </div>
        ) : (
          <div className="mcp-mgr-body">
            {servers.map((srv) => {
              const key = `${srv.scope}:${srv.name}`;
              return (
                <ServerRow
                  key={key}
                  server={srv}
                  busy={busy}
                  testState={testStatus[key]}
                  onEdit={() => openEditForm(srv)}
                  onDelete={() => handleDelete(srv)}
                  onToggle={() => handleToggle(srv)}
                  onTest={() => handleTest(srv)}
                />
              );
            })}
          </div>
        )}

        {/* Footer escondido quando catalog browser ta aberto (ele controla seu fluxo) */}
        {!browseOpen && (
        <div className="mcp-mgr-footer">
          {!form && onOpenRawJson && available !== false && (
            <button
              type="button"
              className="mcp-mgr-link-btn"
              onClick={() => {
                onClose();
                onOpenRawJson('global');
              }}
            >
              Editar JSON manualmente
            </button>
          )}
          {form && <span className="mcp-mgr-footer-hint">Os valores serao salvos no JSON do escopo selecionado.</span>}
          <div className="mcp-mgr-footer-actions">
            {form ? (
              <>
                <button
                  type="button"
                  className="mcp-mgr-btn mcp-mgr-btn-ghost"
                  onClick={() => {
                    setForm(null);
                    setFormError(null);
                    setSelectedCatalogEntry(null);
                    setAuthValues({});
                  }}
                  disabled={busy}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="mcp-mgr-btn"
                  onClick={handleFormSave}
                  disabled={busy}
                >
                  Salvar
                </button>
              </>
            ) : (
              <button type="button" className="mcp-mgr-btn" onClick={onClose}>
                Fechar
              </button>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Server row
// ============================================================================

function ServerRow({
  server,
  busy,
  testState,
  onEdit,
  onDelete,
  onToggle,
  onTest,
}: {
  server: McpServer;
  busy: boolean;
  /** undefined = nunca testado; senao state + message do ultimo teste */
  testState?: { state: 'testing' | 'ok' | 'err'; message?: string };
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onTest: () => void;
}) {
  // Toggle só faz sentido pra workspace (que respeita disabledMcpjsonServers).
  // Pra user/project, mostra disabled (pra desligar, remova).
  const canToggle = server.scope === 'workspace';
  const cmdLine = [server.command, ...server.args].join(' ').trim();

  const testing = testState?.state === 'testing';
  // Resolve icone + classe + tooltip do botao Test baseado em estado.
  let testIcon = 'codicon-debug-start';
  let testClass = '';
  let testTitle = 'Testar conexao';
  if (testing) {
    testIcon = 'codicon-loading codicon-modifier-spin';
    testTitle = 'Testando...';
  } else if (testState?.state === 'ok') {
    testIcon = 'codicon-check';
    testClass = 'is-ok';
    testTitle = `Conexao OK${testState.message ? ` — ${testState.message.slice(0, 80)}` : ''}`;
  } else if (testState?.state === 'err') {
    testIcon = 'codicon-error';
    testClass = 'is-err';
    testTitle = `Falha: ${testState.message ?? 'erro desconhecido'}`;
  }

  return (
    <div className={`mcp-mgr-row ${server.enabled ? '' : 'is-disabled'}`}>
      <div className="mcp-mgr-row-icon">
        <i className={`codicon codicon-${server.status === 'configured' ? 'plug' : 'warning'}`} />
      </div>
      <div className="mcp-mgr-row-text">
        <div className="mcp-mgr-row-name">
          <span>{server.name}</span>
          <span className={`mcp-mgr-badge is-${server.scope}`}>
            {labelForScope(server.scope)}
          </span>
          {testState?.state === 'ok' && (
            <span className="mcp-mgr-test-badge is-ok" title={testState.message ?? ''}>
              <i className="codicon codicon-pass-filled" />
              online
            </span>
          )}
          {testState?.state === 'err' && (
            <span className="mcp-mgr-test-badge is-err" title={testState.message ?? ''}>
              <i className="codicon codicon-error" />
              falha
            </span>
          )}
        </div>
        <div className="mcp-mgr-row-cmd" title={cmdLine}>
          {cmdLine || server.type || '(sem comando)'}
        </div>
      </div>
      <div className="mcp-mgr-row-actions">
        <button
          type="button"
          className={`mcp-mgr-icon-btn ${testClass}`}
          onClick={onTest}
          disabled={busy || testing || !server.command}
          title={testTitle}
        >
          <i className={`codicon ${testIcon}`} />
        </button>
        <button
          type="button"
          className={`mcp-mgr-toggle ${server.enabled ? 'is-on' : ''}`}
          onClick={onToggle}
          disabled={busy || !canToggle}
          title={canToggle ? (server.enabled ? 'Desativar' : 'Ativar') : 'Pra ligar/desligar, edite ou remova'}
          aria-checked={server.enabled}
          role="switch"
        >
          <span className="mcp-mgr-toggle-thumb" />
        </button>
        <button
          type="button"
          className="mcp-mgr-icon-btn"
          onClick={onEdit}
          disabled={busy}
          title="Editar"
        >
          <i className="codicon codicon-settings-gear" />
        </button>
        <button
          type="button"
          className="mcp-mgr-icon-btn is-danger"
          onClick={onDelete}
          disabled={busy}
          title="Remover"
        >
          <i className="codicon codicon-trash" />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Form view
// ============================================================================

function FormView({
  form,
  onChange,
  hasCwd,
  catalogEntry,
  authValues,
  onAuthChange,
}: {
  form: ServerFormState;
  onChange: (next: ServerFormState) => void;
  hasCwd: boolean;
  /** Quando set, mostra header "Adicionando: X" + section de credenciais estruturada. */
  catalogEntry: McpCatalogEntry | null;
  authValues: Record<string, string>;
  onAuthChange: (next: Record<string, string>) => void;
}) {
  // Pra catalog-driven: simple-icons CDN URL. Mesmo padrao do CatalogLogo.
  const logoUrl = useMemo(() => {
    if (!catalogEntry?.iconSlug) return null;
    const slug = catalogEntry.iconSlug.trim().toLowerCase();
    if (!slug) return null;
    return `https://cdn.simpleicons.org/${encodeURIComponent(slug)}`;
  }, [catalogEntry?.iconSlug]);
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => {
    // reset failed flag quando muda entry
    setLogoFailed(false);
  }, [catalogEntry?.id]);

  // Args label e placeholder mudam pra catalog (espaco) vs manual (CSV)
  const argsLabel = catalogEntry
    ? 'Argumentos (separados por espaco)'
    : 'Argumentos (separados por virgula)';
  const argsPlaceholder = catalogEntry
    ? 'ex: -y @modelcontextprotocol/server-github'
    : 'ex: -y, @modelcontextprotocol/server-github';

  return (
    <div className="mcp-mgr-form">
      {catalogEntry && (
        <div className="mcp-mgr-form-catalog-header">
          <div className="mcp-mgr-form-catalog-icon">
            {logoUrl && !logoFailed ? (
              <img
                src={logoUrl}
                alt=""
                className="mcp-catalog-logo-img"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <i className="codicon codicon-plug" />
            )}
          </div>
          <div className="mcp-mgr-form-catalog-text">
            <span className="mcp-mgr-form-catalog-label">Adicionando</span>
            <span className="mcp-mgr-form-catalog-name">
              {catalogEntry.displayName}
              {catalogEntry.official && (
                <span className="mcp-catalog-badge is-official" title="Conector oficial">
                  <i className="codicon codicon-verified" />
                  Oficial
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      <div className="mcp-mgr-field">
        <label className="mcp-mgr-label" htmlFor="mcp-mgr-name">Nome</label>
        <input
          id="mcp-mgr-name"
          type="text"
          className="mcp-mgr-input"
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          placeholder="ex: github, slack, browser"
          autoFocus={!catalogEntry}
        />
        <span className="mcp-mgr-hint">
          Identificador único do conector. Sera a key no JSON.
        </span>
      </div>

      <div className="mcp-mgr-field">
        <label className="mcp-mgr-label" htmlFor="mcp-mgr-cmd">Comando</label>
        <input
          id="mcp-mgr-cmd"
          type="text"
          className="mcp-mgr-input is-mono"
          value={form.command}
          onChange={(e) => onChange({ ...form, command: e.target.value })}
          placeholder="ex: npx, node, python, ou path absoluto"
        />
        <span className="mcp-mgr-hint">
          Executavel principal. Geralmente npx pra packages npm.
        </span>
      </div>

      <div className="mcp-mgr-field">
        <label className="mcp-mgr-label" htmlFor="mcp-mgr-args">{argsLabel}</label>
        <input
          id="mcp-mgr-args"
          type="text"
          className="mcp-mgr-input is-mono"
          value={form.argsText}
          onChange={(e) => onChange({ ...form, argsText: e.target.value })}
          placeholder={argsPlaceholder}
        />
      </div>

      {/* Auth fields estruturados (só se vier do catalogo com fields) */}
      {catalogEntry && catalogEntry.authFields.length > 0 && (
        <div className="mcp-mgr-auth-section">
          <div className="mcp-mgr-auth-section-title">
            <i className="codicon codicon-key" />
            Credenciais
          </div>
          {catalogEntry.authFields.map((field) => {
            const inputType = field.type === 'password' ? 'password' : 'text';
            return (
              <div className="mcp-mgr-field" key={field.name}>
                <label className="mcp-mgr-label" htmlFor={`mcp-auth-${field.name}`}>
                  {field.label}
                  {field.required && (
                    <span className="mcp-mgr-auth-required" aria-label="obrigatorio">*</span>
                  )}
                </label>
                <input
                  id={`mcp-auth-${field.name}`}
                  type={inputType}
                  className="mcp-mgr-input"
                  value={authValues[field.name] ?? ''}
                  onChange={(e) =>
                    onAuthChange({ ...authValues, [field.name]: e.target.value })
                  }
                  placeholder={
                    field.type === 'password'
                      ? '••••••••'
                      : field.type === 'url'
                        ? 'https://...'
                        : ''
                  }
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus={field === catalogEntry.authFields[0]}
                />
                {field.help && <span className="mcp-mgr-hint">{field.help}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Free-form env textarea — sempre disponível.
          Pra catalog mode, fica como "extras" alem dos campos estruturados. */}
      <div className="mcp-mgr-field">
        <label className="mcp-mgr-label" htmlFor="mcp-mgr-env">
          {catalogEntry
            ? 'Variaveis de ambiente extras (opcional)'
            : 'Variaveis de ambiente (uma por linha)'}
        </label>
        <textarea
          id="mcp-mgr-env"
          className="mcp-mgr-textarea"
          value={form.envText}
          onChange={(e) => onChange({ ...form, envText: e.target.value })}
          placeholder={'GITHUB_TOKEN=ghp_xxx\nDEBUG=1'}
        />
        <span className="mcp-mgr-hint">
          {catalogEntry
            ? 'Adicione envs extras alem dos campos acima. Formato KEY=VALUE por linha.'
            : 'Formato KEY=VALUE por linha. Em edição, substitui as existentes.'}
        </span>
      </div>

      <div className="mcp-mgr-field">
        <label className="mcp-mgr-label" htmlFor="mcp-mgr-scope">Escopo</label>
        <select
          id="mcp-mgr-scope"
          className="mcp-mgr-select"
          value={form.scope}
          onChange={(e) => onChange({ ...form, scope: e.target.value as McpScope })}
        >
          <option value="user">Usuário — vale pra todos os workspaces</option>
          <option value="workspace" disabled={!hasCwd}>
            Workspace — committed no .mcp.json do projeto
          </option>
          <option value="project" disabled={!hasCwd}>
            Projeto — só neste workspace, no perfil global
          </option>
        </select>
        <span className="mcp-mgr-hint">
          {form.scope === 'user' && 'Salvo em ~/.claude.json. Disponivel em todos os workspaces.'}
          {form.scope === 'workspace' && 'Salvo em <workspace>/.mcp.json. Compartilhado com colaboradores via git.'}
          {form.scope === 'project' && 'Salvo em ~/.claude.json -> projects[<cwd>]. Só neste workspace, não compartilhado.'}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function labelForScope(scope: McpScope): string {
  switch (scope) {
    case 'user': return 'usuário';
    case 'workspace': return 'workspace';
    case 'project': return 'projeto';
  }
}
