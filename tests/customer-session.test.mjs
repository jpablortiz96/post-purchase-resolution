/**
 * Authenticated customer session: selection, derived state, and the boundary
 * that keeps preparation non-mutating.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomerSession, CUSTOMER_STATES, nextAction, describeReason, describeReturn } from '../src/customer.js';

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
  assert.equal(nextAction(purchase({ latestReturn: { status: 'REQUESTED' } })).level, 'waiting');
  assert.equal(nextAction(purchase({ latestReturn: { status: 'OPEN' } })).level, 'action');
  assert.equal(
    nextAction(purchase({ returnable: false, nonReturnableReasons: ['RETURNED'] })).label,
    'Already returned');
  assert.equal(nextAction(null), null);
});

test('no return state invents carrier or shipping instructions', () => {
  for (const status of ['REQUESTED', 'OPEN', 'CLOSED', 'DECLINED', 'CANCELED']) {
    const a = nextAction(purchase({ latestReturn: { status } }));
    assert.ok(a && a.detail !== undefined);
    assert.ok(!/carrier|tracking|label|ups|fedex|dhl|courier/i.test(a.detail),
      `${status} must not invent shipping detail`);
  }
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

test('prepare() cannot reach the network at all', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/customer.js', import.meta.url), 'utf8');
  // Isolate the prepare method body and prove no request can originate there.
  const start = src.indexOf('prepare({ reason');
  const end = src.indexOf('cancelPrepared()');
  assert.ok(start > 0 && end > start);
  const body = src.slice(start, end);
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(body),
    'staging a resolution must not be able to contact anything');
});

test('only requestReturn talks to the mutation route', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/customer.js', import.meta.url), 'utf8');
  const hits = src.match(/\/api\/customer\/return-request/g) || [];
  assert.equal(hits.length, 1, 'exactly one call site for the customer mutation');
  const start = src.indexOf('async requestReturn');
  assert.ok(src.indexOf('/api/customer/return-request') > start, 'and it lives inside requestReturn');
});

// ── post-refund lifecycle (the #1003 incident) ─────────────────────────

test('a CLOSED return reads as completed, never as "already returned"', () => {
  const a = nextAction(purchase({
    latestReturn: { status: 'CLOSED', reference: '#1003-R1' }, activeReturn: null,
    returnable: false, nonReturnableReasons: ['RETURNED'], financialStatus: 'PAID' }));
  assert.equal(a.label, 'Return completed');
  assert.equal(a.level, 'done');
});

test('CLOSED is never rendered as OPEN', () => {
  for (const status of ['CLOSED', 'DECLINED', 'CANCELED']) {
    const a = nextAction(purchase({ latestReturn: { status }, activeReturn: null }));
    assert.notEqual(a.label, 'Return approved', `${status} must not read as approved`);
  }
});

test('a refund is only claimed when Shopify reports the order refunded', () => {
  const refunded = nextAction(purchase({
    latestReturn: { status: 'CLOSED' }, activeReturn: null, financialStatus: 'REFUNDED' }));
  assert.match(refunded.detail, /refund has been issued/i);

  for (const fin of ['PAID', 'PARTIALLY_REFUNDED', 'PENDING', undefined]) {
    const a = nextAction(purchase({
      latestReturn: { status: 'CLOSED' }, activeReturn: null, financialStatus: fin }));
    assert.ok(!/refund/i.test(a.detail), `must not claim a refund when financialStatus is ${fin}`);
  }
});

test('every state Shopify can report has customer language', () => {
  for (const status of ['REQUESTED', 'OPEN', 'CLOSED', 'DECLINED', 'CANCELED']) {
    const d = describeReturn(status);
    assert.ok(d.headline && d.level, `${status} needs a headline and level`);
    assert.ok(!/^return [a-z]+$/.test(d.headline) || status === 'CLOSED',
      `${status} must not fall through to the generic label`);
  }
  // An unknown future state degrades readably rather than throwing.
  assert.ok(describeReturn('SOMETHING_NEW').headline.length > 0);
});

test('a settled return still surfaces on the purchase', () => {
  const s = seeded([purchase({
    latestReturn: { status: 'CLOSED', reference: '#1003-R1' }, activeReturn: null,
    returnable: false, nonReturnableReasons: ['RETURNED'], financialStatus: 'REFUNDED' })]);
  s.select('111');
  const p = s.buildOrderPayload();
  assert.equal(p.latestReturn.status, 'CLOSED');
  assert.match(p.optionsNote, /#1003-R1/);
  assert.match(p.customerFacingStatus, /completed/i);
});

test('a completed return does not ask for the customer’s attention', () => {
  const s = seeded([purchase({ latestReturn: { status: 'CLOSED' }, activeReturn: null, returnable: false })]);
  assert.equal(s.buildInbox()[0].nextAction.level, 'done');
});
