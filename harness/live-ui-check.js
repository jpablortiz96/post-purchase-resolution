/** Verify the LIVE customer page and merchant desk against real Shopify. */
const puppeteer = require('puppeteer-core');
const URL = process.env.APP_URL || 'http://localhost:3300/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
const rec = (n, p, d) => { out.push({n,p,d}); console.log(`${p?'PASS':'FAIL'}  ${n}${d!==undefined?'  '+JSON.stringify(d).slice(0,150):''}`); };

(async () => {
  const b = await puppeteer.launch({ headless:'new',
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args:['--enable-features=WebMCPTesting,DevToolsWebMCPSupport','--enable-experimental-web-platform-features','--no-first-run','--disable-gpu'],
    defaultViewport:{width:1000,height:1300} });
  const p = await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });

  await p.goto(URL, { waitUntil:'networkidle0', timeout:45000 });
  await sleep(2500);

  const text = await p.evaluate(() => document.querySelector('.wrap').innerText);
  rec('live mode boots by default', /Live Shopify order/i.test(text));
  rec('real order reference rendered', text.includes('#1001'), text.match(/#1001[^\n]*/)?.[0]);
  rec('real product rendered', text.includes('Wireless Headphones'));
  rec('real Shopify status rendered', /OPEN/.test(text));
  rec('shows the existing return reference', text.includes('#1001-R1'));

  const tools = await p.evaluate(async () => (await document.modelContext.getTools()).map(t=>t.name));
  rec('WebMCP contract still minimal in live mode',
    tools.every(t => ['get_order','prepare_resolution'].includes(t)), tools);
  rec('no completion tool exposed in live mode',
    !tools.some(t=>/confirm|commit|complete|approve|finali|return_request/i.test(t)), tools);

  const order = await p.evaluate(async () => {
    const l = await document.modelContext.getTools(); const t = l.find(x=>x.name==='get_order');
    return t ? JSON.parse(await document.modelContext.executeTool(t, '{}')) : null;
  });
  rec('get_order returns Shopify-backed facts',
    order && order.source==='shopify' && order.orderReference==='#1001' && order.financialStatus==='PAID',
    order && { ref: order.orderReference, fin: order.financialStatus, ful: order.fulfillmentStatus });
  const blob = JSON.stringify(order).toLowerCase();
  rec('get_order leaks no PII or secrets',
    !/\bemail\b|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\bphone\b|\baddress\d?\b|gid:\/\/|shpat_|myshopify/.test(blob));

  // merchant desk
  const m = await b.newPage();
  await m.goto(URL.replace(/\/$/, '') + '/merchant.html', { waitUntil:'networkidle0' });
  await sleep(2000);
  const mtext = await m.evaluate(() => document.querySelector('.wrap').innerText);
  rec('merchant desk reads the same external return',
    mtext.includes('#1001-R1') && /OPEN/.test(mtext), mtext.match(/#1001-R\d[^\n]*/)?.[0]);
  rec('merchant desk offers no approve button when nothing is REQUESTED',
    !(await m.evaluate(() => !!document.getElementById('approve'))));

  rec('no console errors', errs.length===0, errs.slice(0,3));
  await b.close();
  const passed = out.filter(r=>r.p).length;
  console.log(`\n${'='.repeat(52)}\nLIVE UI: ${passed}/${out.length}\n${'='.repeat(52)}`);
  process.exit(passed===out.length?0:1);
})().catch(e=>{ console.error('FATAL', e.message); process.exit(1); });
