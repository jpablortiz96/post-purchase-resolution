const shopify = require('./_lib/shopify.js');
const { send, fail, requirePost, readBody, noBodyParser } = require('./_lib/http.js');

module.exports = async (req, res) => {
  if (!requirePost(req, res)) return;
  if (!shopify.configured()) {
    return send(res, 503, { ok: false, code: 'NOT_CONFIGURED', error: 'Live commerce is not configured.' });
  }
  try {
    const b = await readBody(req);
    const out = await shopify.requestReturn({
      reason: 'DEFECTIVE',
      customerNote: typeof b.note === 'string' ? b.note.slice(0, 300) : undefined,
    });
    return send(res, 200, { ok: true, ...out });
  } catch (e) { return fail(res, e); }
};

// Parse the body ourselves so malformed input is a 400, not a 500.
// Must be assigned AFTER the handler, or the handler assignment clears it.
module.exports.config = noBodyParser;
