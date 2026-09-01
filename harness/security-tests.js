/** M4.3 section 8 negative tests, against the live production deployment. */
const BASE=(process.env.APP_URL||'https://post-purchase-resolution.vercel.app').replace(/\/$/,'');
const out=[];const rec=(n,p,d)=>{out.push({name:n,pass:p,detail:d});
  console.log(`${p?'PASS':'FAIL'}  ${n}${d!==undefined?'  '+JSON.stringify(d).slice(0,130):''}`);};
const j=async(u,o)=>{const r=await fetch(u,o);let b;try{b=await r.json();}catch(e){b=null;}return{status:r.status,body:b};};

(async()=>{
  // arbitrary / cross-order access
  for (const probe of ['%231001','%239999','#1001','garbage','../admin','gid://shopify/Order/12602041500020']) {
    const r=await j(`${BASE}/api/order?order=${encodeURIComponent(probe)}`);
    const served=r.body&&r.body.order&&r.body.order.orderReference;
    rec(`order param "${probe.slice(0,28)}" cannot select another order`,
      r.status!==200 || served===undefined || served===(process.env.EXPECT_ORDER||'#1002'), {status:r.status,served});
  }

  // merchant authority
  const noTok=await j(`${BASE}/api/return-approve`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  rec('approve without a credential is refused', noTok.status===401 && noTok.body.code==='MERCHANT_UNAUTHORIZED', noTok.status);
  const badTok=await j(`${BASE}/api/return-approve`,{method:'POST',headers:{'content-type':'application/json','x-merchant-token':'x'.repeat(64)},body:'{}'});
  rec('approve with a wrong credential is refused', badTok.status===401, badTok.status);
  const emptyTok=await j(`${BASE}/api/return-approve`,{method:'POST',headers:{'content-type':'application/json','x-merchant-token':''},body:'{}'});
  rec('approve with an empty credential is refused', emptyTok.status===401, emptyTok.status);

  // mutations must not be reachable by GET
  for (const p of ['/api/return-approve','/api/return-request']) {
    const g=await j(`${BASE}${p}`);
    rec(`GET ${p} is refused`, g.status===405, g.status);
  }

  // malformed input must not crash or leak
  const mal=await j(`${BASE}/api/return-request`,{method:'POST',headers:{'content-type':'application/json'},body:'{"note":'+'"'+'x'.repeat(5000)+'"}'});
  rec('oversized note handled without a crash', mal.status<500, mal.status);
  const bad=await j(`${BASE}/api/return-request`,{method:'POST',headers:{'content-type':'application/json'},body:'not json'});
  rec('malformed JSON handled without a crash', bad.status<500, bad.status);

  // no secret leakage anywhere public
  for (const p of ['/','/merchant.html','/src/app.js','/src/live.js','/src/merchant.js','/api/order','/api/return-status']) {
    const r=await fetch(`${BASE}${p}`); const t=await r.text();
    rec(`no credential material on ${p}`,
      !/shpat_|client_secret|MERCHANT_OPERATOR_TOKEN=|SHOPIFY_CLIENT_SECRET/i.test(t));
  }

  // no stack traces in errors
  const errBody=JSON.stringify(noTok.body)+JSON.stringify(bad.body);
  rec('errors contain no stack traces or internal paths',
    !/\bat \w+ \(|node_modules|\.js:\d+|TypeError|ReferenceError/.test(errBody));

  const passed=out.filter(o=>o.pass).length;
  console.log(`\n${'='.repeat(54)}\nSECURITY: ${passed}/${out.length}\n${'='.repeat(54)}`);
  require('fs').writeFileSync('evidence/m4-chatgpt-native/security-tests.json',
    JSON.stringify({ranAt:new Date().toISOString(),target:BASE,passed,total:out.length,tests:out},null,2));
  process.exit(passed===out.length?0:1);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
