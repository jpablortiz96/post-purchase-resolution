const shopify = require('./_lib/shopify.js');
const { send, fail, requirePost, body } = require('./_lib/http.js');

module.exports = async (req, res) => {
  if (!requirePost(req, res)) return;
  if (!shopify.configured()) {
    return send(res, 503, { ok: false, code: 'NOT_CONFIGURED', error: 'Live commerce is not configured.' });
  }
  try {
    const b = body(req);
    const out = await shopify.approveReturn({ orderName: String(b.order || shopify.DEMO_ORDERS[0]) });
    return send(res, 200, { ok: true, ...out });
  } catch (e) { return fail(res, e); }
};
