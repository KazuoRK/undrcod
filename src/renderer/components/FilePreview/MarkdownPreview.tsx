import { useMemo } from 'react';
import './MarkdownPreview.css';

interface MarkdownPreviewProps {
  content: string;
}

/**
 * Parser minimal de markdown line-by-line, sem deps externas.
 * Cobre o subset que aparece em READMEs / docs de projeto:
 *  - headings #..######
 *  - bold **x**, italic *x* / _x_
 *  - inline code `x`
 *  - fenced code blocks ``` (com lang opcional)
 *  - listas - / * / 1.
 *  - blockquote >
 *  - links [text](url)
 *  - horizontal rule ---
 *
 * Não é spec-compliant, é "good enough" pra preview no editor.
 */

// Escape pra não introduzir HTML acidental do markdown source.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Inline formatting — aplica em ordem: code (preserva conteúdo, sem mais parse
// dentro), depois links, bold, italic. Code primeiro porque ` protege o resto.
function renderInline(text: string): string {
  // Tokenize inline code primeiro pra não processar ** dentro de `code`.
  const codeTokens: string[] = [];
  let working = text.replace(/`([^`]+)`/g, (_m, code) => {
    codeTokens.push(code);
    return `\x00CODE${codeTokens.length - 1}\x00`;
  });

  working = escapeHtml(working);

  // Links [text](url) — só http(s)/mailto/relative pra evitar javascript:
  working = working.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    const safe = /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(url) ? url : '#';
    return `<a href="${safe}" target="_blank" rel="noreferrer noopener">${label}</a>`;
  });

  // Bold **x** ou __x__
  working = working.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  working = working.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic *x* ou _x_ (após bold pra não conflitar)
  working = working.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  working = working.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');

  // Restaura code tokens com escape próprio.
  working = working.replace(/\x00CODE(\d+)\x00/g, (_m, idx) => {
    return `<code class="md-preview-code-inline">${escapeHtml(codeTokens[Number(idx)])}</code>`;
  });

  return working;
}

interface Block {
  type: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'ul' | 'ol' | 'code' | 'quote' | 'hr';
  // Pra headings/p: html inline já renderizado. Pra ul/ol: array de html por item.
  // Pra code: texto cru (sem escape ainda). Pra quote: html inline. Pra hr: vazio.
  content: string | string[];
  lang?: string;
}

function parseMarkdown(src: string): Block[] {
  const lines = src.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fenceMatch = line.match(/^```(\w*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || '';
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // pula fence fechando
      blocks.push({ type: 'code', content: codeLines.join('\n'), lang });
      continue;
    }

    // Horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'hr', content: '' });
      i++;
      continue;
    }

    // Heading
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({
        type: (`h${level}` as Block['type']),
        content: renderInline(hMatch[2].trim()),
      });
      i++;
      continue;
    }

    // Blockquote — concatena linhas consecutivas começando com >
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', content: renderInline(quoteLines.join(' ')) });
      continue;
    }

    // Lista unordered
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(renderInline(lines[i].replace(/^\s*[-*+]\s+/, '')));
        i++;
      }
      blocks.push({ type: 'ul', content: items });
      continue;
    }

    // Lista ordered
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(renderInline(lines[i].replace(/^\s*\d+\.\s+/, '')));
        i++;
      }
      blocks.push({ type: 'ol', content: items });
      continue;
    }

    // Linha vazia — pula
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Parágrafo — agrega linhas consecutivas até linha vazia / outro bloco
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'p', content: renderInline(paraLines.join(' ')) });
  }

  return blocks;
}

function renderBlocks(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'h1': return `<h1 class="md-preview-h1">${b.content}</h1>`;
        case 'h2': return `<h2 class="md-preview-h2">${b.content}</h2>`;
        case 'h3': return `<h3 class="md-preview-h3">${b.content}</h3>`;
        case 'h4': return `<h4 class="md-preview-h4">${b.content}</h4>`;
        case 'h5': return `<h5 class="md-preview-h5">${b.content}</h5>`;
        case 'h6': return `<h6 class="md-preview-h6">${b.content}</h6>`;
        case 'p': return `<p class="md-preview-p">${b.content}</p>`;
        case 'quote': return `<blockquote class="md-preview-blockquote">${b.content}</blockquote>`;
        case 'hr': return `<hr class="md-preview-hr" />`;
        case 'ul':
          return `<ul class="md-preview-ul">${(b.content as string[])
            .map((it) => `<li>${it}</li>`)
            .join('')}</ul>`;
        case 'ol':
          return `<ol class="md-preview-ol">${(b.content as string[])
            .map((it) => `<li>${it}</li>`)
            .join('')}</ol>`;
        case 'code': {
          const lang = b.lang ? ` data-lang="${escapeHtml(b.lang)}"` : '';
          return `<pre class="md-preview-pre"${lang}><code>${escapeHtml(
            b.content as string,
          )}</code></pre>`;
        }
        default:
          return '';
      }
    })
    .join('\n');
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const html = useMemo(() => {
    try {
      return renderBlocks(parseMarkdown(content));
    } catch {
      // fallback: mostra cru pra não quebrar a UI se algum regex panic.
      return `<pre class="md-preview-pre"><code>${escapeHtml(content)}</code></pre>`;
    }
  }, [content]);

  return (
    <div className="md-preview-root">
      <div
        className="md-preview-body"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
