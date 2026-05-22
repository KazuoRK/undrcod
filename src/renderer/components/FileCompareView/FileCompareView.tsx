/**
 * FileCompareView — diff side-by-side entre 2 arquivos arbitrários do workspace
 * (não precisa ser do Git). Usa Monaco DiffEditor diretamente.
 *
 * Compõe com CentralTabs via kind: 'compare' { leftPath, rightPath }.
 * Lê ambos conteúdos via undrcodAPI.fs.read e mantém side-by-side editor.
 */
import { useEffect, useMemo, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { inferMonacoLanguage } from '../DiffViewer/diffParser';
import './FileCompareView.css';

interface FileCompareViewProps {
  leftPath: string;
  rightPath: string;
  theme: 'dark' | 'light';
  onClose: () => void;
  /** Root do workspace pra calcular relative path no header. */
  cwd?: string | null;
}

function relativeTo(path: string, cwd: string | null | undefined): string {
  if (!cwd) return path;
  const norm = path.replace(/\\/g, '/');
  const root = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  if (norm.toLowerCase().startsWith(root.toLowerCase() + '/')) {
    return norm.slice(root.length + 1);
  }
  return path;
}

export function FileCompareView({
  leftPath,
  rightPath,
  theme,
  onClose,
  cwd,
}: FileCompareViewProps) {
  const [left, setLeft] = useState<string>('');
  const [right, setRight] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const fs = window.undrcodAPI?.fs;
        if (!fs) {
          if (!cancelled) setError('FS API indisponível');
          return;
        }
        const [l, r] = await Promise.all([fs.readFile(leftPath), fs.readFile(rightPath)]);
        if (cancelled) return;
        if ('error' in l) {
          setError(`Falha lendo ${leftPath}: ${l.error}`);
          return;
        }
        if ('error' in r) {
          setError(`Falha lendo ${rightPath}: ${r.error}`);
          return;
        }
        setLeft(l.content);
        setRight(r.content);
      } catch (err) {
        if (!cancelled) setError(String((err as Error)?.message ?? err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leftPath, rightPath]);

  const language = useMemo(() => inferMonacoLanguage(leftPath), [leftPath]);
  const leftRel = useMemo(() => relativeTo(leftPath, cwd), [leftPath, cwd]);
  const rightRel = useMemo(() => relativeTo(rightPath, cwd), [rightPath, cwd]);

  return (
    <div className="file-compare-view">
      <div className="file-compare-header">
        <div className="file-compare-paths">
          <i className="codicon codicon-diff" />
          <span className="file-compare-path is-left" title={leftPath}>{leftRel}</span>
          <span className="file-compare-sep">↔</span>
          <span className="file-compare-path is-right" title={rightPath}>{rightRel}</span>
        </div>
        <button
          type="button"
          className="file-compare-close"
          onClick={onClose}
          title="Fechar comparação"
        >
          <i className="codicon codicon-close" />
        </button>
      </div>
      <div className="file-compare-body">
        {loading && (
          <div className="file-compare-empty">
            <i className="codicon codicon-loading codicon-modifier-spin" />
            <span>Carregando…</span>
          </div>
        )}
        {error && (
          <div className="file-compare-empty is-error">
            <i className="codicon codicon-error" />
            <span>{error}</span>
          </div>
        )}
        {!loading && !error && (
          <DiffEditor
            original={left}
            modified={right}
            language={language}
            theme={theme === 'dark' ? 'vs-dark' : 'vs'}
            options={{
              readOnly: true,
              renderSideBySide: true,
              originalEditable: false,
              minimap: { enabled: false },
              fontSize: 13,
              automaticLayout: true,
              scrollBeyondLastLine: false,
              renderWhitespace: 'none',
            }}
          />
        )}
      </div>
    </div>
  );
}
