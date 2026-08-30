/**
 * M0.5 — executeTool API probe
 * Tests exact calling convention for executeTool
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const EVIDENCE_DIR = path.join(__dirname, '..', 'm0-real');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME_PATH,
    args: [
      '--enable-features=WebMCPTesting,DevToolsWebMCPSupport',
      '--enable-experimental-web-platform-features',
      '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    ],
    defaultViewport: { width: 1280, height: 900 },
  });

  const page = await browser.newPage();
  page.on('console', msg => console.log(`  [C] ${msg.text()}`));

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 1000));

  const result = await page.evaluate(async () => {
    const mc = document.modelContext;
    if (!mc) return { error: 'no modelContext' };

    const results = {};

    // 1. Await getTools properly
    const tools = await mc.getTools();
    results.toolCount = tools.length;
    results.toolNames = tools.map(t => t.name);
    results.firstToolKeys = Object.keys(tools[0]);
    
    // 2. Try executeTool with the tool from getTools
    const getOrderFromList = tools.find(t => t.name === 'get_order');
    
    // Attempt 1: tool from getTools + JSON string
    try {
      const r1 = await mc.executeTool(getOrderFromList, JSON.stringify({ order_id: '1042' }));
      results.attempt1 = { method: 'toolFromGetTools + JSON.stringify', result: r1, type: typeof r1 };
    } catch (e) {
      results.attempt1 = { method: 'toolFromGetTools + JSON.stringify', error: e.message };
    }

    // Attempt 2: tool from getTools + plain object
    try {
      const r2 = await mc.executeTool(getOrderFromList, { order_id: '1042' });
      results.attempt2 = { method: 'toolFromGetTools + plainObject', result: r2, type: typeof r2 };
    } catch (e) {
      results.attempt2 = { method: 'toolFromGetTools + plainObject', error: e.message };
    }

    // Attempt 3: string name + JSON string
    try {
      const r3 = await mc.executeTool('get_order', JSON.stringify({ order_id: '1042' }));
      results.attempt3 = { method: 'stringName + JSON.stringify', result: r3, type: typeof r3 };
    } catch (e) {
      results.attempt3 = { method: 'stringName + JSON.stringify', error: e.message };
    }

    // Attempt 4: string name + plain object
    try {
      const r4 = await mc.executeTool('get_order', { order_id: '1042' });
      results.attempt4 = { method: 'stringName + plainObject', result: r4, type: typeof r4 };
    } catch (e) {
      results.attempt4 = { method: 'stringName + plainObject', error: e.message };
    }

    // Attempt 5: just the tool name (1 arg)
    try {
      const r5 = await mc.executeTool('get_order');
      results.attempt5 = { method: 'stringName only', result: r5, type: typeof r5 };
    } catch (e) {
      results.attempt5 = { method: 'stringName only', error: e.message };
    }

    // Attempt 6: tool name as object { name: 'get_order' }
    try {
      const r6 = await mc.executeTool({ name: 'get_order' }, JSON.stringify({ order_id: '1042' }));
      results.attempt6 = { method: '{name} + JSON.stringify', result: r6, type: typeof r6 };
    } catch (e) {
      results.attempt6 = { method: '{name} + JSON.stringify', error: e.message };
    }
    
    // Attempt 7: copy tool without window property
    try {
      const cleanTool = { ...getOrderFromList };
      delete cleanTool.window;
      const r7 = await mc.executeTool(cleanTool, JSON.stringify({ order_id: '1042' }));
      results.attempt7 = { method: 'cleanTool (no window) + JSON.stringify', result: r7, type: typeof r7 };
    } catch (e) {
      results.attempt7 = { method: 'cleanTool (no window) + JSON.stringify', error: e.message };
    }

    return results;
  });

  console.log('\n═══════════════════════════════════════');
  console.log('executeTool API Probe Results');
  console.log('═══════════════════════════════════════');
  console.log(JSON.stringify(result, null, 2));

  fs.writeFileSync(path.join(EVIDENCE_DIR, 'executeTool-probe.json'), JSON.stringify(result, null, 2));

  await browser.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
