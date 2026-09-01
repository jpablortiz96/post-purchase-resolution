const customer = require('../_lib/customer.js');
const { send } = require('../_lib/http.js');
// An upstream failure must not be reported as a client error: HTTP_ERROR and
// GRAPHQL_ERROR previously fell through to a default 400, which read as "bad
// request" when the request was fine and the commerce system had refused it.
const STATUS = { NOT_AUTHENTICATED: 401, SESSION_EXPIRED: 401, ORDER_NOT_FOUND: 404,
                 RATE_LIMITED: 429, UNREACHABLE: 504,
                 HTTP_ERROR: 502, GRAPHQL_ERROR: 502, EMPTY_RESPONSE: 502 };

/** Diagnosis without identity: categories only, never the raw response. */
const diagOf = e => (e.diag ? {
  upstreamHttpStatus: e.diag.upstreamHttpStatus,
  graphqlErrorCodes: e.diag.graphqlErrorCodes,
  errorCategory: e.diag.errorCategory,
} : undefined);

module.exports = async (req, res) => {
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  try {
    // Only the authenticated customer's own orders. No parameter widens this.
    if (q.key) return send(res, 200, { ok: true, order: await customer.getOrder(req, q.key) });
    if (q.q || q.delivered_only || q.returnable_only || q.since_days) {
      return send(res, 200, { ok: true, ...(await customer.findOrders(req, {
        productQuery: q.q,
        deliveredOnly: q.delivered_only === 'true',
        returnableOnly: q.returnable_only === 'true',
        sinceDays: q.since_days ? Number(q.since_days) : undefined,
      })) });
    }
    return send(res, 200, { ok: true, orders: await customer.listOrders(req) });
  } catch (e) {
    if (e instanceof customer.CustomerError) {
      return send(res, STATUS[e.code] || 400,
        { ok: false, code: e.code, error: e.message, diagnosis: diagOf(e) });
    }
    console.error('[api] orders:', e && e.message);
    return send(res, 500, { ok: false, code: 'UNEXPECTED', error: 'Something went wrong.' });
  }
};
