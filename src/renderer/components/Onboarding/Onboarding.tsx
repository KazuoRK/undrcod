/**
 * Onboarding — tour de primeira-vez.
 *
 * Mostra automaticamente quando localStorage `undr.tour.completed` não tem valor.
 * Pode ser re-disparado via comando "Refazer tour" do commandRegistry.
 *
 * Estrutura por step:
 *   - centered:  card central, sem target (welcome, end)
 *   - spotlight: overlay com "hole" sobre um elemento real (via selector CSS).
 *                Card posicionado lateral (right/left/top/bottom). Fallback pra
 *                center quando target não existe no DOM.
 *   - mockup:    card central com ilustração SVG estática do recurso.
 *                Usado pra Palette/DiffViewer que só renderizam quando ativos.
 *
 * Keyboard:
 *   Esc        → skip + marca completed
 *   Enter / →  → next (ou finish no último step)
 *   ←          → back
 *
 * Acessibilidade: aria-modal, focus trap simples (próximo botão recebe focus
 * automático), prefers-reduced-motion desliga transitions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './Onboarding.css';

// ============================================================================
// Tipos + steps
// ============================================================================

type StepMode = 'centered' | 'spotlight' | 'mockup';
type Placement = 'right' | 'left' | 'top' | 'bottom';
type MockupKind = 'quickopen' | 'palette' | 'sourcecontrol';

interface Step {
  id: string;
  mode: StepMode;
  title: string;
  body: string;
  /** Apenas pra mode=spotlight: CSS selector do elemento alvo. */
  selector?: string;
  /** Apenas pra mode=spotlight: posição do card relativo ao target. */
  placement?: Placement;
  /** Atalho a destacar dentro do card (kbd-row). */
  shortcut?: string[];
  /** Apenas pra mode=mockup: qual ilustração SVG renderizar. */
  mockup?: MockupKind;
  /** Label do botão primário do step. Default: "Próximo" / "Começar" no último. */
  ctaLabel?: string;
  /** Codicon pra ilustrar o step quando centered/mockup. */
  icon?: string;
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    mode: 'centered',
    title: 'Bem-vindo ao UNDRCOD',
    body: 'Um IDE leve construído em torno do Claude. Aqui vai um tour rápido das partes principais — leva 30 segundos.',
    icon: 'sparkle',
  },
  {
    id: 'files',
    mode: 'spotlight',
    selector: '.pane-left',
    placement: 'right',
    title: 'Árvore de arquivos',
    body: 'Aqui ficam os arquivos do workspace. Click pra abrir, arraste pra mencionar no chat.',
    shortcut: ['Ctrl', 'B'],
  },
  {
    id: 'chat',
    mode: 'spotlight',
    selector: '.chatview',
    placement: 'left',
    title: 'Conversa com o Claude',
    body: 'Painel direito é onde você conversa. Digite "/" pra comandos ou "@" pra mencionar arquivos.',
    shortcut: ['Ctrl', 'Alt', 'B'],
  },
  {
    id: 'quickopen',
    mode: 'mockup',
    mockup: 'quickopen',
    title: 'Quick Open',
    body: 'Acha qualquer arquivo do workspace em milissegundos. Sem busca, mostra os recentes primeiro.',
    shortcut: ['Ctrl', 'P'],
    icon: 'search',
  },
  {
    id: 'palette',
    mode: 'mockup',
    mockup: 'palette',
    title: 'Command Palette',
    body: 'Todas as ações do app num lugar só — abrir workspace, trocar tema, commitar, formatar.',
    shortcut: ['Ctrl', 'Shift', 'P'],
    icon: 'symbol-event',
  },
  {
    id: 'sourcecontrol',
    mode: 'mockup',
    mockup: 'sourcecontrol',
    title: 'Source Control + Diff',
    body: 'Veja mudanças git, stage/unstage por arquivo, aceite ou rejeite hunks individuais no diff inline.',
    icon: 'source-control',
  },
  {
    id: 'begin',
    mode: 'centered',
    title: 'Pronto pra começar',
    body: 'Abre uma pasta na tela inicial e converse com o Claude. Pra ver todos os atalhos a qualquer momento, aperte Ctrl+/.',
    shortcut: ['Ctrl', '/'],
    ctaLabel: 'Começar',
    icon: 'rocket',
  },
];

const STORAGE_KEY = 'undr.tour.completed';

// ============================================================================
// Helpers
// ============================================================================

export function hasCompletedTour(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTourCompleted(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* noop */
  }
}

export function resetTour(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

// ============================================================================
// Componente
// ============================================================================

interface OnboardingProps {
  /** Quando true, renderiza. Parent controla via state + localStorage check. */
  open: boolean;
  /** Chamado quando user dismissa (skip/complete/esc). Parent fecha + marca completed. */
  onClose: () => void;
}

export function Onboarding({ open, onClose }: OnboardingProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryBtnRef = useRef<HTMLButtonElement>(null);

  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;
  const isFirst = stepIdx === 0;

  // Reset quando abre/fecha
  useEffect(() => {
    if (open) setStepIdx(0);
  }, [open]);

  // Mede target do step atual (apenas spotlight)
  useEffect(() => {
    if (!open || step.mode !== 'spotlight' || !step.selector) {
      setTargetRect(null);
      return;
    }
    const measure = (): void => {
      const el = document.querySelector(step.selector!) as HTMLElement | null;
      if (el) {
        const rect = el.getBoundingClientRect();
        // Validação: se rect tem tamanho zero ou está fora da viewport, fallback
        if (rect.width > 0 && rect.height > 0) {
          setTargetRect(rect);
          return;
        }
      }
      setTargetRect(null); // fallback: vira centered
    };
    measure();
    // Re-mede em resize/scroll (raro mas pode acontecer)
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, step]);

  // Auto-focus no botão primário a cada step
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => primaryBtnRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open, stepIdx]);

  // Avança e finaliza
  const next = useCallback(() => {
    if (isLast) {
      markTourCompleted();
      onClose();
    } else {
      setStepIdx((i) => i + 1);
    }
  }, [isLast, onClose]);

  const back = useCallback(() => {
    if (!isFirst) setStepIdx((i) => i - 1);
  }, [isFirst]);

  const skip = useCallback(() => {
    markTourCompleted();
    onClose();
  }, [onClose]);

  // Keyboard nav
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        skip();
      } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, next, back, skip]);

  // Calcula posição do card baseado no target + placement, com auto-flip se sair da viewport.
  const cardStyle = useMemo<React.CSSProperties>(() => {
    if (step.mode !== 'spotlight' || !targetRect) {
      // Centered fallback
      return {
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }
    const GAP = 16;
    const CARD_W = 380; // estimativa, deve bater com max-width do CSS
    const CARD_H = 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const placement: Placement = step.placement ?? 'right';

    let left = 0;
    let top = 0;
    switch (placement) {
      case 'right':
        left = targetRect.right + GAP;
        top = targetRect.top + targetRect.height / 2 - CARD_H / 2;
        break;
      case 'left':
        left = targetRect.left - CARD_W - GAP;
        top = targetRect.top + targetRect.height / 2 - CARD_H / 2;
        break;
      case 'top':
        left = targetRect.left + targetRect.width / 2 - CARD_W / 2;
        top = targetRect.top - CARD_H - GAP;
        break;
      case 'bottom':
        left = targetRect.left + targetRect.width / 2 - CARD_W / 2;
        top = targetRect.bottom + GAP;
        break;
    }

    // Clamp pra dentro da viewport com margem
    const MARGIN = 16;
    left = Math.max(MARGIN, Math.min(left, vw - CARD_W - MARGIN));
    top = Math.max(MARGIN, Math.min(top, vh - CARD_H - MARGIN));

    return { left, top };
  }, [step, targetRect]);

  if (!open) return null;

  // Constrói as 4 "molduras" escuras que formam um hole sobre o target.
  // Cada moldura cobre uma faixa da viewport ao redor do target.
  const renderSpotlight = (): React.ReactNode => {
    if (step.mode !== 'spotlight' || !targetRect) return null;
    const PAD = 6; // padding extra ao redor do target pra dar respiro visual
    const r = {
      top: Math.max(0, targetRect.top - PAD),
      left: Math.max(0, targetRect.left - PAD),
      right: targetRect.right + PAD,
      bottom: targetRect.bottom + PAD,
      width: targetRect.width + PAD * 2,
      height: targetRect.height + PAD * 2,
    };
    return (
      <>
        {/* Top */}
        <div className="onb-mask" style={{ top: 0, left: 0, right: 0, height: r.top }} />
        {/* Bottom */}
        <div className="onb-mask" style={{ top: r.bottom, left: 0, right: 0, bottom: 0 }} />
        {/* Left */}
        <div className="onb-mask" style={{ top: r.top, left: 0, width: r.left, height: r.height }} />
        {/* Right */}
        <div className="onb-mask" style={{ top: r.top, left: r.right, right: 0, height: r.height }} />
        {/* Ring decorativo gold ao redor do target */}
        <div
          className="onb-ring"
          style={{
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
          }}
        />
      </>
    );
  };

  return (
    <div className="onb-root" role="dialog" aria-modal="true" aria-label="Tour de boas-vindas">
      {/* Quando NÃO é spotlight (ou target não encontrado), overlay full-screen */}
      {(step.mode !== 'spotlight' || !targetRect) && <div className="onb-mask onb-mask-full" />}
      {/* Spotlight com hole */}
      {renderSpotlight()}

      <div
        ref={cardRef}
        className={`onb-card ${step.mode === 'centered' || !targetRect ? 'is-centered' : 'is-anchored'}`}
        style={cardStyle}
      >
        {/* Step indicator (dots) */}
        <div className="onb-dots" aria-hidden="true">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`onb-dot ${i === stepIdx ? 'is-active' : ''} ${i < stepIdx ? 'is-done' : ''}`}
            />
          ))}
        </div>

        {/* Icon ou mockup acima do título */}
        {step.mode === 'mockup' && step.mockup && (
          <div className="onb-mockup">
            <MockupSvg kind={step.mockup} />
          </div>
        )}
        {step.mode !== 'mockup' && step.icon && (
          <div className="onb-icon-wrap">
            <i className={`codicon codicon-${step.icon}`} />
          </div>
        )}

        {/* Title + body */}
        <h2 className="onb-title">{step.title}</h2>
        <p className="onb-body">{step.body}</p>

        {/* Shortcut (kbd-row) */}
        {step.shortcut && (
          <div className="onb-shortcut">
            {step.shortcut.map((k) => (
              <kbd key={k} className="kbd">{k}</kbd>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="onb-actions">
          <button type="button" className="onb-btn onb-btn-ghost" onClick={skip}>
            {isLast ? 'Fechar' : 'Pular tour'}
          </button>
          <div className="onb-actions-right">
            {!isFirst && (
              <button type="button" className="onb-btn onb-btn-secondary" onClick={back}>
                <i className="codicon codicon-arrow-left" />
                Voltar
              </button>
            )}
            <button
              ref={primaryBtnRef}
              type="button"
              className="onb-btn onb-btn-primary"
              onClick={next}
            >
              {step.ctaLabel ?? (isLast ? 'Começar' : 'Próximo')}
              {!isLast && <i className="codicon codicon-arrow-right" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Mockup SVGs — ilustrações estáticas estilizadas (não tenta abrir o real)
// ============================================================================

function MockupSvg({ kind }: { kind: MockupKind }) {
  if (kind === 'quickopen') {
    return (
      <svg viewBox="0 0 360 140" className="onb-mockup-svg" aria-hidden="true">
        <rect x="20" y="14" width="320" height="112" rx="8" className="onb-mk-modal" />
        <rect x="36" y="32" width="288" height="28" rx="6" className="onb-mk-input" />
        <circle cx="50" cy="46" r="5" className="onb-mk-icon" />
        <rect x="62" y="42" width="120" height="8" rx="2" className="onb-mk-text-muted" />
        <rect x="36" y="74" width="288" height="14" rx="3" className="onb-mk-row is-active" />
        <rect x="36" y="92" width="288" height="14" rx="3" className="onb-mk-row" />
        <rect x="36" y="110" width="220" height="10" rx="3" className="onb-mk-row" />
      </svg>
    );
  }
  if (kind === 'palette') {
    return (
      <svg viewBox="0 0 360 140" className="onb-mockup-svg" aria-hidden="true">
        <rect x="20" y="14" width="320" height="112" rx="8" className="onb-mk-modal" />
        <rect x="36" y="32" width="288" height="28" rx="6" className="onb-mk-input" />
        <rect x="50" y="42" width="60" height="8" rx="2" className="onb-mk-text-accent" />
        <rect x="36" y="74" width="22" height="14" rx="3" className="onb-mk-chip" />
        <rect x="64" y="76" width="180" height="10" rx="2" className="onb-mk-text" />
        <rect x="36" y="94" width="22" height="14" rx="3" className="onb-mk-chip" />
        <rect x="64" y="96" width="220" height="10" rx="2" className="onb-mk-text" />
        <rect x="36" y="114" width="22" height="6" rx="2" className="onb-mk-chip" />
      </svg>
    );
  }
  // sourcecontrol
  return (
    <svg viewBox="0 0 360 140" className="onb-mockup-svg" aria-hidden="true">
      <rect x="20" y="14" width="120" height="112" rx="8" className="onb-mk-panel" />
      <rect x="32" y="28" width="60" height="8" rx="2" className="onb-mk-text-muted" />
      <circle cx="36" cy="52" r="4" className="onb-mk-status-mod" />
      <rect x="46" y="48" width="80" height="8" rx="2" className="onb-mk-text" />
      <circle cx="36" cy="68" r="4" className="onb-mk-status-add" />
      <rect x="46" y="64" width="60" height="8" rx="2" className="onb-mk-text" />
      <circle cx="36" cy="84" r="4" className="onb-mk-status-del" />
      <rect x="46" y="80" width="70" height="8" rx="2" className="onb-mk-text" />
      <rect x="32" y="102" width="96" height="16" rx="4" className="onb-mk-btn" />
      <rect x="152" y="14" width="188" height="112" rx="8" className="onb-mk-diff" />
      <rect x="164" y="28" width="60" height="6" rx="2" className="onb-mk-text-muted" />
      <rect x="164" y="44" width="166" height="10" rx="2" className="onb-mk-diff-add" />
      <rect x="164" y="58" width="166" height="10" rx="2" className="onb-mk-diff-del" />
      <rect x="164" y="72" width="120" height="10" rx="2" className="onb-mk-text-muted" />
      <rect x="164" y="86" width="140" height="10" rx="2" className="onb-mk-diff-add" />
      <rect x="164" y="100" width="80" height="10" rx="2" className="onb-mk-text-muted" />
    </svg>
  );
}
