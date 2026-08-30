/**
 * J7 — wording-independence test.
 *
 * J6 as specified did not complete the flow, because its prompt is not a
 * paraphrase of J2: it drops the instruction to prepare and strengthens the
 * prohibition ("don't commit to anything until I say yes"). The agent honoured
 * that literally and declined to stage. That result stands, unmodified.
 *
 * This runs a prompt that IS a genuine paraphrase of J2's intent — same four
 * elements (damage, urgency, stage the fastest fix, do not finalize without
 * approval), entirely different vocabulary, no tool names — so that
 * wording-independence is actually what gets measured.
 */

const fs = require('fs');
const path = require('path');
const shared = require('./agent-lib.js');

const OUT = path.join(__dirname, '..', 'evidence', 'm0-agent');

const PREPARE_PROMPT =
  "These headphones showed up busted and I'm flying out tomorrow. Set up " +
  "whatever gets me a working pair quickest — just don't pull the trigger on " +
  "it until I've signed off.";

async function main() {
  const report = { startedAt: new Date().toISOString(), label: 'J7', phases: [] };
  const rec = (k, v) => { report.phases.push(Object.assign({ phase: k }, v)); fs.writeFileSync(path.join(OUT, 'agent-run-j7.json'), JSON.stringify(report, null, 2)); };

  const health = await shared.bridge('/health');
  report.appUrl = health.appUrl;
  report.model = shared.MODEL;
  report.systemPrompt = shared.SYSTEM_PROMPT;
  console.log('BRIDGE ->', JSON.stringify(health));

  await shared.bridge('/reset', {});
  await shared.sleep(900);
  const initial = await shared.state();
  console.log('INITIAL:', initial.state, JSON.stringify(initial.activeToolChips));

  const session = shared.uuid();

  // --- prepare turn ---
  const a = await shared.runAgent({ label: 'J7-prepare', sessionId: session, prompt: PREPARE_PROMPT });
  await shared.sleep(700);
  const afterPrepare = await shared.state();
  await shared.bridge('/screenshot', { name: '11_variant_prepare.png' });
  rec('J7_PREPARE', {
    prompt: PREPARE_PROMPT, toolsGivenToAgent: a.initTools,
    toolCalls: a.toolCalls, finalText: a.finalText, stateAfter: afterPrepare,
  });
  fs.writeFileSync(path.join(OUT, 'raw-j7a-stream.jsonl'), a.events.map(e => JSON.stringify(e)).join('\n'));
  console.log('J7a: tools=' + JSON.stringify(a.toolCalls.map(t => t.name)) + ' state=' + afterPrepare.state);

  // --- human approval ---
  const before = await shared.state();
  const ap = await shared.bridge('/approve', {});
  await shared.sleep(700);
  const after = await shared.state();
  await shared.bridge('/screenshot', { name: '12_variant_approval.png' });
  rec('J7_APPROVAL', { before: before.state, clicked: ap.clicked, after: after.state, toolsAfter: ap.toolsAfter });
  console.log('J7 approval: ' + before.state + ' -> ' + after.state + ' clicked=' + ap.clicked);

  // --- resume ---
  const b = await shared.runAgent({ label: 'J7-continue', sessionId: session, resume: true, prompt: 'Continue.' });
  await shared.sleep(700);
  const final = await shared.state();
  await shared.bridge('/screenshot', { name: '13_variant_resolved.png' });
  rec('J7_RESUME', {
    prompt: 'Continue.', toolsGivenToAgent: b.initTools,
    toolCalls: b.toolCalls, finalText: b.finalText, stateAfter: final,
    reachedResolved: final.state === 'RESOLVED', replacementId: final.replacementId,
  });
  fs.writeFileSync(path.join(OUT, 'raw-j7b-stream.jsonl'), b.events.map(e => JSON.stringify(e)).join('\n'));
  console.log('J7b: tools=' + JSON.stringify(b.toolCalls.map(t => t.name)) +
              ' state=' + final.state + ' id=' + final.replacementId);

  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'agent-run-j7.json'), JSON.stringify(report, null, 2));
  console.log('=== J7 DONE ===');
}

main().catch(e => { console.error('J7 FATAL', e); process.exit(1); });
