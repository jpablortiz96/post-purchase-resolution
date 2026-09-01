/**
 * The merchant's return queue, across the whole store.
 *
 * Store-wide return data is merchant-only: the adapter refuses without an
 * operator token, so this is not part of the anonymous surface.
 */
const shopify = require('./_lib/shopify.js');
const { send, fail } = require('./_lib/http.js');

module.exports = async (req, res) => {
  if (!shopify.configured()) {
    return send(res, 503, { ok: false, code: 'NOT_CONFIGURED', error: 'Live commerce is not configured.' });
  }
  try {
    return send(res, 200, { ok: true, returns: await shopify.listPendingReturns({ req }) });
  } catch (e) { return fail(res, e); }
};
