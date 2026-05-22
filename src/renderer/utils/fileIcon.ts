/**
 * Mapeia nome de arquivo/pasta → ícone codicon + cor por tipo.
 * Inspirado em vscode-icons / material-icon-theme, mas usando codicons que já temos.
 */

export interface FileIconInfo {
  icon: string;  // nome da classe codicon (sem prefixo)
  color?: string; // CSS color
}

/* Cores tematicamente associadas a cada linguagem/categoria */
const COLOR = {
  ts: '#3178c6',        // TypeScript blue
  js: '#f7df1e',        // JS yellow
  py: '#3776ab',        // Python blue
  rs: '#dea584',        // Rust orange
  go: '#00add8',        // Go cyan
  html: '#e34c26',      // HTML orange
  css: '#cf649a',       // CSS pink
  json: '#cbcb41',      // JSON yellow-olive
  md: '#519aba',        // Markdown blue
  yaml: '#cb171e',      // YAML red
  config: '#6d8086',    // Config gray-blue
  shell: '#4eaa25',     // Shell green
  image: '#a074c4',     // Image purple
  audio: '#fac3a0',     // Audio peach
  video: '#fc6e2e',     // Video orange
  archive: '#aa6e2c',   // Archive brown
  pdf: '#ed3132',       // PDF red
  font: '#cb9b48',      // Font tan
  git: '#f14e32',       // Git orange-red
  env: '#fed032',       // Env yellow
  lock: '#8c8c8c',      // Lock gray
  data: '#73c0c4',      // DB/data teal
  test: '#cd9178',      // Test tan
  doc: '#519aba',       // Doc blue
};

/** Mapeia extensão → ícone + cor */
const BY_EXT: Record<string, FileIconInfo> = {
  // TypeScript / JavaScript
  ts: { icon: 'symbol-class', color: COLOR.ts },
  tsx: { icon: 'symbol-class', color: COLOR.ts },
  js: { icon: 'symbol-method', color: COLOR.js },
  jsx: { icon: 'symbol-method', color: COLOR.js },
  mjs: { icon: 'symbol-method', color: COLOR.js },
  cjs: { icon: 'symbol-method', color: COLOR.js },

  // Python
  py: { icon: 'symbol-namespace', color: COLOR.py },
  pyi: { icon: 'symbol-namespace', color: COLOR.py },

  // Rust / Go
  rs: { icon: 'symbol-namespace', color: COLOR.rs },
  go: { icon: 'symbol-namespace', color: COLOR.go },

  // Web
  html: { icon: 'symbol-property', color: COLOR.html },
  htm: { icon: 'symbol-property', color: COLOR.html },
  css: { icon: 'symbol-color', color: COLOR.css },
  scss: { icon: 'symbol-color', color: COLOR.css },
  sass: { icon: 'symbol-color', color: COLOR.css },
  less: { icon: 'symbol-color', color: COLOR.css },
  vue: { icon: 'symbol-class', color: '#41b883' },
  svelte: { icon: 'symbol-class', color: '#ff3e00' },

  // Data
  json: { icon: 'json', color: COLOR.json },
  jsonc: { icon: 'json', color: COLOR.json },
  yml: { icon: 'settings', color: COLOR.yaml },
  yaml: { icon: 'settings', color: COLOR.yaml },
  toml: { icon: 'settings', color: COLOR.config },
  xml: { icon: 'code', color: COLOR.config },
  csv: { icon: 'graph', color: COLOR.data },
  tsv: { icon: 'graph', color: COLOR.data },
  sql: { icon: 'database', color: COLOR.data },
  db: { icon: 'database', color: COLOR.data },
  sqlite: { icon: 'database', color: COLOR.data },

  // Markdown / Docs
  md: { icon: 'markdown', color: COLOR.md },
  mdx: { icon: 'markdown', color: COLOR.md },
  txt: { icon: 'file-text', color: COLOR.doc },
  rtf: { icon: 'file-text', color: COLOR.doc },
  pdf: { icon: 'file-pdf', color: COLOR.pdf },
  doc: { icon: 'file-text', color: COLOR.doc },
  docx: { icon: 'file-text', color: COLOR.doc },

  // Shell / Config
  sh: { icon: 'terminal', color: COLOR.shell },
  bash: { icon: 'terminal', color: COLOR.shell },
  zsh: { icon: 'terminal', color: COLOR.shell },
  ps1: { icon: 'terminal', color: '#012456' },
  bat: { icon: 'terminal', color: COLOR.shell },
  cmd: { icon: 'terminal', color: COLOR.shell },

  // Imagens
  png: { icon: 'file-media', color: COLOR.image },
  jpg: { icon: 'file-media', color: COLOR.image },
  jpeg: { icon: 'file-media', color: COLOR.image },
  gif: { icon: 'file-media', color: COLOR.image },
  webp: { icon: 'file-media', color: COLOR.image },
  bmp: { icon: 'file-media', color: COLOR.image },
  ico: { icon: 'file-media', color: COLOR.image },
  svg: { icon: 'file-media', color: '#ffb13b' },

  // Audio / Vídeo
  mp3: { icon: 'file-media', color: COLOR.audio },
  wav: { icon: 'file-media', color: COLOR.audio },
  flac: { icon: 'file-media', color: COLOR.audio },
  ogg: { icon: 'file-media', color: COLOR.audio },
  mp4: { icon: 'file-media', color: COLOR.video },
  webm: { icon: 'file-media', color: COLOR.video },
  mov: { icon: 'file-media', color: COLOR.video },
  avi: { icon: 'file-media', color: COLOR.video },
  mkv: { icon: 'file-media', color: COLOR.video },

  // Arquivos compactados
  zip: { icon: 'file-zip', color: COLOR.archive },
  tar: { icon: 'file-zip', color: COLOR.archive },
  gz: { icon: 'file-zip', color: COLOR.archive },
  '7z': { icon: 'file-zip', color: COLOR.archive },
  rar: { icon: 'file-zip', color: COLOR.archive },

  // Fontes
  ttf: { icon: 'symbol-text', color: COLOR.font },
  otf: { icon: 'symbol-text', color: COLOR.font },
  woff: { icon: 'symbol-text', color: COLOR.font },
  woff2: { icon: 'symbol-text', color: COLOR.font },

  // Outros
  exe: { icon: 'gear', color: '#5c5c5c' },
  dll: { icon: 'gear', color: '#5c5c5c' },
  log: { icon: 'output', color: '#888' },

  // Affinity (UNDRCOD use case)
  afdesign: { icon: 'symbol-color', color: '#3a4ca6' },
  afphoto: { icon: 'symbol-color', color: '#7a3a4f' },
  afpub: { icon: 'symbol-color', color: '#a7763f' }
};

/** Filenames especiais (sem usar extensão) */
const BY_NAME: Record<string, FileIconInfo> = {
  '.gitignore': { icon: 'diff-ignored', color: COLOR.git },
  '.gitattributes': { icon: 'git-commit', color: COLOR.git },
  '.gitmodules': { icon: 'git-commit', color: COLOR.git },
  '.env': { icon: 'key', color: COLOR.env },
  '.env.local': { icon: 'key', color: COLOR.env },
  '.env.production': { icon: 'key', color: COLOR.env },
  '.env.development': { icon: 'key', color: COLOR.env },
  'package.json': { icon: 'package', color: '#cb3837' },
  'package-lock.json': { icon: 'lock', color: COLOR.lock },
  'pnpm-lock.yaml': { icon: 'lock', color: COLOR.lock },
  'yarn.lock': { icon: 'lock', color: COLOR.lock },
  'bun.lock': { icon: 'lock', color: COLOR.lock },
  'cargo.toml': { icon: 'package', color: COLOR.rs },
  'cargo.lock': { icon: 'lock', color: COLOR.lock },
  'dockerfile': { icon: 'cloud', color: '#0db7ed' },
  'docker-compose.yml': { icon: 'cloud', color: '#0db7ed' },
  'docker-compose.yaml': { icon: 'cloud', color: '#0db7ed' },
  'makefile': { icon: 'tools', color: '#888' },
  'license': { icon: 'law', color: '#888' },
  'license.txt': { icon: 'law', color: '#888' },
  'license.md': { icon: 'law', color: '#888' },
  'readme.md': { icon: 'book', color: COLOR.md },
  'readme': { icon: 'book', color: COLOR.md },
  'changelog.md': { icon: 'history', color: COLOR.md },
  'tsconfig.json': { icon: 'settings-gear', color: COLOR.ts },
  '.eslintrc': { icon: 'settings-gear', color: '#4b32c3' },
  '.prettierrc': { icon: 'settings-gear', color: '#1a2b34' },
  '.editorconfig': { icon: 'settings-gear', color: COLOR.config },
  'vite.config.ts': { icon: 'settings-gear', color: '#646cff' },
  'vite.config.js': { icon: 'settings-gear', color: '#646cff' },
  'webpack.config.js': { icon: 'settings-gear', color: '#1c78c0' },
  'next.config.js': { icon: 'settings-gear', color: '#000' },
  'tailwind.config.js': { icon: 'settings-gear', color: '#38bdf8' }
};

/**
 * Pastas SYSTEM (geralmente hidden/dot) — usam ícone próprio em vez de folder.
 * Pastas normais sempre usam codicon-folder/folder-opened (só cor muda).
 */
const SYSTEM_FOLDERS: Record<string, FileIconInfo> = {
  '.git': { icon: 'git-branch', color: COLOR.git },
  '.github': { icon: 'github-inverted', color: '#f0f6fc' },
  '.vscode': { icon: 'settings-gear', color: '#007acc' },
  '.claude': { icon: 'sparkle', color: '#e87a3e' },
  'node_modules': { icon: 'package', color: '#cb3837' }
};

/**
 * Cor de pastas conhecidas — usa folder/folder-opened normal,
 * só muda a cor pra dar pista visual.
 */
const FOLDER_COLORS: Record<string, string> = {
  src: '#7eb6ff',
  dist: '#7a7a7a',
  build: '#7a7a7a',
  out: '#7a7a7a',
  docs: COLOR.md,
  tests: COLOR.test,
  test: COLOR.test,
  '__tests__': COLOR.test,
  public: '#888',
  assets: COLOR.image,
  components: '#7eb6ff',
  pages: '#7eb6ff',
  styles: COLOR.css,
  utils: '#a0a0a0',
  hooks: '#a0a0a0',
  lib: '#a0a0a0',
  config: COLOR.config
};

export function getFileIcon(filename: string, isDirectory = false): FileIconInfo {
  const lower = filename.toLowerCase();

  if (isDirectory) {
    return getFolderIcon(lower, false);
  }

  // Filenames especiais (package.json, .gitignore, etc.)
  if (BY_NAME[lower]) return BY_NAME[lower];

  // Caso .env.something — match prefix
  if (lower.startsWith('.env')) return BY_NAME['.env'];

  // Por extensão
  const match = lower.match(/\.([^.]+)$/);
  if (match) {
    const ext = match[1];
    if (BY_EXT[ext]) return BY_EXT[ext];
  }

  // Default
  return { icon: 'file', color: undefined };
}

const DEFAULT_FOLDER_COLOR = '#dcb67a';

export function getFolderIcon(folderName: string, expanded: boolean): FileIconInfo {
  const lower = folderName.toLowerCase();

  // System folders (.git, .vscode, etc) têm ícone próprio
  if (SYSTEM_FOLDERS[lower]) {
    return SYSTEM_FOLDERS[lower];
  }

  // Pasta normal: sempre folder/folder-opened, só cor muda
  const color = FOLDER_COLORS[lower] || DEFAULT_FOLDER_COLOR;
  return {
    icon: expanded ? 'folder-opened' : 'folder',
    color
  };
}
