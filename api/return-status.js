const shopify = require('./_lib/shopify.js');
const { send, fail } = require('./_lib/http.js');

module.exports = async (req, res) => {
  if (!shopify.configured()) {
    return send(res, 503, { ok: false, code: 'NOT_CONFIGURED', error: 'Live commerce is not configured.' });
  }
  try {
    const body = { ok: true, ...(await shopify.returnStatus()) };

    // The store-wide queue is merchant-only data, so it is attached only for a
    // caller holding merchant authority. Anonymous callers get exactly what
    // they got before: the configured order's own return state.
    if (shopify.merchantAuthorized(req)) {
      body.queue = await shopify.listPendingReturns({ req });
    }
    return send(res, 200, body);
  } catch (e) { return fail(res, e); }
};
