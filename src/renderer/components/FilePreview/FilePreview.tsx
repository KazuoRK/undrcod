import { useEffect, useState, useCallback } from 'react';
import { getFileIcon } from '../../utils/fileIcon';
import { MonacoEditor } from '../MonacoEditor/MonacoEditor';
import { MarkdownPreview } from './MarkdownPreview';
import { detectLanguage } from '../../utils/languageDetect';
import { toast } from '../Toast/Toast';
import './FilePreview.css';

interface FilePreviewProps {
  path: string;
  cwd: string;
  onClose: () => void;
  onMention?: (relPath: string) => void;
  /** Conteúdo dirty (não-salvo) — se presente, é o que o editor mostra. */
  dirtyContent?: string;
  /** Disparado a cada mudança no editor (pra parent rastrear dirty state). */
  onContentChange?: (newContent: string) => void;
  /** Disparado em Ctrl+S — parent grava no disco. */
  onSave?: (newContent: string) => void;
  /** Tema atual da app — mapeado pra monaco vs/vs-dark. */
  theme?: 'dark' | 'light';
  /** Quando renderizado dentro de uma CentralTab, esconde header próprio (a tab já mostra nome+close). */
  hideHeader?: boolean;
  /** Linha pra navegar quando o Monaco montar — repasse pra grep result navigation. */
  gotoLine?: number;
  /** Coluna inicial do match (0-indexed) — destaca só o range exato no Monaco. */
  matchStart?: number;
  /** Coluna final do match (0-indexed, exclusive). */
  matchEnd?: number;
}

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp',
  'pdf', 'zip', 'tar', 'gz', '7z',
  'mp3', 'mp4', 'wav', 'mov', 'avi', 'webm',
  'exe', 'dll', 'só', 'dylib',
  'afdesign', 'afphoto'
]);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico']);

function getExt(path: string): string {
  const m = path.match(/\.([^./\\]+)$/);
  return m ? m[1].toLowerCase() : '';
}


export function FilePreview({
  path,
  cwd,
  onClose,
  onMention,
  dirtyContent,
  onContentChange,
  onSave,
  theme = 'dark',
  hideHeader = false,
  gotoLine,
  matchStart,
  matchEnd,
}: FilePreviewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  // Setting `formatOnSave` lido via IPC — quando true, MonacoEditor roda
  // formatDocument antes de chamar onSave. Mantém em sync via onChanged listener.
  const [formatOnSave, setFormatOnSave] = useState<boolean>(false);
  // Setting `formatOnPaste` — quando true, Monaco aplica formatação ao colar.
  const [formatOnPaste, setFormatOnPaste] = useState<boolean>(false);
  // Mesmo padrão pros 3 toggles novos do editor (bracket colorization, sticky scroll,
  // smooth caret). Defaults true espelham UndrSettings; vai sobreescrever quando IPC retorna.
  const [bracketPairColorization, setBracketPairColorization] = useState<boolean>(true);
  const [stickyScroll, setStickyScroll] = useState<boolean>(true);
  const [smoothCaret, setSmoothCaret] = useState<boolean>(true);
  // Defaults pra wordWrap / minimap / lineNumbers — espelham UndrSettings.
  // wordWrap default true mantém comportamento original do Monaco.
  // minimap default FALSE — user pode ativar em Settings se quiser.
  const [editorWordWrap, setEditorWordWrap] = useState<boolean>(true);
  const [editorMinimap, setEditorMinimap] = useState<boolean>(false);
  const [editorLineNumbers, setEditorLineNumbers] = useState<boolean>(true);
  // Tab size em espaços. Default 4 (espelha DEFAULT_SETTINGS.editorTabWidth).
  const [editorTabWidth, setEditorTabWidth] = useState<number>(4);
  // Render whitespace / control chars — toggles do View > Appearance menu.
  const [editorRenderWhitespace, setEditorRenderWhitespace] = useState<boolean>(false);
  const [editorRenderControlChars, setEditorRenderControlChars] = useState<boolean>(false);
  // Detect indentation auto-magic do Monaco. Default true (igual VS Code).
  // Quando true, Monaco infere tabSize de cada arquivo aberto e IGNORA o setting
  // pra esse arquivo. Quando false, força sempre `editorTabWidth`.
  const [editorDetectIndentation, setEditorDetectIndentation] = useState<boolean>(true);
  // Markdown view mode: 'edit' (só Monaco), 'split' (Monaco + preview lado-a-lado),
  // 'preview' (só preview renderizado). Reseta quando troca de arquivo.
  const [markdownMode, setMarkdownMode] = useState<'edit' | 'split' | 'preview'>('edit');

  const ext = getExt(path);
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const isBinary = BINARY_EXTENSIONS.has(ext);
  const isMarkdown = ext === 'md' || ext === 'markdown';
  const language = detectLanguage(path);

  const relativeName = path.startsWith(cwd)
    ? path.slice(cwd.length).replace(/\\/g, '/').replace(/^\//, '')
    : path.replace(/\\/g, '/');

  const filename = path.split(/[\\/]/).pop() || path;
  const iconInfo = getFileIcon(filename);

  useEffect(() => {
    setContent(null);
    setError(null);
    setSize(null);
    setImageDataUrl(null);

    // Pega size
    window.undrcodAPI?.fs.stat(path).then((s) => {
      if ('size' in s) setSize(s.size);
    });

    // Pra imagens, busca data URL via IPC (CSP bloqueia file:// no img-src).
    if (isImage) {
      window.undrcodAPI?.fs.readFileAsDataUrl(path).then((r) => {
        if ('error' in r) setError(r.error);
        else setImageDataUrl(r.dataUrl);
      });
      return;
    }

    // Troca de path = volta pro edit mode, pra não confundir o user.
    setMarkdownMode('edit');

    if (isBinary) return; // não tenta ler como texto nem como imagem

    window.undrcodAPI?.fs.readFile(path).then((r) => {
      if ('error' in r) {
        setError(r.error);
      } else {
        // Trunca se muito grande pra não travar renderer / monaco.
        // 200KB cobre 99% dos códigos; arquivos maiores ficam read-only via mensagem.
        const MAX = 200_000;
        if (r.content.length > MAX) {
          setContent(r.content.slice(0, MAX) + '\n\n... (truncado em 200KB)');
        } else {
          setContent(r.content);
        }
      }
    });
  }, [path, isImage, isBinary]);

  // Listener pra "Revert File" — re-lê do disco quando o evento chega com nosso path.
  // App.tsx removeu o dirty content; aqui forçamos re-fetch caso o arquivo tenha
  // sido modificado externamente entre a abertura e o revert.
  useEffect(() => {
    function onRevert(ev: Event): void {
      const detail = (ev as CustomEvent<{ path: string }>).detail;
      if (detail?.path !== path) return;
      window.undrcodAPI?.fs.readFile(path).then((r) => {
        if ('error' in r) return;
        const MAX = 200_000;
        setContent(r.content.length > MAX ? r.content.slice(0, MAX) + '\n\n... (truncado em 200KB)' : r.content);
      }).catch(() => { /* ignore */ });
    }
    window.addEventListener('undrcod:revert-file', onRevert);
    return () => window.removeEventListener('undrcod:revert-file', onRevert);
  }, [path]);

  // Listener pra mudanças externas do file watcher (chokidar). Se o arquivo
  // aberto foi modificado por outra ferramenta (Claude CLI, outro editor,
  // git checkout), re-lê do disco — exceto se está dirty (user tem edits
  // não salvos), pra não perder trabalho. Mesma estratégia do VS Code.
  useEffect(() => {
    function onExternalChange(ev: Event): void {
      const detail = (ev as CustomEvent<{ path: string }>).detail;
      if (detail?.path !== path) return;
      // Skip se arquivo está dirty (user tem changes não salvos no buffer).
      // O dirty state vive em App via dirtyContents map — checa via custom event.
      // Por enquanto: re-lê sempre. TODO: respeitar dirty state.
      window.undrcodAPI?.fs.readFile(path).then((r) => {
        if ('error' in r) return;
        const MAX = 200_000;
        const nextContent = r.content.length > MAX
          ? r.content.slice(0, MAX) + '\n\n... (truncado em 200KB)'
          : r.content;
        // Compara antes de setar — evita re-render se conteúdo não mudou
        // (chokidar pode disparar mesmo evento mais de uma vez).
        setContent((prev) => (prev === nextContent ? prev : nextContent));
      }).catch(() => { /* ignore */ });
    }
    window.addEventListener('undrcod:file-changed-externally', onExternalChange);
    return () => window.removeEventListener('undrcod:file-changed-externally', onExternalChange);
  }, [path]);

  // Lê formatOnSave do settings (electron-store via IPC) e mantém em sync com
  // mudanças vindas do SettingsModal. Mesmo padrão de outros consumidores
  // (App.tsx pra theme): leitura inicial + subscribe em settings:changed.
  useEffect(() => {
    const api = window.undrcodAPI?.settings;
    if (!api) return;
    let cancelled = false;
    api.get?.('formatOnSave').then((v) => {
      if (!cancelled && typeof v === 'boolean') setFormatOnSave(v);
    }).catch(() => { /* ignore */ });
    api.get?.('formatOnPaste').then((v) => {
      if (!cancelled && typeof v === 'boolean') setFormatOnPaste(v);
    }).catch(() => { /* ignore */ });
    api.get?.('bracketPairColorization').then((v) => {
      if (!cancelled && typeof v === 'boolean') setBracketPairColorization(v);
    }).catch(() => { /* ignore */ });
    api.get?.('stickyScroll').then((v) => {
      if (!cancelled && typeof v === 'boolean') setStickyScroll(v);
    }).catch(() => { /* ignore */ });
    api.get?.('smoothCaret').then((v) => {
      if (!cancelled && typeof v === 'boolean') setSmoothCaret(v);
    }).catch(() => { /* ignore */ });
    api.get?.('editorWordWrap').then((v) => {
      if (!cancelled && typeof v === 'boolean') setEditorWordWrap(v);
    }).catch(() => { /* ignore */ });
    api.get?.('editorMinimap').then((v) => {
      if (!cancelled && typeof v === 'boolean') setEditorMinimap(v);
    }).catch(() => { /* ignore */ });
    api.get?.('editorLineNumbers').then((v) => {
      if (!cancelled && typeof v === 'boolean') setEditorLineNumbers(v);
    }).catch(() => { /* ignore */ });
    api.get?.('editorTabWidth').then((v) => {
      if (!cancelled && typeof v === 'number' && (v === 2 || v === 4)) setEditorTabWidth(v);
    }).catch(() => { /* ignore */ });
    api.get?.('editorRenderWhitespace').then((v) => {
      if (!cancelled && typeof v === 'boolean') setEditorRenderWhitespace(v);
    }).catch(() => { /* ignore */ });
    api.get?.('editorRenderControlChars').then((v) => {
      if (!cancelled && typeof v === 'boolean') setEditorRenderControlChars(v);
    }).catch(() => { /* ignore */ });
    api.get?.('editorDetectIndentation').then((v) => {
      if (!cancelled && typeof v === 'boolean') setEditorDetectIndentation(v);
    }).catch(() => { /* ignore */ });
    const off = api.onChanged?.((key, value) => {
      if (key === 'formatOnSave' && typeof value === 'boolean') {
        setFormatOnSave(value);
      } else if (key === 'formatOnPaste' && typeof value === 'boolean') {
        setFormatOnPaste(value);
      } else if (key === 'bracketPairColorization' && typeof value === 'boolean') {
        setBracketPairColorization(value);
      } else if (key === 'stickyScroll' && typeof value === 'boolean') {
        setStickyScroll(value);
      } else if (key === 'smoothCaret' && typeof value === 'boolean') {
        setSmoothCaret(value);
      } else if (key === 'editorWordWrap' && typeof value === 'boolean') {
        setEditorWordWrap(value);
      } else if (key === 'editorMinimap' && typeof value === 'boolean') {
        setEditorMinimap(value);
      } else if (key === 'editorLineNumbers' && typeof value === 'boolean') {
        setEditorLineNumbers(value);
      } else if (key === 'editorTabWidth' && typeof value === 'number' && (value === 2 || value === 4)) {
        setEditorTabWidth(value);
      } else if (key === 'editorRenderWhitespace' && typeof value === 'boolean') {
        setEditorRenderWhitespace(value);
      } else if (key === 'editorRenderControlChars' && typeof value === 'boolean') {
        setEditorRenderControlChars(value);
      } else if (key === 'editorDetectIndentation' && typeof value === 'boolean') {
        setEditorDetectIndentation(value);
      }
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  const handleMention = useCallback(() => {
    onMention?.(relativeName);
  }, [onMention, relativeName]);

  const handleRevealInTree = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('undrcod:reveal-in-tree', { detail: { path } }),
    );
  }, [path]);

  const handleFormatJson = useCallback(() => {
    const current = dirtyContent !== undefined ? dirtyContent : content;
    if (current === null || current === undefined) return;
    try {
      const parsed = JSON.parse(current);
      const formatted = JSON.stringify(parsed, null, 2);
      if (formatted === current) {
        toast.info('JSON já está formatado');
        return;
      }
      onContentChange?.(formatted);
      toast.success('JSON formatado — Ctrl+S pra salvar');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('JSON inválido', { sub: msg });
    }
  }, [content, dirtyContent, onContentChange]);

  const handleEditorChange = useCallback(
    (newContent: string) => {
      onContentChange?.(newContent);
    },
    [onContentChange],
  );

  const handleEditorSave = useCallback(
    (newContent: string) => {
      // CRÍTICO: atualiza content interno ANTES de chamar onSave parent.
      // Senão, quando parent limpa dirtyContents Map, FilePreview re-renderiza
      // mostrando o content VELHO do disco (lido no useEffect inicial) e o user
      // acha que perdeu o trabalho. Aqui sincronizamos o "espelho local" com o
      // que vai pro disco.
      setContent(newContent);
      onSave?.(newContent);
    },
    [onSave],
  );

  const sizeLabel = size === null
    ? '...'
    : size < 1024
      ? `${size} B`
      : size < 1024 * 1024
        ? `${(size / 1024).toFixed(1)} KB`
        : `${(size / 1024 / 1024).toFixed(1)} MB`;

  // Conteúdo efetivamente exibido no editor — dirty (não-salvo) tem prioridade
  // sobre o que foi lido do disco. Isso preserva edits ao re-renderizar.
  const editorContent = dirtyContent !== undefined ? dirtyContent : content;

  return (
    <div className="file-preview">
      {!hideHeader && (
        <div className="file-preview-header">
          <div className="file-preview-info">
            <i
              className={`codicon codicon-${iconInfo.icon} file-preview-icon`}
              style={iconInfo.color ? { color: iconInfo.color } : undefined}
            />
            {/* Breadcrumbs — path do arquivo com segments clicáveis.
                Cada segment de folder dispara `undrcod:reveal-in-tree-folder` event
                pra abrir esse folder na FileTree. Last segment = filename, não clicável. */}
            <div className="file-preview-breadcrumbs" title={path}>
              {(() => {
                const parts = relativeName.split('/').filter(Boolean);
                return parts.map((seg, i) => {
                  const isLast = i === parts.length - 1;
                  const cumulative = parts.slice(0, i + 1).join('/');
                  return (
                    <span key={i} className="file-preview-bc-seg-wrap">
                      {i > 0 && (
                        <i className="codicon codicon-chevron-right file-preview-bc-sep" />
                      )}
                      {isLast ? (
                        <span className="file-preview-bc-seg is-file">{seg}</span>
                      ) : (
                        <button
                          type="button"
                          className="file-preview-bc-seg is-folder"
                          onClick={() => {
                            const absolute = cwd
                              ? `${cwd.replace(/\\/g, '/')}/${cumulative}`.replace(/\/+/g, '/')
                              : cumulative;
                            // Reveal usa o handler existente (expande ancestrais + scroll).
                            window.dispatchEvent(new CustomEvent('undrcod:reveal-in-tree', {
                              detail: { path: absolute },
                            }));
                            // E expande o próprio folder pra mostrar seus filhos.
                            setTimeout(() => {
                              window.dispatchEvent(new CustomEvent('undrcod:tree-expand', {
                                detail: { path: absolute },
                              }));
                            }, 80);
                          }}
                          title={`Abrir ${seg}/ na FileTree`}
                        >
                          {seg}
                        </button>
                      )}
                    </span>
                  );
                });
              })()}
            </div>
            <span className="file-preview-meta">{ext || 'text'} · {sizeLabel}</span>
          </div>
          <div className="file-preview-actions">
            {onMention && (
              <button
                className="file-preview-btn"
                onClick={handleMention}
                title="Mencionar no chat como @path"
              >
                <i className="codicon codicon-mention" /> mention
              </button>
            )}
            {ext === 'json' && onContentChange && (
              <button
                className="file-preview-btn"
                onClick={handleFormatJson}
                title="Formatar JSON (2 espaços)"
              >
                <i className="codicon codicon-symbol-array" /> Format
              </button>
            )}
            {isMarkdown && (
              <div className="file-preview-md-mode" role="group" aria-label="Markdown view mode">
                <button
                  className={`file-preview-md-mode-btn${markdownMode === 'edit' ? ' is-active' : ''}`}
                  onClick={() => setMarkdownMode('edit')}
                  title="Só editor"
                >
                  <i className="codicon codicon-edit" />
                </button>
                <button
                  className={`file-preview-md-mode-btn${markdownMode === 'split' ? ' is-active' : ''}`}
                  onClick={() => setMarkdownMode('split')}
                  title="Split: editor + preview lado-a-lado"
                >
                  <i className="codicon codicon-split-horizontal" />
                </button>
                <button
                  className={`file-preview-md-mode-btn${markdownMode === 'preview' ? ' is-active' : ''}`}
                  onClick={() => setMarkdownMode('preview')}
                  title="Só preview renderizado"
                >
                  <i className="codicon codicon-open-preview" />
                </button>
              </div>
            )}
            <button
              className="file-preview-btn"
              onClick={handleRevealInTree}
              title="Revelar no FileTree"
            >
              <i className="codicon codicon-list-tree" />
            </button>
            <button
              className="file-preview-btn file-preview-close"
              onClick={onClose}
              title="Fechar (Esc)"
            >
              <i className="codicon codicon-close" />
            </button>
          </div>
        </div>
      )}

      <div className="file-preview-body">
        {error && (
          <div className="file-preview-error">
            <i className="codicon codicon-warning" /> {error}
          </div>
        )}

        {isImage && (
          <div className="file-preview-image-wrap">
            {/* data URL via IPC — CSP do renderer permite data: mas bloqueia file:. */}
            {imageDataUrl ? (
              <img
                src={imageDataUrl}
                alt={relativeName}
                className="file-preview-image"
              />
            ) : (
              <div className="file-preview-loading">carregando imagem...</div>
            )}
          </div>
        )}

        {isBinary && !isImage && (
          <div className="file-preview-binary">
            arquivo binário · não exibível como texto
          </div>
        )}

        {!isImage && !isBinary && editorContent === null && !error && (
          <div className="file-preview-loading">carregando...</div>
        )}

        {!isImage && !isBinary && editorContent !== null && (() => {
          const monacoEl = (
            <MonacoEditor
              path={path}
              content={editorContent}
              language={language}
              theme={theme}
              onChange={handleEditorChange}
              onSave={handleEditorSave}
              formatOnSave={formatOnSave}
              formatOnPaste={formatOnPaste}
              bracketPairColorization={bracketPairColorization}
              stickyScroll={stickyScroll}
              smoothCaret={smoothCaret}
              wordWrap={editorWordWrap}
              minimap={editorMinimap}
              lineNumbers={editorLineNumbers}
              tabSize={editorTabWidth}
              renderWhitespace={editorRenderWhitespace}
              renderControlChars={editorRenderControlChars}
              detectIndentation={editorDetectIndentation}
              gotoLine={gotoLine}
              matchStart={matchStart}
              matchEnd={matchEnd}
            />
          );
          if (isMarkdown && markdownMode === 'preview') {
            return <MarkdownPreview content={editorContent} />;
          }
          if (isMarkdown && markdownMode === 'split') {
            return (
              <div className="file-preview-md-split">
                <div className="file-preview-md-split-pane is-edit">{monacoEl}</div>
                <div className="file-preview-md-split-divider" />
                <div className="file-preview-md-split-pane is-preview">
                  <MarkdownPreview content={editorContent} />
                </div>
              </div>
            );
          }
          return monacoEl;
        })()}
      </div>
    </div>
  );
}
