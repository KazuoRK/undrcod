/**
 * MentionAutocomplete — popover pra @ mentions de arquivos/pastas.
 * Mostra acima do textarea quando user digita @. Filter fuzzy por query.
 * Enter ou click insere o path. Esc fecha.
 */

import { useEffect, useRef, useState } from 'react';
import type { WorkspaceFile } from '../../utils/workspaceFiles';
import { filterWorkspaceFiles } from '../../utils/workspaceFiles';
import { getFileIcon, getFolderIcon } from '../../utils/fileIcon';
import './MentionAutocomplete.css';

interface MentionAutocompleteProps {
  open: boolean;
  query: string;
  files: WorkspaceFile[];
  anchorRef: React.RefObject<HTMLElement | null>;
  onSelect: (file: WorkspaceFile) => void;
  onClose: () => void;
}

export function MentionAutocomplete({
  open,
  query,
  files,
  anchorRef,
  onSelect,
  onClose,
}: MentionAutocompleteProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [position, setPosition] = useState<{ bottom: number; left: number }>({ bottom: 0, left: 0 });

  const filtered = filterWorkspaceFiles(files, query, 12);

  // Calcula posição relativa ao anchor (textarea)
  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPosition({
      bottom: window.innerHeight - rect.top + 6,
      left: rect.left + 8,
    });
  }, [open, anchorRef, query]);

  // Reset focus quando query muda
  useEffect(() => {
    setFocusedIdx(0);
  }, [query]);

  // Keyboard nav
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIdx((idx) => Math.min(idx + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIdx((idx) => Math.max(idx - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered[focusedIdx]) {
          e.preventDefault();
          onSelect(filtered[focusedIdx]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, true); // capture pra interceptar antes do textarea
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, filtered, focusedIdx, onSelect, onClose]);

  if (!open || filtered.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="mention-autocomplete"
      style={{ bottom: position.bottom, left: position.left }}
    >
      <div className="mention-autocomplete-header">
        <span className="mention-autocomplete-title">arquivos</span>
        <span className="mention-autocomplete-hint">
          {filtered.length} {filtered.length === 1 ? 'resultado' : 'resultados'}
          {query && ` · "${query}"`}
        </span>
      </div>
      {filtered.map((file, idx) => {
        const isFocused = idx === focusedIdx;
        const basename = file.rel.split('/').pop() || file.rel;
        const dirname = file.rel.includes('/') ? file.rel.slice(0, file.rel.lastIndexOf('/')) : '';
        const icon = file.type === 'dir' ? getFolderIcon(basename, false) : getFileIcon(basename);
        return (
          <button
            key={file.rel}
            type="button"
            className={`mention-autocomplete-item ${isFocused ? 'is-focused' : ''}`}
            onMouseEnter={() => setFocusedIdx(idx)}
            onClick={() => onSelect(file)}
          >
            <i
              className={`codicon codicon-${icon.icon} mention-autocomplete-icon`}
              style={icon.color ? { color: icon.color } : undefined}
            />
            <span className="mention-autocomplete-name">{basename}</span>
            {dirname && <span className="mention-autocomplete-dir">{dirname}/</span>}
            {file.type === 'dir' && <span className="mention-autocomplete-badge">folder</span>}
          </button>
        );
      })}
    </div>
  );
}
