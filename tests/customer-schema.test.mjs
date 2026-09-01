/**
 * Customer Account API 2026-07 return-eligibility shape.
 *
 * The live failure this guards against was `Field 'unreturnableReason' doesn't
 * exist on type 'NonReturnableLineItem'`. It survived a green query ladder
 * because the ladder only exercised returnableLineItems, so these tests cover
 * both the query text and the parse.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sanitizeOrder } = require('../api/_lib/customer.js');

const SOURCE = readFileSync(new URL('../api/_lib/customer.js', import.meta.url), 'utf8');
/** Source with block comments removed — prose may name the field, queries may not. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '');

const order = (returnInformation) => ({
  id: 'gid://shopify/Order/12602041500020',
  name: '#1002',
  processedAt: '2026-09-01T15:00:00Z',
  financialStatus: 'PAID',
  fulfillmentStatus: 'FULFILLED',
  totalPrice: { amount: '129.00', currencyCode: 'USD' },
  lineItems: { nodes: [{ title: 'Wireless Headphones', quantity: 1 }] },
  returnInformation,
});

test('no query selects unreturnableReason', () => {
  assert.ok(!CODE.includes('unreturnableReason'),
    'unreturnableReason does not exist on NonReturnableLineItem in 2026-07');
  assert.ok(CODE.includes('quantityDetails'), 'the reason lives on quantityDetails.reasonCode');
  assert.ok(CODE.includes('nonReturnableSummary'), 'order-level reasons come from nonReturnableSummary');
});

test('a returnable order parses', () => {
  const o = sanitizeOrder(order({
    returnableLineItems: { nodes: [
      { quantity: 2, lineItem: { id: 'gid://shopify/LineItem/1', name: 'Wireless Headphones', quantity: 2 } },
    ] },
    nonReturnableLineItems: { nodes: [] },
    nonReturnableSummary: { nonReturnableReasons: [] },
  }));
  assert.equal(o.returnable, true);
  assert.equal(o.returnableQuantity, 2);
  assert.equal(o.nonReturnableQuantity, 0);
  assert.deepEqual(o.nonReturnableReasons, []);
});

test('reasons come from the summary and quantityDetails, deduplicated', () => {
  const o = sanitizeOrder(order({
    returnableLineItems: { nodes: [] },
    nonReturnableLineItems: { nodes: [
      { quantity: 1, lineItem: { id: 'gid://shopify/LineItem/1', name: 'X', quantity: 1 },
        quantityDetails: [{ quantity: 1, reasonCode: 'RETURN_PERIOD_ENDED' }] },
      { quantity: 1, lineItem: { id: 'gid://shopify/LineItem/2', name: 'Y', quantity: 1 },
        quantityDetails: [{ quantity: 1, reasonCode: 'FINAL_SALE' }] },
    ] },
    nonReturnableSummary: { nonReturnableReasons: ['RETURN_PERIOD_ENDED'] },
  }));
  assert.equal(o.returnable, false);
  assert.equal(o.returnableQuantity, 0);
  assert.equal(o.nonReturnableQuantity, 2);
  assert.deepEqual(o.nonReturnableReasons.sort(), ['FINAL_SALE', 'RETURN_PERIOD_ENDED']);
});

test('every level of returnInformation is optional', () => {
  for (const ri of [undefined, null, {}, { nonReturnableLineItems: { nodes: [{ quantity: 1 }] } }]) {
    const o = sanitizeOrder(order(ri));
    assert.equal(o.returnable, false);
    assert.equal(o.returnableQuantity, 0);
    assert.ok(Array.isArray(o.nonReturnableReasons));
  }
});

test('line item gids are fetched but never emitted', () => {
  const o = sanitizeOrder(order({
    returnableLineItems: { nodes: [
      { quantity: 1, lineItem: { id: 'gid://shopify/LineItem/99', name: 'X', quantity: 1 } },
    ] },
    nonReturnableLineItems: { nodes: [] },
  }));
  assert.ok(!JSON.stringify(o).includes('gid://'), 'no raw Shopify gid may reach a caller');
  assert.equal(o.orderKey, '12602041500020', 'the order key stays an opaque suffix');
});
