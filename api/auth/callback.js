const auth = require('../_lib/auth.js');
const { send } = require('../_lib/http.js');

/** Redirect back to the product with a short, non-sensitive status only. */
function back(res, cookies, status) {
  if (cookies && cookies.length) res.setHeader('Set-Cookie', cookies);
  res.setHeader('cache-control', 'no-store');
  res.statusCode = 302;
  res.setHeader('Location', '/?signin=' + encodeURIComponent(status));
  res.end();
}

module.exports = async (req, res) => {
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);

  // Shopify can return an OAuth error instead of a code.
  if (q.error) return back(res, [auth.clearCookie(auth.TXN_COOKIE)], 'failed');

  try {
    const { cookies } = await auth.exchangeCode({ code: q.code, state: q.state, req });
    return back(res, cookies, 'ok');
  } catch (e) {
    const code = e instanceof auth.AuthError ? e.code : 'UNEXPECTED';
    // Expected invalid input must never be a 500. Anything that failed
    // verification clears the one-time transaction.
    const expected = ['MISSING_CODE', 'MISSING_STATE', 'NO_TRANSACTION',
      'TRANSACTION_EXPIRED', 'STATE_MISMATCH', 'NONCE_MISMATCH',
      'ISSUER_MISMATCH', 'AUDIENCE_MISMATCH', 'TOKEN_EXCHANGE_FAILED'];
    if (expected.includes(code)) {
      if (String(q.debug) === '1') {
        res.setHeader('Set-Cookie', [auth.clearCookie(auth.TXN_COOKIE)]);
        return send(res, 400, { ok: false, code, error: e.message });
      }
      return back(res, [auth.clearCookie(auth.TXN_COOKIE)], 'failed');
    }
    return send(res, 502, { ok: false, code, error: 'Could not complete sign-in.' });
  }
};
