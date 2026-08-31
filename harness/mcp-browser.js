/**
 * BASELINE mode MCP server — generic browser interaction, no WebMCP.
 *
 * Exposes exactly what a competent browser-driving agent has: read the page,
 * press a control. Nothing product-specific, no policy schema, no enum of
 * valid options, no structured merchant facts.
 *
 * The page it drives is the SAME live product the WebMCP mode drives.
 */

const http = require('http');
const fs = require('fs');

const BRIDGE = 'http://127.0.0.1:' + (process.env.BRIDGE_PORT || 4320);
const LOG = process.env.MCP_LOG || null;

const trace = o => { if (LOG) { try { fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n'); } catch (e) {} } };

function bridge(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(BRIDGE + pathname, {
      method: body ? 'POST' : 'GET',
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
    }, res => {
      let b = '';
      res.on('data', c => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(b)); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function renderPage(snap) {
  const lines = [];
  lines.push(`PAGE: ${snap.title}`);
  if (snap.progress) lines.push(`PROGRESS INDICATOR: ${snap.progress}`);
  lines.push('');
  lines.push('--- VISIBLE PAGE TEXT ---');
  lines.push(snap.text);
  lines.push('');
  lines.push('--- CONTROLS YOU CAN PRESS ---');
  if (!snap.controls.length) lines.push('(none)');
  for (const c of snap.controls) {
    lines.push(`[ref=${c.ref}] "${c.label}"${c.context ? ` (within: ${c.context})` : ''}${c.disabled ? ' [DISABLED]' : ''}`);
  }
  return lines.join('\n');
}

const TOOLS = [
  {
    name: 'read_page',
    description:
      'Read the web page the user is currently viewing: its visible text and the ' +
      'controls that can be pressed right now. Use this to see the current state ' +
      'of the page and after any action to see what changed.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'click',
    description:
      'Press a control on the page. Supply the ref of the control exactly as shown ' +
      'in the most recent read_page output (for example "c3"). Returns the updated page.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string', description: 'The ref of the control to press, e.g. "c3".' } },
      required: ['ref'],
      additionalProperties: false,
    },
  },
];

const send = m => { process.stdout.write(JSON.stringify(m) + '\n'); trace({ dir: 'out', msg: m }); };
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: (params && params.protocolVersion) || '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'browser-baseline', version: '1.0.0' },
    });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS });
  if (method === 'resources/list') return reply(id, { resources: [] });
  if (method === 'prompts/list') return reply(id, { prompts: [] });

  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    try {
      if (name === 'read_page') {
        const snap = await bridge('/browser/read');
        return reply(id, { content: [{ type: 'text', text: renderPage(snap) }] });
      }
      if (name === 'click') {
        const out = await bridge('/browser/click', { ref: args.ref });
        if (!out.ok) {
          return reply(id, {
            content: [{ type: 'text', text: `Could not press ${args.ref}: ${out.error}\n\n${renderPage(out.page || { title: '', text: '', controls: [] })}` }],
            isError: true,
          });
        }
        return reply(id, {
          content: [{ type: 'text', text: `Pressed "${out.label}".\n\n${renderPage(out.page)}` }],
        });
      }
      return fail(id, -32602, 'Unknown tool: ' + name);
    } catch (e) {
      return fail(id, -32603, 'Tool failed: ' + e.message);
    }
  }

  if (typeof id !== 'undefined') return fail(id, -32601, 'Method not found: ' + method);
}

let pending = 0, ended = false;
const maybeExit = () => { if (ended && pending === 0) process.exit(0); };

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch (e) { continue; }
    trace({ dir: 'in', msg });
    pending++;
    Promise.resolve(handle(msg)).catch(e => trace({ dir: 'err', error: String(e) })).then(() => { pending--; maybeExit(); });
  }
});
process.stdin.on('end', () => { ended = true; maybeExit(); });
