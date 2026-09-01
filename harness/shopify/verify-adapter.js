/** Exercise the server-side adapter against real Shopify. No secrets printed. */
const s = require('../../api/_lib/shopify.js');
(async () => {
  console.log('configured:', s.configured(), '| shop:', s.shopHost(), '| api:', s.API_VERSION, '| demo orders:', s.DEMO_ORDERS);

  console.log('\n--- getOrder (sanitized, browser-facing) ---');
  const { sanitized } = await s.getOrder('#1001');
  console.log(JSON.stringify(sanitized, null, 1));

  console.log('\n--- PII check on the sanitized payload ---');
  const blob = JSON.stringify(sanitized).toLowerCase();
  // Word-boundary patterns: a substring check flags "headphones" for "phone".
  const PATTERNS = [
    [/email/, 'email'], [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/, 'email address'],
    [/phone/, 'phone'], [/address\d?/, 'address'], [/city/, 'city'],
    [/zip|postal/, 'postcode'], [/customer(name|id|email)?/, 'customer field'],
    [/gid:\/\//, 'raw gid'], [/myshopify/, 'shop host'], [/shpat_/, 'access token'],
    [/\/admin\//, 'admin url'],
  ];
  const leaks = PATTERNS.filter(([re]) => re.test(blob)).map(([, label]) => label);
  console.log(leaks.length ? 'POSSIBLE LEAK: ' + leaks.join(', ') : 'clean — no PII/secret markers');

  console.log('\n--- returnStatus (independent re-read) ---');
  console.log(JSON.stringify(await s.returnStatus('#1001'), null, 1));

  console.log('\n--- duplicate protection: request a return while one is live ---');
  const dup = await s.requestReturn({ orderName: '#1001', customerNote: 'duplicate guard test' });
  console.log(JSON.stringify(dup, null, 1));
  console.log(dup.created === false && dup.duplicate === true
    ? 'PASS  no second Return was created'
    : 'FAIL  a duplicate was created');

  console.log('\n--- order allowlist: a non-demo order must be refused ---');
  try { await s.getOrder('#9999'); console.log('FAIL  non-demo order was allowed'); }
  catch (e) { console.log('PASS ', e.code, '-', e.message); }

  console.log('\n--- approve when nothing is REQUESTED ---');
  try { await s.approveReturn({ orderName: '#1001' }); console.log('FAIL  approved something that was not REQUESTED'); }
  catch (e) { console.log('PASS ', e.code, '-', e.message); }
})().catch(e => { console.error('FATAL', e.code || '', e.message); process.exit(1); });
