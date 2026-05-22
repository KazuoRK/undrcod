/**
 * Splitter — barra vertical/horizontal de drag-resize entre dois panes.
 *
 * Uso: coloca entre dois irmaos flex. O parent controla os widths/heights
 * dos panes adjacentes via state, e recebe deltas via onResize.
 *
 *   <div style={{ width: leftWidth }}>{...}</div>
 *   <Splitter orientation="vertical" onResize={(dx) => setLeftWidth(w => w + dx)} />
 *   <div style={{ flex: 1 }}>{...}</div>
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import './Splitter.css';

interface SplitterProps {
  /** 'vertical' = barra vertical entre 2 panes horizontais (resize horizontal). */
  /** 'horizontal' = barra horizontal entre 2 panes verticais (resize vertical). */
  orientation: 'vertical' | 'horizontal';
  /** Callback no drag — recebe delta em px desde o último mousemove. */
  onResize: (delta: number) => void;
  /** Callback opcional ao terminar o drag (mouseup). */
  onResizeEnd?: () => void;
  className?: string;
}

export function Splitter({ orientation, onResize, onResizeEnd, className = '' }: SplitterProps) {
  const [dragging, setDragging] = useState(false);
  const lastPosRef = useRef<number>(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    lastPosRef.current = orientation === 'vertical' ? e.clientX : e.clientY;
    // Cursor global durante drag
    document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [orientation]);

  useEffect(() => {
    if (!dragging) return;

    function onMove(e: MouseEvent) {
      const current = orientation === 'vertical' ? e.clientX : e.clientY;
      const delta = current - lastPosRef.current;
      lastPosRef.current = current;
      if (delta !== 0) onResize(delta);
    }

    function onUp() {
      setDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onResizeEnd?.();
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, orientation, onResize, onResizeEnd]);

  return (
    <div
      className={`splitter splitter-${orientation} ${dragging ? 'is-dragging' : ''} ${className}`}
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation={orientation}
    />
  );
}
