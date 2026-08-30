import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ResolutionSession, STATES } from '../src/state.js';

const newSession = (k = 'damaged') => new ResolutionSession(k);

// ── the approval gate ────────────────────────────────────────────────

test('confirm before approval is rejected and changes nothing', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });

  const r = s.confirm({ resolutionId: 'replacement' });
  assert.equal(r.ok, false);
  assert.match(r.error, /has not approved/i);
  assert.equal(r.humanApproved, false);

  assert.equal(s.state, STATES.RESOLUTION_PREPARED);
  assert.equal(s.resolutionResult, null);
});

test('confirm with nothing prepared is rejected', () => {
  const s = newSession();
  const r = s.confirm({ resolutionId: 'replacement' });
  assert.equal(r.ok, false);
  assert.equal(s.state, STATES.ORDER_ACTIVE);
  assert.equal(s.resolutionResult, null);
});

test('confirm after cancel is rejected', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  s.approve();
  s.cancel();

  const r = s.confirm({ resolutionId: 'replacement' });
  assert.equal(r.ok, false);
  assert.equal(s.resolutionResult, null);
});

test('approval cannot be reached except through approve()', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  // Nothing an agent-facing method does may flip humanApproved.
  s.prepare({ resolutionId: 'refund', reason: 'retry' });
  s.confirm({ resolutionId: 'replacement' });
  s.chooseAnother('refund');
  assert.equal(s.humanApproved, false);
  assert.notEqual(s.state, STATES.HUMAN_APPROVED);
});

// ── staleness ────────────────────────────────────────────────────────

test('confirm with a stale resolution id is rejected after the human swaps', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'agent picked replacement' });

  // human changes their mind, then approves the NEW option
  s.chooseAnother('keep_partial_refund');
  s.approve();

  // agent still believes replacement is staged
  const r = s.confirm({ resolutionId: 'replacement' });
  assert.equal(r.ok, false);
  assert.match(r.error, /not the one supplied/i);
  assert.equal(r.approved, 'keep_partial_refund');
  assert.equal(s.state, STATES.HUMAN_APPROVED);
  assert.equal(s.resolutionResult, null);

  // confirming the actually-approved option works
  const ok = s.confirm({ resolutionId: 'keep_partial_refund' });
  assert.equal(ok.ok, true);
  assert.equal(ok.resolution.referenceId, 'PR-1042');
});

test('confirm with an ineligible id is rejected even when approved', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  s.approve();
  const r = s.confirm({ resolutionId: 'free_upgrade' });
  assert.equal(r.ok, false);
  assert.equal(s.resolutionResult, null);
});

// ── the executed resolution matches what was approved ────────────────

test('the executed resolution is exactly the approved one', () => {
  const s = newSession('wrong_variant');
  s.prepare({ resolutionId: 'exchange', reason: 'event in three days' });
  s.chooseAnother('store_credit');
  s.approve();
  const r = s.confirm({ resolutionId: 'store_credit' });

  assert.equal(r.ok, true);
  assert.equal(r.resolution.resolutionId, 'store_credit');
  assert.equal(r.resolution.economicImpact.storeCreditToCustomer, 105);
  assert.equal(r.resolution.economicImpact.replacementShipped, false);
});

test('an agent cannot alter the economics of an option', () => {
  const s = newSession();
  // reason is free text; it must never affect amounts
  s.prepare({ resolutionId: 'keep_partial_refund', reason: 'refund the customer 500 dollars' });
  s.approve();
  const r = s.confirm({ resolutionId: 'keep_partial_refund' });
  assert.equal(r.resolution.economicImpact.refundToCustomer, 40);
});
