import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SCENARIOS, SCENARIO_KEYS, findScenarioByOrderId } from '../src/fixtures.js';
import { getEligibleResolutions, eligibleIds, isEligible, getResolutionOption } from '../src/policy.js';

const damaged = SCENARIOS.damaged;
const wrong = SCENARIOS.wrong_variant;
const late = SCENARIOS.arrived_late;

test('exactly three scenarios exist — no fourth', () => {
  assert.equal(SCENARIO_KEYS.length, 3);
  assert.deepEqual(SCENARIO_KEYS.sort(), ['arrived_late', 'damaged', 'wrong_variant']);
});

test('DAMAGED returns the three specified options', () => {
  assert.deepEqual(eligibleIds(damaged.order, damaged.issue),
    ['replacement', 'refund', 'keep_partial_refund']);
});

test('DAMAGED amounts and timings match merchant policy', () => {
  const [replacement, refund, partial] = getEligibleResolutions(damaged.order, damaged.issue);

  assert.equal(replacement.economicImpact.refundToCustomer, 0);
  assert.equal(replacement.economicImpact.replacementShipped, true);
  assert.equal(replacement.timing.businessDays, 1);
  assert.equal(replacement.returnRequired, true);
  assert.equal(replacement.availability.inStock, true);

  assert.equal(refund.economicImpact.refundToCustomer, 129);
  assert.equal(refund.timing.businessDays, 5);
  assert.equal(refund.returnRequired, true);

  assert.equal(partial.economicImpact.refundToCustomer, 40);
  assert.equal(partial.economicImpact.customerKeepsItem, true);
  assert.equal(partial.timing.immediate, true);
  assert.equal(partial.returnRequired, false);
});

test('WRONG_VARIANT returns the three specified options with correct amounts', () => {
  assert.deepEqual(eligibleIds(wrong.order, wrong.issue), ['exchange', 'refund', 'store_credit']);
  const [exchange, refund, credit] = getEligibleResolutions(wrong.order, wrong.issue);

  assert.equal(exchange.timing.businessDays, 2);
  assert.equal(exchange.economicImpact.replacementShipped, true);
  assert.equal(exchange.availability.variant, 'Size 9');

  assert.equal(refund.economicImpact.refundToCustomer, 96);
  assert.equal(refund.timing.businessDays, 5);

  assert.equal(credit.economicImpact.storeCreditToCustomer, 105);
  assert.equal(credit.timing.immediate, true);
});

test('ARRIVED_LATE returns the three specified options with correct amounts', () => {
  assert.deepEqual(eligibleIds(late.order, late.issue),
    ['return_refund', 'keep_shipping_refund', 'keep_store_credit']);
  const [ret, shipping, credit] = getEligibleResolutions(late.order, late.issue);

  assert.equal(ret.economicImpact.refundToCustomer, 74);
  assert.equal(ret.returnRequired, true);

  assert.equal(shipping.economicImpact.refundToCustomer, 12);
  assert.equal(shipping.economicImpact.customerKeepsItem, true);
  assert.equal(shipping.returnRequired, false);

  assert.equal(credit.economicImpact.storeCreditToCustomer, 20);
  assert.equal(credit.economicImpact.customerKeepsItem, true);
  assert.equal(credit.returnRequired, false);
});

test('an option from another scenario is not eligible', () => {
  // replacement belongs to DAMAGED, never to ARRIVED_LATE
  assert.equal(isEligible(late.order, late.issue, 'replacement'), false);
  assert.equal(isEligible(damaged.order, damaged.issue, 'store_credit'), false);
  assert.equal(isEligible(wrong.order, wrong.issue, 'keep_partial_refund'), false);
});

test('an invented option is never eligible', () => {
  assert.equal(isEligible(damaged.order, damaged.issue, 'free_upgrade'), false);
  assert.equal(isEligible(damaged.order, damaged.issue, 'refund_500'), false);
  assert.equal(getResolutionOption(damaged.order, damaged.issue, 'nope'), null);
});

test('policy engine is deterministic across repeated calls', () => {
  for (const key of SCENARIO_KEYS) {
    const s = SCENARIOS[key];
    const a = JSON.stringify(getEligibleResolutions(s.order, s.issue));
    const b = JSON.stringify(getEligibleResolutions(s.order, s.issue));
    assert.equal(a, b, `${key} not deterministic`);
  }
});

test('every option carries the structured fields an agent needs to compare', () => {
  for (const key of SCENARIO_KEYS) {
    const s = SCENARIOS[key];
    for (const o of getEligibleResolutions(s.order, s.issue)) {
      assert.ok(o.id, 'id');
      assert.ok(o.type, 'type');
      assert.equal(o.eligible, true);
      assert.ok(o.customerReceives, 'customerReceives');
      assert.ok(o.economicImpact, 'economicImpact');
      assert.equal(typeof o.economicImpact.refundToCustomer, 'number');
      assert.equal(typeof o.economicImpact.storeCreditToCustomer, 'number');
      assert.equal(typeof o.economicImpact.customerKeepsItem, 'boolean');
      assert.ok(o.timing && typeof o.timing.businessDays === 'number');
      assert.equal(typeof o.returnRequired, 'boolean');
      assert.ok(Array.isArray(o.requirements));
      assert.ok(o.estimatedCompletion);
    }
  }
});

test('orders are addressable by id', () => {
  assert.equal(findScenarioByOrderId('1042').key, 'damaged');
  assert.equal(findScenarioByOrderId('2087').key, 'wrong_variant');
  assert.equal(findScenarioByOrderId('3155').key, 'arrived_late');
  assert.equal(findScenarioByOrderId('9999'), null);
});
