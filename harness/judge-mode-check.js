/**
 * Verifies the judge-facing requirements on the LIVE public deployment:
 *   - the badge never reads "unavailable"
 *   - the debug simulation panel is absent, including when ?debug is forced
 *   - the page publishes its WebMCP tools
 */

const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.APP_URL || 'https://post-purchase-resolution.vercel.app/';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME,
    args: [
      '--enable-features=WebMCPTesting,DevToolsWebMCPSupport',
      '--enable-experimental-web-platform-features',
      '--no-first-run', '--disable-gpu',
    ],
    defaultViewport: { width: 1280, height: 1000 },
  });

  const cases = [
    ['judge (plain)', BASE],
    ['judge + ?debug=1', BASE + '?debug=1'],
    ['judge + ?debug', BASE + '?debug'],
  ];

  let allOk = true;
  for (const [label, url] of cases) {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2500));
    const r = await page.evaluate(() => ({
      badge: document.getElementById('webmcp-badge').textContent.trim(),
      debugPanel: !!document.getElementById('debug-panel'),
      harnessAttr: document.documentElement.getAttribute('data-debug-harness'),
      unavailableOnPage: document.body.innerText.toLowerCase().includes('unavailable'),
      tools: Array.from(document.querySelectorAll('#tools-list .tool-chip')).map(c => c.textContent.trim()),
    }));
    const ok = !r.debugPanel && !r.unavailableOnPage && r.badge === 'WebMCP Active' && r.tools.length === 2;
    if (!ok) allOk = false;
    console.log(
      (ok ? 'PASS ' : 'FAIL ') + label.padEnd(18) +
      ' | badge: ' + r.badge.padEnd(15) +
      ' | debugPanel: ' + String(r.debugPanel).padEnd(5) +
      ' | "unavailable" on page: ' + String(r.unavailableOnPage).padEnd(5) +
      ' | tools: ' + JSON.stringify(r.tools)
    );
    await page.close();
  }

  await browser.close();
  console.log('\nJUDGE MODE: ' + (allOk ? 'PASS' : 'FAIL'));
  process.exit(allOk ? 0 : 1);
})();
