/**
 * Quick test: capture raw stream-json output to understand the format.
 */
import { spawn } from 'child_process';

const CLAUDE = String.raw`C:\Users\taked\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`;

// Test 1: one-shot with --verbose
console.log('=== TEST 1: One-shot raw output ===');
await new Promise((resolve) => {
  const proc = spawn(CLAUDE, [
    '-p', 'say just "hello"',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', 'haiku',
    '--no-session-persistence',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  let lineNum = 0;
  let buf = '';
  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      lineNum++;
      try {
        const parsed = JSON.parse(line);
        console.log(`  line ${lineNum}: type=${parsed.type} subtype=${parsed.subtype || '-'} keys=${Object.keys(parsed).join(',')}`);
        if (lineNum <= 8) {
          // Print full for first 8 lines
          console.log(`    FULL: ${line.slice(0, 500)}`);
        }
      } catch {
        console.log(`  line ${lineNum}: UNPARSEABLE: ${line.slice(0, 200)}`);
      }
    }
  });

  proc.stderr.on('data', (chunk) => {
    const t = chunk.toString().trim();
    if (t) console.log(`  [stderr] ${t.slice(0, 200)}`);
  });

  proc.on('exit', (code) => {
    console.log(`  Process exited with code ${code}, ${lineNum} lines total`);
    resolve();
  });

  setTimeout(() => { proc.kill(); resolve(); }, 20000);
});

// Test 2: persistent daemon init
console.log('\n=== TEST 2: Daemon init messages ===');
await new Promise((resolve) => {
  const proc = spawn(CLAUDE, [
    '--print',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', 'haiku',
    '--no-session-persistence',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  let lineNum = 0;
  let buf = '';
  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      lineNum++;
      try {
        const parsed = JSON.parse(line);
        console.log(`  line ${lineNum}: type=${parsed.type} subtype=${parsed.subtype || '-'} keys=${Object.keys(parsed).join(',')}`);
        console.log(`    FULL: ${line.slice(0, 600)}`);
      } catch {
        console.log(`  line ${lineNum}: UNPARSEABLE: ${line.slice(0, 200)}`);
      }
      if (lineNum >= 5) {
        // After seeing init, send a test message
        const msg = JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'say just "hello"' },
        }) + '\n';
        console.log(`  >> Sending user message...`);
        proc.stdin.write(msg);
      }
      if (lineNum >= 20) {
        console.log('  (enough lines, stopping)');
        proc.kill();
        resolve();
      }
    }
  });

  proc.stderr.on('data', (chunk) => {
    const t = chunk.toString().trim();
    if (t) console.log(`  [stderr] ${t.slice(0, 300)}`);
  });

  proc.on('exit', (code) => {
    console.log(`  Daemon exited with code ${code}, ${lineNum} lines`);
    resolve();
  });

  setTimeout(() => {
    console.log('  (timeout 25s, killing)');
    proc.kill();
    resolve();
  }, 25000);
});
