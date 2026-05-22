/**
 * SourceControl — sidebar tipo VS Code que lista arquivos modificados no git.
 *
 * Visual:
 *   - Header: ícone + "Source Control" + branch + ahead/behind badges
 *   - Botão "Commit..." + Pull + Push + Sync + Fetch + Refresh
 *   - Section "Staged" — files com staged=true, header com "Unstage All" + (-) inline
 *   - Section "Changes" — files com staged=false, header com "Stage All" + "Discard All" + (+) inline
 *   - Click num file → abre DiffViewer
 *   - Right-click num file → context menu (Open Diff, Discard, Stage/Unstage)
 *   - Empty state quando working tree clean
 *
 * Auto-fetch quando cwd muda. Manual refresh + após cada action.
 * Dispatch 'undrcod:git-changed' depois de cada mutação pra refresh statusbar.
 */
import { useEffect, useState, useCallback, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { toast } from '../Toast/Toast';
import { confirmDialog } from '../ConfirmDialog/ConfirmDialog';
import './SourceControl.css';

export interface GitStatusFile {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  renamedFrom?: string;
}

interface SourceControlProps {
  cwd: string | null;
  onOpenDiff: (filePath: string) => void;
  onCommit: () => void;
}

/** Mapeia letra de status → label curto + cor accent. */
function statusBadge(status: string): { label: string; color: string } {
  switch (status) {
    case 'M': return { label: 'M', color: 'var(--accent-warning, #d4a657)' };
    case 'A': return { label: 'A', color: 'var(--accent-success, #4caf50)' };
    case 'D': return { label: 'D', color: 'var(--accent-error, #e57373)' };
    case 'R': return { label: 'R', color: 'var(--accent-info, #64b5f6)' };
    case 'C': return { label: 'C', color: 'var(--accent-info, #64b5f6)' };
    case 'U': return { label: 'U', color: 'var(--accent-error, #e57373)' };
    case '?': return { label: 'U', color: 'var(--text-muted, #888)' };
    default: return { label: status || ' ', color: 'var(--text-muted, #888)' };
  }
}

function getFilename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

function getDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}

/** Notifica statusbar + outras subscriptions que o git mudou. */
function dispatchGitChanged(): void {
  window.dispatchEvent(new CustomEvent('undrcod:git-changed'));
}

interface ContextMenuState {
  x: number;
  y: number;
  file: GitStatusFile;
}

export function SourceControl({ cwd, onOpenDiff, onCommit }: SourceControlProps) {
  const [status, setStatus] = useState<{
    branch: string;
    upstream?: string;
    ahead: number;
    behind: number;
    files: GitStatusFile[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Loading states pra Pull/Push/Sync/Fetch — desabilita botoes + spinner. */
  const [remoteBusy, setRemoteBusy] = useState<null | 'pull' | 'push' | 'sync' | 'fetch'>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!cwd) {
      setStatus(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await window.undrcodAPI?.git.status(cwd);
      setStatus(r);
    } catch (err: any) {
      setError(err.message || 'Falha ao ler git status');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => { refresh(); }, [refresh]);

  // Listen pra mudancas externas (CommitDialog, statusbar etc) — auto-refresh
  useEffect(() => {
    const onChange = (): void => { refresh(); };
    window.addEventListener('undrcod:git-changed', onChange);
    return () => window.removeEventListener('undrcod:git-changed', onChange);
  }, [refresh]);

  // Fecha context menu em click fora + escape
  useEffect(() => {
    if (!ctxMenu) return;
    const onDocClick = (e: MouseEvent): void => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  const handleStage = useCallback(async (filePath: string) => {
    if (!cwd) return;
    const r = await window.undrcodAPI?.git.stage(cwd, filePath);
    if ('error' in r) {
      toast.error('Stage falhou', { sub: r.error });
    } else {
      dispatchGitChanged();
      refresh();
    }
  }, [cwd, refresh]);

  const handleUnstage = useCallback(async (filePath: string) => {
    if (!cwd) return;
    const r = await window.undrcodAPI?.git.unstage(cwd, filePath);
    if ('error' in r) {
      toast.error('Unstage falhou', { sub: r.error });
    } else {
      dispatchGitChanged();
      refresh();
    }
  }, [cwd, refresh]);

  const handleStageAll = useCallback(async () => {
    if (!cwd) return;
    const r = await window.undrcodAPI?.git.stageAll(cwd);
    if ('error' in r) {
      toast.error('Stage All falhou', { sub: r.error });
    } else {
      toast.success('Todos arquivos staged');
      dispatchGitChanged();
      refresh();
    }
  }, [cwd, refresh]);

  const handleUnstageAll = useCallback(async () => {
    if (!cwd) return;
    const r = await window.undrcodAPI?.git.unstageAll(cwd);
    if ('error' in r) {
      toast.error('Unstage All falhou', { sub: r.error });
    } else {
      toast.success('Todos arquivos unstaged');
      dispatchGitChanged();
      refresh();
    }
  }, [cwd, refresh]);

  const handleDiscardFile = useCallback(async (file: GitStatusFile) => {
    if (!cwd) return;
    const ok = await confirmDialog({
      title: 'Descartar mudanças',
      message: `Tem certeza que quer descartar as mudanças em "${file.path}"?\n\nEsta ação é IRREVERSÍVEL — as edições não serão recuperáveis.`,
      confirmLabel: 'Descartar',
      cancelLabel: 'Cancelar',
      destructive: true,
    });
    if (!ok) return;
    const r = await window.undrcodAPI?.git.discardFile(cwd, file.path);
    if ('error' in r) {
      toast.error('Discard falhou', { sub: r.error });
    } else {
      toast.success(`Descartado: ${getFilename(file.path)}`);
      dispatchGitChanged();
      refresh();
    }
  }, [cwd, refresh]);

  const handleDiscardAll = useCallback(async () => {
    if (!cwd) return;
    const ok = await confirmDialog({
      title: 'Descartar TODAS as mudanças',
      message:
        'Tem certeza que quer descartar TODAS as mudanças não-comitadas?\n\n' +
        'Vai reverter arquivos modificados + remover arquivos untracked.\n' +
        'Esta ação é IRREVERSÍVEL.',
      confirmLabel: 'Descartar Tudo',
      cancelLabel: 'Cancelar',
      destructive: true,
    });
    if (!ok) return;
    const r = await window.undrcodAPI?.git.discardAll(cwd);
    if ('error' in r) {
      toast.error('Discard All falhou', { sub: r.error });
    } else {
      toast.success('Todas mudanças descartadas');
      dispatchGitChanged();
      refresh();
    }
  }, [cwd, refresh]);

  const handlePull = useCallback(async () => {
    if (!cwd || remoteBusy) return;
    setRemoteBusy('pull');
    try {
      const r = await window.undrcodAPI?.git.pull(cwd);
      if ('error' in r) {
        toast.error('Pull falhou', { sub: r.error });
      } else {
        toast.success('Pull concluído', { sub: r.output.split('\n')[0] });
        dispatchGitChanged();
        refresh();
      }
    } finally {
      setRemoteBusy(null);
    }
  }, [cwd, refresh, remoteBusy]);

  const handlePush = useCallback(async () => {
    if (!cwd || remoteBusy) return;
    setRemoteBusy('push');
    try {
      const r = await window.undrcodAPI?.git.push(cwd);
      if ('error' in r) {
        toast.error('Push falhou', { sub: r.error });
      } else {
        toast.success('Push concluído', { sub: r.output.split('\n')[0] });
        dispatchGitChanged();
        refresh();
      }
    } finally {
      setRemoteBusy(null);
    }
  }, [cwd, refresh, remoteBusy]);

  const handleSync = useCallback(async () => {
    if (!cwd || remoteBusy) return;
    setRemoteBusy('sync');
    try {
      const pullRes = await window.undrcodAPI?.git.pull(cwd);
      if ('error' in pullRes) {
        toast.error('Sync falhou no pull', { sub: pullRes.error });
        return;
      }
      const pushRes = await window.undrcodAPI?.git.push(cwd);
      if ('error' in pushRes) {
        toast.error('Sync falhou no push', { sub: pushRes.error });
        return;
      }
      toast.success('Sync concluído (pull + push)');
      dispatchGitChanged();
      refresh();
    } finally {
      setRemoteBusy(null);
    }
  }, [cwd, refresh, remoteBusy]);

  const handleFetch = useCallback(async () => {
    if (!cwd || remoteBusy) return;
    setRemoteBusy('fetch');
    try {
      const r = await window.undrcodAPI?.git.fetch(cwd);
      if ('error' in r) {
        toast.error('Fetch falhou', { sub: r.error });
      } else {
        toast.success('Fetch concluído');
        dispatchGitChanged();
        refresh();
      }
    } finally {
      setRemoteBusy(null);
    }
  }, [cwd, refresh, remoteBusy]);

  /**
   * "vs main" — diff cumulativo da branch atual contra origin/main (fallback main).
   * Empacota TODOS os arquivos num único payload e despacha 'undrcod:diff-vs-branch'.
   */
  const handleDiffVsMain = useCallback(async () => {
    if (!cwd) return;
    setError(null);
    try {
      let res = await window.undrcodAPI?.git.diffVsBranch(cwd, 'origin/main');
      let usedBranch = 'origin/main';
      if (!res.files || res.files.length === 0) {
        const local = await window.undrcodAPI?.git.diffVsBranch(cwd, 'main');
        if (local.files && local.files.length > 0) {
          res = local;
          usedBranch = 'main';
        }
      }
      window.dispatchEvent(
        new CustomEvent('undrcod:diff-vs-branch', {
          detail: { branch: usedBranch, files: res.files || [] },
        }),
      );
    } catch (err: any) {
      toast.error('Diff vs main falhou', { sub: err.message || String(err) });
    }
  }, [cwd]);

  const handleFileContextMenu = useCallback((e: ReactMouseEvent, file: GitStatusFile) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, file });
  }, []);

  if (!cwd) {
    return (
      <div className="sc-empty-wrap">
        <i className="codicon codicon-source-control sc-empty-icon" />
        <div className="sc-empty-title">Sem workspace</div>
        <div className="sc-empty-hint">Abra uma pasta git pra ver mudanças.</div>
      </div>
    );
  }

  const staged = status?.files.filter((f) => f.staged) || [];
  const changes = status?.files.filter((f) => !f.staged) || [];
  const total = (status?.files.length) || 0;
  const hasUpstream = !!status?.upstream;
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;

  return (
    <div className="sc-root">
      <div className="sc-header">
        <div className="sc-title">
          <i className="codicon codicon-source-control" />
          <span>Source Control</span>
          {status?.branch && (
            <span className="sc-branch">
              {status.branch}
              {(ahead > 0 || behind > 0) && (
                <span className="sc-ab-badges">
                  {behind > 0 && (
                    <span className="sc-ab-badge sc-ab-behind" title={`${behind} commits behind upstream`}>
                      <i className="codicon codicon-arrow-down" />{behind}
                    </span>
                  )}
                  {ahead > 0 && (
                    <span className="sc-ab-badge sc-ab-ahead" title={`${ahead} commits ahead upstream`}>
                      <i className="codicon codicon-arrow-up" />{ahead}
                    </span>
                  )}
                </span>
              )}
            </span>
          )}
        </div>
        <div className="sc-header-actions">
          <button
            type="button"
            className="sc-btn sc-btn-primary"
            disabled={staged.length === 0}
            onClick={onCommit}
            title={staged.length === 0 ? 'Stage arquivos primeiro' : `Commit ${staged.length} arquivo(s)`}
          >
            <i className="codicon codicon-check" /> Commit
          </button>
          <button
            type="button"
            className="sc-btn"
            onClick={handleDiffVsMain}
            title="Diff cumulativo da branch atual vs origin/main (fallback main)"
          >
            <i className="codicon codicon-git-compare" /> vs main
          </button>
        </div>
        <div className="sc-header-remote-actions">
          <button
            type="button"
            className="sc-btn-icon"
            onClick={handleSync}
            disabled={!hasUpstream || !!remoteBusy}
            title={hasUpstream ? 'Sync (Pull + Push)' : 'Sem upstream configurado'}
          >
            <i className={`codicon ${remoteBusy === 'sync' ? 'codicon-loading codicon-modifier-spin' : 'codicon-sync'}`} />
          </button>
          <button
            type="button"
            className="sc-btn-icon"
            onClick={handlePull}
            disabled={!!remoteBusy}
            title={behind > 0 ? `Pull (${behind} behind)` : 'Pull'}
          >
            <i className={`codicon ${remoteBusy === 'pull' ? 'codicon-loading codicon-modifier-spin' : 'codicon-arrow-down'}`} />
          </button>
          <button
            type="button"
            className="sc-btn-icon"
            onClick={handlePush}
            disabled={!!remoteBusy}
            title={ahead > 0 ? `Push (${ahead} ahead)` : 'Push'}
          >
            <i className={`codicon ${remoteBusy === 'push' ? 'codicon-loading codicon-modifier-spin' : 'codicon-arrow-up'}`} />
          </button>
          <button
            type="button"
            className="sc-btn-icon"
            onClick={handleFetch}
            disabled={!!remoteBusy}
            title="Fetch (atualiza refs remotos)"
          >
            <i className={`codicon ${remoteBusy === 'fetch' ? 'codicon-loading codicon-modifier-spin' : 'codicon-cloud-download'}`} />
          </button>
          <button
            type="button"
            className="sc-btn-icon"
            onClick={refresh}
            title="Atualizar status (re-fetch git status)"
          >
            <i className="codicon codicon-refresh" />
          </button>
        </div>
      </div>

      {error && (
        <div className="sc-error">
          <i className="codicon codicon-warning" /> {error}
        </div>
      )}

      {loading && !status && (
        <div className="sc-loading">carregando...</div>
      )}

      {!loading && total === 0 && status && (
        <div className="sc-empty-wrap">
          <i className="codicon codicon-check sc-empty-icon sc-empty-clean" />
          <div className="sc-empty-title">Working tree clean</div>
          <div className="sc-empty-hint">Nada pra commitar.</div>
        </div>
      )}

      {staged.length > 0 && (
        <div className="sc-section">
          <div className="sc-section-header">
            <span>STAGED CHANGES</span>
            <div className="sc-section-header-actions">
              <button
                type="button"
                className="sc-section-action"
                onClick={handleUnstageAll}
                title="Unstage All"
              >
                <i className="codicon codicon-remove" />
              </button>
              <span className="sc-section-count">{staged.length}</span>
            </div>
          </div>
          {staged.map((f) => (
            <FileRow
              key={`staged:${f.path}`}
              file={f}
              onOpenDiff={() => onOpenDiff(f.path)}
              onAction={() => handleUnstage(f.path)}
              actionIcon="remove"
              actionLabel="Unstage"
              statusChar={f.indexStatus}
              onContextMenu={(e) => handleFileContextMenu(e, f)}
            />
          ))}
        </div>
      )}

      {changes.length > 0 && (
        <div className="sc-section">
          <div className="sc-section-header">
            <span>CHANGES</span>
            <div className="sc-section-header-actions">
              <button
                type="button"
                className="sc-section-action sc-section-action-danger"
                onClick={handleDiscardAll}
                title="Discard All Changes"
              >
                <i className="codicon codicon-discard" />
              </button>
              <button
                type="button"
                className="sc-section-action"
                onClick={handleStageAll}
                title="Stage All Changes"
              >
                <i className="codicon codicon-add" />
              </button>
              <span className="sc-section-count">{changes.length}</span>
            </div>
          </div>
          {changes.map((f) => (
            <FileRow
              key={`changes:${f.path}`}
              file={f}
              onOpenDiff={() => onOpenDiff(f.path)}
              onAction={() => handleStage(f.path)}
              actionIcon="add"
              actionLabel="Stage"
              statusChar={f.worktreeStatus !== ' ' ? f.worktreeStatus : f.indexStatus}
              onContextMenu={(e) => handleFileContextMenu(e, f)}
            />
          ))}
        </div>
      )}

      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="sc-ctx-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          role="menu"
        >
          <button
            type="button"
            className="sc-ctx-item"
            onClick={() => { onOpenDiff(ctxMenu.file.path); setCtxMenu(null); }}
          >
            <i className="codicon codicon-diff" /> Open Diff
          </button>
          {ctxMenu.file.staged ? (
            <button
              type="button"
              className="sc-ctx-item"
              onClick={() => { handleUnstage(ctxMenu.file.path); setCtxMenu(null); }}
            >
              <i className="codicon codicon-remove" /> Unstage
            </button>
          ) : (
            <button
              type="button"
              className="sc-ctx-item"
              onClick={() => { handleStage(ctxMenu.file.path); setCtxMenu(null); }}
            >
              <i className="codicon codicon-add" /> Stage
            </button>
          )}
          <div className="sc-ctx-sep" />
          <button
            type="button"
            className="sc-ctx-item sc-ctx-item-danger"
            onClick={() => { handleDiscardFile(ctxMenu.file); setCtxMenu(null); }}
          >
            <i className="codicon codicon-discard" /> Discard Changes
          </button>
        </div>
      )}
    </div>
  );
}

interface FileRowProps {
  file: GitStatusFile;
  onOpenDiff: () => void;
  onAction: () => void;
  actionIcon: 'add' | 'remove';
  actionLabel: string;
  statusChar: string;
  onContextMenu: (e: ReactMouseEvent) => void;
}

function FileRow({ file, onOpenDiff, onAction, actionIcon, actionLabel, statusChar, onContextMenu }: FileRowProps) {
  const badge = statusBadge(statusChar);
  const filename = getFilename(file.path);
  const dir = getDir(file.path);
  return (
    <div className="sc-file-row" onContextMenu={onContextMenu}>
      <button
        type="button"
        className="sc-file-main"
        onClick={onOpenDiff}
        title={`${file.path} — click pra ver diff (right-click pra mais ações)`}
      >
        <span className="sc-filename">{filename}</span>
        {dir && <span className="sc-dir">{dir}</span>}
      </button>
      <span className="sc-status-badge" style={{ color: badge.color }} title={`Status: ${statusChar}`}>
        {badge.label}
      </span>
      <button
        type="button"
        className="sc-file-action"
        onClick={onAction}
        title={actionLabel}
      >
        <i className={`codicon codicon-${actionIcon}`} />
      </button>
    </div>
  );
}
