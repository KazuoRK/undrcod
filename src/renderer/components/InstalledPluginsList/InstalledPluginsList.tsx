/**
 * InstalledPluginsList — view inline na sidebar pra extensions do AGENTE.
 *
 * Esses estendem o Claude Code (slash commands, subagents, hooks, MCP, skills)
 * — NÃO são extensions do VS Code. UNDRCOD não tem extension host; o que
 * estende aqui é o AGENTE, não o editor.
 *
 * Duas seções:
 *   1. PLUGINS — bundles do marketplace (`claude plugin install`)
 *   2. SKILLS RECOMENDADAS — catálogo curado, instala via `npx skills add`
 *
 * Refetch:
 *   - mount inicial
 *   - quando user clica refresh button
 *   - quando o modal de marketplace fecha (broadcast via event)
 *   - após install de skill (recarrega listSkills)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { confirmDialog } from '../ConfirmDialog/ConfirmDialog';
import { toast } from '../Toast/Toast';
import type { InstalledPlugin } from '../PluginMarketplace/PluginMarketplace';
import { CURATED_SKILLS, type CuratedSkill } from '../../../shared/curated-skills';
import './InstalledPluginsList.css';

interface InstalledPluginsListProps {
  /** Callback pra abrir o marketplace modal cheio (browse + install). */
  onBrowse: () => void;
  /** cwd atual — passa pro customization.listSkills(). */
  cwd: string;
}

/** Skill instalada (do customization-manager) — só os campos que usamos aqui. */
interface InstalledSkill {
  name: string;
  scope: 'workspace' | 'user' | 'plugin';
}

export function InstalledPluginsList({ onBrowse, cwd }: InstalledPluginsListProps) {
  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyName, setBusyName] = useState<string | null>(null);
  /** Skills sendo instaladas no momento (npx pode levar 30s+). */
  const [installingSkills, setInstallingSkills] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  // -------------------------------------------------------------------------
  // Refresh — plugins (CLI claude) + skills (customization manager)
  // -------------------------------------------------------------------------
  const refresh = useCallback(async () => {
    const pluginsApi = window.undrcodAPI?.plugins;
    const customApi = window.undrcodAPI?.customization;

    setLoading(true);
    const [pluginsList, skillsList] = await Promise.all([
      pluginsApi?.listInstalled
        ? pluginsApi.listInstalled().catch(() => [] as InstalledPlugin[])
        : Promise.resolve([] as InstalledPlugin[]),
      customApi?.listSkills
        ? customApi.listSkills(cwd).catch(() => [] as InstalledSkill[])
        : Promise.resolve([] as InstalledSkill[]),
    ]);
    setInstalled(pluginsList);
    setInstalledSkills(skillsList as InstalledSkill[]);
    setLoading(false);
  }, [cwd]);

  useEffect(() => {
    void refresh();
    const onChanged = (): void => { void refresh(); };
    window.addEventListener('undrcod:plugins-changed', onChanged);
    return () => window.removeEventListener('undrcod:plugins-changed', onChanged);
  }, [refresh]);

  // -------------------------------------------------------------------------
  // Plugin actions
  // -------------------------------------------------------------------------
  const toggleEnabled = useCallback(async (p: InstalledPlugin) => {
    const api = window.undrcodAPI?.plugins;
    if (!api?.setEnabled) return;
    setBusyName(p.name);
    try {
      const res = await api.setEnabled(p.name, !p.enabled);
      if ('error' in res) {
        toast.error(`Falha: ${res.error}`);
      } else {
        setInstalled((prev) =>
          prev?.map((x) => (x.name === p.name ? { ...x, enabled: !p.enabled } : x)) ?? null,
        );
      }
    } finally {
      setBusyName(null);
    }
  }, []);

  const uninstall = useCallback(async (p: InstalledPlugin) => {
    const ok = await confirmDialog({
      title: `Desinstalar ${p.name}?`,
      message: 'O plugin será removido. Você pode reinstalar pelo marketplace.',
      confirmLabel: 'Desinstalar',
      destructive: true,
    });
    if (!ok) return;
    const api = window.undrcodAPI?.plugins;
    if (!api?.uninstall) return;
    setBusyName(p.name);
    try {
      const res = await api.uninstall(p.name);
      if ('error' in res) {
        toast.error(`Falha: ${res.error}`);
      } else {
        toast.success(`${p.name} desinstalado`);
        setInstalled((prev) => prev?.filter((x) => x.name !== p.name) ?? null);
      }
    } finally {
      setBusyName(null);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Skill actions — install curated
  // -------------------------------------------------------------------------
  const installSkill = useCallback(async (skill: CuratedSkill) => {
    const api = window.undrcodAPI?.skills;
    if (!api?.installCurated) {
      toast.error('Backend de skills indisponível — reinicie o app');
      return;
    }
    setInstallingSkills((prev) => new Set(prev).add(skill.id));
    try {
      const res = await api.installCurated(skill.source, skill.skillFilter);
      if (!res.ok) {
        toast.error(`Falha ao instalar ${skill.name}: ${res.error ?? 'erro desconhecido'}`);
        return;
      }
      toast.success(`${skill.name} instalada`);
      // Recarrega lista pra refletir installed-state.
      void refresh();
    } finally {
      setInstallingSkills((prev) => {
        const next = new Set(prev);
        next.delete(skill.id);
        return next;
      });
    }
  }, [refresh]);

  // -------------------------------------------------------------------------
  // Lookup rápido: skill instalada?
  // -------------------------------------------------------------------------
  const installedSkillNames = useMemo(() => {
    const set = new Set<string>();
    for (const s of installedSkills) set.add(s.name);
    return set;
  }, [installedSkills]);

  // -------------------------------------------------------------------------
  // Filtros aplicados em AMBAS as seções
  // -------------------------------------------------------------------------
  const q = search.trim().toLowerCase();
  const matchesSearch = (text: string): boolean =>
    q === '' || text.toLowerCase().includes(q);

  const filteredPlugins = installed?.filter((p) => matchesSearch(p.name)) ?? [];
  const filteredSkills = CURATED_SKILLS.filter(
    (s) => matchesSearch(s.name) || matchesSearch(s.description) || matchesSearch(s.id),
  );

  // Skills ordenadas: instaladas primeiro
  const sortedSkills = useMemo(() => {
    const list = [...filteredSkills];
    list.sort((a, b) => {
      const aInst = installedSkillNames.has(a.id);
      const bInst = installedSkillNames.has(b.id);
      if (aInst !== bInst) return aInst ? -1 : 1;
      return 0; // mantém ordem natural do catálogo
    });
    return list;
  }, [filteredSkills, installedSkillNames]);

  return (
    <div className="installed-plugins">
      <div className="installed-plugins-header">
        <span className="installed-plugins-title">EXTENSIONS DO AGENTE</span>
        <button
          type="button"
          className="installed-plugins-refresh"
          onClick={() => void refresh()}
          title="Recarregar"
          aria-label="Recarregar lista"
        >
          <i className="codicon codicon-refresh" />
        </button>
      </div>

      <div className="installed-plugins-search-wrap">
        <i className="codicon codicon-search installed-plugins-search-icon" />
        <input
          type="text"
          className="installed-plugins-search"
          placeholder="Filtrar plugins e skills"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
        />
      </div>

      <button
        type="button"
        className="installed-plugins-browse"
        onClick={onBrowse}
      >
        <i className="codicon codicon-cloud-download" />
        <span>Browse marketplace</span>
      </button>

      {/* ============================================================
       * SEÇÃO 1 — Plugins (bundles do marketplace claude)
       * ============================================================ */}
      <div className="installed-plugins-section-header">
        <span>PLUGINS</span>
        {installed && <span className="installed-plugins-count">{installed.length}</span>}
      </div>

      <div className="installed-plugins-list">
        {loading && (
          <div className="installed-plugins-empty">
            <i className="codicon codicon-loading codicon-modifier-spin" />
            <span>Carregando…</span>
          </div>
        )}
        {!loading && installed && installed.length === 0 && (
          <div className="installed-plugins-empty">
            <i className="codicon codicon-plug" />
            <span>Nenhum plugin instalado</span>
            <button
              type="button"
              className="installed-plugins-empty-action"
              onClick={onBrowse}
            >
              Browse marketplace
            </button>
          </div>
        )}
        {!loading && filteredPlugins.map((p) => (
          <div key={p.name} className={`installed-plugin-card ${!p.enabled ? 'is-disabled' : ''}`}>
            <div className="installed-plugin-icon" aria-hidden>
              {p.name.replace(/^[^a-zA-Z0-9]+/, '').charAt(0) || '?'}
            </div>
            <div className="installed-plugin-info">
              <div className="installed-plugin-name" title={p.name}>{p.name}</div>
              <div className="installed-plugin-meta">
                {p.marketplace && <span>{p.marketplace}</span>}
                {p.version && <span>· v{p.version}</span>}
              </div>
            </div>
            <div className="installed-plugin-actions">
              <button
                type="button"
                className={`installed-plugin-toggle ${p.enabled ? 'is-on' : ''}`}
                onClick={() => void toggleEnabled(p)}
                disabled={busyName === p.name}
                title={p.enabled ? 'Desativar' : 'Ativar'}
                aria-pressed={p.enabled}
              >
                <span className="installed-plugin-toggle-thumb" />
              </button>
              <button
                type="button"
                className="installed-plugin-uninstall"
                onClick={() => void uninstall(p)}
                disabled={busyName === p.name}
                title="Desinstalar"
                aria-label={`Desinstalar ${p.name}`}
              >
                <i className="codicon codicon-trash" />
              </button>
            </div>
          </div>
        ))}
        {!loading && installed && installed.length > 0 && filteredPlugins.length === 0 && (
          <div className="installed-plugins-empty installed-plugins-empty-compact">
            <span>Nenhum plugin pra "{search}"</span>
          </div>
        )}
      </div>

      {/* ============================================================
       * SEÇÃO 2 — Skills recomendadas (catálogo curado)
       * ============================================================ */}
      <div className="installed-plugins-section-header">
        <span>SKILLS RECOMENDADAS</span>
        <span
          className="installed-plugins-count"
          title={`${installedSkillNames.size} instaladas de ${CURATED_SKILLS.length}`}
        >
          {Array.from(installedSkillNames).filter((n) =>
            CURATED_SKILLS.some((s) => s.id === n),
          ).length}/{CURATED_SKILLS.length}
        </span>
      </div>

      <div className="installed-plugins-list">
        {sortedSkills.length === 0 && (
          <div className="installed-plugins-empty installed-plugins-empty-compact">
            <span>Nenhuma skill pra "{search}"</span>
          </div>
        )}
        {sortedSkills.map((skill) => {
          const isInstalled = installedSkillNames.has(skill.id);
          const isInstalling = installingSkills.has(skill.id);
          return (
            <div
              key={skill.id}
              className={`skill-card ${isInstalled ? 'is-installed' : ''}`}
              title={skill.description}
            >
              <div className="skill-card-icon" data-category={skill.category} aria-hidden>
                {skill.name.charAt(0)}
              </div>
              <div className="skill-card-info">
                <div className="skill-card-name">
                  {skill.name}
                  {isInstalled && (
                    <i
                      className="codicon codicon-check skill-card-check"
                      title="Instalada"
                      aria-label="Instalada"
                    />
                  )}
                </div>
                <div className="skill-card-tagline">{skill.tagline}</div>
              </div>
              <div className="skill-card-actions">
                {isInstalled ? (
                  <a
                    className="skill-card-link"
                    href={skill.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Ver no GitHub"
                    aria-label="Abrir repositório no GitHub"
                  >
                    <i className="codicon codicon-link-external" />
                  </a>
                ) : (
                  <button
                    type="button"
                    className="skill-card-install"
                    onClick={() => void installSkill(skill)}
                    disabled={isInstalling}
                    title={isInstalling ? 'Instalando…' : `Instalar ${skill.name}`}
                  >
                    {isInstalling ? (
                      <>
                        <i className="codicon codicon-loading codicon-modifier-spin" />
                        <span>Instalando</span>
                      </>
                    ) : (
                      <>
                        <i className="codicon codicon-cloud-download" />
                        <span>Instalar</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
