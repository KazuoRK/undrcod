import { ipcMain, app } from 'electron';
import { spawn } from 'child_process';
import { writeFile, readFile, unlink, stat } from 'fs/promises';
import { randomUUID } from 'crypto';
import { join, dirname } from 'path';

// === Whisper.cpp speech-to-text IPC ===
// Wraps whisper-cli.exe (compilado do whisper.cpp). Procura binário em 3 lugares
// (bundled dev / packaged resources / userData) e modelo em userData ou ao lado
// do binário. Modelo padrão: ggml-base.bin; fallback ggml-small.bin (mais qualidade).

type SetupOk = { ok: true; binary: string; model: string };
type SetupFail = { ok: false; reason: 'no-binary' | 'no-model'; expectedDir: string };
type SetupResult = SetupOk | SetupFail;

const MODEL_CANDIDATES = ['ggml-base.bin', 'ggml-small.bin'];
const SPAWN_TIMEOUT_MS = 60_000;

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

/** Procura whisper-cli.exe em várias localizações possíveis (dev, packaged, user-installed). */
async function findBinary(): Promise<string | null> {
  const appPath = app.getAppPath();
  const candidates = [
    join(appPath, 'resources/whisper/whisper-cli.exe'),         // dev: projectRoot/resources/whisper
    join(appPath, '../resources/whisper/whisper-cli.exe'),      // dev fallback: 1 nivel acima
    join(appPath, '../../resources/whisper/whisper-cli.exe'),   // dev fallback: 2 niveis acima
    join(process.cwd(), 'resources/whisper/whisper-cli.exe'),   // cwd-relative
    join(process.resourcesPath, 'whisper/whisper-cli.exe'),     // packaged: resourcesPath/whisper
    join(app.getPath('userData'), 'whisper/whisper-cli.exe'),   // user-installed
  ];
  for (const c of candidates) {
    if (await fileExists(c)) return c;
  }
  return null;
}

/** Procura modelo em userData/whisper ou na pasta do binário. */
async function findModel(binaryPath: string | null): Promise<string | null> {
  const dirs = [join(app.getPath('userData'), 'whisper')];
  if (binaryPath) dirs.push(dirname(binaryPath));
  for (const dir of dirs) {
    for (const name of MODEL_CANDIDATES) {
      const p = join(dir, name);
      if (await fileExists(p)) return p;
    }
  }
  return null;
}

async function checkSetup(): Promise<SetupResult> {
  const expectedDir = join(app.getPath('userData'), 'whisper');
  const binary = await findBinary();
  if (!binary) return { ok: false, reason: 'no-binary', expectedDir };
  const model = await findModel(binary);
  if (!model) return { ok: false, reason: 'no-model', expectedDir };
  return { ok: true, binary, model };
}

/** Remove linhas de log/timestamps do stdout do whisper-cli, devolve texto puro. */
function parseStdout(stdout: string): string {
  const TS_LINE = /^\s*\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/;
  return stdout
    .split(/\r?\n/)
    .map((line) => {
      const m = line.match(TS_LINE);
      // Se for linha de timestamp, pega só o texto após o `]`
      if (m) return line.slice(m[0].length).trim();
      // Filtra linhas que parecem log do whisper (começam com `whisper_` ou `[`)
      if (/^whisper_/.test(line) || /^\s*\[/.test(line)) return '';
      return line.trim();
    })
    .filter((l) => l.length > 0)
    .join(' ')
    .trim();
}

async function safeUnlink(p: string): Promise<void> {
  try {
    await unlink(p);
  } catch {
    /* ignore */
  }
}

/** Executa whisper-cli num WAV temporário, retorna texto transcrito ou erro. */
async function transcribe(wavBytes: ArrayBuffer | Uint8Array): Promise<
  { ok: true; text: string } | { ok: false; error: string }
> {
  const setup = await checkSetup();
  if (setup.ok === false) {
    const msg = setup.reason === 'no-binary'
      ? `whisper-cli.exe não encontrado (esperado em ${setup.expectedDir})`
      : `Modelo whisper não encontrado (esperado em ${setup.expectedDir})`;
    return { ok: false, error: msg };
  }

  const buf = wavBytes instanceof Uint8Array ? wavBytes : new Uint8Array(wavBytes);
  const tempWav = join(app.getPath('temp'), `whisper-${Date.now()}-${randomUUID().slice(0, 8)}.wav`);
  const tempTxt = `${tempWav}.txt`;

  try {
    await writeFile(tempWav, buf);
  } catch (err: any) {
    return { ok: false, error: `Falha ao escrever WAV temporário: ${err.message}` };
  }

  const args = ['-m', setup.model, '-f', tempWav, '-l', 'pt', '--no-timestamps', '--output-txt', '--no-prints'];

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const proc = spawn(setup.binary, args, { cwd: dirname(setup.binary), windowsHide: true });
      let out = '';
      let err = '';
      let settled = false;

      // Timeout 60s — mata processo e rejeita.
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { proc.kill('SIGKILL'); } catch { /* ignore */ }
        reject(new Error('Timeout: transcrição passou de 60s'));
      }, SPAWN_TIMEOUT_MS);

      proc.stdout.on('data', (d) => { out += d.toString('utf8'); });
      proc.stderr.on('data', (d) => { err += d.toString('utf8'); });

      proc.on('error', (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      });

      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve(out);
        } else {
          // Stderr pode conter "unknown argument: --no-prints" se binário for antigo;
          // ainda assim, se exit != 0, propaga como erro.
          const tail = err.trim().split(/\r?\n/).slice(-3).join(' | ');
          reject(new Error(`whisper-cli exit ${code}: ${tail || 'sem stderr'}`));
        }
      });
    });

    // Lê transcript: primeiro o .txt gerado pelo --output-txt, senão parse do stdout.
    let text = '';
    if (await fileExists(tempTxt)) {
      const raw = await readFile(tempTxt, 'utf-8');
      text = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' ').trim();
    } else {
      text = parseStdout(stdout);
    }

    return { ok: true, text };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  } finally {
    await safeUnlink(tempWav);
    await safeUnlink(tempTxt);
  }
}

export function registerWhisperIPC(): void {
  ipcMain.handle('whisper:checkSetup', () => checkSetup());

  ipcMain.handle('whisper:transcribe', async (_, payload: { wavBytes: ArrayBuffer | Uint8Array }) => {
    if (!payload || !payload.wavBytes) {
      return { ok: false, error: 'wavBytes ausente no payload' };
    }
    return transcribe(payload.wavBytes);
  });
}
