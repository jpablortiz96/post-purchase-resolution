/** Preflight probe: token exchange + read order #1001. Prints NO secrets. */
const RAW = (process.env.SHOPIFY_SHOP || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const SHOP = RAW.includes('.') ? RAW : `${RAW}.myshopify.com`;
const ID = process.env.SHOPIFY_CLIENT_ID;
const SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const VER = process.env.SHOPIFY_API_VERSION || '2026-07';

const redact = s => String(s || '').replace(/shpat_[A-Za-z0-9_-]+/g, 'shpat_<redacted>')
  .replace(new RegExp(ID || 'zzz', 'g'), '<client_id>')
  .replace(new RegExp(SECRET || 'zzz', 'g'), '<client_secret>');

(async () => {
  console.log('shop:', SHOP, '| api version:', VER);

  const tokRes = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: ID, client_secret: SECRET, grant_type: 'client_credentials' }),
  });
  const tokBody = await tokRes.text();
  if (!tokRes.ok) {
    console.log('TOKEN FAILED', tokRes.status, redact(tokBody).slice(0, 400));
    process.exit(1);
  }
  const tok = JSON.parse(tokBody);
  console.log('token acquired: yes | expires_in:', tok.expires_in, '| scopes:', tok.scope);

  const gql = async (query, variables) => {
    const r = await fetch(`https://${SHOP}/admin/api/${VER}/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': tok.access_token },
      body: JSON.stringify({ query, variables }),
    });
    return r.json();
  };

  const q = `query {
    orders(first: 5, query: "name:#1001") {
      nodes {
        id name displayFinancialStatus displayFulfillmentStatus createdAt
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        lineItems(first: 5) { nodes { id title quantity variantTitle
          originalUnitPriceSet { shopMoney { amount currencyCode } } } }
        returns(first: 10) { nodes { id name status } }
        returnStatus
      }
    }
  }`;
  const out = await gql(q);
  if (out.errors) { console.log('GQL ERRORS:', JSON.stringify(out.errors).slice(0, 600)); process.exit(1); }
  const o = out.data.orders.nodes[0];
  if (!o) { console.log('ORDER #1001 NOT FOUND'); process.exit(1); }
  console.log('\n--- order ---');
  console.log(JSON.stringify(o, null, 1).slice(0, 1400));

  const rf = await gql(`query($id: ID!) {
    returnableFulfillments(orderId: $id, first: 10) {
      nodes { id fulfillment { id }
        returnableFulfillmentLineItems(first: 10) {
          nodes { fulfillmentLineItem { id lineItem { title } } quantity } } }
    }
  }`, { id: o.id });
  console.log('\n--- returnableFulfillments ---');
  console.log(rf.errors ? JSON.stringify(rf.errors).slice(0, 500) : JSON.stringify(rf.data, null, 1).slice(0, 1200));
})().catch(e => { console.error('FATAL', redact(e.message)); process.exit(1); });
