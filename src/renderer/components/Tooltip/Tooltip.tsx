import React, {
  cloneElement,
  isValidElement,
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import './Tooltip.css';

/**
 * Tooltip — wrapper que adiciona tooltip estilizado ao child.
 *
 * Substitui `title="..."` HTML nativo (visual feio do OS). Estilo dark match
 * com o tema (Cursor/VS Code pattern).
 *
 * Features:
 *  - Delay configurável (default 400ms)
 *  - Portal pra escapar de overflow:hidden
 *  - Auto-flip: tenta `position`; se sair da tela, inverte
 *  - Não aparece se content vazio
 *  - Hide on click/scroll/mouseleave
 *  - Keyboard: aparece com focus, some com blur/Escape
 *  - Sem animation reduzida se prefers-reduced-motion
 *
 * Uso:
 *   <Tooltip content="Add layer">
 *     <button>+</button>
 *   </Tooltip>
 */
type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  /** Delay em ms antes de mostrar (default 400) */
  delay?: number;
  /** Posição preferida (default "bottom") */
  position?: TooltipPosition;
  /** Distância do target em px (default 6) */
  offset?: number;
  /** Disable: não mostra (sem unmount) */
  disabled?: boolean;
}

export function Tooltip({
  content,
  children,
  delay = 400,
  position = 'bottom',
  offset = 6,
  disabled = false,
}: TooltipProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number; place: TooltipPosition }>({
    x: 0, y: 0, place: position,
  });
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const tooltipId = useId();

  const computePosition = useCallback((): void => {
    const trigger = triggerRef.current;
    const tt = tooltipRef.current;
    if (!trigger || !tt) return;
    const tRect = trigger.getBoundingClientRect();
    const ttRect = tt.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Calculate candidate positions
    const candidates: Record<TooltipPosition, { x: number; y: number }> = {
      top: {
        x: tRect.left + tRect.width / 2 - ttRect.width / 2,
        y: tRect.top - ttRect.height - offset,
      },
      bottom: {
        x: tRect.left + tRect.width / 2 - ttRect.width / 2,
        y: tRect.bottom + offset,
      },
      left: {
        x: tRect.left - ttRect.width - offset,
        y: tRect.top + tRect.height / 2 - ttRect.height / 2,
      },
      right: {
        x: tRect.right + offset,
        y: tRect.top + tRect.height / 2 - ttRect.height / 2,
      },
    };

    // Try preferred, then opposite, then perpendicular
    const tryOrder: TooltipPosition[] = (() => {
      if (position === 'top') return ['top', 'bottom', 'right', 'left'];
      if (position === 'bottom') return ['bottom', 'top', 'right', 'left'];
      if (position === 'left') return ['left', 'right', 'top', 'bottom'];
      return ['right', 'left', 'top', 'bottom'];
    })();

    let chosen: TooltipPosition = position;
    for (const p of tryOrder) {
      const c = candidates[p];
      const fits =
        c.x >= 4 && c.x + ttRect.width <= vw - 4 &&
        c.y >= 4 && c.y + ttRect.height <= vh - 4;
      if (fits) { chosen = p; break; }
    }
    // Clamp to viewport edges in case nothing fits
    let { x, y } = candidates[chosen];
    x = Math.max(4, Math.min(vw - ttRect.width - 4, x));
    y = Math.max(4, Math.min(vh - ttRect.height - 4, y));
    setCoords({ x, y, place: chosen });
  }, [offset, position]);

  // Recompute when open or window resizes
  useLayoutEffect(() => {
    if (!open) return;
    computePosition();
    const onResize = (): void => computePosition();
    const onScroll = (): void => setOpen(false);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, computePosition]);

  const show = useCallback((): void => {
    if (disabled) return;
    if (!content) return;
    if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
    showTimerRef.current = window.setTimeout(() => setOpen(true), delay);
  }, [content, delay, disabled]);

  const hide = useCallback((): void => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    setOpen(false);
  }, []);

  useEffect(() => () => { if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current); }, []);

  // Hide on Escape (global)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') hide(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, hide]);

  // Clone child to attach refs + handlers
  if (!isValidElement(children)) return <>{children}</>;
  const childProps = children.props as Record<string, unknown>;
  const child = cloneElement(children, {
    ref: (el: HTMLElement | null) => {
      triggerRef.current = el;
      // forward original ref (function or object)
      type RefLike = ((el: HTMLElement | null) => void) | { current: HTMLElement | null } | null;
      const orig = (children as unknown as { ref?: RefLike }).ref;
      if (typeof orig === 'function') orig(el);
      else if (orig && typeof orig === 'object' && 'current' in orig) orig.current = el;
    },
    onMouseEnter: (e: React.MouseEvent) => {
      (childProps.onMouseEnter as ((ev: React.MouseEvent) => void) | undefined)?.(e);
      show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      (childProps.onMouseLeave as ((ev: React.MouseEvent) => void) | undefined)?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      (childProps.onFocus as ((ev: React.FocusEvent) => void) | undefined)?.(e);
      show();
    },
    onBlur: (e: React.FocusEvent) => {
      (childProps.onBlur as ((ev: React.FocusEvent) => void) | undefined)?.(e);
      hide();
    },
    onClick: (e: React.MouseEvent) => {
      (childProps.onClick as ((ev: React.MouseEvent) => void) | undefined)?.(e);
      hide(); // hide on click (user already acted)
    },
    'aria-describedby': open ? tooltipId : undefined,
  } as Partial<React.HTMLAttributes<HTMLElement>>);

  return (
    <>
      {child}
      {open && content && createPortal(
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className={`undrcod-tooltip undrcod-tooltip--${coords.place}`}
          style={{
            position: 'fixed',
            left: coords.x,
            top: coords.y,
            zIndex: 10000,
          }}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
}
