// Rename all "akai" occurrences to "undrcod" in src/ tree (case-preserving).
// Run: node build/rename-akai.js
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'src');
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.md', '.json']);
const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', '.git']);

let filesTouched = 0;
let totalReplacements = 0;
const perFile = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!EXTS.has(ext)) continue;
      processFile(full);
    }
  }
}

function processFile(file) {
  const original = fs.readFileSync(file, 'utf8');
  // Order matters: UPPER first, then Pascal, then lower.
  // Use case-sensitive regex with global flag.
  let count = 0;
  let updated = original.replace(/AKAI/g, () => { count++; return 'UNDRCOD'; });
  updated = updated.replace(/Akai/g, () => { count++; return 'UNDRCod'; });
  updated = updated.replace(/akai/g, () => { count++; return 'undrcod'; });

  if (count > 0) {
    fs.writeFileSync(file, updated, 'utf8');
    filesTouched++;
    totalReplacements += count;
    perFile.push({ file: path.relative(path.resolve(__dirname, '..'), file), count });
  }
}

walk(ROOT);

// Sort by count desc for nicer log
perFile.sort((a, b) => b.count - a.count);
for (const { file, count } of perFile) {
  console.log(`  ${count.toString().padStart(4)}  ${file}`);
}
console.log('');
console.log(`Files touched: ${filesTouched}`);
console.log(`Total replacements: ${totalReplacements}`);
