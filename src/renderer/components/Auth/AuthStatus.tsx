/**
 * AuthStatus — exibe status de autenticação com Claude CLI + ações Entrar/Sair.
 *
 * Exporta:
 *   - `useAuthStatus()` hook: faz polling no mount e em window focus,
 *       retorna { status, loading, busy, login, logout, refresh }.
 *   - `<AuthStatus />` componente standalone (caso queira usar fora do popover).
 *   - `buildAuthMenuItems()` helper: monta PopoverItem[] pra splice no
 *       accountMenuItems do App.tsx (substitui o "<user> (local)" disabled).
 *
 * Defensive: se `window.undrcodAPI?.auth` não existe (preload desatualizado),
 * mostra "Auth não disponível" e desabilita botoes.
 */

import { useCallback, useEffect, useState } from 'react';
import type { PopoverItem } from '../ChatView/ComposerPopover';
import { confirmDialog } from '../ConfirmDialog/ConfirmDialog';

// Tipo espelho do main/auth-claude.ts — duplicado pra evitar import cross-process
// no bundle do renderer. AuthStatus do main vem via IPC.
export type AuthSource = 'oauth' | 'apikey' | 'none';

export interface AuthStatusData {
  loggedIn: boolean;
  source: AuthSource;
  email?: string;
  plan?: string;
  expiresAt?: string;
  expiresAtMs?: number;
  /** true quando token OAuth já expirou (credencial no disco, mas Claude CLI vai 401) */
  expired?: boolean;
}

interface AuthAPI {
  getStatus: () => Promise<AuthStatusData>;
  login: () => Promise<{ ok: boolean; error?: string }>;
  /** Apaga o credentials.json. Confirmacao agora e no renderer. */
  logout: () => Promise<{ ok: boolean; error?: string }>;
}

/** Acesso defensivo a window.undrcodAPI?.auth — pode estar undefined em build velha. */
function getAuthAPI(): AuthAPI | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = window.undrcodAPI;
  if (!api || !api.auth) return null;
  return api.auth as AuthAPI;
}

function planLabel(plan?: string): string {
  if (!plan) return '';
  const norm = plan.toLowerCase();
  if (norm === 'max') return 'Max';
  if (norm === 'pro') return 'Pro';
  if (norm === 'free') return 'Free';
  // Capitaliza primeira letra como fallback
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function sourceLabel(source: AuthSource): string {
  switch (source) {
    case 'oauth': return 'OAuth';
    case 'apikey': return 'API Key';
    case 'none': return 'Não autenticado';
  }
}

export interface UseAuthStatusResult {
  status: AuthStatusData | null;
  loading: boolean;
  /** true enquanto login/logout esta em execucao */
  busy: boolean;
  /** apiUnavailable = preload não expoe window.undrcodAPI?.auth */
  apiUnavailable: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Hook que carrega/recarrega o status de auth.
 * Re-checa em window focus pra capturar mudanca após `claude login` finalizar.
 */
export function useAuthStatus(): UseAuthStatusResult {
  const [status, setStatus] = useState<AuthStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const api = getAuthAPI();
  const apiUnavailable = api === null;

  const refresh = useCallback(async () => {
    if (!api) {
      setLoading(false);
      return;
    }
    try {
      const next = await api.getStatus();
      setStatus(next);
    } catch (err) {
      console.warn('[AuthStatus] getStatus falhou:', err);
      setStatus({ loggedIn: false, source: 'none' });
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-checa quando window volta a ter foco (capta `claude login` recem completado)
  useEffect(() => {
    if (apiUnavailable) return;
    const onFocus = () => { refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [apiUnavailable, refresh]);

  const login = useCallback(async () => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const res = await api.login();
      if (!res.ok && res.error) console.warn('[AuthStatus] login falhou:', res.error);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [api, busy, refresh]);

  const logout = useCallback(async () => {
    if (!api || busy) return;
    // Confirmacao acontece NO RENDERER agora (estilo UNDRCOD), não mais via
    // dialog.showMessageBox nativo do main process.
    const ok = await confirmDialog({
      title: 'Sair da conta',
      message:
        'Deseja sair da conta Claude?\n\nSuas credenciais OAuth serão apagadas. Você precisará fazer login novamente pra usar o Claude CLI.',
      confirmLabel: 'Sair',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.logout();
      if (!res.ok && res.error) console.warn('[AuthStatus] logout falhou:', res.error);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [api, busy, refresh]);

  return { status, loading, busy, apiUnavailable, login, logout, refresh };
}

/**
 * Componente standalone — usavel fora do popover.
 * Mostra status como bloco vertical com botoes Entrar/Sair.
 */
export function AuthStatus(): JSX.Element {
  const { status, loading, busy, apiUnavailable, login, logout } = useAuthStatus();

  if (apiUnavailable) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: 'var(--muted-fg, #888)' }}>
        Auth não disponível
      </div>
    );
  }

  if (loading || !status) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: 'var(--muted-fg, #888)' }}>
        <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: 6 }} />
        Verificando...
      </div>
    );
  }

  const primaryLine = status.loggedIn
    ? status.email
      ? `Logado: ${status.email}`
      : `Logado (${sourceLabel(status.source)})`
    : 'Não autenticado';
  const secondaryLine = status.loggedIn && status.plan ? `Plano ${planLabel(status.plan)}` : undefined;

  return (
    <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <i
          className={`codicon ${status.loggedIn ? 'codicon-check-all' : 'codicon-circle-slash'}`}
          style={{ color: status.loggedIn ? 'var(--ok-fg, #4caf50)' : 'var(--muted-fg, #888)' }}
        />
        <span>{primaryLine}</span>
      </div>
      {secondaryLine && (
        <div style={{ color: 'var(--muted-fg, #888)', paddingLeft: 18 }}>{secondaryLine}</div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        {!status.loggedIn ? (
          <button
            onClick={login}
            disabled={busy}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            <i className="codicon codicon-sign-in" style={{ marginRight: 4 }} />
            Entrar
          </button>
        ) : (
          <button
            onClick={logout}
            disabled={busy}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            <i className="codicon codicon-sign-out" style={{ marginRight: 4 }} />
            Sair
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Monta items do popover account integrados ao layout existente.
 * Use no lugar do "<username> (local)" disabled atual em accountMenuItems.
 *
 * Retorna sequencia de PopoverItem:
 *   - linha de status (descrição mais detalhada se logado)
 *   - linha de plano (se disponível)
 *   - divider
 *   - "Entrar" OU "Sair"
 *
 * Os callbacks login/logout fecham o popover via `onAction` (callback opcional).
 */
export function buildAuthMenuItems(
  result: UseAuthStatusResult,
  onAction?: () => void,
): PopoverItem[] {
  const { status, loading, busy, apiUnavailable, login, logout } = result;

  if (apiUnavailable) {
    return [{
      kind: 'item',
      icon: 'circle-slash',
      label: 'Auth não disponível',
      description: 'Reinicie o app pra recarregar o preload',
      disabled: true,
    }];
  }

  if (loading || !status) {
    return [{
      kind: 'item',
      icon: 'loading',
      label: 'Verificando autenticação...',
      disabled: true,
    }];
  }

  const items: PopoverItem[] = [];

  if (status.loggedIn && status.expired) {
    // Credencial no disco, mas token expirou. Mostra warning + 2 ações (re-login + sair).
    items.push({
      kind: 'item',
      icon: 'warning',
      label: 'Sessao expirada',
      disabled: true,
    });
    // Linha secundaria com identidade (email ou fonte) — kind='description'
    // pq item.description não renderiza em kind='item' no ComposerPopover.
    const subline = status.email ?? `Logado via ${sourceLabel(status.source)}${status.plan ? ` · Plano ${planLabel(status.plan)}` : ''}`;
    items.push({ kind: 'description', description: subline });
    items.push({ kind: 'divider' });
    items.push({
      kind: 'item',
      icon: 'sign-in',
      label: busy ? 'Abrindo navegador...' : 'Entrar de novo',
      disabled: busy,
      onClick: () => {
        login();
        onAction?.();
      },
    });
    items.push({
      kind: 'item',
      icon: 'sign-out',
      label: busy ? 'Saindo...' : 'Sair',
      disabled: busy,
      onClick: () => {
        logout();
        onAction?.();
      },
    });
  } else if (status.loggedIn) {
    // Label principal: email se tiver, senao "Plano Max" / "Plano Pro" / etc
    // priorizando informação significativa em vez do generico "Logado (OAuth)".
    let label: string;
    if (status.email) {
      label = status.email;
    } else if (status.plan) {
      label = `Plano ${planLabel(status.plan)}`;
    } else {
      label = `Logado (${sourceLabel(status.source)})`;
    }
    items.push({
      kind: 'item',
      icon: 'check-all',
      label,
      disabled: true,
    });
    // Subline com info complementar (fonte da auth, plano se não foi promovido)
    let subline: string | null = null;
    if (status.email && status.plan) {
      subline = `Plano ${planLabel(status.plan)} · ${sourceLabel(status.source)}`;
    } else if (status.email) {
      subline = sourceLabel(status.source);
    } else if (status.plan) {
      // plano já foi pro label, mostra só a fonte
      subline = `Autenticado via ${sourceLabel(status.source)}`;
    }
    if (subline) {
      items.push({ kind: 'description', description: subline });
    }
    items.push({ kind: 'divider' });
    items.push({
      kind: 'item',
      icon: 'sign-out',
      label: busy ? 'Saindo...' : 'Sair',
      disabled: busy,
      onClick: () => {
        logout();
        onAction?.();
      },
    });
  } else {
    items.push({
      kind: 'item',
      icon: 'circle-slash',
      label: 'Não autenticado',
      description: 'Faca login pra usar o Claude CLI',
      disabled: true,
    });
    items.push({ kind: 'divider' });
    items.push({
      kind: 'item',
      icon: 'sign-in',
      label: busy ? 'Abrindo navegador...' : 'Entrar',
      disabled: busy,
      onClick: () => {
        login();
        onAction?.();
      },
    });
  }

  return items;
}
