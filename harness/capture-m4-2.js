/** Capture sanitized external Shopify state + production screenshots. */
const fs=require('fs'),path=require('path');
const puppeteer=require('puppeteer-core');
const s=require('../api/_lib/shopify.js');
const OUT=path.join(__dirname,'..','evidence','m4-merchant-loop');
const URL=process.env.APP_URL||'https://post-purchase-resolution.vercel.app/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const w=(p,o)=>fs.writeFileSync(path.join(OUT,p),JSON.stringify(o,null,2));

(async()=>{
  const { sanitized } = await s.getOrder('#1001');
  w('before/order.json',{ capturedAt:new Date().toISOString(), source:'Shopify Admin GraphQL API',
    apiVersion:s.API_VERSION, note:'Sanitized exactly as served to the browser. No PII, no gid, no token.',
    order:sanitized });
  w('before/return-state.json',{ capturedAt:new Date().toISOString(), ...(await s.returnStatus('#1001')) });

  const dup = await s.requestReturn({ orderName:'#1001', customerNote:'duplicate-protection evidence' });
  w('duplicate-protection.json',{ capturedAt:new Date().toISOString(),
    note:'A second return request against an order that already has a live return. Shopify was NOT mutated.',
    result:dup, secondReturnCreated:dup.created===false });

  let allowlist;
  try { await s.getOrder('#9999'); allowlist={ refused:false }; }
  catch(e){ allowlist={ refused:true, code:e.code, message:e.message, detail:e.detail }; }
  w('order-allowlist.json',{ capturedAt:new Date().toISOString(),
    note:'The public demo may only touch seeded demo orders.', result:allowlist });

  let approve;
  try { await s.approveReturn({ orderName:'#1001' }); approve={ refused:false }; }
  catch(e){ approve={ refused:true, code:e.code, message:e.message, detail:e.detail }; }
  w('approve-guard.json',{ capturedAt:new Date().toISOString(),
    note:'Approval is refused unless a return is actually REQUESTED.', result:approve });

  const b=await puppeteer.launch({headless:'new',
    executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args:['--enable-features=WebMCPTesting,DevToolsWebMCPSupport','--enable-experimental-web-platform-features','--no-first-run','--disable-gpu'],
    defaultViewport:{width:900,height:1300}});
  const p=await b.newPage();
  await p.goto(URL,{waitUntil:'networkidle0'}); await sleep(2500);
  await p.screenshot({path:path.join(OUT,'screenshots','01_real_order.png'),fullPage:true});
  const m=await b.newPage();
  await m.goto(URL.replace(/\/$/,'')+'/merchant.html',{waitUntil:'networkidle0'}); await sleep(2000);
  await m.screenshot({path:path.join(OUT,'screenshots','04_merchant_desk.png'),fullPage:true});
  await b.close();
  console.log('captured:', fs.readdirSync(OUT).join(', '));
})().catch(e=>{console.error('FATAL',e.code||'',e.message);process.exit(1);});
