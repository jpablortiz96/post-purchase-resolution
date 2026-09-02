/**
 * READ-ONLY inspection of a single order and its returns.
 *
 * Contains no mutation of any kind. Output is sanitized: no customer email,
 * name, address or phone is read or printed.
 *
 *   node --env-file=.env harness/shopify/inspect-1003.js "#1003"
 */

const RAW = (process.env.SHOPIFY_SHOP || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const SHOP = RAW.includes('.') ? RAW : `${RAW}.myshopify.com`;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';
const NAME = process.argv[2] || '#1003';

const shortId = g => String(g || '').split('/').pop();

async function token() {
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`auth failed ${res.status}`);
  return (await res.json()).access_token;
}

async function gql(t, query, variables) {
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': t },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

(async () => {
  const t = await token();

  const d = await gql(t, `query($q: String!) {
    orders(first: 1, query: $q) {
      nodes {
        id name createdAt updatedAt
        displayFinancialStatus displayFulfillmentStatus returnStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        totalRefundedSet { shopMoney { amount currencyCode } }
        refunds(first: 10) { id createdAt totalRefundedSet { shopMoney { amount currencyCode } } }
        lineItems(first: 10) { nodes { title quantity unfulfilledQuantity } }
        returns(first: 10) {
          nodes {
            id name status totalQuantity
            returnLineItems(first: 10) {
              nodes {
                id quantity returnReason
                ... on ReturnLineItem { fulfillmentLineItem { lineItem { title } } }
              }
            }
          }
        }
      }
    }
  }`, { q: `name:${NAME}` });

  const o = (d.orders?.nodes || [])[0];
  if (!o) { console.log(JSON.stringify({ error: 'order not found', name: NAME }, null, 2)); process.exit(1); }

  const out = {
    capturedAt: new Date().toISOString(),
    source: 'shopify-admin-api',
    apiVersion: API_VERSION,
    order: {
      reference: o.name,
      externalId: shortId(o.id),
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      financialStatus: o.displayFinancialStatus,
      fulfillmentStatus: o.displayFulfillmentStatus,
      returnStatus: o.returnStatus,
      total: o.totalPriceSet?.shopMoney,
      totalRefunded: o.totalRefundedSet?.shopMoney,
      refundCount: (o.refunds || []).length,
      refunds: (o.refunds || []).map(r => ({
        externalId: shortId(r.id), createdAt: r.createdAt, amount: r.totalRefundedSet?.shopMoney,
      })),
      lineItems: (o.lineItems?.nodes || []).map(l => ({
        title: l.title, quantity: l.quantity, unfulfilledQuantity: l.unfulfilledQuantity })),
    },
    returns: (o.returns?.nodes || []).map(r => ({
      reference: r.name,
      externalId: shortId(r.id),
      status: r.status,
      totalQuantity: r.totalQuantity,
      lineItems: (r.returnLineItems?.nodes || []).map(li => ({
        quantity: li.quantity, reason: li.returnReason,
        product: li.fulfillmentLineItem?.lineItem?.title || null,
      })),
    })),
  };
  console.log(JSON.stringify(out, null, 2));
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
