/** READ-ONLY. Order event timeline, sanitized. No mutation of any kind. */
const RAW = (process.env.SHOPIFY_SHOP || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const SHOP = RAW.includes('.') ? RAW : `${RAW}.myshopify.com`;
const V = process.env.SHOPIFY_API_VERSION || '2026-07';
const NAME = process.argv[2] || '#1003';

const redact = s => String(s || '')
  .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email]')
  .replace(/gid:\/\/shopify\/\w+\/\d+/g, '[gid]');

(async () => {
  const a = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET, grant_type: 'client_credentials' }) });
  const t = (await a.json()).access_token;

  const q = async (query, variables) => {
    const r = await fetch(`https://${SHOP}/admin/api/${V}/graphql.json`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': t },
      body: JSON.stringify({ query, variables }) });
    const b = await r.json();
    if (b.errors) throw new Error(JSON.stringify(b.errors));
    return b.data;
  };

  const d = await q(`query($q: String!) {
    orders(first: 1, query: $q) {
      nodes {
        name
        events(first: 50, sortKey: CREATED_AT) {
          nodes { id createdAt message appTitle attributeToApp attributeToUser criticalAlert }
        }
      }
    }
  }`, { q: `name:${NAME}` });

  const o = (d.orders?.nodes || [])[0];
  console.log(JSON.stringify({
    capturedAt: new Date().toISOString(),
    source: 'shopify-admin-api · order events',
    order: o && o.name,
    events: (o?.events?.nodes || []).map(e => ({
      createdAt: e.createdAt,
      message: redact(e.message),
      appTitle: e.appTitle || null,
      attributedToApp: e.attributeToApp,
      attributedToUser: e.attributeToUser,
    })),
  }, null, 2));
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
