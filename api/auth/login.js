const auth = require('../_lib/auth.js');
const { send } = require('../_lib/http.js');

module.exports = async (req, res) => {
  try {
    const { url, txnCookie } = await auth.buildAuthorizationUrl();
    res.setHeader('Set-Cookie', txnCookie);
    res.setHeader('cache-control', 'no-store');
    res.statusCode = 302;
    res.setHeader('Location', url);
    res.end();
  } catch (e) {
    const code = e instanceof auth.AuthError ? e.code : 'UNEXPECTED';
    return send(res, code === 'NO_SESSION_SECRET' ? 503 : 502,
      { ok: false, code, error: e.message || 'Could not start sign-in.' });
  }
};
