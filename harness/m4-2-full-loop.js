/**
 * M4.2 — the full production loop for order #1002.
 *
 * Every mutation happens by CLICKING THE LIVE PRODUCTION APP. Nothing here
 * calls returnRequest or returnApproveRequest directly. The only direct Shopify
 * traffic is read-only verification, done with an independent client so the
 * check does not depend on the app's own state.
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const URL = (process.env.APP_URL || 'https://post-purchase-resolution.vercel.app/').replace(/\/$/, '');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(__dirname, '..', 'evidence', 'm4-merchant-loop');
const ORDER = '#1002';

for (const d of ['before', 'customer-request', 'merchant', 'restart', 'screenshots']) {
  fs.mkdirSync(path.join(OUT, d), { recursive: true });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const steps = [];
const rec = (n, p, d) => {
  steps.push({ name: n, pass: p, detail: d });
  console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? '  ' + JSON.stringify(d).slice(0, 190) : ''}`);
};
const w = (p, o) => fs.writeFileSync(path.join(OUT, p), JSON.stringify(o, null, 2));

// ── independent read-only Shopify client (NOT the app's) ─────────────
const RAW = (process.env.SHOPIFY_SHOP || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const SHOP = RAW.includes('.') ? RAW : `${RAW}.myshopify.com`;
const VER = process.env.SHOPIFY_API_VERSION || '2026-07';
let tok = null;

async function externalRead() {
  if (!tok) {
    tok = (await (await fetch(`https://${SHOP}/admin/oauth/access_token`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET, grant_type: 'client_credentials' }),
    })).json()).access_token;
  }
  const r = await (await fetch(`https://${SHOP}/admin/api/${VER}/graphql.json`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': tok },
    body: JSON.stringify({ query: `query{orders(first:1,query:"name:${ORDER}"){nodes{
      name returnStatus returns(first:10){nodes{id name status}}}}}` }),
  })).json();
  const o = r.data.orders.nodes[0];
  return {
    capturedAt: new Date().toISOString(),
    source: 'independent read-only Shopify Admin API query',
    orderReference: o.name,
    orderReturnStatus: o.returnStatus,
    returns: o.returns.nodes.map(x => ({ reference: x.name, status: x.status, externalId: String(x.id).split('/').pop() })),
  };
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new', executablePath: CHROME,
    args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport',
           '--enable-experimental-web-platform-features', '--no-first-run', '--disable-gpu'],
    defaultViewport: { width: 1000, height: 1300 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  // ── 0. external state BEFORE anything ─────────────────────────────
  const before = await externalRead();
  w('before/return-state-1002.json', { ...before, note: 'External truth before the production app was touched.' });
  rec('0 · BEFORE: Shopify has no Return for #1002',
    before.returns.length === 0 && before.orderReturnStatus === 'NO_RETURN',
    { returns: before.returns, orderReturnStatus: before.orderReturnStatus });

  // ── 1. production customer page ───────────────────────────────────
  await page.goto(URL + '/', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3500);
  const bootText = await page.evaluate(() => document.querySelector('.wrap').innerText);
  rec('1 · production page loads the real order', bootText.includes(ORDER), ORDER);
  await page.screenshot({ path: path.join(OUT, 'screenshots', '01_real_order.png'), fullPage: true });

  // ── 2. WebMCP get_order ───────────────────────────────────────────
  const tools = await page.evaluate(async () => (await document.modelContext.getTools()).map(t => t.name));
  rec('2a · WebMCP contract is still get_order + prepare_resolution',
    JSON.stringify(tools.slice().sort()) === JSON.stringify(['get_order', 'prepare_resolution']), tools);
  rec('2b · no completion tool exposed',
    !tools.some(t => /confirm|commit|complete|approve|finali|request/i.test(t)), tools);

  const orderPayload = await page.evaluate(async () => {
    const l = await document.modelContext.getTools();
    const t = l.find(x => x.name === 'get_order');
    return JSON.parse(await document.modelContext.executeTool(t, '{}'));
  });
  w('customer-request/webmcp-get-order.json', {
    capturedAt: new Date().toISOString(),
    note: 'Exactly what the agent received from the live production page.',
    payload: orderPayload,
  });
  rec('2c · get_order returns real Shopify facts',
    orderPayload.orderReference === ORDER && orderPayload.financialStatus === 'PAID' &&
    orderPayload.fulfillmentStatus === 'FULFILLED' && orderPayload.returnable === true,
    { ref: orderPayload.orderReference, fin: orderPayload.financialStatus,
      ful: orderPayload.fulfillmentStatus, returnable: orderPayload.returnable });

  const blob = JSON.stringify(orderPayload).toLowerCase();
  rec('2d · no PII or secrets in the agent payload',
    !/\bemail\b|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\bphone\b|\baddress\d?\b|gid:\/\/|shpat_|myshopify/.test(blob));

  // ── 3. WebMCP prepare_resolution — must NOT mutate Shopify ────────
  const prep = await page.evaluate(async () => {
    const l = await document.modelContext.getTools();
    const t = l.find(x => x.name === 'prepare_resolution');
    return JSON.parse(await document.modelContext.executeTool(t, JSON.stringify({
      reason: 'The headphones arrived damaged and the left earphone does not work. Shopify shows this order as delivered and still returnable, so a return request is the resolution this merchant supports.',
    })));
  });
  await sleep(800);
  const afterPrepare = await externalRead();
  w('customer-request/prepared.json', {
    capturedAt: new Date().toISOString(),
    note: 'Agent preparation. Compare externalAfterPrepare with before/: Shopify is unchanged.',
    prepareResult: prep, externalAfterPrepare: afterPrepare,
  });
  rec('3 · prepare_resolution created NO Shopify mutation',
    prep.success === true && afterPrepare.returns.length === 0 &&
    afterPrepare.orderReturnStatus === 'NO_RETURN',
    { prepared: prep.success, externalReturns: afterPrepare.returns.length });
  await page.screenshot({ path: path.join(OUT, 'screenshots', '02_resolution_ready.png'), fullPage: true });

  // ── 4. CUSTOMER clicks Request return, in the live app ────────────
  const hasBtn = await page.evaluate(() => !!document.getElementById('request-return'));
  rec('4a · the customer has a Request return control', hasBtn);
  await page.evaluate(() => document.getElementById('request-return').click());
  await sleep(6000);

  const afterRequest = await externalRead();
  w('customer-request/external-requested.json', {
    ...afterRequest,
    note: 'Independent Shopify query AFTER the customer pressed Request return in the production app.',
  });
  const created = afterRequest.returns.find(r => r.status === 'REQUESTED');
  rec('4b · a REAL Shopify Return now exists as REQUESTED',
    !!created && afterRequest.returns.length === 1,
    { returns: afterRequest.returns, orderReturnStatus: afterRequest.orderReturnStatus });

  const uiAfter = await page.evaluate(() => document.querySelector('.wrap').innerText);
  rec('4c · the customer page shows the real return and REQUESTED',
    created && uiAfter.includes(created.reference) && /REQUESTED/.test(uiAfter),
    created ? created.reference : null);
  await page.screenshot({ path: path.join(OUT, 'screenshots', '03_shopify_requested.png'), fullPage: true });

  const toolsAfter = await page.evaluate(async () => (await document.modelContext.getTools()).map(t => t.name));
  rec('4d · still no completion tool after the request',
    !toolsAfter.some(t => /confirm|commit|complete|approve|finali/i.test(t)), toolsAfter);

  // ── 5. MERCHANT approves, in the live merchant view ───────────────
  const mp = await browser.newPage();
  mp.on('pageerror', e => errs.push('merchant: ' + e.message));
  await mp.goto(URL + '/merchant.html', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);
  const mText = await mp.evaluate(() => document.querySelector('.wrap').innerText);
  rec('5a · merchant view sees the same external request',
    created && mText.includes(created.reference) && /REQUESTED/.test(mText),
    created ? created.reference : null);
  await mp.screenshot({ path: path.join(OUT, 'screenshots', '04_merchant_request.png'), fullPage: true });

  const canApprove = await mp.evaluate(() => !!document.getElementById('approve'));
  rec('5b · merchant has an Approve control', canApprove);
  await mp.evaluate(() => document.getElementById('approve').click());
  await sleep(7000);

  const afterApprove = await externalRead();
  w('merchant/external-open.json', {
    ...afterApprove,
    note: 'Independent Shopify query AFTER the merchant pressed Approve in the production merchant view.',
  });
  const opened = afterApprove.returns.find(r => r.status === 'OPEN');
  rec('5c · the SAME Return is now OPEN in Shopify',
    !!opened && created && opened.reference === created.reference && afterApprove.returns.length === 1,
    { returns: afterApprove.returns, sameReference: opened && created ? opened.reference === created.reference : false });

  const mText2 = await mp.evaluate(() => document.querySelector('.wrap').innerText);
  rec('5d · merchant view renders OPEN from Shopify', /OPEN/.test(mText2));
  await mp.screenshot({ path: path.join(OUT, 'screenshots', '05_merchant_approved.png'), fullPage: true });

  w('merchant/approval-response.json', {
    capturedAt: new Date().toISOString(),
    note: 'Approval performed by clicking the production merchant view, which calls returnApproveRequest server-side.',
    before: { reference: created && created.reference, status: 'REQUESTED' },
    after: { reference: opened && opened.reference, status: opened && opened.status },
    sameReturnObject: !!(created && opened && created.externalId === opened.externalId),
  });

  // ── 6. customer page discovers the decision from Shopify ──────────
  await page.bringToFront();
  await sleep(9000);                       // allow the page's own polling to run
  let custText = await page.evaluate(() => document.querySelector('.wrap').innerText);
  const sawViaPolling = /OPEN/.test(custText);
  if (!sawViaPolling) { await page.reload({ waitUntil: 'networkidle0' }); await sleep(3500);
    custText = await page.evaluate(() => document.querySelector('.wrap').innerText); }
  rec('6 · customer page reads OPEN back from Shopify', /OPEN/.test(custText),
    { viaPolling: sawViaPolling, viaReload: !sawViaPolling });
  await page.screenshot({ path: path.join(OUT, 'screenshots', '06_customer_open.png'), fullPage: true });

  // ── 7. restart persistence: a brand-new browser session ───────────
  const fresh = await browser.newPage();
  await fresh.goto(URL + '/', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3500);
  const freshText = await fresh.evaluate(() => document.querySelector('.wrap').innerText);
  const freshOrder = await fresh.evaluate(async () => {
    const l = await document.modelContext.getTools();
    const t = l.find(x => x.name === 'get_order');
    return JSON.parse(await document.modelContext.executeTool(t, '{}'));
  });
  w('restart/customer-requery.json', {
    capturedAt: new Date().toISOString(),
    note: 'A brand-new browser session with no prior state. The external return is rediscovered from Shopify.',
    rediscoveredReturns: freshOrder.existingReturns,
    orderReturnStatus: freshOrder.orderReturnStatus,
  });
  rec('7 · a fresh session rediscovers the external return',
    opened && freshText.includes(opened.reference) && /OPEN/.test(freshText) &&
    (freshOrder.existingReturns || []).some(r => r.status === 'OPEN'),
    freshOrder.existingReturns);

  // ── 8. duplicate protection on the live path ──────────────────────
  const dupBtn = await fresh.evaluate(() => !!document.getElementById('request-return'));
  rec('8 · no second return can be requested while one is live', dupBtn === false);

  rec('9 · no console errors across the whole loop', errs.length === 0, errs.slice(0, 3));

  await browser.close();

  const passed = steps.filter(s => s.pass).length;
  w('full-loop-result.json', {
    ranAt: new Date().toISOString(), order: ORDER, productionUrl: URL,
    note: 'Every mutation was performed by clicking the live production app. Direct Shopify calls here are read-only verification only.',
    externalBefore: before, externalAfterRequest: afterRequest, externalAfterApprove: afterApprove,
    returnCreated: created || null, returnApproved: opened || null,
    passed, total: steps.length, steps,
  });
  console.log('\n' + '='.repeat(58));
  console.log(`M4.2 FULL LOOP (${ORDER}): ${passed}/${steps.length}`);
  console.log('='.repeat(58));
  process.exit(passed === steps.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
