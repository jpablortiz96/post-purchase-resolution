import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ResolutionSession, STATES } from '../src/state.js';
import { SCENARIO_KEYS, SCENARIOS } from '../src/fixtures.js';

const newSession = (k = 'damaged') => new ResolutionSession(k);

// ── a customer must be able to resolve their own order, unaided ──────
//
// A1 (production audit) found the app could only be driven by an agent: the
// only customer-visible controls were the scenario switcher and reset. These
// cover the self-service path that fixed it.

test('a customer can stage a resolution with no agent involved', () => {
  const s = newSession();
  const r = s.prepare({ resolutionId: 'refund', reason: null, actor: 'HUMAN' });
  assert.equal(r.ok, true);
  assert.equal(s.state, STATES.RESOLUTION_PREPARED);
  assert.equal(s.preparedResolution.preparedBy, 'HUMAN');
  assert.equal(s.preparedResolution.reason, null);
});

test('a customer-staged resolution shows no agent reasoning', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'refund', reason: null, actor: 'HUMAN' });
  assert.equal(s.buildOrderPayload().resolution.agentReasoning, null);
});

test('a customer can complete the whole flow unaided', () => {
  for (const key of SCENARIO_KEYS) {
    const s = newSession(key);
    const first = s.buildOptionsPayload().options[0].id;

    s.prepare({ resolutionId: first, reason: null, actor: 'HUMAN' });
    s.approve();
    const r = s.confirm({ resolutionId: first, actor: 'HUMAN' });

    assert.equal(r.ok, true, key);
    assert.equal(s.state, STATES.RESOLVED, key);
    assert.ok(s.resolutionResult.referenceId, key);
  }
});

test('the unaided path still cannot skip approval', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'refund', reason: null, actor: 'HUMAN' });
  const r = s.confirm({ resolutionId: 'refund', actor: 'HUMAN' });
  assert.equal(r.ok, false);
  assert.match(r.error, /has not approved/i);
  assert.equal(s.resolutionResult, null);
});

test('audit distinguishes a customer-driven flow from an agent-driven one', () => {
  const human = newSession();
  human.prepare({ resolutionId: 'refund', reason: null, actor: 'HUMAN' });
  human.approve();
  human.confirm({ resolutionId: 'refund', actor: 'HUMAN' });
  assert.deepEqual(human.audit.map(e => e.actor), ['HUMAN', 'HUMAN', 'SYSTEM']);

  const agent = newSession();
  agent.prepare({ resolutionId: 'refund', reason: 'fastest', actor: 'AGENT' });
  agent.approve();
  agent.confirm({ resolutionId: 'refund', actor: 'AGENT' });
  assert.deepEqual(agent.audit.map(e => e.actor), ['AGENT', 'HUMAN', 'SYSTEM']);
});

test('a customer can switch which option is staged before approving', () => {
  const s = newSession();
  s.prepare({ resolutionId: 'replacement', reason: null, actor: 'HUMAN' });
  s.chooseAnother('keep_partial_refund');
  assert.equal(s.preparedResolution.option.id, 'keep_partial_refund');
  assert.equal(s.humanApproved, false);
});

// ── every scenario is genuinely operable, not a visual mock ──────────

test('every scenario exposes three distinct, fully-specified options', () => {
  for (const key of SCENARIO_KEYS) {
    const s = newSession(key);
    const opts = s.buildOptionsPayload().options;
    assert.equal(opts.length, 3, key);
    assert.equal(new Set(opts.map(o => o.id)).size, 3, `${key} has duplicate ids`);
    for (const o of opts) {
      assert.ok(o.customerReceives.length > 0, `${key}/${o.id} customerReceives`);
      assert.ok(o.timing.summary.length > 0, `${key}/${o.id} timing`);
      assert.ok(o.requirements.length > 0, `${key}/${o.id} requirements`);
    }
  }
});

test('every scenario can reach RESOLVED through every one of its options', () => {
  for (const key of SCENARIO_KEYS) {
    for (const opt of new ResolutionSession(key).buildOptionsPayload().options) {
      const s = newSession(key);
      s.prepare({ resolutionId: opt.id, reason: 'test', actor: 'AGENT' });
      s.approve();
      const r = s.confirm({ resolutionId: opt.id, actor: 'AGENT' });
      assert.equal(r.ok, true, `${key}/${opt.id}`);
      assert.equal(s.state, STATES.RESOLVED, `${key}/${opt.id}`);
      assert.ok(r.resolution.referenceId, `${key}/${opt.id} reference id`);
    }
  }
});

test('scenario labels are customer-facing, not internal keys', () => {
  for (const key of SCENARIO_KEYS) {
    const label = SCENARIOS[key].label;
    assert.ok(!label.includes('_'), `${key} label looks internal: ${label}`);
    assert.match(label, /^[A-Z]/, `${key} label not capitalised`);
  }
});
