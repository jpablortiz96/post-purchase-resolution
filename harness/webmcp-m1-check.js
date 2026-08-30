/**
 * M1 browser-side WebMCP verification.
 *
 * Exercises the real document.modelContext runtime against the M1 app:
 * tool registration per state, dynamic lifecycle, annotations, the approval
 * gate, "choose another", staleness rejection, and scenario reset.
 *
 * This is protocol verification, not agent evidence. Tools are invoked via
 * executeTool by this script, which is manual invocation by design here.
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3000/';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.env.OUT_DIR || path.join(__dirname, '..', 'evidence', 'm1');

fs.mkdirSync(OUT, { recursive: true });

const results = [];
const rec = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + JSON.stringify(detail) : ''}`);
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tools(page) {
  return page.evaluate(async () => {
    const t = await document.modelContext.getTools();
    return t.map(x => ({
      name: x.name,
      annotations: typeof x.annotations === 'string' ? JSON.parse(x.annotations) : x.annotations,
      schema: typeof x.inputSchema === 'string' ? JSON.parse(x.inputSchema) : x.inputSchema,
    }));
  });
}

async function call(page, name, args) {
  return page.evaluate(async (n, a) => {
    const list = await document.modelContext.getTools();
    const t = list.find(x => x.name === n);
    if (!t) return { ok: false, missing: true, error: `tool ${n} not registered`, available: list.map(x => x.name) };
    try {
      const raw = await document.modelContext.executeTool(t, JSON.stringify(a || {}));
      return { ok: true, raw };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }, name, args);
}

const stateOf = page => page.evaluate(() => window.__session.state);
const names = list => list.map(t => t.name).sort();

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME,
    args: [
      '--enable-features=WebMCPTesting,DevToolsWebMCPSupport',
      '--enable-experimental-web-platform-features',
      '--no-first-run', '--disable-gpu',
    ],
    defaultViewport: { width: 1280, height: 1100 },
  });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('  [page-err]', m.text()); });
  page.on('pageerror', e => console.log('  [page-exception]', e.message));

  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 45000 });
  await sleep(1500);

  // ── A: runtime + initial registration ────────────────────────────
  const hasRuntime = await page.evaluate(() => 'modelContext' in document);
  rec('A · WebMCP runtime available', hasRuntime);
  if (!hasRuntime) { await browser.close(); return finish(); }

  let t = await tools(page);
  rec('B · initial tools match ORDER_ACTIVE',
    JSON.stringify(names(t)) === JSON.stringify(['get_order', 'get_resolution_options', 'prepare_resolution']),
    names(t));

  rec('C · confirm_resolution is NOT registered before approval',
    !names(t).includes('confirm_resolution'));

  // ── D: annotations ───────────────────────────────────────────────
  const ann = Object.fromEntries(t.map(x => [x.name, x.annotations && x.annotations.readOnlyHint]));
  rec('D · readOnly annotations correct',
    ann.get_order === true && ann.get_resolution_options === true && ann.prepare_resolution === false,
    ann);

  // ── E: prepare_resolution schema constrains to eligible ids ──────
  const prep = t.find(x => x.name === 'prepare_resolution');
  const enumIds = prep && prep.schema.properties.resolution_id.enum;
  rec('E · prepare schema enumerates only eligible options',
    JSON.stringify(enumIds) === JSON.stringify(['replacement', 'refund', 'keep_partial_refund']), enumIds);

  // ── F: options tool returns policy truth ─────────────────────────
  let r = await call(page, 'get_resolution_options', {});
  const opts = JSON.parse(r.raw);
  rec('F · get_resolution_options returns 3 policy options',
    opts.options.length === 3 && opts.options[0].id === 'replacement',
    opts.options.map(o => o.id));

  // ── G: ineligible prepare rejected ───────────────────────────────
  r = await call(page, 'prepare_resolution', { resolution_id: 'store_credit', reason: 'not eligible here' });
  let parsed = JSON.parse(r.raw);
  rec('G · ineligible option rejected by prepare',
    parsed.ok === false && (await stateOf(page)) === 'ORDER_ACTIVE', parsed.error);

  // ── H: prepare + lifecycle ───────────────────────────────────────
  r = await call(page, 'prepare_resolution', { resolution_id: 'replacement', reason: 'customer travels tomorrow' });
  parsed = JSON.parse(r.raw);
  await sleep(400);
  t = await tools(page);
  rec('H · prepare stages the resolution and drops prepare_resolution',
    parsed.success === true &&
    (await stateOf(page)) === 'RESOLUTION_PREPARED' &&
    JSON.stringify(names(t)) === JSON.stringify(['get_order', 'get_resolution_options']),
    names(t));

  // ── I: confirm unavailable AND rejected before approval ──────────
  r = await call(page, 'confirm_resolution', { resolution_id: 'replacement' });
  rec('I · confirm_resolution not reachable before approval', r.missing === true, r.error);

  const preApprovalState = await stateOf(page);
  rec('I2 · state unchanged by the attempt', preApprovalState === 'RESOLUTION_PREPARED', preApprovalState);

  // ── J: payload does not lie before approval ──────────────────────
  r = await call(page, 'get_order', {});
  let order = JSON.parse(r.raw);
  rec('J · pre-approval payload requires approval',
    order.resolution.humanApproved === false && order.resolution.requiresHumanApproval === true &&
    order.resolution.status === 'prepared',
    { humanApproved: order.resolution.humanApproved, requires: order.resolution.requiresHumanApproval });

  // ── K: human approval ────────────────────────────────────────────
  await page.evaluate(() => document.getElementById('approve').click());
  await sleep(500);
  t = await tools(page);
  rec('K · human approval registers confirm_resolution',
    (await stateOf(page)) === 'HUMAN_APPROVED' &&
    JSON.stringify(names(t)) === JSON.stringify(['confirm_resolution', 'get_order', 'get_resolution_options']),
    names(t));

  // ── L: M0.6 regression on the live payload ───────────────────────
  r = await call(page, 'get_order', {});
  order = JSON.parse(r.raw);
  rec('L · M0.6 REGRESSION — post-approval payload does not ask for approval again',
    order.resolution.humanApproved === true &&
    order.resolution.requiresHumanApproval === false &&
    order.resolution.status === 'approved_by_customer',
    { humanApproved: order.resolution.humanApproved, requires: order.resolution.requiresHumanApproval, status: order.resolution.status });

  // ── M: stale confirm rejected ────────────────────────────────────
  r = await call(page, 'confirm_resolution', { resolution_id: 'refund' });
  parsed = JSON.parse(r.raw);
  rec('M · confirm with a stale/mismatched id is rejected',
    parsed.ok === false && (await stateOf(page)) === 'HUMAN_APPROVED', parsed.error);

  // ── N: confirm executes ──────────────────────────────────────────
  r = await call(page, 'confirm_resolution', { resolution_id: 'replacement' });
  parsed = JSON.parse(r.raw);
  await sleep(500);
  t = await tools(page);
  rec('N · approved confirm executes and reaches RESOLVED',
    parsed.success === true &&
    parsed.resolution.referenceId === 'R-1042' &&
    (await stateOf(page)) === 'RESOLVED' &&
    JSON.stringify(names(t)) === JSON.stringify(['get_order']),
    { ref: parsed.resolution && parsed.resolution.referenceId, tools: names(t) });

  await page.screenshot({ path: path.join(OUT, 'webmcp_damaged_resolved.png'), fullPage: true });

  // ── O: choose another, then stale rejection, on scenario 2 ───────
  await page.evaluate(() => document.querySelector('[data-scenario="wrong_variant"]').click());
  await sleep(700);
  t = await tools(page);
  rec('O · scenario switch resets tools and state',
    (await stateOf(page)) === 'ORDER_ACTIVE' &&
    JSON.stringify(names(t)) === JSON.stringify(['get_order', 'get_resolution_options', 'prepare_resolution']),
    names(t));

  const prep2 = (await tools(page)).find(x => x.name === 'prepare_resolution');
  rec('O2 · schema enum follows the new scenario',
    JSON.stringify(prep2.schema.properties.resolution_id.enum) === JSON.stringify(['exchange', 'refund', 'store_credit']),
    prep2.schema.properties.resolution_id.enum);

  r = await call(page, 'prepare_resolution', { resolution_id: 'exchange', reason: 'event in three days' });
  await sleep(400);

  // human picks a different option
  await page.evaluate(() => document.getElementById('choose').click());
  await sleep(300);
  await page.evaluate(() => document.querySelector('[data-pick="store_credit"]').click());
  await sleep(200);
  await page.evaluate(() => document.getElementById('use-choice').click());
  await sleep(500);

  const swapped = await page.evaluate(() => window.__session.preparedResolution.option.id);
  rec('P · human can choose another option', swapped === 'store_credit', swapped);

  const stillUnapproved = await page.evaluate(() => window.__session.humanApproved);
  rec('P2 · choosing another does not auto-approve', stillUnapproved === false);

  await page.evaluate(() => document.getElementById('approve').click());
  await sleep(400);
  r = await call(page, 'confirm_resolution', { resolution_id: 'exchange' });
  parsed = JSON.parse(r.raw);
  rec('Q · agent confirming the pre-swap option is rejected',
    parsed.ok === false && (await stateOf(page)) === 'HUMAN_APPROVED', parsed.error);

  r = await call(page, 'confirm_resolution', { resolution_id: 'store_credit' });
  parsed = JSON.parse(r.raw);
  await sleep(400);
  rec('R · confirming the actually-approved option succeeds',
    parsed.success === true && parsed.resolution.referenceId === 'SC-2087',
    parsed.resolution && parsed.resolution.referenceId);

  await page.screenshot({ path: path.join(OUT, 'webmcp_choose_another.png'), fullPage: true });

  // ── S: third scenario reachable ──────────────────────────────────
  await page.evaluate(() => document.querySelector('[data-scenario="arrived_late"]').click());
  await sleep(700);
  r = await call(page, 'get_resolution_options', {});
  const lateOpts = JSON.parse(r.raw).options.map(o => o.id);
  rec('S · third scenario exposes its own policy options',
    JSON.stringify(lateOpts) === JSON.stringify(['return_refund', 'keep_shipping_refund', 'keep_store_credit']),
    lateOpts);

  // ── T: cancel path ───────────────────────────────────────────────
  await call(page, 'prepare_resolution', { resolution_id: 'keep_store_credit', reason: 'event passed' });
  await sleep(400);
  await page.evaluate(() => document.getElementById('cancel').click());
  await sleep(500);
  t = await tools(page);
  rec('T · cancel returns prepare_resolution to the agent',
    (await stateOf(page)) === 'RESOLUTION_CANCELLED' && names(t).includes('prepare_resolution'),
    names(t));

  await page.screenshot({ path: path.join(OUT, 'webmcp_late_cancelled.png'), fullPage: true });

  await browser.close();
  finish();
}

function finish() {
  const passed = results.filter(r => r.pass).length;
  console.log('\n' + '='.repeat(50));
  console.log(`WEBMCP M1: ${passed}/${results.length} passed`);
  console.log('='.repeat(50));
  fs.writeFileSync(path.join(OUT, 'webmcp-lifecycle.json'),
    JSON.stringify({ url: URL, at: new Date().toISOString(), passed, total: results.length, results }, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
