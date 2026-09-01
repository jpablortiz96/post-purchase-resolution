/**
 * Authenticated customer session: selection, derived state, and the boundary
 * that keeps preparation non-mutating.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomerSession, CUSTOMER_STATES, nextAction, describeReason } from '../src/customer.js';

const purchase = (over = {}) => ({
  orderKey: '111', orderReference: '#1001', product: 'Wireless Headphones',
  quantity: 1, price: 129, currency: 'USD',
  processedAt: '2026-08-01T10:00:00Z',
  financialStatus: 'PAID', fulfillmentStatus: 'FULFILLED',
  returnable: true, returnableQuantity: 1,
  nonReturnableReasons: [], existingReturns: [], activeReturn: null,
  ...over,
});

const seeded = (purchases) => {
  const s = new CustomerSession(() => '2026-09-01T00:00:00Z');
  s.purchases = purchases;
  s.deriveState();
  return s;
};

test('next action is derived from authoritative state only', () => {
  assert.equal(nextAction(purchase()).level, 'available');
  assert.equal(nextAction(purchase({ activeReturn: { status: 'REQUESTED' } })).level, 'waiting');
  assert.equal(nextAction(purchase({ activeReturn: { status: 'OPEN' } })).level, 'action');
  assert.equal(
    nextAction(purchase({ returnable: false, nonReturnableReasons: ['RETURNED'] })).label,
    'Already returned');
  assert.equal(nextAction(null), null);
});

test('an approved return never invents shipping instructions', () => {
  const a = nextAction(purchase({ activeReturn: { status: 'OPEN' } }));
  assert.match(a.detail, /merchant/i);
  assert.ok(!/carrier|tracking|label|ups|fedex|dhl/i.test(a.detail));
});

test('reason codes are translated, unknown ones degrade readably', () => {
  assert.equal(describeReason('RETURN_PERIOD_ENDED'), 'The return window has closed');
  assert.equal(describeReason('SOME_NEW_CODE'), 'some new code');
});

test('state follows the selected purchase', () => {
  const s = seeded([purchase()]);
  assert.equal(s.state, CUSTOMER_STATES.BROWSING);
  s.select('111');
  assert.equal(s.state, CUSTOMER_STATES.ORDER_ACTIVE);
  s.prepare({ reason: 'Arrived damaged' });
  assert.equal(s.state, CUSTOMER_STATES.RESOLUTION_PREPARED);
});

test('an unknown purchase id selects nothing', () => {
  const s = seeded([purchase()]);
  const out = s.select('gid://shopify/Order/999');
  assert.equal(out.ok, false);
  assert.equal(s.selected, null);
});

test('external return state wins over anything prepared locally', () => {
  const s = seeded([purchase({ activeReturn: { status: 'REQUESTED', reference: '#1001-R1' } })]);
  s.select('111');
  assert.equal(s.state, CUSTOMER_STATES.RETURN_REQUESTED);
  const out = s.prepare({ reason: 'again' });
  assert.equal(out.ok, false, 'a second return must not be preparable');
});

test('preparation is refused when Shopify says nothing is returnable', () => {
  const s = seeded([purchase({ returnable: false, nonReturnableReasons: ['RETURNED'] })]);
  s.select('111');
  const out = s.prepare({ reason: 'please' });
  assert.equal(out.ok, false);
  assert.match(out.hint, /already returned/i);
});

test('preparation mutates nothing and stays uncommitted', () => {
  const s = seeded([purchase()]);
  s.select('111');
  const out = s.prepare({ reason: 'Left earphone dead' });
  assert.equal(out.ok, true);
  assert.equal(out.resolution.committedByCustomer, false);
  assert.equal(out.resolution.requiresCustomerRequest, true);
  // Nothing about the purchase itself may change.
  assert.deepEqual(s.purchases[0].existingReturns, []);
  assert.equal(s.purchases[0].activeReturn, null);
});

test('get_order reports no open purchase rather than guessing one', () => {
  const s = seeded([purchase(), purchase({ orderKey: '222', product: 'Mechanical Keyboard' })]);
  const payload = s.buildOrderPayload();
  assert.ok(payload.error);
  assert.equal(payload.purchaseCount, 2);
  assert.ok(!payload.orderReference, 'it must not pick a purchase on the customer’s behalf');
});

test('the order payload carries no gid, email or token', () => {
  const s = seeded([purchase()]);
  s.select('111');
  const blob = JSON.stringify(s.buildOrderPayload());
  assert.ok(!/gid:\/\/|@|shcat_|shpat_/.test(blob));
});

test('switching purchase discards a resolution prepared for the previous one', () => {
  const s = seeded([purchase(), purchase({ orderKey: '222', product: 'Mechanical Keyboard' })]);
  s.select('111');
  s.prepare({ reason: 'damaged' });
  s.select('222');
  assert.equal(s.preparedResolution, null);
  assert.equal(s.state, CUSTOMER_STATES.ORDER_ACTIVE);
});

test('the inbox is customer-safe and complete', () => {
  const s = seeded([purchase(), purchase({ orderKey: '222', product: 'Mechanical Keyboard', returnable: false,
    nonReturnableReasons: ['RETURN_PERIOD_ENDED'] })]);
  const inbox = s.buildInbox();
  assert.equal(inbox.length, 2);
  assert.ok(inbox.every(i => i.product && i.nextAction));
  assert.ok(!/gid:\/\/|@/.test(JSON.stringify(inbox)));
});
