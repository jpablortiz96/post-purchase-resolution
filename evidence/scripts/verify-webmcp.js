/**
 * M0.5 WebMCP Runtime Verification — v4 (FINAL)
 * 
 * Fixes from v3:
 * - Increased wait times for async tool lifecycle changes
 * - Added JSON.stringify logging for failing tests
 * - Wrapped returns in try/catch with full diagnostics
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const EVIDENCE_DIR = path.join(__dirname, '..', 'm0-real');
const APP_URL = 'http://localhost:3000/';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('M0.5 Real WebMCP Verification — v4');
  console.log('═══════════════════════════════════════');

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const consoleLog = [];

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
  page.on('console', msg => {
    const e = { ts: new Date().toISOString(), type: msg.type(), text: msg.text() };
    consoleLog.push(e);
    console.log(`  [${e.type === 'error' ? 'ERR' : 'LOG'}] ${e.text}`);
  });
  page.on('pageerror', err => {
    consoleLog.push({ ts: new Date().toISOString(), type: 'page-error', text: err.message });
    console.log(`  [PAGE-ERR] ${err.message}`);
  });

  await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));

  // ═══════════════════════════════════════
  // TEST A: WebMCP Runtime
  // ═══════════════════════════════════════
  console.log('\n══ TEST A: WebMCP Runtime ══');
  const testA = await page.evaluate(() => ({
    pass: 'modelContext' in document && typeof document.modelContext === 'object',
    typeof: typeof document.modelContext,
    constructor: document.modelContext?.constructor?.name,
  }));
  console.log('RESULT:', testA.pass ? 'PASS ✓' : 'FAIL ✗', JSON.stringify(testA));
  await page.screenshot({ path: path.join(EVIDENCE_DIR, '01_webmcp_available.png'), fullPage: true });

  if (!testA.pass) {
    console.log('\nFATAL: WebMCP not available.');
    await browser.close(); return;
  }

  // ═══════════════════════════════════════
  // TEST B: Tool Discovery
  // ═══════════════════════════════════════
  console.log('\n══ TEST B: Tool Discovery ══');
  const testB = await page.evaluate(async () => {
    const tools = await document.modelContext.getTools();
    const names = tools.map(t => t.name);
    return {
      pass: names.includes('get_order') && names.includes('prepare_replacement') && !names.includes('confirm_replacement'),
      tools: names,
      count: tools.length,
    };
  });
  console.log('RESULT:', testB.pass ? 'PASS ✓' : 'FAIL ✗', '| Tools:', JSON.stringify(testB.tools));
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'tools-initial.json'), JSON.stringify(testB, null, 2));
  await page.screenshot({ path: path.join(EVIDENCE_DIR, '02_tools_discovered.png'), fullPage: true });

  // ═══════════════════════════════════════
  // TEST C: Annotations
  // ═══════════════════════════════════════
  console.log('\n══ TEST C: Annotations ══');
  const testC = await page.evaluate(async () => {
    const tools = await document.modelContext.getTools();
    const go = tools.find(t => t.name === 'get_order');
    const pr = tools.find(t => t.name === 'prepare_replacement');
    return {
      pass: go?.annotations?.readOnlyHint === true && pr?.annotations?.readOnlyHint === false,
      get_order: go?.annotations,
      prepare_replacement: pr?.annotations,
    };
  });
  console.log('RESULT:', testC.pass ? 'PASS ✓' : 'FAIL ✗', JSON.stringify(testC));

  // ═══════════════════════════════════════
  // TEST D: Real get_order Execution
  // ═══════════════════════════════════════
  console.log('\n══ TEST D: Real get_order Execution ══');
  const testD = await page.evaluate(async () => {
    try {
      const tools = await document.modelContext.getTools();
      const tool = tools.find(t => t.name === 'get_order');
      const result = await document.modelContext.executeTool(tool, JSON.stringify({ order_id: '1042' }));
      const parsed = JSON.parse(result);
      return {
        pass: parsed.order_id === '1042' && parsed.product === 'Wireless Headphones',
        result: result.substring(0, 200),
        order_id: parsed.order_id,
        product: parsed.product,
      };
    } catch (e) { return { pass: false, error: e.message }; }
  });
  console.log('RESULT:', testD.pass ? 'PASS ✓' : 'FAIL ✗');
  console.log('  Data:', JSON.stringify(testD));
  await page.screenshot({ path: path.join(EVIDENCE_DIR, '03_get_order_real.png'), fullPage: true });

  // ═══════════════════════════════════════
  // TEST E: prepare_replacement + Lifecycle
  // Split into steps to avoid serialization issues
  // ═══════════════════════════════════════
  console.log('\n══ TEST E: Real prepare_replacement + Lifecycle ══');

  // Step 1: Get tools before
  const toolsBefore = await page.evaluate(async () => {
    return (await document.modelContext.getTools()).map(t => t.name);
  });
  console.log('  Tools BEFORE:', JSON.stringify(toolsBefore));

  // Step 2: Execute prepare_replacement
  const prepareResult = await page.evaluate(async () => {
    try {
      const tools = await document.modelContext.getTools();
      const tool = tools.find(t => t.name === 'prepare_replacement');
      if (!tool) return { error: 'prepare_replacement not found' };
      const result = await document.modelContext.executeTool(tool, JSON.stringify({
        order_id: '1042',
        reason: 'Product arrived damaged — left earphone not working',
      }));
      return { raw: result.substring(0, 300), success: JSON.parse(result).success };
    } catch (e) { return { error: e.message }; }
  });
  console.log('  Prepare result:', JSON.stringify(prepareResult));

  // Step 3: Wait for async lifecycle changes
  await new Promise(r => setTimeout(r, 1000));

  // Step 4: Get tools after
  const toolsAfter = await page.evaluate(async () => {
    return (await document.modelContext.getTools()).map(t => t.name);
  });
  console.log('  Tools AFTER:', JSON.stringify(toolsAfter));

  // Step 5: Get current state
  const stateAfterPrepare = await page.evaluate(() => window.currentState);
  console.log('  State:', stateAfterPrepare);

  const testE = {
    pass: prepareResult.success === true
      && !toolsAfter.includes('prepare_replacement')
      && toolsAfter.includes('confirm_replacement'),
    toolsBefore,
    toolsAfter,
    prepareResult,
    state: stateAfterPrepare,
  };
  console.log('RESULT:', testE.pass ? 'PASS ✓' : 'FAIL ✗');
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'tools-prepared.json'), JSON.stringify(testE, null, 2));
  await page.screenshot({ path: path.join(EVIDENCE_DIR, '04_prepare_real.png'), fullPage: true });

  // ═══════════════════════════════════════
  // TEST F: Negative Approval (confirm BEFORE human approval)
  // ═══════════════════════════════════════
  console.log('\n══ TEST F: Pre-Approval Negative Test ══');
  const testF = await page.evaluate(async () => {
    const stateBefore = window.currentState;
    try {
      const tools = await document.modelContext.getTools();
      const tool = tools.find(t => t.name === 'confirm_replacement');
      if (!tool) return { pass: true, note: 'confirm not in tools — correctly gated', stateBefore };
      const result = await document.modelContext.executeTool(tool, JSON.stringify({ order_id: '1042' }));
      const parsed = JSON.parse(result);
      const stateAfter = window.currentState;
      return {
        pass: parsed.error != null && stateAfter !== 'RESOLVED',
        stateBefore, stateAfter,
        errorReturned: parsed.error,
      };
    } catch (e) {
      return { pass: true, stateBefore, error: e.message, note: 'Threw — negative PASS' };
    }
  });
  console.log('RESULT:', testF.pass ? 'PASS ✓' : 'FAIL ✗', JSON.stringify(testF));
  await page.screenshot({ path: path.join(EVIDENCE_DIR, '05_preapproval_rejected.png'), fullPage: true });

  // ═══════════════════════════════════════
  // TEST G: Human Approval
  // ═══════════════════════════════════════
  console.log('\n══ TEST G: Human Approval ══');
  const clicked = await page.evaluate(() => {
    const btn = document.getElementById('btn-approve');
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log('  Clicked #btn-approve:', clicked);
  await new Promise(r => setTimeout(r, 500));

  const testG = await page.evaluate(async () => {
    const state = window.currentState;
    const tools = (await document.modelContext.getTools()).map(t => t.name);
    return { pass: state === 'AWAITING_APPROVAL', state, tools };
  });
  console.log('RESULT:', testG.pass ? 'PASS ✓' : 'FAIL ✗', JSON.stringify(testG));
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'tools-approved.json'), JSON.stringify(testG, null, 2));
  await page.screenshot({ path: path.join(EVIDENCE_DIR, '06_human_approval.png'), fullPage: true });

  // ═══════════════════════════════════════
  // TEST H: Real confirm (after approval) — split steps
  // ═══════════════════════════════════════
  console.log('\n══ TEST H: Real confirm_replacement ══');

  const confirmResult = await page.evaluate(async () => {
    try {
      const tools = await document.modelContext.getTools();
      const tool = tools.find(t => t.name === 'confirm_replacement');
      if (!tool) return { error: 'confirm_replacement not found after approval' };
      const result = await document.modelContext.executeTool(tool, JSON.stringify({ order_id: '1042' }));
      const parsed = JSON.parse(result);
      return { raw: result.substring(0, 300), success: parsed.success, replacement_id: parsed.replacement?.id };
    } catch (e) { return { error: e.message }; }
  });
  console.log('  Confirm result:', JSON.stringify(confirmResult));

  await new Promise(r => setTimeout(r, 1000));

  const stateAfterConfirm = await page.evaluate(() => window.currentState);
  const toolsAfterConfirm = await page.evaluate(async () => (await document.modelContext.getTools()).map(t => t.name));
  console.log('  State:', stateAfterConfirm, '| Tools:', JSON.stringify(toolsAfterConfirm));

  const testH = {
    pass: confirmResult.success === true && stateAfterConfirm === 'RESOLVED',
    state: stateAfterConfirm,
    toolsAfter: toolsAfterConfirm,
    confirmRemoved: !toolsAfterConfirm.includes('confirm_replacement'),
    confirmResult,
  };
  console.log('RESULT:', testH.pass ? 'PASS ✓' : 'FAIL ✗');
  await page.screenshot({ path: path.join(EVIDENCE_DIR, '07_confirm_real.png'), fullPage: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, '08_resolved_real.png'), fullPage: true });

  // ═══════════════════════════════════════
  // TEST I: Reset
  // ═══════════════════════════════════════
  console.log('\n══ TEST I: Reset ══');
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Reset'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  const testI = await page.evaluate(async () => {
    const state = window.currentState;
    const tools = (await document.modelContext.getTools()).map(t => t.name);
    return {
      pass: state === 'ORDER_DELIVERED' && tools.includes('get_order') && tools.includes('prepare_replacement') && !tools.includes('confirm_replacement'),
      state, tools,
    };
  });
  console.log('RESULT:', testI.pass ? 'PASS ✓' : 'FAIL ✗', JSON.stringify(testI));
  await page.screenshot({ path: path.join(EVIDENCE_DIR, '09_reset_real.png'), fullPage: true });

  // ═══════════════════════════════════════
  // Evidence
  // ═══════════════════════════════════════
  const tcLog = await page.evaluate(() => window.toolchangeLog || []);

  const allResults = {
    TEST_A_WEBMCP_RUNTIME: testA,
    TEST_B_TOOL_DISCOVERY: testB,
    TEST_C_ANNOTATIONS: testC,
    TEST_D_REAL_GET_ORDER: testD,
    TEST_E_PREPARE_LIFECYCLE: testE,
    TEST_F_NEGATIVE_APPROVAL: testF,
    TEST_G_HUMAN_APPROVAL: testG,
    TEST_H_REAL_CONFIRM: testH,
    TEST_I_RESET: testI,
    toolchangeLog: tcLog,
    chromeVersion: await browser.version(),
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(EVIDENCE_DIR, 'runtime.json'), JSON.stringify(allResults, null, 2));
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'toolchange.log'), JSON.stringify(tcLog, null, 2));
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, 'executions.jsonl'),
    [
      JSON.stringify({ test: 'D', tool: 'get_order', ...testD }),
      JSON.stringify({ test: 'E', tool: 'prepare_replacement', ...testE }),
      JSON.stringify({ test: 'F', tool: 'confirm_replacement', negative_test: true, ...testF }),
      JSON.stringify({ test: 'H', tool: 'confirm_replacement', post_approval: true, ...testH }),
      JSON.stringify({ test: 'I', action: 'reset', ...testI }),
    ].join('\n')
  );
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'console.log'), consoleLog.map(e => `[${e.ts}] [${e.type}] ${e.text}`).join('\n'));

  await browser.close();

  // ═══════════════════════════════════════
  // FINAL SUMMARY
  // ═══════════════════════════════════════
  const tests = [
    ['A', 'WebMCP Runtime', testA],
    ['B', 'Tool Discovery', testB],
    ['C', 'Annotations', testC],
    ['D', 'Real get_order', testD],
    ['E', 'Prepare + Lifecycle', testE],
    ['F', 'Negative Approval', testF],
    ['G', 'Human Approval', testG],
    ['H', 'Real Confirm', testH],
    ['I', 'Reset', testI],
  ];

  console.log('\n═══════════════════════════════════════');
  console.log('M0.5 FINAL SUMMARY');
  console.log('═══════════════════════════════════════');
  for (const [l, n, r] of tests) {
    console.log(`  TEST ${l}: ${n.padEnd(22)} ${r.pass ? 'PASS ✓' : 'FAIL ✗'}`);
  }
  const allPassed = tests.every(([,,r]) => r.pass);
  console.log('═══════════════════════════════════════');
  console.log(`  OVERALL: ${allPassed ? '★ FULL PASS ★' : 'NOT FULL PASS'}`);
  console.log(`  Chrome: ${allResults.chromeVersion}`);
  console.log(`  Toolchange events: ${tcLog.length}`);
  console.log('═══════════════════════════════════════');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
