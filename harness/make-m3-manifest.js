const fs=require('fs'),path=require('path'),crypto=require('crypto');
const M3=path.join(__dirname,'..','evidence','m3');
function walk(dir,base){const out=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);
if(e.isDirectory())out.push(...walk(p,base));else if(e.name!=='manifest.json'){const b=fs.readFileSync(p);
out.push({file:path.relative(base,p).split(path.sep).join('/'),bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex').slice(0,16)});}}
return out.sort((a,b)=>a.file.localeCompare(b.file));}
const files=walk(M3,M3);
const frozen=JSON.parse(fs.readFileSync(path.join(M3,'dataset','FROZEN.json'),'utf8'));
const runs=files.filter(f=>f.file.startsWith('runs/')&&f.file.endsWith('.json')&&!f.file.includes('/streams/'));
const m={generatedAt:new Date().toISOString(),milestone:'M3',
 productionUrl:'https://post-purchase-resolution.vercel.app/',
 dataset:{file:frozen.dataset,sha256:frozen.sha256,intents:frozen.intentCount,heldOutFromM2:frozen.heldOut.verified,frozenAt:frozen.frozenAt},
 counts:{files:files.length,runRecords:runs.length,rawAgentStreams:files.filter(f=>f.file.includes('runs/streams/')).length},
 provenance:{rawEvidence:'runs/*.json and runs/streams/*.jsonl are written once and never edited; run-evals-m3.js refuses to overwrite without --force.',
  reports:'reports/ and failures/ are regenerated from run records by harness/make-m3-report.js.',
  separation:'M2 and M3 are NOT pooled. Different product, methodology and dataset.'},
 reproduce:['node harness/run-evals-m3.js --mode webmcp','node harness/run-evals-m3.js --mode baseline','node harness/make-m3-report.js','node harness/webmcp-m3-check.js','node harness/actuation-test.js'],
 files};
fs.writeFileSync(path.join(M3,'manifest.json'),JSON.stringify(m,null,2));
console.log(`M3 manifest: ${files.length} files, ${runs.length} run records`);
