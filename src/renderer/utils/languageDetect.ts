/**
 * Mapeia path/extensão de arquivo pra monaco language id.
 * Defaults pra 'plaintext' quando não reconhece.
 *
 * Monaco aceita só ids registrados — manter sincronizado com
 * https://github.com/microsoft/monaco-editor/tree/main/src/basic-languages
 */

const EXT_MAP: Record<string, string> = {
  // TS / JS
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',

  // Web
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  svg: 'xml',
  xml: 'xml',
  vue: 'html',

  // Data / config
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',

  // Markup / docs
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',

  // Backend langs
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  lua: 'lua',
  pl: 'perl',
  r: 'r',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  clj: 'clojure',
  dart: 'dart',
  hs: 'haskell',

  // Shell
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  bat: 'bat',
  cmd: 'bat',

  // SQL / queries
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',

  // Misc
  dockerfile: 'dockerfile',
  proto: 'proto',
  diff: 'diff',
  patch: 'diff',
};

/**
 * Casos especiais — match por filename completo (sem extensão).
 */
const FILENAME_MAP: Record<string, string> = {
  dockerfile: 'dockerfile',
  'dockerfile.dev': 'dockerfile',
  'dockerfile.prod': 'dockerfile',
  makefile: 'shell',
  'cmakelists.txt': 'cmake',
  rakefile: 'ruby',
  gemfile: 'ruby',
  'package.json': 'json',
  'tsconfig.json': 'json',
  '.gitignore': 'plaintext',
  '.dockerignore': 'plaintext',
  '.npmrc': 'ini',
  '.editorconfig': 'ini',
};

export function detectLanguage(filePath: string): string {
  if (!filePath) return 'plaintext';

  // Pega só o basename — tira diretório separadores tanto unix quanto win
  const basename = filePath.split(/[\\/]/).pop() || filePath;
  const lower = basename.toLowerCase();

  // 1) Match exato no filename
  if (FILENAME_MAP[lower]) return FILENAME_MAP[lower];

  // 2) Match por extensão (último ponto)
  const dot = lower.lastIndexOf('.');
  if (dot >= 0 && dot < lower.length - 1) {
    const ext = lower.slice(dot + 1);
    if (EXT_MAP[ext]) return EXT_MAP[ext];
  }

  // 3) Match "Dockerfile" com sufixo (Dockerfile.alpine, etc)
  if (lower.startsWith('dockerfile')) return 'dockerfile';

  return 'plaintext';
}
