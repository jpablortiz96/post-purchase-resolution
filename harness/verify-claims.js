/** After the loop: verify on-page claims match reality in both modes. */
const puppeteer=require('puppeteer-core');
const URL=(process.env.APP_URL||'https://post-purchase-resolution.vercel.app/').replace(/\/$/,'');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const out=[];const rec=(n,p,d)=>{out.push({n,p,d});console.log(`${p?'PASS':'FAIL'}  ${n}${d!==undefined?'  '+JSON.stringify(d).slice(0,140):''}`);};
(async()=>{
  const b=await puppeteer.launch({headless:'new',
    executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args:['--enable-features=WebMCPTesting,DevToolsWebMCPSupport','--enable-experimental-web-platform-features','--no-first-run','--disable-gpu'],
    defaultViewport:{width:1000,height:1300}});

  const live=await b.newPage();
  await live.goto(URL+'/',{waitUntil:'networkidle0'}); await sleep(3500);
  const lt=await live.evaluate(()=>document.querySelector('.wrap').innerText);
  rec('live mode does NOT claim "no external commerce system"', !/no external commerce system/i.test(lt));
  rec('live mode states it is a Shopify development store', /shopify development store/i.test(lt));
  rec('live mode says no real money moves', /no real money/i.test(lt));
  rec('live mode shows the real return and OPEN', /#1002-R1/.test(lt) && /OPEN/.test(lt));
  await live.screenshot({path:'evidence/m4-merchant-loop/screenshots/06_customer_open.png',fullPage:true});

  const fx=await b.newPage();
  await fx.goto(URL+'/?mode=fixtures',{waitUntil:'networkidle0'}); await sleep(2500);
  const ft=await fx.evaluate(()=>document.querySelector('.wrap').innerText);
  rec('fixture mode still labels itself as fixtures', /deterministic merchant fixtures/i.test(ft));
  rec('fixture mode says no external system in this mode', /no external commerce system is connected in this mode/i.test(ft));
  rec('fixture mode does not show Shopify data', !/#1002/.test(ft));

  await b.close();
  const p=out.filter(x=>x.p).length;
  console.log(`\n${'='.repeat(50)}\nCLAIM ACCURACY: ${p}/${out.length}\n${'='.repeat(50)}`);
  process.exit(p===out.length?0:1);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
