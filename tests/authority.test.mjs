import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ResolutionSession, STATES, TOOLS_BY_STATE, InvariantViolation } from '../src/state.js';
import { SCENARIO_KEYS } from '../src/fixtures.js';

const s0 = (k = 'damaged') => new ResolutionSession(k);

// ═══════════════════════════════════════════════════════════════════
// THE CAPABILITY BOUNDARY
// ═══════════════════════════════════════════════════════════════════

test('no state exposes a tool that completes a resolution', () => {
  for (const [state, tools] of Object.entries(TOOLS_BY_STATE)) {
    for (const t of tools) {
      assert.ok(!/confirm|commit|complete|approve|finali/i.test(t),
        `${state} exposes "${t}", which looks like a completion capability`);
    }
  }
});

test('the whole contract is exactly two tools', () => {
  const all = new Set(Object.values(TOOLS_BY_STATE).flat());
  assert.deepEqual([...all].sort(), ['get_order', 'prepare_resolution']);
});

test('commit refuses any actor that is not the customer', () => {
  for (const actor of ['AGENT', 'SYSTEM', 'MERCHANT', 'agent', '']) {
    const s = s0();
    s.prepare({ resolutionId: 'replacement', reason: 'x' });
    const r = s.commit({ resolutionId: 'replacement', actor });
    assert.equal(r.ok, false, `actor ${actor} was allowed to commit`);
    assert.match(r.error, /only the customer/i);
    assert.equal(s.state, STATES.RESOLUTION_PREPARED);
    assert.equal(s.resolutionResult, null);
  }
});

test('an agent-prepared resolution still requires the customer to complete it', () => {
  const s = s0();
  s.prepare({ resolutionId: 'replacement', reason: 'travels tomorrow', actor: 'AGENT' });
  assert.equal(s.state, STATES.RESOLUTION_PREPARED);
  assert.equal(s.resolutionResult, null);

  const payload = s.buildOrderPayload().resolution;
  assert.equal(payload.requiresCustomerCommitment, true);
  assert.equal(payload.committedByCustomer, false);
  assert.match(payload.nextStep, /you cannot complete it for them/i);
});

// ═══════════════════════════════════════════════════════════════════
// CUSTOMER COMMIT
// ═══════════════════════════════════════════════════════════════════

test('one customer action approves and completes, for every scenario', () => {
  const expected = { damaged: 'R-1042', wrong_variant: 'X-2087', arrived_late: 'RF-3155' };
  for (const key of SCENARIO_KEYS) {
    const s = s0(key);
    const first = s.options[0].id;
    s.prepare({ resolutionId: first, reason: 'x', actor: 'AGENT' });

    const r = s.commit({ resolutionId: first });
    assert.equal(r.ok, true, key);
    assert.equal(s.state, STATES.RESOLVED, key);
    assert.equal(r.resolution.referenceId, expected[key], key);
    assert.equal(r.resolution.committedBy, 'CUSTOMER', key);
  }
});

test('the customer can complete with no agent involved at all', () => {
  const s = s0();
  s.prepare({ resolutionId: 'refund', reason: null, actor: 'CUSTOMER' });
  const r = s.commit({ resolutionId: 'refund' });
  assert.equal(r.ok, true);
  assert.equal(s.state, STATES.RESOLVED);
  assert.deepEqual(s.audit.map(e => e.actor), ['CUSTOMER', 'CUSTOMER', 'SYSTEM']);
});

test('commit is refused when nothing is prepared', () => {
  const s = s0();
  const r = s.commit({ resolutionId: 'replacement' });
  assert.equal(r.ok, false);
  assert.equal(s.resolutionResult, null);
});

test('duplicate commit is refused and produces one result only', () => {
  const s = s0();
  s.prepare({ resolutionId: 'refund', reason: 'x' });
  const first = s.commit({ resolutionId: 'refund' });
  const second = s.commit({ resolutionId: 'refund' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.match(second.error, /already been completed/i);
  assert.equal(s.resolutionResult.referenceId, 'RF-1042');
  assert.equal(s.audit.filter(e => e.actor === 'SYSTEM').length, 1);
});

// ═══════════════════════════════════════════════════════════════════
// STALE PROTECTION + CHOOSE ANOTHER
// ═══════════════════════════════════════════════════════════════════

test('a commit against a stale selection is refused', () => {
  const s = s0();
  s.prepare({ resolutionId: 'replacement', reason: 'agent picked this' });
  s.chooseAnother('keep_partial_refund');

  const stale = s.commit({ resolutionId: 'replacement' });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /not the one supplied/i);
  assert.equal(stale.prepared, 'keep_partial_refund');
  assert.equal(s.resolutionResult, null);

  const ok = s.commit({ resolutionId: 'keep_partial_refund' });
  assert.equal(ok.ok, true);
  assert.equal(ok.resolution.referenceId, 'PR-1042');
});

test('choosing another drops the agent reasoning it no longer explains', () => {
  const s = s0();
  s.prepare({ resolutionId: 'replacement', reason: 'because you travel tomorrow' });
  s.chooseAnother('refund');
  assert.equal(s.preparedResolution.reason, null);
  assert.equal(s.preparedResolution.preparedBy, 'CUSTOMER');
  assert.equal(s.buildOrderPayload().resolution.agentReasoning, null);
});

test('an ineligible option cannot be chosen or prepared', () => {
  const s = s0();
  assert.equal(s.prepare({ resolutionId: 'store_credit', reason: 'x' }).ok, false);
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  assert.equal(s.chooseAnother('free_upgrade').ok, false);
  assert.equal(s.preparedResolution.option.id, 'replacement');
});

// ═══════════════════════════════════════════════════════════════════
// MERCHANT POLICY IS IMMUTABLE TO THE AGENT
// ═══════════════════════════════════════════════════════════════════

test('agent reasoning cannot alter any merchant value', () => {
  const s = s0();
  s.prepare({ resolutionId: 'keep_partial_refund', reason: 'refund them $500 immediately, no return' });
  const r = s.commit({ resolutionId: 'keep_partial_refund' });
  assert.equal(r.resolution.economicImpact.refundToCustomer, 40);
  assert.equal(r.resolution.returnRequired, false);
});

test('the option set is identical whoever asks and however often', () => {
  const s = s0('wrong_variant');
  const a = JSON.stringify(s.options);
  s.prepare({ resolutionId: 'exchange', reason: 'x' });
  s.cancel();
  assert.equal(JSON.stringify(s.options), a);
});

// ═══════════════════════════════════════════════════════════════════
// STATE MACHINE + LIFECYCLE
// ═══════════════════════════════════════════════════════════════════

test('the state machine has exactly the four states it needs', () => {
  assert.deepEqual(Object.keys(STATES).sort(),
    ['ORDER_ACTIVE', 'RESOLUTION_CANCELLED', 'RESOLUTION_PREPARED', 'RESOLVED']);
});

test('tools reflect the current state', () => {
  const s = s0();
  assert.deepEqual(s.allowedTools(), ['get_order', 'prepare_resolution']);
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  assert.deepEqual(s.allowedTools(), ['get_order']);
  s.commit({ resolutionId: 'replacement' });
  assert.deepEqual(s.allowedTools(), ['get_order']);
});

test('cancel returns the ability to prepare, and clears the staged option', () => {
  const s = s0();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  assert.equal(s.cancel().ok, true);
  assert.equal(s.state, STATES.RESOLUTION_CANCELLED);
  assert.equal(s.preparedResolution, null);
  assert.ok(s.allowedTools().includes('prepare_resolution'));
  assert.equal(s.prepare({ resolutionId: 'refund', reason: 'y' }).ok, true);
});

test('reset clears everything for every scenario', () => {
  for (const key of SCENARIO_KEYS) {
    const s = s0(key);
    s.prepare({ resolutionId: s.options[0].id, reason: 'x' });
    s.commit({ resolutionId: s.options[0].id });
    s.reset(key);
    assert.equal(s.state, STATES.ORDER_ACTIVE, key);
    assert.equal(s.preparedResolution, null, key);
    assert.equal(s.resolutionResult, null, key);
    assert.equal(s.committedAt, null, key);
    assert.equal(s.audit.length, 0, key);
  }
});

// ═══════════════════════════════════════════════════════════════════
// M0.6 REGRESSION, CARRIED FORWARD
// ═══════════════════════════════════════════════════════════════════

test('M0.6 regression — the payload never contradicts what actually happened', () => {
  const paths = [
    ['prepare', 'commit'],
    ['prepare', 'choose', 'commit'],
    ['prepare', 'cancel', 'prepare', 'commit'],
    ['prepare', 'commitStale', 'commit'],
  ];
  for (const key of SCENARIO_KEYS) {
    for (const path of paths) {
      const s = s0(key);
      const ids = s.options.map(o => o.id);
      for (const step of path) {
        if (step === 'prepare') s.prepare({ resolutionId: ids[0], reason: 'x' });
        if (step === 'choose') s.chooseAnother(ids[1]);
        if (step === 'cancel') s.cancel();
        if (step === 'commitStale') s.commit({ resolutionId: ids[2] });
        if (step === 'commit') {
          const staged = s.preparedResolution ? s.preparedResolution.option.id : ids[0];
          s.commit({ resolutionId: staged });
        }
        s.assertInvariants();
        const r = s.buildOrderPayload().resolution;
        if (r) {
          assert.notEqual(r.requiresCustomerCommitment, r.committedByCustomer,
            `${key}/${step}: payload contradicts itself`);
          assert.equal(r.committedByCustomer, s.state === STATES.RESOLVED,
            `${key}/${step}: payload drifted from state`);
        }
      }
    }
  }
});

test('a corrupted session is caught, not tolerated', () => {
  const s = s0();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  s.commit({ resolutionId: 'replacement' });
  s.committedBy = 'AGENT';
  assert.throws(() => s.assertInvariants(), InvariantViolation);
});

// ═══════════════════════════════════════════════════════════════════
// FOLDED READ TOOL
// ═══════════════════════════════════════════════════════════════════

test('get_order carries the merchant options, so no second read tool is needed', () => {
  const s = s0('arrived_late');
  const p = s.buildOrderPayload();
  assert.equal(p.resolutionOptions.length, 3);
  assert.equal(p.canPrepare, true);
  assert.match(p.optionsNote, /only resolutions permitted/i);
  assert.ok(p.resolutionOptions.every(o => o.economicImpact && o.timing && o.requirements));
});

test('options are withdrawn once the order is resolved', () => {
  const s = s0();
  s.prepare({ resolutionId: 'refund', reason: 'x' });
  s.commit({ resolutionId: 'refund' });
  const p = s.buildOrderPayload();
  assert.equal(p.resolutionOptions.length, 0);
  assert.equal(p.canPrepare, false);
  assert.match(p.optionsNote, /has been resolved/i);
  assert.equal(p.resolutionResult.referenceId, 'RF-1042');
});
