/**
 * READ-ONLY external re-query, written as sanitized evidence.
 *
 * This is the independent check: it reads Shopify directly, through the Admin
 * API, with no involvement from the customer page or its session. If the page
 * and this disagree, this is right.
 *
 * Mutates nothing. Records no email, name, address, phone or raw gid.
 *
 *   node --env-file=.env harness/shopify/capture-external.js <step-file> <order-name> ["note"]
 */

const fs = require('fs');
const path = require('path');

const RAW = (process.env.SHOPIFY_SHOP || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const SHOP = RAW.includes('.') ? RAW : `${RAW}.myshopify.com`;
const V = process.env.SHOPIFY_API_VERSION || '2026-07';
const OUT_DIR = process.env.OUT_DIR || 'evidence/m4-final-clean-flow';

const [stepFile, orderName, note] = process.argv.slice(2);
if (!stepFile || !orderName) {
  console.error('usage: capture-external.js <step-file> <order-name> ["note"]');
  process.exit(1);
}
const shortId = g => String(g || '').split('/').pop();

(async () => {
  const a = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET, grant_type: 'client_credentials' }) });
  const t = (await a.json()).access_token;

  const res = await fetch(`https://${SHOP}/admin/api/${V}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': t },
    body: JSON.stringify({ query: `query($q: String!) {
      orders(first: 1, query: $q) {
        nodes {
          id name createdAt updatedAt
          displayFinancialStatus displayFulfillmentStatus returnStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          totalRefundedSet { shopMoney { amount currencyCode } }
          refunds(first: 5) { id }
          lineItems(first: 10) { nodes { title quantity } }
          fulfillments(first: 5) { displayStatus deliveredAt }
          returns(first: 10) { nodes { id name status totalQuantity } }
        }
      }
    }`, variables: { q: `name:${orderName}` } }) });

  const body = await res.json();
  if (body.errors) { console.error(JSON.stringify(body.errors)); process.exit(1); }
  const o = (body.data.orders?.nodes || [])[0];
  if (!o) { console.error(`order ${orderName} not found`); process.exit(1); }

  const doc = {
    capturedAt: new Date().toISOString(),
    step: path.basename(stepFile, '.json'),
    note: note || undefined,
    source: 'shopify-admin-api · independent read-only re-query',
    apiVersion: V,
    independence: 'Read directly from Shopify. The customer page and its session play no part in this query.',
    order: {
      reference: o.name,
      externalId: shortId(o.id),
      financialStatus: o.displayFinancialStatus,
      fulfillmentStatus: o.displayFulfillmentStatus,
      delivery: (o.fulfillments || []).map(f => ({ displayStatus: f.displayStatus, deliveredAt: f.deliveredAt })),
      returnStatus: o.returnStatus,
      total: o.totalPriceSet?.shopMoney,
      totalRefunded: o.totalRefundedSet?.shopMoney,
      refundCount: (o.refunds || []).length,
      lineItems: (o.lineItems?.nodes || []).map(l => ({ title: l.title, quantity: l.quantity })),
    },
    returns: (o.returns?.nodes || []).map(r => ({
      reference: r.name, externalId: shortId(r.id), status: r.status, totalQuantity: r.totalQuantity })),
    returnCount: (o.returns?.nodes || []).length,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dest = path.join(OUT_DIR, stepFile.endsWith('.json') ? stepFile : `${stepFile}.json`);
  fs.writeFileSync(dest, JSON.stringify(doc, null, 2));

  const rs = doc.returns.map(r => `${r.reference}=${r.status}`).join(', ') || 'none';
  console.log(`${dest}\n  ${doc.order.reference}  ${doc.order.financialStatus}/${doc.order.fulfillmentStatus}  returnStatus=${doc.order.returnStatus}  returns: ${rs}`);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
