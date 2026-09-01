const customer = require('../_lib/customer.js');
const { send } = require('../_lib/http.js');
const STATUS = { NOT_AUTHENTICATED: 401, SESSION_EXPIRED: 401, ORDER_NOT_FOUND: 404, RATE_LIMITED: 429, UNREACHABLE: 504 };

module.exports = async (req, res) => {
  try { return send(res, 200, { ok: true, ...(await customer.whoami(req)) }); }
  catch (e) {
    if (e instanceof customer.CustomerError) return send(res, STATUS[e.code] || 400, { ok: false, code: e.code, error: e.message });
    console.error('[api] whoami:', e && e.message);
    return send(res, 500, { ok: false, code: 'UNEXPECTED', error: 'Something went wrong.' });
  }
};
