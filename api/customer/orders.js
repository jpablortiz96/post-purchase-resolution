const customer = require('../_lib/customer.js');
const { send } = require('../_lib/http.js');
const STATUS = { NOT_AUTHENTICATED: 401, SESSION_EXPIRED: 401, ORDER_NOT_FOUND: 404, RATE_LIMITED: 429, UNREACHABLE: 504 };

module.exports = async (req, res) => {
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  try {
    // Only the authenticated customer's own orders. No parameter widens this.
    if (q.key) return send(res, 200, { ok: true, order: await customer.getOrder(req, q.key) });
    if (q.q || q.delivered_only || q.since_days) {
      return send(res, 200, { ok: true, ...(await customer.findOrders(req, {
        productQuery: q.q, deliveredOnly: q.delivered_only === 'true',
        sinceDays: q.since_days ? Number(q.since_days) : undefined,
      })) });
    }
    return send(res, 200, { ok: true, orders: await customer.listOrders(req) });
  } catch (e) {
    if (e instanceof customer.CustomerError) return send(res, STATUS[e.code] || 400, { ok: false, code: e.code, error: e.message });
    console.error('[api] orders:', e && e.message);
    return send(res, 500, { ok: false, code: 'UNEXPECTED', error: 'Something went wrong.' });
  }
};
