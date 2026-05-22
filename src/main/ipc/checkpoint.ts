/**
 * Checkpoint snapshots — IPC handlers.
 *
 * Estilo Cursor/Antigravity: antes de cada agent turn, salvamos snapshot
 * dos arquivos pra user poder "revert to checkpoint" se algo der errado.
 *
 * Storage: <cwd>/.undrcod/checkpoints/<ts>-<label>/
 *   meta.json — { id, label, ts, files: ['rel/path1', ...] }
 *   files/<sub/path/file.ts> — cópia real dos arquivos dirty no momento
 *
 * Strategy: usa `git diff --name-only HEAD` pra coletar tracked dirty +
 * `git ls-files --others --exclude-standard` pra untracked. Cada file é
 * copiado pra <cpDir>/files/<rel> preservando estrutura. Revert reverte
 * copiando de volta pro cwd.
 *
 * Workspaces non-git: snapshot fica vazio (sem files). Listagem/delete OK.
 */
import { ipcMain } from 'electron';
import { mkdir, readFile, writeFile, readdir, rm, copyFile } from 'fs/promises';
import { join, dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface CheckpointMeta {
  id: string;
  ts: number;
  label: string;
  files: string[];
}

interface CheckpointEntry {
  id: string;
  ts: number;
  label: string;
  fileCount: number;
}

function safeLabel(label: string): string {
  return label.replace(/[^a-z0-9-]/gi, '_').slice(0, 64) || 'snapshot';
}

function checkpointsDir(cwd: string): string {
  return join(cwd, '.undrcod', 'checkpoints');
}

/**
 * Coleta lista de paths (relativos ao cwd) que estão dirty:
 * - `git diff --name-only HEAD` cobre tracked modificados (staged + unstaged)
 * - `git ls-files --others --exclude-standard` cobre untracked não-ignorados
 * Retorna array vazio em workspaces não-git ou em erro.
 */
async function collectDirtyFiles(cwd: string): Promise<string[]> {
  const out = new Set<string>();
  try {
    const { stdout } = await execAsync('git diff --name-only HEAD', { cwd, maxBuffer: 10 * 1024 * 1024 });
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) out.add(trimmed);
    }
  } catch {
    // não-git ou HEAD inexistente — ignora silencioso
  }
  try {
    const { stdout } = await execAsync('git ls-files --others --exclude-standard', {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) out.add(trimmed);
    }
  } catch {
    // idem
  }
  return [...out];
}

export function registerCheckpointIPC(): void {
  /**
   * Cria snapshot real: copia arquivos dirty pra .undrcod/checkpoints/<id>/files/.
   * Retorna { ok, id, fileCount }.
   */
  ipcMain.handle('checkpoint:create', async (_evt, cwd: string, label: string) => {
    if (!cwd) return { ok: false, error: 'cwd ausente' };
    const ts = Date.now();
    const id = `${ts}-${safeLabel(label)}`;
    const cpDir = join(checkpointsDir(cwd), id);
    const filesDir = join(cpDir, 'files');
    try {
      await mkdir(filesDir, { recursive: true });

      const dirty = await collectDirtyFiles(cwd);
      const copied: string[] = [];
      for (const rel of dirty) {
        try {
          const src = join(cwd, rel);
          const dst = join(filesDir, rel);
          await mkdir(dirname(dst), { recursive: true });
          await copyFile(src, dst);
          copied.push(rel);
        } catch {
          // File pode ter sumido entre o git ls e o copy — skip silencioso.
        }
      }

      const meta: CheckpointMeta = { id, ts, label, files: copied };
      await writeFile(join(cpDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
      return { ok: true, id, fileCount: copied.length };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /**
   * Lista todos checkpoints do cwd, ordenado do mais recente pro mais antigo.
   * Retorna lista vazia se diretório não existe (ainda nunca criou snapshot).
   * Inclui fileCount pra UI exibir "N arquivos snapshot".
   */
  ipcMain.handle('checkpoint:list', async (_evt, cwd: string) => {
    if (!cwd) return { ok: true, checkpoints: [] as CheckpointEntry[] };
    const dir = checkpointsDir(cwd);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      const items: CheckpointEntry[] = [];
      for (const entryName of dirs) {
        try {
          const raw = await readFile(join(dir, entryName, 'meta.json'), 'utf-8');
          const meta = JSON.parse(raw) as Partial<CheckpointMeta>;
          if (typeof meta.ts !== 'number' || typeof meta.label !== 'string') continue;
          const fileCount = Array.isArray(meta.files) ? meta.files.length : 0;
          items.push({ id: entryName, ts: meta.ts, label: meta.label, fileCount });
        } catch {
          // Diretório sem meta.json válido — ignora silencioso.
        }
      }
      items.sort((a, b) => b.ts - a.ts);
      return { ok: true, checkpoints: items };
    } catch {
      return { ok: true, checkpoints: [] as CheckpointEntry[] };
    }
  });

  /**
   * Aplica checkpoint: copia files de .undrcod/checkpoints/<id>/files/ pro cwd.
   * Retorna { ok, restored } com count dos arquivos efetivamente revertidos.
   */
  ipcMain.handle('checkpoint:revert', async (_evt, cwd: string, id: string) => {
    if (!cwd || !id) return { ok: false, error: 'cwd ou id ausente' };
    const cpDir = join(checkpointsDir(cwd), id);
    const filesDir = join(cpDir, 'files');
    try {
      const raw = await readFile(join(cpDir, 'meta.json'), 'utf-8');
      const meta = JSON.parse(raw) as Partial<CheckpointMeta>;
      if (!Array.isArray(meta.files)) {
        return { ok: false, error: 'meta.files inválido' };
      }

      let restored = 0;
      for (const rel of meta.files) {
        try {
          const src = join(filesDir, rel);
          const dst = join(cwd, rel);
          await mkdir(dirname(dst), { recursive: true });
          await copyFile(src, dst);
          restored++;
        } catch (err) {
          console.warn('[checkpoint:revert] skip', rel, err);
        }
      }
      return { ok: true, restored };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /**
   * Deleta checkpoint inteiro (diretório + meta + files/).
   */
  ipcMain.handle('checkpoint:delete', async (_evt, cwd: string, id: string) => {
    if (!cwd || !id) return { ok: false, error: 'cwd ou id ausente' };
    try {
      await rm(join(checkpointsDir(cwd), id), { recursive: true, force: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
