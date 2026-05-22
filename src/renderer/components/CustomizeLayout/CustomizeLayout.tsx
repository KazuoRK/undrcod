/**
 * CustomizeLayout — modal de "Customize Layout..." (VS Code-style).
 * Mostra toggles funcionais pra cada componente do layout do UNDRCOD.
 *
 * Diferente do VS Code, só expomos toggles que de fato controlam algo:
 *   - Primary Side Bar (FileTree)        — Ctrl+B
 *   - Secondary Side Bar (Chat)          — Ctrl+Alt+B
 *   - Panel (Bottom Panel)               — Ctrl+J
 *   - Menu Bar (File menu no topbar)     — sem atalho
 *
 * Status Bar sempre visível (sem toggle).
 */

import { useEffect, useRef } from 'react';
import './CustomizeLayout.css';

interface LayoutToggleRow {
  id: string;
  label: string;
  shortcut?: string[];
  value: boolean;
  onChange: (v: boolean) => void;
}

interface CustomizeLayoutProps {
  open: boolean;
  onClose: () => void;
  toggles: LayoutToggleRow[];
}

export function CustomizeLayout({ open, onClose, toggles }: CustomizeLayoutProps) {
  const modalRef = useRef<HTMLDivElement>(null);

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

  if (!open) return null;

  return (
    <div className="customize-layout-backdrop" onClick={onClose}>
      <div
        ref={modalRef}
        className="customize-layout-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Customize Layout"
      >
        <div className="customize-layout-header">
          <span className="customize-layout-title">Customize Layout</span>
          <button
            type="button"
            className="customize-layout-close"
            onClick={onClose}
            title="Fechar"
          >
            <i className="codicon codicon-close" />
          </button>
        </div>

        <div className="customize-layout-section-title">Visibilidade</div>
        {toggles.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`customize-layout-row ${t.value ? 'is-on' : ''}`}
            onClick={() => t.onChange(!t.value)}
          >
            <span className={`customize-layout-checkbox ${t.value ? 'is-checked' : ''}`}>
              {t.value && <i className="codicon codicon-check" />}
            </span>
            <span className="customize-layout-label">{t.label}</span>
            {t.shortcut && (
              <span className="kbd-row">
                {t.shortcut.map((token, i) => (
                  <kbd key={i} className="kbd">{token}</kbd>
                ))}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
