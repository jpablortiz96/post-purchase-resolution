/**
 * M4.3 §15 — auth negative tests against the live production deployment.
 * No token, code or verifier is ever printed or recorded.
 */

const BASE = (process.env.APP_URL || 'https://post-purchase-resolution.vercel.app').replace(/\/$/, '');
const out = [];
const rec = (n, p, d) => {
  out.push({ name: n, pass: p, detail: d });
  console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? '  ' + JSON.stringify(d).slice(0, 130) : ''}`);
};

const get = async (p, headers) => {
  const r = await fetch(BASE + p, { headers, redirect: 'manual' });
  let body = null;
  try { body = await r.json(); } catch (e) { /* redirect or html */ }
  return { status: r.status, body, location: r.headers.get('location'), setCookie: r.headers.get('set-cookie') };
};

(async () => {
  // ── login initiation ───────────────────────────────────────────────
  const login = await get('/api/auth/login');
  rec('login redirects to the discovered Shopify endpoint',
    login.status === 302 && /shopify\.com\/authentication\/.+\/oauth\/authorize/.test(login.location || ''),
    login.status);
  rec('login sets an HttpOnly, Secure, SameSite transaction cookie',
    /HttpOnly/i.test(login.setCookie || '') && /Secure/i.test(login.setCookie || '') && /SameSite=Lax/i.test(login.setCookie || ''));
  rec('code_verifier never appears in the authorization URL',
    !/code_verifier/i.test(login.location || ''));
  rec('client_secret never appears in the authorization URL',
    !/client_secret/i.test(login.location || ''));
  rec('PKCE S256 is requested',
    /code_challenge_method=S256/.test(login.location || ''));

  const txn = (login.setCookie || '').split(';')[0];   // sealed, opaque

  // ── callback negative paths ────────────────────────────────────────
  const noCode = await get('/api/auth/callback?debug=1&state=abc', { cookie: txn });
  rec('callback without a code is rejected, not a 500',
    noCode.status === 400 && noCode.body && noCode.body.code === 'MISSING_CODE', noCode.status);

  const noState = await get('/api/auth/callback?debug=1&code=abc', { cookie: txn });
  rec('callback without state is rejected, not a 500',
    noState.status === 400 && noState.body && noState.body.code === 'MISSING_STATE', noState.status);

  const wrongState = await get('/api/auth/callback?debug=1&code=abc&state=not-the-state', { cookie: txn });
  rec('callback with a wrong state is rejected',
    wrongState.status === 400 && wrongState.body && wrongState.body.code === 'STATE_MISMATCH', wrongState.body && wrongState.body.code);

  const noTxn = await get('/api/auth/callback?debug=1&code=abc&state=abc');
  rec('callback with no transaction cookie is rejected',
    noTxn.status === 400 && noTxn.body && noTxn.body.code === 'NO_TRANSACTION', noTxn.body && noTxn.body.code);

  const tampered = await get('/api/auth/callback?debug=1&code=abc&state=abc',
    { cookie: txn.slice(0, -6) + 'AAAAAA' });
  rec('a tampered transaction cookie is rejected (AEAD)',
    tampered.status === 400 && tampered.body && ['NO_TRANSACTION', 'STATE_MISMATCH'].includes(tampered.body.code),
    tampered.body && tampered.body.code);

  const forged = await get('/api/auth/callback?debug=1&code=abc&state=abc', { cookie: 'ppr_txn=totally-made-up' });
  rec('a forged transaction cookie is rejected',
    forged.status === 400 && forged.body && forged.body.code === 'NO_TRANSACTION', forged.body && forged.body.code);

  const oauthErr = await get('/api/auth/callback?error=access_denied&state=abc', { cookie: txn });
  rec('an OAuth error response redirects cleanly, no 500',
    oauthErr.status === 302 && /signin=failed/.test(oauthErr.location || ''), oauthErr.status);

  // ── session and customer data without authentication ───────────────
  const sess = await get('/api/auth/session');
  rec('session is unauthenticated by default',
    sess.status === 200 && sess.body && sess.body.authenticated === false);
  rec('session exposes no token or identity',
    sess.body && !('access_token' in sess.body) && !('id_token' in sess.body) &&
    !('email' in sess.body) && !('sub' in sess.body));

  for (const p of ['/api/customer/whoami', '/api/customer/orders']) {
    const r = await get(p);
    rec(`${p} requires authentication`, r.status === 401 && r.body && r.body.code === 'NOT_AUTHENTICATED', r.status);
  }

  // ── cross-customer / arbitrary identifier attempts ─────────────────
  for (const probe of ['gid://shopify/Order/12602041500020', '1001', '#1002', '../../admin', '999999999']) {
    const r = await get(`/api/customer/orders?key=${encodeURIComponent(probe)}`);
    rec(`order key "${probe.slice(0, 26)}" cannot bypass the customer session`,
      r.status === 401, r.status);
  }
  const byCustomerId = await get('/api/customer/orders?customerId=1234567890');
  rec('a customerId parameter cannot widen scope', byCustomerId.status === 401, byCustomerId.status);

  // ── forged session cookie ──────────────────────────────────────────
  const forgedSess = await get('/api/auth/session', { cookie: 'ppr_sess=made-up-value' });
  rec('a forged session cookie does not authenticate',
    forgedSess.body && forgedSess.body.authenticated === false);
  const forgedApi = await get('/api/customer/whoami', { cookie: 'ppr_sess=made-up-value' });
  rec('a forged session cookie cannot reach customer data', forgedApi.status === 401);

  // ── logout ─────────────────────────────────────────────────────────
  const logoutGet = await get('/api/auth/logout');
  rec('logout is not reachable by GET', logoutGet.status === 405, logoutGet.status);
  const logoutPost = await fetch(BASE + '/api/auth/logout', { method: 'POST' });
  const lb = await logoutPost.json();
  rec('logout clears the session and reports unauthenticated',
    logoutPost.status === 200 && lb.authenticated === false);
  rec('logout clears both cookies',
    /ppr_sess=;/.test(logoutPost.headers.get('set-cookie') || '') &&
    /ppr_txn=;/.test(logoutPost.headers.get('set-cookie') || ''));

  // ── no credential material on public surfaces ──────────────────────
  for (const p of ['/', '/merchant.html', '/src/app.js', '/src/live.js', '/api/auth/session']) {
    const r = await fetch(BASE + p);
    const t = await r.text();
    rec(`no token or secret on ${p}`,
      !/shpat_|SESSION_SECRET|client_secret|code_verifier|"at"\s*:/i.test(t));
  }

  const passed = out.filter(o => o.pass).length;
  console.log(`\n${'='.repeat(56)}\nAUTH SECURITY: ${passed}/${out.length}\n${'='.repeat(56)}`);
  require('fs').mkdirSync('evidence/m4-customer-auth', { recursive: true });
  require('fs').writeFileSync('evidence/m4-customer-auth/security-tests.json',
    JSON.stringify({ ranAt: new Date().toISOString(), target: BASE, passed, total: out.length,
      note: 'No authorization code, access token, id token or PKCE verifier is recorded anywhere in this file.',
      tests: out }, null, 2));
  process.exit(passed === out.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
