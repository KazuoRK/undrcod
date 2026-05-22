/**
 * CommitDialog — modal pra inputar mensagem de commit e disparar git:commit.
 *
 * Comportamento:
 *   - Textarea grande pra mensagem (primeira linha = título, resto = corpo)
 *   - Disabled "Commit" se message vazio
 *   - Em sucesso: mostra hash curto por 1.2s + fecha
 *   - Em erro: banner inline (hooks que falham, working tree clean, etc)
 */
import { useEffect, useRef, useState } from 'react';
import { toast } from '../Toast/Toast';
import './CommitDialog.css';

interface CommitDialogProps {
  open: boolean;
  onClose: () => void;
  cwd: string | null;
  stagedCount: number;
  onSuccess?: (hash: string) => void;
}

export function CommitDialog({ open, onClose, cwd, stagedCount, onSuccess }: CommitDialogProps) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [successHash, setSuccessHash] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setMessage('');
      setError(null);
      setSuccessHash(null);
      setSubmitting(false);
      setGenerating(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

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

  const handleGenerate = async () => {
    if (!cwd || generating || submitting) return;
    setGenerating(true);
    try {
      // 1. Pega o diff staged via IPC novo
      const diffRes = await window.undrcodAPI?.git.diffStaged?.(cwd);
      const diff = diffRes?.diff || '';
      if (!diff.trim()) {
        toast.warn('Sem staged changes pra gerar mensagem');
        return;
      }

      // 2. Roda claude one-shot pra gerar mensagem
      const prompt =
        'Gere uma mensagem de commit conventional (feat/fix/chore/refactor/docs/test/style/perf/build/ci/revert) ' +
        'em PORTUGUÊS, primeira linha curta (<60 chars), opcional segundo parágrafo curto explicando o "porquê". ' +
        'Retorne SÓ a mensagem, sem aspas, sem markdown, sem explicação extra.\n\nDIFF:\n\n' +
        diff.slice(0, 8000);

      const out = await window.undrcodAPI?.agent.oneshot?.(cwd, prompt);
      if (!out) {
        toast.error('Falha ao gerar mensagem', { sub: 'IPC indisponível' });
        return;
      }
      if ('error' in out) {
        toast.error('Falha ao gerar mensagem', { sub: out.error });
        return;
      }
      const text = (out.text || '').trim();
      if (!text) {
        toast.warn('Claude retornou vazio — tenta de novo');
        return;
      }
      setMessage(text);
      toast.success('Mensagem gerada — revise antes de commitar');
    } catch (err) {
      toast.error('Falha ao gerar mensagem', { sub: String(err) });
    } finally {
      setGenerating(false);
    }
  };

  const handleSubmit = async () => {
    if (!cwd || !message.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const r = await window.undrcodAPI?.git.commit(cwd, message.trim());
    setSubmitting(false);
    if ('error' in r) {
      setError(r.error);
      toast.error('Commit falhou', { sub: r.error });
      return;
    }
    setSuccessHash(r.hash);
    onSuccess?.(r.hash);
    toast.success(`Commit ${r.hash.slice(0, 7)} criado`, { sub: message.trim().split('\n')[0] });
    // Notifica statusbar/SourceControl pra refresh
    window.dispatchEvent(new CustomEvent('undrcod:git-changed'));
    setTimeout(() => onClose(), 1200);
  };

  if (!open) return null;

  return (
    <div
      className="commit-dialog-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="commit-dialog-modal">
        <div className="commit-dialog-header">
          <span className="commit-dialog-title">
            <i className="codicon codicon-git-commit" />
            <strong>Commit changes</strong>
            <span className="commit-dialog-count">
              {stagedCount} {stagedCount === 1 ? 'arquivo' : 'arquivos'} staged
            </span>
          </span>
          <button
            type="button"
            className="commit-dialog-close"
            onClick={onClose}
            title="Fechar (Esc)"
          >
            <i className="codicon codicon-close" />
          </button>
        </div>

        {successHash !== null ? (
          <div className="commit-dialog-success">
            <i className="codicon codicon-check commit-dialog-success-icon" />
            <div>
              <div className="commit-dialog-success-title">Commit criado</div>
              {successHash && (
                <div className="commit-dialog-success-hash">
                  <code>{successHash}</code>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="commit-dialog-aibar">
              <button
                type="button"
                className="commit-dialog-ai-btn"
                onClick={handleGenerate}
                disabled={generating || submitting || !cwd || stagedCount === 0}
                title={
                  stagedCount === 0
                    ? 'Stage arquivos antes de gerar a mensagem'
                    : 'Gerar mensagem a partir do diff staged via claude CLI'
                }
              >
                {generating ? (
                  <>
                    <i className="codicon codicon-loading codicon-modifier-spin" />
                    gerando...
                  </>
                ) : (
                  <>
                    <i className="codicon codicon-sparkle" />
                    Gerar (AI)
                  </>
                )}
              </button>
            </div>
            <textarea
              ref={textareaRef}
              className="commit-dialog-textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                'Mensagem do commit...\n\n(primeira linha = título, ' +
                'depois linha em branco, depois corpo opcional)'
              }
              rows={8}
              disabled={submitting || generating}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />

            {error && (
              <div className="commit-dialog-error">
                <i className="codicon codicon-warning" /> {error}
              </div>
            )}

            <div className="commit-dialog-footer">
              <span className="commit-dialog-hint">
                Pre-commit hooks vão rodar · <kbd className="kbd">Ctrl</kbd>+<kbd className="kbd">Enter</kbd> envia
              </span>
              <div className="commit-dialog-actions">
                <button
                  type="button"
                  className="commit-dialog-btn"
                  onClick={onClose}
                  disabled={submitting}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="commit-dialog-btn commit-dialog-btn-primary"
                  disabled={!message.trim() || submitting}
                  onClick={handleSubmit}
                >
                  {submitting ? 'Commitando...' : 'Commit'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
