/**
 * A1 — production URL audit.
 *
 * Loads the real public deployment as a customer would and checks that nothing
 * developer-only is required or visible, and that a customer can actually
 * operate the product.
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'https://post-purchase-resolution.vercel.app/';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.env.OUT_DIR || path.join(__dirname, '..', 'evidence', 'm1-production');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const rec = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new', executablePath: CHROME,
    args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport',
           '--enable-experimental-web-platform-features', '--no-first-run', '--disable-gpu'],
    defaultViewport: { width: 1000, height: 1200 },
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('EXCEPTION: ' + e.message));

  const resp = await page.goto(URL, { waitUntil: 'networkidle0', timeout: 45000 });
  await sleep(2500);

  rec('https + 200', URL.startsWith('https://') && resp.status() === 200, resp.status());
  rec('no console errors on load', consoleErrors.length === 0, consoleErrors.slice(0, 3));

  const snap = await page.evaluate(() => ({
    debugPanel: !!document.getElementById('debug-panel'),
    harnessAttr: document.documentElement.getAttribute('data-debug-harness'),
    bodyText: document.body.innerText,
    badge: document.getElementById('badge').textContent.trim(),
    state: window.__session.state,
    scenarios: Array.from(document.querySelectorAll('[data-scenario]')).map(b => b.textContent.trim()),
    // every control a customer can actually press right now
    buttons: Array.from(document.querySelectorAll('button'))
      .filter(b => b.offsetParent !== null)
      .map(b => b.textContent.trim()),
    optionsShown: Array.from(document.querySelectorAll('.opt')).map(o => o.querySelector('.opt-name').textContent.trim()),
  }));

  rec('no debug/simulation panel', !snap.debugPanel && !snap.harnessAttr);
  rec('no "simulate" wording in customer UI', !/simulat/i.test(snap.bodyText));
  rec('no "debug" wording in customer UI', !/debug/i.test(snap.bodyText));
  rec('badge reads Active in a WebMCP environment', snap.badge === 'WebMCP Active', snap.badge);
  rec('initial state is clean', snap.state === 'ORDER_ACTIVE', snap.state);
  rec('all three scenarios reachable', snap.scenarios.length === 3, snap.scenarios);
  rec('merchant options are visible to the customer', snap.optionsShown.length === 3, snap.optionsShown);

  const tools = await page.evaluate(async () => (await document.modelContext.getTools()).map(t => t.name));
  rec('tools register in a supported WebMCP environment',
    tools.length === 3 && tools.includes('prepare_resolution'), tools);

  // ── the real question: can a customer operate this WITHOUT an agent? ──
  console.log('\n  customer-visible controls in the initial state:');
  snap.buttons.forEach(b => console.log('    · ' + b));

  const canSelfServe = snap.buttons.some(b => /choose|select|request|start/i.test(b));
  rec('CUSTOMER CAN START A RESOLUTION UNAIDED', canSelfServe, snap.buttons);

  // reset works
  await page.evaluate(() => document.getElementById('reset').click());
  await sleep(600);
  const afterReset = await page.evaluate(() => window.__session.state);
  rec('reset works', afterReset === 'ORDER_ACTIVE', afterReset);

  await page.screenshot({ path: path.join(OUT, 'a1_production_initial.png'), fullPage: true });

  await browser.close();

  const passed = results.filter(r => r.pass).length;
  console.log('\n' + '='.repeat(56));
  console.log(`A1 PRODUCTION AUDIT: ${passed}/${results.length}`);
  console.log('='.repeat(56));
  fs.writeFileSync(path.join(OUT, 'a1-production-audit.json'),
    JSON.stringify({ url: URL, at: new Date().toISOString(), passed, total: results.length,
                     customerControls: snap.buttons, results }, null, 2));
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
