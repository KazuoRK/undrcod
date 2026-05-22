import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { AgentEvent, HistoryEvent, SessionHistory, TokenUsage } from '../../../shared/agent-types';
import { CommandMenu, type CommandItem, type CommandSection } from '../CommandMenu/CommandMenu';
import { ComposerPopover, type PopoverItem } from './ComposerPopover';
import { MentionAutocomplete } from './MentionAutocomplete';
import { UsagePopover } from '../UsagePopover/UsagePopover';
import { ContextRing } from '../UsagePopover/ContextRing';
import type { TranscriptMode, TranscriptFontSize } from '../TranscriptView/TranscriptView';
import { Logo } from '../Logo/Logo';
import { highlight, prismLangFromExt } from '../../utils/prismSetup';
import { listWorkspaceFiles, type WorkspaceFile } from '../../utils/workspaceFiles';
import { playSound, setAudioEnabled } from '../../utils/audioFeedback';
import type { SessionInfo } from '../StatusBar/StatusBar';
import { TodoChecklist, type TodoItem } from '../TodoChecklist/TodoChecklist';
import { ToolCard } from '../ToolCard/ToolCard';
import { PermissionCard } from './PermissionCard';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu';
import { toast } from '../Toast/Toast';
import { confirmDialog } from '../ConfirmDialog/ConfirmDialog';
import { loadSnippets, type Snippet } from '../../utils/snippets';
import { PlanPanel } from '../PlanPanel/PlanPanel';
import { parsePlanSteps } from '../../utils/planParser';
import './ChatView.css';
import './ChatView-variants.css';

/**
 * Classifica a duração do thinking baseado no comprimento do texto.
 * Retorna sempre PT-BR. Usado no pill "Pensou {duração}".
 *  - < 80   chars → "rapidamente"
 *  - < 300  chars → "um pouco"
 *  - < 800  chars → "alguns segundos"
 *  - >= 800 chars → "bastante"
 */
function thinkingDurationLabel(text: string): string {
  const len = text.length;
  if (len < 80) return 'rapidamente';
  if (len < 300) return 'um pouco';
  if (len < 800) return 'alguns segundos';
  return 'bastante';
}

/**
 * Renderiza markdown simples — code blocks (```lang) com Prism syntax highlight
 * + inline code (`code`). Texto normal fica como string entre os blocks.
 */
function renderMarkdown(text: string, streaming = false): React.ReactNode[] {
  // PERF: durante streaming, marked.parse() roda em CADA delta sobre o texto
  // ACUMULADO inteiro = O(N²) por turn. Pra texto de 30KB final, são ~50
  // parses crescentes (~200-800ms blocking). Bypass: durante streaming
  // renderiza como texto cru pré-formatado. Quando streaming=false (final),
  // roda marked normalmente. Trade-off: markdown não fica formatado em
  // tempo-real, mas a UI fica MUITO mais fluida.
  if (streaming) {
    return [<RenderRawText key="raw" text={text} />];
  }

  const parts: React.ReactNode[] = [];
  const codeBlockRegex = /```([\w-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) parts.push(<RenderTextSegment key={`t${lastIndex}`} text={before} />);

    const langHint = (match[1] || 'text').toLowerCase();
    const lang = prismLangFromExt(langHint) === 'text' ? langHint : prismLangFromExt(langHint);
    const code = match[2].replace(/\n$/, '');
    parts.push(
      <CodeBlock key={`c${match.index}`} code={code} lang={lang} langHint={langHint} />
    );

    lastIndex = codeBlockRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(<RenderTextSegment key={`t${lastIndex}`} text={text.slice(lastIndex)} />);
  }

  return parts;
}

/** Escapa HTML pra evitar XSS quando renderizamos via dangerouslySetInnerHTML
 *  no light-markdown. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Light markdown — só inline tokens via regex linear O(N). Roda em CADA
 *  delta de streaming, mas custo é desprezível (~1ms pra 30KB). Cobre:
 *    - `**bold**`     → <strong>
 *    - `*italic*` / `_italic_` → <em>
 *    - `` `code` ``   → <code>
 *    - `~~strike~~`   → <del>
 *
 *  Block-level (#, lists, blockquotes, tables) NÃO formatam aqui — esperam
 *  o marked.parse final quando streaming=false. Acceptable trade-off: o que
 *  o user nota como "atraso de bold" é resolvido; estruturas multi-linha
 *  já ficam visíveis como texto bruto e formatam ao terminar.
 *
 *  Code blocks (```...```) também não — `renderMarkdown` extrai eles antes
 *  via codeBlockRegex e renderiza via <CodeBlock>. Aqui só vem texto sem
 *  fences.
 *
 *  Pra evitar parsing dentro de inline code: extraímos `code` PRIMEIRO
 *  com placeholder, aplicamos os outros, depois restauramos. Senão
 *  `` `**foo**` `` ficaria com <strong> dentro do <code> (errado). */
function lightMarkdown(text: string): string {
  const safe = escapeHtml(text);

  // 1. Extrai inline code primeiro (preserva conteúdo intacto)
  const codes: string[] = [];
  let out = safe.replace(/`([^`\n]+?)`/g, (_m, code: string) => {
    codes.push(code);
    return `\x00CODE${codes.length - 1}\x00`;
  });

  // 2. Bold (greedy mas non-newline). `**text**` antes de `*text*` pra não
  //    matchar single-asterisk dentro de double.
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');

  // 3. Italic — asterisk OU underscore. Word-boundary pro underscore
  //    pra não quebrar identifiers like `snake_case`.
  out = out.replace(/(?<![*\w])\*([^*\n]+?)\*(?!\w)/g, '<em>$1</em>');
  out = out.replace(/(?<![_\w])_([^_\n]+?)_(?!\w)/g, '<em>$1</em>');

  // 4. Strikethrough
  out = out.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');

  // 5. Restaura inline code com tag <code>
  out = out.replace(/\x00CODE(\d+)\x00/g, (_m, idx: string) =>
    `<code>${codes[Number(idx)]}</code>`,
  );

  return out;
}

/** Texto durante streaming — light-markdown inline pra bold/italic/code
 *  formatarem em tempo real. Block-level (#, lists) espera marked.parse final.
 *  Whitespace preservado via white-space:pre-wrap no CSS. */
function RenderRawText({ text }: { text: string }) {
  const html = useMemo(() => lightMarkdown(text), [text]);
  return (
    <span
      className="msg-md msg-md-streaming"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Code block com syntax highlight + botão copy + apply (estilo Claude Code). */
function CodeBlock({ code, lang, langHint }: { code: string; lang: string; langHint: string }) {
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => highlight(code, lang), [code, lang]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }, [code]);

  // Apply → App.tsx listener decide entre substituir conteúdo do tab ativo
  // (via dirtyContents flow) ou criar arquivo novo (prompt de path).
  const handleApply = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('undrcod:apply-code-block', {
        detail: { code, lang, langHint },
      }),
    );
  }, [code, lang, langHint]);

  return (
    <div className="msg-code-block">
      <pre className={`msg-codeblock language-${lang}`} data-lang={langHint}>
        <code
          className={`language-${lang}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
      <button
        type="button"
        className="msg-code-apply"
        onClick={handleApply}
        title="Aplicar código no editor"
      >
        <i className="codicon codicon-arrow-right" />
        <span>aplicar</span>
      </button>
      <button
        type="button"
        className="msg-codeblock-copy"
        onClick={handleCopy}
        title={copied ? 'Copiado!' : 'Copiar código'}
      >
        <i className={`codicon codicon-${copied ? 'check' : 'copy'}`} />
        <span>{copied ? 'copiado' : 'copiar'}</span>
      </button>
    </div>
  );
}

/** Renderiza segmento de markdown (bold, italic, headers, lists, links, inline
 * code, blockquotes). Usa `marked` pra parsear → HTML → dangerouslySetInnerHTML.
 *
 * Code blocks fenced (```) já foram extraídos por `renderMarkdown` antes — aqui
 * só roda nos pedaços de texto entre eles. Configurado pra GFM (GitHub Flavored
 * Markdown) com breaks=true pra preservar quebras simples.
 *
 * Sanitização: marked NÃO escapa HTML por default. Conteúdo do agente pode
 * conter HTML injetado (intencional ou não — ex: tool result com payload do
 * filesystem). Como `webSecurity: false` neste renderer, qualquer
 * `<img onerror>` / `<svg onload>` / `<script>` no output executaria com
 * privilégio de renderer. Por isso passamos o HTML por DOMPurify com uma
 * whitelist explícita de tags/atributos comuns de markdown.
 */
function RenderTextSegment({ text }: { text: string }) {
  const html = useMemo(() => {
    try {
      // Configurado: breaks=true (line break vira <br>), gfm=true (tabelas etc).
      let out = marked.parse(text, { breaks: true, gfm: true, async: false }) as string;
      // Post-process: substitui hyphens entre letras por non-breaking hyphen
      // (U+2011). Resolve "hi-fi" quebrando entre "hi-" e "fi" em containers
      // estreitos (tabelas, bubbles). Aplica SÓ em texto solto — preserva
      // hyphens dentro de <code>, <pre>, e atributos HTML (URLs).
      //
      // Regex split: captura blocos <code>...</code> e <pre>...</pre> SEPARADOS
      // de texto comum. Aplica replace só nos segmentos de texto.
      out = out.replace(
        /<(code|pre)[^>]*>[\s\S]*?<\/\1>|(\p{L})-(\p{L})/gu,
        (match, _tag, before, after) => {
          // Se match começa com <code ou <pre, preserva sem mudar
          if (match.startsWith('<')) return match;
          // Senão é hyphen entre letras — substitui por U+2011
          return `${before}‑${after}`;
        },
      );
      // Sanitiza o HTML resultante. Whitelist cobre tudo que marked emite pra
      // markdown padrão + GFM (tabelas, del). Bloqueia <script>, <img>, <iframe>,
      // event handlers (onerror/onload/onclick), e qualquer atributo fora da
      // lista (style, src, srcset etc).
      return DOMPurify.sanitize(out, {
        ALLOWED_TAGS: [
          'p', 'br', 'strong', 'em', 'code', 'pre', 'blockquote',
          'ul', 'ol', 'li', 'a',
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
          'del', 'span',
        ],
        ALLOWED_ATTR: ['href', 'title', 'class', 'lang'],
        ALLOW_DATA_ATTR: false,
      });
    } catch {
      return escapeHtml(text);
    }
  }, [text]);
  return <span className="msg-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

interface ChatViewProps {
  cwd: string;
  onStatusChange?: (status: string) => void;
  onSessionInfoChange?: (info: SessionInfo) => void;
  prefillInput?: string | null;
  /** Visualização de transcrição — controla quais items renderizam */
  transcriptMode?: TranscriptMode;
  /** Tamanho da fonte dos messages — small/medium/large */
  transcriptFontSize?: TranscriptFontSize;
  /** Setter pra trocar font size via popover do composer. */
  onTranscriptFontSizeChange?: (size: TranscriptFontSize) => void;
  /** Se passado, retoma essa session em vez de criar uma nova (próxima send usa --resume) */
  resumeSessionId?: string | null;
  /** Abre o McpManager modal. Hosted no App pra modal sair de cima do composer. */
  onOpenMcpManager?: () => void;
  /** Abre o PluginMarketplace modal. Hosted no App. */
  onOpenPluginMarketplace?: () => void;
  /** Abre o CustomizationTabs modal — inventário .claude/ (rules/workflows/skills/hooks/mcp). */
  onOpenCustomization?: () => void;
}

/** Payload do CSS Inspector Apply — usado tanto no composer (preview antes
 * do send) quanto no histórico (snapshot anexado ao bubble do user após send).
 * Contém dados ESTRUTURAIS do source (tag/classes/path/text), NÃO computed.
 * Ver discussão em PreviewView.handleApply pra rationale.
 *
 * O composer mantém ARRAY desses payloads — cada Apply gera um chip separado
 * (estilo @mention). User pode acumular múltiplas mudanças de elementos
 * diferentes antes de enviar tudo junto.
 */
type CssChangePayload = {
  selectors: Array<{
    selector: string;
    elementHtml: string;
    pathStr: string;
    text: string;
    changes: Array<{ property: string; value: string; prevValue: string }>;
  }>;
  css: string;
  count: number;
  /**
   * Text edits via contenteditable no preview. Cada entry é uma mudança de
   * textContent direta (sem ser CSS property). Vem do mesmo Apply mas em
   * bloco separado pro prompt do agente.
   */
  textChanges?: Array<{
    selector: string;
    elementHtml: string;
    oldText: string;
    newText: string;
  }>;
};

type ChatItem =
  | { id: string; kind: 'user'; text: string; cssChanges?: CssChangePayload[] }
  | { id: string; kind: 'assistant'; text: string; streaming: boolean }
  | { id: string; kind: 'tool'; name: string; input?: Record<string, unknown>; result?: string; isError?: boolean; collapsed: boolean }
  | { id: string; kind: 'thinking'; text: string; collapsed: boolean }
  | { id: string; kind: 'error'; message: string }
  /** Sessão Claude expirou (CLI retornou 401). Renderiza bloco com link "Entrar de novo". */
  | { id: string; kind: 'auth_expired'; status?: number; message?: string }
  /** Rate limit do plano (429). UI mostra mensagem dedicada e sugere espera/troca de modelo. */
  | { id: string; kind: 'rate_limited'; status?: number; message?: string }
  | { id: string; kind: 'meta'; text: string }
  /** Tool TodoWrite — render dedicado como checklist visual. Substitui o
   *  card genérico de tool. Pode ser atualizado in-place no mesmo turn quando
   *  Claude chama TodoWrite múltiplas vezes (status muda pending→in_progress→completed). */
  | { id: string; kind: 'todo_checklist'; todos: TodoItem[] }
  /** Pedido de permissao em modo `ask`/`acceptEdits`. Card inline com botoes
   *  Allow/Deny/Always Allow. requestId vem do main process (correlaciona com
   *  o socket pendente do MCP server). Removido do items[] assim que user
   *  clica em qualquer botao. */
  | {
      id: string;
      kind: 'permission_request';
      requestId: string;
      toolName: string;
      input: Record<string, unknown>;
      toolUseId: string | null;
    };

interface ChatTurn {
  costUsd: number;
  usage: TokenUsage | null;
}

/**
 * Painel detalhado dos CSS changes pendentes — reusado em DOIS lugares:
 *   1. Popover ao hover/click no chip do composer (preview antes do send)
 *   2. Dentro do bubble do user no histórico (snapshot após send)
 *
 * Estrutura visual replica os blocos do Cursor (ELEMENT / PATH / INNER TEXT /
 * CHANGES). Sem COMPUTED STYLES e POSITION/SIZE — esses são valores resolvidos
 * pelo browser que NÃO existem literal no source (Tailwind `w-full` → 185.51px),
 * então o agente não consegue mapear de volta. Mais ruído que sinal.
 */
/**
 * Chips compactos estilo @mention no histórico do user (após send).
 * Cada Apply do CSS Inspector vira um chip; múltiplos chips empilhados.
 * Click no chip expande panel detalhado abaixo (single-expand: só 1 panel
 * visível por vez pra economizar espaço vertical no scroll da conversa).
 */
function UserCssChangesChip({ payloads, itemId: _itemId }: { payloads: CssChangePayload[]; itemId: string }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  return (
    <div className="user-css-changes">
      <div className="user-css-changes-chips">
        {payloads.map((payload, idx) => {
          const firstSel = payload.selectors[0]?.selector || 'element';
          const tagMatch = firstSel.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
          const tag = tagMatch ? tagMatch[1] : 'element';
          const more = payload.selectors.length > 1
            ? ` +${payload.selectors.length - 1}`
            : '';
          const isExpanded = expandedIdx === idx;
          return (
            <button
              key={idx}
              type="button"
              className={`composer-chip composer-chip-ui-element ${isExpanded ? 'is-expanded' : ''}`}
              onClick={() => setExpandedIdx(isExpanded ? null : idx)}
              title={isExpanded ? 'Colapsar' : 'Ver detalhes'}
            >
              <i className="codicon codicon-inspect composer-chip-icon" />
              <span className="composer-chip-name">{`<${tag}>${more}`}</span>
            </button>
          );
        })}
      </div>
      {expandedIdx !== null && payloads[expandedIdx] && (
        <div className="user-css-changes-detail">
          <CssChangesPanel payload={payloads[expandedIdx]} compact />
        </div>
      )}
    </div>
  );
}

function CssChangesPanel({ payload, compact = false }: {
  payload: CssChangePayload;
  /** Compact = sem header "N CHANGES" (usado dentro do bubble do user). */
  compact?: boolean;
}) {
  return (
    <div className={`css-changes-panel ${compact ? 'is-compact' : ''}`}>
      {!compact && (
        <div className="css-changes-panel-header">
          {payload.count} CHANGE{payload.count === 1 ? '' : 'S'}
        </div>
      )}
      {payload.selectors.map((sel, i) => (
        <div key={`${sel.selector}-${i}`} className="css-changes-panel-group">
          <div className="css-changes-panel-section">
            <div className="css-changes-panel-label">ELEMENT</div>
            <code className="css-changes-panel-code">{sel.elementHtml}</code>
          </div>
          {sel.pathStr && (
            <div className="css-changes-panel-section">
              <div className="css-changes-panel-label">PATH</div>
              <code className="css-changes-panel-code css-changes-panel-path">{sel.pathStr}</code>
            </div>
          )}
          {sel.text && (
            <div className="css-changes-panel-section">
              <div className="css-changes-panel-label">INNER TEXT</div>
              <div className="css-changes-panel-text">"{sel.text}"</div>
            </div>
          )}
          <div className="css-changes-panel-section">
            <div className="css-changes-panel-label">CHANGES</div>
            {sel.changes.map((c, j) => (
              <div key={`${c.property}-${j}`} className="css-changes-panel-row">
                <span className="css-changes-panel-prop">{c.property}</span>
                <span className="css-changes-panel-old">{c.prevValue || '—'}</span>
                <i className="codicon codicon-arrow-right css-changes-panel-arrow" />
                <span className="css-changes-panel-new">{c.value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Resumo curto do que um tool_use ta fazendo, baseado no input.
 * Ex: Bash → primeira linha do comando; Read → filename; Edit → "filename (3 changes)"
 */
function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  const n = name.toLowerCase();
  if (n === 'bash' && typeof input.command === 'string') {
    return input.command.split('\n')[0].slice(0, 80);
  }
  if ((n === 'read' || n === 'write') && typeof input.file_path === 'string') {
    const parts = input.file_path.split(/[\\/]/);
    return parts[parts.length - 1] || input.file_path;
  }
  if (n === 'edit' && typeof input.file_path === 'string') {
    const parts = input.file_path.split(/[\\/]/);
    return parts[parts.length - 1] || input.file_path;
  }
  if (n === 'grep' && typeof input.pattern === 'string') {
    return `"${input.pattern.slice(0, 60)}"`;
  }
  if (n === 'glob' && typeof input.pattern === 'string') {
    return input.pattern.slice(0, 80);
  }
  if (n === 'webfetch' && typeof input.url === 'string') {
    try { return new URL(input.url).hostname; } catch { return input.url.slice(0, 60); }
  }
  if (n === 'websearch' && typeof input.query === 'string') {
    return `"${input.query.slice(0, 60)}"`;
  }
  // Fallback: primeira string property
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.length > 0) return v.slice(0, 80);
  }
  return '';
}

/**
 * Extrai e valida o array `todos` do input do tool TodoWrite. Tolerante a
 * shapes parciais/corrompidas — items com campos faltantes recebem fallback,
 * status inválido cai pra 'pending'. Retorna [] se o input não for um objeto
 * com array `todos`.
 */
function parseTodos(input: Record<string, unknown>): TodoItem[] {
  const raw = (input as { todos?: unknown }).todos;
  if (!Array.isArray(raw)) return [];
  const valid: TodoItem['status'][] = ['pending', 'in_progress', 'completed'];
  const out: TodoItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const content = typeof o.content === 'string' ? o.content : '';
    if (!content) continue;
    const activeForm = typeof o.activeForm === 'string' && o.activeForm
      ? o.activeForm
      : content;
    const status = valid.includes(o.status as TodoItem['status'])
      ? (o.status as TodoItem['status'])
      : 'pending';
    out.push({ content, activeForm, status });
  }
  return out;
}

/**
 * Converte eventos históricos (do .jsonl da sessão Claude) em ChatItems
 * renderizáveis. Mantém a ordem cronológica. Special cases:
 *
 * - tool_result é MERGED no tool_use precedente (mesmo toolUseId) em vez de
 *   virar um item separado — assim o ToolCard mostra input+result juntos.
 * - TodoWrite ganha render dedicado (todo_checklist com todos parseados),
 *   espelhando o que o live stream faz no `tool_use_end` (linhas 552-571 do
 *   handleAgentEvent). O tool_result correspondente (CLI retorna confirmação
 *   trivial "Todos updated") é ignorado pra evitar item duplicado.
 *
 * IDs são reusados do backend (event.id pra tool_use, event.toolUseId pra
 * tool_result lookup) — isso garante que se o live stream depois chegar com
 * resultado pendente, o item já existente seja atualizado in-place pelo
 * existing event handler.
 */
function historyEventsToChatItems(events: HistoryEvent[]): ChatItem[] {
  const items: ChatItem[] = [];
  // Index: toolUseId → idx em items[] pra merge rapido do tool_result.
  const toolUseIdxById = new Map<string, number>();
  // Ids dos tool_use que são TodoWrite — ignora o tool_result correspondente.
  const todoToolIds = new Set<string>();

  for (const ev of events) {
    if (ev.kind === 'user') {
      // SESSION CONTINUATION DETECTION: quando resume sessão compactada, o CLI
      // do Claude injeta o summary como user event ("This session is being
      // continued from a previous conversation that ran out of context.
      // Summary: ..."). Não é input do user real — é restauração de contexto.
      // Vira meta (hidden em Normal/Pensando/Resumo, visível só em Detalhado).
      // Também pega caveat banner, system reminders, command stdout XML.
      const text = ev.text ?? '';
      const isContinuation =
        text.startsWith('This session is being continued from a previous conversation') ||
        text.startsWith('Caveat: The messages below were generated by the user while running local commands') ||
        text.startsWith('<system-reminder>') ||
        text.startsWith('<command-message>') ||
        text.startsWith('<local-command-stdout>') ||
        text.startsWith('<command-name>');
      if (isContinuation) {
        const preview = text.slice(0, 80).replace(/\s+/g, ' ');
        items.push({ id: crypto.randomUUID(), kind: 'meta', text: `[contexto] ${preview}${text.length > 80 ? '…' : ''}` });
      } else {
        items.push({ id: crypto.randomUUID(), kind: 'user', text });
      }
    } else if (ev.kind === 'assistant_text') {
      items.push({ id: crypto.randomUUID(), kind: 'assistant', text: ev.text, streaming: false });
    } else if (ev.kind === 'thinking') {
      items.push({ id: crypto.randomUUID(), kind: 'thinking', text: ev.text, collapsed: true });
    } else if (ev.kind === 'tool_use') {
      if (ev.name === 'TodoWrite') {
        todoToolIds.add(ev.id);
        const todos = parseTodos(ev.input);
        items.push({ id: ev.id, kind: 'todo_checklist', todos });
      } else {
        const idx = items.length;
        items.push({
          id: ev.id,
          kind: 'tool',
          name: ev.name,
          input: ev.input,
          result: undefined,
          isError: false,
          collapsed: true,
        });
        toolUseIdxById.set(ev.id, idx);
      }
    } else if (ev.kind === 'tool_result') {
      if (todoToolIds.has(ev.toolUseId)) continue; // skip TodoWrite confirmation
      const idx = toolUseIdxById.get(ev.toolUseId);
      if (idx === undefined) continue; // tool_use ausente — sem pair, descarta
      const item = items[idx];
      if (item.kind !== 'tool') continue;
      items[idx] = { ...item, result: ev.result, isError: ev.isError };
    }
  }
  return items;
}

/**
 * VirtualizedItems — virtualiza scroll de mensagens usando @tanstack/react-virtual.
 *
 * Pattern espelhado do Cursor (workbench.desktop.main.js: `useVirtualizer({count,
 * getScrollElement, estimateSize, overscan})` + `ui-conversation-viewer__virtualizer`).
 *
 * Antes: items.map de 500+ mensagens criava 500 fiber nodes do React + 500 DOM
 * trees pesadas (markdown, syntax highlight, etc) = freeze de 1-3s no carregamento.
 *
 * Agora: só ~10 rows visíveis na viewport + overscan. React reconcilia só essas.
 * `measureElement` ajusta altura real ao DOM medido (markdown longos crescem,
 * curtos encolhem). Scroll continua mostrando "total height" via getTotalSize()
 * pra UX normal de scroll.
 */
/**
 * ToolGroup — summary card de múltiplas tool calls consecutivas (Claude Code pattern).
 *
 * Quando o agente roda 3+ ferramentas seguidas sem erro, vira UM card com
 * texto natural ("Editado 3 arquivos, leu 2 arquivos, rodou 1 comando").
 * Click expande mostrando cada tool individual (ToolCard normal).
 *
 * Errors NÃO agrupam — viram cards individuais com preview (cuidado pelo
 * `groupConsecutiveTools` no useMemo).
 */
function ToolGroupImpl({ tools }: { tools: Extract<ChatItem, { kind: 'tool' }>[] }) {
  const [expanded, setExpanded] = useState(false);

  // Conta tools por categoria semântica + gera summary em pt-BR
  const summary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tools) {
      const n = t.name.toLowerCase();
      let cat = 'usou ferramenta';
      if (n === 'edit' || n === 'multiedit') cat = 'editou arquivo';
      else if (n === 'write') cat = 'criou arquivo';
      else if (n === 'read') cat = 'leu arquivo';
      else if (n === 'bash') cat = 'rodou comando';
      else if (n === 'grep') cat = 'pesquisou código';
      else if (n === 'glob') cat = 'buscou arquivos';
      else if (n === 'task') cat = 'executou tarefa';
      else if (n === 'webfetch' || n === 'websearch') cat = 'consultou web';
      counts[cat] = (counts[cat] || 0) + 1;
    }
    const parts = Object.entries(counts).map(([cat, n]) => {
      // Pluralização simples pt-BR
      if (n === 1) return `${cat.replace('editou', 'Editou').replace(/^./, (c) => c.toUpperCase())}`;
      // Multi: "Editou 3 arquivos" / "Rodou 2 comandos" etc
      const Cap = cat.charAt(0).toUpperCase() + cat.slice(1);
      // troca "arquivo"→"arquivos", "comando"→"comandos", "ferramenta"→"ferramentas"
      const plural = Cap.replace(/(arquivo|comando|ferramenta|código|tarefa)\b/, (m) => m + 's');
      return `${plural.replace(cat.split(' ')[0], `${cat.split(' ')[0]} ${n}`)}`;
    });
    return parts.join(', ');
  }, [tools]);

  return (
    <div className={`tool-group ${expanded ? 'is-expanded' : ''}`}>
      <button
        type="button"
        className="tool-group-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="tool-group-summary">{summary}</span>
        <i className={`codicon codicon-chevron-${expanded ? 'down' : 'right'} tool-group-chev`} />
      </button>
      {expanded && (
        <div className="tool-group-body">
          {tools.map((t) => (
            <ToolCard
              key={t.id}
              name={t.name}
              input={t.input}
              result={t.result}
              isError={t.isError}
              isRunning={t.result === undefined && !t.isError}
              summary={summarizeToolInput(t.name, t.input ?? {})}
              defaultExpanded={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** PERF: memo evita re-render quando tools array não muda (mesma identidade). */
const ToolGroup = React.memo(ToolGroupImpl);

function VirtualizedItems({
  items,
  transcriptMode,
  scrollRef,
  setItems,
  setMsgMenu,
  permissionMode,
  setPermissionMode,
  setInput,
  handleSend,
  onAlwaysAllowTool,
}: {
  items: ChatItem[];
  transcriptMode: 'normal' | 'thinking' | 'detailed' | 'summary';
  scrollRef: React.RefObject<HTMLDivElement | null>;
  setItems: React.Dispatch<React.SetStateAction<ChatItem[]>>;
  setMsgMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; item: ChatItem } | null>>;
  permissionMode: string;
  setPermissionMode: React.Dispatch<React.SetStateAction<'default' | 'plan' | 'acceptEdits' | 'bypassPermissions' | 'askPermissions'>>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  handleSend: () => Promise<void>;
  /** Adiciona tool name ao Set de auto-allow (botao "Sempre permitir"). */
  onAlwaysAllowTool?: (toolName: string) => void;
}) {
  // Filtra por transcriptMode — memo pra evitar re-filter em cada render.
  const filtered = useMemo(() => {
    const f = items.filter((item) => {
      // EMPTY GUARD: items com text vazio (assistant streaming que ainda não
      // recebeu chunks, user msg vazia, etc) viram "espaços fantasma" no
      // virtualizer — alturas estimadas mas sem conteúdo. Skip em qualquer modo
      // EXCETO Detalhado (que mostra TUDO incluindo placeholders).
      if (transcriptMode !== 'detailed') {
        if (item.kind === 'user' && !item.text?.trim() && !item.cssChanges?.length) return false;
        if (item.kind === 'assistant' && !item.text?.trim() && !item.streaming) return false;
        if (item.kind === 'thinking' && !item.text?.trim()) return false;
        if (item.kind === 'meta' && !item.text?.trim()) return false;
      }

      // Permission requests SEMPRE renderizam (modo independente) — bloqueiam
      // a execucao do CLI ate o user responder, esconder seria armadilha.
      if (item.kind === 'permission_request') return true;
      switch (transcriptMode) {
        case 'summary':
          return item.kind === 'user' || item.kind === 'assistant';
        case 'thinking':
          return item.kind !== 'meta' && item.kind !== 'tool' && item.kind !== 'todo_checklist';
        case 'detailed':
          return true;
        case 'normal':
        default:
          return item.kind !== 'meta';
      }
    });

    // GROUPING (Claude Code pattern): agrupa tool calls num único `tool-group`
    // item quando aparecem em sequência DENSA (mesmo com assistant text curto
    // entre elas — tipo "vou editar X, vou rodar Y" com tools intercaladas).
    //
    // Algoritmo:
    //   - Detecta "burst" = sequência onde existe 2+ tools E tools são a MAIORIA
    //   - Assistant text CURTO (<200 chars) entre tools é absorvido no burst
    //   - User msg, thinking, ou texto longo quebra o burst
    //   - Errors NÃO agrupam (cada error vira card individual com preview)
    //   - Modo Detalhado desabilita grouping (mostra tudo)
    if (transcriptMode === 'detailed') return f;

    type VirtualItem = ChatItem | { id: string; kind: 'tool-group'; tools: Extract<ChatItem, { kind: 'tool' }>[] };
    const grouped: VirtualItem[] = [];

    // Helper: item pode estar dentro de burst (tool sem erro OU texto curto)
    const canExtendBurst = (it: ChatItem): boolean => {
      if (it.kind === 'tool' && !(it as Extract<ChatItem, { kind: 'tool' }>).isError) return true;
      if (it.kind === 'assistant' && it.text.length < 200) return true;
      return false;
    };

    let i = 0;
    while (i < f.length) {
      const item = f[i];
      if (item.kind !== 'tool' || (item as Extract<ChatItem, { kind: 'tool' }>).isError) {
        grouped.push(item);
        i++;
        continue;
      }

      // Estende burst: coleta items consecutivos que podem ser absorvidos.
      // Range: [i, j) — j é o índice EXCLUSIVO de fim.
      let j = i;
      while (j < f.length && canExtendBurst(f[j])) {
        j++;
      }

      // TRIM trailing non-tools: o burst deve TERMINAR numa tool. Texto final
      // do agente fica fora do group (renderiza como parágrafo normal depois).
      while (j > i && f[j - 1].kind !== 'tool') {
        j--;
      }

      // Conta tools dentro do range [i, j)
      const burstTools: Extract<ChatItem, { kind: 'tool' }>[] = [];
      for (let k = i; k < j; k++) {
        if (f[k].kind === 'tool') {
          burstTools.push(f[k] as Extract<ChatItem, { kind: 'tool' }>);
        }
      }

      if (burstTools.length >= 2) {
        // Burst válido: agrupa tools num único card, e os non-tools (assistant
        // text curto) ficam ANTES das tools no fluxo visual (preserva ordem
        // narrativa: "vou editar X" → group).
        // Empurra non-tools que vieram ANTES do primeiro tool no range.
        let firstToolIdx = i;
        while (firstToolIdx < j && f[firstToolIdx].kind !== 'tool') {
          grouped.push(f[firstToolIdx]);
          firstToolIdx++;
        }
        grouped.push({
          id: `tool-group-${burstTools[0].id}`,
          kind: 'tool-group',
          tools: burstTools,
        });
        // Empurra non-tools que ficaram ENTRE as tools (texto intercalado curto)
        // DEPOIS do group — ainda fazem parte da conversa.
        for (let k = firstToolIdx; k < j; k++) {
          if (f[k].kind !== 'tool') {
            grouped.push(f[k]);
          }
        }
        i = j;
      } else {
        // Burst inválido (só 1 tool): empurra item atual individualmente
        grouped.push(item);
        i++;
      }
    }
    return grouped;
  }, [items, transcriptMode]);

  // useVirtualizer: count = total de items, getScrollElement = container.
  // estimateSize = 220px (média realista de mensagens com markdown/tool cards;
  // 100px era conservador demais e fazia o initial scroll cair longe do fim
  // porque getTotalSize() ficava muito menor que a altura real medida).
  // overscan = buffer de items renderizados fora da viewport (5 = scroll fluido).
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 220,
    overscan: 5,
    // CRITICAL: identifica items por ID estável (não por index). Sem isso,
    // quando transcriptMode muda e o filter retorna items DIFERENTES nos
    // mesmos indexes, virtualizer mantém alturas medidas antigas no cache.
    //
    // Sintoma: modo Pensando mostrava "espaços enormes" entre messages porque
    // o index 2 tinha altura 400px cached de quando era uma tool card no modo
    // Normal — mas no modo Pensando, index 2 é um assistant text de 60px.
    //
    // Com getItemKey, virtualizer re-mede quando o ID muda. Cache por item-id
    // é estável across re-renders (mesmo item mantém mesma altura).
    // Mode change é tratado em CIMA via key={transcriptMode} no <VirtualizedItems>
    // pai — remount completo do componente descarta TODO o state interno do
    // virtualizer, então não precisamos misturar transcriptMode no key aqui.
    getItemKey: (index) => filtered[index]?.id ?? `idx-${index}`,
  });

  // Auto-scroll: chat apps abrem no FINAL (última msg), não no topo.
  // Combinação de 3 mecanismos pra garantir que initial scroll alcance o fim:
  //   1. virtualizer.scrollToIndex(last, { align: 'end' }) — usa offset
  //      virtualizado correto, mais robusto que scrollTop direto
  //   2. ResizeObserver no .chatview-virtual-inner — cada vez que altura cresce
  //      (measureElement reporta), re-chama scrollToIndex
  //   3. Fallback scrollTop = MAX_SAFE_INTEGER pós-rAF — pega o final mesmo se
  //      o virtualizer não conseguiu (ex: items ainda sendo medidos)
  // Quando RO para de disparar por 1000ms = estabilizou → marca initial done.
  const prevLenRef = useRef(0);
  const stickyRef = useRef(true);
  const isInitialLoadRef = useRef(true);
  const stabilizationTimerRef = useRef<number | null>(null);

  // Sticky tracker: distância do user até o bottom. Durante initial load
  // ignora pra não auto-sabotar (resize cresce altura → distância positiva
  // momentânea → marcaria !sticky → próximo RO tick não scrollaria mais).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (isInitialLoadRef.current) return;
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickyRef.current = distFromBottom < 100;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef]);

  // First-load detection: ativa quando filtered passa de 0 pra >0
  useEffect(() => {
    if (filtered.length > 0 && prevLenRef.current === 0) {
      isInitialLoadRef.current = true;
      stickyRef.current = true;
      if (stabilizationTimerRef.current !== null) {
        window.clearTimeout(stabilizationTimerRef.current);
        stabilizationTimerRef.current = null;
      }
    }
    prevLenRef.current = filtered.length;
  }, [filtered.length]);

  /** Scroll robusto pro final: virtualizer.scrollToIndex + fallback direto. */
  const scrollToBottomHard = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const lastIdx = filtered.length - 1;
    if (lastIdx < 0) return;
    // 1) virtualizer offset-aware (usa medições atuais pra calcular o offset
    //    final correto, considerando rows ainda não montadas).
    try {
      virtualizer.scrollToIndex(lastIdx, { align: 'end' });
    } catch { /* virtualizer pode ainda não estar pronto */ }
    // 2) Fallback após o paint — força clamp pro fim mesmo se totalSize
    //    estiver stale ou se o virtualizer não conseguiu posicionar.
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = Number.MAX_SAFE_INTEGER;
    });
  }, [filtered.length, scrollRef, virtualizer]);

  // ResizeObserver no inner: a cada crescimento (measureElement mediu mais
  // items e expandiu getTotalSize), re-scrolla pro fim. Polling de até 50ms
  // pra começar caso o `.chatview-virtual-inner` ainda não exista no DOM
  // quando esse effect roda (race entre virtualizer mount + child query).
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    let ro: ResizeObserver | null = null;
    let attachTries = 0;
    const tryAttach = () => {
      const inner = scrollEl.querySelector<HTMLElement>('.chatview-virtual-inner');
      if (!inner) {
        if (attachTries++ < 10) {
          window.setTimeout(tryAttach, 50);
        }
        return;
      }
      ro = new ResizeObserver(() => {
        if (filtered.length === 0) return;
        if (isInitialLoadRef.current) {
          scrollToBottomHard();
          if (stabilizationTimerRef.current !== null) {
            window.clearTimeout(stabilizationTimerRef.current);
          }
          stabilizationTimerRef.current = window.setTimeout(() => {
            // 1000ms sem resize → measurement estabilizou. Último scroll pra
            // garantir + marca initial como done.
            scrollToBottomHard();
            isInitialLoadRef.current = false;
            stabilizationTimerRef.current = null;
          }, 1000);
          return;
        }
        if (stickyRef.current) {
          scrollToBottomHard();
        }
      });
      ro.observe(inner);
    };
    tryAttach();

    return () => {
      ro?.disconnect();
      if (stabilizationTimerRef.current !== null) {
        window.clearTimeout(stabilizationTimerRef.current);
        stabilizationTimerRef.current = null;
      }
    };
  }, [filtered.length, scrollRef, scrollToBottomHard]);

  // Quando filtered cresce de 0 → N (initial), dispara scrollToBottomHard
  // imediatamente sem esperar o RO. RO complementa depois com refinamentos.
  useEffect(() => {
    if (filtered.length === 0) return;
    if (isInitialLoadRef.current) {
      // Tenta repetidamente nos primeiros frames pra cobrir o gap entre
      // setItems() e medições iniciais do virtualizer.
      let frames = 0;
      const tick = () => {
        scrollToBottomHard();
        if (frames++ < 6) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } else if (stickyRef.current) {
      scrollToBottomHard();
    }
  }, [filtered.length, scrollToBottomHard]);

  // PERF: useCallback estabiliza essas refs. Antes inline em cada row = nova
  // ref por render = React.memo no ChatItemView falhava. Agora memo é eficaz.
  const handleContextMenu = useCallback((e: React.MouseEvent, it: ChatItem) => {
    e.preventDefault();
    setMsgMenu({ x: e.clientX, y: e.clientY, item: it });
  }, [setMsgMenu]);

  const handleExecutePlan = useCallback(() => {
    setPermissionMode('acceptEdits');
    setInput('Execute o plano acima');
    toast.success('Modo Accept Edits ativado', { sub: 'Executando o plano…' });
    setTimeout(() => { void handleSend(); }, 0);
  }, [setPermissionMode, setInput, handleSend]);

  const handleEditPlan = useCallback(() => {
    toast.info('Edite o plano no composer e re-envie');
  }, []);

  const forceExpandThinking = transcriptMode === 'detailed' || transcriptMode === 'thinking';
  const forceExpandTools = transcriptMode === 'detailed';

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      className="chatview-virtual-inner"
      style={{
        height: virtualizer.getTotalSize(),
        width: '100%',
        position: 'relative',
      }}
    >
      {virtualItems.map((virtualItem) => {
        const item = filtered[virtualItem.index];
        if (!item) return null;
        return (
          <div
            key={item.id}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            className="chatview-virtual-row"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {item.kind === 'tool-group' ? (
              <ToolGroup tools={item.tools} />
            ) : (
              <ChatItemView
                item={item}
                setItems={setItems}
                forceExpandThinking={forceExpandThinking}
                forceExpandTools={forceExpandTools}
                onContextMenu={handleContextMenu}
                permissionMode={permissionMode}
                onExecutePlan={handleExecutePlan}
                onEditPlan={handleEditPlan}
                onAlwaysAllowTool={onAlwaysAllowTool}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ChatView({
  cwd,
  onStatusChange,
  onSessionInfoChange,
  prefillInput,
  transcriptMode = 'normal',
  transcriptFontSize = 'md',
  onTranscriptFontSizeChange,
  resumeSessionId,
  onOpenMcpManager,
  onOpenPluginMarketplace,
  onOpenCustomization,
}: ChatViewProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  /** Right-click context menu nas mensagens user/assistant. */
  const [msgMenu, setMsgMenu] = useState<{ x: number; y: number; item: ChatItem } | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastTurn, setLastTurn] = useState<ChatTurn | null>(null);

  // CLEANUP STREAMING CURSORS — quando busy vira false (turn complete, error,
  // auth_expired, abort, etc), garante que NENHUM assistant fica com
  // streaming=true pendurado mostrando cursor `_` infinito. Catch-all.
  useEffect(() => {
    if (busy) return;
    setItems((prev) => {
      const hasStreaming = prev.some((i) => i.kind === 'assistant' && i.streaming);
      if (!hasStreaming) return prev;
      return prev.map((i) =>
        i.kind === 'assistant' && i.streaming ? { ...i, streaming: false } : i
      );
    });
  }, [busy]);

  const [totalCost, setTotalCost] = useState(0);
  const [cmdMenuOpen, setCmdMenuOpen] = useState(false);
  // PERSISTÊNCIA: model + effort vivem em localStorage. Sem isso, ChatView
  // remontava em cada troca de session/cwd e o state voltava pro default
  // 'opus' — usuário escolhia Opus 4.7 1M e via reset sozinho na próxima ação.
  const [currentModel, setCurrentModel] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('undrcode.model');
      if (saved && ['opus', 'opus-1m', 'sonnet', 'haiku', 'opus-legacy'].includes(saved)) {
        return saved;
      }
    } catch { /* localStorage off */ }
    return 'opus';
  });
  const [currentEffort, setCurrentEffort] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('undrcode.effort');
      if (saved && ['low', 'medium', 'high', 'xhigh', 'max'].includes(saved)) {
        return saved;
      }
    } catch { /* localStorage off */ }
    return 'xhigh';
  });

  // Persist nas mudanças
  useEffect(() => {
    try { localStorage.setItem('undrcode.model', currentModel); } catch { /* ignora */ }
  }, [currentModel]);
  useEffect(() => {
    try { localStorage.setItem('undrcode.effort', currentEffort); } catch { /* ignora */ }
  }, [currentEffort]);
  const [thinkingOn, setThinkingOn] = useState(true);
  const [turnsCount, setTurnsCount] = useState(0);
  const [toolsCount, setToolsCount] = useState(0);
  const [modelLabel, setModelLabel] = useState<string | undefined>(undefined);
  const [availableSlashCommands, setAvailableSlashCommands] = useState<string[]>([]);
  const [permissionMode, setPermissionMode] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('undrcode.permissionMode');
      if (saved && ['default', 'askPermissions', 'acceptEdits', 'plan', 'bypassPermissions'].includes(saved)) {
        return saved;
      }
    } catch {}
    return 'default';
  });
  useEffect(() => {
    try { localStorage.setItem('undrcode.permissionMode', permissionMode); } catch {}
  }, [permissionMode]);
  const [usageOpen, setUsageOpen] = useState(false);

  // Set in-memory de tool names que o user clicou em "Sempre permitir". Lido
  // do localStorage no boot e re-gravado a cada update. Quando vem um pedido
  // de permissao pra um tool dentro do set, auto-aprovamos sem renderizar
  // card (chamamos respondPermission(allow) direto e ignoramos no items[]).
  // Escopo: global por enquanto (sem per-workspace).
  const [alwaysAllowedTools, setAlwaysAllowedTools] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem('undrcode.alwaysAllowedTools');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr.filter((s) => typeof s === 'string'));
      }
    } catch {
      /* localStorage indisponivel — set vazio */
    }
    return new Set();
  });
  // Ref espelhada pra que o handler do permission-request veja sempre o valor
  // atual sem precisar re-subscrever (sub roda 1x por session).
  const alwaysAllowedToolsRef = useRef<Set<string>>(alwaysAllowedTools);
  useEffect(() => {
    alwaysAllowedToolsRef.current = alwaysAllowedTools;
    try {
      window.localStorage.setItem(
        'undrcode.alwaysAllowedTools',
        JSON.stringify(Array.from(alwaysAllowedTools)),
      );
    } catch {
      /* localStorage indisponivel — silencia */
    }
  }, [alwaysAllowedTools]);

  // Adiciona o tool ao Set in-memory. Stable via useCallback pra que o memo
  // do ChatItemView nao re-renderize quando alwaysAllowedTools muda (caller
  // nao recebe o set, so o setter).
  const handleAlwaysAllowTool = useCallback((toolName: string) => {
    setAlwaysAllowedTools((prev) => {
      if (prev.has(toolName)) return prev;
      const next = new Set(prev);
      next.add(toolName);
      return next;
    });
  }, []);
  // Microfone — Whisper.cpp local via IPC (Web Speech não funciona no Electron).
  // Captura PCM Float32 a 16kHz via AudioContext+ScriptProcessor, encoda WAV
  // no stop, e manda os bytes pro main process transcrever.
  interface RecState {
    ctx: AudioContext;
    source: MediaStreamAudioSourceNode;
    processor: ScriptProcessorNode;
    stream: MediaStream;
    chunks: Float32Array[];
  }
  const [micRecording, setMicRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recognitionRef = useRef<RecState | null>(null);

  /**
   * Encoda Float32 samples (range [-1,1]) num WAV mono 16-bit PCM @ sampleRate.
   * Layout do header (44 bytes):
   *   0..3   "RIFF"                              | 4..7   chunkSize (file - 8)
   *   8..11  "WAVE"                              | 12..15 "fmt "
   *   16..19 subchunk1Size = 16                  | 20..21 audioFormat = 1 (PCM)
   *   22..23 numChannels = 1                     | 24..27 sampleRate
   *   28..31 byteRate (sr * 1 * 16/8)            | 32..33 blockAlign (1 * 16/8 = 2)
   *   34..35 bitsPerSample = 16                  | 36..39 "data"
   *   40..43 dataSize (samples.length * 2)       | 44..   PCM int16 little-endian
   */
  const encodeWAV = useCallback((samples: Float32Array, sampleRate: number): ArrayBuffer => {
    const dataBytes = samples.length * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const writeStr = (off: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);          // subchunk1Size
    view.setUint16(20, 1, true);           // audioFormat PCM
    view.setUint16(22, 1, true);           // numChannels mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byteRate
    view.setUint16(32, 2, true);           // blockAlign
    view.setUint16(34, 16, true);          // bitsPerSample
    writeStr(36, 'data');
    view.setUint32(40, dataBytes, true);
    // Float32 → Int16 PCM
    let off = 44;
    for (let i = 0; i < samples.length; i++, off += 2) {
      let s = samples[i];
      if (s > 1) s = 1; else if (s < -1) s = -1;
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }, []);

  const handleMicToggle = useCallback(async () => {
    // STOP path — finaliza captura, concatena chunks, encoda WAV, manda pro IPC.
    if (micRecording) {
      const state = recognitionRef.current;
      recognitionRef.current = null;
      setMicRecording(false);
      if (!state) return;
      try {
        state.processor.disconnect();
        state.source.disconnect();
        state.stream.getTracks().forEach((t) => t.stop());
      } catch { /* ignore */ }
      // Concatena Float32 chunks num único buffer.
      const total = state.chunks.reduce((acc, c) => acc + c.length, 0);
      if (total === 0) {
        try { await state.ctx.close(); } catch { /* ignore */ }
        return;
      }
      const merged = new Float32Array(total);
      let offset = 0;
      for (const c of state.chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      const sampleRate = state.ctx.sampleRate;
      try { await state.ctx.close(); } catch { /* ignore */ }
      const wav = encodeWAV(merged, sampleRate);
      setTranscribing(true);
      try {
        const res = await window.undrcodAPI?.whisper.transcribe(wav);
        if (res.ok === true) {
          const text = res.text?.trim();
          if (text) {
            setInput((prev) => (prev ? `${prev} ${text}` : text));
            // Feedback discreto — confirma que transcrição funcionou
            const wordCount = text.split(/\s+/).filter(Boolean).length;
            const { toast } = await import('../Toast/Toast');
            toast.success(`Transcrito (${wordCount} palavra${wordCount === 1 ? '' : 's'})`);
          } else {
            const { toast } = await import('../Toast/Toast');
            playSound('notification');
            toast.warn('Nenhuma fala detectada no áudio');
          }
        } else {
          // narrowing manual — TS não infere o ramo failed direto via res.ok
          const failed = res as { ok: false; error: string };
          const { toast } = await import('../Toast/Toast');
          playSound('notification');
          toast.error('Falha na transcrição', { sub: failed.error });
        }
      } catch (err) {
        // eslint-disable-next-line no-alert
        alert(`Erro IPC whisper: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setTranscribing(false);
      }
      return;
    }

    // START path — checa setup antes (binario+modelo presentes), pede mic, captura.
    try {
      const setup = await window.undrcodAPI?.whisper.checkSetup();
      if (setup.ok !== true) {
        // narrowing manual — TS resolve `setup` como union, queremos o ramo failed
        const failed = setup as { ok: false; reason: 'no-binary' | 'no-model'; expectedDir: string };
        // eslint-disable-next-line no-alert
        alert(
          `Whisper não está instalado (${failed.reason}). Rode scripts/setup-whisper.ps1 ` +
          `para instalar.\n\nLocal esperado: ${failed.expectedDir}`,
        );
        return;
      }
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Não foi possível verificar Whisper: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Não foi possível acessar o microfone: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      const ctx = new Ctx({ sampleRate: 16000 });
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const input = e.inputBuffer.getChannelData(0);
        // Copia (o buffer é reciclado pelo browser entre callbacks).
        chunks.push(new Float32Array(input));
      };
      source.connect(processor);
      processor.connect(ctx.destination);
      recognitionRef.current = { ctx, source, processor, stream, chunks };
      setMicRecording(true);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      // eslint-disable-next-line no-alert
      alert(`Falha ao iniciar captura: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [micRecording, encodeWAV]);
  const contextRingBtnRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const modeBtnRef = useRef<HTMLButtonElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const [composerMenu, setComposerMenu] = useState<'mode' | 'plus' | 'model' | 'snippets' | null>(null);

  // Snippets carregados quando o picker abre (Ctrl+;). Mantém em state pra re-render quando o user
  // adiciona/edita snippets em outra tela (SnippetsManager) e reabre o picker.
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [fastMode, setFastMode] = useState(false);
  const [hasMemory, setHasMemory] = useState(false);

  // MCP servers configurados pra Claude CLI no cwd atual (~/.claude.json + .mcp.json)
  const [mcpServers, setMcpServers] = useState<Array<{
    name: string;
    command: string;
    enabled: boolean;
    status: 'configured' | 'unknown';
    scope: 'workspace' | 'user' | 'project';
  }>>([]);
  const [mcpLoaded, setMcpLoaded] = useState(false);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  // posição do `@` no input (pra substituir ao selecionar)
  const mentionStartRef = useRef<number | null>(null);

  // Arquivos/pastas anexados via Plus, dialog ou drag-drop. Renderizados como
  // chips acima do textarea — viram prefixo `@path1 @path2 ` no send.
  const [attachments, setAttachments] = useState<Array<{ id: string; path: string; type: 'file' | 'folder' }>>([]);

  // CSS changes anexadas via Apply do CSS Inspector (Cursor pattern).
  // Quando user clica Apply na popover "N CHANGES" do inspector, o PreviewView
  // dispara `undrcod:attach-css-changes` → aqui ficamos com o payload e renderizamos
  // um card ACIMA do textarea (igual o painel "N CHANGES" do Cursor acima do composer).
  // No send, o diff é prependado ao prompt como bloco ```css fenced — o agente
  // recebe o contexto completo (selector + old → new) pra editar a source.
  // Array de CSS changes anexados (cada Apply gera um chip). Reseta no send.
  // Estilo @mention — múltiplos chips coexistem, cada um descartável individualmente.
  const [cssChanges, setCssChanges] = useState<CssChangePayload[]>([]);
  // Index do chip atualmente expandido (mostra panel detalhado abaixo). null = todos
  // colapsados. Só um expande de cada vez pra economizar espaço vertical no composer.
  const [expandedChipIdx, setExpandedChipIdx] = useState<number | null>(null);
  // Width medida da row de chips do composer — usada como text-indent dinâmico
  // no textarea pra empurrar o placeholder/cursor pra depois dos chips na MESMA
  // linha (efeito @mention real). Chips são absolute-positioned sobre o textarea.
  const chipsRowRef = useRef<HTMLDivElement>(null);
  const [chipsRowWidth, setChipsRowWidth] = useState(0);
  useEffect(() => {
    if (!chipsRowRef.current) {
      setChipsRowWidth(0);
      return;
    }
    const node = chipsRowRef.current;
    const update = () => setChipsRowWidth(node.getBoundingClientRect().width);
    update();
    // ResizeObserver pra acompanhar quando chips são adicionados/removidos ou
    // o composer redimensiona (split editor, sidebar, etc).
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, [cssChanges]);

  // Estado de carregamento do histórico de uma sessão retomada. Mostra spinner
  // no topo dos messages enquanto o backend parseia o .jsonl. messageCount vem
  // do listProjectSessions (rápido) e dá feedback de "quanto vou carregar".
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyExpectedCount, setHistoryExpectedCount] = useState<number | null>(null);
  // Guard: pra cada sessionId, carrega história UMA ÚNICA vez. Senão um re-render
  // do componente (ex: cwd troca) dispararia refetch desnecessário.
  const loadedHistoryForSessionRef = useRef<string | null>(null);

  // Lazy load state: por default carrega só as últimas HISTORY_PAGE_SIZE
  // mensagens do .jsonl. Se totalEvents > returnedOffset+events.length,
  // mostra banner "Carregar mensagens anteriores" no topo.
  const HISTORY_PAGE_SIZE = 50;
  const [historyTotalEvents, setHistoryTotalEvents] = useState<number | null>(null);
  // Offset (no jsonl) do PRIMEIRO event que está atualmente renderizado.
  // 0 = tudo carregado. >0 = ainda tem mais antigas pra trás.
  const [historyOffset, setHistoryOffset] = useState<number>(0);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);

  // Recebe prefill externo (ex: mention vindo do FilePreview)
  useEffect(() => {
    if (prefillInput) {
      setInput((prev) => (prev ? `${prev} ${prefillInput}` : prefillInput));
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [prefillInput]);

  // Listener pro Apply do CSS Inspector (PreviewView dispatcha `undrcod:attach-css-changes`).
  // ACUMULA múltiplos Apply em chips separados — estilo @mention. User pode
  // editar elemento A, Apply, depois elemento B, Apply, e enviar os dois juntos.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as CssChangePayload | undefined;
      if (!detail) return;
      // Aceita CSS edits OU text edits (Apply de text-only não tem selectors).
      const hasCss = !!detail.selectors?.length;
      const hasText = !!detail.textChanges?.length;
      if (!hasCss && !hasText) return;
      setCssChanges((prev) => [...prev, detail]);
      // Foca o input pra user digitar a mensagem complementar imediatamente.
      setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener('undrcod:attach-css-changes', handler);
    return () => window.removeEventListener('undrcod:attach-css-changes', handler);
  }, []);

  // Recebe texto vindo do terminal (botão "→ Chat" ou context menu do TerminalView).
  // Envolve em fence ``` pra preservar formatação ANSI-stripped e fica óbvio que é log.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      if (!detail?.text) return;
      const code = '```\n' + detail.text + '\n```';
      setInput((prev) => (prev ? `${prev}\n\n${code}\n` : code + '\n'));
      setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener('undrcod:terminal-to-chat', handler);
    return () => window.removeEventListener('undrcod:terminal-to-chat', handler);
  }, []);

  // Export transcript da session atual como markdown na clipboard.
  // Disparado por ChatSessionTabs overflow menu ("Exportar transcript").
  // Serializa só conteúdo legível (user/assistant/thinking/error) — pula
  // tool calls, todo checklists e permission cards (ruído na leitura).
  useEffect(() => {
    const handler = (): void => {
      const lines: string[] = [];
      const ts = new Date().toISOString();
      lines.push(`# UNDRCOD — Transcript`);
      lines.push(`Exportado: ${ts}`);
      lines.push('');

      for (const it of items) {
        if (it.kind === 'user') {
          lines.push('## 👤 Você');
          lines.push('');
          lines.push(it.text);
          lines.push('');
        } else if (it.kind === 'assistant') {
          lines.push('## 🤖 Claude');
          lines.push('');
          lines.push(it.text);
          lines.push('');
        } else if (it.kind === 'thinking') {
          lines.push('## 💭 Thinking');
          lines.push('');
          lines.push('> ' + it.text.replace(/\n/g, '\n> '));
          lines.push('');
        } else if (it.kind === 'tool') {
          const args = it.input ? summarizeToolInput(it.name, it.input) : '';
          lines.push(`### 🔧 ${it.name}${args ? ` — \`${args}\`` : ''}`);
          if (it.result) {
            lines.push('```');
            lines.push(it.result.length > 2000 ? it.result.slice(0, 2000) + '\n…[truncado]' : it.result);
            lines.push('```');
          }
          lines.push('');
        } else if (it.kind === 'error') {
          lines.push(`### ⚠️ Erro`);
          lines.push(it.message);
          lines.push('');
        }
      }

      const md = lines.join('\n');
      void navigator.clipboard.writeText(md).then(
        () => toast.success('Transcript copiado como markdown'),
        () => toast.error('Falha ao copiar transcript'),
      );
    };
    window.addEventListener('undrcod:export-transcript', handler);
    return () => window.removeEventListener('undrcod:export-transcript', handler);
  }, [items]);

  // Deriva tasks (todos os tool_use events) e bashLog (só bash calls) dos items
  const tasks = useMemo(
    () =>
      items
        .filter((i): i is Extract<ChatItem, { kind: 'tool' }> => i.kind === 'tool')
        .map((i) => ({
          id: i.id,
          name: i.name,
          description: i.input ? summarizeToolInput(i.name, i.input) : undefined,
          status: (i.result === undefined
            ? 'running'
            : i.isError
              ? 'failed'
              : 'done') as 'running' | 'done' | 'failed',
          startedAt: 0, // sem timestamp real do CLI; ok pra ordem
        })),
    [items]
  );

  const bashLog = useMemo(
    () =>
      items
        .filter((i): i is Extract<ChatItem, { kind: 'tool' }> => i.kind === 'tool' && i.name.toLowerCase() === 'bash')
        .map((i) => ({
          id: i.id,
          command: (i.input?.command as string) || '',
          output: i.result,
          isError: i.isError,
          timestamp: 0,
        })),
    [items]
  );

  // Mensagens de texto do assistant — pra parser de Plano detectar checklists
  const assistantMessages = useMemo(
    () =>
      items
        .filter((i): i is Extract<ChatItem, { kind: 'assistant' }> => i.kind === 'assistant')
        .map((i) => i.text),
    [items]
  );

  // Propaga info pra StatusBar (no App). PERF: throttle 200ms durante busy
  // pra evitar re-render do App.tsx (5193 linhas) em CADA text_delta.
  // Antes: cada delta → tasks/bashLog/assistantMessages eram derivados, novo
  // object literal → App re-renderiza árvore inteira. 10-30ms × 50 deltas/s.
  // Agora: durante streaming, máx 5 updates/s. Quando para, dispara final.
  const sessionInfoTimerRef = useRef<number | null>(null);
  const sessionInfoLastSentRef = useRef<number>(0);
  useEffect(() => {
    if (!onSessionInfoChange) return;
    const payload = {
      sessionId: sessionId || undefined,
      model: modelLabel,
      toolsCount,
      turns: turnsCount,
      lastUsage: lastTurn?.usage || undefined,
      lastCostUsd: lastTurn?.costUsd,
      totalCostUsd: totalCost,
      busy,
      hasMemory,
      permissionMode,
      tasks,
      bashLog,
      assistantMessages,
    };
    // Idle (não busy) → dispara imediato. Busy (streaming) → throttle 200ms.
    if (!busy) {
      if (sessionInfoTimerRef.current !== null) {
        window.clearTimeout(sessionInfoTimerRef.current);
        sessionInfoTimerRef.current = null;
      }
      onSessionInfoChange(payload);
      sessionInfoLastSentRef.current = Date.now();
      return;
    }
    const now = Date.now();
    const sinceLastSent = now - sessionInfoLastSentRef.current;
    if (sinceLastSent >= 200) {
      onSessionInfoChange(payload);
      sessionInfoLastSentRef.current = now;
    } else if (sessionInfoTimerRef.current === null) {
      sessionInfoTimerRef.current = window.setTimeout(() => {
        sessionInfoTimerRef.current = null;
        sessionInfoLastSentRef.current = Date.now();
        onSessionInfoChange(payload);
      }, 200 - sinceLastSent);
    }
    return () => {
      // cleanup só dispara em deps change — não cancela em re-render normal.
    };
  }, [sessionId, modelLabel, toolsCount, turnsCount, lastTurn, totalCost, busy, hasMemory, permissionMode, tasks, bashLog, assistantMessages, onSessionInfoChange]);

  // Boot: cria sessionId nova, OU adopta uma sessão salva pra retomar.
  //
  // Pra sessões retomadas, carrega o histórico salvo no .jsonl do CLI ANTES
  // de o user mandar a primeira mensagem, pra que o transcript apareça
  // completo (user msgs + assistant text + tool calls + thinking + todos).
  // Roda em paralelo com `adoptSession` (registrar a session no backend) — os
  // dois não dependem um do outro.
  // Guard idempotente contra StrictMode duplo-mount: o useEffect roda 2× em dev,
  // o que dispararia adoptSession + createSession 2× e (mais perigosamente)
  // poderia interagir mal com o spawn flow do main. Ref guarda "já bootei pra
  // este sessionId" — segunda execução vira no-op.
  const bootedForRef = useRef<string | null>(null);
  useEffect(() => {
    const bootKey = resumeSessionId ?? '__new__';
    if (bootedForRef.current === bootKey) return;
    bootedForRef.current = bootKey;
    if (resumeSessionId) {
      // 1. Registra a session no backend (próxima send usa --resume).
      const adopt = window.undrcodAPI?.agent.adoptSession;
      if (typeof adopt === 'function') {
        adopt(resumeSessionId).then(() => setSessionId(resumeSessionId)).catch(() => {
          window.undrcodAPI?.agent.createSession().then((r) => setSessionId(r.sessionId));
        });
      } else {
        setSessionId(resumeSessionId);
      }

      // 2. Carrega história salva do .jsonl em paralelo. Guard via ref garante
      //    que só dispara uma vez por sessionId (re-renders não re-fetcham).
      //    Type guard defensivo: o IPC pode não estar exposto ainda em builds
      //    em transit (preload não hot-reloada como o renderer).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const readHistory = (window.undrcodAPI?.claude as any).readSessionHistory as
        | ((sessionId: string, cwd: string, options?: { limit?: number; offset?: number; fromEnd?: boolean }) => Promise<SessionHistory>)
        | undefined;
      if (typeof readHistory === 'function' && loadedHistoryForSessionRef.current !== resumeSessionId) {
        loadedHistoryForSessionRef.current = resumeSessionId;
        setHistoryLoading(true);
        // Lazy load: pega só as últimas HISTORY_PAGE_SIZE linhas. Banner no
        // topo permite expandir se conversa for grande. Resolve 90% dos casos
        // sem precisar parsear + renderizar 500+ items no boot.
        readHistory(resumeSessionId, cwd, { limit: HISTORY_PAGE_SIZE, fromEnd: true })
          .then((result) => {
            if (!result || !Array.isArray(result.events)) {
              setHistoryLoading(false);
              return;
            }
            setHistoryExpectedCount(result.messageCount);
            setHistoryTotalEvents(result.totalEvents ?? result.events.length);
            setHistoryOffset(result.returnedOffset ?? 0);
            const historyItems = historyEventsToChatItems(result.events);
            // PERF: startTransition marca o setItems como non-urgent —
            // React pode interromper a reconciliation pra processar input
            // do user (digitar no composer, scroll, click). Sem isso, history
            // grande (100+ items com markdown/syntax) trava UI por 1-3s.
            //
            // Trade-off: a UI fica mostrando o "Retomando sessão..." loader
            // mais tempo, mas RESPONDE a inputs durante o load.
            startTransition(() => {
              setItems((prev) => {
                // Filtra duplicate meta de "Retomando..." se já foi inserida
                const cleaned = prev.filter((it) => !(it.kind === 'meta' && it.text.startsWith('Retomando')));
                return [
                  ...historyItems,
                  {
                    id: crypto.randomUUID(),
                    kind: 'meta',
                    text: `Sessão retomada (${historyItems.length} ${historyItems.length === 1 ? 'mensagem' : 'mensagens'} carregadas)`,
                  },
                  ...cleaned,
                ];
              });
              setHistoryLoading(false);
            });
          })
          .catch(() => {
            // Falha graceful: sem história, mas sessão ainda adopta normal.
            setHistoryLoading(false);
          });
      }

      // Meta de feedback imediato enquanto história carrega (é substituído por
      // "Sessão retomada (N mensagens carregadas)" quando o fetch resolve).
      // Dedupe guard atômico: se o item de meta "Retomando..." já está na lista
      // (ChatView pode remontar em dev StrictMode ou layout changes), não dupla.
      // O useEffect com deps [] devia disparar 1x mas em alguns casos React
      // monta/desmonta múltiplas vezes (devtools, focus changes, etc).
      setItems((prev) => {
        if (prev.some((it) => it.kind === 'meta' && it.text.startsWith('Retomando'))) {
          return prev;
        }
        return [
          ...prev,
          { id: crypto.randomUUID(), kind: 'meta', text: `Retomando sessão ${resumeSessionId.slice(0, 8)}...` },
        ];
      });
    } else {
      window.undrcodAPI?.agent.createSession().then((r) => setSessionId(r.sessionId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Carrega mais HISTORY_PAGE_SIZE mensagens anteriores (lazy load).
   * Click no banner "↑ Carregar mensagens anteriores" dispara isso. Cada call
   * pega outro bloco da história, prepend nos items existentes. Atualiza
   * `historyOffset` pra refletir o quanto ainda tem pra trás.
   */
  // Ref pro banner "Carregar mensagens anteriores" — IntersectionObserver
  // dispara auto-load quando user scrolla pra cima e o banner entra na viewport.
  const loadMoreBannerRef = useRef<HTMLButtonElement | null>(null);

  // Estado do botão "ir pro fim": mostra quando user scrolla pra cima (longe
  // do bottom). Click → scroll suave pro último msg.
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const checkScrollPos = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      // Threshold: 100px — qualquer scroll up modesto já mostra o botão.
      setShowScrollToBottom(distFromBottom > 100);
    };
    el.addEventListener('scroll', checkScrollPos, { passive: true });
    checkScrollPos(); // estado inicial
    return () => el.removeEventListener('scroll', checkScrollPos);
  }, []);

  const handleScrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  const loadOlderHistory = useCallback(async () => {
    if (!resumeSessionId || historyOffset <= 0 || loadingMoreHistory) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const readHistory = (window.undrcodAPI?.claude as any)?.readSessionHistory as
      | ((sessionId: string, cwd: string, options?: { limit?: number; offset?: number; fromEnd?: boolean }) => Promise<SessionHistory>)
      | undefined;
    if (typeof readHistory !== 'function') return;

    setLoadingMoreHistory(true);
    // SCROLL ANCHOR: salva scrollHeight ANTES do prepend pra restaurar
    // visual position depois. Sem isso, prepend "move" o conteúdo do user
    // pra baixo e o banner reentra na viewport → observer dispara loop.
    const scrollEl = scrollRef.current;
    const heightBefore = scrollEl ? scrollEl.scrollHeight : 0;
    const scrollTopBefore = scrollEl ? scrollEl.scrollTop : 0;
    try {
      // Pega o slice ANTES do offset atual: até HISTORY_PAGE_SIZE linhas a mais.
      const nextOffset = Math.max(0, historyOffset - HISTORY_PAGE_SIZE);
      const limit = historyOffset - nextOffset;
      const result = await readHistory(resumeSessionId, cwd, { offset: nextOffset, limit, fromEnd: false });
      if (!result || !Array.isArray(result.events) || result.events.length === 0) {
        setHistoryOffset(0); // nada mais pra carregar
        return;
      }
      const olderItems = historyEventsToChatItems(result.events);
      startTransition(() => {
        setItems((prev) => [...olderItems, ...prev]);
        setHistoryOffset(result.returnedOffset ?? nextOffset);
      });
      // Post-prepend: restaura scroll position relativa à BASE do conteúdo.
      // requestAnimationFrame garante que rodou DEPOIS do paint do novo
      // conteúdo. Sem isso, scrollTop pula pro topo e o banner volta visível.
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        const heightAfter = el.scrollHeight;
        const delta = heightAfter - heightBefore;
        el.scrollTop = scrollTopBefore + delta;
      });
    } catch {
      // ignore — banner permanece pra user tentar de novo
    } finally {
      setLoadingMoreHistory(false);
    }
  }, [resumeSessionId, historyOffset, loadingMoreHistory, cwd]);

  // Auto-load on scroll: IntersectionObserver no banner do "Carregar anteriores".
  //
  // BUG ORIGINAL (loop infinito): observer disparava → loadOlderHistory →
  // prepend items → useEffect re-rodava (deps mudaram) → novo observer
  // disparava IMEDIATAMENTE porque banner ainda tá visível → loop. Cada
  // iteração adicionava N items, derrubando o app com 1000+ DOM mutations/s.
  //
  // FIX (3 camadas):
  //   1. `lastLoadAtRef` throttle: ignora intersecting < 800ms desde último load
  //   2. Preservar scroll position pós-prepend (loadOlderHistory faz isso)
  //   3. `disconnect()` imediato após disparar, re-observe só quando ofs muda
  const lastLoadAtRef = useRef(0);
  useEffect(() => {
    const el = loadMoreBannerRef.current;
    if (!el) return;
    if (historyOffset <= 0 || loadingMoreHistory) return;

    let disconnected = false;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (disconnected) return;
        // Throttle: pelo menos 800ms entre loads (preempt do loop)
        const now = Date.now();
        if (now - lastLoadAtRef.current < 800) return;
        if (loadingMoreHistory || historyOffset <= 0) return;
        lastLoadAtRef.current = now;
        // Disconnect IMEDIATO pra evitar fire em cascata enquanto prepend
        // muda o layout. useEffect re-cria observer quando ofs/loading muda.
        disconnected = true;
        observer.disconnect();
        void loadOlderHistory();
      },
      {
        root: scrollRef.current,
        rootMargin: '100px 0px 0px 0px', // reduzido de 200→100 (mais conservador)
        threshold: 0,
      },
    );
    observer.observe(el);
    return () => { disconnected = true; observer.disconnect(); };
  }, [historyOffset, loadingMoreHistory, loadOlderHistory]);

  // Detecta UNDERCODE.md ou CLAUDE.md no cwd
  useEffect(() => {
    if (!cwd) return;
    const sep = cwd.includes('\\') ? '\\' : '/';
    const candidates = [`${cwd}${sep}UNDERCODE.md`, `${cwd}${sep}CLAUDE.md`];
    Promise.all(
      candidates.map((p) =>
        window.undrcodAPI?.fs.readFile(p).then((r) => !('error' in r)).catch(() => false)
      )
    ).then((results) => setHasMemory(results.some(Boolean)));
  }, [cwd]);

  // Lista MCP servers configurados (re-carrega quando o popover Plus abre)
  useEffect(() => {
    if (!cwd) return;
    if (composerMenu !== 'plus') return;
    let cancelled = false;
    setMcpLoaded(false);
    const fn = window.undrcodAPI?.mcp?.list;
    if (typeof fn !== 'function') {
      setMcpServers([]);
      setMcpLoaded(true);
      return;
    }
    fn(cwd).then((rows) => {
      if (cancelled) return;
      setMcpServers(rows.map((r) => ({
        name: r.name,
        command: r.command,
        enabled: r.enabled,
        status: r.status,
        scope: r.scope,
      })));
      setMcpLoaded(true);
    }).catch(() => { if (!cancelled) setMcpLoaded(true); });
    return () => { cancelled = true; };
  }, [cwd, composerMenu]);

  // Fallback "Editar JSON manualmente" — abre o .mcp.json no FilePreview.
  const openRawMcpJson = useCallback(async (scope: 'global' | 'workspace') => {
    setComposerMenu(null);
    const fn = window.undrcodAPI?.mcp?.openConfig;
    if (typeof fn !== 'function') return;
    const res = await fn(scope, cwd);
    if ('error' in res) return;
    window.dispatchEvent(new CustomEvent('undrcod:open-file', { detail: res.path }));
  }, [cwd]);

  // Pre-lista arquivos do workspace pra @mention autocomplete
  useEffect(() => {
    if (!cwd) return;
    listWorkspaceFiles(cwd).then(setWorkspaceFiles).catch(() => setWorkspaceFiles([]));
  }, [cwd]);

  // Boot: lê setting audioEnabled e ativa o helper. Re-lê quando outro lugar muda
  // (ex: SettingsModal) via listener `onChanged`.
  useEffect(() => {
    const api = window.undrcodAPI?.settings;
    if (!api || typeof api.get !== 'function') return;
    api.get('audioEnabled').then((v) => {
      if (typeof v === 'boolean') setAudioEnabled(v);
    }).catch(() => { /* ignore */ });
    const off = api.onChanged?.((key, value) => {
      if (key === 'audioEnabled' && typeof value === 'boolean') {
        setAudioEnabled(value);
      }
    });
    return () => { off?.(); };
  }, []);

  // Escuta eventos do agent
  useEffect(() => {
    if (!sessionId) return;
    const unsub = window.undrcodAPI?.agent.onEvent(sessionId, (event) => {
      handleAgentEvent(event);
    });
    return unsub;
  }, [sessionId]);

  // Escuta pedidos de permissao do main process. Broadcast global (todas as
  // windows recebem), entao todas que tem sessao ativa aqui criam o card. Em
  // pratica so a janela ativa do user verá — multi-window simultanea com
  // multiplas sessions em ask-mode é caso de borda.
  //
  // Auto-allow path: se o tool ja ta no alwaysAllowedToolsRef, dispara
  // respondPermission(allow) imediato sem renderizar card.
  useEffect(() => {
    const api = window.undrcodAPI?.agent;
    if (!api || typeof api.onPermissionRequest !== 'function') return;
    const unsub = api.onPermissionRequest((req) => {
      if (alwaysAllowedToolsRef.current.has(req.toolName)) {
        // Auto-allow — passa input unchanged. Sem card no chat.
        void api.respondPermission(req.requestId, {
          behavior: 'allow',
          updatedInput: req.input,
        });
        return;
      }
      setItems((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          kind: 'permission_request',
          requestId: req.requestId,
          toolName: req.toolName,
          input: req.input,
          toolUseId: req.toolUseId,
        },
      ]);
    });
    return unsub;
  }, []);

  // Hang detection — quando busy fica true e nenhum event do agent chega
  // por 60s+, mostra toast warn. Checagem a cada 10s. Dispara só 1x por
  // turn (hangNotifiedRef), reseta no turn_start. Toast atual não suporta
  // onClick custom, então mostra warn + sub instruindo a clicar no Stop.
  useEffect(() => {
    if (!busy) {
      // Reset flag quando turn termina (turn_complete/error/cancel/auth_expired/rate_limited).
      hangNotifiedRef.current = false;
      return;
    }
    // Ao iniciar/retomar busy, marca timestamp pra evitar disparo imediato
    // se o último event foi há muito tempo (ex.: cancel anterior).
    lastEventTsRef.current = Date.now();
    const interval = setInterval(() => {
      if (hangNotifiedRef.current) return;
      const elapsed = Date.now() - lastEventTsRef.current;
      if (elapsed > 60_000) {
        hangNotifiedRef.current = true;
        playSound('notification');
        toast.warn('Ainda processando há 60s+', {
          sub: 'Clique no botão Stop pra cancelar',
          ttl: 15_000,
        });
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [busy]);

  // PERF: removido o useEffect que fazia auto-scroll em cada items change.
  // Era um SEGUNDO sistema de scroll redundante — VirtualizedItems já tem
  // ResizeObserver + scrollToBottomHard que cobrem auto-scroll corretamente.
  // O `scrollTop = scrollHeight` aqui forçava layout reflow em CADA delta de
  // streaming, saturando o frame budget (3-8ms layout × 50 deltas/s).

  // Ref pra detectar "primeiro text_delta do turn" pra disparar som de start
  // sem repetir em cada delta subsequente. Reset no turn_start/complete.
  const firstDeltaPlayedRef = useRef(false);

  // Timestamp do último evento recebido do agent. Usado pela hang detection
  // (useEffect com setInterval) pra avisar quando o turn fica "preso" sem
  // events por 60s+. Atualizado em CADA event recebido (incl. status).
  const lastEventTsRef = useRef<number>(Date.now());

  // Flag pra garantir que o toast de hang só dispara 1x por turn — sem isso,
  // o setInterval re-dispararia a cada 10s enquanto continuar hung. Reset
  // no turn_start e quando busy vira false (turn_complete / error / cancel).
  const hangNotifiedRef = useRef(false);

  // Ref do id do `todo_checklist` já criado no turn atual. Quando Claude chama
  // TodoWrite múltiplas vezes no mesmo turn (atualizando status), reutilizamos
  // esse id pra fazer in-place update — React preserva o DOM e o componente
  // anima as transições de status em vez de re-mount. Reset no turn_start.
  const todoIdInCurrentTurnRef = useRef<string | null>(null);

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    // Hang detection — qualquer event "prova de vida" do agent. Atualizar
    // antes do switch garante que até eventos ignorados (status) contam.
    lastEventTsRef.current = Date.now();
    switch (event.type) {
      case 'session_init':
        setModelLabel(event.model);
        setToolsCount(event.tools.length);
        // Slash commands disponíveis (builtin + plugins) — usado pelo CommandMenu
        // pra mostrar `/agent-sdk-dev:new-sdk-app` etc no autocomplete.
        if (event.slashCommands && event.slashCommands.length > 0) {
          setAvailableSlashCommands(event.slashCommands);
        }
        // Banner "Sessão iniciada · model · N tools · N plugins" removido do timeline
        // (Claude Code style — info técnica fica fora do canvas de conversa).
        // Info de model continua visível no badge do composer; tools/plugins acessíveis
        // via menu de detalhes da sessão.
        onStatusChange?.('ready');
        break;

      case 'turn_start':
        // já adicionamos user msg no submit
        firstDeltaPlayedRef.current = false;
        todoIdInCurrentTurnRef.current = null;
        hangNotifiedRef.current = false;
        onStatusChange?.('thinking');
        setItems((prev) => [
          ...prev,
          { id: crypto.randomUUID(), kind: 'assistant', text: '', streaming: true }
        ]);
        break;

      case 'text_delta':
        // Toca som de "start" só na 1a delta do turn — feedback de que o
        // assistant começou a responder. Demais deltas são silenciosas.
        if (!firstDeltaPlayedRef.current) {
          firstDeltaPlayedRef.current = true;
          playSound('start');
        }
        setItems((prev) => {
          const last = prev[prev.length - 1];
          if (last?.kind === 'assistant' && last.streaming) {
            return [
              ...prev.slice(0, -1),
              { ...last, text: last.text + event.text }
            ];
          }
          // Se não tem assistant streaming, cria
          return [
            ...prev,
            { id: crypto.randomUUID(), kind: 'assistant', text: event.text, streaming: true }
          ];
        });
        break;

      case 'thinking_delta':
        setItems((prev) => {
          const last = prev[prev.length - 1];
          if (last?.kind === 'thinking') {
            return [
              ...prev.slice(0, -1),
              { ...last, text: last.text + event.text }
            ];
          }
          return [
            ...prev,
            { id: crypto.randomUUID(), kind: 'thinking', text: event.text, collapsed: true }
          ];
        });
        break;

      case 'tool_use_start':
        playSound('tool-use');
        // TodoWrite ganha render dedicado (TodoChecklist). Não criamos placeholder
        // no start — esperamos o input chegar em tool_use_end. Isso evita um
        // flicker entre o card genérico "TodoWrite running…" e o checklist.
        if (event.name === 'TodoWrite') {
          break;
        }
        setItems((prev) => [
          ...prev,
          {
            id: event.toolUseId,
            kind: 'tool',
            name: event.name,
            input: undefined,
            result: undefined,
            collapsed: true
          }
        ]);
        break;

      case 'tool_use_end':
        if (event.name === 'TodoWrite') {
          // Render dedicado: extrai todos do input, valida shape e cria/atualiza
          // um item `todo_checklist` reutilizando o mesmo id pelo turn pra que
          // o React preserve o DOM e o TodoChecklist anime as transições.
          const todos = parseTodos(event.input);
          setItems((prev) => {
            const existingId = todoIdInCurrentTurnRef.current;
            if (existingId) {
              return prev.map((item) =>
                item.id === existingId && item.kind === 'todo_checklist'
                  ? { ...item, todos }
                  : item
              );
            }
            const newId = crypto.randomUUID();
            todoIdInCurrentTurnRef.current = newId;
            return [...prev, { id: newId, kind: 'todo_checklist', todos }];
          });
          break;
        }
        setItems((prev) =>
          prev.map((item) =>
            item.kind === 'tool' && item.id === event.toolUseId
              ? { ...item, input: event.input }
              : item
          )
        );
        break;

      case 'tool_result':
        // Som de tool-done só quando o resultado chega (não em tool_use_end,
        // que é só o input ficar completo). isError → já toca som de erro
        // separado no caso geral, mas aqui mantemos tool-done pra distinguir
        // "tool errou" de "stream errou" (case 'error' abaixo).
        playSound('tool-done');
        // TodoWrite não tem item `tool` correspondente — o resultado é ignorado
        // (CLI retorna apenas confirmação tipo "Todos updated"; o estado visual
        // já foi capturado no tool_use_end).
        setItems((prev) =>
          prev.map((item) =>
            item.kind === 'tool' && item.id === event.toolUseId
              ? { ...item, result: event.result, isError: event.isError }
              : item
          )
        );
        break;

      case 'turn_complete':
        playSound('complete');
        setBusy(false);
        setTurnsCount((n) => n + 1);
        onStatusChange?.('ready');
        setItems((prev) =>
          prev.map((item) =>
            item.kind === 'assistant' && item.streaming ? { ...item, streaming: false } : item
          )
        );
        if (event.usage) {
          setLastTurn({ costUsd: event.costUsd || 0, usage: event.usage });
          setTotalCost((c) => c + (event.costUsd || 0));
        }
        break;

      case 'error':
        playSound('error');
        setBusy(false);
        onStatusChange?.('error');
        setItems((prev) => [
          // Limpa streaming flag de assistant items que ficaram pendurados
          // (cursor `_` não pode continuar piscando depois do erro).
          ...prev.map((item) =>
            item.kind === 'assistant' && item.streaming ? { ...item, streaming: false } : item
          ),
          { id: crypto.randomUUID(), kind: 'error', message: event.message }
        ]);
        break;

      case 'auth_expired':
        // Token OAuth do CLI expirou — renderiza bloco dedicado com "Entrar de novo"
        // em vez do erro genérico de exit code. Não limpa busy até o user agir.
        setBusy(false);
        onStatusChange?.('error');
        setItems((prev) => [
          ...prev.map((item) =>
            item.kind === 'assistant' && item.streaming ? { ...item, streaming: false } : item
          ),
          {
            id: crypto.randomUUID(),
            kind: 'auth_expired',
            status: event.status,
            message: event.message,
          }
        ]);
        break;

      case 'rate_limited':
        // Plano Max esgotado na janela de 5h. UI sugere espera / troca de modelo.
        setBusy(false);
        onStatusChange?.('error');
        setItems((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            kind: 'rate_limited',
            status: event.status,
            message: event.message,
          }
        ]);
        break;

      case 'status':
        // ignore por enquanto
        break;
    }
  }, [onStatusChange]);

  // toRelativePath usado também por handleSend — declara antes
  const toRelativePath = useCallback((absolutePath: string, isDir: boolean): string => {
    let rel = absolutePath;
    if (cwd && rel.startsWith(cwd)) {
      rel = rel.slice(cwd.length).replace(/^[\\/]+/, '');
    }
    rel = rel.replace(/\\/g, '/');
    if (isDir && !rel.endsWith('/')) rel += '/';
    return rel;
  }, [cwd]);

  const handleSend = useCallback(async () => {
    if (!sessionId || busy) return;
    const trimmed = input.trim();
    // Permite send se houver attachments OU CSS changes anexadas mesmo sem texto
    if (!trimmed && attachments.length === 0 && cssChanges.length === 0) return;

    const attachStr = attachments
      .map((a) => `@${toRelativePath(a.path, a.type === 'folder')}`)
      .join(' ');
    const text = (attachStr ? attachStr + (trimmed ? ' ' : '') : '') + trimmed;

    // Texto a enviar pro CLI — pode ter /model prepend pendente.
    // O bubble do user mostra `text` (sem o slash), mas o CLI recebe `promptToSend`.
    // Se houver CSS changes anexadas, prependa o bloco fenced — o agente recebe
    // contexto completo (selector + property: oldValue → newValue) pra editar source.
    let promptToSend = text;
    if (cssChanges.length > 0) {
      // Cursor pattern: contexto ESTRUTURAL pro agente localizar o source.
      // ELEMENT / PATH / INNER TEXT / CHANGES por elemento. Múltiplos chips
      // (Apply em batches separados) são linearizados em sequência.
      const lines: string[] = [];
      const totalEls = cssChanges.reduce((sum, p) => sum + p.selectors.length, 0);
      const totalTextEdits = cssChanges.reduce((sum, p) => sum + (p.textChanges?.length || 0), 0);
      const intro: string[] = [];
      if (totalEls > 0) {
        intro.push(`Aplique as mudanças de CSS abaixo no source. ${totalEls} elemento${totalEls === 1 ? '' : 's'} ${totalEls === 1 ? 'foi alterado' : 'foram alterados'} via inspector.`);
      }
      if (totalTextEdits > 0) {
        intro.push(`${totalTextEdits} texto${totalTextEdits === 1 ? '' : 's'} ${totalTextEdits === 1 ? 'foi editado' : 'foram editados'} inline no preview.`);
      }
      intro.push('Use o contexto pra localizar cada um (preferir grep por class/id, fallback pra inner text). Se for codebase Tailwind, prefira utilities equivalentes pra valores nomeados (text-lg, p-4, etc); MAS pra valores ARBITRÁRIOS (números específicos tipo `left: 98px`, `width: 384px`), prefira inline `style="..."` em vez de `left-[98px]` — sites sem JIT/rescan ativo não geram CSS pra essas classes arbitrárias e a mudança fica sem efeito visual. Se for CSS modules ou styled-components, edite o arquivo da rule.');
      lines.push(intro.join(' '));
      lines.push('');
      let elIdx = 0;
      cssChanges.forEach((payload) => {
        payload.selectors.forEach((sel) => {
          elIdx++;
          lines.push(`## Elemento ${elIdx}: \`${sel.selector}\``);
          lines.push('');
          lines.push('**Element:**');
          lines.push('```html');
          lines.push(sel.elementHtml);
          lines.push('```');
          if (sel.pathStr) {
            lines.push('');
            lines.push(`**Path:** \`${sel.pathStr}\``);
          }
          if (sel.text) {
            lines.push('');
            lines.push(`**Inner text:** "${sel.text}"`);
          }
          lines.push('');
          lines.push('**Changes:**');
          for (const c of sel.changes) {
            const prev = c.prevValue || '(unset)';
            lines.push(`- \`${c.property}\`: \`${prev}\` → \`${c.value}\``);
          }
          lines.push('');
        });
      });
      if (totalTextEdits > 0) {
        lines.push('## Text edits (inline contenteditable)');
        lines.push('');
        let tIdx = 0;
        cssChanges.forEach((payload) => {
          (payload.textChanges || []).forEach((t) => {
            tIdx++;
            lines.push(`### Texto ${tIdx}: \`${t.selector}\``);
            lines.push('');
            lines.push('**Element:**');
            lines.push('```html');
            lines.push(t.elementHtml);
            lines.push('```');
            lines.push('');
            lines.push('**Antes:**');
            lines.push('```');
            lines.push(t.oldText);
            lines.push('```');
            lines.push('**Depois:**');
            lines.push('```');
            lines.push(t.newText);
            lines.push('```');
            lines.push('');
          });
        });
      }
      if (cssChanges.some((p) => p.css)) {
        lines.push('**CSS combinado (snippet pronto):**');
        lines.push('```css');
        lines.push(cssChanges.map((p) => p.css).filter(Boolean).join('\n\n'));
        lines.push('```');
        lines.push('');
      }
      promptToSend = lines.join('\n') + (text ? '\n' + text : '');
    }
    if (pendingModelChangeRef.current) {
      promptToSend = `/model ${pendingModelChangeRef.current}\n\n${promptToSend}`;
      pendingModelChangeRef.current = null;
    }

    // Adiciona ao history (sem duplicar se igual ao último)
    setInputHistory((prev) =>
      prev[prev.length - 1] === text ? prev : [...prev, text].slice(-50)
    );
    setHistoryIdx(null);
    // Snapshot do cssChanges ANTES do clear pra anexar ao bubble do histórico.
    const cssChangesSnapshot = cssChanges.length > 0 ? cssChanges : null;
    setInput('');
    setAttachments([]);
    setCssChanges([]);
    setExpandedChipIdx(null);
    setBusy(true);
    setItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        kind: 'user',
        text,
        ...(cssChangesSnapshot ? { cssChanges: cssChangesSnapshot } : {}),
      },
    ]);

    // Lê preferredLanguage do storage no momento do send (sem state local —
    // evita race com mudança recente). Default 'auto' se settings IPC offline.
    let preferredLanguage: 'auto' | 'pt-BR' | 'en' = 'auto';
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const settingsApi = window.undrcodAPI?.settings;
      const raw = await settingsApi?.get?.('preferredLanguage');
      if (raw === 'auto' || raw === 'pt-BR' || raw === 'en') preferredLanguage = raw;
    } catch { /* fallback auto */ }

    // Effort vem do popover do composer (currentEffort) — passa pro CLI via --effort.
    // Sem isso, thinking blocks frequentemente NÃO aparecem (CLI usa default baixo).
    const result = await window.undrcodAPI?.agent.send({ sessionId, cwd, prompt: promptToSend, permissionMode, model: currentModel, effort: currentEffort, preferredLanguage });
    if ('error' in result) {
      setBusy(false);
      setItems((prev) => [
        ...prev,
        { id: crypto.randomUUID(), kind: 'error', message: result.error }
      ]);
    }
  }, [sessionId, busy, input, attachments, cssChanges, expandedChipIdx, cwd, permissionMode, currentModel, toRelativePath]);

  // Troca de modelo via /model command no CLI Claude Code.
  // ESTRATÉGIA: adia o /model pra próxima mensagem do user (prepend), evitando
  // turn-locking ao clicar no picker. Visualmente o badge muda na hora; o CLI
  // só vê o /model quando o user manda um prompt de verdade.
  const pendingModelChangeRef = useRef<string | null>(null);
  const handleModelChange = useCallback((modelId: string) => {
    setCurrentModel(modelId);
    if (!sessionId) return;
    const slugMap: Record<string, string> = {
      'opus': 'opus',
      'opus-1m': 'opus[1m]',
      'sonnet': 'sonnet',
      'haiku': 'haiku',
      'opus-legacy': 'claude-opus-4-6',
    };
    pendingModelChangeRef.current = slugMap[modelId] || modelId;
  }, [sessionId]);

  const handleCancel = useCallback(() => {
    if (!sessionId) return;
    playSound('cancel');
    window.undrcodAPI?.agent.cancel(sessionId);
    setBusy(false);
    onStatusChange?.('ready');
  }, [sessionId]);

  const handlePickFiles = useCallback(async () => {
    setComposerMenu(null);
    const res = await window.undrcodAPI?.dialog.openFiles();
    if (res.canceled !== false) return;
    setAttachments((prev) => {
      const existing = new Set(prev.map((a) => a.path));
      const novos = res.paths
        .filter((p) => !existing.has(p))
        .map((p) => ({ id: crypto.randomUUID(), path: p, type: 'file' as const }));
      return [...prev, ...novos];
    });
  }, []);

  const handlePickFolder = useCallback(async () => {
    setComposerMenu(null);
    const res = await window.undrcodAPI?.dialog.openFolder();
    if (res.canceled !== false) return;
    setAttachments((prev) => {
      if (prev.some((a) => a.path === res.path)) return prev;
      return [...prev, { id: crypto.randomUUID(), path: res.path, type: 'folder' as const }];
    });
  }, []);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleEffortChange = useCallback(async (effortId: string) => {
    setCurrentEffort(effortId);
    if (!sessionId) return;
    const budgetMap: Record<string, string> = {
      'low': 'low',
      'medium': 'medium',
      'high': 'high',
      'xhigh': 'high',
      'max': 'max',
    };
    const budget = budgetMap[effortId] || effortId;
    await window.undrcodAPI?.agent.send({ sessionId, cwd, prompt: `/thinking-budget ${budget}` });
  }, [sessionId, cwd]);

  /**
   * Troca o permission mode. Aplica no próximo send (via --permission-mode no spawn).
   * Mostra meta-info no chat como feedback visual.
   */
  const handlePermissionModeChange = useCallback((mode: string) => {
    if (mode === permissionMode) {
      setComposerMenu(null);
      return;
    }
    setPermissionMode(mode);
    setComposerMenu(null);
    const label =
      mode === 'plan' ? 'Plan'
      : mode === 'acceptEdits' ? 'Aceitar edições'
      : mode === 'bypassPermissions' ? 'Bypass'
      : mode === 'askPermissions' ? 'Solicitar permissões'
      : 'Automático';
    setItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), kind: 'meta', text: `Modo trocado pra ${label}` }
    ]);
  }, [permissionMode]);

  const handleFastModeToggle = useCallback(async () => {
    const next = !fastMode;
    setFastMode(next);
    if (!sessionId) return;
    await window.undrcodAPI?.agent.send({ sessionId, cwd, prompt: `/fast ${next ? 'on' : 'off'}` });
  }, [sessionId, cwd, fastMode]);

  // Detecta `/` no início do input → abre command menu.
  useEffect(() => {
    if (input.startsWith('/') && !cmdMenuOpen) {
      setCmdMenuOpen(true);
    } else if (!input.startsWith('/') && cmdMenuOpen) {
      setCmdMenuOpen(false);
    }
  }, [input, cmdMenuOpen]);

  /**
   * Salva uma imagem (File do clipboard ou drag-drop) em
   * <cwd>/.undrcod/pasted-images/<prefix>-<ts>.<ext>.
   * Retorna o path absoluto salvo ou null se falhar.
   * Reutilizado pelo paste handler e pelo drop handler — mesma lógica de encoding
   * e save, prefixo distingue origem ("pasted" vs "dropped").
   */
  const savePastedImage = useCallback(
    async (file: File, prefix: 'pasted' | 'dropped' = 'pasted'): Promise<string | null> => {
      try {
        const buf = await file.arrayBuffer();
        // Encode base64 sem usar btoa(String.fromCharCode) que estoura stack pra imgs grandes
        const bytes = new Uint8Array(buf);
        const chunkSize = 0x8000;
        let binary = '';
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
        }
        const base64 = window.btoa(binary);
        const ext = file.type.split('/')[1]?.split(';')[0] || 'png';
        const ts = Date.now();
        const filename = `${prefix}-${ts}.${ext}`;
        const sep = cwd.includes('\\') ? '\\' : '/';
        const targetPath = `${cwd}${sep}.undrcod${sep}pasted-images${sep}${filename}`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (window.undrcodAPI?.fs as any).writeBinaryFromBase64(targetPath, base64);
        if (res && 'error' in res) {
          console.warn('[savePastedImage] writeBinary falhou:', res.error);
          return null;
        }
        return targetPath;
      } catch (err) {
        console.warn('[savePastedImage] erro inesperado:', err);
        return null;
      }
    },
    [cwd],
  );

  /**
   * Paste de imagem (Ctrl+V com screenshot ou imagem no clipboard) →
   * usa savePastedImage e adiciona como attachment.
   * Se o clipboard não tem imagem (só texto), deixa o behavior default passar.
   */
  const handlePasteImage = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      let imageItem: DataTransferItem | null = null;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          imageItem = it;
          break;
        }
      }
      if (!imageItem) return; // sem imagem → deixa texto colar normal
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;
      const saved = await savePastedImage(file, 'pasted');
      if (!saved) return;
      setAttachments((prev) => [
        ...prev,
        { id: crypto.randomUUID(), path: saved, type: 'file' },
      ]);
    },
    [savePastedImage],
  );

  // Detecta `@` antes do cursor → abre mention autocomplete + atualiza query.
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      const cursor = e.target.selectionStart ?? value.length;
      setInput(value);

      // Procura o último `@` antes do cursor que não tem espaço entre ele e o cursor
      let atIdx = -1;
      for (let i = cursor - 1; i >= 0; i--) {
        const ch = value[i];
        if (ch === '@') {
          // valida: char antes do `@` deve ser início-de-linha ou whitespace
          if (i === 0 || /\s/.test(value[i - 1])) {
            atIdx = i;
          }
          break;
        }
        if (/\s/.test(ch)) break; // espaço quebra o token
      }

      if (atIdx >= 0) {
        const query = value.slice(atIdx + 1, cursor);
        mentionStartRef.current = atIdx;
        setMentionQuery(query);
        setMentionOpen(true);
      } else {
        setMentionOpen(false);
        mentionStartRef.current = null;
      }
    },
    []
  );

  const handleMentionSelect = useCallback(
    (file: WorkspaceFile) => {
      const start = mentionStartRef.current;
      if (start === null) return;
      const cursor = inputRef.current?.selectionStart ?? input.length;
      const before = input.slice(0, start);
      const after = input.slice(cursor);
      const suffix = file.type === 'dir' ? '/' : '';
      const newValue = `${before}@${file.rel}${suffix} ${after}`;
      setInput(newValue);
      setMentionOpen(false);
      mentionStartRef.current = null;
      // Re-foca textarea e posiciona cursor após o path inserido
      setTimeout(() => {
        const el = inputRef.current;
        if (!el) return;
        const newCursor = before.length + 1 + file.rel.length + suffix.length + 1;
        el.focus();
        el.setSelectionRange(newCursor, newCursor);
      }, 0);
    },
    [input]
  );

  // Insere texto na posição do cursor no textarea do composer. Se nada estiver
  // selecionado, insere no caret; se houver seleção, substitui. Usado pelo picker
  // de snippets (Ctrl+;).
  const insertAtCursor = useCallback((text: string) => {
    const el = inputRef.current;
    if (!el) {
      setInput((prev) => (prev ? `${prev}\n${text}` : text));
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const current = el.value;
    const next = current.slice(0, start) + text + current.slice(end);
    setInput(next);
    setTimeout(() => {
      const target = inputRef.current;
      if (!target) return;
      target.focus();
      const caret = start + text.length;
      target.setSelectionRange(caret, caret);
    }, 0);
  }, []);

  // Abre o picker de snippets (Ctrl+;). Recarrega lista do localStorage a cada
  // abertura pra refletir edições feitas no SnippetsManager.
  const openSnippetsPicker = useCallback(() => {
    setSnippets(loadSnippets());
    setComposerMenu('snippets');
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl+; — abre picker de snippets. Preempta sobre tudo (exceto mentions abertas
      // que precisam navegar via setas/Enter, mas `;` não conflita com elas).
      if ((e.ctrlKey || e.metaKey) && e.key === ';') {
        e.preventDefault();
        openSnippetsPicker();
        return;
      }
      // Mention popover aberto: deixa o popover handler interceptar (window capture)
      if (mentionOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape')) {
        return;
      }
      // Slash command menu aberto (via `/` no textarea)
      if (cmdMenuOpen && input.startsWith('/')) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setInput('');                       // limpa `/` ao Esc
          setCmdMenuOpen(false);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          // Procura primeiro match (label ou keywords contém o filter)
          const filter = input.slice(1).toLowerCase();
          let match: CommandItem | null = null;
          for (const sec of commandSections) {
            for (const it of sec.items) {
              if (it.disabled) continue;
              if (
                it.label.toLowerCase().includes(filter) ||
                it.keywords?.toLowerCase().includes(filter) ||
                it.hint?.toLowerCase().includes(filter)
              ) {
                match = it;
                break;
              }
            }
            if (match) break;
          }
          if (match) {
            handleCommandSelect(match);
            setInput('');
            setCmdMenuOpen(false);
          }
          return;
        }
      }
      // Esc fecha menu sem limpar input (quando aberto via botão `+`)
      if (e.key === 'Escape' && cmdMenuOpen) {
        e.preventDefault();
        setCmdMenuOpen(false);
        return;
      }
      // ↑ history back (só quando input vazio ou já navegando)
      if (e.key === 'ArrowUp' && inputHistory.length > 0) {
        if (input === '' || historyIdx !== null) {
          e.preventDefault();
          const newIdx = historyIdx === null
            ? inputHistory.length - 1
            : Math.max(0, historyIdx - 1);
          setHistoryIdx(newIdx);
          setInput(inputHistory[newIdx]);
          return;
        }
      }
      // ↓ history forward (só se já navegando)
      if (e.key === 'ArrowDown' && historyIdx !== null) {
        e.preventDefault();
        const newIdx = historyIdx + 1;
        if (newIdx >= inputHistory.length) {
          setHistoryIdx(null);
          setInput('');
        } else {
          setHistoryIdx(newIdx);
          setInput(inputHistory[newIdx]);
        }
        return;
      }
      // Enter sem shift envia
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, cmdMenuOpen, input, inputHistory, historyIdx, mentionOpen, openSnippetsPicker]
  );

  // === Command Menu actions ===

  const sendSlashCommand = useCallback(
    (cmd: string) => {
      if (!sessionId || busy) return;
      setBusy(true);
      setItems((prev) => [
        ...prev,
        { id: crypto.randomUUID(), kind: 'meta', text: cmd }
      ]);
      window.undrcodAPI?.agent.send({ sessionId, cwd, prompt: cmd }).then((result) => {
        if ('error' in result) {
          setBusy(false);
          setItems((prev) => [
            ...prev,
            { id: crypto.randomUUID(), kind: 'error', message: result.error }
          ]);
        }
      });
    },
    [sessionId, busy, cwd]
  );

  const appendToInput = useCallback((text: string) => {
    setInput((prev) => (prev ? `${prev} ${text}` : `${text} `));
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleCommandSelect = useCallback(
    async (item: CommandItem) => {
      switch (item.action.kind) {
        case 'write-to-input':
          appendToInput(item.action.text);
          break;
        case 'send-direct':
          sendSlashCommand(item.action.prompt);
          break;
        case 'pick-file': {
          // Por enquanto, abre workspace dialog. Idealmente seria file picker.
          const res = await window.undrcodAPI?.dialog.openWorkspace();
          if (res.canceled === false) {
            let rel = res.path;
            if (rel.startsWith(cwd)) {
              rel = rel.slice(cwd.length).replace(/\\/g, '/');
              if (rel.startsWith('/')) rel = rel.slice(1);
            } else {
              rel = rel.replace(/\\/g, '/');
            }
            appendToInput(`@${rel}/`);
          }
          break;
        }
        case 'focus-tree':
          // No-op por enquanto — futuramente foca FileTree
          break;
      }
    },
    [appendToInput, sendSlashCommand, cwd]
  );

  const commandSections: CommandSection[] = useMemo(
    () => [
      {
        id: 'slash',
        title: 'Comandos',
        items: [
          {
            id: 'cmd-clear',
            label: '/clear',
            hint: 'limpar conversa',
            icon: 'clear-all',
            keywords: 'clear limpar reset new nova',
            action: { kind: 'send-direct', prompt: '/clear' }
          },
          {
            id: 'cmd-compact',
            label: '/compact',
            hint: 'compactar com sumário AI',
            icon: 'list-tree',
            keywords: 'compact sumario sumarizar resumir',
            action: { kind: 'send-direct', prompt: '/compact' }
          },
          {
            id: 'cmd-cost',
            label: '/cost',
            hint: 'uso de tokens e custo',
            icon: 'graph',
            keywords: 'cost custo token usage uso',
            action: { kind: 'send-direct', prompt: '/cost' }
          },
          {
            id: 'cmd-help',
            label: '/help',
            hint: 'lista de comandos',
            icon: 'question',
            keywords: 'help ajuda commands comandos',
            action: { kind: 'send-direct', prompt: '/help' }
          },
          {
            id: 'cmd-init',
            label: '/init',
            hint: 'criar UNDERCODE.md',
            icon: 'file-add',
            keywords: 'init memory undercode md criar',
            action: { kind: 'send-direct', prompt: '/init' }
          },
          {
            id: 'cmd-memory',
            label: '/memory',
            hint: 'editar memória persistente',
            icon: 'book',
            keywords: 'memory memória undercode md persistente',
            action: { kind: 'send-direct', prompt: '/memory' }
          },
          {
            id: 'cmd-review',
            label: '/review',
            hint: 'code review das mudanças',
            icon: 'code-review',
            keywords: 'review revisar revisão',
            action: { kind: 'send-direct', prompt: '/review' }
          },
          {
            id: 'cmd-mcp',
            label: '/mcp',
            hint: 'gerenciar servers MCP',
            icon: 'plug',
            keywords: 'mcp model context protocol',
            action: { kind: 'send-direct', prompt: '/mcp' }
          },
          {
            id: 'cmd-config',
            label: '/config',
            hint: 'settings interativo',
            icon: 'settings-gear',
            keywords: 'config settings configuração preferences',
            action: { kind: 'send-direct', prompt: '/config' }
          },
          {
            id: 'cmd-doctor',
            label: '/doctor',
            hint: 'diagnóstico do app',
            icon: 'pulse',
            keywords: 'doctor diagnostic diagnóstico debug',
            action: { kind: 'send-direct', prompt: '/doctor' }
          },
          {
            id: 'cmd-release-notes',
            label: '/release-notes',
            hint: 'changelog',
            icon: 'history',
            keywords: 'release notes changelog versão',
            action: { kind: 'send-direct', prompt: '/release-notes' }
          }
        ]
      },
      {
        id: 'context',
        title: 'Contexto',
        items: [
          {
            id: 'attach-folder',
            label: 'Anexar pasta',
            hint: 'dialog',
            icon: 'folder-opened',
            keywords: 'arquivo file folder pasta anexar',
            action: { kind: 'pick-file' }
          },
          {
            id: 'mention-tip',
            label: 'Mencionar arquivo da árvore',
            hint: 'arraste',
            icon: 'mention',
            keywords: 'mention path arrastar drag',
            action: { kind: 'focus-tree' },
            disabled: true,
            disabledReason: 'arraste da esquerda'
          },
        ]
      },
      {
        id: 'skills',
        title: 'Skills',
        items: [
          {
            id: 'skill-impeccable',
            label: 'Impeccable (design UI)',
            hint: '/impeccable',
            icon: 'symbol-color',
            keywords: 'design ui impeccable',
            action: { kind: 'write-to-input', text: '/impeccable' }
          },
          {
            id: 'skill-motion',
            label: 'Motion design principles',
            hint: '/design-motion-principles',
            icon: 'play-circle',
            keywords: 'motion animation design',
            action: { kind: 'write-to-input', text: '/design-motion-principles' }
          },
          {
            id: 'skill-frontend',
            label: 'Frontend design',
            hint: '/frontend-design',
            icon: 'browser',
            keywords: 'frontend design',
            action: { kind: 'write-to-input', text: '/frontend-design' }
          }
        ]
      },
      // Seção DINÂMICA: slash commands trazidos por plugins instalados.
      // Vem do `session_init.slashCommands` do Claude CLI. Cada plugin pode
      // contribuir N comandos. Filtramos os builtin pra só mostrar dos plugins.
      // Formato CLI: "agent-sdk-dev:new-sdk-app" (namespaced) ou nome simples.
      ...(() => {
        if (availableSlashCommands.length === 0) return [];
        const builtinIds = new Set([
          'clear', 'compact', 'cost', 'help', 'init', 'memory', 'review',
          'mcp', 'config', 'doctor', 'release-notes',
          // skills builtin já na seção Skills:
          'impeccable', 'design-motion-principles', 'frontend-design',
        ]);
        const pluginCommands = availableSlashCommands.filter((cmd) => {
          // Comandos namespaced (foo:bar) são sempre de plugins
          if (cmd.includes(':')) return true;
          // Sem namespace: só se não for um builtin que já listamos
          return !builtinIds.has(cmd);
        });
        if (pluginCommands.length === 0) return [];
        return [{
          id: 'plugin-commands',
          title: 'Plugins',
          items: pluginCommands.map((cmd) => {
            // Nome amigável pra display: pega tudo depois do ":" se namespaced
            const [namespace, suffix] = cmd.includes(':') ? cmd.split(':', 2) : ['', cmd];
            const displayName = suffix || cmd;
            const namespaceHint = namespace ? ` · ${namespace}` : '';
            return {
              id: `plugin-cmd-${cmd}`,
              label: `/${displayName}`,
              hint: namespaceHint ? `plugin${namespaceHint}` : 'plugin',
              icon: 'extensions',
              keywords: `${cmd} ${namespace} plugin`,
              action: { kind: 'write-to-input' as const, text: `/${cmd}` },
            };
          }),
        }];
      })(),
    ],
    [availableSlashCommands]
  );

  // Drag-drop suporte — composer aceita 2 sources:
  //   1) FileTree interno via application/x-undrcod-path (drag de entry no tree)
  //   2) OS Explorer/Finder via e.dataTransfer.files (Electron expõe file.path)
  // Imagens dropadas seguem o mesmo flow do paste (save em .undrcod/pasted-images, prefix "dropped").
  const [isDropTarget, setIsDropTarget] = useState(false);
  const dropDepthRef = useRef(0);

  const dragHasUsableData = useCallback((dt: DataTransfer): boolean => {
    const types = dt.types;
    if (!types) return false;
    // Em alguns browsers types é uma DOMStringList — converte pra checar com .includes
    const arr = Array.from(types as unknown as Iterable<string>);
    return arr.includes('application/x-undrcod-path') || arr.includes('Files');
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!dragHasUsableData(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    [dragHasUsableData],
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!dragHasUsableData(e.dataTransfer)) return;
      e.preventDefault();
      dropDepthRef.current += 1;
      setIsDropTarget(true);
    },
    [dragHasUsableData],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // dragenter/dragleave dispara pra cada child element — usamos contador pra só
    // limpar o estado quando saímos do composer de verdade.
    if (dropDepthRef.current > 0) dropDepthRef.current -= 1;
    if (dropDepthRef.current === 0) setIsDropTarget(false);
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      dropDepthRef.current = 0;
      setIsDropTarget(false);

      // Source 1: FileTree interno
      const internalPath = e.dataTransfer.getData('application/x-undrcod-path');
      if (internalPath) {
        const type = e.dataTransfer.getData('application/x-undrcod-type');
        const attType: 'file' | 'folder' = type === 'dir' ? 'folder' : 'file';
        setAttachments((prev) => {
          if (prev.some((a) => a.path === internalPath)) return prev;
          return [...prev, { id: crypto.randomUUID(), path: internalPath, type: attType }];
        });
        return;
      }

      // Source 2: OS file drop (Explorer/Finder)
      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // Imagem → salva em .undrcod/pasted-images/ via savePastedImage (mesmo flow do paste)
        if (file.type.startsWith('image/')) {
          const saved = await savePastedImage(file, 'dropped');
          if (saved) {
            setAttachments((prev) => [
              ...prev,
              { id: crypto.randomUUID(), path: saved, type: 'file' },
            ]);
          }
          continue;
        }
        // Arquivo regular — Electron expõe .path (non-standard) com o caminho absoluto do OS
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const osPath: string | undefined = (file as any).path;
        if (!osPath) continue;
        setAttachments((prev) => {
          if (prev.some((a) => a.path === osPath)) return prev;
          return [...prev, { id: crypto.randomUUID(), path: osPath, type: 'file' }];
        });
      }
    },
    [savePastedImage],
  );

  // Visual variant — opcional, vem do localStorage. Quando setado, sobrescreve
  // o visual default via ChatView-variants.css (data-variant="minimalist" /
  // "brutalist" / "editorial"). Trocar no DevTools console:
  //   localStorage.setItem('chatVariant', 'minimalist'); location.reload()
  //   localStorage.removeItem('chatVariant'); location.reload()  // volta default
  const variant = useMemo(() => {
    try {
      return localStorage.getItem('chatVariant') || undefined;
    } catch {
      return undefined;
    }
  }, []);

  return (
    <div
      className="chatview"
      data-transcript-font={transcriptFontSize}
      data-transcript-mode={transcriptMode}
      data-variant={variant}
    >
      <div className="chatview-messages" ref={scrollRef}>
        {historyLoading && (
          <div className="chatview-history-loading" role="status" aria-live="polite">
            <i className="codicon codicon-loading codicon-modifier-spin chatview-history-loading-icon" />
            <span className="chatview-history-loading-text">
              Carregando histórico
              {historyExpectedCount !== null && (
                <> · {historyExpectedCount} {historyExpectedCount === 1 ? 'mensagem' : 'mensagens'}</>
              )}
              ...
            </span>
          </div>
        )}
        {/* Banner lazy-load: mostra se tem mensagens anteriores pra carregar.
            historyOffset > 0 = ainda existem linhas antes do que tá renderizado. */}
        {!historyLoading && historyOffset > 0 && historyTotalEvents !== null && (
          <button
            ref={loadMoreBannerRef}
            type="button"
            className="chatview-load-more"
            onClick={loadOlderHistory}
            disabled={loadingMoreHistory}
            aria-label="Carregar mensagens anteriores"
          >
            {loadingMoreHistory ? (
              <>
                <i className="codicon codicon-loading codicon-modifier-spin" />
                <span>Carregando…</span>
              </>
            ) : (
              <>
                <i className="codicon codicon-arrow-up" />
                <span>
                  Carregar mensagens anteriores · {historyOffset} {historyOffset === 1 ? 'restante' : 'restantes'}
                </span>
              </>
            )}
          </button>
        )}
        {/* Splash cards de quickstart removidos por pedido do user — chat vazio fica clean. */}
        {/* key={transcriptMode}: força React a UNMOUNT + REMOUNT completo do
         * VirtualizedItems quando o modo muda. Simula exatamente o comportamento
         * de "trocar de conversa e voltar" — toda state interna do virtualizer
         * (scrollOffset, range cache, ResizeObserver refs, measureElement cache)
         * é descartada e reconstruída from scratch. Sem isso, trocar modo
         * mantém state stale que causa overlap visual e gaps fantasma. */}
        <VirtualizedItems
          key={transcriptMode}
          items={items}
          transcriptMode={transcriptMode}
          scrollRef={scrollRef}
          setItems={setItems}
          setMsgMenu={setMsgMenu}
          permissionMode={permissionMode}
          setPermissionMode={setPermissionMode}
          setInput={setInput}
          handleSend={handleSend}
          onAlwaysAllowTool={handleAlwaysAllowTool}
        />
      </div>

      {/* FAB "ir pro fim" — aparece quando user scrolla pra cima.
       *  Posicionado absolute em relação a .chatview (pai), fica ACIMA do
       *  composer. Sai do scroll container pra não scrollar junto. */}
      {showScrollToBottom && (
        <button
          type="button"
          className="chatview-scroll-to-bottom"
          onClick={handleScrollToBottom}
          aria-label="Ir pro fim da conversa"
          title="Ir pro fim"
        >
          <i className="codicon codicon-arrow-down" aria-hidden="true" />
        </button>
      )}

      <div className="chatview-footer">
        <div className="composer-wrapper">
          <CommandMenu
            open={cmdMenuOpen}
            onClose={() => {
              setCmdMenuOpen(false);
              // Se o menu foi aberto via `/` no input, limpa pra não re-abrir em loop
              setInput((cur) => (cur.startsWith('/') ? '' : cur));
            }}
            sections={commandSections}
            onSelect={handleCommandSelect}
            anchorRef={plusBtnRef}
            externalFilter={input.startsWith('/') ? input.slice(1) : undefined}
          />

          <MentionAutocomplete
            open={mentionOpen}
            query={mentionQuery}
            files={workspaceFiles}
            anchorRef={inputRef}
            onSelect={handleMentionSelect}
            onClose={() => setMentionOpen(false)}
          />

          {/* Popover SNIPPETS — Ctrl+; abre picker com prompts salvos.
            * Lista vem do localStorage via loadSnippets(). Click insere o body no caret. */}
          <ComposerPopover
            open={composerMenu === 'snippets'}
            onClose={() => setComposerMenu(null)}
            anchorRef={inputRef}
            title="Snippets"
            titleShortcut="Ctrl ;"
            minWidth={320}
            items={
              snippets.length === 0
                ? [
                    {
                      kind: 'description',
                      description: 'Nenhum snippet ainda. Adicione em "Mais opções → Gerenciar snippets".',
                    },
                  ]
                : snippets.map((s) => ({
                    icon: 'symbol-snippet',
                    label: s.name || '(sem nome)',
                    onClick: () => insertAtCursor(s.body),
                  }))
            }
          />

          {/* Popover MODE (badge Auto/Plan/Accept/Bypass) */}
          <ComposerPopover
            open={composerMenu === 'mode'}
            onClose={() => setComposerMenu(null)}
            anchorRef={modeBtnRef}
            title="Modo"
            titleShortcut="⇧ Ctrl M"
            items={[
              {
                label: 'Solicitar permissões',
                shortcut: '1',
                selected: permissionMode === 'askPermissions',
                onClick: () => handlePermissionModeChange('askPermissions'),
              },
              {
                label: 'Aceitar edições',
                shortcut: '2',
                selected: permissionMode === 'acceptEdits',
                onClick: () => handlePermissionModeChange('acceptEdits'),
              },
              {
                label: 'Modo de planejamento',
                shortcut: '3',
                selected: permissionMode === 'plan',
                onClick: () => handlePermissionModeChange('plan'),
              },
              {
                label: 'Padrão (pergunta cada tool)',
                shortcut: '4',
                selected: permissionMode === 'default',
                onClick: () => handlePermissionModeChange('default'),
              },
              { kind: 'divider' },
              {
                label: 'Auto (aceita tudo)',
                shortcut: '5',
                selected: permissionMode === 'bypassPermissions',
                onClick: () => handlePermissionModeChange('bypassPermissions'),
              },
              { kind: 'description', description: 'Bypassa todas permissões — use com cuidado' },
            ]}
          />

          {/* Popover PLUS (+) */}
          <ComposerPopover
            open={composerMenu === 'plus'}
            onClose={() => setComposerMenu(null)}
            anchorRef={plusBtnRef}
            items={[
              { icon: 'file-add', label: 'Adicionar arquivos ou fotos', onClick: handlePickFiles },
              { icon: 'folder', label: 'Adicionar pasta', onClick: handlePickFolder },
              {
                icon: 'symbol-string',
                label: 'Comandos de barra',
                onClick: () => {
                  setComposerMenu(null);
                  // Insere '/' no input pra o useEffect de detecção abrir o CommandMenu
                  setInput((prev) => (prev.startsWith('/') ? prev : '/' + prev));
                  setTimeout(() => inputRef.current?.focus(), 0);
                },
              },
              {
                icon: 'plug',
                label: 'Conectores',
                submenu: [
                  ...(mcpLoaded && mcpServers.length === 0
                    ? ([
                        { kind: 'item', label: 'Nenhum conector configurado', disabled: true },
                        {
                          kind: 'item',
                          icon: 'question',
                          label: 'Como configurar...',
                          onClick: () => {
                            window.undrcodAPI?.openExternal?.('https://docs.claude.com/en/docs/claude-code/mcp');
                            setComposerMenu(null);
                          },
                        },
                        { kind: 'divider' },
                      ] as PopoverItem[])
                    : mcpServers.map((srv) => ({
                        kind: 'item' as const,
                        icon: srv.status === 'configured' ? 'plug' : 'warning',
                        label: srv.name,
                        badge: srv.scope === 'workspace' ? 'workspace' : srv.scope === 'project' ? 'projeto' : undefined,
                        onClick: () => { setComposerMenu(null); onOpenMcpManager?.(); },
                      } as PopoverItem))),
                  ...(mcpServers.length > 0 ? ([{ kind: 'divider' }] as PopoverItem[]) : []),
                  { kind: 'item', icon: 'settings-gear', label: 'Gerenciar conectores...', onClick: () => { setComposerMenu(null); onOpenMcpManager?.(); } },
                  { kind: 'item', icon: 'folder', label: 'Editar .mcp.json do workspace', onClick: () => openRawMcpJson('workspace') },
                ],
              },
              {
                icon: 'extensions',
                label: 'Plugins',
                onClick: () => { setComposerMenu(null); onOpenPluginMarketplace?.(); },
              },
              {
                icon: 'settings-gear',
                label: 'Customizações',
                onClick: () => { setComposerMenu(null); onOpenCustomization?.(); },
              },
              { kind: 'divider' } as PopoverItem,
              {
                icon: 'text-size',
                label: 'Tamanho do texto',
                badge: transcriptFontSize === 'sm' ? 'Pequeno' : transcriptFontSize === 'lg' ? 'Grande' : 'Médio',
                submenu: [
                  {
                    kind: 'item',
                    label: 'Pequeno',
                    icon: transcriptFontSize === 'sm' ? 'check' : undefined,
                    onClick: () => { setComposerMenu(null); onTranscriptFontSizeChange?.('sm'); },
                  },
                  {
                    kind: 'item',
                    label: 'Médio',
                    icon: transcriptFontSize === 'md' ? 'check' : undefined,
                    onClick: () => { setComposerMenu(null); onTranscriptFontSizeChange?.('md'); },
                  },
                  {
                    kind: 'item',
                    label: 'Grande',
                    icon: transcriptFontSize === 'lg' ? 'check' : undefined,
                    onClick: () => { setComposerMenu(null); onTranscriptFontSizeChange?.('lg'); },
                  },
                ] as PopoverItem[],
              },
            ]}
          />

          {/* Popover MODEL (model name + effort + fast mode) */}
          <ComposerPopover
            open={composerMenu === 'model'}
            onClose={() => setComposerMenu(null)}
            anchorRef={modelBtnRef}
            align="right"
            minWidth={280}
            items={[
              { kind: 'section', label: 'Modelos', shortcut: '⇧ Ctrl I' },
              { label: 'Opus 4.7', shortcut: '1', selected: currentModel === 'opus', onClick: () => handleModelChange('opus') },
              { label: 'Opus 4.7 1M', shortcut: '2', selected: currentModel === 'opus-1m', onClick: () => handleModelChange('opus-1m') },
              { label: 'Sonnet 4.6', shortcut: '3', selected: currentModel === 'sonnet', onClick: () => handleModelChange('sonnet') },
              { label: 'Haiku 4.5', shortcut: '4', selected: currentModel === 'haiku', onClick: () => handleModelChange('haiku') },
              { label: 'Opus 4.6', badge: 'Legado', shortcut: '5', selected: currentModel === 'opus-legacy', onClick: () => handleModelChange('opus-legacy') },
              { kind: 'divider' },
              { kind: 'section', label: 'Esforço', shortcut: '⇧ Ctrl E' },
              { label: 'Baixa', selected: currentEffort === 'low', onClick: () => handleEffortChange('low') },
              { label: 'Médio', selected: currentEffort === 'medium', onClick: () => handleEffortChange('medium') },
              { label: 'Alto', selected: currentEffort === 'high', onClick: () => handleEffortChange('high') },
              { label: 'Extra alto', selected: currentEffort === 'xhigh', onClick: () => handleEffortChange('xhigh') },
              { label: 'Max', selected: currentEffort === 'max', onClick: () => handleEffortChange('max') },
              { kind: 'divider' },
              { kind: 'section', label: 'Modo rápido' },
              {
                label: 'Ativar modo rápido',
                toggle: true,
                toggleValue: fastMode,
                onClick: handleFastModeToggle,
              },
            ]}
          />

          <div
            className={`composer ${isDropTarget ? 'is-drop-target' : ''}`}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isDropTarget && (
              <div className="composer-drop-overlay" aria-hidden="true">
                <i className="codicon codicon-cloud-upload composer-drop-overlay-icon" />
                <span className="composer-drop-overlay-text">Solte pra anexar</span>
              </div>
            )}
            {attachments.length > 0 && (
              <div className="composer-attachments" role="list" aria-label="Arquivos anexados">
                {attachments.map((a) => {
                  const segs = a.path.split(/[\\/]/).filter(Boolean);
                  const name = segs[segs.length - 1] || a.path;
                  const rel = toRelativePath(a.path, a.type === 'folder');
                  return (
                    <span
                      key={a.id}
                      className={`composer-chip composer-chip-${a.type}`}
                      role="listitem"
                      title={rel}
                    >
                      <i className={`codicon codicon-${a.type === 'folder' ? 'folder' : 'file'} composer-chip-icon`} />
                      <span className="composer-chip-name">{name}</span>
                      <button
                        type="button"
                        className="composer-chip-remove"
                        onClick={() => handleRemoveAttachment(a.id)}
                        title={`Remover ${name}`}
                        aria-label={`Remover ${name}`}
                      >
                        <i className="codicon codicon-close" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            {cssChanges.length > 0 && (
              // Chips estilo @mention REAL — flutuam ABSOLUTOS sobre o textarea
              // no canto superior-esquerdo. Texto/placeholder do textarea ganha
              // text-indent = chipsRowWidth + gap, empurrando primeira linha pra
              // depois dos chips (parecendo inline). Quando chips wrap em várias
              // linhas, ResizeObserver atualiza a width e text-indent acompanha.
              <>
                <div
                  ref={chipsRowRef}
                  className={`composer-attachments ${
                    // Inline (absolute overlay) só quando NENHUM chip está expandido.
                    // Quando expandido, chips vão pro fluxo normal pra panel
                    // detail renderizar abaixo sem overlap visual.
                    expandedChipIdx === null ? 'composer-attachments-css-inline' : ''
                  }`}
                  role="list"
                  aria-label="CSS changes anexadas"
                >
                  {cssChanges.map((payload, idx) => {
                    // Se o payload é text-only (sem CSS selectors), pega tag/contexto
                    // do primeiro textChange. Caso contrário, do primeiro selector.
                    const hasCss = payload.selectors.length > 0;
                    const firstSel = hasCss
                      ? payload.selectors[0]?.selector
                      : payload.textChanges?.[0]?.selector;
                    const tagMatch = (firstSel || 'element').match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
                    const tag = tagMatch ? tagMatch[1] : 'element';
                    const totalCount = payload.selectors.length + (payload.textChanges?.length || 0);
                    const more = totalCount > 1 ? ` +${totalCount - 1}` : '';
                    const isExpanded = expandedChipIdx === idx;
                    const isTextOnly = !hasCss && (payload.textChanges?.length || 0) > 0;
                    return (
                      <span
                        key={idx}
                        className={`composer-chip composer-chip-ui-element ${isExpanded ? 'is-expanded' : ''}`}
                        role="listitem"
                        onClick={() => setExpandedChipIdx(isExpanded ? null : idx)}
                        title={isExpanded ? 'Colapsar' : 'Click pra ver detalhes'}
                      >
                        <i className={`codicon ${isTextOnly ? 'codicon-edit' : 'codicon-inspect'} composer-chip-icon`} />
                        <span className="composer-chip-name">{`<${tag}>${more}`}</span>
                        <button
                          type="button"
                          className="composer-chip-remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCssChanges((prev) => prev.filter((_, i) => i !== idx));
                            if (expandedChipIdx === idx) setExpandedChipIdx(null);
                            else if (expandedChipIdx !== null && expandedChipIdx > idx) {
                              setExpandedChipIdx(expandedChipIdx - 1);
                            }
                          }}
                          title="Remover esta mudança"
                          aria-label="Remover mudança CSS"
                        >
                          <i className="codicon codicon-close" />
                        </button>
                      </span>
                    );
                  })}
                </div>
                {expandedChipIdx !== null && cssChanges[expandedChipIdx] && (
                  <div className="composer-css-changes-detail">
                    <CssChangesPanel payload={cssChanges[expandedChipIdx]} compact />
                  </div>
                )}
              </>
            )}
            <textarea
              ref={inputRef}
              className="composer-input"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePasteImage}
              placeholder={
                busy
                  ? 'aguarde resposta...'
                  : cssChanges.length > 0
                    ? ''
                    : 'Digite / pra comandos · @ pra arquivo · Ctrl+V cola imagem'
              }
              rows={3}
              disabled={!sessionId}
              style={
                // Text-indent só aplica quando chips estão em modo INLINE
                // (absolute overlay). Quando expandido, chips estão no fluxo
                // normal e text-indent não é necessário (e causaria espaço
                // vazio no início da primeira linha).
                cssChanges.length > 0 && chipsRowWidth > 0 && expandedChipIdx === null
                  ? { textIndent: `${chipsRowWidth + 8}px` }
                  : undefined
              }
            />
            <div className="composer-toolbar">
              <div className="composer-toolbar-left">
                <button
                  ref={modeBtnRef}
                  type="button"
                  className={`composer-mode ${composerMenu === 'mode' ? 'is-open' : ''} mode-${permissionMode}`}
                  onClick={() => setComposerMenu(composerMenu === 'mode' ? null : 'mode')}
                  title="Trocar modo (Shift+Ctrl+M)"
                >
                  {permissionMode === 'plan' ? 'Plan' :
                   permissionMode === 'acceptEdits' ? 'Accept' :
                   permissionMode === 'bypassPermissions' ? 'Auto' :
                   permissionMode === 'askPermissions' ? 'Ask' :
                   'Padrão'}
                </button>
                <button
                  ref={plusBtnRef}
                  type="button"
                  className={`composer-icon-btn ${composerMenu === 'plus' ? 'is-open' : ''}`}
                  onClick={() => setComposerMenu(composerMenu === 'plus' ? null : 'plus')}
                  title="Adicionar contexto"
                >
                  <i className="codicon codicon-add" />
                </button>
                <button
                  type="button"
                  className={`composer-icon-btn composer-mic-btn ${micRecording ? 'is-recording' : ''} ${transcribing ? 'is-transcribing' : ''}`}
                  onClick={handleMicToggle}
                  disabled={transcribing}
                  title={
                    transcribing
                      ? 'Transcrevendo áudio com Whisper...'
                      : micRecording
                        ? 'Parar gravação (clique pra finalizar)'
                        : 'Falar (Whisper.cpp local)'
                  }
                  aria-label="Reconhecimento de voz"
                  aria-pressed={micRecording}
                  aria-busy={transcribing}
                >
                  <i
                    className={`codicon ${
                      transcribing
                        ? 'codicon-loading codicon-modifier-spin'
                        : micRecording
                          ? 'codicon-record'
                          : 'codicon-mic'
                    }`}
                  />
                </button>
              </div>
              <div className="composer-toolbar-right">
                {hasMemory && (
                  <span className="composer-memory-badge" title="Memória carregada (UNDERCODE.md / CLAUDE.md no workspace)">
                    <i className="codicon codicon-book" />
                    memory
                  </span>
                )}
                <div className="composer-model-wrapper">
                  <button
                    ref={modelBtnRef}
                    type="button"
                    className={`composer-model ${composerMenu === 'model' ? 'is-open' : ''}`}
                    onClick={() => setComposerMenu(composerMenu === 'model' ? null : 'model')}
                    title="Trocar modelo / esforço"
                  >
                    {(() => {
                      // Transforma raw model ID do Claude CLI (claude-opus-4-7[1m]) em nome amigável.
                      // Esforço (Baixa/Alto/Extra alto/Max) NÃO aparece aqui — segue selecionável no menu de modelo.
                      const raw = (modelLabel ?? '').toLowerCase();
                      if (raw.includes('opus-4-7') && raw.includes('1m')) return 'Opus 4.7 1M';
                      if (raw.includes('opus-4-7')) return 'Opus 4.7';
                      if (raw.includes('opus-4-6')) return 'Opus 4.6';
                      if (raw.includes('sonnet-4-6')) return 'Sonnet 4.6';
                      if (raw.includes('haiku-4-5')) return 'Haiku 4.5';
                      // Fallback via currentModel state se modelLabel não bater nenhum pattern
                      if (currentModel === 'opus') return 'Opus 4.7';
                      if (currentModel === 'opus-1m') return 'Opus 4.7 1M';
                      if (currentModel === 'sonnet') return 'Sonnet 4.6';
                      if (currentModel === 'haiku') return 'Haiku 4.5';
                      if (currentModel === 'opus-legacy') return 'Opus 4.6';
                      return modelLabel || 'Claude';
                    })()}
                  </button>
                </div>
                {(() => {
                  const used = lastTurn?.usage
                    ? (lastTurn.usage.inputTokens || 0) +
                      (lastTurn.usage.cacheReadInputTokens || 0) +
                      (lastTurn.usage.cacheCreationInputTokens || 0)
                    : 0;
                  const max = /1m/i.test(modelLabel ?? '') || currentModel.includes('1m') ? 1_000_000 : 200_000;
                  const pct = Math.min(100, Math.round((used / max) * 100));
                  return (
                    <ContextRing
                      ref={contextRingBtnRef}
                      pct={pct}
                      size={16}
                      onClick={() => setUsageOpen((p) => !p)}
                      className={usageOpen ? 'is-active' : ''}
                      title={used > 0 ? `Contexto ${pct}% — clique pra detalhes` : 'Uso de contexto e plano — clique pra detalhes'}
                    />
                  );
                })()}
                {busy ? (
                  <button
                    type="button"
                    className="composer-send is-busy"
                    onClick={handleCancel}
                    title="Cancelar"
                  >
                    <i className="codicon codicon-debug-stop" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="composer-send"
                    onClick={handleSend}
                    disabled={(!input.trim() && attachments.length === 0) || !sessionId}
                    title="Enviar (Enter)"
                  >
                    <i className="codicon codicon-arrow-up" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <UsagePopover
        open={usageOpen}
        onClose={() => setUsageOpen(false)}
        anchorRef={contextRingBtnRef}
        contextWindow={lastTurn?.usage ? {
          used:
            (lastTurn.usage.inputTokens || 0) +
            (lastTurn.usage.cacheReadInputTokens || 0) +
            (lastTurn.usage.cacheCreationInputTokens || 0),
          max: /1m/i.test(modelLabel ?? '') || currentModel.includes('1m') ? 1_000_000 : 200_000,
          inputTokens: lastTurn.usage.inputTokens,
          outputTokens: lastTurn.usage.outputTokens,
          cacheReadTokens: lastTurn.usage.cacheReadInputTokens,
          cacheCreationTokens: lastTurn.usage.cacheCreationInputTokens,
        } : null}
        totalCost={totalCost}
        turnsCount={turnsCount}
      />

      <ContextMenu
        open={msgMenu !== null}
        x={msgMenu?.x ?? 0}
        y={msgMenu?.y ?? 0}
        items={buildMsgMenuItems(msgMenu?.item, { setInput, inputRef, setItems })}
        onClose={() => setMsgMenu(null)}
      />
    </div>
  );
}

/**
 * Constrói os items do context menu pra uma mensagem user/assistant.
 * Retorna array vazio se item for null/undefined ou de um kind sem ações.
 *
 * Ações:
 *   - Copiar texto       (user + assistant)
 *   - Copiar como markdown (assistant apenas — preserva blocos ```)
 *   - Citar resposta     (user + assistant) → prefixa cada linha com "> " e adiciona ao composer
 *   - Re-enviar          (user apenas)      → copia texto pro composer (não envia)
 *   - Apagar mensagem    (user + assistant) → remove do display, confirmação antes
 */
function buildMsgMenuItems(
  item: ChatItem | undefined,
  ctx: {
    setInput: React.Dispatch<React.SetStateAction<string>>;
    inputRef: React.RefObject<HTMLTextAreaElement>;
    setItems: React.Dispatch<React.SetStateAction<ChatItem[]>>;
  },
): ContextMenuItem[] {
  if (!item) return [];
  if (item.kind !== 'user' && item.kind !== 'assistant') return [];

  const text = item.text;
  const items: ContextMenuItem[] = [];

  items.push({
    kind: 'item',
    icon: 'copy',
    label: 'Copiar texto',
    onClick: () => {
      navigator.clipboard.writeText(text).then(
        () => toast.success('Texto copiado'),
        () => toast.error('Falha ao copiar'),
      );
    },
  });

  if (item.kind === 'assistant') {
    items.push({
      kind: 'item',
      icon: 'markdown',
      label: 'Copiar como markdown',
      onClick: () => {
        navigator.clipboard.writeText(text).then(
          () => toast.success('Markdown copiado'),
          () => toast.error('Falha ao copiar'),
        );
      },
    });
  }

  items.push({
    kind: 'item',
    icon: 'quote',
    label: 'Citar resposta',
    onClick: () => {
      const quoted = text.split('\n').map((l) => `> ${l}`).join('\n');
      ctx.setInput((prev) => (prev ? `${prev}\n\n${quoted}\n\n` : `${quoted}\n\n`));
      setTimeout(() => ctx.inputRef.current?.focus(), 0);
    },
  });

  if (item.kind === 'user') {
    items.push({
      kind: 'item',
      icon: 'reply',
      label: 'Re-enviar',
      onClick: () => {
        ctx.setInput(text);
        setTimeout(() => ctx.inputRef.current?.focus(), 0);
      },
    });
  }

  items.push({ kind: 'divider' });

  items.push({
    kind: 'item',
    icon: 'trash',
    label: 'Apagar mensagem',
    destructive: true,
    onClick: () => {
      void (async () => {
        const ok = await confirmDialog({
          title: 'Apagar mensagem',
          message: 'Remove a mensagem só do display (não afeta a sessão do agent). Continuar?',
          confirmLabel: 'Apagar',
          destructive: true,
        });
        if (!ok) return;
        ctx.setItems((prev) => prev.filter((it) => it.id !== item.id));
        toast.info('Mensagem removida do display');
      })();
    },
  });

  return items;
}

function ChatItemViewImpl({
  item,
  setItems,
  forceExpandThinking = false,
  forceExpandTools = false,
  onContextMenu,
  permissionMode,
  onExecutePlan,
  onEditPlan,
  onAlwaysAllowTool,
}: {
  item: ChatItem;
  setItems: React.Dispatch<React.SetStateAction<ChatItem[]>>;
  /** Quando true (modo Pensando OU Detalhado), expande thinking blocks ignorando collapsed. */
  forceExpandThinking?: boolean;
  /** Quando true (modo Detalhado), expande tool cards ignorando collapsed. */
  forceExpandTools?: boolean;
  /** Right-click no container da msg (só user/assistant). */
  onContextMenu?: (e: React.MouseEvent, item: ChatItem) => void;
  /** Modo de permissão atual. Quando 'plan' tenta detectar plano em assistant msgs. */
  permissionMode?: string;
  /** Disparado quando o user clica "Executar plano" no PlanPanel. */
  onExecutePlan?: () => void;
  /** Disparado quando o user clica "Editar plano" no PlanPanel. */
  onEditPlan?: () => void;
  /** Disparado pelo PermissionCard quando user clica "Sempre permitir <Tool>". */
  onAlwaysAllowTool?: (toolName: string) => void;
}) {
  const toggleCollapse = useCallback(() => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === item.id && (it.kind === 'tool' || it.kind === 'thinking')
          ? { ...it, collapsed: !it.collapsed }
          : it
      )
    );
  }, [item.id, setItems]);

  if (item.kind === 'user') {
    // Se a mensagem foi enviada com CSS changes anexadas (Apply do CSS Inspector),
    // renderiza chips compactos ACIMA do bubble — um chip por Apply (estilo @mention).
    // Click no chip expande panel detalhado inline abaixo (single-expand UX).
    return (
      <div
        className="msg msg-user"
        onContextMenu={onContextMenu ? (e) => onContextMenu(e, item) : undefined}
      >
        {item.cssChanges && item.cssChanges.length > 0 && (
          <UserCssChangesChip payloads={item.cssChanges} itemId={item.id} />
        )}
        {item.text && <div className="msg-bubble">{item.text}</div>}
      </div>
    );
  }

  if (item.kind === 'assistant') {
    // Plan mode: tenta extrair steps. Se >= 3 e a msg não está streaming
    // (parsear no meio do stream gera flicker), renderiza PlanPanel no lugar
    // da bubble. Streaming termina → re-render mostra o panel.
    if (permissionMode === 'plan' && !item.streaming) {
      const steps = parsePlanSteps(item.text);
      if (steps.length >= 3) {
        return (
          <div
            className="msg msg-assistant msg-plan"
            onContextMenu={onContextMenu ? (e) => onContextMenu(e, item) : undefined}
          >
            <PlanPanel
              steps={steps}
              onExecute={onExecutePlan ?? (() => {})}
              onEdit={onEditPlan ?? (() => {})}
            />
          </div>
        );
      }
    }

    // Sem header "[U] Claude" — só a bubble, mais clean (match Claude Code).
    // Streaming state: cursor `_` piscando azul inline (mesmo glyph do wordmark).
    return (
      <div
        className="msg msg-assistant"
        onContextMenu={onContextMenu ? (e) => onContextMenu(e, item) : undefined}
      >
        <div className="msg-bubble">
          {renderMarkdown(item.text, item.streaming)}
          {item.streaming && (
            <span className="wordmark-u msg-streaming-cursor" aria-label="digitando">_</span>
          )}
        </div>
      </div>
    );
  }

  if (item.kind === 'tool') {
    // Visual rico via <ToolCard>. forceExpandTools = true SÓ em modo Detalhado.
    // Errors NÃO auto-expandem mais (eram!!item.isError antes) — em vez disso,
    // ToolCard mostra preview da saída inline pra erros colapsados. Modo Normal
    // = TUDO colapsado, sem exceção, mais clean.
    return (
      <ToolCard
        name={item.name}
        input={item.input}
        result={item.result}
        isError={item.isError}
        isRunning={item.result === undefined && !item.isError}
        summary={summarizeToolInput(item.name, item.input ?? {})}
        defaultExpanded={forceExpandTools}
      />
    );
  }

  if (item.kind === 'thinking') {
    const expanded = forceExpandThinking || !item.collapsed;
    const durationLabel = thinkingDurationLabel(item.text);
    return (
      <div className="msg msg-thinking" data-collapsed={!expanded}>
        <button
          type="button"
          className="msg-thinking-header"
          onClick={toggleCollapse}
          aria-expanded={expanded}
        >
          <i className="codicon codicon-lightbulb msg-thinking-icon" aria-hidden="true" />
          <span className="msg-thinking-label">
            Pensou <span className="msg-thinking-duration">{durationLabel}</span>
          </span>
          <i
            className={`codicon codicon-chevron-${expanded ? 'down' : 'right'} msg-thinking-caret`}
            aria-hidden="true"
          />
        </button>
        {expanded && (
          <div className="msg-thinking-body">
            <div className="msg-thinking-content">{item.text}</div>
          </div>
        )}
      </div>
    );
  }

  if (item.kind === 'error') {
    return (
      <div className="msg msg-error">
        <i className="codicon codicon-warning" /> {item.message}
      </div>
    );
  }

  if (item.kind === 'auth_expired') {
    const onLogin = (e: React.MouseEvent) => {
      e.preventDefault();
      // window.undrcodAPI?.auth eh exposto pelo preload; o componente pode estar em
      // build sem essa API (defensivo). Login eh fire-and-forget — re-checagem
      // de status acontece via window focus listener do useAuthStatus.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const auth = window.undrcodAPI?.auth;
      if (auth && typeof auth.login === 'function') {
        void auth.login();
      }
    };
    return (
      <div className="msg msg-auth-expired">
        <i className="codicon codicon-warning msg-auth-expired-icon" />
        <div className="msg-auth-expired-body">
          <div className="msg-auth-expired-title">Sessao Claude expirada</div>
          <div className="msg-auth-expired-desc">
            O token OAuth do Claude CLI expirou (401). Faca login de novo pra continuar.
          </div>
          <a
            href="#"
            className="msg-auth-expired-action"
            onClick={onLogin}
            role="button"
          >
            Entrar de novo <i className="codicon codicon-link-external" />
          </a>
        </div>
      </div>
    );
  }

  if (item.kind === 'rate_limited') {
    // Plano Max esgotou na janela. Sugere espera + opção de trocar pra Sonnet.
    return (
      <div className="msg msg-auth-expired">
        <i className="codicon codicon-watch msg-auth-expired-icon" />
        <div className="msg-auth-expired-body">
          <div className="msg-auth-expired-title">Cota do plano esgotada</div>
          <div className="msg-auth-expired-desc">
            Você atingiu o rate limit do seu plano (429). As cotas do Max são em janelas de
            ~5h — geralmente reset automático em breve. Você pode também trocar pra Sonnet
            (mais barato em tokens) no seletor de modelo do composer.
            {item.message && (
              <div className="msg-auth-expired-detail">{item.message}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (item.kind === 'meta') {
    return <div className="msg msg-meta">— {item.text} —</div>;
  }

  if (item.kind === 'todo_checklist') {
    return (
      <div className="msg msg-todo-checklist">
        <TodoChecklist todos={item.todos} />
      </div>
    );
  }

  if (item.kind === 'permission_request') {
    // Resolve a decisao + remove o card do items[]. Defensive: chama IPC
    // depois de remover (mesmo se IPC falhar, UI nao trava com card morto).
    const api = window.undrcodAPI?.agent;
    const requestId = item.requestId;
    const toolName = item.toolName;
    const input = item.input;
    const itemId = item.id;

    const removeSelf = (): void => {
      setItems((prev) => prev.filter((it) => it.id !== itemId));
    };

    const respond = (decision: {
      behavior: 'allow' | 'deny';
      updatedInput?: Record<string, unknown>;
      message?: string;
    }): void => {
      removeSelf();
      if (api && typeof api.respondPermission === 'function') {
        void api.respondPermission(requestId, decision);
      }
    };

    return (
      <div className="msg msg-permission">
        <PermissionCard
          toolName={toolName}
          summary={summarizeToolInput(toolName, input)}
          iconCodicon={permissionIconFor(toolName)}
          onAllow={() => respond({ behavior: 'allow', updatedInput: input })}
          onDeny={() =>
            respond({ behavior: 'deny', message: 'Usuario negou a execucao desta tool.' })
          }
          onAllowAlways={() => {
            onAlwaysAllowTool?.(toolName);
            respond({ behavior: 'allow', updatedInput: input });
          }}
        />
      </div>
    );
  }

  return null;
}

/**
 * Icon codicon pra exibir no PermissionCard. Espelha o mapeamento do ToolCard
 * (que nao exporta a funcao). Mantido conciso porque o permission card so usa
 * tools sensitivas comuns (Bash, Edit, Write, etc).
 */
function permissionIconFor(name: string): string {
  const n = name.toLowerCase();
  if (n === 'bash' || n === 'powershell') return 'terminal';
  if (n === 'read') return 'file-text';
  if (n === 'write') return 'new-file';
  if (n === 'edit' || n === 'multiedit') return 'edit';
  if (n === 'grep') return 'search';
  if (n === 'glob') return 'list-tree';
  if (n === 'webfetch') return 'globe';
  if (n === 'websearch') return 'search-fuzzy';
  if (n.includes('mcp')) return 'plug';
  return 'shield';
}

/**
 * PERF: memo evita re-render quando item identity não muda. Cada setItems
 * no ChatView re-renderiza todos os items virtualizados, mesmo os que não
 * mudaram. ChatItemView é grande (200+ linhas) — memo skip economiza 5-15ms
 * por row × 15 visible rows = 75-225ms por delta evitados.
 *
 * Custom equality: compara item por shallow identity (setItems é stable).
 * Handlers vêm wrapped com useCallback no caller.
 */
const ChatItemView = React.memo(ChatItemViewImpl);
