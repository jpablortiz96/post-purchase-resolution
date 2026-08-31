/**
 * Generates evidence/m3/reports/ from raw M3 run records only.
 * No number here is authored by hand.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RUNS = path.join(ROOT, 'evidence', 'm3', 'runs');
const REPORTS = path.join(ROOT, 'evidence', 'm3', 'reports');
const FAILURES = path.join(ROOT, 'evidence', 'm3', 'failures');
fs.mkdirSync(REPORTS, { recursive: true });
fs.mkdirSync(FAILURES, { recursive: true });

const runs = fs.readdirSync(RUNS).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(RUNS, f), 'utf8')));

const median = xs => {
  const v = xs.filter(x => typeof x === 'number' && !isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const sum = xs => xs.reduce((a, b) => a + (b || 0), 0);
const pct = (n, d) => d ? `${((n / d) * 100).toFixed(0)}%` : 'n/a';
const secs = ms => ms == null ? 'n/a' : (ms / 1000).toFixed(1) + 's';

const SNAP = JSON.parse(fs.readFileSync(path.join(__dirname, 'policy-snapshot.json'), 'utf8'));

/** Same refined policy-fact check as M2 V2, applied identically to both modes. */
function policyClean(run) {
  const sc = SNAP[run.scenario];
  const money = new Set([sc.order.price]);
  const days = new Set([14, 3]);
  for (const o of sc.options) {
    if (typeof o.economicImpact.refundToCustomer === 'number') money.add(o.economicImpact.refundToCustomer);
    if (typeof o.economicImpact.storeCreditToCustomer === 'number') money.add(o.economicImpact.storeCreditToCustomer);
    if (typeof o.timing.businessDays === 'number') days.add(o.timing.businessDays);
  }
  const base = [...money];
  for (const a of base) for (const b of base) {
    if (a > b) money.add(Math.round((a - b) * 100) / 100);
    money.add(Math.round((a + b) * 100) / 100);
  }
  const ctx = (sc.issue.description + ' ' + sc.issue.headline + ' ' + run.prompt).toLowerCase();
  for (const m of ctx.matchAll(/(\d+)/g)) { days.add(+m[1]); money.add(+m[1]); }
  for (const [w, v] of Object.entries({ one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7, ten: 10, fourteen: 14, twenty: 20, thirty: 30 })) {
    if (new RegExp(`\\b${w}\\b`).test(ctx)) { days.add(v); money.add(v); if (/week/.test(ctx)) days.add(v * 7); }
  }
  const text = (run.turns || []).map(t => t.finalText).join('\n');
  const badMoney = [...text.matchAll(/\$\s?(\d+(?:\.\d{1,2})?)/g)].map(m => parseFloat(m[1])).filter(v => !money.has(v));
  const badDays = [...text.matchAll(/(\d+)\s*(?:business\s*)?days?/gi)].map(m => parseInt(m[1], 10)).filter(v => !days.has(v));
  return { clean: !badMoney.length && !badDays.length, badMoney, badDays };
}

function classify(r) {
  if (r.harnessError) return 'environment';
  if (r.timedOut) return 'timeout';
  if (r.prematureCommitment) return 'premature commitment';
  if (!r.preparedResolution) {
    const calls = sum((r.turns || []).map(t => t.toolCalls.length));
    return calls === 0 ? 'intent interpretation' : 'did not stage within turn budget';
  }
  if (r.agentChoice && r.agentChoice.violatedUnacceptable) return 'policy reasoning — chose an outcome the customer ruled out';
  if (r.agentChoice && !r.agentChoice.acceptable) return 'policy reasoning — staged an option outside the customer profile';
  if (!r.customerCompletionSuccess) return 'customer completion';
  return 'other';
}

function summarize(rs) {
  const n = rs.length;
  const clean = rs.filter(r => policyClean(r).clean);
  return {
    n,
    agentTaskSuccess: rs.filter(r => r.agentTaskSuccess).length,
    preferredMatch: rs.filter(r => r.agentChoice && r.agentChoice.preferred).length,
    staged: rs.filter(r => r.agentChoice && r.agentChoice.staged).length,
    violatedUnacceptable: rs.filter(r => r.agentChoice && r.agentChoice.violatedUnacceptable).length,
    customerCompletion: rs.filter(r => r.customerCompletionSuccess).length,
    policyClean: clean.length,
    prematureCommitments: rs.filter(r => r.prematureCommitment).length,
    invalidActions: sum(rs.map(r => r.invalidActions)),
    staleAttempts: sum(rs.map(r => r.staleAttempts)),
    medianClarifications: median(rs.map(r => r.clarificationTurns)),
    medianCustomerTurns: median(rs.map(r => r.customerTurns)),
    medianAgentToolCalls: median(rs.map(r => r.agentToolCalls)),
    medianMsToPrepared: median(rs.map(r => r.msToPrepared)),
    medianMsToCompleted: median(rs.map(r => r.msToCompleted)),
    stateErrors: rs.filter(r => r.harnessError).length,
    timeouts: rs.filter(r => r.timedOut).length,
    neededRecovery: rs.filter(r => r.clarificationTurns > 0 || r.invalidActions > 0).length,
    recovered: rs.filter(r => (r.clarificationTurns > 0 || r.invalidActions > 0) && r.agentTaskSuccess).length,
  };
}

function main() {
  const w = runs.filter(r => r.mode === 'webmcp');
  const b = runs.filter(r => r.mode === 'baseline');
  const W = summarize(w), B = summarize(b);
  const d = (a, c) => (a == null || c == null) ? 'n/a' : `${c - a > 0 ? '+' : ''}${c - a}`;

  const rows = [
    ['Runs', B.n, W.n, ''],
    ['**AGENT TASK SUCCESS**', `${B.agentTaskSuccess}/${B.n} (${pct(B.agentTaskSuccess, B.n)})`, `${W.agentTaskSuccess}/${W.n} (${pct(W.agentTaskSuccess, W.n)})`, d(B.agentTaskSuccess, W.agentTaskSuccess)],
    ['— staged anything at all', `${B.staged}/${B.n}`, `${W.staged}/${W.n}`, d(B.staged, W.staged)],
    ['— matched the customer’s *preferred* option', `${B.preferredMatch}/${B.n} (${pct(B.preferredMatch, B.n)})`, `${W.preferredMatch}/${W.n} (${pct(W.preferredMatch, W.n)})`, d(B.preferredMatch, W.preferredMatch)],
    ['— staged something the customer ruled out', B.violatedUnacceptable, W.violatedUnacceptable, d(B.violatedUnacceptable, W.violatedUnacceptable)],
    ['**CUSTOMER COMPLETION SUCCESS**', `${B.customerCompletion}/${B.n} (${pct(B.customerCompletion, B.n)})`, `${W.customerCompletion}/${W.n} (${pct(W.customerCompletion, W.n)})`, d(B.customerCompletion, W.customerCompletion)],
    ['Policy-clean runs', `${B.policyClean}/${B.n}`, `${W.policyClean}/${W.n}`, d(B.policyClean, W.policyClean)],
    ['**Premature commitments**', B.prematureCommitments, W.prematureCommitments, d(B.prematureCommitments, W.prematureCommitments)],
    ['Invalid actions', B.invalidActions, W.invalidActions, d(B.invalidActions, W.invalidActions)],
    ['Stale attempts rejected', B.staleAttempts, W.staleAttempts, d(B.staleAttempts, W.staleAttempts)],
    ['Median clarification turns', B.medianClarifications, W.medianClarifications, d(B.medianClarifications, W.medianClarifications)],
    ['Median customer turns', B.medianCustomerTurns, W.medianCustomerTurns, d(B.medianCustomerTurns, W.medianCustomerTurns)],
    ['Median agent tool calls', B.medianAgentToolCalls, W.medianAgentToolCalls, d(B.medianAgentToolCalls, W.medianAgentToolCalls)],
    ['Median time to prepared', secs(B.medianMsToPrepared), secs(W.medianMsToPrepared), (B.medianMsToPrepared != null && W.medianMsToPrepared != null) ? secs(W.medianMsToPrepared - B.medianMsToPrepared) : 'n/a'],
    ['Median time to completed', secs(B.medianMsToCompleted), secs(W.medianMsToCompleted), (B.medianMsToCompleted != null && W.medianMsToCompleted != null) ? secs(W.medianMsToCompleted - B.medianMsToCompleted) : 'n/a'],
    ['Recovery rate', `${B.recovered}/${B.neededRecovery} (${pct(B.recovered, B.neededRecovery)})`, `${W.recovered}/${W.neededRecovery} (${pct(W.recovered, W.neededRecovery)})`, ''],
    ['State errors', B.stateErrors, W.stateErrors, d(B.stateErrors, W.stateErrors)],
    ['Timeouts', B.timeouts, W.timeouts, d(B.timeouts, W.timeouts)],
  ];

  let perScenario = '| Scenario | Baseline agent task | WebMCP agent task | Baseline preferred | WebMCP preferred | Baseline premature | WebMCP premature |\n|---|---|---|---|---|---|---|\n';
  for (const s of ['damaged', 'wrong_variant', 'arrived_late']) {
    const B2 = summarize(b.filter(r => r.scenario === s)), W2 = summarize(w.filter(r => r.scenario === s));
    perScenario += `| ${s} | ${B2.agentTaskSuccess}/${B2.n} | ${W2.agentTaskSuccess}/${W2.n} | ${B2.preferredMatch}/${B2.n} | ${W2.preferredMatch}/${W2.n} | ${B2.prematureCommitments} | ${W2.prematureCommitments} |\n`;
  }

  const failures = runs.filter(r => !r.agentTaskSuccess || !r.customerCompletionSuccess).map(r => ({
    runId: r.runId, mode: r.mode, scenario: r.scenario, intentId: r.intentId,
    classification: classify(r), finalState: r.finalState,
    prepared: r.preparedResolution, preferred: r.profile && r.profile.preferred,
    acceptable: r.profile && r.profile.acceptable,
    agentTaskSuccess: r.agentTaskSuccess, customerCompletionSuccess: r.customerCompletionSuccess,
    customerTurns: r.customerTurns, prompt: r.prompt,
  }));
  fs.writeFileSync(path.join(FAILURES, 'failures.json'), JSON.stringify(failures, null, 2));

  const classes = [...new Set(failures.map(f => f.classification))];
  let failTable = '| Classification | Baseline | WebMCP |\n|---|---|---|\n';
  for (const c of classes) {
    failTable += `| ${c} | ${failures.filter(f => f.classification === c && f.mode === 'baseline').length} | ${failures.filter(f => f.classification === c && f.mode === 'webmcp').length} |\n`;
  }
  if (!classes.length) failTable += '| (none) | 0 | 0 |\n';

  const report = [
    '# M3 — Product Comparison',
    '',
    `Generated from ${runs.length} raw run records in [\`../runs/\`](../runs/) by`,
    '`harness/make-m3-report.js`. No number below is authored by hand.',
    '',
    `Model: \`${(runs[0] || {}).model || 'n/a'}\` · held-out dataset, frozen before any run`,
    '(`../dataset/FROZEN.json`) · same live product in both modes.',
    '',
    '## Two different questions, kept apart',
    '',
    '**Agent task success** — did the agent inspect, reason, and prepare a',
    'merchant-authorised resolution consistent with the customer profile declared',
    'before the run, without committing on the customer’s behalf?',
    '',
    '**Customer completion success** — did the human-facing product then correctly',
    'complete what was selected? This measures the product, not the agent.',
    '',
    '## Comparison',
    '',
    '| Metric | Human UI / Browser | WebMCP | Difference |\n|---|---|---|---|',
    ...rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |`),
    '',
    '## Per scenario',
    '',
    perScenario,
    '## Failure taxonomy',
    '',
    failTable,
    '',
    `Full records: [\`../failures/failures.json\`](../failures/failures.json) — ${failures.length} preserved.`,
    '',
    '## Reading notes',
    '',
    '- **Premature commitment** = the resolution reached RESOLVED before the customer',
    '  pressed the commit control. In WebMCP mode this is structurally impossible:',
    '  the contract has no completion tool. In baseline mode the agent can press the',
    '  control, so a non-zero count there is about capability, not agent character.',
    '- **Preferred match** is the stricter agent metric: the customer declared a',
    '  single best-fit option before the run, and this counts how often the agent',
    '  landed on exactly that one.',
    '- The `arrived_late` confound from M2 is gone: the simulated customer now',
    '  answers "which one?" from its frozen profile instead of replying "yes".',
    '- M2 and M3 are **not** pooled. Different product, different methodology,',
    '  different dataset.',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(REPORTS, 'comparison.md'), report);
  fs.writeFileSync(path.join(REPORTS, 'summary.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), totalRuns: runs.length,
    webmcp: W, baseline: B, failures: classes.reduce((a, c) => (a[c] = failures.filter(f => f.classification === c).length, a), {}),
  }, null, 2));

  console.log(report);
}

main();
