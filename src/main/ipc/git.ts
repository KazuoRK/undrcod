import { ipcMain } from 'electron';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * execFile (NÃO `exec`) garante que args vão como ARRAY direto pro processo,
 * sem expansão de shell. Mesmo input malicioso tipo `master; calc.exe` chega
 * pro git como string literal — git rejeita por ser ref inválida, mas
 * NUNCA é executado pelo cmd.exe/sh. Esse é o fix central pra command injection.
 */
const execFileAsync = promisify(execFile);

/**
 * IPC handlers pra integracao com git.
 *
 * Channels:
 *   - git:diff(cwd) -> { files: Array<{ path, hunks: [...] }> }
 *   - git:applyPatch(cwd, patchText, reverse) -> { ok: true } | { error: string }
 *   - git:checkoutFile(cwd, filePath) -> { ok: true } | { error: string }
 *
 * Se não for repositório git, retorna { files: [] }.
 * Inclui working tree (unstaged) e staged via `git diff HEAD`.
 */

export interface DiffLine {
  /** '\\' = "\ No newline at end of file" marker. Necessário pra reconstruir patches válidos. */
  type: '+' | '-' | ' ' | '\\';
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  hunks: DiffHunk[];
}

export interface DiffResult {
  files: DiffFile[];
}

/**
 * Parser de output do `git diff --no-color HEAD`.
 *
 * Formato esperado:
 *   diff --git a/path b/path
 *   index abc..def 100644
 *   --- a/path
 *   +++ b/path
 *   @@ -1,3 +1,4 @@
 *    contexto
 *   -removida
 *   +adicionada
 */
function parseGitDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  if (!raw.trim()) return files;

  const lines = raw.split(/\r?\n/);
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;

  for (const line of lines) {
    // Inicio de novo arquivo
    if (line.startsWith('diff --git ')) {
      // Extrai path do "b/path" — preferencial pq reflete nome novo em renames
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      const path = match ? match[2] : line.replace('diff --git ', '');
      currentFile = { path, hunks: [] };
      currentHunk = null;
      files.push(currentFile);
      continue;
    }

    // Headers que descartamos
    if (
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file mode ') ||
      line.startsWith('deleted file mode ') ||
      line.startsWith('similarity index ') ||
      line.startsWith('rename from ') ||
      line.startsWith('rename to ') ||
      line.startsWith('Binary files ')
    ) {
      continue;
    }

    // Inicio de hunk
    if (line.startsWith('@@')) {
      if (!currentFile) continue;
      currentHunk = { header: line, lines: [] };
      currentFile.hunks.push(currentHunk);
      continue;
    }

    // Linha de conteudo do hunk
    if (currentHunk) {
      const first = line.charAt(0);
      if (first === '+') {
        currentHunk.lines.push({ type: '+', text: line.slice(1) });
      } else if (first === '-') {
        currentHunk.lines.push({ type: '-', text: line.slice(1) });
      } else if (first === ' ') {
        currentHunk.lines.push({ type: ' ', text: line.slice(1) });
      } else if (first === '\\') {
        // "\ No newline at end of file" — preserva pra git apply reconstruir patch válido
        currentHunk.lines.push({ type: '\\', text: line.slice(1) });
      } else if (line === '') {
        // Linha em branco dentro de hunk conta como contexto vazio
        currentHunk.lines.push({ type: ' ', text: '' });
      }
    }
  }

  return files;
}

async function getDiff(cwd: string): Promise<DiffResult> {
  if (!cwd) return { files: [] };

  try {
    // Verifica se e repo git primeiro — evita ruido de stderr.
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      windowsHide: true,
    });
  } catch {
    return { files: [] };
  }

  try {
    // HEAD = compara working tree (incluindo unstaged + staged) contra último commit.
    // --no-color pra parsing limpo.
    const { stdout } = await execFileAsync('git', ['diff', '--no-color', 'HEAD'], {
      cwd,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024, // 20MB pra projetos grandes
    });
    return { files: parseGitDiff(stdout) };
  } catch (err) {
    console.error('[git] diff error:', err);
    return { files: [] };
  }
}

/**
 * Diff cumulativo entre <branchName> e HEAD (merge-base ... HEAD).
 *
 * Usa `git diff <branch>...HEAD` (3-dot): pega o merge-base e diffa contra HEAD,
 * mostrando exclusivamente o que a current branch introduziu desde o fork-point.
 * Tenta primeiro o branch literal (ex: 'origin/main'); se falhar, faz fallback
 * pra versão sem prefixo 'origin/' (ex: 'main') porque alguns repos locais não
 * tem o remote. Se nenhuma das duas existir, retorna { files: [] }.
 */
async function getDiffVsBranch(
  cwd: string,
  branchName: string,
): Promise<DiffResult> {
  if (!cwd || !branchName) return { files: [] };

  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      windowsHide: true,
    });
  } catch {
    return { files: [] };
  }

  // Verifica se a ref existe antes de diffar — evita stderr ruidoso.
  async function refExists(ref: string): Promise<boolean> {
    try {
      // execFile garante ref vai como argv literal — sem interpolação shell.
      // git rejeita refs malformadas com exit code != 0, capturado no catch.
      await execFileAsync('git', ['rev-parse', '--verify', ref], {
        cwd,
        windowsHide: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  let target = branchName;
  if (!(await refExists(target))) {
    // Fallback: se passou 'origin/main' e não tem, tenta 'main'.
    const stripped = branchName.replace(/^origin\//, '');
    if (stripped !== branchName && (await refExists(stripped))) {
      target = stripped;
    } else {
      return { files: [] };
    }
  }

  try {
    // Monta o range "target...HEAD" em JS (concat de string em memória),
    // depois passa como UM arg pro git. Nada vai via shell.
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--no-color', `${target}...HEAD`],
      {
        cwd,
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    return { files: parseGitDiff(stdout) };
  } catch (err) {
    console.error('[git] diffVsBranch error:', err);
    return { files: [] };
  }
}

/**
 * Aplica um patch (unified-diff) ao working tree via stdin.
 *
 * Se reverse=true, aplica com `-R` (desfaz o patch — usado pra "reject hunk"
 * em mudanca já aceita ou "discard" de hunk existente no diff atual).
 *
 * Usa spawn com stdin pipe pra evitar tempfile + maxBuffer issues. Git for
 * Windows aceita `-` como path de patch (le de stdin) sem problemas.
 *
 * `--whitespace=nowarn`: não polui stderr com whitespace warnings.
 * `--unidiff-zero`: aceita hunks com 0 linhas de contexto (parser nosso
 * as vezes gera hunks minimalistas).
 */
async function applyPatchToWorktree(
  cwd: string,
  patchText: string,
  reverse: boolean,
): Promise<{ ok: true } | { error: string }> {
  // FIX: escreve patch em arquivo tmp e passa path como arg, em vez de stdin pipe.
  // Causa raiz descoberta: no Windows, proc.stdin.write(string) converte LF→CRLF
  // automaticamente, corrompendo o patch (git apply exige exatamente LF).
  // Usar writeFile + path elimina a conversão de encoding.
  const tmpPath = join(tmpdir(), `undrcod-patch-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`);

  try {
    // Escreve como Buffer pra evitar QUALQUER conversão de encoding (BOM, CRLF).
    // patchText já tem LF, escrever Buffer.from(string, 'utf8') preserva byte-by-byte.
    await writeFile(tmpPath, Buffer.from(patchText, 'utf8'));
  } catch (err: any) {
    return { error: `failed to write tmp patch: ${err.message}` };
  }

  return new Promise((resolve) => {
    // -c core.autocrlf=false — força git a NÃO converter LF→CRLF do patch durante leitura.
    // Default no Git for Windows é true, que quebra reverse-apply quando o working tree
    // tem CRLF mas o patch tem LF (git "ajusta" o patch e desaln+lha do estado real).
    const args = [
      '-c', 'core.autocrlf=false',
      '-c', 'core.safecrlf=false',
      'apply',
    ];
    if (reverse) args.push('-R');
    args.push(
      '--whitespace=nowarn',
      '--ignore-space-change',  // mais permissivo que --ignore-whitespace
      '--ignore-whitespace',
      '--inaccurate-eof',
      '--recount',
      '--unidiff-zero',
      tmpPath,
    );

    const proc = spawn('git', args, { cwd, windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => {
      unlink(tmpPath).catch(() => {/* ignore */});
      resolve({ error: err.message });
    });
    proc.on('exit', (code) => {
      // Cleanup tmp file (best-effort).
      unlink(tmpPath).catch(() => {/* ignore */});
      if (code === 0) resolve({ ok: true });
      else {
        resolve({ error: stderr.trim() || `git apply exited with code ${code}` });
      }
    });
  });
}

/**
 * Aplica o N-ésimo hunk de `git diff HEAD -- <file>` SEM reconstruir o patch.
 *
 * Estratégia: abandona qualquer parsing/reconstrução do nosso `DiffLine[]` e
 * usa os bytes EXATOS que o git emite. Re-roda `git diff HEAD -- <filePath>`,
 * fatia o N-ésimo hunk byte-by-byte preservando o header (`diff --git`, `index`,
 * `---`, `+++`) e aplica via spawn com arquivo tmp.
 *
 * Hipótese: bytes que o git produz são bytes que o git aceita, sem depender
 * do que acontece com o spawn env do Electron.
 *
 * `reverse=true` → aplica com `-R` (usado pelo botão "reject hunk" no DiffViewer).
 */
async function applyHunkByIndex(
  cwd: string,
  filePath: string,
  hunkIndex: number,
  reverse: boolean,
): Promise<{ ok: true } | { error: string }> {
  // Step 1: get raw diff direto do git, sem parsing.
  let rawDiff: string;
  try {
    // `--` separa flags de pathspecs; filePath vai literal por execFile.
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--no-color', 'HEAD', '--', filePath],
      {
        cwd,
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    rawDiff = stdout;
  } catch (err: any) {
    return { error: `git diff failed: ${err.message || err}` };
  }

  if (!rawDiff.trim()) {
    return { error: 'no diff (file unchanged?)' };
  }

  // Step 2: extrai header + N-ésimo hunk byte-by-byte.
  // Formato do raw diff:
  //   diff --git a/PATH b/PATH
  //   index ...
  //   --- a/PATH
  //   +++ b/PATH
  //   @@ -A,B +C,D @@ context
  //   ... hunk lines ...
  //   @@ -A,B +C,D @@ context  (hunk 2)
  //   ...
  // Split por linha mas preserva conteúdo bruto. git diff usa LF puro.
  const lines = rawDiff.split('\n');
  let headerEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('@@')) {
      headerEnd = i;
      break;
    }
  }
  if (headerEnd === -1) {
    return { error: 'no hunks in diff' };
  }
  const headerLines = lines.slice(0, headerEnd);

  // Walk pelos hunks. Cada hunk começa em `@@` e vai até o próximo `@@` ou
  // `diff --git ` (caso o diff cubra múltiplos files — mas como filtramos por
  // path no `git diff -- <file>`, isso seria raro).
  const hunks: string[][] = [];
  let currentHunk: string[] | null = null;
  for (let i = headerEnd; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('@@')) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = [line];
    } else if (currentHunk) {
      if (line.startsWith('diff --git ')) {
        if (currentHunk.length > 1) hunks.push(currentHunk);
        currentHunk = null;
        break;
      }
      // Context (' '), added ('+'), removed ('-'), no-newline marker ('\') —
      // todos válidos. Linha vazia também é contexto de linha vazia.
      currentHunk.push(line);
    }
  }
  if (currentHunk) hunks.push(currentHunk);

  if (hunkIndex < 0 || hunkIndex >= hunks.length) {
    return { error: `invalid hunk index ${hunkIndex} (have ${hunks.length} hunks)` };
  }

  // Step 3: trim trailing empty lines do hunk escolhido (split('\n') gera um
  // empty no final se o diff terminava com \n), PRESERVANDO `\ No newline at
  // end of file` se aparecer.
  const hunkLines = hunks[hunkIndex];
  while (hunkLines.length > 0 && hunkLines[hunkLines.length - 1] === '') {
    hunkLines.pop();
  }

  // Step 4: monta patch = TODAS as header lines (diff --git, index, ---, +++)
  // + apenas o hunk escolhido. Mantém `index ...` porque vem direto do git
  // e ajuda o apply a localizar o blob exato.
  const finalPatch = [...headerLines, ...hunkLines].join('\n') + '\n';

  // Step 5: escreve em tmp file e aplica via spawn (sem stdin pra evitar
  // qualquer conversão CRLF do node em Windows).
  const tmpPath = join(
    tmpdir(),
    `undrcod-hunk-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`,
  );
  try {
    await writeFile(tmpPath, Buffer.from(finalPatch, 'utf8'));
  } catch (err: any) {
    return { error: `failed to write tmp patch: ${err.message}` };
  }

  return new Promise((resolve) => {
    const args = [
      '-c', 'core.autocrlf=false',
      '-c', 'core.safecrlf=false',
      'apply',
    ];
    if (reverse) args.push('-R');
    args.push(
      '--whitespace=nowarn',
      '--ignore-whitespace',
      '--inaccurate-eof',
      tmpPath,
    );
    const proc = spawn('git', args, { cwd, windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => {
      unlink(tmpPath).catch(() => {/* ignore */});
      resolve({ error: err.message });
    });
    proc.on('exit', (code) => {
      unlink(tmpPath).catch(() => {/* ignore */});
      if (code === 0) {
        resolve({ ok: true });
      } else {
        // eslint-disable-next-line no-console
        console.error('[git applyHunkByIndex] FAILED. args:', args.join(' '));
        // eslint-disable-next-line no-console
        console.error('[git applyHunkByIndex] patch:\n' + finalPatch);
        // eslint-disable-next-line no-console
        console.error('[git applyHunkByIndex] stderr:', stderr);
        const debug = `\n--- patch enviado ---\n${finalPatch}--- fim patch ---`;
        resolve({
          error:
            (stderr.trim() || `git apply exited with code ${code}`) + debug,
        });
      }
    });
  });
}

/**
 * Reverte arquivo inteiro pro estado do HEAD.
 * Equivalente a `git checkout HEAD -- <file>` — descarta TODAS as mudancas
 * (staged e unstaged) do arquivo. Usado pelo botao "discard file" do DiffViewer.
 */
async function checkoutFile(
  cwd: string,
  filePath: string,
): Promise<{ ok: true } | { error: string }> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['checkout', 'HEAD', '--', filePath], {
      cwd,
      windowsHide: true,
    });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => resolve({ error: err.message }));
    proc.on('exit', (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ error: stderr.trim() || `git checkout exited with code ${code}` });
    });
  });
}

// ============================================================================
// Status / stage / unstage / commit — usados pelo SourceControl panel.
// ============================================================================

export interface GitStatusFile {
  path: string;
  /** Index status (X): '.' = unchanged, 'M' = modified, 'A' = added, 'D' = deleted,
   *  'R' = renamed, 'C' = copied, 'U' = unmerged, '?' = untracked. */
  indexStatus: string;
  /** Worktree status (Y) — mesmas letras. */
  worktreeStatus: string;
  /** true se tem qualquer mudanca staged (X != '.' && X != '?'). */
  staged: boolean;
  /** Pra renomes: path original antes do renomeio. */
  renamedFrom?: string;
}

export interface GitStatus {
  branch: string;
  upstream?: string;
  /** Commits ahead do upstream. 0 se nao houver upstream. */
  ahead: number;
  /** Commits behind do upstream. */
  behind: number;
  files: GitStatusFile[];
}

/**
 * Helper pra rodar git command e capturar stdout/stderr com timeout.
 * Retorna { code, stdout, stderr } sem throw.
 */
function runGit(
  cwd: string,
  args: string[],
  timeoutMs = 10_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (code: number): void => {
      if (done) return;
      done = true;
      resolve({ code, stdout, stderr });
    };

    let proc;
    try {
      proc = spawn('git', args, { cwd, windowsHide: true });
    } catch (err: any) {
      stderr = err.message;
      finish(-1);
      return;
    }

    const timer = setTimeout(() => {
      try { proc!.kill('SIGTERM'); } catch { /* noop */ }
      stderr += '\n[timeout]';
      finish(-2);
    }, timeoutMs);

    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    proc.on('error', (err) => {
      clearTimeout(timer);
      stderr += err.message;
      finish(-1);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      finish(code ?? -1);
    });
  });
}

/**
 * Parser de output do `git status --porcelain=v2 -z -uall --branch`.
 *
 * Formato:
 *   # branch.head <name>          (sempre presente)
 *   # branch.upstream <name>      (opcional)
 *   # branch.ab +N -M             (opcional; presente quando ha upstream)
 *   1 XY sub mH mI mW hH hI <path>                          (tracked changed)
 *   2 XY sub mH mI mW hH hI Xscore <path><tab>...           (renamed/copied)
 *     ATENCAO: com -z o separador entre path e origPath e NUL (\\0) e o
 *     origPath vem como entry seguinte (nao no mesmo entry com tab).
 *   ? <path>                                                (untracked)
 *   ! <path>                                                (ignored — skip)
 *   u XY ...                                                (unmerged — conflict)
 *
 * -z usa NUL ('\\0') como separator entre entries, sem escape de paths.
 */
function parseGitStatus(raw: string): GitStatus {
  const out: GitStatus = { branch: '', ahead: 0, behind: 0, files: [] };
  if (!raw) return out;

  // Split por NUL. Cada entry e uma linha (header ou file).
  const entries = raw.split('\0');
  // Pra renomes a entry seguinte e o origPath — usamos um indice manual.
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;

    // Branch info
    if (entry.startsWith('# branch.head ')) {
      out.branch = entry.slice('# branch.head '.length);
      continue;
    }
    if (entry.startsWith('# branch.upstream ')) {
      out.upstream = entry.slice('# branch.upstream '.length);
      continue;
    }
    if (entry.startsWith('# branch.ab ')) {
      // Format: "# branch.ab +N -M"
      const ab = entry.slice('# branch.ab '.length).split(' ');
      if (ab.length === 2) {
        out.ahead = parseInt(ab[0].replace('+', ''), 10) || 0;
        out.behind = parseInt(ab[1].replace('-', ''), 10) || 0;
      }
      continue;
    }
    // Outras headers (# branch.oid, # stash) — skip
    if (entry.startsWith('# ')) continue;

    // Ignored — skip
    if (entry.startsWith('! ')) continue;

    // Untracked: "? <path>"
    if (entry.startsWith('? ')) {
      out.files.push({
        path: entry.slice(2),
        indexStatus: '?',
        worktreeStatus: '?',
        staged: false,
      });
      continue;
    }

    // Tracked changed: "1 XY sub mH mI mW hH hI <path>"
    if (entry.startsWith('1 ')) {
      // Parsa os 8 campos antes do path. Path pode conter espacos (graças ao -z).
      // Skip "1 " (2 chars) e depois pega os primeiros 8 tokens separados por espaco.
      const rest = entry.slice(2);
      const parts = rest.split(' ');
      if (parts.length < 8) continue;
      const xy = parts[0]; // "MM", ".M", "A.", etc
      const indexStatus = xy.charAt(0);
      const worktreeStatus = xy.charAt(1);
      // Path = tudo a partir do 8º espaco (campos 0..6 sao XY sub mH mI mW hH hI)
      // 7 campos + 1 separator final = pula 8 tokens
      const path = parts.slice(7).join(' ');
      out.files.push({
        path,
        indexStatus: indexStatus === '.' ? '.' : indexStatus,
        worktreeStatus: worktreeStatus === '.' ? '.' : worktreeStatus,
        staged: indexStatus !== '.' && indexStatus !== '?',
      });
      continue;
    }

    // Renomeado/copiado: "2 XY sub mH mI mW hH hI Xscore <pathNovo>"
    // Com -z, o pathOriginal vem na PROXIMA entry (depois de '\\0').
    if (entry.startsWith('2 ')) {
      const rest = entry.slice(2);
      const parts = rest.split(' ');
      if (parts.length < 9) continue;
      const xy = parts[0];
      const indexStatus = xy.charAt(0);
      const worktreeStatus = xy.charAt(1);
      // Campos 0..7 sao header (XY sub mH mI mW hH hI Xscore), path comeca em 8.
      const pathNovo = parts.slice(8).join(' ');
      const origPath = entries[i + 1] || '';
      i++; // consome a entry seguinte (origPath)
      out.files.push({
        path: pathNovo,
        indexStatus: indexStatus === '.' ? '.' : indexStatus,
        worktreeStatus: worktreeStatus === '.' ? '.' : worktreeStatus,
        staged: indexStatus !== '.' && indexStatus !== '?',
        renamedFrom: origPath,
      });
      continue;
    }

    // Unmerged (conflito): "u XY sub m1 m2 m3 mW h1 h2 h3 <path>"
    if (entry.startsWith('u ')) {
      const rest = entry.slice(2);
      const parts = rest.split(' ');
      if (parts.length < 10) continue;
      // Path comeca no campo 10 (XY sub m1 m2 m3 mW h1 h2 h3 = 9 campos)
      const path = parts.slice(10).join(' ');
      out.files.push({
        path,
        indexStatus: 'U',
        worktreeStatus: 'U',
        staged: false,
      });
      continue;
    }
  }

  return out;
}

/**
 * `git status` parseado + branch info. Defensivo: se nao for repo retorna estado vazio.
 */
async function getStatus(cwd: string): Promise<GitStatus> {
  const empty: GitStatus = { branch: '', ahead: 0, behind: 0, files: [] };
  if (!cwd) return empty;

  // Probe rapido pra ver se e repo git
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, windowsHide: true });
  } catch {
    return empty;
  }

  const { code, stdout, stderr } = await runGit(
    cwd,
    ['status', '--porcelain=v2', '-z', '-uall', '--branch'],
    15_000,
  );
  if (code !== 0) {
    console.warn('[git:status] exited code', code, stderr);
    return empty;
  }
  return parseGitStatus(stdout);
}

/**
 * Stage de arquivo: `git add -- <filePath>`.
 * Funciona pra modified/untracked/deleted (com `git add` moderno).
 */
async function stageFile(
  cwd: string,
  filePath: string,
): Promise<{ ok: true } | { error: string }> {
  if (!cwd || !filePath) return { error: 'cwd ou filePath ausente' };
  const { code, stderr } = await runGit(cwd, ['add', '--', filePath], 10_000);
  if (code === 0) return { ok: true };
  return { error: stderr.trim() || `git add saiu com código ${code}` };
}

/**
 * Unstage de arquivo: `git reset HEAD -- <filePath>`.
 * `git reset` em vez de `git restore --staged` pra ser compativel com git mais antigo.
 */
async function unstageFile(
  cwd: string,
  filePath: string,
): Promise<{ ok: true } | { error: string }> {
  if (!cwd || !filePath) return { error: 'cwd ou filePath ausente' };
  const { code, stderr } = await runGit(cwd, ['reset', 'HEAD', '--', filePath], 10_000);
  if (code === 0) return { ok: true };
  return { error: stderr.trim() || `git reset saiu com código ${code}` };
}

/**
 * Stage TODOS os arquivos modificados (incluindo untracked): `git add -A`.
 * Equivalente ao botao "Stage All Changes" do VS Code.
 */
async function stageAllFiles(
  cwd: string,
): Promise<{ ok: true } | { error: string }> {
  if (!cwd) return { error: 'cwd ausente' };
  const { code, stderr } = await runGit(cwd, ['add', '-A'], 30_000);
  if (code === 0) return { ok: true };
  return { error: stderr.trim() || `git add -A saiu com código ${code}` };
}

/**
 * Unstage TODOS os arquivos do index: `git reset HEAD`.
 * Mantem mudancas no working tree, apenas remove do staging area.
 */
async function unstageAllFiles(
  cwd: string,
): Promise<{ ok: true } | { error: string }> {
  if (!cwd) return { error: 'cwd ausente' };
  const { code, stderr } = await runGit(cwd, ['reset', 'HEAD'], 15_000);
  if (code === 0) return { ok: true };
  // git reset com nada pra resetar pode sair com code 1 sem ser erro real.
  if (code === 1 && !stderr.trim()) return { ok: true };
  return { error: stderr.trim() || `git reset saiu com código ${code}` };
}

/**
 * Descarta mudancas (working tree) de um arquivo: `git checkout -- <file>`.
 * DESTRUTIVO: perde edits não-comitados. Caller DEVE confirmar antes.
 * Pra untracked, faz unlink direto via `git clean -f -- <file>` como fallback.
 */
async function discardFile(
  cwd: string,
  filePath: string,
): Promise<{ ok: true } | { error: string }> {
  if (!cwd || !filePath) return { error: 'cwd ou filePath ausente' };
  // Primeiro tenta checkout. Se file é untracked, checkout falha → fallback clean.
  const { code, stderr } = await runGit(
    cwd,
    ['checkout', '--', filePath],
    10_000,
  );
  if (code === 0) return { ok: true };
  // Fallback pra untracked: remove arquivo do disco
  const isUntracked =
    stderr.includes('did not match any file') ||
    stderr.includes('pathspec') ||
    stderr.includes('error:');
  if (isUntracked) {
    const clean = await runGit(cwd, ['clean', '-f', '--', filePath], 10_000);
    if (clean.code === 0) return { ok: true };
    return {
      error:
        clean.stderr.trim() || `git clean saiu com código ${clean.code}`,
    };
  }
  return { error: stderr.trim() || `git checkout saiu com código ${code}` };
}

/**
 * Descarta TODAS as mudancas no working tree: `git checkout -- .` + `git clean -fd`.
 * DESTRUTIVO MASS: perde edits não-comitados de TODOS arquivos modificados +
 * untracked. Caller DEVE confirmar com modal destrutivo.
 */
async function discardAllChanges(
  cwd: string,
): Promise<{ ok: true } | { error: string }> {
  if (!cwd) return { error: 'cwd ausente' };
  // Step 1: revert tracked
  const checkout = await runGit(cwd, ['checkout', '--', '.'], 30_000);
  if (checkout.code !== 0) {
    return {
      error:
        checkout.stderr.trim() ||
        `git checkout saiu com código ${checkout.code}`,
    };
  }
  // Step 2: remove untracked (-f force, -d include dirs)
  const clean = await runGit(cwd, ['clean', '-fd'], 30_000);
  if (clean.code !== 0) {
    return {
      error:
        clean.stderr.trim() || `git clean saiu com código ${clean.code}`,
    };
  }
  return { ok: true };
}

/**
 * `git pull` — fast-forward + merge automatico. Captura stdout+stderr e
 * devolve resumo (`Already up to date.` ou `Fast-forward...`). Timeout
 * 60s pq pull com network pode ser lento.
 */
async function gitPull(
  cwd: string,
): Promise<{ ok: true; output: string } | { error: string }> {
  if (!cwd) return { error: 'cwd ausente' };
  const { code, stdout, stderr } = await runGit(cwd, ['pull'], 60_000);
  if (code === 0) {
    const output = (stdout + (stderr ? `\n${stderr}` : '')).trim();
    return { ok: true, output: output || 'Pull concluido.' };
  }
  return { error: stderr.trim() || stdout.trim() || `git pull saiu com código ${code}` };
}

/**
 * `git push` — push da branch atual pro upstream. Se nao houver upstream,
 * tenta `--set-upstream origin <branch>`. Timeout 60s.
 */
async function gitPush(
  cwd: string,
): Promise<{ ok: true; output: string } | { error: string }> {
  if (!cwd) return { error: 'cwd ausente' };
  const first = await runGit(cwd, ['push'], 60_000);
  if (first.code === 0) {
    const output = (first.stdout + (first.stderr ? `\n${first.stderr}` : '')).trim();
    return { ok: true, output: output || 'Push concluido.' };
  }
  // Se erro indica que não tem upstream, tenta criar tracking branch.
  if (
    first.stderr.includes('has no upstream branch') ||
    first.stderr.includes('--set-upstream')
  ) {
    // Pega nome da branch atual
    const br = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], 5_000);
    const branch = br.stdout.trim();
    if (br.code === 0 && branch && branch !== 'HEAD') {
      const second = await runGit(
        cwd,
        ['push', '--set-upstream', 'origin', branch],
        60_000,
      );
      if (second.code === 0) {
        const output = (second.stdout + (second.stderr ? `\n${second.stderr}` : '')).trim();
        return { ok: true, output: output || `Push (upstream criado: origin/${branch}).` };
      }
      return {
        error: second.stderr.trim() || `git push --set-upstream saiu com código ${second.code}`,
      };
    }
  }
  return { error: first.stderr.trim() || `git push saiu com código ${first.code}` };
}

/**
 * `git fetch --all --prune` — atualiza refs remotos sem mexer no working
 * tree. Util pra recalcular ahead/behind no statusbar.
 */
async function gitFetch(
  cwd: string,
): Promise<{ ok: true; output: string } | { error: string }> {
  if (!cwd) return { error: 'cwd ausente' };
  const { code, stdout, stderr } = await runGit(
    cwd,
    ['fetch', '--all', '--prune'],
    60_000,
  );
  if (code === 0) {
    const output = (stdout + (stderr ? `\n${stderr}` : '')).trim();
    return { ok: true, output: output || 'Fetch concluido.' };
  }
  return { error: stderr.trim() || `git fetch saiu com código ${code}` };
}

/**
 * Cria commit com mensagem. Valida message não-vazio antes de spawn.
 * Retorna hash curto (7 chars) em sucesso.
 */
async function commitChanges(
  cwd: string,
  message: string,
): Promise<{ ok: true; hash: string } | { error: string }> {
  if (!cwd) return { error: 'cwd ausente' };
  if (!message || !message.trim()) {
    return { error: 'Mensagem de commit obrigatória' };
  }

  const { code, stderr } = await runGit(
    cwd,
    ['commit', '-m', message.trim()],
    20_000,
  );
  if (code !== 0) {
    return { error: stderr.trim() || `git commit saiu com código ${code}` };
  }

  // Capta hash do HEAD pra retornar pro user
  const hashRes = await runGit(cwd, ['rev-parse', '--short', 'HEAD'], 5_000);
  const hash = hashRes.code === 0 ? hashRes.stdout.trim() : '';
  return { ok: true, hash };
}

export function registerGitIPC(): void {
  ipcMain.handle('git:diff', (_, cwd: string) => getDiff(cwd));

  ipcMain.handle('git:diffVsBranch', (_, cwd: string, branchName: string) =>
    getDiffVsBranch(cwd, branchName),
  );

  /**
   * Retorna o diff STAGED (`git diff --cached --no-color`) como string crua.
   * Usado pelo CommitDialog pra alimentar o LLM e gerar mensagem de commit.
   * Defensivo: retorna { diff: '' } se cwd não for repo ou nada staged.
   */
  ipcMain.handle('git:diffStaged', async (_, cwd: string): Promise<{ diff: string }> => {
    if (!cwd) return { diff: '' };
    const r = await runGit(cwd, ['diff', '--cached', '--no-color'], 10_000);
    if (r.code !== 0) return { diff: '' };
    return { diff: r.stdout };
  });

  ipcMain.handle('git:applyPatch', async (_, cwd: string, patchText: string, reverse: boolean) => {
    if (!cwd || !patchText) return { error: 'cwd or patch missing' };
    return applyPatchToWorktree(cwd, patchText, !!reverse);
  });

  ipcMain.handle(
    'git:applyHunkByIndex',
    async (_, cwd: string, filePath: string, hunkIndex: number, reverse: boolean) => {
      if (!cwd || !filePath) return { error: 'cwd or filePath missing' };
      if (typeof hunkIndex !== 'number' || hunkIndex < 0) {
        return { error: 'invalid hunkIndex' };
      }
      return applyHunkByIndex(cwd, filePath, hunkIndex, !!reverse);
    },
  );

  ipcMain.handle('git:checkoutFile', async (_, cwd: string, filePath: string) => {
    if (!cwd || !filePath) return { error: 'cwd or path missing' };
    return checkoutFile(cwd, filePath);
  });

  // Source Control handlers
  ipcMain.handle('git:status', (_, cwd: string) => getStatus(cwd));
  ipcMain.handle('git:stage', async (_, cwd: string, filePath: string) => stageFile(cwd, filePath));
  ipcMain.handle('git:unstage', async (_, cwd: string, filePath: string) => unstageFile(cwd, filePath));
  ipcMain.handle('git:commit', async (_, cwd: string, message: string) => commitChanges(cwd, message));

  // Bulk operations
  ipcMain.handle('git:stageAll', async (_, cwd: string) => stageAllFiles(cwd));
  ipcMain.handle('git:unstageAll', async (_, cwd: string) => unstageAllFiles(cwd));
  ipcMain.handle('git:discardFile', async (_, cwd: string, filePath: string) =>
    discardFile(cwd, filePath),
  );
  ipcMain.handle('git:discardAll', async (_, cwd: string) => discardAllChanges(cwd));

  // Remote operations
  ipcMain.handle('git:pull', async (_, cwd: string) => gitPull(cwd));
  ipcMain.handle('git:push', async (_, cwd: string) => gitPush(cwd));
  ipcMain.handle('git:fetch', async (_, cwd: string) => gitFetch(cwd));

  // === Branch operations — pra branch switcher na StatusBar ===
  // git branch --all com formato porcelain: name|isCurrent|isRemote|lastCommitRelative
  ipcMain.handle('git:branches', async (_, cwd: string) => {
    if (!cwd) return { error: 'cwd missing' };
    try {
      // Sem aspas — execFile passa o format string como arg único.
      const { stdout } = await execFileAsync(
        'git',
        ['branch', '--all', '--format=%(refname:short)|%(HEAD)|%(committerdate:relative)'],
        { cwd, encoding: 'utf-8' },
      );
      const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      const out: Array<{ name: string; isCurrent: boolean; isRemote: boolean; lastCommit?: string }> = [];
      for (const line of lines) {
        const [name, headFlag, lastCommit] = line.split('|');
        if (!name) continue;
        // Pula refs intermediárias tipo "origin/HEAD -> origin/main"
        if (name.includes(' -> ')) continue;
        const isRemote = name.startsWith('origin/') || name.includes('/');
        const isCurrent = headFlag === '*';
        out.push({ name, isCurrent, isRemote, lastCommit: lastCommit || undefined });
      }
      return { ok: true, branches: out };
    } catch (err: any) {
      return { error: err.message || 'git branch falhou' };
    }
  });

  ipcMain.handle('git:checkout', async (_, cwd: string, branchName: string) => {
    if (!cwd || !branchName) return { error: 'cwd or branch missing' };
    try {
      // Remote branch (origin/foo) → cria local tracking; senão checkout direto.
      // execFile com array args: branchName/localName chegam como argv literal,
      // sem interpretação de shell. Mesmo `master; calc.exe` vira ref literal,
      // git rejeita com fatal: invalid reference.
      if (branchName.startsWith('origin/')) {
        const localName = branchName.replace(/^origin\//, '');
        // Tenta criar branch local trackeando o remote. Se já existir, faz checkout normal.
        try {
          await execFileAsync('git', ['checkout', '-b', localName, '--track', branchName], { cwd });
        } catch {
          await execFileAsync('git', ['checkout', localName], { cwd });
        }
      } else {
        await execFileAsync('git', ['checkout', branchName], { cwd });
      }
      return { ok: true };
    } catch (err: any) {
      return { error: (err.stderr || err.message || '').toString().trim() || 'checkout falhou' };
    }
  });

  /**
   * Git log do arquivo ativo. Retorna últimos commits que tocaram o file
   * com --follow (segue renames). Usado pela TimelineSection inline na sidebar.
   *
   * Formato: %H|%h|%s|%an|%ct  (hash | shortHash | subject | author | unix ts)
   * - Limite 200 commits pra não estourar buffer em arquivos antigos.
   * - filePath pode vir absoluto (com cwd no prefixo) ou relativo — normalizamos
   *   pra relativo antes do `git log` pq --follow é mais estável assim.
   * - Defensivo: se não for repo git ou file não tracked, retorna { commits: [] }.
   */
  ipcMain.handle('git:fileHistory', async (_, cwd: string, filePath: string) => {
    if (!cwd || !filePath) return { ok: true, commits: [] };

    // Probe: é repo git?
    try {
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, windowsHide: true });
    } catch {
      return { ok: true, commits: [] };
    }

    // Normaliza path pra relativo ao cwd se vier absoluto.
    let relPath = filePath;
    const normalizedCwd = cwd.replace(/[\\/]+$/, '');
    if (filePath.startsWith(normalizedCwd)) {
      relPath = filePath.slice(normalizedCwd.length).replace(/^[\\/]+/, '');
    }
    // Git em Windows aceita forward slashes — converte pra consistência.
    relPath = relPath.replace(/\\/g, '/');

    try {
      // Sem aspas no pretty=format (execFile passa como UM arg literal).
      // `--` separa flags de pathspec — relPath vai literal por execFile.
      const { stdout } = await execFileAsync(
        'git',
        [
          'log',
          '--follow',
          '--max-count=200',
          '--pretty=format:%H|%h|%s|%an|%ct',
          '--',
          relPath,
        ],
        { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      );
      const commits = stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          // Subject pode conter '|', então split por '|' com limite de 5 e join do meio.
          const parts = line.split('|');
          if (parts.length < 5) return null;
          const hash = parts[0];
          const shortHash = parts[1];
          const ctMs = parts[parts.length - 1];
          const author = parts[parts.length - 2];
          const subject = parts.slice(2, parts.length - 2).join('|');
          const timestamp = parseInt(ctMs, 10) * 1000;
          if (!hash || isNaN(timestamp)) return null;
          return { hash, shortHash, subject, author, timestamp };
        })
        .filter((c): c is { hash: string; shortHash: string; subject: string; author: string; timestamp: number } => c !== null);
      return { ok: true, commits };
    } catch {
      // File pode não estar tracked, ou diretório vazio — não bloqueia UI.
      return { ok: true, commits: [] };
    }
  });

  ipcMain.handle('git:createBranch', async (_, cwd: string, branchName: string, fromBranch?: string) => {
    if (!cwd || !branchName) return { error: 'cwd or branch missing' };
    try {
      // execFile com array — branchName e fromBranch vão como argv literal.
      // Git rejeita refs malformadas no nível dele; nada chega pro shell.
      const args = fromBranch
        ? ['checkout', '-b', branchName, fromBranch]
        : ['checkout', '-b', branchName];
      await execFileAsync('git', args, { cwd });
      return { ok: true };
    } catch (err: any) {
      return { error: (err.stderr || err.message || '').toString().trim() || 'create branch falhou' };
    }
  });
}
