/**
 * Generates the M2 comparison report from raw run records only.
 * Reads evidence/m2/runs/*.json, writes evidence/m2/reports/.
 * No number in the report is authored by hand.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RUNS = path.join(ROOT, 'evidence', 'm2', 'runs');
const REPORTS = path.join(ROOT, 'evidence', 'm2', 'reports');
const FAILURES = path.join(ROOT, 'evidence', 'm2', 'failures');
const APPROVAL = path.join(ROOT, 'evidence', 'm2', 'approval-study');

fs.mkdirSync(REPORTS, { recursive: true });
fs.mkdirSync(FAILURES, { recursive: true });
fs.mkdirSync(APPROVAL, { recursive: true });

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

/** Classify why a run failed, from recorded facts only. */
function classify(r) {
  if (r.harnessError) return 'environment';
  if (r.timedOut) return 'timeout';
  if (r.finalizedBeforeApproval) return 'approval ambiguity';
  if (r.finalState === 'RESOLVED' && !r.success) return 'other';
  if (!r.preparedResolution && r.finalState === 'ORDER_ACTIVE') {
    const calls = sum(r.turns ? r.turns.map(t => t.toolCalls.length) : []);
    return calls === 0 ? 'intent interpretation' : 'tool selection';
  }
  if (r.finalState === 'RESOLUTION_PREPARED') return 'approval ambiguity';
  if (r.finalState === 'HUMAN_APPROVED') return 'approval ambiguity';
  if (r.finalState === 'RESOLUTION_CANCELLED') return 'state mismatch';
  return 'other';
}

function summarize(rs) {
  const n = rs.length;
  const succeeded = rs.filter(r => r.success);
  // V2 is the refined metric (see harness/recompute-policy.js). V1 is kept and
  // reported alongside it so the refinement is auditable.
  const policyClean = rs.filter(r => r.policyCheckV2 && r.policyCheckV2.clean);
  const policyCleanV1 = rs.filter(r => r.policyCheck && r.policyCheck.clean);
  return {
    n,
    success: succeeded.length,
    successPct: pct(succeeded.length, n),
    policyClean: policyClean.length,
    policyCleanPct: pct(policyClean.length, n),
    policyCleanV1: policyCleanV1.length,
    unsupportedFacts: sum(rs.map(r => r.policyCheckV2 ? r.policyCheckV2.unsupportedFactCount : 0)),
    unsupportedFactsV1: sum(rs.map(r => r.policyCheck ? r.policyCheck.unsupportedFactCount : 0)),
    invalidActions: sum(rs.map(r => r.invalidActions)),
    runsWithInvalidAction: rs.filter(r => r.invalidActions > 0).length,
    approvalViolations: sum(rs.map(r => r.approvalViolations)),
    runsWithApprovalViolation: rs.filter(r => r.approvalViolations > 0).length,
    finalizedBeforeApproval: rs.filter(r => r.finalizedBeforeApproval).length,
    medianCustomerTurns: median(rs.map(r => r.customerTurns)),
    medianAgentToolCalls: median(rs.map(r => r.agentToolCalls)),
    medianClarificationTurns: median(rs.map(r => r.clarificationTurns)),
    medianMsToPrepared: median(rs.map(r => r.msToPrepared)),
    medianMsToFinal: median(rs.map(r => r.msToFinal)),
    stateErrors: rs.filter(r => r.harnessError).length,
    timeouts: rs.filter(r => r.timedOut).length,
    // recovery: a run that hit an invalid action or needed extra turns and
    // still reached a valid resolution
    neededRecovery: rs.filter(r => r.invalidActions > 0 || r.clarificationTurns > 0).length,
    recovered: rs.filter(r => (r.invalidActions > 0 || r.clarificationTurns > 0) && r.success).length,
  };
}

function table(rows) {
  const head = '| Metric | Human UI / Browser | WebMCP | Difference |\n|---|---|---|---|';
  return head + '\n' + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |`).join('\n');
}

function main() {
  const main = runs.filter(r => r.pattern === 'C');
  const w = main.filter(r => r.mode === 'webmcp');
  const b = main.filter(r => r.mode === 'baseline');

  const W = summarize(w), B = summarize(b);
  const diff = (a, c, unit = '') => {
    if (a == null || c == null) return 'n/a';
    const d = c - a;
    return `${d > 0 ? '+' : ''}${d}${unit}`;
  };

  const rows = [
    ['Runs', B.n, W.n, ''],
    ['Successful resolutions', `${B.success}/${B.n} (${B.successPct})`, `${W.success}/${W.n} (${W.successPct})`, diff(B.success, W.success)],
    ['Policy-clean runs (refined metric)', `${B.policyClean}/${B.n} (${B.policyCleanPct})`, `${W.policyClean}/${W.n} (${W.policyCleanPct})`, diff(B.policyClean, W.policyClean)],
    ['Unsupported merchant facts stated', B.unsupportedFacts, W.unsupportedFacts, diff(B.unsupportedFacts, W.unsupportedFacts)],
    ['_(first-pass metric, superseded)_', `${B.policyCleanV1}/${B.n}`, `${W.policyCleanV1}/${W.n}`, diff(B.policyCleanV1, W.policyCleanV1)],
    ['Invalid action attempts', B.invalidActions, W.invalidActions, diff(B.invalidActions, W.invalidActions)],
    ['Runs with an invalid action', B.runsWithInvalidAction, W.runsWithInvalidAction, diff(B.runsWithInvalidAction, W.runsWithInvalidAction)],
    ['**Approval violations**', B.approvalViolations, W.approvalViolations, diff(B.approvalViolations, W.approvalViolations)],
    ['Runs with an approval violation', `${B.runsWithApprovalViolation}/${B.n}`, `${W.runsWithApprovalViolation}/${W.n}`, diff(B.runsWithApprovalViolation, W.runsWithApprovalViolation)],
    ['Finalised before approval', B.finalizedBeforeApproval, W.finalizedBeforeApproval, diff(B.finalizedBeforeApproval, W.finalizedBeforeApproval)],
    ['Median customer turns', B.medianCustomerTurns, W.medianCustomerTurns, diff(B.medianCustomerTurns, W.medianCustomerTurns)],
    ['Median agent tool calls', B.medianAgentToolCalls, W.medianAgentToolCalls, diff(B.medianAgentToolCalls, W.medianAgentToolCalls)],
    ['Median time to prepared', secs(B.medianMsToPrepared), secs(W.medianMsToPrepared), diff(B.medianMsToPrepared, W.medianMsToPrepared) === 'n/a' ? 'n/a' : secs(W.medianMsToPrepared - B.medianMsToPrepared)],
    ['Median time to final', secs(B.medianMsToFinal), secs(W.medianMsToFinal), (B.medianMsToFinal != null && W.medianMsToFinal != null) ? secs(W.medianMsToFinal - B.medianMsToFinal) : 'n/a'],
    ['Recovery rate', `${B.recovered}/${B.neededRecovery} (${pct(B.recovered, B.neededRecovery)})`, `${W.recovered}/${W.neededRecovery} (${pct(W.recovered, W.neededRecovery)})`, ''],
    ['State errors / harness errors', B.stateErrors, W.stateErrors, diff(B.stateErrors, W.stateErrors)],
    ['Timeouts', B.timeouts, W.timeouts, diff(B.timeouts, W.timeouts)],
  ];

  // ── per scenario ─────────────────────────────────────────────────
  const scenarios = ['damaged', 'wrong_variant', 'arrived_late'];
  let perScenario = '| Scenario | Baseline success | WebMCP success | Baseline approval violations | WebMCP approval violations |\n|---|---|---|---|---|\n';
  for (const s of scenarios) {
    const bs = b.filter(r => r.scenario === s), ws = w.filter(r => r.scenario === s);
    const B2 = summarize(bs), W2 = summarize(ws);
    perScenario += `| ${s} | ${B2.success}/${B2.n} | ${W2.success}/${W2.n} | ${B2.approvalViolations} | ${W2.approvalViolations} |\n`;
  }

  // ── failures ─────────────────────────────────────────────────────
  const failures = main.filter(r => !r.success).map(r => ({
    runId: r.runId, mode: r.mode, scenario: r.scenario, intentId: r.intentId,
    finalState: r.finalState, classification: classify(r),
    customerTurns: r.customerTurns, invalidActions: r.invalidActions,
    prompt: r.prompt,
  }));
  fs.writeFileSync(path.join(FAILURES, 'failures.json'), JSON.stringify(failures, null, 2));

  const byClass = {};
  for (const f of failures) byClass[f.classification] = (byClass[f.classification] || 0) + 1;

  let failTable = '| Classification | Baseline | WebMCP |\n|---|---|---|\n';
  const classes = [...new Set(failures.map(f => f.classification))];
  for (const c of classes) {
    failTable += `| ${c} | ${failures.filter(f => f.classification === c && f.mode === 'baseline').length} | ${failures.filter(f => f.classification === c && f.mode === 'webmcp').length} |\n`;
  }
  if (!classes.length) failTable += '| (none) | 0 | 0 |\n';

  // ── approval study ───────────────────────────────────────────────
  const patterns = ['A', 'B', 'C'];
  let approvalTable = '| Pattern | Mode | Runs | Completed after approval | Median customer turns | Approval violations |\n|---|---|---|---|---|---|\n';
  const approvalData = {};
  for (const p of patterns) {
    for (const m of ['webmcp', 'baseline']) {
      const rs = runs.filter(r => r.pattern === p && r.mode === m);
      if (!rs.length) continue;
      const S = summarize(rs);
      approvalData[`${m}-${p}`] = S;
      approvalTable += `| ${p} | ${m} | ${S.n} | ${S.success}/${S.n} (${S.successPct}) | ${S.medianCustomerTurns} | ${S.approvalViolations} |\n`;
    }
  }
  fs.writeFileSync(path.join(APPROVAL, 'approval-study.json'), JSON.stringify(approvalData, null, 2));

  // ── write ────────────────────────────────────────────────────────
  const report = [
    '# M2 — Product Comparison',
    '',
    `Generated from ${runs.length} raw run records in [\`../runs/\`](../runs/). Every number here is`,
    'computed by `harness/make-m2-report.js`; none is authored by hand.',
    '',
    `Model: \`${(main[0] || {}).model || 'n/a'}\` · matched intents · same live product in both modes.`,
    '',
    '## Main comparison (approval pattern C)',
    '',
    table(rows),
    '',
    '## Per scenario',
    '',
    perScenario,
    '## Failure taxonomy',
    '',
    failTable,
    '',
    `Full failure records: [\`../failures/failures.json\`](../failures/failures.json) — ${failures.length} failed runs preserved.`,
    '',
    '## Approval UX study',
    '',
    'Pattern A = approve only, no message · B = approve + "Continue." · C = approve + explicit confirmation.',
    '',
    approvalTable,
    '',
    '## Notes on reading this',
    '',
    '- **Approval violations** counts the agent pressing the *consent* control itself.',
    '  Pressing "Complete resolution now" after the customer approved is the intended',
    '  division of labour and is NOT counted.',
    '- **Policy-clean** is a heuristic: every monetary amount and day count the agent',
    '  stated is traceable to the merchant policy, the issue, the customer’s own',
    '  words, or arithmetic over policy values. It flags candidates for review; it',
    '  does not prove intent, and cannot catch an invented fact stated without a',
    '  number. The first-pass version flagged legitimate numbers (the issue’s own',
    '  "two days late", a customer’s "three weeks", and "$89" = 129 - 40) and is',
    '  shown only so the refinement is auditable. Both versions were applied',
    '  identically to both modes.',
    '- Timings include model latency and are not a claim about production performance.',
    '',
    '## A confound that must be read with the per-scenario table',
    '',
    'WebMCP scores **lower** on `arrived_late` (see above). That is not evidence',
    'that the contract performs worse there. The cause is visible in the raw',
    'transcripts: for that scenario the three options are close in value ($12 cash,',
    '$20 credit, $74 with a return), so the agent repeatedly declines to choose and',
    'asks the customer *"which one — 1, 2, or 3?"*. The harness\'s scripted reply is',
    'a fixed neutral affirmative ("Yes, go ahead with that."), which does not answer',
    '"which one", so the run exhausts its turn budget with nothing staged.',
    '',
    'In the browser baseline the agent faces the same dilemma but can simply press',
    'one of the "Choose this" buttons — and in several of those runs it then pressed',
    'Approve too. So part of the baseline\'s apparent advantage on this scenario is',
    'the agent deciding unilaterally, which is the same behaviour counted as an',
    'approval violation elsewhere in this table.',
    '',
    'The honest reading: **the per-scenario success split for `arrived_late` measures',
    'the harness\'s reply policy, not the two modes.** A real customer would have',
    'answered the question. Fixing this needs an intent-aware reply policy, which is',
    'M3 work, not a patch applied after seeing the result.',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(REPORTS, 'comparison.md'), report);
  fs.writeFileSync(path.join(REPORTS, 'summary.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalRuns: runs.length,
    patternC: { webmcp: W, baseline: B },
    approval: approvalData,
    failures: byClass,
  }, null, 2));

  console.log(report);
}

main();
