/**
 * CheckpointPanel — modal pra revisar/aplicar/deletar snapshots do workspace.
 *
 * Inspirado em Cursor/Antigravity: antes de cada agent turn salvamos snapshot
 * real dos arquivos dirty. Aqui o user vê a lista (com count de arquivos),
 * faz "revert to checkpoint" pra restaurar o estado, ou deleta entradas.
 *
 * IPC: window.undrcodAPI?.checkpoint.{list,revert,delete}. Revert retorna
 * `restored` (quantos arquivos voltaram), exibido no toast.
 */

import { useEffect, useState } from 'react';
import { confirmDialog } from '../ConfirmDialog/ConfirmDialog';
import { toast } from '../Toast/Toast';
import './CheckpointPanel.css';

interface Checkpoint {
  id: string;
  ts: number;
  label: string;
  fileCount: number;
}

interface CheckpointPanelProps {
  open: boolean;
  cwd: string | null;
  onClose: () => void;
}

function formatRelativeTime(ts: number): string {
  if (!ts) return '';
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return diffHour === 1 ? 'há 1 hora' : `há ${diffHour} horas`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return 'ontem';
  if (diffDay < 7) return `há ${diffDay} dias`;
  return new Date(ts).toLocaleDateString('pt-BR');
}

function formatAbsoluteTime(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('pt-BR');
}

function workspaceName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function CheckpointPanel({ open, cwd, onClose }: CheckpointPanelProps) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Refetch ao abrir (snapshot pode ter sido criado por agent enquanto modal estava fechado).
  useEffect(() => {
    if (!open || !cwd) return;
    const fn = window.undrcodAPI?.checkpoint?.list;
    if (typeof fn !== 'function') {
      setCheckpoints([]);
      return;
    }
    setLoading(true);
    fn(cwd).then((res) => {
      setCheckpoints(res.ok ? res.checkpoints : []);
      setLoading(false);
    }).catch(() => {
      setCheckpoints([]);
      setLoading(false);
    });
  }, [open, cwd]);

  // Esc fecha
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function refresh() {
    if (!cwd) return;
    const res = await window.undrcodAPI?.checkpoint.list(cwd);
    setCheckpoints(res.ok ? res.checkpoints : []);
  }

  async function handleRevert(cp: Checkpoint) {
    if (!cwd) return;
    const ok = await confirmDialog({
      title: 'Reverter pra checkpoint?',
      message: `Vai aplicar o snapshot "${cp.label}" (${formatAbsoluteTime(cp.ts)}) e desfazer mudanças posteriores nos arquivos rastreados.`,
      confirmLabel: 'Reverter',
      cancelLabel: 'Cancelar',
      destructive: true,
    });
    if (!ok) return;
    setBusyId(cp.id);
    try {
      const res = await window.undrcodAPI?.checkpoint.revert(cwd, cp.id);
      if (res.ok) {
        const n = res.restored;
        const fileLabel = n === 1 ? 'arquivo' : 'arquivos';
        toast.success(`Revertido ${n} ${fileLabel} pra "${cp.label}"`);
        await refresh();
      } else {
        toast.error(`Falha ao reverter: ${(res as { error: string }).error}`);
      }
    } catch (err) {
      toast.error(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(cp: Checkpoint) {
    if (!cwd) return;
    const ok = await confirmDialog({
      title: 'Deletar checkpoint?',
      message: `Remove "${cp.label}" (${formatAbsoluteTime(cp.ts)}). Não dá pra desfazer.`,
      confirmLabel: 'Deletar',
      cancelLabel: 'Cancelar',
      destructive: true,
    });
    if (!ok) return;
    setBusyId(cp.id);
    try {
      const res = await window.undrcodAPI?.checkpoint.delete(cwd, cp.id);
      if (res.ok) {
        toast.success('Checkpoint removido');
        await refresh();
      } else {
        toast.error(`Falha ao deletar: ${(res as { error: string }).error}`);
      }
    } catch (err) {
      toast.error(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  if (!open) return null;

  const cwdLabel = cwd ? workspaceName(cwd) : '(sem workspace)';

  return (
    <div className="checkpoint-backdrop" onClick={onClose}>
      <div
        className="checkpoint-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Checkpoints"
      >
        <div className="checkpoint-header">
          <div className="checkpoint-header-title">
            <i className="codicon codicon-history checkpoint-header-icon" aria-hidden />
            <span className="checkpoint-title">Checkpoints</span>
            <span className="checkpoint-cwd" title={cwd ?? undefined}>{cwdLabel}</span>
          </div>
          <button
            type="button"
            className="checkpoint-close"
            onClick={onClose}
            title="Fechar (Esc)"
          >
            <i className="codicon codicon-close" />
          </button>
        </div>

        <div className="checkpoint-body">
          {loading ? (
            <div className="checkpoint-empty">
              <i className="codicon codicon-sync~spin" />
              <span>Carregando checkpoints...</span>
            </div>
          ) : !checkpoints || checkpoints.length === 0 ? (
            <div className="checkpoint-empty">
              <i className="codicon codicon-history checkpoint-empty-icon" />
              <div className="checkpoint-empty-title">Nenhum checkpoint salvo</div>
              <div className="checkpoint-empty-hint">
                Snapshots são criados automaticamente antes de cada turno do agente
                (estilo Cursor/Antigravity). Vão aparecer aqui quando a integração rodar.
              </div>
            </div>
          ) : (
            <ul className="checkpoint-list">
              {checkpoints.map((cp) => (
                <li key={cp.id} className="checkpoint-item">
                  <div className="checkpoint-item-icon">
                    <i className="codicon codicon-bookmark" aria-hidden />
                  </div>
                  <div className="checkpoint-item-body">
                    <div className="checkpoint-item-title">{cp.label || 'Checkpoint'}</div>
                    <div className="checkpoint-item-meta">
                      <span className="checkpoint-item-time" title={formatAbsoluteTime(cp.ts)}>
                        <i className="codicon codicon-calendar" aria-hidden />
                        {formatRelativeTime(cp.ts)}
                      </span>
                      <span
                        className="checkpoint-item-files"
                        title="Arquivos no snapshot"
                      >
                        <i className="codicon codicon-files" aria-hidden />
                        {cp.fileCount} {cp.fileCount === 1 ? 'arquivo' : 'arquivos'}
                      </span>
                      <span className="checkpoint-item-id">{cp.id}</span>
                    </div>
                  </div>
                  <div className="checkpoint-item-actions">
                    <button
                      type="button"
                      className="checkpoint-btn checkpoint-btn-primary"
                      onClick={() => handleRevert(cp)}
                      disabled={busyId === cp.id}
                      title="Aplicar este snapshot ao workspace"
                    >
                      <i className="codicon codicon-discard" aria-hidden />
                      Reverter
                    </button>
                    <button
                      type="button"
                      className="checkpoint-btn checkpoint-btn-icon"
                      onClick={() => handleDelete(cp)}
                      disabled={busyId === cp.id}
                      title="Deletar checkpoint"
                      aria-label="Deletar checkpoint"
                    >
                      <i className="codicon codicon-trash" aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="checkpoint-footer">
          <span className="checkpoint-footer-hint">
            {checkpoints && checkpoints.length > 0 && (
              <>
                {checkpoints.length} {checkpoints.length === 1 ? 'checkpoint' : 'checkpoints'}
              </>
            )}
          </span>
          <button type="button" className="checkpoint-btn" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
