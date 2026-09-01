/**
 * Customer-initiated return request.
 *
 * The customer's own access token performs this, so the action carries the
 * authority of the person taking it. The merchant's Admin token is not involved
 * and cannot be: this route never touches it.
 */

const customer = require('../_lib/customer.js');
const { send, requirePost, readBody, noBodyParser } = require('../_lib/http.js');

const STATUS = {
  NOT_AUTHENTICATED: 401, SESSION_EXPIRED: 401, ORDER_NOT_FOUND: 404,
  RETURN_ALREADY_EXISTS: 409, NOT_RETURNABLE: 409, RETURN_REFUSED: 422,
  RATE_LIMITED: 429, UNREACHABLE: 504, HTTP_ERROR: 502, GRAPHQL_ERROR: 502,
};

const handler = async (req, res) => {
  if (!requirePost(req, res)) return;          // never reachable by GET
  const body = await readBody(req);

  const orderKey = body && body.orderKey;
  if (!orderKey || typeof orderKey !== 'string') {
    return send(res, 400, { ok: false, code: 'MISSING_ORDER', error: 'Which order is this return for?' });
  }
  // The note is the customer's own words. Bound it; never interpret it.
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : undefined;

  try {
    const created = await customer.requestReturn(req, { orderKey, note });
    const order = await customer.getOrder(req, orderKey);   // authoritative re-read
    return send(res, 200, { ok: true, return: created, order });
  } catch (e) {
    if (e instanceof customer.CustomerError) {
      return send(res, STATUS[e.code] || 400, {
        ok: false, code: e.code, error: e.message, detail: e.detail,
        return: e.return,                       // present on a duplicate
      });
    }
    console.error('[api] return-request:', e && e.message);
    return send(res, 500, { ok: false, code: 'UNEXPECTED', error: 'Something went wrong.' });
  }
};

module.exports = handler;
// Assigned after the handler: assigning before it is overwritten by the export.
module.exports.config = noBodyParser;
