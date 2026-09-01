/**
 * M3 browser-side WebMCP verification, against the new authority model.
 *
 * Central question: is there ANY way, through the WebMCP contract, to complete
 * a resolution? There must not be.
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3000/';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.env.OUT_DIR || path.join(__dirname, '..', 'evidence', 'm3', 'capability-boundary');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const rec = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 170) : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tools(page) {
  return page.evaluate(async () => {
    const t = await document.modelContext.getTools();
    return t.map(x => ({
      name: x.name,
      description: x.description,
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
    try { return { ok: true, raw: await document.modelContext.executeTool(t, JSON.stringify(a || {})) }; }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }, name, args);
}
const stateOf = page => page.evaluate(() => window.__session.state);
const names = l => l.map(t => t.name).sort();

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new', executablePath: CHROME,
    args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport',
           '--enable-experimental-web-platform-features', '--no-first-run', '--disable-gpu'],
    defaultViewport: { width: 1000, height: 1200 },
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  [page-exception]', e.message));
  await page.goto(URL + (URL.includes('?') ? '&' : '?') + 'mode=fixtures', { waitUntil: 'networkidle0', timeout: 45000 });
  await sleep(1600);

  rec('A · WebMCP runtime available', await page.evaluate(() => 'modelContext' in document));

  let t = await tools(page);
  rec('B · contract is exactly two tools',
    JSON.stringify(names(t)) === JSON.stringify(['get_order', 'prepare_resolution']), names(t));

  // ── THE BOUNDARY ────────────────────────────────────────────────
  const everTools = new Set(names(t));

  rec('C · no completion-shaped tool is registered',
    !names(t).some(n => /confirm|commit|complete|approve|finali/i.test(n)), names(t));

  for (const guess of ['confirm_resolution', 'commit_resolution', 'complete_resolution', 'approve_resolution']) {
    const r = await call(page, guess, { resolution_id: 'replacement' });
    if (!r.missing) rec(`C2 · "${guess}" must not be callable`, false, r);
  }
  rec('C2 · no guessable completion tool is callable', true);

  // ── read tool carries policy ────────────────────────────────────
  let r = await call(page, 'get_order', {});
  let order = JSON.parse(r.raw);
  rec('D · get_order carries the merchant options',
    Array.isArray(order.resolutionOptions) && order.resolutionOptions.length === 3,
    order.resolutionOptions.map(o => o.id));
  rec('D2 · options state they are the only permitted ones',
    /only resolutions permitted/i.test(order.optionsNote));
  rec('D3 · get_order is annotated read-only',
    t.find(x => x.name === 'get_order').annotations.readOnlyHint === true);

  // ── prepare is constrained ──────────────────────────────────────
  const prep = t.find(x => x.name === 'prepare_resolution');
  rec('E · prepare enumerates only eligible options',
    JSON.stringify(prep.schema.properties.resolution_id.enum) ===
    JSON.stringify(['replacement', 'refund', 'keep_partial_refund']),
    prep.schema.properties.resolution_id.enum);

  r = await call(page, 'prepare_resolution', { resolution_id: 'store_credit', reason: 'not eligible' });
  rec('F · ineligible option rejected', JSON.parse(r.raw).ok === false && (await stateOf(page)) === 'ORDER_ACTIVE');

  r = await call(page, 'prepare_resolution', { resolution_id: 'replacement', reason: 'customer travels tomorrow' });
  await sleep(500);
  t = await tools(page);
  names(t).forEach(n => everTools.add(n));
  rec('G · prepare stages it and withdraws prepare_resolution',
    JSON.parse(r.raw).success === true && (await stateOf(page)) === 'RESOLUTION_PREPARED' &&
    JSON.stringify(names(t)) === JSON.stringify(['get_order']), names(t));

  // ── the agent cannot finish, by any tool, in the staged state ───
  rec('H · still no completion tool once a resolution is staged',
    !names(t).some(n => /confirm|commit|complete|approve|finali/i.test(n)), names(t));

  r = await call(page, 'get_order', {});
  order = JSON.parse(r.raw);
  rec('I · payload tells the agent the customer must complete it',
    order.resolution.requiresCustomerCommitment === true &&
    order.resolution.committedByCustomer === false &&
    /cannot complete it for them/i.test(order.resolution.nextStep),
    order.resolution.nextStep);

  // ── customer commits in the UI ──────────────────────────────────
  const before = await stateOf(page);
  await page.evaluate(() => document.getElementById('commit').click());
  await sleep(700);
  const after = await stateOf(page);
  t = await tools(page);
  names(t).forEach(n => everTools.add(n));
  rec('J · one customer action approves and completes',
    before === 'RESOLUTION_PREPARED' && after === 'RESOLVED',
    { before, after });

  const result = await page.evaluate(() => window.__session.resolutionResult);
  rec('J2 · result is recorded as committed by the customer',
    result.referenceId === 'R-1042' && result.committedBy === 'CUSTOMER', result.referenceId);

  r = await call(page, 'get_order', {});
  order = JSON.parse(r.raw);
  rec('K · post-completion payload does not ask for commitment again',
    order.resolution.committedByCustomer === true &&
    order.resolution.requiresCustomerCommitment === false,
    { committed: order.resolution.committedByCustomer, requires: order.resolution.requiresCustomerCommitment });
  rec('K2 · options withdrawn after resolution',
    order.resolutionOptions.length === 0 && order.canPrepare === false);

  await page.screenshot({ path: path.join(OUT, 'm3_resolved.png'), fullPage: true });

  // ── stale protection with choose-another ────────────────────────
  await page.evaluate(() => document.querySelector('[data-scenario="wrong_variant"]').click());
  await sleep(800);
  await call(page, 'prepare_resolution', { resolution_id: 'exchange', reason: 'event in three days' });
  await sleep(500);
  await page.evaluate(() => document.getElementById('choose').click());
  await sleep(300);
  await page.evaluate(() => document.querySelector('[data-pick="store_credit"]').click());
  await sleep(200);
  await page.evaluate(() => document.getElementById('use-choice').click());
  await sleep(600);

  const swapped = await page.evaluate(() => window.__session.preparedResolution.option.id);
  rec('L · customer can choose another option', swapped === 'store_credit', swapped);

  const stale = await page.evaluate(() => window.__session.commit({ resolutionId: 'exchange', actor: 'CUSTOMER' }));
  rec('M · a commit against a stale selection is refused',
    stale.ok === false && (await stateOf(page)) === 'RESOLUTION_PREPARED', stale.error);

  await page.evaluate(() => document.getElementById('commit').click());
  await sleep(700);
  const ref = await page.evaluate(() => window.__session.resolutionResult.referenceId);
  rec('N · committing the current selection succeeds', ref === 'SC-2087', ref);

  await page.screenshot({ path: path.join(OUT, 'm3_choose_another.png'), fullPage: true });

  // ── third scenario + reset ──────────────────────────────────────
  await page.evaluate(() => document.querySelector('[data-scenario="arrived_late"]').click());
  await sleep(800);
  r = await call(page, 'get_order', {});
  const lateOpts = JSON.parse(r.raw).resolutionOptions.map(o => o.id);
  rec('O · third scenario exposes its own policy',
    JSON.stringify(lateOpts) === JSON.stringify(['return_refund', 'keep_shipping_refund', 'keep_store_credit']), lateOpts);

  await call(page, 'prepare_resolution', { resolution_id: 'keep_store_credit', reason: 'event passed' });
  await sleep(500);
  await page.evaluate(() => document.getElementById('reset').click());
  await sleep(700);
  t = await tools(page);
  rec('P · reset mid-flow restores a clean state and contract',
    (await stateOf(page)) === 'ORDER_ACTIVE' &&
    JSON.stringify(names(t)) === JSON.stringify(['get_order', 'prepare_resolution']), names(t));

  // ── across the whole run, no completion tool was ever registered ─
  rec('Q · across every state observed, no completion tool ever appeared',
    ![...everTools].some(n => /confirm|commit|complete|approve|finali/i.test(n)), [...everTools]);

  await browser.close();

  const passed = results.filter(r2 => r2.pass).length;
  console.log('\n' + '='.repeat(56));
  console.log(`M3 CAPABILITY BOUNDARY: ${passed}/${results.length}`);
  console.log('='.repeat(56));
  fs.writeFileSync(path.join(OUT, 'webmcp-boundary.json'),
    JSON.stringify({ url: URL, at: new Date().toISOString(), passed, total: results.length,
                     toolsEverRegistered: [...everTools], results }, null, 2));
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
