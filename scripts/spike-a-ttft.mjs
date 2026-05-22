/**
 * Spike A — TTFT Benchmark + Spike B set_model + Spike C token consumption
 *
 * Mede Time-To-First-Token pra inline completions via CLI.
 * Testa 2 modos:
 *   1. One-shot (-p --verbose): spawn novo processo pra cada prompt
 *   2. Persistent daemon (--input-format stream-json): spawn 1x, múltiplos prompts
 *
 * Usage: node scripts/spike-a-ttft.mjs
 */

import { spawn } from 'child_process';
import { performance } from 'perf_hooks';
import { randomUUID } from 'crypto';

const CLAUDE_EXE = String.raw`C:\Users\taked\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`;
const RUNS_PER_SIZE = 5;

// ── Context generators ──────────────────────────────────────────────

function generatePrefix(lines) {
  const code = [];
  code.push('import React, { useState, useEffect, useCallback, useMemo } from "react";');
  code.push('import { useRouter } from "next/navigation";');
  code.push('');
  code.push('interface User { id: string; name: string; email: string; role: "admin" | "user"; }');
  code.push('interface ApiResponse<T> { data: T; status: number; error?: string; }');
  code.push('');
  code.push('const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";');
  code.push('');
  code.push('async function fetchUsers(): Promise<ApiResponse<User[]>> {');
  code.push('  const res = await fetch(`${API_BASE}/api/users`);');
  code.push('  if (!res.ok) throw new Error(`HTTP ${res.status}`);');
  code.push('  return res.json();');
  code.push('}');
  code.push('');
  code.push('export function UserList() {');
  code.push('  const [users, setUsers] = useState<User[]>([]);');
  code.push('  const [loading, setLoading] = useState(true);');
  code.push('  const [error, setError] = useState<string | null>(null);');
  code.push('  const [search, setSearch] = useState("");');
  code.push('  const router = useRouter();');
  code.push('');
  code.push('  useEffect(() => {');
  code.push('    fetchUsers()');
  code.push('      .then(r => { setUsers(r.data); setLoading(false); })');
  code.push('      .catch(e => { setError(e.message); setLoading(false); });');
  code.push('  }, []);');
  code.push('');
  code.push('  const filtered = useMemo(');
  code.push('    () => users.filter(u => u.name.toLowerCase().includes(search.toLowerCase())),');
  code.push('    [users, search]');
  code.push('  );');
  code.push('');
  code.push('  const handleDelete = useCallback(async (id: string) => {');
  code.push('    try {');
  code.push('      await fetch(`${API_BASE}/api/users/${id}`, { method: "DELETE" });');
  code.push('      setUsers(prev => prev.filter(u => u.id !== id));');
  code.push('    } catch (e) {');
  code.push('      setError("Failed to delete user");');
  code.push('    }');
  code.push('  }, []);');
  code.push('');
  while (code.length < lines) {
    const i = code.length;
    code.push(`  // TODO: implement feature ${i}`);
  }
  return code.slice(0, lines).join('\n');
}

function generateSuffix(lines) {
  const code = [];
  code.push('  return (');
  code.push('    <div className="user-list">');
  code.push('      <input value={search} onChange={e => setSearch(e.target.value)} />');
  code.push('      {loading && <Spinner />}');
  code.push('      {error && <Alert variant="error">{error}</Alert>}');
  code.push('      {filtered.map(user => (');
  code.push('        <UserCard key={user.id} user={user} onDelete={handleDelete} />');
  code.push('      ))}');
  code.push('    </div>');
  code.push('  );');
  code.push('}');
  while (code.length < lines) code.push(`// line ${code.length}`);
  return code.slice(0, lines).join('\n');
}

function buildCompletionPrompt(prefixLines, suffixLines) {
  const prefix = generatePrefix(prefixLines);
  const suffix = suffixLines > 0 ? generateSuffix(suffixLines) : '';
  let prompt = `Complete the code at <CURSOR>. Return ONLY the code to insert. No markdown, no explanation. Max 2 lines.\n\n`;
  prompt += prefix + '\n<CURSOR>\n';
  if (suffix) prompt += suffix;
  return prompt;
}

const SIZES = [
  { name: 'small',  prefixLines: 10,  suffixLines: 0 },
  { name: 'medium', prefixLines: 50,  suffixLines: 20 },
  { name: 'large',  prefixLines: 100, suffixLines: 50 },
];

// ── Mode 1: One-shot ────────────────────────────────────────────────

function runOneShot(prompt) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let firstTokenTime = null;
    let buf = '';
    let outputText = '';
    let usage = {};

    const proc = spawn(CLAUDE_EXE, [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--model', 'haiku',
      '--no-session-persistence',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    // Close stdin immediately so the 3s warning doesn't fire
    proc.stdin.end();

    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);

          // Detect first assistant content token
          if (!firstTokenTime && msg.type === 'assistant') {
            const content = msg.message?.content;
            if (Array.isArray(content) && content.length > 0) {
              firstTokenTime = performance.now() - t0;
            } else if (typeof content === 'string' && content.length > 0) {
              firstTokenTime = performance.now() - t0;
            }
          }

          // Also check stream_event for content_block_delta (streaming tokens)
          if (!firstTokenTime && msg.type === 'content_block_delta') {
            firstTokenTime = performance.now() - t0;
          }

          // Result with usage
          if (msg.type === 'result') {
            const totalTime = performance.now() - t0;
            usage = msg.usage || {};
            resolve({
              firstTokenMs: firstTokenTime ? Math.round(firstTokenTime) : null,
              totalMs: Math.round(totalTime),
              inputTokens: usage.input_tokens ?? msg.total_input_tokens ?? '?',
              outputTokens: usage.output_tokens ?? msg.total_output_tokens ?? '?',
              cacheRead: usage.cache_read_input_tokens ?? 0,
              cacheCreate: usage.cache_creation_input_tokens ?? 0,
              isError: msg.is_error || false,
              errorStatus: msg.api_error_status,
            });
            return;
          }
        } catch {}
      }
    });

    proc.on('exit', () => {
      resolve({
        firstTokenMs: firstTokenTime ? Math.round(firstTokenTime) : null,
        totalMs: Math.round(performance.now() - t0),
        inputTokens: '?', outputTokens: '?',
        exitedWithoutResult: true,
      });
    });

    setTimeout(() => { proc.kill(); resolve({ firstTokenMs: null, totalMs: 30000, timeout: true }); }, 30000);
  });
}

// ── Mode 2: Persistent daemon ───────────────────────────────────────

class PersistentDaemon {
  constructor() {
    this.proc = null;
    this.buf = '';
    this.listeners = [];
    this.ready = false;
    this.initData = null;
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.proc = spawn(CLAUDE_EXE, [
        '--print',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--verbose',
        '--model', 'haiku',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      this.proc.stdout.on('data', (chunk) => {
        this.buf += chunk.toString();
        this._drain();
      });

      this.proc.stderr.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text) console.error('  [daemon stderr]', text.slice(0, 200));
      });

      this.proc.on('exit', (code) => {
        console.log(`  [daemon] process exited with code ${code}`);
      });

      const initTimeout = setTimeout(() => reject(new Error('daemon init timeout (30s)')), 30000);

      this.listeners.push((msg) => {
        if (msg.type === 'system' && msg.subtype === 'init') {
          clearTimeout(initTimeout);
          this.ready = true;
          this.initData = msg;
          resolve();
          return true;
        }
        return false;
      });
    });
  }

  _drain() {
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const remaining = [];
        for (const fn of this.listeners) {
          if (!fn(msg)) remaining.push(fn);
        }
        this.listeners = remaining;
      } catch {}
    }
  }

  sendCompletion(prompt) {
    return new Promise((resolve) => {
      const uuid = randomUUID();
      const t0 = performance.now();
      let firstTokenTime = null;
      let resolved = false;

      const handler = (msg) => {
        if (resolved) return false;

        // First assistant content
        if (!firstTokenTime && msg.type === 'assistant') {
          const content = msg.message?.content;
          if ((Array.isArray(content) && content.length > 0) ||
              (typeof content === 'string' && content.length > 0)) {
            firstTokenTime = performance.now() - t0;
          }
        }

        if (msg.type === 'result') {
          resolved = true;
          const totalTime = performance.now() - t0;
          const usage = msg.usage || {};
          resolve({
            firstTokenMs: firstTokenTime ? Math.round(firstTokenTime) : null,
            totalMs: Math.round(totalTime),
            inputTokens: usage.input_tokens ?? '?',
            outputTokens: usage.output_tokens ?? '?',
            cacheRead: usage.cache_read_input_tokens ?? 0,
            cacheCreate: usage.cache_creation_input_tokens ?? 0,
            isError: msg.is_error || false,
          });
          return true;
        }
        return false;
      };

      this.listeners.push(handler);

      const userMsg = JSON.stringify({
        type: 'user',
        uuid,
        message: { role: 'user', content: prompt },
      }) + '\n';

      this.proc.stdin.write(userMsg);

      setTimeout(() => {
        if (!resolved) { resolved = true; resolve({ firstTokenMs: null, totalMs: 30000, timeout: true }); }
      }, 30000);
    });
  }

  sendControlRequest(subtype, fields = {}) {
    return new Promise((resolve) => {
      const reqId = `req_${subtype}_${Date.now()}`;
      let resolved = false;

      this.listeners.push((msg) => {
        if (resolved) return false;
        if (msg.type === 'control_response') {
          // Match by request_id in the response payload
          const resp = msg.response || msg;
          if (resp.request_id === reqId) {
            resolved = true;
            resolve({ success: true, response: msg });
            return true;
          }
        }
        return false;
      });

      const controlMsg = JSON.stringify({
        type: 'control_request',
        request_id: reqId,
        request: { subtype, ...fields },
      }) + '\n';

      this.proc.stdin.write(controlMsg);

      setTimeout(() => {
        if (!resolved) { resolved = true; resolve({ success: false, error: `timeout — no response to ${subtype}` }); }
      }, 10000);
    });
  }

  kill() {
    if (this.proc) { this.proc.kill(); this.proc = null; }
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Spike A: TTFT Benchmark                                    ║');
  console.log('║  Spike B: set_model / set_max_thinking_tokens               ║');
  console.log('║  Spike C: Token consumption per completion                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`Runs per size: ${RUNS_PER_SIZE}`);
  console.log('');

  // ══════════════════════════════════════════════════════════════════
  // Phase 1: One-shot
  // ══════════════════════════════════════════════════════════════════
  console.log('━━━ Phase 1: One-shot (spawn per request) with Haiku ━━━');
  const oneShotResults = {};
  const allTokenUsage = [];

  for (const size of SIZES) {
    const prompt = buildCompletionPrompt(size.prefixLines, size.suffixLines);
    const charCount = prompt.length;
    console.log(`\n  [${size.name}] ${charCount} chars, ${RUNS_PER_SIZE} runs:`);
    const results = [];

    for (let i = 0; i < RUNS_PER_SIZE; i++) {
      const r = await runOneShot(prompt);
      results.push(r);
      allTokenUsage.push(r);
      const status = r.isError ? ` ERROR(${r.errorStatus})` : '';
      console.log(`    #${i+1}: TTFT=${pad(r.firstTokenMs)}ms  total=${pad(r.totalMs)}ms  in=${r.inputTokens} out=${r.outputTokens} cache_r=${r.cacheRead} cache_w=${r.cacheCreate}${status}`);
    }

    const ttfts = results.filter(r => r.firstTokenMs && !r.isError).map(r => r.firstTokenMs);
    const totals = results.filter(r => !r.isError).map(r => r.totalMs);
    oneShotResults[size.name] = {
      ttftMedian: median(ttfts),
      ttftP90: percentile(ttfts, 90),
      ttftMin: Math.min(...(ttfts.length ? ttfts : [0])),
      ttftMax: Math.max(...(ttfts.length ? ttfts : [0])),
      totalMedian: median(totals),
      errors: results.filter(r => r.isError).length,
      samples: ttfts.length,
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // Phase 2: Persistent daemon
  // ══════════════════════════════════════════════════════════════════
  console.log('\n\n━━━ Phase 2: Persistent daemon with Haiku ━━━');
  console.log('  Starting daemon...');

  const daemon = new PersistentDaemon();
  let daemonResults = {};
  let setModelResult = null;
  let setThinkingResult = null;
  let daemonSpawnTime = null;

  try {
    const t0 = performance.now();
    await daemon.start();
    daemonSpawnTime = Math.round(performance.now() - t0);
    console.log(`  Daemon ready in ${daemonSpawnTime}ms`);
    console.log(`  Init model: ${daemon.initData?.model}`);
    console.log(`  Session: ${daemon.initData?.session_id}`);
    console.log('');

    for (const size of SIZES) {
      const prompt = buildCompletionPrompt(size.prefixLines, size.suffixLines);
      console.log(`  [${size.name}] ${RUNS_PER_SIZE} runs:`);
      const results = [];

      for (let i = 0; i < RUNS_PER_SIZE; i++) {
        const r = await daemon.sendCompletion(prompt);
        results.push(r);
        allTokenUsage.push(r);
        const status = r.isError ? ' ERROR' : '';
        console.log(`    #${i+1}: TTFT=${pad(r.firstTokenMs)}ms  total=${pad(r.totalMs)}ms  in=${r.inputTokens} out=${r.outputTokens} cache_r=${r.cacheRead} cache_w=${r.cacheCreate}${status}`);
        // Small gap between runs to avoid message merging
        await sleep(300);
      }

      const ttfts = results.filter(r => r.firstTokenMs && !r.isError).map(r => r.firstTokenMs);
      const totals = results.filter(r => !r.isError).map(r => r.totalMs);
      daemonResults[size.name] = {
        ttftMedian: median(ttfts),
        ttftP90: percentile(ttfts, 90),
        ttftMin: Math.min(...(ttfts.length ? ttfts : [0])),
        ttftMax: Math.max(...(ttfts.length ? ttfts : [0])),
        totalMedian: median(totals),
        errors: results.filter(r => r.isError).length,
        samples: ttfts.length,
      };
    }

    // ══════════════════════════════════════════════════════════════════
    // Spike B: set_model
    // ══════════════════════════════════════════════════════════════════
    console.log('\n\n━━━ Spike B: Control requests ━━━');

    console.log('  Testing set_model → sonnet...');
    setModelResult = await daemon.sendControlRequest('set_model', { model: 'sonnet' });
    console.log(`    Result: ${setModelResult.success ? '✅' : '❌'} ${JSON.stringify(setModelResult).slice(0, 200)}`);

    if (setModelResult.success) {
      // Verify by sending a prompt and checking result
      console.log('  Verifying with a prompt after set_model...');
      const verifyR = await daemon.sendCompletion('say "model check"');
      console.log(`    Response: TTFT=${verifyR.firstTokenMs}ms total=${verifyR.totalMs}ms error=${verifyR.isError}`);

      // Switch back to haiku
      console.log('  Switching back to haiku...');
      const backResult = await daemon.sendControlRequest('set_model', { model: 'haiku' });
      console.log(`    Result: ${backResult.success ? '✅' : '❌'}`);
    }

    console.log('\n  Testing set_max_thinking_tokens → 0...');
    setThinkingResult = await daemon.sendControlRequest('set_max_thinking_tokens', { max_thinking_tokens: 0 });
    console.log(`    Result: ${setThinkingResult.success ? '✅' : '❌'} ${JSON.stringify(setThinkingResult).slice(0, 200)}`);

    console.log('\n  Testing interrupt (no active turn)...');
    const interruptResult = await daemon.sendControlRequest('interrupt');
    console.log(`    Result: ${interruptResult.success ? '✅' : '❌'} ${JSON.stringify(interruptResult).slice(0, 200)}`);

  } catch (e) {
    console.error('  DAEMON ERROR:', e.message);
  } finally {
    daemon.kill();
  }

  // ══════════════════════════════════════════════════════════════════
  // Spike C: Token consumption projection
  // ══════════════════════════════════════════════════════════════════
  console.log('\n\n━━━ Spike C: Token consumption projection ━━━');

  const validUsage = allTokenUsage.filter(r => typeof r.inputTokens === 'number' && !r.isError);
  if (validUsage.length > 0) {
    const avgInput = Math.round(validUsage.reduce((s, r) => s + r.inputTokens, 0) / validUsage.length);
    const avgOutput = Math.round(validUsage.reduce((s, r) => s + r.outputTokens, 0) / validUsage.length);
    const avgCacheRead = Math.round(validUsage.reduce((s, r) => s + (r.cacheRead || 0), 0) / validUsage.length);
    const avgCacheCreate = Math.round(validUsage.reduce((s, r) => s + (r.cacheCreate || 0), 0) / validUsage.length);
    const avgTotal = avgInput + avgOutput;

    console.log(`  Average per completion:`);
    console.log(`    Input tokens:  ${avgInput}`);
    console.log(`    Output tokens: ${avgOutput}`);
    console.log(`    Cache read:    ${avgCacheRead}`);
    console.log(`    Cache create:  ${avgCacheCreate}`);
    console.log(`    Total:         ${avgTotal}`);
    console.log('');

    // Projection scenarios
    const scenarios = [
      { name: 'Conservative (200/day)', completions: 200 },
      { name: 'Moderate (500/day)',     completions: 500 },
      { name: 'Aggressive (950/day)',   completions: 950 },
      { name: 'Heavy (1900/day)',       completions: 1900 },
    ];

    console.log('  Daily projections:');
    console.log('  ┌──────────────────────────┬───────────┬───────────┬──────────────┐');
    console.log('  │ Scenario                 │ Input tok │ Output tok│ Total tokens │');
    console.log('  ├──────────────────────────┼───────────┼───────────┼──────────────┤');
    for (const s of scenarios) {
      const inp = (avgInput * s.completions / 1000).toFixed(0) + 'K';
      const out = (avgOutput * s.completions / 1000).toFixed(0) + 'K';
      const tot = (avgTotal * s.completions / 1000).toFixed(0) + 'K';
      console.log(`  │ ${s.name.padEnd(24)} │ ${inp.padStart(9)} │ ${out.padStart(9)} │ ${tot.padStart(12)} │`);
    }
    console.log('  └──────────────────────────┴───────────┴───────────┴──────────────┘');
    console.log('');
    console.log('  Note: Max plan rate limit is per-window (5h rolling), not daily.');
    console.log('  At aggressive (950/day, ~120/hour), each completion uses ~' + avgTotal + ' tokens.');
    console.log('  120 completions/hour × ' + avgTotal + ' tokens = ' + (120 * avgTotal / 1000).toFixed(0) + 'K tokens/hour for completions alone.');
  } else {
    console.log('  ⚠️  No valid token usage data (all errors or missing data)');
    console.log('  Cannot project consumption. Re-run after fixing auth.');
  }

  // ══════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                         FINAL RESULTS                                ║');
  console.log('╠══════════════════════════════════════════════════════════════════════╣');

  console.log('║                                                                      ║');
  console.log('║  ONE-SHOT (spawn per request):                                       ║');
  for (const [name, r] of Object.entries(oneShotResults)) {
    console.log(`║    ${name.padEnd(8)} TTFT median=${pad(r.ttftMedian)}  p90=${pad(r.ttftP90)}  range=[${pad(r.ttftMin)}-${pad(r.ttftMax)}]  total=${pad(r.totalMedian)}  (${r.samples}/${RUNS_PER_SIZE} ok) ║`);
  }

  console.log('║                                                                      ║');
  if (daemonSpawnTime !== null) {
    console.log(`║  DAEMON (spawn once = ${daemonSpawnTime}ms, then reuse):                          ║`);
    for (const [name, r] of Object.entries(daemonResults)) {
      console.log(`║    ${name.padEnd(8)} TTFT median=${pad(r.ttftMedian)}  p90=${pad(r.ttftP90)}  range=[${pad(r.ttftMin)}-${pad(r.ttftMax)}]  total=${pad(r.totalMedian)}  (${r.samples}/${RUNS_PER_SIZE} ok) ║`);
    }
  } else {
    console.log('║  DAEMON: FAILED TO START                                             ║');
  }

  console.log('║                                                                      ║');
  console.log('║  SPIKE B — Control requests:                                          ║');
  console.log(`║    set_model:               ${setModelResult?.success ? '✅ WORKS' : '❌ FAILED / SKIPPED'}                              ║`);
  console.log(`║    set_max_thinking_tokens:  ${setThinkingResult?.success ? '✅ WORKS' : '❌ FAILED / SKIPPED'}                              ║`);

  console.log('║                                                                      ║');
  console.log('╠══════════════════════════════════════════════════════════════════════╣');

  // Verdict
  const ref = daemonResults.medium || oneShotResults.medium;
  if (ref) {
    const ttft = ref.ttftMedian;
    if (ttft === null) {
      console.log('║  ⚠️  VERDICT: Could not measure TTFT (parsing issue or errors)       ║');
    } else if (ttft < 800) {
      console.log(`║  🟢 VERDICT: TTFT ${ttft}ms — inline completions VIÁVEL               ║`);
    } else if (ttft < 1500) {
      console.log(`║  🟡 VERDICT: TTFT ${ttft}ms — usável com trigger conservador           ║`);
    } else {
      console.log(`║  🔴 VERDICT: TTFT ${ttft}ms — inline vai sentir lento demais           ║`);
    }
  }

  console.log('╚══════════════════════════════════════════════════════════════════════╝');
}

function pad(v) { return String(v ?? '?').padStart(5); }
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
function percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(Math.ceil((p / 100) * s.length) - 1, s.length - 1)];
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
