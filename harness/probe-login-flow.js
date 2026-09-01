/** What does a real customer sign-in actually require? */
const puppeteer=require('puppeteer-core');
(async()=>{
  const b=await puppeteer.launch({headless:'new',
    executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args:['--no-first-run','--disable-gpu']});
  const p=await b.newPage();
  await p.goto('https://post-purchase-resolution.vercel.app/api/auth/login',{waitUntil:'networkidle0',timeout:60000});
  await new Promise(r=>setTimeout(r,3000));
  console.log('landed on:', p.url().split('?')[0]);
  const info=await p.evaluate(()=>({
    text: document.body.innerText.replace(/\s+/g,' ').trim().slice(0,300),
    inputs: Array.from(document.querySelectorAll('input')).map(i=>({type:i.type,name:i.name||i.id,placeholder:i.placeholder})),
    buttons: Array.from(document.querySelectorAll('button')).map(x=>x.innerText.trim()).filter(Boolean),
  }));
  console.log('page text:', info.text);
  console.log('inputs  :', JSON.stringify(info.inputs));
  console.log('buttons :', JSON.stringify(info.buttons));
  await b.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
