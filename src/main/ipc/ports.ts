import { ipcMain } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';

/**
 * Ports detector — lista portas localhost em LISTENING.
 *
 * Windows: netstat -ano (precisa -o pra PID)
 * Unix:    lsof -i -P -n -sTCP:LISTEN
 *
 * Filtra apenas binds locais: 127.0.0.1, 0.0.0.0, [::1], [::].
 *
 * Eventos:
 *   - ports:list () -> Array<{ port, address, process? }>
 */

const execAsync = promisify(exec);

export interface PortEntry {
  port: number;
  address: string;
  process?: string;
}

const LOCAL_ADDRS = new Set(['127.0.0.1', '0.0.0.0', '::1', '::', '[::1]', '[::]']);

function isLocalAddr(addr: string): boolean {
  return LOCAL_ADDRS.has(addr);
}

/** Parse netstat output (Windows). Linhas tipo:
 *    TCP    127.0.0.1:5173    0.0.0.0:0   LISTENING   12345
 *    TCP    [::]:8080         [::]:0      LISTENING   6789
 */
function parseNetstat(stdout: string): PortEntry[] {
  const result: PortEntry[] = [];
  const seen = new Set<string>();
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('TCP')) continue;
    if (!line.includes('LISTENING')) continue;
    const cols = line.split(/\s+/);
    // cols: [TCP, local, foreign, state, pid]
    if (cols.length < 5) continue;
    const local = cols[1];
    const pid = cols[4];

    // local pode ser 127.0.0.1:5173 ou [::]:8080
    const m = local.match(/^(.+):(\d+)$/);
    if (!m) continue;
    const addr = m[1];
    const port = Number(m[2]);
    if (!isLocalAddr(addr)) continue;
    if (Number.isNaN(port) || port <= 0) continue;
    const key = `${addr}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ port, address: addr, process: pid && pid !== '0' ? `PID ${pid}` : undefined });
  }
  return result.sort((a, b) => a.port - b.port);
}

/** Parse lsof output. Formato com -P -n -sTCP:LISTEN:
 *    node    12345 user   23u  IPv4  ...  TCP 127.0.0.1:5173 (LISTEN)
 *    node    12345 user   24u  IPv6  ...  TCP [::1]:8080 (LISTEN)
 */
function parseLsof(stdout: string): PortEntry[] {
  const result: PortEntry[] = [];
  const seen = new Set<string>();
  const lines = stdout.split(/\r?\n/);
  for (const raw of lines) {
    if (!raw.includes('(LISTEN)')) continue;
    const cols = raw.trim().split(/\s+/);
    if (cols.length < 9) continue;
    const proc = cols[0];
    const pid = cols[1];
    const nameField = cols[cols.length - 2]; // ex: 127.0.0.1:5173
    const m = nameField.match(/^(.+):(\d+)$/);
    if (!m) continue;
    const addr = m[1];
    const port = Number(m[2]);
    if (!isLocalAddr(addr)) continue;
    if (Number.isNaN(port) || port <= 0) continue;
    const key = `${addr}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ port, address: addr, process: `${proc} (${pid})` });
  }
  return result.sort((a, b) => a.port - b.port);
}

async function listPorts(): Promise<PortEntry[]> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync('netstat -ano -p TCP', {
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      });
      return parseNetstat(stdout);
    } else {
      const { stdout } = await execAsync('lsof -i -P -n -sTCP:LISTEN', {
        maxBuffer: 4 * 1024 * 1024,
      });
      return parseLsof(stdout);
    }
  } catch (err) {
    // lsof pode não estar instalado em containers minimos; netstat geralmente ta
    console.warn('[ports] erro listando portas:', (err as Error).message);
    return [];
  }
}

export function registerPortsIPC(): void {
  ipcMain.handle('ports:list', () => listPorts());
}
