/**
 * M0.6 WebMCP -> MCP stdio adapter
 *
 * A minimal MCP server (JSON-RPC 2.0 over stdio) that re-exposes, verbatim,
 * whatever tools the LIVE PAGE has published through document.modelContext.
 *
 * It invents nothing. Tool names, descriptions and input schemas all come
 * from the page's own getTools(). Calls are executed in the page through
 * document.modelContext.executeTool().
 *
 * Only /tools and /call from the bridge are reachable here. The human
 * approval control is deliberately NOT exposed, so the connected model has
 * no path to approving on the human's behalf.
 *
 * Tool list is re-read from the page on every tools/list, and a
 * notifications/tools/list_changed is emitted when the page's published set
 * changes, so dynamic WebMCP tool lifecycle reaches the model.
 */

const http = require('http');

const BRIDGE = 'http://127.0.0.1:' + (process.env.BRIDGE_PORT || 4310);
const LOG = process.env.MCP_LOG || null;
const fs = require('fs');

function trace(o) {
  if (!LOG) return;
  try { fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n'); } catch (e) {}
}

function bridge(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      BRIDGE + pathname,
      {
        method: body ? 'POST' : 'GET',
        headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
      },
      res => {
        let b = '';
        res.on('data', c => (b += c));
        res.on('end', () => {
          try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('bad bridge response: ' + b)); }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// -- stdio JSON-RPC ----------------------------------------------------

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
  trace({ dir: 'out', msg });
}

function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

let lastToolSignature = null;

async function fetchTools() {
  const r = await bridge('/tools');
  const tools = Array.isArray(r.tools) ? r.tools : [];
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema || { type: 'object', properties: {} },
  }));
}

// Poll the page so dynamic tool registration/deregistration is pushed to
// the client as a real MCP list_changed notification.
let pollTimer = null;
function startToolWatch() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      const tools = await fetchTools();
      const sig = tools.map(t => t.name).sort().join(',');
      if (lastToolSignature !== null && sig !== lastToolSignature) {
        trace({ dir: 'watch', event: 'tools_changed', from: lastToolSignature, to: sig });
        send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
      }
      lastToolSignature = sig;
    } catch (e) { /* bridge not up yet */ }
  }, 1000);
  pollTimer.unref && pollTimer.unref();
}

async function handle(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    const clientVersion = (params && params.protocolVersion) || '2025-06-18';
    startToolWatch();
    return reply(id, {
      protocolVersion: clientVersion,
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: 'webmcp-page-bridge', version: '1.0.0' },
    });
  }

  if (method === 'notifications/initialized' || method === 'initialized') return;

  if (method === 'ping') return reply(id, {});

  if (method === 'tools/list') {
    try {
      const tools = await fetchTools();
      lastToolSignature = tools.map(t => t.name).sort().join(',');
      trace({ dir: 'listed', tools: tools.map(t => t.name) });
      return reply(id, { tools });
    } catch (e) {
      return fail(id, -32603, 'Could not read tools from page: ' + e.message);
    }
  }

  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    try {
      const out = await bridge('/call', { name, args });
      if (out.ok) {
        return reply(id, { content: [{ type: 'text', text: out.raw }] });
      }
      return reply(id, {
        content: [{ type: 'text', text: JSON.stringify({ error: out.error, available_tools: out.available }) }],
        isError: true,
      });
    } catch (e) {
      return fail(id, -32603, 'Tool execution failed: ' + e.message);
    }
  }

  if (method === 'resources/list') return reply(id, { resources: [] });
  if (method === 'prompts/list') return reply(id, { prompts: [] });

  if (typeof id !== 'undefined') return fail(id, -32601, 'Method not found: ' + method);
}

let pending = 0;
let stdinEnded = false;
function maybeExit() {
  if (stdinEnded && pending === 0) process.exit(0);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { continue; }
    trace({ dir: 'in', msg });
    pending++;
    Promise.resolve(handle(msg))
      .catch(e => trace({ dir: 'err', error: String(e) }))
      .then(() => { pending--; maybeExit(); });
  }
});
process.stdin.on('end', () => { stdinEnded = true; maybeExit(); });
