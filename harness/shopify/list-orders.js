const RAW = (process.env.SHOPIFY_SHOP || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const SHOP = RAW.includes('.') ? RAW : `${RAW}.myshopify.com`;
const VER = process.env.SHOPIFY_API_VERSION || '2026-07';
(async () => {
  const t = await (await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET, grant_type: 'client_credentials' }),
  })).json();
  const gql = async (query, variables) => (await fetch(`https://${SHOP}/admin/api/${VER}/graphql.json`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': t.access_token },
    body: JSON.stringify({ query, variables }) })).json();

  console.log('granted scopes:', t.scope);
  const out = await gql(`query { orders(first: 25, sortKey: CREATED_AT, reverse: true) {
    nodes { id name displayFinancialStatus displayFulfillmentStatus returnStatus
            returns(first:5){ nodes { name status } } } } }`);
  if (out.errors) { console.log('ERR', JSON.stringify(out.errors).slice(0,400)); process.exit(1); }
  console.log('\norders in store:', out.data.orders.nodes.length);
  for (const o of out.data.orders.nodes) {
    const rf = await gql(`query($id: ID!) { returnableFulfillments(orderId:$id, first:5) {
      nodes { returnableFulfillmentLineItems(first:5){ nodes { quantity fulfillmentLineItem { id } } } } } }`, { id: o.id });
    const items = (rf.data?.returnableFulfillments?.nodes || [])
      .flatMap(n => n.returnableFulfillmentLineItems.nodes);
    console.log(`  ${o.name.padEnd(8)} ${o.displayFinancialStatus.padEnd(9)} ${String(o.displayFulfillmentStatus).padEnd(12)} returnStatus=${String(o.returnStatus).padEnd(12)} returns=[${o.returns.nodes.map(r=>r.name+':'+r.status).join(', ')}] RETURNABLE_ITEMS=${items.length}`);
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
