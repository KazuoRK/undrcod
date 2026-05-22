/**
 * CentralTabs — header de tabs do pane-mid (editor area).
 *
 * Cada tab pode ser:
 *   - kind 'file': arquivo aberto (mostra FilePreview)
 *   - kind 'view': view especial (Tarefas, Plano, Ver previa, Diff, Arquivos)
 *
 * Terminal NAO entra aqui — terminal e Problems/Output/etc vivem no Bottom Panel.
 *
 * Comportamento:
 *   - Click numa tab: ativa ela
 *   - Click no X: fecha (se for a ativa, ativa a anterior; se for a última, mostra empty)
 *   - Drag pra reordenar (HTML5 DnD): callback `onReorder(newOrder)` opcional
 *
 * Dirty state:
 *   - Caller passa `dirtyPaths: Set<string>` com paths de arquivos com edits
 *     não-salvos. Indicamos com bullet (●) antes do nome.
 *   - Click no close se path tá dirty → confirm() nativo antes de fechar.
 */

import { useMemo, useState } from 'react';
import { confirmDialog } from '../ConfirmDialog/ConfirmDialog';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu';
import { toast } from '../Toast/Toast';
import './CentralTabs.css';

/** Views que podem aparecer como tab central (pane-mid). Exclui bottom panel views. */
export type CentralViewId = 'preview' | 'diff' | 'files' | 'tasks' | 'plan';

export type CentralTab =
  | { id: string; kind: 'file'; path: string; pinned?: boolean; gotoLine?: number; matchStart?: number; matchEnd?: number }
  | { id: string; kind: 'view'; viewId: CentralViewId; title: string; icon: string; pinned?: boolean }
  | { id: string; kind: 'compare'; leftPath: string; rightPath: string; pinned?: boolean };

interface CentralTabsProps {
  tabs: CentralTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** Paths de arquivos com edits não-salvos. Tab mostra indicator visual. */
  dirtyPaths?: Set<string>;
  /** Callback opcional pra persistir reordenação. Receve a nova ordem de ids. */
  onReorder?: (newOrder: string[]) => void;
  /** Callback opcional pra "Close All" — fecha tudo de uma vez (pula confirm individual). */
  onCloseAll?: () => void;
  /** Callback opcional pra alternar pin/unpin de uma tab (mesma callback é toggle). */
  onPin?: (id: string) => void;
  /** Root do workspace — usado pra calcular "Copy Relative Path" no context menu. */
  workspaceRoot?: string;
}

function fileTabName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function tabIcon(tab: CentralTab): string {
  if (tab.kind === 'file') {
    const ext = tab.path.split('.').pop()?.toLowerCase();
    if (ext === 'md') return 'markdown';
    if (ext === 'json') return 'json';
    if (ext === 'tsx' || ext === 'ts' || ext === 'js' || ext === 'jsx') return 'symbol-file';
    if (ext === 'css' || ext === 'scss') return 'symbol-color';
    if (ext === 'html') return 'symbol-tag';
    return 'file-code';
  }
  if (tab.kind === 'compare') return 'diff';
  return tab.icon;
}

function tabLabel(tab: CentralTab): string {
  if (tab.kind === 'file') return fileTabName(tab.path);
  if (tab.kind === 'compare') return `${fileTabName(tab.leftPath)} ↔ ${fileTabName(tab.rightPath)}`;
  return tab.title;
}

export function CentralTabs({ tabs, activeTabId, onSelect, onClose, dirtyPaths, onReorder, onCloseAll, onPin, workspaceRoot }: CentralTabsProps) {
  // Sem tabs abertas → nada renderiza (WelcomeView fica flush no topo do pane-mid card).
  if (tabs.length === 0) return null;

  // Pinned tabs sempre ficam à esquerda, mantendo ordem relativa entre si.
  // Reordenação visual só — array original do parent não muda.
  const displayTabs = [
    ...tabs.filter((t) => t.pinned),
    ...tabs.filter((t) => !t.pinned),
  ];

  // === Drag state pra reordenação ===
  // draggedId: id da tab sendo arrastada (renderiza com `is-dragging`)
  // dropTargetId: id da tab sob o cursor (renderiza com `is-drop-target`)
  // Usamos useState (re-render no hover é OK pra ~10 tabs)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [draggedId, setDraggedId] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Context menu da tab (right-click) — posição + id da tab alvo
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  // Editor group "..." menu — replica menu Cursor do canto direito do strip
  const [groupMenu, setGroupMenu] = useState<{ open: boolean; x: number; y: number }>({
    open: false, x: 0, y: 0,
  });

  // Helpers pra context menu — todos preservam pinned tabs (pulam no close).
  const closeOthers = (keepId: string) => {
    const toClose = tabs.filter((t) => t.id !== keepId && !t.pinned);
    for (const t of toClose) onClose(t.id);
  };
  const closeToRight = (fromId: string) => {
    // Usa displayTabs (com pinned à esquerda) pra "à direita" fazer sentido visual.
    const idx = displayTabs.findIndex((t) => t.id === fromId);
    if (idx < 0) return;
    const toClose = displayTabs.slice(idx + 1).filter((t) => !t.pinned);
    for (const t of toClose) onClose(t.id);
  };
  const closeAll = () => {
    // Preserva pinned. Se quer fechar pinned tem que unpin primeiro.
    const closeable = tabs.filter((t) => !t.pinned);
    if (onCloseAll && closeable.length === tabs.length) {
      onCloseAll();
    } else {
      for (const t of closeable) onClose(t.id);
    }
  };
  const copyTabPath = (id: string) => {
    const t = tabs.find((x) => x.id === id);
    if (!t) return;
    let text: string;
    if (t.kind === 'file') text = t.path;
    else if (t.kind === 'compare') text = `${t.leftPath} ↔ ${t.rightPath}`;
    else text = t.title;
    // Tenta Electron clipboard API primeiro (funciona mesmo sem focus do doc).
    // Fallback: navigator.clipboard (que falha silenciosamente após context menu).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electronClipboard = (window as any).akaiAPI?.clipboard?.writeText;
    if (typeof electronClipboard === 'function') {
      electronClipboard(text);
      toast.success('Caminho copiado');
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => toast.success('Caminho copiado'),
      () => toast.error('Falha ao copiar — reinicie o app'),
    );
  };

  const revealInTree = (id: string) => {
    const t = tabs.find((x) => x.id === id);
    if (!t || t.kind !== 'file') return;
    window.dispatchEvent(
      new CustomEvent('akai:reveal-in-tree', { detail: { path: t.path } }),
    );
  };

  const copyRelativePath = (id: string) => {
    const t = tabs.find((x) => x.id === id);
    if (!t || t.kind !== 'file') return;
    // Pega cwd via window.akaiAPI.getCwd ou path do tab — fallback: filename só
    const fullPath = t.path;
    const rel = workspaceRoot && fullPath.startsWith(workspaceRoot)
      ? fullPath.slice(workspaceRoot.length).replace(/\\/g, '/').replace(/^\//, '')
      : fullPath.replace(/\\/g, '/').split('/').pop() || fullPath;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (window as any).akaiAPI?.clipboard?.writeText;
    if (typeof fn === 'function') {
      fn(rel);
      toast.success('Caminho relativo copiado');
      return;
    }
    navigator.clipboard.writeText(rel).then(
      () => toast.success('Caminho relativo copiado'),
      () => toast.error('Falha ao copiar'),
    );
  };

  const revealInExplorer = (id: string) => {
    const t = tabs.find((x) => x.id === id);
    if (!t || t.kind !== 'file') return;
    window.akaiAPI?.fs?.revealInOs?.(t.path);
    toast.info('Aberto no Explorer');
  };

  const openInBrowser = (id: string) => {
    // "Abrir no navegador" agora abre no PREVIEW INTERNO do app (webview),
    // não no browser externo — user preferiu não ficar abrindo Chrome toda vez.
    // Pra abrir no browser externo: botão link-external no toolbar do preview.
    const t = tabs.find((x) => x.id === id);
    if (!t || t.kind !== 'file') return;
    const normalized = t.path.replace(/\\/g, '/');
    const m = normalized.match(/^([a-zA-Z]):\/(.*)$/);
    const fileUrl = m
      ? `file:///${m[1].toUpperCase()}:/${m[2].split('/').map((s) => encodeURIComponent(s)).join('/')}`
      : `file://${normalized}`;
    window.dispatchEvent(new CustomEvent('akai:open-preview', { detail: { url: fileUrl } }));
  };

  const tabMenuItems = (id: string): ContextMenuItem[] => {
    const t = tabs.find((x) => x.id === id);
    const isFile = t?.kind === 'file';
    const isPinned = !!t?.pinned;
    const idx = displayTabs.findIndex((x) => x.id === id);
    const hasRight = idx >= 0 && idx < displayTabs.length - 1;
    const nonPinnedCount = tabs.filter((x) => !x.pinned).length;
    const hasOthers = tabs.length > 1;
    const items: ContextMenuItem[] = [
      { kind: 'item', icon: 'close', label: 'Fechar', shortcut: 'Ctrl W', disabled: isPinned, onClick: () => onClose(id) },
      { kind: 'item', icon: 'close-all', label: 'Fechar outras', disabled: !hasOthers || nonPinnedCount === 0, onClick: () => closeOthers(id) },
      { kind: 'item', icon: 'close-all', label: 'Fechar à direita', disabled: !hasRight, onClick: () => closeToRight(id) },
      { kind: 'item', icon: 'clear-all', label: 'Fechar todas', disabled: nonPinnedCount === 0, onClick: () => closeAll() },
      { kind: 'divider' },
    ];
    if (onPin) {
      items.push({
        kind: 'item',
        icon: isPinned ? 'pin' : 'pinned',
        label: isPinned ? 'Desafixar tab' : 'Fixar tab',
        onClick: () => onPin(id),
      });
      items.push({ kind: 'divider' });
    }
    items.push(
      { kind: 'item', icon: 'clippy', label: isFile ? 'Copiar caminho' : 'Copiar título', onClick: () => copyTabPath(id) },
    );
    if (isFile) {
      // Detect openable in browser pra arquivo da tab
      const ext = (t?.kind === 'file' ? t.path : '').split('.').pop()?.toLowerCase() || '';
      const isWebPreviewable = ['html', 'htm', 'svg', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext);
      items.push(
        { kind: 'item', icon: 'symbol-string', label: 'Copiar caminho relativo', onClick: () => copyRelativePath(id) },
        { kind: 'divider' },
        { kind: 'item', icon: 'list-tree', label: 'Revelar no FileTree', onClick: () => revealInTree(id) },
        { kind: 'item', icon: 'folder-opened', label: 'Revelar no Explorer', onClick: () => revealInExplorer(id) },
        { kind: 'divider' },
        {
          kind: 'item',
          icon: 'globe',
          label: 'Abrir no navegador',
          disabled: !isWebPreviewable,
          onClick: () => openInBrowser(id),
        },
      );
    }
    return items;
  };

  const handleDragStart = (id: string) => (e: React.DragEvent) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
    // payload custom pra distinguir de file-drops externos no composer
    e.dataTransfer.setData('application/x-akai-tab', id);
  };

  const handleDragOver = (id: string) => (e: React.DragEvent) => {
    if (!draggedId) return;
    e.preventDefault(); // habilita o drop
    e.dataTransfer.dropEffect = 'move';
    if (id !== dropTargetId) setDropTargetId(id);
  };

  const handleDrop = (targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const sourceId = draggedId || e.dataTransfer.getData('application/x-akai-tab');
    setDraggedId(null);
    setDropTargetId(null);
    if (!sourceId || sourceId === targetId || !onReorder) return;
    const sourceIdx = tabs.findIndex((t) => t.id === sourceId);
    const targetIdx = tabs.findIndex((t) => t.id === targetId);
    if (sourceIdx < 0 || targetIdx < 0) return;
    const reordered = [...tabs];
    const [moved] = reordered.splice(sourceIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    onReorder(reordered.map((t) => t.id));
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDropTargetId(null);
  };

  return (
    <div className="central-tabs">
      {displayTabs.map((t) => {
        const isActive = t.id === activeTabId;
        const isDirty = t.kind === 'file' && !!dirtyPaths?.has(t.path);
        const isDragging = draggedId === t.id;
        const isDropTarget = dropTargetId === t.id && draggedId !== t.id;
        const isPinned = !!t.pinned;
        return (
          <div
            key={t.id}
            className={`central-tab ${isActive ? 'is-active' : ''} ${isDirty ? 'is-dirty' : ''} ${isDragging ? 'is-dragging' : ''} ${isDropTarget ? 'is-drop-target' : ''} ${isPinned ? 'is-pinned' : ''}`}
            onClick={() => onSelect(t.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setTabMenu({ x: e.clientX, y: e.clientY, tabId: t.id });
            }}
            title={
              t.kind === 'file'
                ? (isPinned ? `📌 ${t.path}` : t.path)
                : t.kind === 'compare'
                  ? `${t.leftPath} ↔ ${t.rightPath}`
                  : t.title
            }
            draggable={!!onReorder && !isPinned}
            onDragStart={handleDragStart(t.id)}
            onDragOver={handleDragOver(t.id)}
            onDragLeave={() => { if (dropTargetId === t.id) setDropTargetId(null); }}
            onDrop={handleDrop(t.id)}
            onDragEnd={handleDragEnd}
          >
            {isDirty && (
              <span className="central-tab-dirty-dot" aria-label="Não-salvo">●</span>
            )}
            {!isDirty && <i className={`codicon codicon-${tabIcon(t)} central-tab-icon`} />}
            <span className="central-tab-label">{tabLabel(t)}</span>
            {isPinned ? (
              <button
                type="button"
                className="central-tab-pin-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onPin) onPin(t.id);
                }}
                title="Fixada — clique pra desafixar"
                aria-label="Desafixar tab"
              >
                <i className="codicon codicon-pinned" />
              </button>
            ) : (
            <button
              type="button"
              className="central-tab-close"
              onClick={async (e) => {
                e.stopPropagation();
                if (isDirty) {
                  const ok = await confirmDialog({
                    title: 'Descartar alterações?',
                    message: `"${fileTabName(t.kind === 'file' ? t.path : '')}" tem alterações não-salvas. Fechar e descartar?`,
                    confirmLabel: 'Descartar',
                    destructive: true,
                  });
                  if (!ok) return;
                }
                onClose(t.id);
              }}
              title={isDirty ? 'Fechar (descartar alterações)' : 'Fechar'}
            >
              <i className="codicon codicon-close" />
            </button>
            )}
          </div>
        );
      })}
      {/* Editor Group More Menu (replica menu "..." do Cursor) — fica no final do strip */}
      <div className="central-tabs-spacer" />
      <button
        type="button"
        className="central-tabs-more-btn"
        title="Mais opções"
        onClick={(e) => {
          // Toggle: se já aberto, fecha; senão abre. Evita re-abrir após
          // outside-click handler já ter fechado pelo mousedown anterior.
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setGroupMenu((prev) => prev.open
            ? { ...prev, open: false }
            : { open: true, x: rect.right - 220, y: rect.bottom + 4 });
        }}
        aria-label="Editor group menu"
      >
        <i className="codicon codicon-ellipsis" />
      </button>
      <ContextMenu
        open={tabMenu !== null}
        x={tabMenu?.x ?? 0}
        y={tabMenu?.y ?? 0}
        items={tabMenu ? tabMenuItems(tabMenu.tabId) : []}
        onClose={() => setTabMenu(null)}
      />
      {/* Editor Group menu items — replica menu do Cursor (Close All, etc.) */}
      <ContextMenu
        open={groupMenu.open}
        x={groupMenu.x}
        y={groupMenu.y}
        items={[
          { kind: 'item', icon: 'close-all', label: 'Fechar todas', shortcut: 'Ctrl K W', disabled: tabs.filter(t => !t.pinned).length === 0, onClick: () => closeAll() },
          { kind: 'divider' },
          {
            kind: 'item',
            icon: 'pin',
            label: 'Desafixar todas',
            disabled: tabs.filter(t => t.pinned).length === 0,
            onClick: () => {
              if (!onPin) return;
              for (const t of tabs.filter(x => x.pinned)) onPin(t.id);
            },
          },
        ] as ContextMenuItem[]}
        onClose={() => setGroupMenu({ ...groupMenu, open: false })}
      />
    </div>
  );
}
