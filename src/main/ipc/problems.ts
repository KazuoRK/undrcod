import { ipcMain } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Problems — roda `tsc --noEmit` no cwd e parseia stderr.
 *
 * Formato esperado (default tsc, sem --pretty):
 *   path/to/file.ts(LINE,COL): error TS####: mensagem
 *
 * Se não tem tsconfig.json no cwd, retorna { files: [] } sem rodar.
 * Se tsc não esta instalado/disponível, retorna { files: [] } sem crashar.
 *
 * Eventos:
 *   - problems:check (cwd) -> { files: Array<{ path, errors: Array<{ line, col, code, message }> }> }
 */

const execAsync = promisify(exec);

export interface ProblemError {
  line: number;
  col: number;
  code: string;
  message: string;
}

export interface ProblemFile {
  path: string;
  errors: ProblemError[];
}

export interface ProblemsResult {
  files: ProblemFile[];
}

const LINE_RE = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/;

function parseTsc(output: string, cwd: string): ProblemFile[] {
  const byFile = new Map<string, ProblemError[]>();

  // tsc usa stdout pra erros (não stderr). Linhas podem ter ANSI quando --pretty.
  const cleaned = output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

  for (const raw of cleaned.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(LINE_RE);
    if (!m) continue;
    const [, rawPath, lineStr, colStr, code, message] = m;
    // Normaliza path absoluto (tsc emite relativo ao cwd)
    const path = rawPath.startsWith('/') || /^[A-Za-z]:/.test(rawPath)
      ? rawPath
      : join(cwd, rawPath);
    const entry: ProblemError = {
      line: Number(lineStr),
      col: Number(colStr),
      code,
      message: message.trim(),
    };
    if (!byFile.has(path)) byFile.set(path, []);
    byFile.get(path)!.push(entry);
  }

  return Array.from(byFile.entries())
    .map(([path, errors]) => ({ path, errors }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function checkProblems(cwd: string): Promise<ProblemsResult> {
  // Sem cwd valido — nada a fazer
  if (!cwd) return { files: [] };

  // Sem tsconfig — não e ts project, retorna vazio
  const hasTsconfig = existsSync(join(cwd, 'tsconfig.json'));
  if (!hasTsconfig) return { files: [] };

  // Tenta `npx tsc` (resolve binario local do projeto se houver)
  // tsc retorna exit code != 0 quando ha erros, mas exec joga erro nesse caso.
  // Por isso pegamos stdout do err.stdout no catch.
  const cmd = process.platform === 'win32' ? 'npx.cmd tsc --noEmit --pretty false' : 'npx tsc --noEmit --pretty false';
  try {
    const { stdout } = await execAsync(cmd, {
      cwd,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 60_000,
    });
    return { files: parseTsc(stdout, cwd) };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    // Exit != 0 com stdout populado = erros normais do tsc
    if (e.stdout && e.stdout.length > 0) {
      return { files: parseTsc(e.stdout, cwd) };
    }
    // tsc não encontrado, npx falhou, etc — silencia
    console.warn('[problems] tsc check falhou:', e.message);
    return { files: [] };
  }
}

export function registerProblemsIPC(): void {
  ipcMain.handle('problems:check', (_, cwd: string) => checkProblems(cwd));
}
