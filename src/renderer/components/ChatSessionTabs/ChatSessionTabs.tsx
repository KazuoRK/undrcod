/**
 * ChatSessionTabs — tabbar no topo do ChatView pra trocar entre sessions paralelas.
 *
 * O agent-manager.ts já suporta múltiplas sessions; aqui só guardamos a lista de
 * tabs (id, label, createdAt) e qual é a ativa. Click switch, "+" cria nova,
 * right-click abre context menu (Renomear, Fechar, Duplicar).
 *
 * Persistido em localStorage workspace-scoped — chave `undrcode.chatSessions.<cwd>`.
 * Atalhos (Ctrl+Shift+1..9, Ctrl+Shift+N) ficam no keydown handler do App.tsx
 * — esse componente só renderiza UI.
 */
import { useState, useCallback, useRef } from 'react';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu';
import { OverlayScrollbar } from '../OverlayScrollbar/OverlayScrollbar';
import './ChatSessionTabs.css';

export interface ChatSessionTab {
  id: string;
  label: string;
  createdAt: number;
  /** Label customizado via "Renomear". Quando setado, sobrepoe `label` auto-gerado. */
  customLabel?: string;
}

interface ChatSessionTabsProps {
  sessions: ChatSessionTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, newLabel: string) => void;
  onDuplicate: (id: string) => void;
  /** Abre o painel de histórico de conversas (clock button + item do overflow). */
  onOpenHistory?: () => void;
  /** Abre Settings modal (overflow > Configurações). */
  onOpenSettings?: () => void;
  /** Exporta transcript da session ativa como markdown na clipboard. */
  onExportTranscript?: () => void;
}

function displayLabel(tab: ChatSessionTab): string {
  return tab.customLabel?.trim() || tab.label;
}

export function ChatSessionTabs({
  sessions,
  activeId,
  onSelect,
  onClose,
  onNew,
  onRename,
  onDuplicate,
  onOpenHistory,
  onOpenSettings,
  onExportTranscript,
}: ChatSessionTabsProps) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null);
  const [overflowMenu, setOverflowMenu] = useState<{ x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');

  const startRename = useCallback((id: string) => {
    const t = sessions.find((s) => s.id === id);
    if (!t) return;
    setRenamingId(id);
    setRenameValue(displayLabel(t));
  }, [sessions]);

  const commitRename = useCallback(() => {
    if (!renamingId) return;
    const v = renameValue.trim();
    onRename(renamingId, v);
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, onRename]);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue('');
  }, []);

  const handleRightClick = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, sessionId: id });
  }, []);

  const ctxItems: ContextMenuItem[] = ctxMenu
    ? [
        {
          kind: 'item',
          icon: 'edit',
          label: 'Renomear',
          shortcut: 'F2',
          onClick: () => startRename(ctxMenu.sessionId),
        },
        {
          kind: 'item',
          icon: 'copy',
          label: 'Duplicar',
          onClick: () => onDuplicate(ctxMenu.sessionId),
        },
        { kind: 'divider' },
        {
          kind: 'item',
          icon: 'close',
          label: 'Fechar',
          shortcut: 'Ctrl W',
          destructive: true,
          disabled: sessions.length <= 1,
          onClick: () => onClose(ctxMenu.sessionId),
        },
      ]
    : [];

  // Mouse-wheel vertical → scroll horizontal (Cursor/VS Code pattern).
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>): void => {
    if (e.deltaY === 0) return;
    const el = e.currentTarget;
    if (el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft += e.deltaY;
  }, []);

  // Overlay scrollbar custom (Cursor pattern) — extraído em <OverlayScrollbar>.
  // Native webkit scrollbar SEMPRE reserva layout space; o componente esconde
  // nativa e renderiza thumb absolute no parent (`.chat-session-tabs`).
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="chat-session-tabs has-overlay-scrollbar">
      <div
        className="chat-session-tabs-scroll"
        ref={scrollRef}
        onWheel={handleWheel}
      >
        {sessions.map((t, i) => {
          const isActive = t.id === activeId;
          const isRenaming = renamingId === t.id;
          const shortcutHint = i < 9 ? `Ctrl+Shift+${i + 1}` : undefined;
          return (
            <div
              key={t.id}
              className={`chat-session-tab ${isActive ? 'is-active' : ''}`}
              onClick={() => !isRenaming && onSelect(t.id)}
              onContextMenu={(e) => handleRightClick(e, t.id)}
              onDoubleClick={() => startRename(t.id)}
              title={shortcutHint ? `${displayLabel(t)} — ${shortcutHint}` : displayLabel(t)}
            >
              <i className="codicon codicon-comment-discussion chat-session-tab-icon" />
              {isRenaming ? (
                <input
                  className="chat-session-tab-rename-input"
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelRename();
                    }
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="chat-session-tab-label">{displayLabel(t)}</span>
              )}
              {sessions.length > 1 && !isRenaming && (
                <button
                  type="button"
                  className="chat-session-tab-close"
                  title="Fechar (Ctrl+W)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(t.id);
                  }}
                >
                  <i className="codicon codicon-close" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {/* Overlay scrollbar custom — componente reutilizável. Anchorado no
       * parent `.chat-session-tabs` (position:relative) e sincroniza com
       * o `.chat-session-tabs-scroll` via ref. */}
      <OverlayScrollbar targetRef={scrollRef} orientation="horizontal" />
      <button
        type="button"
        className="chat-session-tabs-new"
        title="Nova conversa (Ctrl+Shift+N)"
        onClick={onNew}
      >
        <i className="codicon codicon-add" />
      </button>

      {/* Trailing actions: history (clock) + overflow menu.
       * Padrão Cursor — quick-access pra ações da sessão sem ter que ir
       * no activity bar "..." (que é overflow de VIEWS, não de sessão). */}
      {onOpenHistory && (
        <button
          type="button"
          className="chat-session-tabs-action"
          title="Histórico de conversas (Ctrl+Shift+H)"
          aria-label="Histórico de conversas"
          onClick={onOpenHistory}
        >
          <i className="codicon codicon-history" />
        </button>
      )}

      {(onOpenSettings || onExportTranscript) && (
        <button
          type="button"
          className="chat-session-tabs-action"
          title="Mais opções"
          aria-label="Mais opções"
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setOverflowMenu({ x: rect.right - 220, y: rect.bottom + 4 });
          }}
        >
          <i className="codicon codicon-ellipsis" />
        </button>
      )}

      <ContextMenu
        open={!!ctxMenu}
        x={ctxMenu?.x ?? 0}
        y={ctxMenu?.y ?? 0}
        items={ctxItems}
        onClose={() => setCtxMenu(null)}
      />

      <ContextMenu
        open={!!overflowMenu}
        x={overflowMenu?.x ?? 0}
        y={overflowMenu?.y ?? 0}
        items={[
          ...(onExportTranscript
            ? ([{
                kind: 'item' as const,
                icon: 'export',
                label: 'Exportar transcript',
                onClick: () => { setOverflowMenu(null); onExportTranscript(); },
              }] satisfies ContextMenuItem[])
            : []),
          ...(onOpenSettings
            ? ([
                { kind: 'divider' as const },
                {
                  kind: 'item' as const,
                  icon: 'settings-gear',
                  label: 'Configurações do agente',
                  shortcut: 'Ctrl ,',
                  onClick: () => { setOverflowMenu(null); onOpenSettings(); },
                },
              ] satisfies ContextMenuItem[])
            : []),
        ]}
        onClose={() => setOverflowMenu(null)}
      />
    </div>
  );
}
