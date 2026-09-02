/** READ-ONLY. Exactly the query the merchant queue runs. No mutation. */
const RAW=(process.env.SHOPIFY_SHOP||'').trim().replace(/^https?:\/\//,'').replace(/\/.*$/,'');
const SHOP=RAW.includes('.')?RAW:`${RAW}.myshopify.com`;
const V=process.env.SHOPIFY_API_VERSION||'2026-07';
(async()=>{
  const a=await fetch(`https://${SHOP}/admin/oauth/access_token`,{method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({client_id:process.env.SHOPIFY_CLIENT_ID,client_secret:process.env.SHOPIFY_CLIENT_SECRET,grant_type:'client_credentials'})});
  const t=(await a.json()).access_token;
  const r=await fetch(`https://${SHOP}/admin/api/${V}/graphql.json`,{method:'POST',
    headers:{'content-type':'application/json','X-Shopify-Access-Token':t},
    body:JSON.stringify({query:`query($first: Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        nodes { id name closed returns(first: 5) { nodes { id name status } } }
      }
    }`,variables:{first:25}})});
  const b=await r.json();
  if(b.errors){console.error(JSON.stringify(b.errors));process.exit(1);}
  const nodes=b.data.orders.nodes;
  console.log('orders returned by the queue query:', nodes.length);
  for(const o of nodes){
    const rs=(o.returns?.nodes||[]).map(x=>`${x.name}=${x.status}`).join(', ')||'—';
    console.log(`  ${o.name}  archived/closed=${o.closed}  returns: ${rs}`);
  }
  console.log('\n#1003 present in queue query:', nodes.some(o=>o.name==='#1003'));
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
