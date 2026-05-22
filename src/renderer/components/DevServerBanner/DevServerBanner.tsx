/**
 * DevServerBanner — detecta dev servers locais e oferece abrir no Preview.
 *
 * Polling `window.undrcodAPI?.ports.list()` a cada 5s. Compara contra Set de
 * portas já vistas/dispensadas. Quando aparece porta nova no range de
 * dev common (3000-9999), renderiza banner floating top-right com
 * "Abrir" / "Dismiss".
 *
 * Click "Abrir" → dispara CustomEvent `undrcod:open-preview` { url } no window.
 * App.tsx escuta e abre o Preview pane.
 *
 * Dismiss adiciona a porta ao Set de "ignored" pra não re-mostrar nessa
 * sessão. Reload da app limpa (intencional — pra re-detectar após restart
 * do dev server).
 *
 * Portas comuns priorizadas (3000, 3001, 4200, 5173, 5174, 8080, 8000)
 * pra escolher a "melhor" candidata quando várias surgem ao mesmo tempo.
 */

import { useEffect, useRef, useState } from 'react';
import './DevServerBanner.css';

const POLL_INTERVAL_MS = 5000;
const MIN_PORT = 3000;
const MAX_PORT = 9999;

/** Portas excluídas — provavelmente NÃO são dev servers de app web. */
const EXCLUDED_PORTS = new Set<number>([
  3306, // MySQL
  5432, // Postgres
  6379, // Redis
  9000, // PHP-FPM, sonarqube
  9229, // node --inspect
  9230, // node --inspect alt
  27017, // MongoDB
]);

/** Prioridade — quando várias portas surgem ao mesmo tempo, pega a primeira da lista. */
const PRIORITY_PORTS = [3000, 3001, 5173, 5174, 4200, 8080, 8000, 4321, 5000];

interface PortEntry {
  port: number;
  address: string;
  process?: string;
}

function isDevServerCandidate(p: PortEntry): boolean {
  if (p.port < MIN_PORT || p.port > MAX_PORT) return false;
  if (EXCLUDED_PORTS.has(p.port)) return false;
  return true;
}

function pickBestCandidate(ports: number[]): number | null {
  if (ports.length === 0) return null;
  for (const pref of PRIORITY_PORTS) {
    if (ports.includes(pref)) return pref;
  }
  // fallback: menor porta (geralmente a "principal" do dev server)
  return [...ports].sort((a, b) => a - b)[0];
}

export function DevServerBanner() {
  // Portas que já vimos OU foram dispensadas — não notifica de novo.
  // Inicializa vazio: na primeira call, todas as portas atuais entram no Set
  // sem disparar banner (só queremos notificar portas que surgem DEPOIS).
  const seenRef = useRef<Set<number>>(new Set());
  const initializedRef = useRef(false);
  const [activePort, setActivePort] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const ports = await window.undrcodAPI?.ports.list();
        if (cancelled) return;

        const candidates = ports.filter(isDevServerCandidate).map((p) => p.port);
        const candidateSet = new Set(candidates);

        if (!initializedRef.current) {
          // Primeira execução: registra tudo como "já visto" sem alertar.
          for (const port of candidates) seenRef.current.add(port);
          initializedRef.current = true;
          return;
        }

        // Limpa portas que sumiram (dev server parado) do Set —
        // permite re-detectar quando voltar.
        for (const seen of [...seenRef.current]) {
          if (!candidateSet.has(seen)) seenRef.current.delete(seen);
        }

        // Detecta portas novas (que ainda não foram seen/dismissed).
        const novel = candidates.filter((p) => !seenRef.current.has(p));
        if (novel.length === 0) return;

        const best = pickBestCandidate(novel);
        if (best == null) return;

        // Marca todas as novas como seen pra não acumular banners.
        // (Se o user quiser ver outras, abre o tab "Ports" no BottomPanel.)
        for (const p of novel) seenRef.current.add(p);

        // Só mostra um banner por vez. Se já tem ativo, ignora.
        setActivePort((prev) => prev ?? best);
      } catch {
        // ports.list pode falhar transitoriamente — silent retry no próximo poll.
      }
    }

    // Primeira execução imediata pra inicializar baseline.
    poll();
    const id = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (activePort == null) return null;

  const url = `http://localhost:${activePort}`;

  const handleOpen = () => {
    try {
      window.dispatchEvent(
        new CustomEvent('undrcod:open-preview', { detail: { url } }),
      );
    } catch {
      /* ignore */
    }
    setActivePort(null);
  };

  const handleDismiss = () => {
    setActivePort(null);
  };

  return (
    <div className="dev-server-banner" role="status" aria-live="polite">
      <div className="dev-server-banner-icon" aria-hidden="true">
        <i className="codicon codicon-link" />
      </div>
      <div className="dev-server-banner-body">
        <div className="dev-server-banner-title">Dev server detectado</div>
        <div className="dev-server-banner-sub">localhost:{activePort}</div>
      </div>
      <div className="dev-server-banner-actions">
        <button
          type="button"
          className="dev-server-banner-btn dev-server-banner-btn--primary"
          onClick={handleOpen}
          title={`Abrir ${url} no Preview`}
        >
          Abrir
        </button>
        <button
          type="button"
          className="dev-server-banner-btn"
          onClick={handleDismiss}
          title="Dispensar"
          aria-label="Dispensar"
        >
          <i className="codicon codicon-close" />
        </button>
      </div>
    </div>
  );
}
