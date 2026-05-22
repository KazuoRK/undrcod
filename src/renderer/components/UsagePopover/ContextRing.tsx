/**
 * ContextRing — indicador circular ao lado do model badge.
 * Mostra % de contexto usado via arco SVG. Cor muda conforme aproxima do limite:
 *   0-50%   azul  (#4a9eff)
 *   50-75%  ambar (#f5b041)
 *   75-90%  laranja (#f0792a)
 *   90-100% vermelho (#e53935)
 *
 * Click abre o UsagePopover.
 */

import { forwardRef } from 'react';

interface ContextRingProps {
  /** 0-100 */
  pct: number;
  /** diametro em px (default 16) */
  size?: number;
  onClick?: () => void;
  className?: string;
  title?: string;
}

function colorForPct(pct: number): string {
  if (pct < 50) return '#4a9eff';
  if (pct < 75) return '#f5b041';
  if (pct < 90) return '#f0792a';
  return '#e53935';
}

export const ContextRing = forwardRef<HTMLButtonElement, ContextRingProps>(
  function ContextRing({ pct, size = 16, onClick, className = '', title }, ref) {
    const clamped = Math.max(0, Math.min(100, pct));
    const stroke = 2.5;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference * (1 - clamped / 100);
    const color = colorForPct(clamped);

    return (
      <button
        ref={ref}
        type="button"
        className={`context-ring-btn ${className}`}
        onClick={onClick}
        title={title ?? `Contexto ${clamped}%`}
        aria-label={`Contexto ${clamped}%`}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ display: 'block' }}
        >
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={stroke}
          />
          {/* Progress arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset 240ms cubic-bezier(0.16, 1, 0.3, 1), stroke 240ms ease' }}
          />
        </svg>
      </button>
    );
  }
);
