/**
 * Toast — sistema de notificações transitórias com helper imperativo singleton.
 *
 * Uso:
 *   import { toast } from '@/components/Toast/Toast';
 *   toast.info('Arquivo salvo');
 *   toast.success('Commit criado: abc1234');
 *   toast.error('Falha ao salvar', { sub: err.message });
 *   toast.warn('Branch tem mudanças não comitadas');
 *
 * Pra funcionar precisa do <ToastHost /> renderizado em algum lugar no JSX root
 * (App.tsx). Se host não tiver montado, faz fallback silencioso pro console.log.
 *
 * Toasts ficam empilhados no canto inferior direito (acima da statusbar).
 * Auto-dismiss em 4s (ou 8s pra error). Click no toast dismissa imediatamente.
 */

import { useEffect, useState } from 'react';
import './Toast.css';

// ============================================================================
// Tipos
// ============================================================================

export type ToastLevel = 'info' | 'success' | 'warn' | 'error';

interface ToastEntry {
  id: string;
  level: ToastLevel;
  text: string;
  sub?: string;
  /** ms até auto-dismiss; padrão 4s (info/success/warn) ou 8s (error). */
  ttl?: number;
}

interface ToastOpts {
  sub?: string;
  ttl?: number;
  /** Se true, NÃO adiciona ao log persistente (bell). Default false. */
  skipLog?: boolean;
}

type PushFn = (entry: ToastEntry) => void;

// State module-level — set quando <ToastHost> monta.
let pushCb: PushFn | null = null;

// ============================================================================
// Notification log (persistente, alimenta o bell da statusbar)
// ============================================================================

export interface NotificationEntry {
  id: string;
  level: ToastLevel;
  text: string;
  sub?: string;
  ts: number;
  read: boolean;
}

const LOG_MAX = 50;
const notificationLog: NotificationEntry[] = [];
const logSubscribers: Array<() => void> = [];

function notifySubscribers(): void {
  for (const cb of logSubscribers) {
    try { cb(); } catch { /* silencioso */ }
  }
}

export function logNotification(level: ToastLevel, text: string, sub?: string): void {
  notificationLog.unshift({
    id: crypto.randomUUID(),
    level,
    text,
    sub,
    ts: Date.now(),
    read: false,
  });
  if (notificationLog.length > LOG_MAX) notificationLog.pop();
  notifySubscribers();
}

export function getNotificationLog(): NotificationEntry[] {
  return notificationLog.slice();
}

export function markAllNotificationsRead(): void {
  let changed = false;
  for (const e of notificationLog) {
    if (!e.read) { e.read = true; changed = true; }
  }
  if (changed) notifySubscribers();
}

export function markNotificationRead(id: string): void {
  const entry = notificationLog.find((e) => e.id === id);
  if (entry && !entry.read) {
    entry.read = true;
    notifySubscribers();
  }
}

export function removeNotification(id: string): void {
  const idx = notificationLog.findIndex((e) => e.id === id);
  if (idx >= 0) {
    notificationLog.splice(idx, 1);
    notifySubscribers();
  }
}

export function clearNotifications(): void {
  if (notificationLog.length === 0) return;
  notificationLog.length = 0;
  notifySubscribers();
}

export function getUnreadNotificationCount(): number {
  let n = 0;
  for (const e of notificationLog) if (!e.read) n++;
  return n;
}

export function subscribeNotifications(cb: () => void): () => void {
  logSubscribers.push(cb);
  return () => {
    const idx = logSubscribers.indexOf(cb);
    if (idx >= 0) logSubscribers.splice(idx, 1);
  };
}

function emit(level: ToastLevel, text: string, opts?: ToastOpts): void {
  // Log persistente (alimenta bell). Toda toast vira entry, salvo opt-out.
  if (!opts?.skipLog) {
    logNotification(level, text, opts?.sub);
  }
  const entry: ToastEntry = {
    id: crypto.randomUUID(),
    level,
    text,
    sub: opts?.sub,
    ttl: opts?.ttl,
  };
  if (!pushCb) {
    // Defensive fallback — host não montado, loga em console pra não silenciar.
    // eslint-disable-next-line no-console
    console.log(`[toast/${level}] ${text}${opts?.sub ? ` — ${opts.sub}` : ''}`);
    return;
  }
  pushCb(entry);
}

export const toast = {
  info: (text: string, opts?: ToastOpts) => emit('info', text, opts),
  success: (text: string, opts?: ToastOpts) => emit('success', text, opts),
  warn: (text: string, opts?: ToastOpts) => emit('warn', text, opts),
  error: (text: string, opts?: ToastOpts) => emit('error', text, opts),
};

// ============================================================================
// Host
// ============================================================================

function defaultTtl(level: ToastLevel): number {
  return level === 'error' ? 8000 : 4000;
}

function iconForLevel(level: ToastLevel): string {
  switch (level) {
    case 'info': return 'info';
    case 'success': return 'check';
    case 'warn': return 'warning';
    case 'error': return 'error';
  }
}

export function ToastHost() {
  const [entries, setEntries] = useState<ToastEntry[]>([]);

  useEffect(() => {
    pushCb = (entry) => {
      setEntries((prev) => [...prev, entry]);
      const ttl = entry.ttl ?? defaultTtl(entry.level);
      window.setTimeout(() => {
        setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      }, ttl);
    };
    return () => {
      pushCb = null;
    };
  }, []);

  if (entries.length === 0) return null;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {entries.map((e) => (
        <button
          key={e.id}
          type="button"
          className={`toast toast--${e.level}`}
          onClick={() => setEntries((prev) => prev.filter((x) => x.id !== e.id))}
          title="Clique pra dismissar"
        >
          <i className={`codicon codicon-${iconForLevel(e.level)} toast-icon`} />
          <div className="toast-body">
            <div className="toast-text">{e.text}</div>
            {e.sub && <div className="toast-sub">{e.sub}</div>}
          </div>
          <i className="codicon codicon-close toast-close" />
        </button>
      ))}
    </div>
  );
}
