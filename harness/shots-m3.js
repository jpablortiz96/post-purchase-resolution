const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const URL = process.env.APP_URL || 'https://post-purchase-resolution.vercel.app/';
const OUT = process.env.OUT_DIR || path.join(__dirname, '..', 'evidence', 'm3', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport',
           '--enable-experimental-web-platform-features', '--no-first-run', '--disable-gpu'],
    defaultViewport: { width: 900, height: 1300 },
  });
  const p = await b.newPage();
  const call = (n, a) => p.evaluate(async (n, a) => {
    const l = await document.modelContext.getTools();
    const t = l.find(x => x.name === n);
    return t ? await document.modelContext.executeTool(t, JSON.stringify(a || {})) : null;
  }, n, a);

  await p.goto(URL, { waitUntil: 'networkidle0' });
  await sleep(1500);
  await p.screenshot({ path: path.join(OUT, '01_initial.png'), fullPage: true });

  await call('prepare_resolution', { resolution_id: 'replacement',
    reason: 'You fly tomorrow morning, and the replacement is the only option that puts working headphones in your hands before you go. A refund takes 3-5 days and keeping them leaves you with a dead left side on the plane.' });
  await sleep(800);
  await p.screenshot({ path: path.join(OUT, '02_decision_card.png'), fullPage: true });

  await p.evaluate(() => document.getElementById('choose').click());
  await sleep(500);
  await p.screenshot({ path: path.join(OUT, '03_choose_another.png'), fullPage: true });
  await p.evaluate(() => document.getElementById('cancel-choice').click());
  await sleep(400);

  await p.evaluate(() => document.getElementById('commit').click());
  await sleep(900);
  await p.evaluate(() => { const d = document.querySelector('details.proto'); if (d) d.open = true; });
  await sleep(400);
  await p.screenshot({ path: path.join(OUT, '04_resolved.png'), fullPage: true });

  await p.evaluate(() => document.querySelector('[data-scenario="arrived_late"]').click());
  await sleep(900);
  await p.screenshot({ path: path.join(OUT, '05_scenario_late.png'), fullPage: true });

  await b.close();
  console.log('m3 shots done:', fs.readdirSync(OUT).join(', '));
})();
