/** Shared response helpers. Never leaks secrets or stack traces to the client. */
const { ShopifyError } = require('./shopify.js');

function send(res, code, body) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.statusCode = code;
  res.end(JSON.stringify(body));
}

function fail(res, e) {
  if (e instanceof ShopifyError) {
    const status = { NOT_A_DEMO_ORDER: 403, ORDER_NOT_FOUND: 404, NOT_RETURNABLE: 409,
                     NOT_REQUESTED: 409, RATE_LIMITED: 429, AUTH_FAILED: 502,
                     UNREACHABLE: 504 }[e.code] || 400;
    return send(res, status, { ok: false, code: e.code, error: e.message, detail: e.detail });
  }
  // Unexpected: log server-side only, return something a customer can read.
  console.error('[api] unexpected error:', e && e.message);
  return send(res, 500, { ok: false, code: 'UNEXPECTED', error: 'Something went wrong talking to the commerce system.' });
}

/** Mutations must never be reachable by GET. */
function requirePost(req, res) {
  if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'Use POST.' }); return false; }
  return true;
}

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

module.exports = { send, fail, requirePost, body };
