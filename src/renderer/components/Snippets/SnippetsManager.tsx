/**
 * SnippetsManager — modal pra editar a lista de snippets (prompts pré-salvos)
 * que aparecem no popover Ctrl+; do composer.
 *
 * Layout:
 *   overlay
 *     └─ modal (~720px)
 *         ├─ header (título + close)
 *         ├─ body (2 colunas)
 *         │   ├─ lista esquerda (com botão "Novo")
 *         │   └─ editor direita (nome + body + delete)
 *         └─ footer (contagem + dica)
 *
 * Persistência: salva no localStorage imediatamente em cada edit/add/delete
 * (debounce não é necessário — escritas locais são triviais).
 *
 * Reusa o CSS do ShortcutsDialog pra manter consistência visual (mesmo backdrop,
 * radius, animação). Estilos específicos vão em SnippetsManager.css.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadSnippets, saveSnippets, createSnippet, type Snippet } from '../../utils/snippets';
import './SnippetsManager.css';

export interface SnippetsManagerProps {
  open: boolean;
  onClose: () => void;
}

export function SnippetsManager({ open, onClose }: SnippetsManagerProps) {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Carrega ao abrir
  useEffect(() => {
    if (!open) return;
    const list = loadSnippets();
    setSnippets(list);
    setSelectedId(list[0]?.id ?? null);
  }, [open]);

  // Esc fecha
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const selected = useMemo(
    () => snippets.find((s) => s.id === selectedId) ?? null,
    [snippets, selectedId],
  );

  const persist = (next: Snippet[]) => {
    setSnippets(next);
    saveSnippets(next);
  };

  const handleAdd = () => {
    const s = createSnippet('Novo snippet', '');
    const next = [...snippets, s];
    persist(next);
    setSelectedId(s.id);
    // Foca no nome pro user já renomear
    setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 30);
  };

  const handleUpdate = (id: string, patch: Partial<Pick<Snippet, 'name' | 'body'>>) => {
    persist(snippets.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const handleDelete = (id: string) => {
    const idx = snippets.findIndex((s) => s.id === id);
    const next = snippets.filter((s) => s.id !== id);
    persist(next);
    if (selectedId === id) {
      // Seleciona o anterior, ou o primeiro restante, ou null
      const nextSel = next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? null;
      setSelectedId(nextSel);
    }
  };

  if (!open) return null;

  return (
    <div
      className="snippets-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="snippets-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Gerenciar snippets"
      >
        <div className="snippets-header">
          <h2 className="snippets-title">
            <i className="codicon codicon-symbol-snippet" />
            <span>Gerenciar snippets</span>
          </h2>
          <div className="snippets-header-spacer" />
          <button
            type="button"
            className="snippets-close"
            onClick={onClose}
            title="Fechar (Esc)"
            aria-label="Fechar"
          >
            <i className="codicon codicon-close" />
          </button>
        </div>

        <div className="snippets-body">
          {/* Coluna esquerda — lista */}
          <div className="snippets-list-col">
            <button
              type="button"
              className="snippets-add-btn"
              onClick={handleAdd}
              title="Adicionar snippet"
            >
              <i className="codicon codicon-add" />
              <span>Novo snippet</span>
            </button>
            <div className="snippets-list">
              {snippets.length === 0 && (
                <div className="snippets-empty-list">
                  Nenhum snippet ainda.
                </div>
              )}
              {snippets.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`snippets-list-item ${selectedId === s.id ? 'is-selected' : ''}`}
                  onClick={() => setSelectedId(s.id)}
                >
                  <span className="snippets-list-item-name">{s.name || '(sem nome)'}</span>
                  <span className="snippets-list-item-preview">
                    {s.body.slice(0, 60) || '(vazio)'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Coluna direita — editor */}
          <div className="snippets-editor-col">
            {selected ? (
              <>
                <label className="snippets-field">
                  <span className="snippets-field-label">Nome</span>
                  <input
                    ref={nameInputRef}
                    type="text"
                    className="snippets-input"
                    value={selected.name}
                    onChange={(e) => handleUpdate(selected.id, { name: e.target.value })}
                    placeholder="Nome do snippet"
                  />
                </label>
                <label className="snippets-field snippets-field-grow">
                  <span className="snippets-field-label">Conteúdo</span>
                  <textarea
                    className="snippets-textarea"
                    value={selected.body}
                    onChange={(e) => handleUpdate(selected.id, { body: e.target.value })}
                    placeholder="Texto que será inserido no composer..."
                  />
                </label>
                <div className="snippets-editor-actions">
                  <button
                    type="button"
                    className="snippets-delete-btn"
                    onClick={() => handleDelete(selected.id)}
                    title="Deletar snippet"
                  >
                    <i className="codicon codicon-trash" />
                    <span>Deletar</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="snippets-empty-editor">
                <i className="codicon codicon-symbol-snippet" />
                <p>Selecione um snippet à esquerda, ou crie um novo.</p>
              </div>
            )}
          </div>
        </div>

        <div className="snippets-footer">
          <span className="snippets-footer-count">
            {snippets.length} {snippets.length === 1 ? 'snippet' : 'snippets'}
          </span>
          <span className="snippets-footer-hint">
            Use <kbd className="kbd">Ctrl</kbd> <kbd className="kbd">;</kbd> no composer pra abrir o picker
          </span>
        </div>
      </div>
    </div>
  );
}
