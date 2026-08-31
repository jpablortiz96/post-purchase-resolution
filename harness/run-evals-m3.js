/**
 * M3 eval matrix driver. Append-only: never overwrites a run without --force.
 */
const fs = require('fs');
const path = require('path');
const { runTask } = require('./eval-run-m3.js');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const has = k => argv.includes('--' + k);

const MODE = arg('mode', 'webmcp');
const OUT = path.resolve(arg('out', path.join(__dirname, '..', 'evidence', 'm3', 'runs')));
const IDS = arg('ids', null);
const TOOL_LOG = process.env.TOOL_LOG || path.join(__dirname, '..', 'evidence', 'm3', 'raw', MODE, 'agent-tools.jsonl');

const ds = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'evidence', 'm3', 'dataset', 'customer-intents-m3.json'), 'utf8'));
let intents = ds.intents;
if (IDS) { const w = IDS.split(',').map(s => s.trim()); intents = intents.filter(i => w.includes(i.id)); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`M3 MODE=${MODE} intents=${intents.length}`);
  let done = 0, agentOk = 0, custOk = 0;

  for (const intent of intents) {
    const file = path.join(OUT, `${MODE}-${intent.id}.json`);
    if (fs.existsSync(file) && !has('force')) {
      const r = JSON.parse(fs.readFileSync(file, 'utf8'));
      console.log(`SKIP  ${MODE}-${intent.id}`);
      done++; if (r.agentTaskSuccess) agentOk++; if (r.customerCompletionSuccess) custOk++;
      continue;
    }
    const t = Date.now();
    let run;
    try {
      run = await runTask({ mode: MODE, intent, toolLogPath: TOOL_LOG, outDir: OUT });
    } catch (e) {
      run = { runId: `${MODE}-${intent.id}`, mode: MODE, intentId: intent.id, scenario: intent.scenario,
              agentTaskSuccess: false, customerCompletionSuccess: false, harnessError: String(e && e.message || e) };
      fs.writeFileSync(file, JSON.stringify(run, null, 2));
    }
    done++; if (run.agentTaskSuccess) agentOk++; if (run.customerCompletionSuccess) custOk++;
    console.log(
      `${run.agentTaskSuccess ? 'AGENT-OK ' : 'AGENT-NO '}${run.customerCompletionSuccess ? 'DONE ' : '---- '}` +
      `${(MODE + '-' + intent.id).padEnd(18)} prep=${String(run.preparedResolution).padEnd(20)} ` +
      `pref=${run.agentChoice ? run.agentChoice.preferred : '?'} turns=${run.customerTurns} ` +
      `premature=${run.prematureCommitment} ${((Date.now() - t) / 1000).toFixed(0)}s`);
  }
  console.log(`\n${MODE}: agent task ${agentOk}/${done} · customer completion ${custOk}/${done}`);
})().catch(e => { console.error('DRIVER FATAL', e); process.exit(1); });
