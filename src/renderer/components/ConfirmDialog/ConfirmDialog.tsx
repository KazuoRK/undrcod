/**
 * ConfirmDialog — modal de confirmacao in-app com cara do UNDRCOD.
 *
 * Substitui window.confirm() nativo (que mostra dialog do OS, quebra UX).
 *
 * Uso imperativo (singleton):
 *   const ok = await confirmDialog({ message: 'Remover plugin?' });
 *   if (!ok) return;
 *
 * Pra funcionar precisa do <ConfirmDialogHost /> renderizado em algum lugar
 * no topo da arvore (App.tsx). Se host não tiver montado, faz fallback pro
 * window.confirm nativo (defensivo, mas raro).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import './ConfirmDialog.css';

// ============================================================================
// Tipos + singleton state
// ============================================================================

export interface ConfirmOpts {
  /** Titulo do modal (default: "Confirmar") */
  title?: string;
  /** Texto principal (pode conter quebras de linha) */
  message: string;
  /** Label do botao primario (default: "OK") */
  confirmLabel?: string;
  /** Label do botao secundario (default: "Cancelar") */
  cancelLabel?: string;
  /** Se true, botao primario vira vermelho (ação destrutiva tipo "Remover") */
  destructive?: boolean;
}

type Resolver = (value: boolean) => void;
type OpenFn = (opts: ConfirmOpts, resolve: Resolver) => void;

// State module-level. Set quando <ConfirmDialogHost> monta.
let openCb: OpenFn | null = null;

/**
 * Mostra um modal de confirmacao e retorna a escolha do user.
 * Se host não tiver montado, fallback pra window.confirm pra não quebrar UX.
 */
export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    if (!openCb) {
      // Defensivo: host ainda não montou. Caia pro nativo pra não perder UX.
      console.warn('[confirmDialog] host não montado, usando window.confirm fallback');
      resolve(window.confirm(opts.message));
      return;
    }
    openCb(opts, resolve);
  });
}

// ============================================================================
// Host
// ============================================================================

/**
 * Componente host. Renderiza no topo da arvore (App.tsx).
 * Pega requests do singleton e mostra o modal real.
 */
export function ConfirmDialogHost() {
  const [state, setState] = useState<{ opts: ConfirmOpts; resolve: Resolver } | null>(null);
  const primaryBtnRef = useRef<HTMLButtonElement>(null);

  // Registra/desregistra o singleton handler
  useEffect(() => {
    openCb = (opts, resolve) => setState({ opts, resolve });
    return () => {
      openCb = null;
    };
  }, []);

  const close = useCallback(
    (result: boolean) => {
      if (!state) return;
      state.resolve(result);
      setState(null);
    },
    [state],
  );

  // Keyboard: Enter confirma, Esc cancela
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      } else if (e.key === 'Enter') {
        // Só dispara confirm se o focus tá no botao primario, ou no body do modal
        // (evita engatilhar quando o user tá num input dentro do modal — futuro).
        e.preventDefault();
        close(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, close]);

  // Auto-focus no botao primario quando abre
  useEffect(() => {
    if (state && primaryBtnRef.current) {
      // Delay 1 frame pra animacao não quebrar focus
      requestAnimationFrame(() => primaryBtnRef.current?.focus());
    }
  }, [state]);

  if (!state) return null;

  const opts = state.opts;
  const title = opts.title ?? 'Confirmar';
  const confirmLabel = opts.confirmLabel ?? 'OK';
  const cancelLabel = opts.cancelLabel ?? 'Cancelar';

  return (
    <div className="confirm-backdrop" onClick={() => close(false)} role="dialog" aria-modal="true">
      <div
        className="confirm-modal"
        onClick={(e) => e.stopPropagation()}
        role="document"
      >
        <div className="confirm-header">
          <h3 className="confirm-title">{title}</h3>
          <button
            className="confirm-close"
            onClick={() => close(false)}
            aria-label="Fechar"
            type="button"
          >
            <i className="codicon codicon-close" />
          </button>
        </div>

        <div className="confirm-body">
          <p className="confirm-message">{opts.message}</p>
        </div>

        <div className="confirm-footer">
          <div className="confirm-hints">
            <span className="kbd-row">
              <kbd className="kbd">Esc</kbd>
              <span className="confirm-hint-label">cancelar</span>
            </span>
            <span className="kbd-row">
              <kbd className="kbd">Enter</kbd>
              <span className="confirm-hint-label">confirmar</span>
            </span>
          </div>

          <div className="confirm-actions">
            <button
              className="confirm-btn confirm-btn-secondary"
              onClick={() => close(false)}
              type="button"
            >
              {cancelLabel}
            </button>
            <button
              ref={primaryBtnRef}
              className={`confirm-btn confirm-btn-primary ${
                opts.destructive ? 'is-destructive' : ''
              }`}
              onClick={() => close(true)}
              type="button"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
