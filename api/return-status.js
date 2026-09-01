const shopify = require('./_lib/shopify.js');
const { send, fail } = require('./_lib/http.js');

module.exports = async (req, res) => {
  if (!shopify.configured()) {
    return send(res, 503, { ok: false, code: 'NOT_CONFIGURED', error: 'Live commerce is not configured.' });
  }
  try {
    const name = String(req.query?.order || shopify.DEMO_ORDERS[0]);
    return send(res, 200, { ok: true, ...(await shopify.returnStatus(name)) });
  } catch (e) { return fail(res, e); }
};
