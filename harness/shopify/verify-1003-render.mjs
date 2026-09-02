/**
 * Prove the DEPLOYED customer logic renders #1003 correctly.
 *
 * Reads real Shopify truth (read-only), reconstructs the Customer Account API
 * order node from it, runs it through the server sanitiser and the *deployed*
 * client module, and reports what the customer page would show.
 *
 * Mutates nothing.
 *
 *   node --env-file=.env harness/shopify/verify-1003-render.mjs <truth.json> <deployed-customer.mjs>
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sanitizeOrder } = require('../../api/_lib/customer.js');

const truth = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const deployed = await import(pathToFileURL(process.argv[3]).href);

const r = truth.returns[0];
console.log('REAL Shopify truth   ->', truth.order.reference, truth.order.financialStatus,
  '|', r.reference, r.status);

// The Customer Account API node, reconstructed from the real Admin values.
const node = {
  id: `gid://shopify/Order/${truth.order.externalId}`,
  name: truth.order.reference,
  processedAt: truth.order.createdAt,
  financialStatus: truth.order.financialStatus,
  fulfillmentStatus: truth.order.fulfillmentStatus,
  totalPrice: truth.order.total,
  lineItems: { nodes: truth.order.lineItems.map(l => ({ title: l.title, quantity: l.quantity })) },
  returns: { nodes: [{ id: `gid://shopify/Return/${r.externalId}`, name: r.reference,
                       status: r.status, createdAt: '2026-09-02T14:42:13Z' }] },
  returnInformation: {
    returnableLineItems: { nodes: [] },
    nonReturnableLineItems: { nodes: [] },
    nonReturnableSummary: { nonReturnableReasons: ['RETURNED'] },
  },
};

const o = sanitizeOrder(node);
const act = deployed.nextAction(o);

console.log('\nactiveReturn         ->', JSON.stringify(o.activeReturn));
console.log('latestReturn         ->', JSON.stringify(o.latestReturn));
console.log('\nHEADLINE             ->', act.label);
console.log('DETAIL               ->', act.detail);
console.log('SECONDARY            -> Shopify status ·', o.latestReturn.status);
console.log('level                ->', act.level);

const pass = act.label === 'Return completed'
  && /refund has been issued/i.test(act.detail)
  && o.latestReturn.status === 'CLOSED'
  && !/approved/i.test(act.label);

console.log('\nstill reads OPEN?    ->', /approved/i.test(act.label));
console.log(pass ? 'GATE PASS — deployed logic renders CLOSED correctly'
                 : 'GATE FAIL — deployed logic does not render CLOSED correctly');
process.exit(pass ? 0 : 1);
