/** READ-ONLY. Fulfillment/delivery state for one order. No mutation. */
const RAW=(process.env.SHOPIFY_SHOP||'').trim().replace(/^https?:\/\//,'').replace(/\/.*$/,'');
const SHOP=RAW.includes('.')?RAW:`${RAW}.myshopify.com`;
const V=process.env.SHOPIFY_API_VERSION||'2026-07';
const NAME=process.argv[2]||'#1004';
(async()=>{
  const a=await fetch(`https://${SHOP}/admin/oauth/access_token`,{method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({client_id:process.env.SHOPIFY_CLIENT_ID,client_secret:process.env.SHOPIFY_CLIENT_SECRET,grant_type:'client_credentials'})});
  const t=(await a.json()).access_token;
  const r=await fetch(`https://${SHOP}/admin/api/${V}/graphql.json`,{method:'POST',
    headers:{'content-type':'application/json','X-Shopify-Access-Token':t},
    body:JSON.stringify({query:`query($q: String!) {
      orders(first: 1, query: $q) {
        nodes { name displayFulfillmentStatus
          fulfillments(first: 5) { id status displayStatus deliveredAt inTransitAt createdAt }
        }
      }
    }`,variables:{q:`name:${NAME}`}})});
  const b=await r.json();
  if(b.errors){console.error(JSON.stringify(b.errors));process.exit(1);}
  const o=b.data.orders.nodes[0];
  console.log(JSON.stringify({order:o.name, displayFulfillmentStatus:o.displayFulfillmentStatus,
    fulfillments:(o.fulfillments||[]).map(f=>({status:f.status,displayStatus:f.displayStatus,
      deliveredAt:f.deliveredAt,inTransitAt:f.inTransitAt,createdAt:f.createdAt}))},null,2));
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
