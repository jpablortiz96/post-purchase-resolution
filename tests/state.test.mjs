import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ResolutionSession, STATES, TOOLS_BY_STATE, InvariantViolation } from '../src/state.js';
import { SCENARIO_KEYS } from '../src/fixtures.js';

const newSession = (k = 'damaged') => new ResolutionSession(k);

// ── happy path ───────────────────────────────────────────────────────

test('full happy path reaches RESOLVED with a reference id', () => {
  const s = newSession();
  assert.equal(s.state, STATES.ORDER_ACTIVE);

  assert.equal(s.prepare({ resolutionId: 'replacement', reason: 'travels tomorrow' }).ok, true);
  assert.equal(s.state, STATES.RESOLUTION_PREPARED);

  assert.equal(s.approve().ok, true);
  assert.equal(s.state, STATES.HUMAN_APPROVED);

  const r = s.confirm({ resolutionId: 'replacement' });
  assert.equal(r.ok, true);
  assert.equal(s.state, STATES.RESOLVED);
  assert.equal(r.resolution.referenceId, 'R-1042');
  assert.equal(s.resolutionResult.status, 'completed');
});

test('each scenario resolves end to end with its own reference id', () => {
  const cases = [
    ['damaged', 'replacement', 'R-1042'],
    ['wrong_variant', 'exchange', 'X-2087'],
    ['arrived_late', 'return_refund', 'RF-3155'],
  ];
  for (const [scenario, id, ref] of cases) {
    const s = newSession(scenario);
    s.prepare({ resolutionId: id, reason: 'test' });
    s.approve();
    const r = s.confirm({ resolutionId: id });
    assert.equal(r.ok, true, scenario);
    assert.equal(r.resolution.referenceId, ref, scenario);
    assert.equal(s.state, STATES.RESOLVED, scenario);
  }
});

// ── invalid transitions ──────────────────────────────────────────────

test('cannot prepare an option that is not eligible', () => {
  const s = newSession();
  const r = s.prepare({ resolutionId: 'free_upgrade', reason: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.error, /not an eligible resolution/i);
  assert.deepEqual(r.eligible, ['replacement', 'refund', 'keep_partial_refund']);
  assert.equal(s.state, STATES.ORDER_ACTIVE);
});

test('cannot prepare an option belonging to a different scenario', () => {
  const s = newSession('arrived_late');
  const r = s.prepare({ resolutionId: 'replacement', reason: 'x' });
  assert.equal(r.ok, false);
  assert.equal(s.state, STATES.ORDER_ACTIVE);
});

test('cannot prepare twice without cancelling', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'a' });
  const r = s.prepare({ resolutionId: 'refund', reason: 'b' });
  assert.equal(r.ok, false);
  assert.equal(s.preparedResolution.option.id, 'replacement');
});

test('cannot approve when nothing is prepared', () => {
  const s = newSession();
  assert.equal(s.approve().ok, false);
  assert.equal(s.state, STATES.ORDER_ACTIVE);
  assert.equal(s.humanApproved, false);
});

test('cannot confirm twice', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'refund', reason: 'x' });
  s.approve();
  assert.equal(s.confirm({ resolutionId: 'refund' }).ok, true);
  const again = s.confirm({ resolutionId: 'refund' });
  assert.equal(again.ok, false);
  assert.match(again.error, /already been completed/i);
});

// ── cancel + choose another ──────────────────────────────────────────

test('cancel clears the staged resolution and the approval', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  s.approve();
  assert.equal(s.humanApproved, true);

  assert.equal(s.cancel().ok, true);
  assert.equal(s.state, STATES.RESOLUTION_CANCELLED);
  assert.equal(s.preparedResolution, null);
  assert.equal(s.humanApproved, false);
});

test('after cancelling, a new resolution can be prepared', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  s.cancel();
  const r = s.prepare({ resolutionId: 'refund', reason: 'y' });
  assert.equal(r.ok, true);
  assert.equal(s.preparedResolution.option.id, 'refund');
});

test('human can choose another option, replacing the agent selection', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'agent said so' });
  assert.equal(s.preparedResolution.preparedBy, 'AGENT');

  const r = s.chooseAnother('keep_partial_refund');
  assert.equal(r.ok, true);
  assert.equal(s.preparedResolution.option.id, 'keep_partial_refund');
  assert.equal(s.preparedResolution.preparedBy, 'HUMAN');
  // the agent's reasoning no longer explains what is staged
  assert.equal(s.preparedResolution.reason, null);
  assert.equal(s.state, STATES.RESOLUTION_PREPARED);
  assert.equal(s.humanApproved, false);
});

test('choosing another option does not auto-approve', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  s.chooseAnother('refund');
  assert.equal(s.humanApproved, false);
  assert.equal(s.state, STATES.RESOLUTION_PREPARED);
});

test('cannot choose an ineligible option', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  assert.equal(s.chooseAnother('store_credit').ok, false);
  assert.equal(s.preparedResolution.option.id, 'replacement');
});

// ── tool lifecycle ───────────────────────────────────────────────────

test('allowed tools per state match the lifecycle table', () => {
  const s = newSession();
  assert.deepEqual(s.allowedTools(), ['get_order', 'get_resolution_options', 'prepare_resolution']);

  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  assert.deepEqual(s.allowedTools(), ['get_order', 'get_resolution_options']);
  assert.ok(!s.allowedTools().includes('confirm_resolution'),
    'confirm must not be offered before approval');

  s.approve();
  assert.ok(s.allowedTools().includes('confirm_resolution'));
  assert.ok(!s.allowedTools().includes('prepare_resolution'));

  s.confirm({ resolutionId: 'replacement' });
  assert.deepEqual(s.allowedTools(), ['get_order']);
});

test('every state declares a tool set', () => {
  for (const st of Object.values(STATES)) {
    assert.ok(Array.isArray(TOOLS_BY_STATE[st]), `${st} has no tool set`);
  }
});

// ── options payload ──────────────────────────────────────────────────

test('options are offered before resolution and withdrawn after', () => {
  const s = newSession();
  assert.equal(s.buildOptionsPayload().options.length, 3);
  assert.equal(s.buildOptionsPayload().selectable, true);

  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  assert.equal(s.buildOptionsPayload().selectable, false);

  s.approve();
  s.confirm({ resolutionId: 'replacement' });
  assert.equal(s.buildOptionsPayload().options.length, 0);
  assert.match(s.buildOptionsPayload().note, /already been resolved/i);
});

// ── audit trail ──────────────────────────────────────────────────────

test('audit trail records actor, action, timestamp and metadata', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: 'travels tomorrow' });
  s.approve();
  s.confirm({ resolutionId: 'replacement' });

  assert.equal(s.audit.length, 3);
  assert.deepEqual(s.audit.map(e => e.actor), ['AGENT', 'HUMAN', 'SYSTEM']);
  for (const e of s.audit) {
    assert.ok(e.action, 'action');
    assert.ok(e.timestamp, 'timestamp');
    assert.ok(e.metadata, 'metadata');
  }
  assert.equal(s.audit[0].metadata.reason, 'travels tomorrow');
  assert.equal(s.audit[2].metadata.referenceId, 'R-1042');
});

// ── reset ────────────────────────────────────────────────────────────

test('every scenario resets to a clean ORDER_ACTIVE', () => {
  for (const key of SCENARIO_KEYS) {
    const s = newSession(key);
    s.prepare({ resolutionId: s.buildOptionsPayload().options[0].id, reason: 'x' });
    s.approve();
    s.reset(key);
    assert.equal(s.state, STATES.ORDER_ACTIVE, key);
    assert.equal(s.humanApproved, false, key);
    assert.equal(s.preparedResolution, null, key);
    assert.equal(s.resolutionResult, null, key);
    assert.equal(s.audit.length, 0, key);
  }
});

test('switching scenarios does not carry state across', () => {
  const s = newSession('damaged');
  s.prepare({ resolutionId: 'replacement', reason: 'x' });
  s.approve();
  s.reset('wrong_variant');
  assert.equal(s.order.orderId, '2087');
  assert.equal(s.state, STATES.ORDER_ACTIVE);
  assert.equal(s.humanApproved, false);
});

test('unknown scenario is rejected', () => {
  assert.throws(() => new ResolutionSession('nope'));
});
