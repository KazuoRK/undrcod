/**
 * IPC bridge pra instalação de SKILLs do agente.
 *
 * Channels (handle):
 *   - skills:installCurated(source, skillFilter?)  -> { ok, error?, output? }
 *
 * Implementação:
 *   Shell-out pra `npx skills add <source> [--skill <filter>]` rodando com
 *   cwd = homedir() pra instalar a NÍVEL DE USUÁRIO (~/.claude/skills/).
 *   Skill instalada fica disponível em todos os workspaces.
 *
 *   `npx skills` é a CLI oficial da Anthropic. Se não estiver em cache,
 *   npm faz fetch (~5s primeira vez, depois 0s). Timeout 120s pra cobrir
 *   downloads grandes (huashu-design tem MB de assets).
 *
 *   Segurança: o source vem do catálogo curado em src/shared/curated-skills.ts
 *   — NÃO aceita input arbitrário. Por isso safe pra shell-out sem escape
 *   exaustivo (mas mesmo assim validamos no spawn).
 */
import { ipcMain } from 'electron';
import { spawn } from 'child_process';
import { homedir, platform } from 'os';
import { existsSync } from 'fs';
import { delimiter, join } from 'path';

/**
 * Resolve binário absoluto no PATH sem usar shell. Equivalente a `which`/`where`
 * mas em JS puro — varre PATH e testa cada candidato. Em Windows, tenta as
 * extensões de PATHEXT (.cmd, .exe, .bat) na ordem.
 *
 * Retorna path absoluto se achar, ou null. NUNCA roda comando externo.
 */
function resolveBinary(name: string): string | null {
  const PATH = process.env.PATH || process.env.Path || '';
  if (!PATH) return null;
  const isWin = platform() === 'win32';
  const exts = isWin
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())
    : [''];
  for (const dir of PATH.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        // permission denied etc — ignora
      }
    }
  }
  return null;
}

/**
 * Allowlist pra source (vem do catálogo curado em src/shared/curated-skills.ts):
 *   - pacotes npm: `@scope/name`, `name`
 *   - paths file://
 *   - github URLs / tarball URLs
 *   - git URLs com path
 *
 * Rejeita qualquer char que tenha sintaxe shell (mesmo com shell:false ja sendo
 * safe, isso é defense-in-depth caso alguém futuramente reintroduza shell:true).
 */
const SAFE_SOURCE_RE = /^[\w./\-:@+#%]+$/;
const SAFE_FILTER_RE = /^[\w./\-]+$/;

interface InstallResult {
  ok: boolean;
  error?: string;
  output?: string;
}

/** Roda `npx skills add ...`. Resolve mesmo em failure (erro vem no result). */
function runSkillsAdd(source: string, skillFilter?: string): Promise<InstallResult> {
  return new Promise((resolve) => {
    const args = ['skills', 'add', source];
    if (skillFilter) {
      args.push('--skill', skillFilter);
    }

    // Resolve `npx` pra path absoluto via varredura de PATH (sem shell).
    // Em Windows tenta `npx.cmd`/`npx.exe` via PATHEXT — find-binary cobre.
    const npxPath = resolveBinary('npx');
    if (!npxPath) {
      resolve({ ok: false, error: 'npx não encontrado no PATH' });
      return;
    }

    // shell:false elimina qualquer interpretação de shell — args vão direto
    // pro processo via argv. Mesmo source malicioso vira string literal.
    const child = spawn(npxPath, args, {
      cwd: homedir(), // instala em ~/.claude/skills/ (nível usuário)
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    const TIMEOUT_MS = 120_000;
    const killer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: 'Timeout (120s) — verifique conexão' });
    }, TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(killer);
      resolve({ ok: false, error: `Falha ao spawnar npx: ${err.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(killer);
      if (code === 0) {
        resolve({ ok: true, output: stdout.trim() || stderr.trim() });
      } else {
        const msg = stderr.trim() || stdout.trim() || `npx saiu com código ${code}`;
        resolve({ ok: false, error: msg, output: stdout.trim() });
      }
    });
  });
}

export function registerSkillsIPC(): void {
  ipcMain.handle(
    'skills:installCurated',
    async (_evt, source: string, skillFilter: string | undefined): Promise<InstallResult> => {
      if (!source || typeof source !== 'string') {
        return { ok: false, error: 'source inválido' };
      }
      // Allowlist strict: defense-in-depth caso alguém reintroduza shell:true
      // ou caso o `skills` CLI eventualmente delegue pra outro shell-out.
      if (!SAFE_SOURCE_RE.test(source)) {
        return { ok: false, error: 'caracteres inválidos no source' };
      }
      if (skillFilter && !SAFE_FILTER_RE.test(skillFilter)) {
        return { ok: false, error: 'caracteres inválidos no filter' };
      }
      return runSkillsAdd(source, skillFilter);
    },
  );
}
