const auth = require('../_lib/auth.js');
const { send, requirePost } = require('../_lib/http.js');

module.exports = async (req, res) => {
  if (!requirePost(req, res)) return;

  // Build the issuer logout URL *before* clearing, since it needs the id_token
  // hint that is about to be dropped.
  let redirectUrl = null;
  try { redirectUrl = await auth.buildLogoutUrl(req); } catch (e) { /* local clear still applies */ }

  res.setHeader('Set-Cookie', [
    auth.clearCookie(auth.SESSION_COOKIE),
    auth.clearCookie(auth.TXN_COOKIE),
    auth.clearCookie(auth.IDT_COOKIE),
  ]);

  return send(res, 200, {
    ok: true,
    authenticated: false,
    // The caller should follow this so the session ends at Shopify too. Without
    // it the customer stays signed in at the issuer and the next authorization
    // silently reuses the existing grant — which also means new app scopes are
    // never re-consented.
    redirectUrl,
    endsShopifySession: Boolean(redirectUrl),
  });
};
