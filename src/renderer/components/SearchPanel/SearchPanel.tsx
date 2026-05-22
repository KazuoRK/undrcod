import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  CaseSensitive,
  WholeWord,
  Regex,
  ChevronDown,
  ChevronRight,
  X,
  Loader2,
  Replace,
  ReplaceAll,
} from 'lucide-react';
import { confirmDialog } from '../ConfirmDialog/ConfirmDialog';
import { toast } from '../Toast/Toast';
import './SearchPanel.css';

interface RawMatch {
  path: string;
  relPath: string;
  line: number;
  text: string;
  matchStart: number;
  matchEnd: number;
}

interface GroupedFile {
  path: string;
  relPath: string;
  matches: RawMatch[];
}

interface SearchPanelProps {
  cwd: string;
  onMatchClick: (filePath: string, line: number, matchStart: number, matchEnd: number) => void;
}

const DEBOUNCE_MS = 250;
const HARD_LIMIT = 200;

/**
 * Glob simples → regex (suporta *, **, ?, vírgula como OR).
 * Não pretende cobrir todos os edge cases do gitignore — só o suficiente
 * pra filtros include/exclude tipo "src/**" ou "*.test.ts,*.spec.ts".
 */
function globsToRegex(globs: string): RegExp | null {
  const parts = globs
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const escapeChar = (c: string): string => (/[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c);
  const compileOne = (g: string): string => {
    let out = '';
    let i = 0;
    while (i < g.length) {
      const c = g[i];
      if (c === '*' && g[i + 1] === '*') {
        out += '.*';
        i += 2;
        if (g[i] === '/') i++;
      } else if (c === '*') {
        out += '[^/]*';
        i++;
      } else if (c === '?') {
        out += '[^/]';
        i++;
      } else if (c === '/') {
        out += '/';
        i++;
      } else {
        out += escapeChar(c);
        i++;
      }
    }
    return out;
  };
  const pattern = parts.map((p) => `(?:^|/)(?:${compileOne(p)})$`).join('|');
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compila pattern do user em RegExp aplicada localmente sobre o texto
 * que voltou do grep. O backend é hardcoded como case-insensitive
 * sem regex/word-boundary, então fazemos refino aqui.
 */
function buildLocalRegex(
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
  useRegex: boolean,
): RegExp | null {
  if (!query) return null;
  try {
    let body = useRegex ? query : escapeRegex(query);
    if (wholeWord) body = `\\b${body}\\b`;
    return new RegExp(body, matchCase ? 'g' : 'gi');
  } catch {
    return null;
  }
}

export function SearchPanel({ cwd, onMatchClick }: SearchPanelProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  // Filtros include/exclude sempre visíveis. Ainda usamos showFilters como flag
  // de "considerar globs" mas sempre true agora (sem toggle UI).
  const showFilters = true;
  const [includeGlob, setIncludeGlob] = useState('');
  const [excludeGlob, setExcludeGlob] = useState('');

  const [rawMatches, setRawMatches] = useState<RawMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Replace state. showReplace toggla com chevron à esquerda do search input.
  // replaceValue pode ser string vazia (= remover query). replacing trava UI durante o IPC.
  const [showReplace, setShowReplace] = useState(false);
  const [replaceValue, setReplaceValue] = useState('');
  const [replacing, setReplacing] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escuta `undrcod:focus-search` (Ctrl+Shift+F re-disparado) e `undrcod:set-search-filter`
  // (vindo do FileTree context menu "Buscar nesta pasta").
  useEffect(() => {
    function onFocus(): void {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    function onSetFilter(e: Event): void {
      const detail = (e as CustomEvent<{ includeGlob?: string; query?: string }>).detail;
      if (detail?.includeGlob !== undefined) {
        setIncludeGlob(detail.includeGlob);
      }
      if (detail?.query !== undefined) {
        setQuery(detail.query);
      }
      inputRef.current?.focus();
    }
    window.addEventListener('undrcod:focus-search', onFocus);
    window.addEventListener('undrcod:set-search-filter', onSetFilter);
    return () => {
      window.removeEventListener('undrcod:focus-search', onFocus);
      window.removeEventListener('undrcod:set-search-filter', onSetFilter);
    };
  }, []);

  // Fetch sem debounce — usado pra re-rodar busca depois do replace.
  const runSearchNow = useCallback(async () => {
    const q = query.trim();
    if (!q || q.length < 2) {
      setRawMatches([]);
      setLoading(false);
      setTruncated(false);
      return;
    }
    setLoading(true);
    const reqId = ++reqIdRef.current;
    try {
      const results = await window.undrcodAPI?.fs.grepContent(cwd, q);
      if (reqId !== reqIdRef.current) return;
      setRawMatches(results);
      setTruncated(results.length >= HARD_LIMIT);
    } catch {
      if (reqId !== reqIdRef.current) return;
      setRawMatches([]);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [query, cwd]);

  // Debounced fetch
  useEffect(() => {
    const q = query.trim();
    if (!q || q.length < 2) {
      setRawMatches([]);
      setLoading(false);
      setTruncated(false);
      return;
    }
    setLoading(true);
    const reqId = ++reqIdRef.current;
    const handle = setTimeout(async () => {
      try {
        const results = await window.undrcodAPI?.fs.grepContent(cwd, q);
        if (reqId !== reqIdRef.current) return;
        setRawMatches(results);
        setTruncated(results.length >= HARD_LIMIT);
      } catch {
        if (reqId !== reqIdRef.current) return;
        setRawMatches([]);
      } finally {
        if (reqId === reqIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, cwd]);

  // Pós-filtros client-side (toggles + include/exclude).
  const filteredMatches = useMemo<RawMatch[]>(() => {
    if (rawMatches.length === 0) return [];
    const localRe = buildLocalRegex(query.trim(), matchCase, wholeWord, useRegex);
    const incRe = showFilters ? globsToRegex(includeGlob) : null;
    const excRe = showFilters ? globsToRegex(excludeGlob) : null;

    const out: RawMatch[] = [];
    for (const m of rawMatches) {
      if (incRe && !incRe.test(m.relPath)) continue;
      if (excRe && excRe.test(m.relPath)) continue;
      if (!localRe) {
        out.push(m);
        continue;
      }
      // Reset lastIndex porque é regex /g.
      localRe.lastIndex = 0;
      const hit = localRe.exec(m.text);
      if (!hit) continue;
      out.push({
        ...m,
        matchStart: hit.index,
        matchEnd: hit.index + hit[0].length,
      });
    }
    return out;
  }, [rawMatches, query, matchCase, wholeWord, useRegex, showFilters, includeGlob, excludeGlob]);

  const grouped = useMemo<GroupedFile[]>(() => {
    const map = new Map<string, GroupedFile>();
    for (const m of filteredMatches) {
      let g = map.get(m.relPath);
      if (!g) {
        g = { path: m.path, relPath: m.relPath, matches: [] };
        map.set(m.relPath, g);
      }
      g.matches.push(m);
    }
    return Array.from(map.values());
  }, [filteredMatches]);

  const totalMatches = filteredMatches.length;
  const totalFiles = grouped.length;

  const toggleCollapsed = useCallback((relPath: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  }, []);

  const handleClear = useCallback(() => {
    setQuery('');
    setRawMatches([]);
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape' && query) {
        e.preventDefault();
        handleClear();
      }
    },
    [query, handleClear],
  );

  const handleReplaceAll = useCallback(async () => {
    const q = query.trim();
    if (!q || q.length < 2 || replacing) return;
    const fileCount = totalFiles;
    const matchCount = totalMatches;

    // Mensagem do confirm reflete o estado atual dos results.
    // Se results == 0 mas user clica msm assim, ainda permitimos (workspace pode ter
    // matches truncados ou que client filter escondeu).
    const ok = await confirmDialog({
      title: 'Substituir em todos os arquivos',
      message:
        matchCount > 0
          ? `Substituir "${q}" por "${replaceValue}" em ${matchCount} ${matchCount === 1 ? 'ocorrência' : 'ocorrências'} em ${fileCount} ${fileCount === 1 ? 'arquivo' : 'arquivos'}?\n\nEssa ação não pode ser desfeita.`
          : `Substituir "${q}" por "${replaceValue}" em todo o workspace?\n\nEssa ação não pode ser desfeita.`,
      confirmLabel: 'Substituir',
      cancelLabel: 'Cancelar',
      destructive: true,
    });
    if (!ok) return;

    setReplacing(true);
    try {
      const result = await window.undrcodAPI?.fs.replaceInFiles(cwd, q, replaceValue, {
        matchCase,
        wholeWord,
        regex: useRegex,
        includeGlob: showFilters ? includeGlob : undefined,
        excludeGlob: showFilters ? excludeGlob : undefined,
      });
      if ('error' in result) {
        toast.error('Falha ao substituir', { sub: result.error });
      } else {
        toast.success(
          `${result.filesChanged} ${result.filesChanged === 1 ? 'arquivo modificado' : 'arquivos modificados'}`,
          { sub: `${result.totalReplacements} ${result.totalReplacements === 1 ? 'substituição' : 'substituições'}` },
        );
        // Re-roda a busca pra refletir o estado atual do disco.
        await runSearchNow();
      }
    } catch (err: any) {
      toast.error('Falha ao substituir', { sub: err?.message ?? String(err) });
    } finally {
      setReplacing(false);
    }
  }, [
    query,
    replaceValue,
    replacing,
    totalFiles,
    totalMatches,
    cwd,
    matchCase,
    wholeWord,
    useRegex,
    showFilters,
    includeGlob,
    excludeGlob,
    runSearchNow,
  ]);

  const renderMatchText = (m: RawMatch): JSX.Element => {
    const before = m.text.slice(0, m.matchStart);
    const hit = m.text.slice(m.matchStart, m.matchEnd);
    const after = m.text.slice(m.matchEnd);
    return (
      <span className="search-row-text">
        <span className="search-row-text-before">{before}</span>
        <mark className="search-row-text-hit">{hit}</mark>
        <span className="search-row-text-after">{after}</span>
      </span>
    );
  };

  // Estado vazio decidido apenas após debounce settle.
  const trimmedQuery = query.trim();
  const showInitialHint = !trimmedQuery;
  const showNoResults = !loading && trimmedQuery.length >= 2 && totalMatches === 0;

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <span className="search-panel-title">PESQUISAR</span>
      </div>

      <div className="search-panel-search-row">
        <button
          type="button"
          className="search-panel-replace-toggle"
          onClick={() => setShowReplace((v) => !v)}
          title={showReplace ? 'Esconder substituir' : 'Mostrar substituir'}
          aria-pressed={showReplace}
          aria-label="Alternar substituir"
        >
          {showReplace ? (
            <ChevronDown size={12} aria-hidden />
          ) : (
            <ChevronRight size={12} aria-hidden />
          )}
        </button>

        <div className="search-panel-input-stack">
          <div className="search-panel-input-wrap">
            <Search className="search-panel-input-icon" size={13} aria-hidden />
            <input
              ref={inputRef}
              className="search-panel-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Buscar no workspace..."
              spellCheck={false}
              autoComplete="off"
            />
            {query && (
              <button
                type="button"
                className="search-panel-input-clear"
                onClick={handleClear}
                title="Limpar (Esc)"
                aria-label="Limpar busca"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {showReplace && (
            <div className="search-panel-replace-wrap">
              <div className="search-panel-input-wrap search-panel-replace-input-wrap">
                <Replace className="search-panel-input-icon" size={13} aria-hidden />
                <input
                  className="search-panel-input"
                  type="text"
                  value={replaceValue}
                  onChange={(e) => setReplaceValue(e.target.value)}
                  placeholder="Substituir por..."
                  spellCheck={false}
                  autoComplete="off"
                  disabled={replacing}
                />
              </div>
              <div className="search-panel-replace-actions">
                <button
                  type="button"
                  className="search-replace-btn"
                  onClick={handleReplaceAll}
                  disabled={replacing || !query.trim() || query.trim().length < 2}
                  title="Substituir todas as ocorrências"
                  aria-label="Substituir todas"
                >
                  <ReplaceAll size={13} aria-hidden />
                  <span className="search-replace-btn-label">
                    {replacing ? 'Substituindo…' : 'Substituir tudo'}
                  </span>
                </button>
                {totalFiles > 0 && (
                  <button
                    type="button"
                    className="search-replace-btn search-replace-btn-secondary"
                    onClick={handleReplaceAll}
                    disabled={replacing || !query.trim() || query.trim().length < 2}
                    title={`Substituir em ${totalFiles} ${totalFiles === 1 ? 'arquivo' : 'arquivos'}`}
                  >
                    <span className="search-replace-btn-label">
                      em {totalFiles} {totalFiles === 1 ? 'arquivo' : 'arquivos'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="search-panel-toolbar" role="toolbar" aria-label="Opções de busca">
        <button
          type="button"
          className={`search-toggle ${matchCase ? 'is-active' : ''}`}
          onClick={() => setMatchCase((v) => !v)}
          title="Diferenciar maiúsculas e minúsculas (Aa)"
          aria-pressed={matchCase}
        >
          <CaseSensitive size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={`search-toggle ${wholeWord ? 'is-active' : ''}`}
          onClick={() => setWholeWord((v) => !v)}
          title="Palavra inteira (ab|)"
          aria-pressed={wholeWord}
        >
          <WholeWord size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={`search-toggle ${useRegex ? 'is-active' : ''}`}
          onClick={() => setUseRegex((v) => !v)}
          title="Usar expressão regular (.*)"
          aria-pressed={useRegex}
        >
          <Regex size={14} aria-hidden />
        </button>
      </div>

      {/* Filtros include/exclude SEMPRE visíveis — match Cursor pattern.
       * Antes estavam atrás de um toggle "Filtros"; removido pra reduzir cliques. */}
      <div className="search-panel-filters">
        <label className="search-filter-row">
          <span className="search-filter-label">arquivos a incluir</span>
          <input
            type="text"
            className="search-filter-input"
            value={includeGlob}
            onChange={(e) => setIncludeGlob(e.target.value)}
            placeholder="ex: src/**, *.ts"
            spellCheck={false}
          />
        </label>
        <label className="search-filter-row">
          <span className="search-filter-label">arquivos a excluir</span>
          <input
            type="text"
            className="search-filter-input"
            value={excludeGlob}
            onChange={(e) => setExcludeGlob(e.target.value)}
            placeholder="ex: **/*.test.ts"
            spellCheck={false}
          />
        </label>
      </div>

      <div className="search-panel-results">
        {showInitialHint && (
          <div className="search-panel-empty">
            <Search size={20} className="search-panel-empty-icon" aria-hidden />
            <div className="search-panel-empty-title">Digite pra buscar</div>
            <div className="search-panel-empty-sub">Mínimo 2 caracteres</div>
          </div>
        )}

        {loading && trimmedQuery && (
          <div className="search-panel-loading">
            <Loader2 size={14} className="search-panel-spinner" aria-hidden />
            <span>Procurando…</span>
          </div>
        )}

        {showNoResults && (
          <div className="search-panel-empty">
            <div className="search-panel-empty-title">Nenhum resultado</div>
            <div className="search-panel-empty-sub">Tente outra busca ou ajuste os filtros</div>
          </div>
        )}

        {totalMatches > 0 && (
          <div className="search-panel-list" role="tree">
            {grouped.map((g) => {
              const isCollapsed = collapsed.has(g.relPath);
              const lastSlash = g.relPath.lastIndexOf('/');
              const fileName = lastSlash >= 0 ? g.relPath.slice(lastSlash + 1) : g.relPath;
              const dirPath = lastSlash >= 0 ? g.relPath.slice(0, lastSlash) : '';
              return (
                <div key={g.relPath} className="search-file-group">
                  <button
                    type="button"
                    className="search-file-header"
                    onClick={() => toggleCollapsed(g.relPath)}
                    title={g.relPath}
                  >
                    {isCollapsed ? (
                      <ChevronRight size={12} className="search-file-chevron" aria-hidden />
                    ) : (
                      <ChevronDown size={12} className="search-file-chevron" aria-hidden />
                    )}
                    <i className="codicon codicon-file search-file-icon" aria-hidden />
                    <span className="search-file-name">{fileName}</span>
                    {dirPath && <span className="search-file-dir">{dirPath}</span>}
                    <span className="search-file-count">{g.matches.length}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="search-file-matches">
                      {g.matches.map((m, idx) => (
                        <button
                          type="button"
                          key={`${m.relPath}:${m.line}:${idx}`}
                          className="search-match-row"
                          onClick={() => onMatchClick(m.path, m.line, m.matchStart, m.matchEnd)}
                          title={`${m.relPath}:${m.line}`}
                        >
                          <span className="search-row-line">{m.line}</span>
                          {renderMatchText(m)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {(totalMatches > 0 || truncated) && (
        <div className="search-panel-status">
          {truncated ? (
            <span>
              {HARD_LIMIT}+ resultados — refine a busca
            </span>
          ) : (
            <span>
              {totalMatches} {totalMatches === 1 ? 'resultado' : 'resultados'} em {totalFiles}{' '}
              {totalFiles === 1 ? 'arquivo' : 'arquivos'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
