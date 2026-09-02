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
    //
    // The desk also needs to tell "no credential" apart from "credential
    // rejected", so the caller is told whether its OWN credential was accepted.
    // That reveals nothing new — the presence or absence of `queue` already
    // said as much — and it is what lets the page state the reason honestly.
    const authorized = shopify.merchantAuthorized(req);
    body.merchant = {
      credentialSupplied: Boolean(req.headers['x-merchant-token']),
      authorized,
    };
    if (authorized) {
      body.queue = await shopify.listPendingReturns({ req });
    }
    return send(res, 200, body);
  } catch (e) { return fail(res, e); }
};
