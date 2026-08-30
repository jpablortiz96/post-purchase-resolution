const puppeteer=require('puppeteer-core');
const path=require('path');
const URL=process.env.APP_URL||'http://localhost:3000/';
const OUT=process.env.OUT_DIR||path.join(__dirname,'..','evidence','m1');
require('fs').mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await puppeteer.launch({headless:'new',
    executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args:['--enable-features=WebMCPTesting,DevToolsWebMCPSupport','--enable-experimental-web-platform-features','--no-first-run','--disable-gpu'],
    defaultViewport:{width:900,height:1200}});
  const p=await b.newPage();
  const call=(n,a)=>p.evaluate(async(n,a)=>{const l=await document.modelContext.getTools();const t=l.find(x=>x.name===n);return t?await document.modelContext.executeTool(t,JSON.stringify(a||{})):null;},n,a);
  await p.goto(URL,{waitUntil:'networkidle0'}); await sleep(1200);
  await p.screenshot({path:path.join(OUT,'ui_01_initial.png'),fullPage:true});
  await call('prepare_resolution',{resolution_id:'replacement',reason:'You travel tomorrow, so a replacement arriving tomorrow is the only option that gets you working headphones before you leave. A refund would take 3-5 days.'});
  await sleep(700);
  await p.screenshot({path:path.join(OUT,'ui_02_decision_card.png'),fullPage:true});
  await p.evaluate(()=>document.getElementById('choose').click()); await sleep(400);
  await p.screenshot({path:path.join(OUT,'ui_03_choose_another.png'),fullPage:true});
  await p.evaluate(()=>document.getElementById('cancel-choice').click()); await sleep(300);
  await p.evaluate(()=>document.getElementById('approve').click()); await sleep(500);
  await p.screenshot({path:path.join(OUT,'ui_04_approved.png'),fullPage:true});
  await call('confirm_resolution',{resolution_id:'replacement'}); await sleep(700);
  await p.evaluate(()=>{const d=document.querySelector('details.proto'); if(d) d.open=true;}); await sleep(300);
  await p.screenshot({path:path.join(OUT,'ui_05_resolved.png'),fullPage:true});
  await b.close(); console.log('shots done');
})();
