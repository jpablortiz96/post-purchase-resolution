import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ResolutionSession, STATES, InvariantViolation } from '../src/state.js';
import { SCENARIO_KEYS } from '../src/fixtures.js';

const newSession = (k = 'damaged') => new ResolutionSession(k);

// ── per-state invariants ─────────────────────────────────────────────

test('ORDER_ACTIVE invariants', () => {
  const s = newSession();
  assert.equal(s.state, STATES.ORDER_ACTIVE);
  assert.equal(s.humanApproved, false);
  assert.equal(s.preparedResolution, null);
  assert.equal(s.resolutionResult, null);
});

test('RESOLUTION_PREPARED invariants', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  assert.notEqual(s.preparedResolution, null);
  assert.equal(s.humanApproved, false);
  assert.equal(s.resolutionResult, null);
});

test('HUMAN_APPROVED invariants', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  s.approve();
  assert.notEqual(s.preparedResolution, null);
  assert.equal(s.humanApproved, true);
  assert.notEqual(s.approvedAt, null);
  assert.equal(s.resolutionResult, null);
});

test('RESOLVED invariants', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  s.approve();
  s.confirm({ resolutionId: 'replacement' });
  assert.notEqual(s.resolutionResult, null);
  assert.equal(s.humanApproved, true);
  assert.notEqual(s.preparedResolution, null);
});

test('RESOLUTION_CANCELLED invariants', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  s.cancel();
  assert.equal(s.preparedResolution, null);
  assert.equal(s.humanApproved, false);
  assert.equal(s.resolutionResult, null);
  assert.notEqual(s.cancelledAt, null);
});

test('invariants are checked, not decorative — a corrupted session throws', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  s.approve();
  // forcibly contradict the state
  s.humanApproved = false;
  assert.throws(() => s.assertInvariants(), InvariantViolation);
});

test('a state with a null prepared resolution but approved flag throws', () => {
  const s = newSession();
  s.state = STATES.HUMAN_APPROVED;
  s.humanApproved = true;
  s.approvedAt = 'now';
  s.preparedResolution = null;
  assert.throws(() => s.assertInvariants(), InvariantViolation);
});

// ═════════════════════════════════════════════════════════════════════
// M0.6 REGRESSION
//
// The shipped bug: in the post-approval state the payload read by the agent
// said status "awaiting_human_approval" and requiresHumanApproval: true, when
// the human had already approved. A real agent believed it and refused to
// finish. These tests exist so that can never ship again.
// ═════════════════════════════════════════════════════════════════════

test('M0.6 regression — after approval the payload must not ask for approval', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  s.approve();

  const payload = s.buildOrderPayload();
  assert.equal(payload.resolution.humanApproved, true);
  assert.equal(payload.resolution.requiresHumanApproval, false,
    'THE M0.6 BUG: payload demanded approval that had already been given');
  assert.equal(payload.resolution.status, 'approved_by_customer');
  assert.doesNotMatch(payload.resolution.status, /awaiting/i);
  assert.doesNotMatch(payload.resolution.nextStep, /waiting for the customer/i);
});

test('M0.6 regression — before approval the payload must ask for approval', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });

  const payload = s.buildOrderPayload();
  assert.equal(payload.resolution.humanApproved, false);
  assert.equal(payload.resolution.requiresHumanApproval, true);
  assert.equal(payload.resolution.status, 'prepared');
  assert.match(payload.resolution.nextStep, /waiting for the customer/i);
});

test('M0.6 regression — humanApproved and requiresHumanApproval are always opposites', () => {
  for (const key of SCENARIO_KEYS) {
    const s = newSession(key);
    const firstId = s.buildOptionsPayload().options[0].id;

    const check = (label) => {
      const r = s.buildOrderPayload().resolution;
      if (!r) return;
      assert.equal(r.humanApproved, s.humanApproved, `${key}/${label} humanApproved drifted`);
      assert.notEqual(r.requiresHumanApproval, r.humanApproved,
        `${key}/${label} payload contradicts itself`);
    };

    check('active');
    s.prepare({ resolutionId: firstId, reason: 'x' }); check('prepared');
    s.approve(); check('approved');
    s.confirm({ resolutionId: firstId }); check('resolved');
  }
});

test('M0.6 regression — the payload never contradicts the session across every path', () => {
  // exhaustive walk over the interesting transition sequences
  const paths = [
    ['prepare', 'approve', 'confirm'],
    ['prepare', 'cancel', 'prepare', 'approve', 'confirm'],
    ['prepare', 'choose', 'approve', 'confirm'],
    ['prepare', 'confirm', 'approve', 'confirm'],
    ['prepare', 'choose', 'cancel', 'prepare', 'approve', 'confirm'],
  ];

  for (const key of SCENARIO_KEYS) {
    for (const path of paths) {
      const s = newSession(key);
      const opts = s.buildOptionsPayload().options.map(o => o.id);
      for (const step of path) {
        if (step === 'prepare') s.prepare({ resolutionId: opts[0], reason: 'x' });
        if (step === 'choose') s.chooseAnother(opts[1]);
        if (step === 'approve') s.approve();
        if (step === 'cancel') s.cancel();
        if (step === 'confirm') {
          const staged = s.preparedResolution ? s.preparedResolution.option.id : opts[0];
          s.confirm({ resolutionId: staged });
        }
        // assertInvariants already ran inside each transition; run it again
        // to catch anything a rejected call might have left behind.
        s.assertInvariants();
      }
    }
  }
});

test('M0.6 regression — a rejected transition leaves the session consistent', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });

  s.confirm({ resolutionId: 'replacement' });   // rejected, not approved
  s.approve();
  s.confirm({ resolutionId: 'refund' });        // rejected, stale id
  s.prepare({ resolutionId: 'refund' });        // rejected, wrong state
  s.assertInvariants();

  assert.equal(s.state, STATES.HUMAN_APPROVED);
  assert.equal(s.preparedResolution.option.id, 'replacement');
  assert.equal(s.resolutionResult, null);
});
