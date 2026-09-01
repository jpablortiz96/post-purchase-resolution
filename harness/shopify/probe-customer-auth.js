/** Decisive: is the existing client_id usable as a Customer Account public client? */
const puppeteer=require('puppeteer-core');
const AZ='https://shopify.com/authentication/102186582388/oauth/authorize';
const RED='https://post-purchase-resolution.vercel.app/api/auth/callback';
const q=new URLSearchParams({client_id:process.env.SHOPIFY_CLIENT_ID,response_type:'code',
  redirect_uri:RED,scope:'openid email customer-account-api:full',state:'probe',
  code_challenge:'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',code_challenge_method:'S256'});
(async()=>{
  const b=await puppeteer.launch({headless:'new',
    executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args:['--no-first-run','--disable-gpu']});
  const p=await b.newPage();
  const resp=await p.goto(`${AZ}?${q}`,{waitUntil:'networkidle0',timeout:45000});
  await new Promise(r=>setTimeout(r,2500));
  console.log('final status:', resp.status());
  console.log('final url   :', p.url().slice(0,140));
  const txt=await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').trim());
  console.log('page text   :', txt.slice(0,400));
  await b.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
