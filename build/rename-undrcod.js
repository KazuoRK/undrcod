// Rename "UNDRCode" and "UNDRCod" -> "UNDRCOD" in src/ tree.
// Run: node build/rename-undrcod.js
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
  let count = 0;
  // Replace longer/more-specific first: "UNDRCode" then "UNDRCod"
  // Both map to "UNDRCOD". Lowercase "undrcod" stays untouched.
  let updated = original.replace(/UNDRCode/g, () => { count++; return 'UNDRCOD'; });
  updated = updated.replace(/UNDRCod(?![a-z])/g, () => { count++; return 'UNDRCOD'; });

  if (count > 0) {
    fs.writeFileSync(file, updated, 'utf8');
    filesTouched++;
    totalReplacements += count;
    perFile.push({ file: path.relative(path.resolve(__dirname, '..'), file), count });
  }
}

walk(ROOT);

perFile.sort((a, b) => b.count - a.count);
for (const { file, count } of perFile) {
  console.log(`  ${count.toString().padStart(4)}  ${file}`);
}
console.log('');
console.log(`Files touched: ${filesTouched}`);
console.log(`Total replacements: ${totalReplacements}`);
