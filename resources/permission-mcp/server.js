// @ts-nocheck
/**
 * UNDRCode permission MCP server.
 *
 * Roda como child process do main process do Electron. Expoe UM tool MCP
 * (`approval_prompt`) que o Claude CLI chama via `--permission-prompt-tool
 * mcp__undrcode_permission__approval_prompt` quando precisa de permissao
 * pra executar uma tool de risco.
 *
 * Protocolo:
 *   - stdin/stdout: JSON-RPC 2.0 line-delimited (MCP stdio transport).
 *   - Pra cada `tools/call` que chega, abre conexao TCP com o main process
 *     (porta passada via env `UNDRCODE_PERM_BRIDGE_PORT` + token via
 *     `UNDRCODE_PERM_BRIDGE_TOKEN` pra auth basico).
 *   - Manda payload {requestId, tool_name, input, tool_use_id} pelo socket
 *     e fica esperando UMA linha JSON de resposta `{behavior, updatedInput?,
 *     message?}`. Daí responde pro CLI via MCP.
 *
 * Designado pra ser invocado pelo CLI via:
 *   {
 *     "command": "node",
 *     "args": ["<path>/server.js"],
 *     "env": { "UNDRCODE_PERM_BRIDGE_PORT": "12345", "UNDRCODE_PERM_BRIDGE_TOKEN": "..." }
 *   }
 *
 * Pra debugar: roda manual com env vars setadas e manda JSON-RPC no stdin.
 */

const net = require('net');
const { randomUUID } = require('crypto');

const BRIDGE_PORT = parseInt(process.env.UNDRCODE_PERM_BRIDGE_PORT || '0', 10);
const BRIDGE_TOKEN = process.env.UNDRCODE_PERM_BRIDGE_TOKEN || '';

// stderr logger (NUNCA escreve em stdout — esse é o canal MCP). Visivel via
// claude --verbose ou /tmp/claude-mcp-logs/.
function logErr(...args) {
  try {
    process.stderr.write('[undrcode-perm-mcp] ' + args.map(String).join(' ') + '\n');
  } catch (_) {
    // noop
  }
}

if (!BRIDGE_PORT || !BRIDGE_TOKEN) {
  logErr('FATAL: missing UNDRCODE_PERM_BRIDGE_PORT or UNDRCODE_PERM_BRIDGE_TOKEN env vars');
  process.exit(1);
}

// ===== MCP transport: line-delimited JSON-RPC sobre stdin/stdout =====

let stdinBuf = '';

function send(msg) {
  try {
    process.stdout.write(JSON.stringify(msg) + '\n');
  } catch (err) {
    logErr('stdout write failed:', err && err.message);
  }
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

// ===== bridge: pede decisao pro main process via TCP =====

function askMain(toolName, input, toolUseId) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const sock = net.connect({ host: '127.0.0.1', port: BRIDGE_PORT }, () => {
      const payload = {
        token: BRIDGE_TOKEN,
        requestId,
        toolName,
        input: input || {},
        toolUseId: toolUseId || null,
      };
      sock.write(JSON.stringify(payload) + '\n');
    });

    let buf = '';
    let done = false;
    sock.setEncoding('utf-8');
    sock.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      try {
        const decision = JSON.parse(line);
        done = true;
        sock.end();
        resolve(decision);
      } catch (err) {
        done = true;
        sock.destroy();
        reject(new Error('bridge response not JSON: ' + line.slice(0, 200)));
      }
    });
    sock.on('error', (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
    sock.on('close', () => {
      if (done) return;
      done = true;
      reject(new Error('bridge socket closed before response'));
    });
  });
}

// ===== MCP method handlers =====

async function handleRequest(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'undrcode-permission', version: '1.0.0' },
    });
  }

  if (method === 'notifications/initialized' || method === 'initialized') {
    // Notification (no id) — sem reply
    return;
  }

  if (method === 'tools/list') {
    return reply(id, {
      tools: [
        {
          name: 'approval_prompt',
          description:
            'Solicita aprovacao do usuario UNDRCode pra uma tool call. Retorna allow/deny.',
          inputSchema: {
            type: 'object',
            properties: {
              tool_name: { type: 'string' },
              input: { type: 'object' },
              tool_use_id: { type: 'string' },
            },
            required: ['tool_name', 'input'],
          },
        },
      ],
    });
  }

  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    if (name !== 'approval_prompt') {
      return replyError(id, -32601, 'unknown tool: ' + name);
    }
    try {
      const decision = await askMain(args.tool_name, args.input, args.tool_use_id);
      // Estrutura esperada pelo CLI: text content com JSON stringificado.
      // CLI parseia o text como JSON e extrai {behavior, updatedInput?, message?}.
      const payload = {
        behavior: decision.behavior === 'allow' ? 'allow' : 'deny',
      };
      if (payload.behavior === 'allow') {
        // updatedInput precisa ser o input que vai EXECUTAR. Se user nao mexeu,
        // ecoa o input original (CLI exige campo presente quando allow).
        payload.updatedInput =
          decision.updatedInput !== undefined ? decision.updatedInput : args.input || {};
      } else {
        payload.message =
          typeof decision.message === 'string' && decision.message
            ? decision.message
            : 'Permissao negada pelo usuario';
      }
      return reply(id, {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
      });
    } catch (err) {
      logErr('bridge ask failed:', err && err.message);
      // Falha de bridge = deny defensivo. Nao trava o CLI.
      return reply(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              behavior: 'deny',
              message:
                'UNDRCode bridge falhou: ' + (err && err.message ? err.message : 'unknown'),
            }),
          },
        ],
      });
    }
  }

  // method desconhecido
  if (id !== undefined) {
    return replyError(id, -32601, 'method not found: ' + method);
  }
}

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  stdinBuf += chunk;
  let nl;
  while ((nl = stdinBuf.indexOf('\n')) >= 0) {
    const line = stdinBuf.slice(0, nl).trim();
    stdinBuf = stdinBuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      logErr('invalid json line:', line.slice(0, 200));
      continue;
    }
    // Processa async sem esperar — JSON-RPC permite reorder por id
    Promise.resolve()
      .then(() => handleRequest(msg))
      .catch((err) => {
        logErr('handler crashed:', err && err.message);
        if (msg && msg.id !== undefined) {
          replyError(msg.id, -32603, 'internal error: ' + (err && err.message));
        }
      });
  }
});

process.stdin.on('end', () => {
  logErr('stdin closed, exiting');
  process.exit(0);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

logErr('ready, bridge port =', BRIDGE_PORT);
