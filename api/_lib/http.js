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
    const status = { ORDER_NOT_ACCESSIBLE: 403, MERCHANT_UNAUTHORIZED: 401,
                     MUTATIONS_DISABLED: 503, ORDER_NOT_FOUND: 404, NOT_RETURNABLE: 409,
                     NOT_REQUESTED: 409, RATE_LIMITED: 429, AUTH_FAILED: 502,
                     UNREACHABLE: 504 }[e.code] || 400;
    return send(res, status, { ok: false, code: e.code, error: e.message, detail: e.detail });
  }
  // Unexpected: log server-side only, return something a customer can read.
  console.error('[api] unexpected error:', e && e.message);
  return send(res, 500, { ok: false, code: 'UNEXPECTED', error: 'Something went wrong handling that request.' });
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

/**
 * Read and parse the body ourselves.
 *
 * The platform's automatic JSON parser throws on malformed input before the
 * handler runs, which surfaced as a 500. Malformed input from an anonymous
 * caller should be a 400, so bodyParser is disabled on the mutation routes and
 * parsing happens here, where a failure is just an empty object.
 */
async function readBody(req) {
  // Even *reading* req.body can throw: on some platforms it is a lazy getter
  // that parses on access and rejects malformed JSON. A body we cannot read is
  // an empty body, never a server error.
  let pre;
  try { pre = req.body; } catch (e) { pre = undefined; }
  if (pre && typeof pre === 'object') return pre;
  if (typeof pre === 'string') {
    try { return JSON.parse(pre || '{}'); } catch (e) { return {}; }
  }
  // Reading the stream can itself fail (already consumed, aborted, disabled
  // parser unavailable). A body we cannot read is simply an empty body — it is
  // never a server error.
  try {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 16 * 1024) break;
      chunks.push(c);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch (e) {
    return {};
  }
}

/** Disables the platform body parser for a route. */
const noBodyParser = { api: { bodyParser: false } };

module.exports = { send, fail, requirePost, body, readBody, noBodyParser };
