/**
 * ComposerPopover — popup menu pra Mode/Plus/Mic da composer toolbar.
 * Inspirado no Claude Code: dark popover, items com icon/label/shortcut.
 *
 * Posicionamento: aparece ACIMA do anchor button, alinhado à esquerda.
 * Fecha em: click outside, Esc, click em item.
 */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import './ComposerPopover.css';

/**
 * Renderiza shortcut como kbd boxes separados (estilo Claude Code).
 * Ex: "⇧ Ctrl I" → [⇧] [Ctrl] [I]
 */
function ShortcutChips({ shortcut }: { shortcut: string }) {
  const chunks = shortcut.split(/\s+/).filter(Boolean);
  return (
    <span className="composer-popover-shortcut">
      {chunks.map((chunk, i) => (
        <kbd key={i} className="composer-popover-kbd">
          {chunk}
        </kbd>
      ))}
    </span>
  );
}

export interface PopoverItem {
  kind?: 'item' | 'divider' | 'header' | 'description' | 'section';
  /** codicon name (sem prefixo). Se vazio, espaço reservado pra alinhamento. */
  icon?: string;
  label?: string;
  /** sufixo muted ao lado do label (ex: "Legado") */
  badge?: string;
  /** texto de descrição abaixo (pra items disabled tipo "Ativar nas configurações") */
  description?: string;
  /** keyboard shortcut display (ex: "1", "Ctrl+M") */
  shortcut?: string;
  selected?: boolean;
  disabled?: boolean;
  /** items do submenu — quando presente, mostra chevron à direita e expande no hover/click */
  submenu?: PopoverItem[];
  /** título do submenu (header) */
  submenuTitle?: string;
  /** toggle state (pra items como "Segure para gravar") */
  toggle?: boolean;
  toggleValue?: boolean;
  onClick?: () => void;
}

export interface ComposerPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  items: PopoverItem[];
  /** título opcional do menu (ex: "Modo", "Microfone") */
  title?: string;
  /** shortcut display do title (ex: "⇧ Ctrl M") */
  titleShortcut?: string;
  /** alinha menu à esquerda (default) ou direita do anchor */
  align?: 'left' | 'right';
  /** largura mínima do menu em px (default 240) */
  minWidth?: number;
  /** posição do popover: 'top' (acima do anchor, default) ou 'bottom' (abaixo) */
  placement?: 'top' | 'bottom';
}

export function ComposerPopover({
  open,
  onClose,
  anchorRef,
  items,
  title,
  titleShortcut,
  align = 'left',
  minWidth = 240,
  placement = 'top',
}: ComposerPopoverProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left?: number; right?: number }>({});
  const [submenuOpen, setSubmenuOpen] = useState<number | null>(null);
  const [submenuPos, setSubmenuPos] = useState<{ top: number; left: number } | null>(null);
  const closeSubmenuTimeoutRef = useRef<number | null>(null);

  // Cancela qualquer fechamento pendente do submenu
  const cancelCloseSubmenu = () => {
    if (closeSubmenuTimeoutRef.current !== null) {
      window.clearTimeout(closeSubmenuTimeoutRef.current);
      closeSubmenuTimeoutRef.current = null;
    }
  };

  // Agenda fechamento do submenu em 200ms — tempo pro mouse atravessar gap
  const scheduleCloseSubmenu = () => {
    cancelCloseSubmenu();
    closeSubmenuTimeoutRef.current = window.setTimeout(() => {
      setSubmenuOpen(null);
      setSubmenuPos(null);
      closeSubmenuTimeoutRef.current = null;
    }, 200);
  };

  // Calcula posição relativa ao anchor — useLayoutEffect roda SINCRONAMENTE
  // antes do browser pintar, evitando flicker de popover invisível no primeiro frame.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    if (placement === 'bottom') {
      const top = rect.bottom + 6;
      if (align === 'left') {
        setPosition({ top, left: rect.left });
      } else {
        setPosition({ top, right: window.innerWidth - rect.right });
      }
    } else {
      const bottom = window.innerHeight - rect.top + 6;
      if (align === 'left') {
        setPosition({ bottom, left: rect.left });
      } else {
        setPosition({ bottom, right: window.innerWidth - rect.right });
      }
    }
  }, [open, anchorRef, align, placement]);

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
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    // setTimeout 0 pra evitar trigger no click que abriu
    const t = setTimeout(() => window.addEventListener('mousedown', onClick), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open, onClose, anchorRef]);

  // Reset submenu ao fechar
  useEffect(() => {
    if (!open) {
      setSubmenuOpen(null);
      setSubmenuPos(null);
    }
  }, [open]);

  const openSubmenuAt = (idx: number, target: HTMLElement) => {
    cancelCloseSubmenu();
    const rect = target.getBoundingClientRect();
    const SUBMENU_WIDTH = 240;
    const GAP = 0;
    const MARGIN = 8;

    // Estima altura real baseada nos items do submenu (~32px/item + 12px/divider + paddings)
    const subItems = items[idx]?.submenu ?? [];
    const itemCount = subItems.filter((s) => s.kind !== 'divider').length;
    const dividerCount = subItems.filter((s) => s.kind === 'divider').length;
    const headerHeight = items[idx]?.submenuTitle ? 32 : 0;
    const estimatedHeight = itemCount * 36 + dividerCount * 12 + headerHeight + 16;

    let left = rect.right + GAP;
    if (left + SUBMENU_WIDTH > window.innerWidth - MARGIN) {
      left = rect.left - SUBMENU_WIDTH - GAP;
      if (left < MARGIN) left = MARGIN;
    }

    // Top tenta ficar alinhado com o item parent. Só sobe se realmente não cabe.
    let top = rect.top;
    if (top + estimatedHeight > window.innerHeight - MARGIN) {
      top = window.innerHeight - estimatedHeight - MARGIN;
    }
    if (top < MARGIN) top = MARGIN;

    setSubmenuPos({ top, left });
    setSubmenuOpen(idx);
  };

  if (!open) return null;

  // Position vazio = ainda não calculado pelo useLayoutEffect.
  // Escondemos com visibility:hidden no primeiro frame pra evitar flash.
  const hasPosition = position.top !== undefined || position.bottom !== undefined;

  return (
    <div
      ref={menuRef}
      className="composer-popover"
      style={{
        top: position.top,
        bottom: position.bottom,
        left: position.left,
        right: position.right,
        minWidth: `${minWidth}px`,
        visibility: hasPosition ? 'visible' : 'hidden',
      }}
    >
      {title && (
        <div className="composer-popover-header">
          <span className="composer-popover-title">{title}</span>
          {titleShortcut && <ShortcutChips shortcut={titleShortcut} />}
        </div>
      )}
      {items.map((item, idx) => {
        if (item.kind === 'divider') {
          return <div key={idx} className="composer-popover-divider" />;
        }
        if (item.kind === 'description') {
          return (
            <div key={idx} className="composer-popover-description">
              {item.description}
            </div>
          );
        }
        if (item.kind === 'section') {
          return (
            <div key={idx} className="composer-popover-section">
              <span className="composer-popover-section-title">{item.label}</span>
              {item.shortcut && <ShortcutChips shortcut={item.shortcut} />}
            </div>
          );
        }
        const hasSub = !!item.submenu && item.submenu.length > 0;
        return (
          <button
            key={idx}
            type="button"
            className={`composer-popover-item ${item.selected ? 'is-selected' : ''} ${item.disabled ? 'is-disabled' : ''} ${submenuOpen === idx ? 'is-submenu-open' : ''}`}
            disabled={item.disabled}
            onMouseEnter={(e) => {
              if (hasSub) {
                openSubmenuAt(idx, e.currentTarget);
              } else if (submenuOpen !== null) {
                // outro item sem submenu → agenda fechamento (não imediato)
                // se o mouse pular pro submenu antes do timeout, cancela
                scheduleCloseSubmenu();
              }
            }}
            onClick={(e) => {
              if (hasSub) {
                openSubmenuAt(idx, e.currentTarget);
                return;
              }
              item.onClick?.();
              if (!item.toggle) onClose();
            }}
          >
            <span className="composer-popover-icon">
              {item.icon ? <i className={`codicon codicon-${item.icon}`} /> : null}
            </span>
            <span className="composer-popover-label">
              {item.label}
              {item.badge && <span className="composer-popover-badge">{item.badge}</span>}
            </span>
            {item.toggle ? (
              <span className={`composer-popover-toggle ${item.toggleValue ? 'is-on' : ''}`}>
                <span className="composer-popover-toggle-knob" />
              </span>
            ) : item.selected ? (
              <i className="codicon codicon-check composer-popover-check" />
            ) : hasSub ? (
              <i className="codicon codicon-chevron-right composer-popover-chevron" />
            ) : item.shortcut ? (
              <ShortcutChips shortcut={item.shortcut} />
            ) : null}
          </button>
        );
      })}

      {/* Submenu — segundo popover posicionado à direita do item */}
      {submenuOpen !== null && submenuPos && items[submenuOpen]?.submenu && (
        <div
          className="composer-popover composer-popover-submenu"
          onMouseEnter={cancelCloseSubmenu}
          onMouseLeave={scheduleCloseSubmenu}
          style={{
            position: 'fixed',
            top: submenuPos.top,
            left: submenuPos.left,
            bottom: 'auto',
            minWidth: '220px',
          }}
        >
          {items[submenuOpen]?.submenuTitle && (
            <div className="composer-popover-header">
              <span className="composer-popover-title">{items[submenuOpen]?.submenuTitle}</span>
            </div>
          )}
          {items[submenuOpen]?.submenu?.map((sub, sIdx) => {
            if (sub.kind === 'divider') {
              return <div key={sIdx} className="composer-popover-divider" />;
            }
            return (
              <button
                key={sIdx}
                type="button"
                className={`composer-popover-item ${sub.selected ? 'is-selected' : ''} ${sub.disabled ? 'is-disabled' : ''}`}
                disabled={sub.disabled}
                onClick={() => {
                  sub.onClick?.();
                  if (!sub.toggle) onClose();
                }}
              >
                <span className="composer-popover-icon">
                  {sub.icon ? <i className={`codicon codicon-${sub.icon}`} /> : null}
                </span>
                <span className="composer-popover-label">{sub.label}</span>
                {sub.toggle ? (
                  <span className={`composer-popover-toggle ${sub.toggleValue ? 'is-on' : ''}`}>
                    <span className="composer-popover-toggle-knob" />
                  </span>
                ) : sub.selected ? (
                  <i className="codicon codicon-check composer-popover-check" />
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
