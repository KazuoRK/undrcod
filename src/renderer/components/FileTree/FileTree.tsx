import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { getFileIcon, getFolderIcon } from '../../utils/fileIcon';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu';
import { confirmDialog } from '../ConfirmDialog/ConfirmDialog';
import { toast } from '../Toast/Toast';
import { OverlayScrollbar } from '../OverlayScrollbar/OverlayScrollbar';
import './FileTree.css';

/**
 * Helper pra disparar refresh de uma dir específica no tree.
 * Cada FileTreeItem escuta esse event e re-listDir se for seu próprio path.
 */
function dispatchTreeRefresh(dir: string): void {
  window.dispatchEvent(new CustomEvent('undrcod:tree-refresh', { detail: { dir } }));
}

/** Join path em forma cross-platform usando o separador do path original. */
function joinPath(parent: string, child: string): string {
  const sep = parent.includes('\\') ? '\\' : '/';
  return parent.endsWith(sep) ? parent + child : parent + sep + child;
}

function getDirname(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(0, idx) : p;
}

function getBasename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/**
 * Estado compartilhado entre menus pra ação "Comparar com...".
 * Primeiro click captura o left; segundo click dispara o diff.
 * Módulo-level porque cada FileTreeItem tem seu menuItems memo isolado.
 */
let pendingCompareLeft: string | null = null;

function getExtAndBase(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * Extensões consideradas "texto" pra hover preview. Lista deliberadamente
 * conservadora — qualquer coisa fora daqui (imagens, binários, fonts, etc)
 * skip preview pra evitar tentar ler bytes não-textuais.
 */
const PREVIEWABLE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.md', '.mdx', '.txt', '.log',
  '.json', '.jsonc', '.json5',
  '.css', '.scss', '.sass', '.less',
  '.html', '.htm', '.xml', '.svg',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cs',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.env',
  '.sql', '.graphql', '.gql',
  '.vue', '.svelte', '.astro',
  '.gitignore', '.editorconfig',
]);

function isPreviewable(name: string): boolean {
  const lower = name.toLowerCase();
  // Dotfiles tipo .gitignore não tem ext via getExtAndBase (dot na pos 0)
  if (lower.startsWith('.')) {
    return PREVIEWABLE_EXTS.has(lower);
  }
  const { ext } = getExtAndBase(lower);
  if (!ext) {
    // Sem ext: arquivos como "Dockerfile", "Makefile", "README" — assumimos texto
    return true;
  }
  return PREVIEWABLE_EXTS.has(ext);
}

interface FsEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
}

interface FileTreeProps {
  workspaceRoot: string;
  onOpenWorkspace?: () => void;
  onFileOpen?: (path: string) => void;
  /** Callback quando user clica no botão @ que aparece no hover do item. */
  onMention?: (absolutePath: string, type: 'file' | 'dir') => void;
  activeFilePath?: string | null;
}

export function FileTree({ workspaceRoot, onOpenWorkspace, onFileOpen, onMention, activeFilePath }: FileTreeProps) {
  const projectName = (workspaceRoot.split(/[\\/]/).pop() || workspaceRoot).toUpperCase();
  const [collapsed, setCollapsed] = useState(false);
  // Filter inline: toggle abre input compacto abaixo do header. Query é
  // propagada via prop pra cada FileTreeItem decidir visibilidade.
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  // Drop target highlight quando user arrasta arquivo do OS (Explorer/Finder) pra cima do tree.
  // Só ativa pra payload com `Files` (não pra drags internos do tree, que usam x-undrcod-*).
  const [isDropTarget, setIsDropTarget] = useState(false);

  const handleRootDragOver = useCallback((e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDropTarget(true);
    }
  }, []);

  const handleRootDragLeave = useCallback((e: React.DragEvent) => {
    // Só limpa se o cursor saiu de fato do container (não de filho pra filho).
    // relatedTarget é o elemento pra onde o cursor foi.
    const related = e.relatedTarget as Node | null;
    if (!related || !e.currentTarget.contains(related)) {
      setIsDropTarget(false);
    }
  }, []);

  const handleRootDrop = useCallback((e: React.DragEvent) => {
    setIsDropTarget(false);
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    let opened = 0;
    for (const file of files) {
      // Electron expõe `path` em File quando o drop vem do OS. Não-standard; tipo é `any`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const srcPath = (file as any).path as string | undefined;
      if (!srcPath) continue;
      window.dispatchEvent(new CustomEvent('undrcod:open-file', { detail: srcPath }));
      opened++;
    }
    if (opened > 0) {
      toast.success(opened === 1 ? 'Arquivo aberto' : `${opened} arquivos abertos`);
    }
  }, []);

  // === Reveal in tree ===
  // Escuta `undrcod:reveal-in-tree` { detail: { path } } — extrai ancestrais entre
  // workspaceRoot e o path, expande cada pasta em sequência (com delay pro DOM/
  // listeners das novas rows montarem), e dispara scroll+highlight no arquivo.
  useEffect(() => {
    async function onRevealInTree(ev: Event): Promise<void> {
      const detail = (ev as CustomEvent<{ path: string }>).detail;
      const target = detail?.path;
      if (!target) return;

      // Garante que o tree não esteja colapsado
      setCollapsed(false);

      // Calcula lista de pastas ancestrais entre workspaceRoot e o file,
      // do mais raso ao mais fundo (excluindo workspaceRoot e o próprio file).
      const ancestors: string[] = [];
      let cur = getDirname(target);
      // Normaliza separadores pra comparação consistente
      const normRoot = workspaceRoot.replace(/[\\/]+$/, '');
      while (cur && cur !== normRoot && cur.length > normRoot.length) {
        ancestors.unshift(cur);
        const parent = getDirname(cur);
        if (parent === cur) break; // safety: chegou na raiz do disco
        cur = parent;
      }

      // Expande ancestrais sequencialmente. Pequeno delay pra dar tempo do React
      // re-renderizar e dos novos FileTreeItem mountarem seus event listeners.
      for (const ancestor of ancestors) {
        window.dispatchEvent(
          new CustomEvent('undrcod:tree-expand', { detail: { path: ancestor } }),
        );
        // 60ms cobre: render -> useEffect attach listener -> listDir async resolve.
        // Pastas já carregadas resolvem rápido; pastas novas precisam da listDir.
        await new Promise((res) => setTimeout(res, 60));
      }

      // Por fim, scroll + highlight no arquivo alvo.
      window.dispatchEvent(
        new CustomEvent('undrcod:tree-scroll-to', { detail: { path: target } }),
      );
    }
    window.addEventListener('undrcod:reveal-in-tree', onRevealInTree);
    return () => {
      window.removeEventListener('undrcod:reveal-in-tree', onRevealInTree);
    };
  }, [workspaceRoot]);

  // === Header actions (New File / New Folder / Refresh / Collapse All) ===
  const handleNewFile = useCallback(async () => {
    const name = window.prompt('Nome do novo arquivo:');
    if (!name?.trim()) return;
    const target = joinPath(workspaceRoot, name.trim());
    const r = await window.undrcodAPI?.fs.createFile(target);
    if ('error' in r) {
      toast.error('Falha ao criar arquivo', { sub: r.error });
      return;
    }
    toast.success('Arquivo criado');
    dispatchTreeRefresh(workspaceRoot);
    onFileOpen?.(target);
  }, [workspaceRoot, onFileOpen]);

  const handleNewFolder = useCallback(async () => {
    const name = window.prompt('Nome da nova pasta:');
    if (!name?.trim()) return;
    const target = joinPath(workspaceRoot, name.trim());
    const r = await window.undrcodAPI?.fs.createDir(target);
    if ('error' in r) {
      toast.error('Falha ao criar pasta', { sub: r.error });
      return;
    }
    toast.success('Pasta criada');
    dispatchTreeRefresh(workspaceRoot);
  }, [workspaceRoot]);

  const handleRefresh = useCallback(() => {
    dispatchTreeRefresh(workspaceRoot);
  }, [workspaceRoot]);

  const handleCollapseAll = useCallback(() => {
    window.dispatchEvent(new CustomEvent('undrcod:tree-collapse-all'));
  }, []);

  const handleToggleFilter = useCallback(() => {
    setFilterOpen((open) => {
      const next = !open;
      if (!next) {
        // Fechando — limpa query pra não deixar tree filtrado escondido.
        setFilterQuery('');
      }
      return next;
    });
  }, []);

  // Auto-focus quando filter abre. RAF garante que o input já tá montado no DOM.
  useEffect(() => {
    if (filterOpen) {
      requestAnimationFrame(() => {
        filterInputRef.current?.focus();
      });
    }
  }, [filterOpen]);

  const handleFilterKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setFilterQuery('');
      setFilterOpen(false);
    }
  }, []);

  const normalizedQuery = filterQuery.trim().toLowerCase();

  // Ref pro overlay scrollbar — segue o overflow-y do .filetree-body.
  const bodyRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className={`filetree has-overlay-scrollbar ${isDropTarget ? 'is-drop-target' : ''}`}
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
    >
      <div className="filetree-header">
        <button
          type="button"
          className="filetree-title filetree-title-toggle"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? `Expandir ${projectName}` : `Colapsar ${projectName}`}
          aria-expanded={!collapsed}
        >
          <i className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} /> {projectName}
        </button>
        <div className="filetree-actions">
          <button
            className="filetree-button"
            onClick={handleNewFile}
            title="Novo arquivo na raiz do workspace"
            aria-label="Novo arquivo"
          >
            <i className="codicon codicon-new-file" />
          </button>
          <button
            className="filetree-button"
            onClick={handleNewFolder}
            title="Nova pasta na raiz do workspace"
            aria-label="Nova pasta"
          >
            <i className="codicon codicon-new-folder" />
          </button>
          <button
            className={`filetree-button ${filterOpen ? 'is-active' : ''}`}
            onClick={handleToggleFilter}
            title="Filtrar arquivos"
            aria-label="Filtrar arquivos"
            aria-pressed={filterOpen}
          >
            <i className="codicon codicon-filter" />
          </button>
          <button
            className="filetree-button"
            onClick={handleRefresh}
            title="Atualizar árvore"
            aria-label="Atualizar"
          >
            <i className="codicon codicon-refresh" />
          </button>
          <button
            className="filetree-button"
            onClick={handleCollapseAll}
            title="Colapsar todas as pastas"
            aria-label="Colapsar tudo"
          >
            <i className="codicon codicon-collapse-all" />
          </button>
        </div>
      </div>
      {!collapsed && filterOpen && (
        <div className="filetree-filter">
          <input
            ref={filterInputRef}
            className="filetree-filter-input"
            placeholder="Filtrar arquivos..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            onKeyDown={handleFilterKeyDown}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
      )}
      {!collapsed && (
        <>
          <div className="filetree-body" ref={bodyRef}>
            <FileTreeRoot
              path={workspaceRoot}
              workspaceRoot={workspaceRoot}
              onFileOpen={onFileOpen}
              onMention={onMention}
              activeFilePath={activeFilePath}
              filterQuery={normalizedQuery || undefined}
            />
          </div>
          <OverlayScrollbar targetRef={bodyRef} orientation="vertical" />
        </>
      )}
    </div>
  );
}

/** Root do tree — sempre expanded, carrega children no mount. */
function FileTreeRoot({
  path,
  workspaceRoot,
  onFileOpen,
  onMention,
  activeFilePath,
  filterQuery
}: {
  path: string;
  workspaceRoot: string;
  onFileOpen?: (p: string) => void;
  onMention?: (p: string, t: 'file' | 'dir') => void;
  activeFilePath?: string | null;
  filterQuery?: string;
}) {
  const [children, setChildren] = useState<FsEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Quando filter tá ativo e root tem filhos, precisamos saber se ALGUM
  // descendente bate pra mostrar o empty state "nenhum arquivo bate".
  // Cada child reporta via callback se ele (ou seus descendentes) tem match.
  const [matchCount, setMatchCount] = useState(0);
  const reportRefs = useRef<Map<string, boolean>>(new Map());

  const onChildMatchChange = useCallback((key: string, hasMatch: boolean) => {
    const prev = reportRefs.current.get(key);
    if (prev === hasMatch) return;
    reportRefs.current.set(key, hasMatch);
    let count = 0;
    reportRefs.current.forEach((v) => { if (v) count++; });
    setMatchCount(count);
  }, []);

  useEffect(() => {
    let canceled = false;
    setLoaded(false);
    setError(null);
    window.undrcodAPI?.fs
      .listDir(path)
      .then((entries) => {
        if (canceled) return;
        setChildren(entries);
        setLoaded(true);
      })
      .catch((err) => {
        if (canceled) return;
        setError(String(err));
        setLoaded(true);
      });
    return () => {
      canceled = true;
    };
  }, [path]);

  // Reset match tracking quando query muda ou children são recarregados.
  useEffect(() => {
    reportRefs.current.clear();
    setMatchCount(0);
  }, [filterQuery, children]);

  if (!loaded) {
    return <div className="filetree-loading">carregando...</div>;
  }
  if (error) {
    return <div className="filetree-empty">erro: {error}</div>;
  }
  if (children.length === 0) {
    return <div className="filetree-empty">(pasta vazia)</div>;
  }
  const showNoMatches = !!filterQuery && matchCount === 0;
  return (
    <>
      {children.map((entry) => (
        <FileTreeItem
          key={entry.path}
          entry={entry}
          depth={0}
          workspaceRoot={workspaceRoot}
          onFileOpen={onFileOpen}
          onMention={onMention}
          activeFilePath={activeFilePath}
          filterQuery={filterQuery}
          onMatchChange={onChildMatchChange}
        />
      ))}
      {showNoMatches && (
        <div className="filetree-empty">Nenhum arquivo bate com filtro</div>
      )}
    </>
  );
}

interface FileTreeItemProps {
  entry: FsEntry;
  depth: number;
  workspaceRoot: string;
  onFileOpen?: (path: string) => void;
  onMention?: (absolutePath: string, type: 'file' | 'dir') => void;
  activeFilePath?: string | null;
  /** Query de filtro normalizada (lowercase, trimmed). Empty/undef = sem filtro. */
  filterQuery?: string;
  /**
   * Callback pro pai saber se este item (ou seus descendentes) tem match.
   * Usado pelo root pra decidir se mostra o empty state "nenhum bate".
   */
  onMatchChange?: (key: string, hasMatch: boolean) => void;
}

/** Converte path absoluto pra relativo ao workspaceRoot, com separadores POSIX. */
function toRelativePath(absolutePath: string, workspaceRoot: string, isDir: boolean): string {
  let rel = absolutePath;
  if (workspaceRoot && absolutePath.startsWith(workspaceRoot)) {
    rel = absolutePath.substring(workspaceRoot.length).replace(/^[\\/]+/, '');
  }
  rel = rel.replace(/\\/g, '/');
  if (isDir && !rel.endsWith('/')) rel += '/';
  return rel;
}

function FileTreeItem({ entry, depth, workspaceRoot, onFileOpen, onMention, activeFilePath, filterQuery, onMatchChange }: FileTreeItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FsEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [revealed, setRevealed] = useState(false);
  // Highlight quando user arrasta outro file da própria tree pra cima desta pasta.
  // Só relevante quando `isDir`; ignorado em arquivos.
  const [isDragOver, setIsDragOver] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Hover preview rich foi REMOVIDO (era invasivo demais — mostrava tooltip
  // gigante com 25 linhas do arquivo). Mantemos só o `title={entry.path}` nativo
  // do browser, padrão Cursor/VS Code.
  const isDir = entry.type === 'dir';
  const hidePreview = useCallback(() => { /* no-op — kept for handleClick/contextMenu compat */ }, []);

  // === Filter visibility ===
  // self match = nome do entry inclui query.
  // pra pastas com children já carregados, agregamos se ALGUM child reportou match.
  // children-not-loaded + filter ativo + dir: precisamos carregar pra saber.
  const nameMatches = !filterQuery || entry.name.toLowerCase().includes(filterQuery);
  const [descendantMatch, setDescendantMatch] = useState(false);
  const childMatchRef = useRef<Map<string, boolean>>(new Map());

  const handleChildMatch = useCallback((key: string, hasMatch: boolean) => {
    const prev = childMatchRef.current.get(key);
    if (prev === hasMatch) return;
    childMatchRef.current.set(key, hasMatch);
    let any = false;
    childMatchRef.current.forEach((v) => { if (v) any = true; });
    setDescendantMatch(any);
  }, []);

  // Reset agregação quando filtro ou lista de children muda.
  useEffect(() => {
    childMatchRef.current.clear();
    setDescendantMatch(false);
  }, [filterQuery, children]);

  // Quando filter tá ativo e somos pasta SEM carregar ainda, carrega children
  // pra poder filtrar dentro. Sem isso, pastas fechadas ficariam "invisíveis"
  // mesmo contendo matches.
  useEffect(() => {
    if (!isDir) return;
    if (!filterQuery) return;
    if (loaded || loading) return;
    setLoading(true);
    window.undrcodAPI?.fs.listDir(entry.path).then((entries) => {
      setChildren(entries);
      setLoaded(true);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, [isDir, filterQuery, loaded, loading, entry.path]);

  // Reporta ao pai se este item (ou descendentes) tem match.
  const hasMatch = nameMatches || descendantMatch;
  useEffect(() => {
    if (!filterQuery) return;
    onMatchChange?.(entry.path, hasMatch);
  }, [filterQuery, hasMatch, entry.path, onMatchChange]);

  // Hidden: tem filtro ativo, nome não bate, E nenhum descendente bate.
  // Pasta com descendantMatch fica visible mesmo sem nameMatches.
  const hiddenByFilter = !!filterQuery && !nameMatches && !descendantMatch;
  // Auto-expande pastas com matches em descendentes pra revelar os arquivos.
  const effectiveExpanded = expanded || (!!filterQuery && descendantMatch);

  // Escuta refresh requests pra esta pasta (após create/delete/rename de filhos).
  // Recarrega children via fs.listDir e atualiza state.
  useEffect(() => {
    if (!isDir) return;
    function onTreeRefresh(ev: Event): void {
      const detail = (ev as CustomEvent<{ dir: string }>).detail;
      if (detail?.dir !== entry.path) return;
      if (!loaded) return; // só recarrega se já tava carregado (visível)
      window.undrcodAPI?.fs.listDir(entry.path).then((entries) => {
        setChildren(entries);
      });
    }
    function onCollapseAll(): void {
      if (isDir) setExpanded(false);
    }
    // Reveal-in-tree: cada pasta ancestral recebe um `tree-expand` com seu path.
    // Se for este FileTreeItem, expande (load children se necessário).
    function onTreeExpand(ev: Event): void {
      const detail = (ev as CustomEvent<{ path: string }>).detail;
      if (detail?.path !== entry.path) return;
      if (!expanded) setExpanded(true);
      if (!loaded) {
        window.undrcodAPI?.fs.listDir(entry.path).then((entries) => {
          setChildren(entries);
          setLoaded(true);
        });
      }
    }
    window.addEventListener('undrcod:tree-refresh', onTreeRefresh);
    window.addEventListener('undrcod:tree-collapse-all', onCollapseAll);
    window.addEventListener('undrcod:tree-expand', onTreeExpand);
    return () => {
      window.removeEventListener('undrcod:tree-refresh', onTreeRefresh);
      window.removeEventListener('undrcod:tree-collapse-all', onCollapseAll);
      window.removeEventListener('undrcod:tree-expand', onTreeExpand);
    };
  }, [isDir, entry.path, loaded, expanded]);

  // Reveal-in-tree: arquivo escuta `tree-scroll-to`. Se for este file, scrolla
  // a row pra centro e aplica classe `.is-revealed` por ~1.2s pro flash animation.
  useEffect(() => {
    if (isDir) return;
    function onTreeScrollTo(ev: Event): void {
      const detail = (ev as CustomEvent<{ path: string }>).detail;
      if (detail?.path !== entry.path) return;
      // RAF garante que o scroll aconteça depois do paint atual.
      requestAnimationFrame(() => {
        rowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      setRevealed(true);
      // Remove a classe depois do animation (1.2s) — keep um pouquinho mais
      // pro user perceber. Cleanup via timer ref desnecessário porque a classe
      // só altera background, sem side-effects.
      window.setTimeout(() => setRevealed(false), 1400);
    }
    window.addEventListener('undrcod:tree-scroll-to', onTreeScrollTo);
    return () => {
      window.removeEventListener('undrcod:tree-scroll-to', onTreeScrollTo);
    };
  }, [isDir, entry.path]);

  const handleClick = useCallback(async () => {
    // Click em qualquer caso esconde hover preview
    hidePreview();
    if (isDir) {
      const next = !expanded;
      setExpanded(next);
      if (next && !loaded) {
        setLoading(true);
        const entries = await window.undrcodAPI?.fs.listDir(entry.path);
        setChildren(entries);
        setLoaded(true);
        setLoading(false);
      }
    } else {
      // Click em arquivo → abre no preview central
      onFileOpen?.(entry.path);
    }
  }, [expanded, loaded, isDir, entry.path, onFileOpen, hidePreview]);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData('application/x-undrcod-path', entry.path);
      e.dataTransfer.setData('application/x-undrcod-type', entry.type);
      // Escopo "move dentro do tree" — drop em outra pasta usa essa key pra
      // distinguir de @ mentions (que usam só x-undrcod-path).
      e.dataTransfer.setData('application/x-undrcod-source-path', entry.path);
      e.dataTransfer.setData('text/plain', entry.path);
      e.dataTransfer.effectAllowed = 'copyMove';
    },
    [entry.path, entry.type]
  );

  // === Drop em pasta (move file/folder da tree pra dentro desta pasta) ===
  // Só ativa em rows com isDir. Usa application/x-undrcod-source-path pra distinguir
  // de OS drops (que vêm via tipo 'Files' e são tratados no root da FileTree).
  const handleItemDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!isDir) return;
      if (!Array.from(e.dataTransfer.types).includes('application/x-undrcod-source-path')) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setIsDragOver(true);
    },
    [isDir]
  );

  const handleItemDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!isDir) return;
      const related = e.relatedTarget as Node | null;
      if (!related || !e.currentTarget.contains(related)) {
        setIsDragOver(false);
      }
    },
    [isDir]
  );

  const handleItemDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!isDir) return;
      const src = e.dataTransfer.getData('application/x-undrcod-source-path');
      if (!src) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const fileName = getBasename(src);
      const target = joinPath(entry.path, fileName);

      // Mesma pasta — no-op silencioso.
      if (src === target) return;
      // Não pode mover pasta pra dentro dela mesma ou seu próprio subtree.
      if (entry.path === src || entry.path.startsWith(src + '/') || entry.path.startsWith(src + '\\')) {
        toast.error('Não é possível mover uma pasta pra dentro dela mesma');
        return;
      }

      const confirmed = await confirmDialog({
        title: 'Mover arquivo?',
        message: `Mover "${fileName}" pra "${entry.name}"?`,
        confirmLabel: 'Mover',
      });
      if (!confirmed) return;

      const r = await window.undrcodAPI?.fs.rename(src, target);
      if ('error' in r) {
        toast.error('Mover falhou', { sub: r.error });
        return;
      }
      toast.success(`Movido pra ${entry.name}`);
      dispatchTreeRefresh(getDirname(src));
      dispatchTreeRefresh(entry.path);
    },
    [isDir, entry.path, entry.name]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Esconde preview quando context menu abre — evita overlap visual
    hidePreview();
    setMenuPos({ x: e.clientX, y: e.clientY });
  }, [hidePreview]);

  // Items do context menu. Operações create/delete/rename REAIS via IPC.
  const menuItems = useMemo<ContextMenuItem[]>(() => {
    const relPath = toRelativePath(entry.path, workspaceRoot, isDir);
    const items: ContextMenuItem[] = [];

    // ===== Create handlers (só visíveis em pastas) =====
    const handleCreateFile = async (): Promise<void> => {
      const name = window.prompt('Nome do novo arquivo:', '');
      if (!name?.trim()) return;
      const target = joinPath(entry.path, name.trim());
      const r = await window.undrcodAPI?.fs.createFile(target);
      if ('error' in r) {
        toast.error('Falha ao criar arquivo', { sub: r.error });
        return;
      }
      toast.success('Arquivo criado');
      // Garante que esta pasta esteja expanded pra mostrar o novo arquivo
      if (!expanded) setExpanded(true);
      dispatchTreeRefresh(entry.path);
    };

    const handleCreateDir = async (): Promise<void> => {
      const name = window.prompt('Nome da nova pasta:', '');
      if (!name?.trim()) return;
      const target = joinPath(entry.path, name.trim());
      const r = await window.undrcodAPI?.fs.createDir(target);
      if ('error' in r) {
        toast.error('Falha ao criar pasta', { sub: r.error });
        return;
      }
      toast.success('Pasta criada');
      if (!expanded) setExpanded(true);
      dispatchTreeRefresh(entry.path);
    };

    const handleRename = async (): Promise<void> => {
      const oldName = getBasename(entry.path);
      const newName = window.prompt('Renomear pra:', oldName);
      if (!newName?.trim() || newName.trim() === oldName) return;
      const parent = getDirname(entry.path);
      const newPath = joinPath(parent, newName.trim());
      const r = await window.undrcodAPI?.fs.rename(entry.path, newPath);
      if ('error' in r) {
        toast.error('Falha ao renomear', { sub: r.error });
        return;
      }
      toast.success('Renomeado');
      dispatchTreeRefresh(parent);
    };

    const handleDelete = async (): Promise<void> => {
      const ok = await confirmDialog({
        title: `Apagar ${isDir ? 'pasta' : 'arquivo'}?`,
        message: `"${getBasename(entry.path)}" será removido${isDir ? ' (incluindo todo o conteúdo)' : ''} permanentemente.`,
        confirmLabel: 'Apagar',
        destructive: true,
      });
      if (!ok) return;
      const r = await window.undrcodAPI?.fs.delete(entry.path);
      if ('error' in r) {
        toast.error('Falha ao apagar', { sub: r.error });
        return;
      }
      toast.success(isDir ? 'Pasta apagada' : 'Arquivo apagado');
      dispatchTreeRefresh(getDirname(entry.path));
    };

    // ===== AI action handlers (dispatch undrcod:send-to-agent) =====
    const sendToAgent = (text: string): void => {
      window.dispatchEvent(new CustomEvent('undrcod:send-to-agent', { detail: text }));
    };

    const handleExplain = (): void => {
      sendToAgent(`Explique o que este arquivo faz:\n\n@${relPath}`);
    };

    const handleRefactor = (): void => {
      sendToAgent(
        `Refatore @${relPath} melhorando legibilidade, removendo duplicação e tipagem. Não mude comportamento.`,
      );
    };

    const handleWriteTests = (): void => {
      sendToAgent(`Escreva testes pra @${relPath}. Use o framework de teste já configurado no projeto.`);
    };

    const handleSearchInDir = (): void => {
      window.dispatchEvent(
        new CustomEvent('undrcod:search-in', { detail: { dir: entry.path } }),
      );
    };

    // ===== File ops =====
    const handleDuplicate = async (): Promise<void> => {
      const oldName = getBasename(entry.path);
      const { base, ext } = getExtAndBase(oldName);
      const defaultName = `${base}.copy${ext}`;
      const newName = window.prompt('Nome do novo arquivo:', defaultName);
      if (!newName?.trim() || newName.trim() === oldName) return;
      const parent = getDirname(entry.path);
      const newPath = joinPath(parent, newName.trim());
      const readRes = await window.undrcodAPI?.fs.readFile(entry.path);
      if ('error' in readRes) {
        toast.error('Falha ao duplicar', { sub: readRes.error });
        return;
      }
      const writeRes = await window.undrcodAPI?.fs.createFile(newPath, readRes.content);
      if ('error' in writeRes) {
        toast.error('Falha ao duplicar', { sub: writeRes.error });
        return;
      }
      toast.success('Arquivo duplicado');
      dispatchTreeRefresh(parent);
    };

    const handleCompare = (): void => {
      if (!pendingCompareLeft) {
        pendingCompareLeft = entry.path;
        window.alert(
          `"${getBasename(entry.path)}" marcado pra comparação.\n\nClick com botão direito em outro arquivo e escolha "Comparar com..." pra ver o diff.`,
        );
        return;
      }
      if (pendingCompareLeft === entry.path) {
        // Clicou no mesmo arquivo — limpa e avisa
        pendingCompareLeft = null;
        window.alert('Seleção de comparação limpa.');
        return;
      }
      const left = pendingCompareLeft;
      const right = entry.path;
      pendingCompareLeft = null;
      window.dispatchEvent(
        new CustomEvent('undrcod:diff-files', { detail: { left, right } }),
      );
    };

    const handleOpenWith = (): void => {
      // openExternal aceita file:// URL — abre com app default do SO pra esse mime.
      const url = 'file:///' + entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
      window.undrcodAPI?.openExternal?.(url).catch(() => {
        // Fallback: revela no Explorer (deixa user escolher "Abrir com")
        window.undrcodAPI?.fs.revealInOs?.(entry.path);
      });
    };

    // ===== Folder ops =====
    const handleOpenTerminal = (): void => {
      window.dispatchEvent(
        new CustomEvent('undrcod:open-terminal', { detail: { cwd: entry.path } }),
      );
    };

    const handleSetWorkspace = async (): Promise<void> => {
      const ok = await confirmDialog({
        title: 'Definir como workspace?',
        message: `O workspace atual será trocado pra "${entry.path}".\n\nArquivos abertos serão fechados e a sessão atual será resetada.`,
        confirmLabel: 'Trocar workspace',
      });
      if (!ok) return;
      window.dispatchEvent(
        new CustomEvent('undrcod:set-workspace', { detail: { cwd: entry.path } }),
      );
    };

    // ===== File-specific top =====
    if (!isDir) {
      items.push(
        { kind: 'item', icon: 'go-to-file', label: 'Abrir', onClick: () => onFileOpen?.(entry.path) },
        { kind: 'divider' }
      );
    } else {
      items.push(
        { kind: 'item', icon: 'new-file', label: 'Novo arquivo aqui', onClick: handleCreateFile },
        { kind: 'item', icon: 'new-folder', label: 'Nova pasta aqui', onClick: handleCreateDir },
        { kind: 'divider' }
      );
    }

    // ===== AI actions =====
    items.push(
      {
        kind: 'item',
        icon: 'mention',
        label: isDir ? 'Mencionar pasta no chat' : 'Mencionar no chat',
        shortcut: '@',
        onClick: () => onMention?.(entry.path, entry.type)
      }
    );
    if (!isDir) {
      items.push(
        { kind: 'item', icon: 'comment-discussion', label: 'Explicar este arquivo', onClick: handleExplain },
        { kind: 'item', icon: 'edit', label: 'Refatorar este arquivo', onClick: handleRefactor },
        { kind: 'item', icon: 'beaker', label: 'Escrever testes pra este', onClick: handleWriteTests }
      );
    } else {
      items.push(
        { kind: 'item', icon: 'search', label: 'Buscar nesta pasta...', onClick: handleSearchInDir }
      );
    }
    items.push({ kind: 'divider' });

    // ===== Rename / Duplicate / Delete =====
    items.push(
      { kind: 'item', icon: 'symbol-key', label: 'Renomear', shortcut: 'F2', onClick: handleRename }
    );
    if (!isDir) {
      items.push({ kind: 'item', icon: 'copy', label: 'Duplicar', onClick: handleDuplicate });
    }
    items.push(
      {
        kind: 'item',
        icon: 'trash',
        label: 'Apagar',
        shortcut: 'Del',
        destructive: true,
        onClick: handleDelete,
      },
      { kind: 'divider' }
    );

    // ===== Clipboard / Reveal (ATIVOS) =====
    items.push(
      {
        kind: 'item',
        icon: 'clippy',
        label: 'Copiar caminho',
        onClick: () => {
          navigator.clipboard
            .writeText(entry.path)
            .then(() => toast.info('Caminho copiado'))
            .catch(() => { /* ignore */ });
        }
      },
      {
        kind: 'item',
        icon: 'symbol-string',
        label: 'Copiar caminho relativo',
        onClick: () => {
          navigator.clipboard
            .writeText(relPath)
            .then(() => toast.info('Caminho copiado'))
            .catch(() => { /* ignore */ });
        }
      },
      {
        kind: 'item',
        icon: 'folder-opened',
        label: 'Revelar no Explorer',
        onClick: () => {
          window.undrcodAPI?.fs.revealInOs?.(entry.path);
          toast.info('Aberto no Explorer');
        }
      }
    );

    // ===== Folder-specific bottom =====
    if (isDir) {
      items.push(
        { kind: 'item', icon: 'terminal', label: 'Abrir terminal aqui', onClick: handleOpenTerminal },
        { kind: 'divider' },
        { kind: 'item', icon: 'root-folder-opened', label: 'Definir como workspace', onClick: handleSetWorkspace }
      );
    } else {
      // Detect openable in browser — HTML, SVG, PDF, images
      const ext = entry.name.split('.').pop()?.toLowerCase() || '';
      const isWebPreviewable = ['html', 'htm', 'svg', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext);
      items.push(
        { kind: 'divider' },
        {
          kind: 'item',
          icon: 'globe',
          label: 'Abrir no navegador',
          disabled: !isWebPreviewable,
          onClick: () => {
            // "Abrir no navegador" abre no PREVIEW INTERNO do app (webview),
            // não no browser externo. User redirecionou esse comportamento
            // por achar mais útil que ficar abrindo Chrome/Firefox toda vez.
            // Pra abrir no browser externo, use o botão de link-external
            // no toolbar do preview, ou "Revelar no Explorer".
            const normalized = entry.path.replace(/\\/g, '/');
            const m = normalized.match(/^([a-zA-Z]):\/(.*)$/);
            const fileUrl = m
              ? `file:///${m[1].toUpperCase()}:/${m[2].split('/').map((s: string) => encodeURIComponent(s)).join('/')}`
              : `file://${normalized}`;
            window.dispatchEvent(new CustomEvent('undrcod:open-preview', { detail: { url: fileUrl } }));
            onFileOpen(entry.path);
          },
        },
        { kind: 'divider' },
        { kind: 'item', icon: 'diff', label: 'Comparar com...', onClick: handleCompare },
        { kind: 'item', icon: 'window', label: 'Abrir com...', onClick: handleOpenWith }
      );
    }

    // NOTA: "Adicionar ao workspace", "Abrir em nova aba" e submenu "Git ▸" removidos:
    //   - Adicionar ao workspace: UNDRCOD é single-workspace
    //   - Abrir em nova aba: cada arquivo já vira tab via "Abrir" (duplicado)
    //   - Git submenu: ContextMenu não suporta submenus por enquanto

    return items;
  }, [entry.path, entry.type, isDir, workspaceRoot, onFileOpen, onMention]);

  const isActive = !isDir && activeFilePath === entry.path;
  const iconInfo = isDir ? getFolderIcon(entry.name, expanded) : getFileIcon(entry.name);

  if (hiddenByFilter) {
    return null;
  }

  return (
    <>
      <div
        ref={rowRef}
        className={`filetree-item ${isDir ? 'is-dir' : 'is-file'} ${effectiveExpanded ? 'is-expanded' : ''} ${isActive ? 'is-active' : ''} ${revealed ? 'is-revealed' : ''} ${isDragOver ? 'is-drag-over' : ''}`}
        style={{ paddingLeft: `${8 + depth * 14}px`, ['--depth' as string]: depth }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={handleDragStart}
        onDragOver={isDir ? handleItemDragOver : undefined}
        onDragLeave={isDir ? handleItemDragLeave : undefined}
        onDrop={isDir ? handleItemDrop : undefined}
        title={entry.path}
      >
        {isDir ? (
          <i className={`codicon codicon-chevron-${effectiveExpanded ? 'down' : 'right'} filetree-chevron`} />
        ) : (
          <span className="filetree-chevron-spacer" />
        )}
        {/* Cursor/VS Code pattern: folders show ONLY chevron + label, no folder icon.
            Files show icon (colored by extension). Reduz ruído visual da árvore. */}
        {!isDir && (
          <i
            className={`codicon codicon-${iconInfo.icon} filetree-icon`}
            style={iconInfo.color ? { color: iconInfo.color } : undefined}
          />
        )}
        <span className="filetree-name">{entry.name}</span>
        {onMention && (
          <button
            type="button"
            className="filetree-mention-btn"
            title="Mencionar no chat"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onMention(entry.path, entry.type);
            }}
          >
            @
          </button>
        )}
      </div>
      {effectiveExpanded && (
        <>
          {loading && (
            <div className="filetree-loading" style={{ paddingLeft: `${22 + depth * 14}px` }}>
              ...
            </div>
          )}
          {!loading && loaded && children.length === 0 && !filterQuery && (
            <div className="filetree-empty" style={{ paddingLeft: `${22 + depth * 14}px` }}>
              (vazio)
            </div>
          )}
          {!loading &&
            loaded &&
            children.map((child) => (
              <FileTreeItem
                key={child.path}
                entry={child}
                depth={depth + 1}
                workspaceRoot={workspaceRoot}
                onFileOpen={onFileOpen}
                onMention={onMention}
                activeFilePath={activeFilePath}
                filterQuery={filterQuery}
                onMatchChange={handleChildMatch}
              />
            ))}
        </>
      )}

      <ContextMenu
        open={menuPos !== null}
        x={menuPos?.x ?? 0}
        y={menuPos?.y ?? 0}
        items={menuItems}
        onClose={() => setMenuPos(null)}
      />
    </>
  );
}
