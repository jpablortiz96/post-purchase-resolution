const shopify = require('./_lib/shopify.js');
const { send, fail, requirePost, readBody, noBodyParser } = require('./_lib/http.js');

module.exports = async (req, res) => {
  if (!requirePost(req, res)) return;
  if (!shopify.configured()) {
    return send(res, 503, { ok: false, code: 'NOT_CONFIGURED', error: 'Live commerce is not configured.' });
  }
  try {
    // Merchant authority: the adapter refuses without an operator token.
    // A returnId names one specific return in the queue; without one this
    // falls back to the configured order, which is what the signed-out
    // preview and the M4.2 regression path use.
    const body = await readBody(req);
    const returnId = body && body.returnId;
    const out = returnId
      ? await shopify.approveReturnById({ req, returnId: String(returnId) })
      : await shopify.approveReturn({ req });
    return send(res, 200, { ok: true, ...out });
  } catch (e) { return fail(res, e); }
};

// Parse the body ourselves so malformed input is a 400, not a 500.
// Must be assigned AFTER the handler, or the handler assignment clears it.
module.exports.config = noBodyParser;
