/** M4 final production smoke: all three scenarios, end to end, on the live URL. */
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const URL = process.env.APP_URL || 'https://post-purchase-resolution.vercel.app/';
const OUT = process.env.OUT_DIR || path.join(__dirname, '..', 'evidence', 'm4');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const rec = (n, p, d) => { results.push({ name: n, pass: p, detail: d }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? '  ' + JSON.stringify(d) : ''}`); };

const CASES = [
  { key: 'damaged',       first: 'replacement',       swap: 'keep_partial_refund',  ref: 'PR-1042' },
  { key: 'wrong_variant', first: 'exchange',          swap: 'store_credit',         ref: 'SC-2087' },
  { key: 'arrived_late',  first: 'keep_store_credit', swap: 'keep_shipping_refund', ref: 'SR-3155' },
];

(async () => {
  const b = await puppeteer.launch({ headless: 'new',
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport','--enable-experimental-web-platform-features','--no-first-run','--disable-gpu'],
    defaultViewport: { width: 1000, height: 1200 } });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const call = (n, a) => p.evaluate(async (n, a) => {
    const l = await document.modelContext.getTools(); const t = l.find(x => x.name === n);
    return t ? await document.modelContext.executeTool(t, JSON.stringify(a || {})) : null; }, n, a);
  const st = () => p.evaluate(() => window.__session.state);

  await p.goto(URL, { waitUntil: 'networkidle0', timeout: 45000 });
  await sleep(1800);
  rec('live URL loads over HTTPS', URL.startsWith('https://'));
  rec('WebMCP discovery works',
    (await p.evaluate(async () => (await document.modelContext.getTools()).map(t => t.name))).length === 2);

  for (const c of CASES) {
    await p.evaluate(k => document.querySelector(`[data-scenario="${k}"]`).click(), c.key);
    await sleep(900);
    await p.evaluate(() => document.getElementById('reset').click());
    await sleep(700);

    const order = JSON.parse(await call('get_order', {}));
    rec(`${c.key} · get_order returns 3 merchant options`, order.resolutionOptions.length === 3);

    const prep = JSON.parse(await call('prepare_resolution', { resolution_id: c.first, reason: 'final smoke' }));
    await sleep(600);
    rec(`${c.key} · prepare_resolution stages it`, prep.success === true && (await st()) === 'RESOLUTION_PREPARED');

    await p.evaluate(() => document.getElementById('choose').click()); await sleep(400);
    await p.evaluate(s => document.querySelector(`[data-pick="${s}"]`).click(), c.swap); await sleep(300);
    await p.evaluate(() => document.getElementById('use-choice').click()); await sleep(700);
    rec(`${c.key} · choose another works`,
      (await p.evaluate(() => window.__session.preparedResolution.option.id)) === c.swap);

    const stale = await p.evaluate(f => window.__session.commit({ resolutionId: f, actor: 'CUSTOMER' }), c.first);
    rec(`${c.key} · stale protection holds`, stale.ok === false && (await st()) === 'RESOLUTION_PREPARED');

    await p.evaluate(() => document.getElementById('commit').click()); await sleep(900);
    const res = await p.evaluate(() => window.__session.resolutionResult);
    rec(`${c.key} · approve & complete works`, (await st()) === 'RESOLVED' && res.referenceId === c.ref, res && res.referenceId);
    rec(`${c.key} · committed by the customer`, res.committedBy === 'CUSTOMER');

    const audit = await p.evaluate(() => window.__session.audit.map(a => a.actor));
    rec(`${c.key} · audit trail records authority`, audit.includes('AGENT') && audit.includes('CUSTOMER') && audit.includes('SYSTEM'), audit);

    await p.screenshot({ path: path.join(OUT, `smoke_${c.key}.png`), fullPage: true });
    await p.evaluate(() => document.getElementById('reset').click()); await sleep(700);
    rec(`${c.key} · reset works`, (await st()) === 'ORDER_ACTIVE');
  }

  rec('no console-breaking errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  const passed = results.filter(r => r.pass).length;
  console.log('\n' + '='.repeat(56));
  console.log(`FINAL PRODUCTION SMOKE: ${passed}/${results.length}`);
  console.log('='.repeat(56));
  fs.writeFileSync(path.join(OUT, 'final-smoke.json'),
    JSON.stringify({ url: URL, at: new Date().toISOString(), passed, total: results.length, consoleErrors: errs, results }, null, 2));
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
