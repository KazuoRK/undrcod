/**
 * ContextMenu — menu generico posicionado em (x, y).
 *
 * Trigger via right-click. Fecha em outside-click ou Esc. Items podem ser
 * 'item' (clicaveis) ou 'divider' (separator). Items disabled mostram
 * badge mutado (ex: "em breve") indicando feature planejada.
 */
import { useEffect, useRef } from 'react';
import './ContextMenu.css';

export interface ContextMenuItem {
  kind: 'item' | 'divider';
  /** codicon name sem prefix (ex: 'edit' vira 'codicon-edit') */
  icon?: string;
  label?: string;
  /** keyboard shortcut display, ex: 'F2', 'Del', 'Ctrl C' */
  shortcut?: string;
  /** badge muted a direita (ex: 'em breve') */
  badge?: string;
  disabled?: boolean;
  /** vermelho — pra ações destrutivas tipo 'Apagar' */
  destructive?: boolean;
  onClick?: () => void;
}

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ open, x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Outside click fecha
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // setTimeout pra evitar catching o right-click que abriu
    const t = setTimeout(() => window.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', handler);
    };
  }, [open, onClose]);

  // Esc fecha
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  // Ajusta posição pra não sair da tela. Estimativa simples: 260px x N*28.
  const estimatedWidth = 260;
  const estimatedHeight = items.length * 28 + 16;
  const maxX = Math.max(0, window.innerWidth - estimatedWidth - 8);
  const maxY = Math.max(0, window.innerHeight - estimatedHeight - 8);
  const adjX = Math.min(x, maxX);
  const adjY = Math.min(y, maxY);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: adjX, top: adjY }}
      role="menu"
    >
      {items.map((item, i) => {
        if (item.kind === 'divider') {
          return <div key={`d${i}`} className="context-menu-divider" />;
        }
        return (
          <button
            key={`i${i}-${item.label}`}
            type="button"
            className={`context-menu-item ${item.disabled ? 'is-disabled' : ''} ${item.destructive ? 'is-destructive' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onClick?.();
              onClose();
            }}
            role="menuitem"
          >
            <span className="context-menu-icon">
              {item.icon && <i className={`codicon codicon-${item.icon}`} />}
            </span>
            <span className="context-menu-label">{item.label}</span>
            {item.badge && <span className="context-menu-badge">{item.badge}</span>}
            {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}
