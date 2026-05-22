import { useCallback, useRef, useState, useEffect } from 'react';
import './SplitPane.css';

interface SplitPaneProps {
  /** percentual inicial do left panel (0-100) */
  defaultLeftPercent?: number;
  /** min em pixels do left */
  minLeft?: number;
  /** min em pixels do right */
  minRight?: number;
  left: React.ReactNode;
  right: React.ReactNode;
}

export function SplitPane({
  defaultLeftPercent = 22,
  minLeft = 180,
  minRight = 400,
  left,
  right
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState<number | null>(null); // pixels
  const draggingRef = useRef(false);

  // Calcula leftWidth inicial baseado em percent
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const totalWidth = container.getBoundingClientRect().width;
    setLeftWidth(Math.max(minLeft, (totalWidth * defaultLeftPercent) / 100));
  }, [defaultLeftPercent, minLeft]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newLeft = e.clientX - rect.left;
      const totalWidth = rect.width;
      const clamped = Math.max(
        minLeft,
        Math.min(totalWidth - minRight, newLeft)
      );
      setLeftWidth(clamped);
    }

    function handleMouseUp() {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // Trigger global resize event for children to refit (terminal)
        window.dispatchEvent(new Event('resize'));
      }
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [minLeft, minRight]);

  return (
    <div ref={containerRef} className="splitpane">
      <div
        className="splitpane-left"
        style={{ width: leftWidth ?? `${defaultLeftPercent}%` }}
      >
        {left}
      </div>
      <div
        className="splitpane-divider"
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation="vertical"
      />
      <div className="splitpane-right">{right}</div>
    </div>
  );
}
