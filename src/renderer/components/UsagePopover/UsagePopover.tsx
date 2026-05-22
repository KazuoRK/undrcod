/**
 * UsagePopover — abre por click no ContextRing ao lado do model badge.
 * Mostra dados reais do CLI:
 *   1. Janela de contexto (lastTurn.usage)
 *   2. Custo acumulado da sessão
 *   3. Breakdown de tokens (input/output/cache)
 *
 * Plan usage (limite 5h, semanal, etc) NAO esta aqui — CLI Claude Code não
 * expoe esses dados, e mostrar mock e enganacao. Se um dia tiver fonte real
 * (API admin do workspace, scraping de billing), adicionar aqui.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import './UsagePopover.css';

export interface ContextWindowUsage {
  used: number;
  max: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

interface UsagePopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  /** Janela de contexto. Se null, mostra empty state. */
  contextWindow: ContextWindowUsage | null;
  /** Custo total da sessão em USD. */
  totalCost?: number;
  /** Turnos da sessão. */
  turnsCount?: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function UsagePopover({
  open,
  onClose,
  anchorRef,
  contextWindow,
  totalCost,
  turnsCount,
}: UsagePopoverProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ bottom: number; right: number }>({ bottom: 0, right: 0 });

  // Calcula posição acima do anchor (popover sobe)
  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPosition({
      bottom: window.innerHeight - rect.top + 8,
      right: window.innerWidth - rect.right,
    });
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
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    const t = setTimeout(() => window.addEventListener('mousedown', onClick), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const ctxPct = contextWindow
    ? Math.min(100, Math.round((contextWindow.used / contextWindow.max) * 100))
    : 0;

  return (
    <div
      ref={menuRef}
      className="usage-popover"
      style={{ bottom: position.bottom, right: position.right }}
    >
      {contextWindow ? (
        <>
          <div className="usage-row">
            <div className="usage-row-header">
              <span className="usage-row-label">Janela de contexto</span>
              <span className="usage-row-value">
                {formatTokens(contextWindow.used)} / {formatTokens(contextWindow.max)} ({ctxPct}%)
              </span>
            </div>
            <div className="usage-progress">
              <div className="usage-progress-fill" style={{ width: `${ctxPct}%` }} />
            </div>
          </div>

          {(contextWindow.inputTokens !== undefined || contextWindow.outputTokens !== undefined) && (
            <div className="usage-breakdown">
              {contextWindow.inputTokens !== undefined && contextWindow.inputTokens > 0 && (
                <div className="usage-breakdown-row">
                  <span className="usage-breakdown-label">Input</span>
                  <span className="usage-breakdown-value">{formatTokens(contextWindow.inputTokens)}</span>
                </div>
              )}
              {contextWindow.outputTokens !== undefined && contextWindow.outputTokens > 0 && (
                <div className="usage-breakdown-row">
                  <span className="usage-breakdown-label">Output</span>
                  <span className="usage-breakdown-value">{formatTokens(contextWindow.outputTokens)}</span>
                </div>
              )}
              {contextWindow.cacheReadTokens !== undefined && contextWindow.cacheReadTokens > 0 && (
                <div className="usage-breakdown-row">
                  <span className="usage-breakdown-label">Cache hit</span>
                  <span className="usage-breakdown-value">{formatTokens(contextWindow.cacheReadTokens)}</span>
                </div>
              )}
              {contextWindow.cacheCreationTokens !== undefined && contextWindow.cacheCreationTokens > 0 && (
                <div className="usage-breakdown-row">
                  <span className="usage-breakdown-label">Cache write</span>
                  <span className="usage-breakdown-value">{formatTokens(contextWindow.cacheCreationTokens)}</span>
                </div>
              )}
            </div>
          )}

          {(totalCost !== undefined || turnsCount !== undefined) && (
            <div className="usage-footer">
              {totalCost !== undefined && totalCost > 0 && (
                <div className="usage-footer-row">
                  <span className="usage-footer-label">Custo da sessão</span>
                  <span className="usage-footer-value">{formatCost(totalCost)}</span>
                </div>
              )}
              {turnsCount !== undefined && turnsCount > 0 && (
                <div className="usage-footer-row">
                  <span className="usage-footer-label">Turnos</span>
                  <span className="usage-footer-value">{turnsCount}</span>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="usage-empty">
          <span className="usage-empty-text">Envie uma mensagem pra ver o uso de contexto.</span>
        </div>
      )}
    </div>
  );
}
