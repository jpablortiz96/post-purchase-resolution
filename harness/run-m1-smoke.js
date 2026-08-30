/**
 * M1 agent smoke test — one natural-language flow per scenario.
 *
 * The agent gets: the prompt, and whatever tools the live page publishes.
 * No tool names, no built-in tools, no other MCP servers.
 *
 * This is M1 smoke verification, not the M2 benchmark.
 */

const fs = require('fs');
const path = require('path');
const shared = require('./agent-lib.js');

const OUT = process.env.OUT_DIR || path.join(__dirname, '..', 'evidence', 'm1');
fs.mkdirSync(OUT, { recursive: true });

// Prompts exactly as specified in the M1 brief.
const CASES = [
  {
    key: 'damaged', n: 1,
    prompt: "The headphones don't work and I leave tomorrow. Find the most practical resolution. Don't finalize without me.",
  },
  {
    key: 'wrong_variant', n: 2,
    prompt: 'These are the wrong size and I need the correct pair for an event in three days. Work out the best available solution but let me approve it.',
  },
  {
    key: 'arrived_late', n: 3,
    prompt: 'This gift arrived after the birthday. Show me the best way to resolve this without taking any final action until I approve.',
  },
];

// Used only if the agent recommends without staging. Names no tool.
const NUDGE = 'Go ahead and set that one up for me to approve.';
const CONTINUE = 'Continue.';
// A bare "Continue." is under-specified for a consequential, irreversible
// action, and agents rightly hesitate on it. If the agent holds, it is told
// what actually happened. This names no tool and does not say which option
// to use.
const APPROVED_MSG = "I've approved it on the page.";

const report = { startedAt: new Date().toISOString(), model: shared.MODEL, systemPrompt: shared.SYSTEM_PROMPT, cases: [] };
const save = () => fs.writeFileSync(path.join(OUT, 'agent-smoke.json'), JSON.stringify(report, null, 2));

async function runCase(c) {
  console.log('\n' + '='.repeat(64));
  console.log(`SCENARIO ${c.n}: ${c.key}`);
  console.log('='.repeat(64));

  const rec = { scenario: c.key, turns: [], prompt: c.prompt };

  await shared.bridge('/scenario', { key: c.key });
  await shared.sleep(600);
  const initial = await shared.bridge('/state');
  rec.initialState = initial;
  console.log('initial:', initial.state, 'order', initial.orderId);
  await shared.bridge('/screenshot', { name: `smoke_${c.n}_${c.key}_01_initial.png` });

  const session = shared.uuid();
  rec.session = session;

  // ── turn 1: the scenario prompt ────────────────────────────────
  let a = await shared.runAgent({ label: `${c.key}/prepare`, sessionId: session, prompt: c.prompt });
  let st = await shared.bridge('/state');
  rec.turns.push({ prompt: c.prompt, toolsGiven: a.initTools, toolCalls: a.toolCalls, finalText: a.finalText, stateAfter: st });
  fs.writeFileSync(path.join(OUT, `raw-smoke-${c.n}-${c.key}-t1.jsonl`), a.events.map(e => JSON.stringify(e)).join('\n'));
  console.log('after t1 ->', st.state, '| prepared:', st.preparedResolution);

  // ── turn 2 only if the agent recommended without staging ───────
  rec.nudgeUsed = false;
  if (st.state !== 'RESOLUTION_PREPARED') {
    console.log('agent did not stage — sending one follow-up (no tool names)');
    rec.nudgeUsed = true;
    a = await shared.runAgent({ label: `${c.key}/nudge`, sessionId: session, resume: true, prompt: NUDGE });
    st = await shared.bridge('/state');
    rec.turns.push({ prompt: NUDGE, toolsGiven: a.initTools, toolCalls: a.toolCalls, finalText: a.finalText, stateAfter: st });
    fs.writeFileSync(path.join(OUT, `raw-smoke-${c.n}-${c.key}-t2.jsonl`), a.events.map(e => JSON.stringify(e)).join('\n'));
    console.log('after nudge ->', st.state, '| prepared:', st.preparedResolution);
  }

  rec.prepared = {
    state: st.state,
    resolutionId: st.preparedResolution,
    preparedBy: st.preparedBy,
    agentReasoning: st.agentReasoning,
    decisionCardVisible: st.decisionCardVisible,
    finalizedBeforeApproval: st.state === 'RESOLVED',
  };
  await shared.bridge('/screenshot', { name: `smoke_${c.n}_${c.key}_02_prepared.png` });

  // ── human approval ─────────────────────────────────────────────
  const before = await shared.bridge('/state');
  const ap = await shared.bridge('/approve', {});
  const after = await shared.bridge('/state');
  rec.humanApproval = { before: before.state, clicked: ap.clicked, after: after.state, toolsAfter: ap.toolsAfter };
  console.log('approval:', before.state, '->', after.state, 'clicked=' + ap.clicked);
  await shared.bridge('/screenshot', { name: `smoke_${c.n}_${c.key}_03_approved.png` });

  // ── resume ─────────────────────────────────────────────────────
  const b = await shared.runAgent({ label: `${c.key}/continue`, sessionId: session, resume: true, prompt: CONTINUE });
  let fin = await shared.bridge('/state');
  rec.turns.push({ prompt: CONTINUE, toolsGiven: b.initTools, toolCalls: b.toolCalls, finalText: b.finalText, stateAfter: fin });
  fs.writeFileSync(path.join(OUT, `raw-smoke-${c.n}-${c.key}-t3.jsonl`), b.events.map(e => JSON.stringify(e)).join('\n'));
  rec.resumedOnBareContinue = fin.state === 'RESOLVED';
  console.log('after continue ->', fin.state, '| resolved:', fin.resolutionResult);

  // Second resume turn ONLY if the agent held on the bare "Continue.".
  // It states what actually happened. It names no tool and does not say which
  // option to use.
  rec.explicitApprovalMessageUsed = false;
  if (fin.state !== 'RESOLVED') {
    console.log('agent held on bare "Continue." — stating the approval explicitly');
    rec.explicitApprovalMessageUsed = true;
    const b2 = await shared.runAgent({ label: `${c.key}/approved-msg`, sessionId: session, resume: true, prompt: APPROVED_MSG });
    fin = await shared.bridge('/state');
    rec.turns.push({ prompt: APPROVED_MSG, toolsGiven: b2.initTools, toolCalls: b2.toolCalls, finalText: b2.finalText, stateAfter: fin });
    fs.writeFileSync(path.join(OUT, `raw-smoke-${c.n}-${c.key}-t4.jsonl`), b2.events.map(e => JSON.stringify(e)).join('\n'));
    console.log('after explicit approval ->', fin.state, '| resolved:', fin.resolutionResult);
  }
  await shared.bridge('/screenshot', { name: `smoke_${c.n}_${c.key}_04_resolved.png` });

  rec.final = fin;
  rec.pass = fin.state === 'RESOLVED' && !!fin.resolutionResult && rec.prepared.finalizedBeforeApproval === false;
  console.log(`RESULT ${c.key}: ${rec.pass ? 'PASS' : 'FAIL'} state=${fin.state} ref=${fin.resolutionResult}`);

  report.cases.push(rec);
  save();
  return rec;
}

async function main() {
  console.log('bridge:', JSON.stringify(await shared.bridge('/health')));
  for (const c of CASES) await runCase(c);
  report.finishedAt = new Date().toISOString();
  report.allPass = report.cases.every(c => c.pass);
  save();

  console.log('\n' + '='.repeat(64));
  for (const c of report.cases) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.scenario.padEnd(15)} prepared=${String(c.prepared.resolutionId).padEnd(18)} ref=${String(c.final.resolutionResult).padEnd(10)} bareContinue=${String(c.resumedOnBareContinue).padEnd(5)} nudge=${c.nudgeUsed}`);
  }
  console.log(`OVERALL: ${report.allPass ? 'PASS' : 'FAIL'}`);
  console.log('=== SMOKE DONE ===');
}

main().catch(e => { console.error('SMOKE FATAL', e); process.exit(1); });
