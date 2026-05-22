#!/usr/bin/env node
/**
 * undrcode CLI
 * ------------
 * Binário pequeno em Node.js que fala com a instância UNDRCode rodando via
 * named pipe (Windows) ou Unix Domain Socket (Linux/macOS).
 *
 * Comandos:
 *   undrcode                       Abre app (focus ou spawn)
 *   undrcode <folder>              Abre como workspace
 *   undrcode <file>                Abre arquivo
 *   undrcode --goto path:L:C       Abre file na posição (col opcional)
 *   undrcode --diff a.txt b.txt    Abre diff entre dois arquivos
 *   undrcode --help                Esta ajuda
 *   undrcode --version             Versão
 *
 * Comportamento:
 *   - Se já tem instância rodando: conecta no pipe e envia o comando.
 *   - Se não: imprime mensagem útil. Sem auto-spawn pra evitar herança de
 *     env do shell e PATH errado (instale UNDRCode antes; abra-o; depois
 *     use `undrcode` no terminal).
 */

'use strict';

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

function pipePath() {
  if (process.platform === 'win32') return '\\\\.\\pipe\\undrcode';
  const user = (os.userInfo().username || 'user').replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(os.tmpdir(), 'undrcode.' + user + '.sock');
}

function printHelp() {
  process.stdout.write(
    [
      'undrcode ' + VERSION,
      '',
      'Usage:',
      '  undrcode                       Focus running UNDRCode (or print hint)',
      '  undrcode <folder>              Open folder as workspace',
      '  undrcode <file>                Open file in editor',
      '  undrcode --goto path:LINE[:COL]  Open file at position',
      '  undrcode --diff <a> <b>        Open diff between two files',
      '  undrcode --help                Show this help',
      '  undrcode --version             Show version',
      '',
      'Tip: start UNDRCode before running this CLI.',
      '',
    ].join('\n'),
  );
}

function resolvePath(p) {
  if (!p) return p;
  try {
    return path.resolve(p);
  } catch {
    return p;
  }
}

/**
 * Parse argv → array de comandos a enviar. Retorna { cmds, error }.
 */
function parseArgs(argv) {
  const cmds = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (a === '--version' || a === '-v') {
      process.stdout.write('undrcode ' + VERSION + '\n');
      process.exit(0);
    } else if (a === '--goto' || a === '-g') {
      const target = argv[++i];
      if (!target) return { cmds: [], error: '--goto requires an argument' };
      // Path pode ter "C:\..." no Windows; pega line/col do final.
      const m1 = target.match(/^(.*):(\d+):(\d+)$/);
      const m2 = target.match(/^(.*):(\d+)$/);
      if (m1 && m1[1].length > 1) {
        cmds.push({ kind: 'goto', path: resolvePath(m1[1]), line: parseInt(m1[2], 10), col: parseInt(m1[3], 10) });
      } else if (m2 && m2[1].length > 1) {
        cmds.push({ kind: 'goto', path: resolvePath(m2[1]), line: parseInt(m2[2], 10) });
      } else {
        cmds.push({ kind: 'open', path: resolvePath(target) });
      }
    } else if (a === '--diff' || a === '-d') {
      const left = argv[++i];
      const right = argv[++i];
      if (!left || !right) return { cmds: [], error: '--diff requires two arguments' };
      cmds.push({ kind: 'diff', left: resolvePath(left), right: resolvePath(right) });
    } else if (a.startsWith('--')) {
      return { cmds: [], error: 'Unknown flag: ' + a };
    } else {
      cmds.push({ kind: 'open', path: resolvePath(a) });
    }
  }
  if (cmds.length === 0) cmds.push({ kind: 'focus' });
  return { cmds };
}

function send(cmds) {
  return new Promise((resolve) => {
    const sock = net.createConnection(pipePath());
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { sock.destroy(); } catch (_) {}
      resolve({ ok: false, error: 'timeout' });
    }, 3000);

    sock.on('connect', () => {
      for (const c of cmds) {
        sock.write(JSON.stringify(c) + '\n');
      }
      // Espera 100ms pelo ack do server, depois fecha.
      setTimeout(() => {
        clearTimeout(timer);
        try { sock.end(); } catch (_) {}
        if (!timedOut) resolve({ ok: true });
      }, 100);
    });

    sock.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.code || err.message });
    });
  });
}

(async function main() {
  const { cmds, error } = parseArgs(process.argv.slice(2));
  if (error) {
    process.stderr.write('undrcode: ' + error + '\n');
    process.exit(2);
  }

  const result = await send(cmds);
  if (result.ok) {
    process.exit(0);
  }

  // Não conseguiu conectar. Provavelmente o app não tá rodando.
  if (result.error === 'ENOENT' || result.error === 'ECONNREFUSED' || result.error === 'timeout') {
    process.stderr.write(
      'undrcode: UNDRCode não está rodando.\n' +
      '  → Inicie o app primeiro, depois rode `undrcode` de novo.\n',
    );
    process.exit(1);
  }
  process.stderr.write('undrcode: erro ao conectar (' + result.error + ').\n');
  process.exit(1);
})();
