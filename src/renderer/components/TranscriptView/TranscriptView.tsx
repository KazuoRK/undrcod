/**
 * TranscriptView — popover de "Visualizacao de transcrição" (Antigravity-style).
 *
 * 4 modos: Normal | Pensando | Detalhado | Resumo
 * 3 tamanhos de fonte: Aa (sm / md / lg)
 * Atalho: Ctrl+O
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import './TranscriptView.css';

export type TranscriptMode = 'normal' | 'thinking' | 'detailed' | 'summary';
export type TranscriptFontSize = 'sm' | 'md' | 'lg';

interface TranscriptViewProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  mode: TranscriptMode;
  fontSize: TranscriptFontSize;
  onModeChange: (mode: TranscriptMode) => void;
  onFontSizeChange: (size: TranscriptFontSize) => void;
}

/**
 * Modos de visualização do transcript. Cada modo controla o que aparece no chat:
 *   - normal:   user/assistant + tool calls colapsadas (default)
 *   - thinking: foca em thinking blocks (raciocinio do Claude expandido)
 *   - detailed: tudo expandido — tool inputs, outputs, thinking, meta events
 *   - summary:  só user/assistant text (esconde tool calls e thinking — pra revisao rapida)
 */
const MODES: { id: TranscriptMode; label: string; icon: string; description: string }[] = [
  { id: 'normal', label: 'Normal', icon: 'output', description: 'Chat padrão — mensagens e ferramentas colapsadas' },
  { id: 'thinking', label: 'Pensando', icon: 'lightbulb', description: 'Foca no raciocínio — thinking blocks expandidos' },
  { id: 'detailed', label: 'Detalhado', icon: 'list-flat', description: 'Tudo expandido — inputs, outputs, thinking e meta' },
  { id: 'summary', label: 'Resumo', icon: 'note', description: 'Só mensagens user/assistant — sem tool calls nem thinking' },
];

/**
 * 3 tamanhos de fonte do chat. Cada chip mostra "Aa" no tamanho que vai aplicar,
 * mais um label compacto abaixo pra remover a ambiguidade ("qual é o atual?").
 */
const FONT_SIZES: { id: TranscriptFontSize; label: string; sublabel: string }[] = [
  { id: 'sm', label: 'Aa', sublabel: 'Pequeno' },
  { id: 'md', label: 'Aa', sublabel: 'Médio' },
  { id: 'lg', label: 'Aa', sublabel: 'Grande' },
];

export function TranscriptView({
  open,
  onClose,
  anchorRef,
  mode,
  fontSize,
  onModeChange,
  onFontSizeChange,
}: TranscriptViewProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  // Fallback position: 48px abaixo do topbar (~32px topbar + margem), 16px do
  // right edge. Usado quando anchorRef ainda não montou (ex: chat pane fechado).
  const [position, setPosition] = useState<{ top: number; right: number }>({ top: 48, right: 16 });

  // Calcula posição abaixo do anchor. Se anchor não existe, usa fallback do
  // canto top-right (em vez de 0,0 que ficaria escondido atrás do topbar).
  useEffect(() => {
    if (!open) return;
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    } else {
      setPosition({ top: 48, right: 16 });
    }
  }, [open, anchorRef]);

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

  // Click outside fecha
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Timeout pra não pegar o click que abriu
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', onClick);
    }, 10);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className="transcript-view-popover"
      style={{ top: position.top, right: position.right }}
    >
      <div className="transcript-view-header">
        <span className="transcript-view-title">Visualizacao de transcrição</span>
        <span className="transcript-view-shortcut">
          <kbd className="transcript-view-kbd">Ctrl</kbd>
          <kbd className="transcript-view-kbd">O</kbd>
        </span>
      </div>

      <div className="transcript-view-modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`transcript-view-mode ${mode === m.id ? 'is-active' : ''}`}
            onClick={() => onModeChange(m.id)}
            title={m.description}
          >
            <i className={`codicon codicon-${m.icon}`} />
            <div className="transcript-view-mode-text">
              <span className="transcript-view-mode-label">{m.label}</span>
              <span className="transcript-view-mode-desc">{m.description}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="transcript-view-divider" />

      <div className="transcript-view-font-sizes">
        {FONT_SIZES.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`transcript-view-font-btn transcript-view-font-${f.id} ${fontSize === f.id ? 'is-active' : ''}`}
            onClick={() => onFontSizeChange(f.id)}
            title={f.sublabel}
          >
            <span className="transcript-view-font-aa">{f.label}</span>
            <span className="transcript-view-font-sublabel">{f.sublabel}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
