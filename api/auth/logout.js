const auth = require('../_lib/auth.js');
const { send, requirePost } = require('../_lib/http.js');

module.exports = async (req, res) => {
  if (!requirePost(req, res)) return;
  res.setHeader('Set-Cookie', [auth.clearCookie(auth.SESSION_COOKIE), auth.clearCookie(auth.TXN_COOKIE)]);
  let endSession = null;
  try { endSession = await auth.logoutRedirect(); } catch (e) { /* local clear is enough */ }
  return send(res, 200, { ok: true, authenticated: false, shopifyEndSessionEndpoint: endSession });
};
