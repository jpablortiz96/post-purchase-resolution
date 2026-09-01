/** Read-only preflight for #1002. Mutates nothing. */
const RAW=(process.env.SHOPIFY_SHOP||'').trim().replace(/^https?:\/\//,'').replace(/\/.*$/,'');
const SHOP=RAW.includes('.')?RAW:`${RAW}.myshopify.com`;
const VER=process.env.SHOPIFY_API_VERSION||'2026-07';
const fs=require('fs'),path=require('path');
const OUT=path.join(__dirname,'..','..','evidence','m4-merchant-loop');
fs.mkdirSync(path.join(OUT,'before'),{recursive:true});
const checks=[]; const rec=(n,p,d)=>{checks.push({name:n,pass:p,detail:d});
  console.log(`${p?'PASS':'FAIL'}  ${n}${d!==undefined?'  '+JSON.stringify(d):''}`);};

(async()=>{
  const t=await(await fetch(`https://${SHOP}/admin/oauth/access_token`,{method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({client_id:process.env.SHOPIFY_CLIENT_ID,client_secret:process.env.SHOPIFY_CLIENT_SECRET,grant_type:'client_credentials'})})).json();
  const gql=async(q,v)=>(await fetch(`https://${SHOP}/admin/api/${VER}/graphql.json`,{method:'POST',
    headers:{'content-type':'application/json','X-Shopify-Access-Token':t.access_token},
    body:JSON.stringify({query:q,variables:v})})).json();

  const o=(await gql(`query{orders(first:1,query:"name:#1002"){nodes{
    id name displayFinancialStatus displayFulfillmentStatus returnStatus createdAt
    currentTotalPriceSet{shopMoney{amount currencyCode}}
    fulfillments(first:5){ deliveredAt displayStatus status }
    lineItems(first:5){nodes{id title quantity}}
    returns(first:10){nodes{id name status}}}}}`)).data.orders.nodes[0];

  rec('1. order #1002 exists in Shopify', !!o, o && o.name);
  if(!o){process.exit(1);}
  rec('2. PAID', o.displayFinancialStatus==='PAID', o.displayFinancialStatus);
  rec('3. FULFILLED', o.displayFulfillmentStatus==='FULFILLED', o.displayFulfillmentStatus);
  const f=(o.fulfillments||[])[0];
  rec('4. DELIVERED', !!(f && (f.deliveredAt || f.displayStatus==='DELIVERED')),
      f?{deliveredAt:f.deliveredAt,displayStatus:f.displayStatus,status:f.status}:null);

  const rf=(await gql(`query($id:ID!){returnableFulfillments(orderId:$id,first:10){nodes{
    returnableFulfillmentLineItems(first:10){nodes{quantity fulfillmentLineItem{id lineItem{title}}}}}}}`,{id:o.id}))
    .data.returnableFulfillments.nodes.flatMap(n=>n.returnableFulfillmentLineItems.nodes);
  rec('5. returnableFulfillments queried', true, {count:rf.length});
  rec('6. exactly one returnable Wireless Headphones line item',
    rf.length===1 && /wireless headphones/i.test(rf[0].fulfillmentLineItem.lineItem.title) && rf[0].quantity===1,
    rf.map(x=>({title:x.fulfillmentLineItem.lineItem.title,qty:x.quantity})));
  rec('7. no existing Return consumes it',
    (o.returns.nodes||[]).length===0, o.returns.nodes.map(r=>r.name+':'+r.status));

  const price=o.currentTotalPriceSet.shopMoney;
  console.log(`\n  ${o.name} · ${price.amount} ${price.currencyCode} · ${o.lineItems.nodes[0].title} · returnStatus=${o.returnStatus}`);

  fs.writeFileSync(path.join(OUT,'before','order-1002.json'),JSON.stringify({
    capturedAt:new Date().toISOString(), source:'Shopify Admin GraphQL API', apiVersion:VER,
    note:'Read-only preflight before any mutation. Sanitized: no gid, no PII.',
    order:{ reference:o.name, product:o.lineItems.nodes[0].title, quantity:o.lineItems.nodes[0].quantity,
      price:Number(price.amount), currency:price.currencyCode,
      financialStatus:o.displayFinancialStatus, fulfillmentStatus:o.displayFulfillmentStatus,
      deliveredAt:f?f.deliveredAt:null, fulfillmentDisplayStatus:f?f.displayStatus:null,
      orderReturnStatus:o.returnStatus, existingReturns:o.returns.nodes.map(r=>({reference:r.name,status:r.status})),
      returnableLineItems:rf.map(x=>({title:x.fulfillmentLineItem.lineItem.title,quantity:x.quantity})) },
    checks},null,2));

  const allPass=checks.every(c=>c.pass);
  console.log(`\n${'='.repeat(52)}\nPREFLIGHT #1002: ${checks.filter(c=>c.pass).length}/${checks.length}\n${'='.repeat(52)}`);
  process.exit(allPass?0:1);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
