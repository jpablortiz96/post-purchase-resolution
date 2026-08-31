/**
 * M2 eval matrix driver.
 *
 * Usage:
 *   node harness/run-evals.js --mode webmcp  --pattern C --out evidence/m2/runs
 *   node harness/run-evals.js --mode baseline --pattern C --out evidence/m2/runs
 *   node harness/run-evals.js --mode webmcp --pattern A --ids D01,W01,L01
 *
 * Raw run records are append-only: an existing run file is never overwritten
 * unless --force is passed.
 */

const fs = require('fs');
const path = require('path');
const { runTask } = require('./eval-run.js');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 ? argv[i + 1] : d;
};
const has = k => argv.includes('--' + k);

const MODE = arg('mode', 'webmcp');
const PATTERN = arg('pattern', 'C');
const OUT = path.resolve(arg('out', path.join(__dirname, '..', 'evidence', 'm2', 'runs')));
const IDS = arg('ids', null);
const LIMIT = parseInt(arg('limit', '0'), 10);
const TOOL_LOG = process.env.TOOL_LOG || path.join(__dirname, '..', 'evidence', 'm2', 'raw', MODE, 'agent-tools.jsonl');

const dataset = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'evidence', 'm2', 'dataset', 'customer-intents.json'), 'utf8'));

let intents = dataset.intents;
if (IDS) {
  const want = IDS.split(',').map(s => s.trim());
  intents = intents.filter(i => want.includes(i.id));
}
if (LIMIT > 0) intents = intents.slice(0, LIMIT);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`MODE=${MODE} PATTERN=${PATTERN} intents=${intents.length} out=${OUT}`);

  let done = 0, ok = 0;
  for (const intent of intents) {
    const runId = `${MODE}-${intent.id}-${PATTERN}`;
    const file = path.join(OUT, `${runId}.json`);
    if (fs.existsSync(file) && !has('force')) {
      console.log(`SKIP  ${runId} (already recorded)`);
      done++; if (JSON.parse(fs.readFileSync(file, 'utf8')).success) ok++;
      continue;
    }

    const started = Date.now();
    let run;
    try {
      run = await runTask({ mode: MODE, intent, pattern: PATTERN, toolLogPath: TOOL_LOG, outDir: OUT });
    } catch (e) {
      run = { runId, mode: MODE, pattern: PATTERN, intentId: intent.id, scenario: intent.scenario,
              prompt: intent.text, success: false, harnessError: String(e && e.message || e),
              startedAt: new Date().toISOString() };
      fs.writeFileSync(file, JSON.stringify(run, null, 2));
    }

    done++; if (run.success) ok++;
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    console.log(
      `${run.success ? 'OK  ' : 'FAIL'}  ${runId.padEnd(24)} ${String(run.finalState).padEnd(20)} ` +
      `res=${String(run.resolutionResult).padEnd(9)} turns=${run.customerTurns} calls=${run.agentToolCalls} ` +
      `invalid=${run.invalidActions} approvalViol=${run.approvalViolations} ${secs}s`
    );
  }

  console.log(`\n${MODE}/${PATTERN}: ${ok}/${done} successful`);
})().catch(e => { console.error('DRIVER FATAL', e); process.exit(1); });
