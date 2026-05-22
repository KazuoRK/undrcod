/**
 * Prism.js setup — carrega core + linguagens que vamos suportar.
 * Importado uma vez no boot do app.
 */

import Prism from 'prismjs';

// Linguagens base (dependências de outras — carrega primeiro)
import 'prismjs/components/prism-markup'; // HTML/XML/SVG
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-css';

// Linguagens comuns
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-shell-session';

export { Prism };

/** Mapeia extensão de arquivo pra Prism language id */
export function prismLangFromExt(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    html: 'markup',
    htm: 'markup',
    xml: 'markup',
    svg: 'markup',
    css: 'css',
    scss: 'scss',
    sass: 'scss',
    less: 'css',
    json: 'json',
    jsonc: 'json',
    md: 'markdown',
    mdx: 'markdown',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    sql: 'sql',
    vue: 'markup',
    svelte: 'markup'
  };
  return map[ext] || 'text';
}

/**
 * Tenta highlight; se a linguagem não existir no Prism, retorna texto escapado.
 */
export function highlight(code: string, lang: string): string {
  if (!Prism.languages[lang]) {
    return escapeHtml(code);
  }
  try {
    return Prism.highlight(code, Prism.languages[lang], lang);
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Detecta o indent-size do arquivo via GCD de todas as indents.
 * XML 2-space (indents 2,4,6,8) → GCD=2.
 * HTML 4-space (indents 4,8,12) → GCD=4.
 * Tab é detectado se a primeira linha indentada começa com \t.
 * Retorna 2, 4, ou 1 (= tab). Default 4 quando não acha indent.
 */
export function detectIndentSize(code: string): number {
  let result = 0;
  for (const rawLine of code.split('\n')) {
    const line = rawLine.replace(/\r$/, ''); // strip CRLF
    if (line.startsWith('\t')) return 1;
    const m = line.match(/^( +)\S/);
    if (m) {
      const len = m[1].length;
      result = result === 0 ? len : gcd(result, len);
      if (result === 1) break; // can't get smaller
    }
  }
  if (result === 1 || result === 0) return result === 0 ? 4 : 1;
  // Clamp pra 2 ou 4 (valores comuns)
  return result <= 2 ? 2 : 4;
}

/**
 * Conta o nível de indent de cada linha (após normalize feito no FilePreview).
 * Sempre 4-char/nível. Math.ceil = match algoritmo Monaco/VS Code source.
 */
export function getLineIndents(code: string): number[] {
  return code.split('\n').map((line) => {
    let chars = 0;
    for (const c of line) {
      if (c === ' ') chars++;
      else if (c === '\t') chars += 4;
      else break;
    }
    return Math.ceil(chars / 4);
  });
}

/**
 * Wrappa cada linha do HTML highlighted em <span class="line">.
 * Lida com tokens multi-linha (block comments, template literals) fechando
 * e reabrindo spans nas quebras de linha pra HTML continuar válido.
 *
 * Pra cada linha com indent > 0, insere N <span class="indent-guide"></span>
 * no início (cada um ocupa 4ch via CSS) e remove os primeiros N*4 chars
 * de whitespace literal. Resultado: as guides são desenhadas via border-right
 * de DOM elements reais (1px sempre exato, sem subpixel issues do gradient).
 *
 * @param html HTML highlighted pelo Prism
 * @param indents array de indent levels por linha (de getLineIndents)
 */
export function wrapHighlightedLines(html: string, indents: number[] = []): string {
  const INDENT_CHARS_PER_LEVEL = 4;
  const result: string[] = [];
  const openTags: string[] = [];
  let buffer = '';
  let i = 0;
  let lineIdx = 0;
  let skipSpaces = 0; // contador de whitespace inicial a substituir por guides

  const closeAll = () => openTags.map(() => '</span>').join('');
  const reopenAll = () => openTags.join('');
  const openLine = (idx: number) => {
    const indent = indents[idx] ?? 0;
    skipSpaces = indent * INDENT_CHARS_PER_LEVEL;
    const guides = indent > 0
      ? '<span class="indent-guide"></span>'.repeat(indent)
      : '';
    return `<span class="line">${guides}`;
  };

  result.push(openLine(lineIdx));

  while (i < html.length) {
    const ch = html[i];

    if (ch === '<') {
      const tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) {
        buffer += html.slice(i);
        break;
      }
      const tag = html.slice(i, tagEnd + 1);

      if (tag.startsWith('</')) {
        openTags.pop();
      } else if (!tag.endsWith('/>')) {
        openTags.push(tag);
      }

      buffer += tag;
      i = tagEnd + 1;
      skipSpaces = 0; // entrou em tag = conteúdo começou, não skippa mais
    } else if (ch === '\n') {
      // Flush + open new line
      result.push(buffer || '​');
      result.push(closeAll());
      lineIdx++;
      result.push('</span>' + openLine(lineIdx));
      result.push(reopenAll());
      buffer = '';
      i++;
    } else if (ch === ' ' && skipSpaces > 0) {
      // skippa espaço inicial (foi substituído por guide span)
      skipSpaces--;
      i++;
    } else {
      buffer += ch;
      i++;
      skipSpaces = 0; // primeiro char não-space = fim do indent area
    }
  }

  result.push(buffer || ' ');
  result.push(closeAll());
  result.push('</span>');

  return result.join('');
}
