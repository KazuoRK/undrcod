import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as Xterm } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import 'xterm/css/xterm.css';
import './Terminal.css';

interface TerminalProps {
  cwd: string;
  onStatusChange?: (status: string) => void;
}

/**
 * Converte um path absoluto pra @relative (relativo ao workspace cwd).
 * Pasta: termina com `/`. Arquivo: sem `/` no final.
 */
function pathToMention(absolutePath: string, cwd: string, isDir: boolean): string {
  let rel = absolutePath;
  if (rel.startsWith(cwd)) {
    rel = rel.slice(cwd.length).replace(/\\/g, '/');
    if (rel.startsWith('/')) rel = rel.slice(1);
  } else {
    rel = rel.replace(/\\/g, '/');
  }
  if (isDir && !rel.endsWith('/')) rel += '/';
  return '@' + rel;
}

export function Terminal({ cwd, onStatusChange }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Xterm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const xterm = new Xterm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: '"JetBrains Mono", "Cascadia Code", "Cascadia Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.3,
      scrollback: 10000,
      allowProposedApi: true,
      theme: {
        background: '#1a1a1a',
        foreground: '#e8e8e8',
        cursor: '#e87a3e',
        cursorAccent: '#1a1a1a',
        selectionBackground: 'rgba(232, 122, 62, 0.25)',
        selectionForeground: '#ffffff',
        black: '#1a1a1a',
        red: '#f48771',
        green: '#4ec9b0',
        yellow: '#e2c08d',
        blue: '#569cd6',
        magenta: '#c586c0',
        cyan: '#9cdcfe',
        white: '#e8e8e8',
        brightBlack: '#7a7a7a',
        brightRed: '#f48771',
        brightGreen: '#4ec9b0',
        brightYellow: '#e2c08d',
        brightBlue: '#569cd6',
        brightMagenta: '#c586c0',
        brightCyan: '#9cdcfe',
        brightWhite: '#ffffff'
      }
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(new WebLinksAddon());
    xterm.open(containerRef.current);

    // Guard: só fit() quando container tem dimensão real. xterm crasha com
    // "Cannot read properties of undefined (reading 'dimensions')" se for
    // chamado antes do layout estar pronto (visible: false ou height: 0).
    const tryFit = (): void => {
      const el = containerRef.current;
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) {
        // Try again next frame se container ainda não tem layout.
        requestAnimationFrame(tryFit);
        return;
      }
      try { fitAddon.fit(); } catch { /* xterm pode jogar se render-service ainda não pronto */ }
    };
    requestAnimationFrame(tryFit);

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    let unsubData: (() => void) | null = null;
    let unsubExit: (() => void) | null = null;
    let disposed = false;

    onStatusChange?.('starting');
    xterm.writeln('\x1b[38;2;122;122;122m✶ Iniciando claude em\x1b[0m \x1b[38;2;232;122;62m' + cwd + '\x1b[0m\x1b[38;2;122;122;122m...\x1b[0m');
    xterm.writeln('');

    window.undrcodAPI?.claude.spawn({ cwd }).then((result) => {
      if (disposed) return;

      if ('error' in result) {
        setError(result.error);
        onStatusChange?.('error');
        xterm.writeln(`\r\n\x1b[31m✗ Falha: ${result.error}\x1b[0m`);
        xterm.writeln('\x1b[38;2;122;122;122mVerifica se \x1b[38;2;232;122;62mclaude\x1b[0m\x1b[38;2;122;122;122m está instalado (npm i -g @anthropic-ai/claude-code).\x1b[0m');
        return;
      }

      ptyIdRef.current = result.ptyId;
      onStatusChange?.('running');

      unsubData = window.undrcodAPI?.claude.onData(result.ptyId, (data) => {
        if (!disposed) xterm.write(data);
      });

      unsubExit = window.undrcodAPI?.claude.onExit(result.ptyId, (code) => {
        if (disposed) return;
        onStatusChange?.('exited');
        xterm.writeln(`\r\n\x1b[38;2;122;122;122m[claude saiu com código ${code}]\x1b[0m`);
      });

      window.undrcodAPI?.claude.resize(result.ptyId, xterm.cols, xterm.rows);
    });

    const userDataDisposable = xterm.onData((data) => {
      if (ptyIdRef.current) {
        window.undrcodAPI?.claude.write(ptyIdRef.current, data);
      }
    });

    const handleResize = () => {
      // Mesmo guard de dimensão zero — resize pode rodar antes do container
      // ter layout (ex: container hidden/collapsed).
      const el = containerRef.current;
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
      try { fitAddon.fit(); } catch { /* ignore */ }
      if (ptyIdRef.current && xterm) {
        window.undrcodAPI?.claude.resize(ptyIdRef.current, xterm.cols, xterm.rows);
      }
    };

    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      disposed = true;
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      unsubData?.();
      unsubExit?.();
      userDataDisposable.dispose();
      if (ptyIdRef.current) {
        window.undrcodAPI?.claude.kill(ptyIdRef.current);
      }
      xterm.dispose();
    };
  }, [cwd]);

  // ===== Drag-drop handlers =====

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Aceita drop apenas se tiver nosso custom type
    const types = Array.from(e.dataTransfer.types);
    if (types.includes('application/x-undrcod-path')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!isDragOver) setIsDragOver(true);
    }
  }, [isDragOver]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Só remove highlight quando sai do wrapper inteiro
    const related = e.relatedTarget as Node | null;
    if (!related || !e.currentTarget.contains(related)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const path = e.dataTransfer.getData('application/x-undrcod-path');
    const type = e.dataTransfer.getData('application/x-undrcod-type');
    if (!path || !ptyIdRef.current) return;

    const mention = pathToMention(path, cwdRef.current, type === 'dir');

    // Escreve no PTY como se o usuário tivesse digitado.
    // Adiciona espaço no final pra separar de eventual texto seguinte.
    window.undrcodAPI?.claude.write(ptyIdRef.current, mention + ' ');

    // Foca o terminal pra continuar digitando
    xtermRef.current?.focus();
  }, []);

  return (
    <div
      className={`terminal-wrapper ${isDragOver ? 'is-drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {error && (
        <div className="terminal-error-banner">
          ⚠️ {error}
        </div>
      )}
      <div ref={containerRef} className="terminal-container" />
      {isDragOver && (
        <div className="terminal-drop-overlay">
          <div className="terminal-drop-message">
            ⤓ Solta aqui pra adicionar como <code>@mention</code>
          </div>
        </div>
      )}
    </div>
  );
}
