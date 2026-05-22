/**
 * TerminalView — terminal interativo (xterm.js + node-pty backend).
 *
 * Spawn na primeira mount, conectado ao terminal:spawn do main process.
 * Usuário escreve no xterm -> data via IPC -> shell -> output -> xterm.write.
 * Auto-resize via ResizeObserver + FitAddon.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu';
import { toast } from '../Toast/Toast';
import './TerminalView.css';

interface TerminalViewProps {
  cwd: string;
}

/** Handle exposto via ref — permite parent chamar clear/restart sem toolbar interna. */
export interface TerminalViewHandle {
  clear: () => void;
  restart: () => void;
  /** Escreve `command\r` no PTY — usado pra disparar tarefas (npm run dev, ssh -R, etc) */
  runCommand: (command: string) => void;
  /** Retorna últimas N linhas do buffer ativo (sem ANSI), trim de linhas vazias no topo/base. */
  getRecentLines: (n: number) => string;
  /** Retorna seleção atual ('' se nada selecionado). */
  getSelection: () => string;
}

/**
 * Lê as últimas N linhas do buffer visível do xterm. Combina viewport com
 * scrollback até cobrir N linhas (ou todo o buffer disponível). Faz trim das
 * linhas vazias no início/fim pra retorno mais limpo.
 */
function readRecentLines(term: Terminal, n: number): string {
  const buf = term.buffer.active;
  const totalLines = buf.length;
  const start = Math.max(0, totalLines - n);
  const out: string[] = [];
  for (let i = start; i < totalLines; i += 1) {
    const line = buf.getLine(i);
    if (line) {
      out.push(line.translateToString(true));
    }
  }
  // Trim linhas vazias no topo/base — preserva linhas vazias no meio
  while (out.length > 0 && out[0].trim() === '') out.shift();
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  return out.join('\n');
}

/**
 * Dispara o evento de "terminal -> chat" — ChatView escuta e preenche o composer.
 */
function dispatchTerminalToChat(text: string): void {
  if (!text.trim()) {
    toast.warn('Terminal vazio');
    return;
  }
  window.dispatchEvent(
    new CustomEvent('undrcod:terminal-to-chat', { detail: { text } }),
  );
  toast.success('Enviado pro chat');
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView(
  { cwd },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termIdRef = useRef<string | null>(null);
  const unsubDataRef = useRef<(() => void) | null>(null);
  const unsubExitRef = useRef<(() => void) | null>(null);
  // Forca re-spawn ao incrementar (kill atual + cria novo)
  const [respawnTick, setRespawnTick] = useState(0);

  // Context menu state pra right-click no terminal
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  // Expoe metodos pra parent (BottomPanel) chamar via ref
  useImperativeHandle(ref, () => ({
    clear: () => termRef.current?.clear(),
    restart: () => {
      if (termIdRef.current) {
        window.undrcodAPI?.terminal.kill(termIdRef.current);
        termIdRef.current = null;
      }
      setRespawnTick((n) => n + 1);
    },
    runCommand: (command: string) => {
      if (!termIdRef.current) return;
      // \r dispara execução (Enter). Funciona pra powershell e bash.
      window.undrcodAPI?.terminal.write(termIdRef.current, command + '\r');
    },
    getRecentLines: (n: number) => {
      const t = termRef.current;
      if (!t) return '';
      return readRecentLines(t, n);
    },
    getSelection: () => termRef.current?.getSelection() ?? '',
  }), []);

  useEffect(() => {
    if (!hostRef.current) return;

    // Cria instancia xterm com tema dark (combina com UNDRCOD)
    const term = new Terminal({
      fontFamily: '"Cascadia Code", Consolas, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      theme: {
        background: '#1a1a1a',       // match --bg-card pra terminal sumir no panel
        foreground: '#cccccc',
        cursor: '#4F8FFA',           // brand Antigravity Blue
        cursorAccent: '#1a1a1a',     // match background
        selectionBackground: '#3a3a3a',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);

    termRef.current = term;
    fitRef.current = fit;

    // Fit inicial — espera DOM measure
    requestAnimationFrame(() => {
      try { fit.fit(); } catch { /* ignore */ }
    });

    // Spawn pty backend
    let cancelled = false;
    (async () => {
      const cols = term.cols;
      const rows = term.rows;
      const res = await window.undrcodAPI?.terminal.spawn({ cwd, cols, rows });
      if (cancelled) return;

      if ('error' in res) {
        term.write(`\r\n\x1b[31m${res.error}\x1b[0m\r\n`);
        return;
      }

      const termId = res.termId;
      termIdRef.current = termId;

      // Data PTY -> xterm
      unsubDataRef.current = window.undrcodAPI?.terminal.onData(termId, (data) => {
        term.write(data);
      });

      // Exit
      unsubExitRef.current = window.undrcodAPI?.terminal.onExit(termId, (code) => {
        term.write(`\r\n\x1b[90m[processo encerrou com codigo ${code}]\x1b[0m\r\n`);
        termIdRef.current = null;
      });

      // Input xterm -> PTY
      term.onData((data) => {
        if (termIdRef.current) {
          window.undrcodAPI?.terminal.write(termIdRef.current, data);
        }
      });

      // Resize xterm -> PTY
      term.onResize(({ cols, rows }) => {
        if (termIdRef.current) {
          window.undrcodAPI?.terminal.resize(termIdRef.current, cols, rows);
        }
      });
    })();

    // ResizeObserver — refit quando container muda de tamanho
    const resizeObserver = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* ignore */ }
    });
    resizeObserver.observe(hostRef.current);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      unsubDataRef.current?.();
      unsubExitRef.current?.();
      if (termIdRef.current) {
        window.undrcodAPI?.terminal.kill(termIdRef.current);
        termIdRef.current = null;
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [cwd, respawnTick]);

  const handleContextMenu = (e: ReactMouseEvent) => {
    // Só intercepta se tivermos algo a oferecer. Sempre temos — abrimos o menu.
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const ctxItems: ContextMenuItem[] = (() => {
    const selection = termRef.current?.getSelection() ?? '';
    const hasSelection = selection.trim().length > 0;
    return [
      {
        kind: 'item',
        icon: 'comment',
        label: 'Enviar seleção pro chat',
        disabled: !hasSelection,
        onClick: () => dispatchTerminalToChat(selection),
      },
      {
        kind: 'item',
        icon: 'comment-discussion',
        label: 'Enviar últimas 50 linhas pro chat',
        onClick: () => {
          const t = termRef.current;
          if (!t) return;
          dispatchTerminalToChat(readRecentLines(t, 50));
        },
      },
    ];
  })();

  return (
    <div className="terminal-view-wrap" onContextMenu={handleContextMenu}>
      <div ref={hostRef} className="terminal-view" />
      <ContextMenu
        open={ctxMenu !== null}
        x={ctxMenu?.x ?? 0}
        y={ctxMenu?.y ?? 0}
        items={ctxItems}
        onClose={() => setCtxMenu(null)}
      />
    </div>
  );
});
