// Minimal MCP (Model Context Protocol) server over stdio, JSON-RPC 2.0,
// no dependencies. Exposes semantic code search to OpenCode and other MCP
// clients. The protocol for three read-only tools is small enough that a
// framework would only add weight.
//
// Search never blocks on indexing: a missing or stale index is (re)built in the
// background and the call returns whatever is already indexed. stdout carries
// protocol frames only; all diagnostics go to stderr.
import { createInterface } from 'node:readline';

import { DB_PATH, INDEX_ROOTS, OLLAMA_MODEL } from './config.js';
import { build, ensureIndex, isBuilding, searchQuery, status } from './indexer.js';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'code-rag', version: '0.1.0' };
const SNIPPET_LINES = 20;

const TOOLS = [
  {
    name: 'search_code',
    description:
      'Semantic search over the indexed code (and optionally docs). Use this before ' +
      'reading files to locate where a concept lives. Returns ranked chunks with file ' +
      'path, line range and a short snippet; read the file for full context. The index ' +
      'warms up automatically in the background, so a first call in a new project may ' +
      'return few results — fall back to normal search/read and retry shortly. Defaults ' +
      'to code scope because design docs tend to outrank code semantically.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language or keyword query.' },
        k: { type: 'integer', description: 'Max results (default 6, max 20).' },
        scope: {
          type: 'string',
          enum: ['code', 'docs', 'all'],
          description:
            'Where to search. Default "code" (src/); "docs" for design/plan docs; ' +
            '"all" for both.',
        },
        path: {
          type: 'string',
          description: 'Restrict to a path prefix, e.g. "src/core". Overrides scope.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'index_status',
    description:
      'Report index freshness: file/chunk counts, backend, whether a build is running, ' +
      'and last indexed time.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'reindex',
    description:
      'Refresh the index synchronously. Prefer search_code, which already refreshes in ' +
      'the background; call this only when you must wait for the index to be current. ' +
      'Pass full=true to rebuild from scratch.',
    inputSchema: {
      type: 'object',
      properties: { full: { type: 'boolean', description: 'Force a full rebuild.' } },
    },
  },
];

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

function snippet(text) {
  const lines = text.split(/\r?\n/);
  const head = lines.slice(0, SNIPPET_LINES).map((l) => `    ${l}`).join('\n');
  return lines.length > SNIPPET_LINES ? `${head}\n    … (${lines.length - SNIPPET_LINES} more lines)` : head;
}

async function callTool(name, args) {
  if (name === 'search_code') {
    const query = String(args.query ?? '').trim();
    if (!query) throw Object.assign(new Error('search_code: query is required'), { code: -32602 });
    const k = Math.min(Math.max(Number(args.k) || 6, 1), 20);
    let pathPrefix = typeof args.path === 'string' && args.path ? args.path : null;
    if (!pathPrefix) {
      const scope = typeof args.scope === 'string' ? args.scope : 'code';
      if (scope === 'code') pathPrefix = 'src/';
      else if (scope === 'docs') pathPrefix = 'docs/';
      // 'all' (or anything else) leaves pathPrefix null.
    }
    const cold = status().chunks === 0;
    ensureIndex(); // fire-and-forget: never blocks this call
    const results = await searchQuery(query, k, pathPrefix);
    const note = cold
      ? '\n\n(code-rag: no index for this project yet — building it in the background. ' +
        'These results may be incomplete; use normal search/read meanwhile and retry shortly.)'
      : isBuilding()
        ? '\n\n(code-rag: index refresh running in the background; results may lag the working tree.)'
        : '';
    if (results.length === 0) return { content: [{ type: 'text', text: `No results.${note}` }] };
    const text =
      results
        .map((r, i) => {
          const loc = `${r.relpath}:${r.start}-${r.end}`;
          const sym = r.symbol ? ` · ${r.symbol}` : '';
          return `[${i + 1}] ${loc}${sym}  (score ${r.score.toFixed(3)})\n${snippet(r.text)}`;
        })
        .join('\n\n') + note;
    return { content: [{ type: 'text', text }] };
  }

  if (name === 'index_status') {
    const st = status();
    const when = st.lastIndexed ? new Date(st.lastIndexed * 1000).toISOString() : 'never';
    if (st.chunks === 0) ensureIndex(); // warm a fresh project on first check
    const text =
      `files=${st.files} chunks=${st.chunks} last_indexed=${when}\n` +
      `backend=ollama (${OLLAMA_MODEL}) roots=[${INDEX_ROOTS.join(', ')}]\n` +
      `building=${isBuilding() ? 'yes' : 'no'}\ndb=${DB_PATH}`;
    return { content: [{ type: 'text', text }] };
  }

  if (name === 'reindex') {
    if (isBuilding()) await ensureIndex(); // let any background build finish first
    const report = await build({ full: !!args.full, onProgress: () => {} });
    const text =
      `indexed=${report.indexed} skipped=${report.skipped} removed=${report.removed} ` +
      `chunks=${report.chunks} files=${report.totalFiles}`;
    return { content: [{ type: 'text', text }] };
  }

  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    switch (method) {
      case 'initialize':
        reply(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
        return;
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return;
      case 'ping':
        reply(id, {});
        return;
      case 'tools/list':
        reply(id, { tools: TOOLS });
        return;
      case 'tools/call':
        reply(id, await callTool(params?.name, params?.arguments ?? {}));
        return;
      default:
        if (isRequest) fail(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    if (isRequest) fail(id, err.code ?? -32603, err.message ?? String(err));
    else process.stderr.write(`code-rag: ${err.stack ?? err}\n`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    process.stderr.write('code-rag: ignoring malformed JSON line\n');
    return;
  }
  handle(msg).catch((err) => process.stderr.write(`code-rag: ${err.stack ?? err}\n`));
});
// With stdin closed (piped input) the process exits once in-flight tool calls
// resolve; with a live stdin (OpenCode) it stays up. No forced exit, so a
// pending response is never truncated.
