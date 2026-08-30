/**
 * M0.6 WebMCP Bridge Server
 *
 * Owns ONE long-lived Chrome instance pointed at the live public HTTPS
 * deployment, with the WebMCP runtime enabled. Exposes a local control API.
 *
 * Two distinct surfaces, deliberately separated:
 *
 *   AGENT SURFACE   /tools  /call        -> re-exposed to the LLM via MCP
 *   HUMAN SURFACE   /approve /reset ...  -> driver only, NEVER given to the LLM
 *
 * The agent can never reach the approval control, because the approval
 * control is not part of the tool set the agent is handed.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = +(process.env.BRIDGE_PORT || 4310);
const APP_URL = process.env.APP_URL || 'https://post-purchase-resolution.vercel.app/';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = process.env.OUT_DIR || path.join(__dirname, '..', 'evidence', 'm0-agent');

fs.mkdirSync(OUT_DIR, { recursive: true });

const eventsPath = path.join(OUT_DIR, 'agent-events.jsonl');
const toolsPath = path.join(OUT_DIR, 'agent-tools.jsonl');

function logEvent(obj) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...obj });
  fs.appendFileSync(eventsPath, line + '\n');
  console.log('[event]', line);
}
function logToolRecord(obj) {
  fs.appendFileSync(toolsPath, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n');
}

let page, browser;

// -- page helpers ------------------------------------------------------

// Chrome's WebMCP getTools() returns inputSchema (and annotations) as
// SERIALIZED JSON STRINGS, not objects. An MCP client that forwards the
// string verbatim will have every tool silently rejected as schema-invalid.
// Normalise to real objects here.
function normalize(v) {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (e) { return undefined; }
  }
  try { return JSON.parse(JSON.stringify(v)); } catch (e) { return undefined; }
}

async function readTools() {
  const raw = await page.evaluate(async () => {
    if (!('modelContext' in document)) return { error: 'no modelContext' };
    const tools = await document.modelContext.getTools();
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    }));
  });
  if (!Array.isArray(raw)) return raw;
  return raw.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: normalize(t.inputSchema),
    annotations: normalize(t.annotations),
  }));
}

async function callTool(name, args) {
  return page.evaluate(async (n, a) => {
    if (!('modelContext' in document)) return { ok: false, error: 'no modelContext' };
    const tools = await document.modelContext.getTools();
    const t = tools.find(x => x.name === n);
    if (!t) {
      return {
        ok: false,
        error: 'Tool "' + n + '" is not currently available on this page.',
        available: tools.map(x => x.name),
      };
    }
    try {
      const raw = await document.modelContext.executeTool(t, JSON.stringify(a || {}));
      return { ok: true, raw: typeof raw === 'string' ? raw : JSON.stringify(raw) };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }, name, args);
}

async function readState() {
  return page.evaluate(() => {
    const active = document.querySelector('.state-step.active');
    const badge = document.getElementById('webmcp-badge');
    const resPanel = document.getElementById('resolution-panel');
    const resolvedPanel = document.getElementById('resolved-panel');
    const idEl = resolvedPanel ? resolvedPanel.querySelector('.resolved-id code') : null;
    return {
      state: active ? active.dataset.state : null,
      badge: badge ? badge.textContent.trim() : null,
      resolutionReadyVisible: !!(resPanel && !resPanel.classList.contains('hidden')),
      resolvedVisible: !!(resolvedPanel && !resolvedPanel.classList.contains('hidden')),
      replacementId: (resolvedPanel && !resolvedPanel.classList.contains('hidden') && idEl) ? idEl.textContent : null,
      activeToolChips: Array.from(document.querySelectorAll('#tools-list .tool-chip')).map(c => c.textContent.trim()),
      debugHarnessPresent: !!document.getElementById('debug-panel'),
      auditTrail: Array.from(document.querySelectorAll('.audit-entry')).map(e => ({
        actor: (e.querySelector('.audit-actor') || {}).textContent || '',
        message: (e.querySelector('.audit-message') || {}).textContent || '',
        time: (e.querySelector('.audit-time') || {}).textContent || '',
      })),
    };
  });
}

// -- http control api --------------------------------------------------

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => (b += c));
    req.on('end', () => {
      try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve({}); }
    });
  });
}

async function main() {
  console.log('[bridge] launching Chrome with WebMCP enabled...');
  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME_PATH,
    args: [
      '--enable-features=WebMCPTesting,DevToolsWebMCPSupport',
      '--enable-experimental-web-platform-features',
      '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    ],
    defaultViewport: { width: 1280, height: 1000 },
  });

  page = await browser.newPage();
  page.on('console', m => logEvent({ kind: 'console', type: m.type(), text: m.text() }));
  page.on('pageerror', e => logEvent({ kind: 'pageerror', text: e.message }));

  console.log('[bridge] navigating to', APP_URL);
  await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 45000 });
  await new Promise(r => setTimeout(r, 2500));

  // Mirror page toolchange events into the evidence stream.
  await page.exposeFunction('__bridgeToolChange', payload => logEvent({ kind: 'toolchange', ...payload }));
  await page.evaluate(() => {
    if ('modelContext' in document) {
      document.modelContext.addEventListener('toolchange', async () => {
        const tools = await document.modelContext.getTools();
        const active = document.querySelector('.state-step.active');
        window.__bridgeToolChange({
          tools: tools.map(t => t.name),
          state: active ? active.dataset.state : null,
        });
      });
    }
  });

  const boot = await readState();
  const bootTools = await readTools();
  logEvent({ kind: 'bridge_ready', url: APP_URL, state: boot, tools: bootTools });
  console.log('[bridge] state:', JSON.stringify(boot));
  console.log('[bridge] tools:', JSON.stringify(Array.isArray(bootTools) ? bootTools.map(t => t.name) : bootTools));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/health') return json(res, 200, { ok: true, appUrl: APP_URL });

      if (url.pathname === '/tools') {
        return json(res, 200, { tools: await readTools() });
      }

      if (url.pathname === '/call' && req.method === 'POST') {
        const body = await readBody(req);
        const before = await readState();
        logEvent({ kind: 'agent_tool_call', tool: body.name, args: body.args, stateBefore: before.state });
        const out = await callTool(body.name, body.args);
        await new Promise(r => setTimeout(r, 400)); // let async tool lifecycle settle
        const after = await readState();
        const toolsAfter = await readTools();
        const names = Array.isArray(toolsAfter) ? toolsAfter.map(t => t.name) : toolsAfter;
        logEvent({
          kind: 'agent_tool_result', tool: body.name, ok: out.ok,
          result: out.raw || out.error, stateAfter: after.state, toolsAfter: names,
        });
        logToolRecord({
          source: 'AGENT', transport: 'document.modelContext.executeTool',
          tool: body.name, args: body.args, ok: out.ok, result: out.raw || out.error,
          stateBefore: before.state, stateAfter: after.state, toolsAfter: names,
        });
        return json(res, 200, out);
      }

      if (url.pathname === '/state') return json(res, 200, await readState());

      // -- HUMAN SURFACE -- never exposed to the agent --
      if (url.pathname === '/approve' && req.method === 'POST') {
        const before = await readState();
        const clicked = await page.evaluate(() => {
          const b = document.getElementById('btn-approve');
          if (!b || b.offsetParent === null) return false;
          b.click();
          return true;
        });
        await new Promise(r => setTimeout(r, 500));
        const after = await readState();
        const toolsAfter = await readTools();
        const names = Array.isArray(toolsAfter) ? toolsAfter.map(t => t.name) : toolsAfter;
        logEvent({
          kind: 'human_approval', actor: 'HUMAN', control: '#btn-approve', clicked,
          stateBefore: before.state, stateAfter: after.state, toolsAfter: names,
        });
        return json(res, 200, { clicked, before, after, toolsAfter: names });
      }

      if (url.pathname === '/reset' && req.method === 'POST') {
        await page.evaluate(() => document.getElementById('btn-reset').click());
        await new Promise(r => setTimeout(r, 600));
        const after = await readState();
        logEvent({ kind: 'reset', actor: 'HUMAN', stateAfter: after.state });
        return json(res, 200, after);
      }

      if (url.pathname === '/reload' && req.method === 'POST') {
        await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 45000 });
        await new Promise(r => setTimeout(r, 2500));
        const after = await readState();
        logEvent({ kind: 'reload', actor: 'HUMAN', stateAfter: after.state });
        return json(res, 200, after);
      }

      if (url.pathname === '/screenshot' && req.method === 'POST') {
        const body = await readBody(req);
        const p = path.join(OUT_DIR, body.name);
        await page.screenshot({ path: p, fullPage: true });
        logEvent({ kind: 'screenshot', file: body.name });
        return json(res, 200, { ok: true, path: p });
      }

      if (url.pathname === '/note' && req.method === 'POST') {
        const body = await readBody(req);
        logEvent(Object.assign({ kind: 'note' }, body));
        return json(res, 200, { ok: true });
      }

      if (url.pathname === '/shutdown' && req.method === 'POST') {
        json(res, 200, { ok: true });
        setTimeout(async () => { await browser.close(); server.close(); process.exit(0); }, 200);
        return;
      }

      return json(res, 404, { error: 'not found' });
    } catch (e) {
      return json(res, 500, { error: String((e && e.message) || e) });
    }
  });

  server.listen(PORT, () => console.log('[bridge] control API on http://127.0.0.1:' + PORT));
}

main().catch(e => { console.error('[bridge] FATAL', e); process.exit(1); });
