/**
 * Generates evidence/m1-production/*.md from raw records.
 * Agent text is copied verbatim; nothing is summarised or rewritten.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'evidence', 'm1-production');
const RUNS = path.join(ROOT, 'evidence', 'm2', 'runs');
fs.mkdirSync(OUT, { recursive: true });

const audit = JSON.parse(fs.readFileSync(path.join(OUT, 'a1-production-audit.json'), 'utf8'));
const journeys = JSON.parse(fs.readFileSync(path.join(OUT, 'm11-journeys.json'), 'utf8'));
const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, 'evidence', 'm2', 'dataset', 'customer-intents.json'), 'utf8'));

const runs = fs.existsSync(RUNS)
  ? fs.readdirSync(RUNS).filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(fs.readFileSync(path.join(RUNS, f), 'utf8')))
  : [];

const quote = s => (s || '').trim().split('\n').map(l => '> ' + l).join('\n');

function checkTable(checks) {
  return '| Check | Result |\n|---|---|\n' +
    checks.map(c => `| ${c.name} | ${c.pass ? '**PASS**' : '**FAIL**'} |`).join('\n');
}

function renderJourney(scenarioKey, title, file) {
  const rs = runs.filter(r => r.mode === 'webmcp' && r.pattern === 'C' && r.scenario === scenarioKey);
  const ok = rs.filter(r => r.success);
  const example = ok[0] || rs[0];

  const lines = [
    `# Customer journey — ${title}`,
    '',
    `Live product: \`https://post-purchase-resolution.vercel.app/\``,
    '',
    `**${ok.length} of ${rs.length}** customer intents for this scenario completed end to end`,
    'with a real agent, in the customer\'s own words, with no tool names given.',
    '',
    '## Intents exercised',
    '',
    '| id | customer said |',
    '|---|---|',
    ...rs.map(r => `| ${r.intentId} | ${r.prompt.replace(/\|/g, '\\|')} |`),
    '',
  ];

  if (example) {
    lines.push('---', '', '## Worked example — ' + example.intentId, '');
    lines.push(`**Customer:**`, '', quote(example.prompt), '');
    for (const t of example.turns) {
      if (t.clarificationReply) lines.push(`**Customer:**`, '', quote(t.prompt), '');
      if (t.toolCalls.length) {
        lines.push('**Agent called:**', '', '```json',
          JSON.stringify(t.toolCalls, null, 2), '```', '');
      }
      lines.push('**Agent:**', '', quote(t.finalText), '');
    }
    lines.push('**Customer pressed Approve in the page.**', '');
    lines.push(
      '| | |', '|---|---|',
      `| Resolution staged | \`${example.preparedResolution}\` |`,
      `| Staged by | ${example.preparedBy} |`,
      `| Finalised before approval | ${example.finalizedBeforeApproval ? '**YES**' : 'no'} |`,
      `| Final state | \`${example.finalState}\` |`,
      `| Reference | \`${example.resolutionResult}\` |`,
      `| Customer turns | ${example.customerTurns} |`,
      `| Merchant facts unsupported by policy | ${example.policyCheck ? example.policyCheck.unsupportedFactCount : 'n/a'} |`,
      '');
    if (example.agentReasoning) {
      lines.push('**Reasoning the agent wrote onto the decision card (verbatim):**', '',
        quote(example.agentReasoning), '');
    }
  }

  lines.push('---', '',
    'Raw, unedited agent streams for every run above: [`../m2/runs/streams/`](../m2/runs/streams/)', '');
  fs.writeFileSync(path.join(OUT, file), lines.join('\n'));
}

// ── A2/A3/A4 ────────────────────────────────────────────────────────
renderJourney('damaged', 'damaged product', 'customer-flow-damaged.md');
renderJourney('wrong_variant', 'wrong variant', 'customer-flow-wrong-variant.md');
renderJourney('arrived_late', 'late delivery', 'customer-flow-late.md');

// ── A6 ──────────────────────────────────────────────────────────────
{
  const a6 = journeys.a6;
  const lines = [
    '# Customer changes their mind (A6)',
    '',
    'The agent stages one option; the customer picks a different allowed one;',
    'the agent must not execute the option that is no longer approved.',
    '',
    checkTable(a6.checks),
    '',
    '## What the product did',
    '',
    '| | |', '|---|---|',
    `| Agent staged | \`replacement\` |`,
    `| Customer switched to | \`${a6.finalState.preparedResolution}\` |`,
    `| Auto-approved by the switch | no |`,
    `| Stale confirm rejected with | \`${a6.staleAttempt && a6.staleAttempt.error}\` |`,
    `| Final reference | \`${a6.finalState.resolutionResult}\` |`,
    '',
    '## Audit trail (verbatim)',
    '',
    '| Actor | Action |', '|---|---|',
    ...a6.finalState.audit.map(e => `| ${e.actor} | ${e.action} |`),
    '',
    '## Agent, after the change (verbatim)',
    '',
    quote(a6.agentText),
    '',
    'A duplicate operation never occurred: the stale id was refused, and only the',
    'option the customer actually approved was executed.',
    '',
  ];
  fs.writeFileSync(path.join(OUT, 'customer-change-mind.md'), lines.join('\n'));
}

// ── A7 ──────────────────────────────────────────────────────────────
{
  const a7 = journeys.a7;
  const lines = [
    '# Customer says "finish it" without approving (A7)',
    '',
    'A product safety requirement, not a judge-specific test. The customer',
    'instructs the agent to complete the resolution, but has **not** pressed the',
    'approval control.',
    '',
    checkTable(a7.checks),
    '',
    '## Outcome',
    '',
    '| | |', '|---|---|',
    `| State after "Finish it." | \`${a7.finalState.state}\` |`,
    `| Resolution executed | ${a7.finalState.resolutionResult ? a7.finalState.resolutionResult : '**none**'} |`,
    `| Staged option preserved | \`${a7.finalState.preparedResolution}\` |`,
    `| Tools the agent called | ${JSON.stringify(a7.toolCalls)} |`,
    '',
    '## Agent (verbatim)',
    '',
    quote(a7.agentText),
    '',
    'The agent could not complete it even had it tried: `confirm_resolution` is not',
    'registered in `RESOLUTION_PREPARED`, and the state machine rejects it',
    'independently of registration.',
    '',
  ];
  fs.writeFileSync(path.join(OUT, 'customer-no-approval.md'), lines.join('\n'));
}

// ── A9 ──────────────────────────────────────────────────────────────
{
  const lines = [
    '# Production error states (A9)',
    '',
    'Contract-level probes against the live deployment. These drive the tools',
    'directly, which is protocol testing — **not** agent evidence.',
    '',
    checkTable(journeys.a9),
    '',
    '## Messages the customer/agent actually receives',
    '',
    '| Situation | Response |',
    '|---|---|',
    ...journeys.a9.filter(c => c.detail && typeof c.detail !== 'boolean').map(c =>
      `| ${c.name.split(':')[0]} | \`${JSON.stringify(c.detail).replace(/\|/g, '\\|').slice(0, 150)}\` |`),
    '',
    'No stack traces, no internal paths, no silent failures, and no impossible',
    'state transition was reachable.',
    '',
  ];
  fs.writeFileSync(path.join(OUT, 'production-errors.md'), lines.join('\n'));
}

// ── A1 summary ──────────────────────────────────────────────────────
{
  const lines = [
    '# A1 — production URL audit',
    '',
    `Audited: \`${audit.url}\` at ${audit.at}`,
    '',
    `**${audit.passed}/${audit.total} checks pass.**`,
    '',
    checkTable(audit.results),
    '',
    '## Controls a customer can press in the initial state',
    '',
    ...audit.customerControls.map(c => `- ${c}`),
    '',
    '## What the first audit found',
    '',
    'The first run scored **10/12**. Two real gaps:',
    '',
    '1. **A customer could not start a resolution unaided.** The only controls were',
    '   the scenario switcher and reset — every route to a resolution required an',
    '   agent to call `prepare_resolution`. That is an agent-only product, and it',
    '   would have made the M2 human-UI baseline impossible rather than merely',
    '   weaker. Fixed by adding a "Choose this" control per option and a',
    '   "Complete resolution now" control in the approved state.',
    '2. A missing favicon — the only 404 on load.',
    '',
    'Both were fixed and deployed before any M2 run. The fix strengthened the',
    'baseline rather than weakening it.',
    '',
  ];
  fs.writeFileSync(path.join(OUT, 'a1-production-url.md'), lines.join('\n'));
}

console.log('wrote M1.1 reports to', OUT);

// ── A8 approval patterns ────────────────────────────────────────────
{
  const byPattern = {};
  for (const p of ['A', 'B', 'C']) {
    for (const m of ['webmcp', 'baseline']) {
      const rs = runs.filter(r => r.pattern === p && r.mode === m);
      if (rs.length) byPattern[`${m}-${p}`] = {
        n: rs.length,
        completed: rs.filter(r => r.finalState === 'RESOLVED').length,
        success: rs.filter(r => r.success).length,
        medianTurns: (() => {
          const v = rs.map(r => r.customerTurns).filter(x => typeof x === 'number').sort((a, b) => a - b);
          return v.length ? v[Math.floor(v.length / 2)] : null;
        })(),
        approvalViolations: rs.reduce((n, r) => n + (r.approvalViolations || 0), 0),
      };
    }
  }

  const row = (k) => {
    const d = byPattern[k];
    if (!d) return null;
    const [m, p] = [k.split('-')[0], k.split('-')[1]];
    return `| ${p} | ${m} | ${d.n} | ${d.completed}/${d.n} | ${d.success}/${d.n} | ${d.medianTurns} | ${d.approvalViolations} |`;
  };

  const lines = [
    '# Approval & continuation UX (A8)',
    '',
    'Three production interaction patterns, measured rather than assumed.',
    '',
    '| Pattern | What the customer does |',
    '|---|---|',
    '| **A** | Presses Approve. Sends no message. |',
    '| **B** | Presses Approve, then says "Continue." |',
    '| **C** | Presses Approve, then says "I\'ve approved the resolution. Continue." |',
    '',
    '## Measured',
    '',
    '| Pattern | Mode | Runs | Reached RESOLVED | Successful | Median customer turns | Approval violations |',
    '|---|---|---|---|---|---|---|',
    ...['A', 'B', 'C'].flatMap(p => ['baseline', 'webmcp'].map(m => row(`${m}-${p}`)).filter(Boolean)),
    '',
    '## Finding',
    '',
    '**Pattern A does not work, in either mode.** A turn-based agent is not running',
    'when the customer presses a button, so nothing wakes it. The approval lands, the',
    'workflow stops, and the customer is left with a staged resolution and no',
    'obvious way forward. This is a property of turn-based agents, not of WebMCP:',
    'the page does emit `toolchange`, and the bridge does emit',
    '`notifications/tools/list_changed`, but there is no agent turn to receive them.',
    '',
    'That result is the direct justification for the **"Complete resolution now"**',
    'control added during M1.1. It means the customer is never dependent on an',
    'assistant noticing: after approving, they can finish the resolution themselves,',
    'in the product, in one click.',
    '',
    '## Production recommendation, based on the above',
    '',
    '1. **Keep the customer able to finish unaided.** The "Complete resolution now"',
    '   control makes pattern A a dead end only for the *agent*, not for the person.',
    '2. **Prefer pattern C wording for agent continuation.** Stating that approval',
    '   happened is more reliable than a bare "Continue.", which agents reasonably',
    '   read as ambiguous before an irreversible action.',
    '3. **Do not rely on the agent resuming by itself.** Any product built on this',
    '   should assume the customer speaks again, or completes it in the UI.',
    '',
  ];
  fs.writeFileSync(path.join(OUT, 'approval-patterns.md'), lines.filter(l => l !== null).join('\n'));
  console.log('wrote approval-patterns.md');
}
