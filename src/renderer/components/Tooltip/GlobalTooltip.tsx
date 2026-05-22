import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * GlobalTooltip — intercepta TODOS os `title="..."` do app e renderiza
 * tooltip custom em portal.
 *
 * Por que: substituir 50+ `title=""` por <Tooltip><…/></Tooltip> seria tedioso e
 * frágil. Aqui usamos um único listener mouseover/mouseout global que:
 *   1. Vê element com `title` ou `data-tooltip`
 *   2. Move o text pra `data-undrcod-title` (remove o nativo pra evitar duplo tooltip)
 *   3. Mostra custom tooltip estilizado em portal
 *   4. Restaura title no mouseout
 *
 * Mount uma vez no nível raiz (App.tsx). Sem props.
 *
 * Opt-out: adicionar `data-no-tooltip` no elemento (ou ancestor).
 */
export function GlobalTooltip(): React.ReactElement | null {
  const [state, setState] = useState<{
    text: string;
    x: number; y: number;
    place: 'top' | 'bottom' | 'left' | 'right';
  } | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const currentTargetRef = useRef<HTMLElement | null>(null);
  const DELAY_MS = 350;

  useEffect(() => {
    const getTooltipText = (el: HTMLElement): string | null => {
      // Skip if opted out
      if (el.closest('[data-no-tooltip]')) return null;
      // 1) Try data-tooltip (preferred, won't trigger native)
      const dt = el.getAttribute('data-tooltip');
      if (dt) return dt;
      // 2) Try title (HTML native — will move to data-undrcod-title to suppress native)
      const t = el.getAttribute('title');
      if (t) {
        el.setAttribute('data-undrcod-title', t);
        el.removeAttribute('title');
        return t;
      }
      // 3) Try previously moved title (when re-hovering)
      const moved = el.getAttribute('data-undrcod-title');
      if (moved) return moved;
      return null;
    };

    const findTarget = (e: MouseEvent): { el: HTMLElement; text: string } | null => {
      // Walk up from target to find an element with title/data-tooltip
      let node = e.target as HTMLElement | null;
      while (node && node !== document.body) {
        if (node.hasAttribute && (node.hasAttribute('title') || node.hasAttribute('data-tooltip') || node.hasAttribute('data-undrcod-title'))) {
          const text = getTooltipText(node);
          if (text) return { el: node, text };
        }
        node = node.parentElement;
      }
      return null;
    };

    const computeCoords = (target: HTMLElement, tooltipEl: HTMLDivElement | null): { x: number; y: number; place: 'top' | 'bottom' | 'left' | 'right' } => {
      const tRect = target.getBoundingClientRect();
      const ttW = tooltipEl?.offsetWidth ?? 100;
      const ttH = tooltipEl?.offsetHeight ?? 26;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const OFFSET = 6;
      // Prefer bottom; flip to top if no room
      let place: 'top' | 'bottom' | 'left' | 'right' = 'bottom';
      let x = tRect.left + tRect.width / 2 - ttW / 2;
      let y = tRect.bottom + OFFSET;
      if (y + ttH > vh - 4) {
        place = 'top';
        y = tRect.top - ttH - OFFSET;
      }
      x = Math.max(4, Math.min(vw - ttW - 4, x));
      y = Math.max(4, Math.min(vh - ttH - 4, y));
      return { x, y, place };
    };

    const onMouseOver = (e: MouseEvent): void => {
      const found = findTarget(e);
      if (!found) return;
      // Already showing for this target?
      if (currentTargetRef.current === found.el) return;
      currentTargetRef.current = found.el;
      // Clear previous timer
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
      }
      showTimerRef.current = window.setTimeout(() => {
        // Set initial state to render the tooltip (with placeholder coords)
        setState({ text: found.text, x: 0, y: 0, place: 'bottom' });
        // After render, measure and reposition
        requestAnimationFrame(() => {
          const coords = computeCoords(found.el, tooltipRef.current);
          setState({ text: found.text, ...coords });
        });
      }, DELAY_MS);
    };

    const onMouseOut = (e: MouseEvent): void => {
      const related = e.relatedTarget as HTMLElement | null;
      // If moving to a descendant, ignore (still inside target)
      if (related && currentTargetRef.current?.contains(related)) return;
      currentTargetRef.current = null;
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      setState(null);
    };

    const onMouseDown = (): void => {
      // Hide immediately on click
      currentTargetRef.current = null;
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      setState(null);
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        currentTargetRef.current = null;
        if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
        setState(null);
      }
    };

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('mouseout', onMouseOut, true);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKey);
      if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
    };
  }, []);

  if (!state) return null;
  return createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      className={`undrcod-tooltip undrcod-tooltip--${state.place}`}
      style={{
        position: 'fixed',
        left: state.x,
        top: state.y,
        zIndex: 10000,
      }}
    >
      {state.text}
    </div>,
    document.body
  );
}
