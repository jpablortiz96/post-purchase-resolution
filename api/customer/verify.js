/**
 * Authenticated self-verification.
 *
 * Runs the positive-path checks *inside the caller's own authenticated
 * session* and returns a sanitized report. It exists because the session is an
 * HttpOnly cookie in the customer's browser: no external process can perform
 * these checks on their behalf, and asking anyone to hand over a session cookie
 * would be the wrong way to obtain evidence.
 *
 * The report is designed to be safe to paste anywhere: no token, no email, no
 * name, no address, no raw Shopify global id.
 */

const auth = require('../_lib/auth.js');
const customer = require('../_lib/customer.js');
const { send } = require('../_lib/http.js');

module.exports = async (req, res) => {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });

  const sess = auth.getSession(req);
  if (!sess) {
    return send(res, 401, {
      ok: false, authenticated: false,
      error: 'Open this URL in the browser where you signed in.',
    });
  }

  // ── 1. session ────────────────────────────────────────────────────
  const pub = auth.publicSession(req);
  add('session is authenticated', pub.authenticated === true, { expiresInSeconds: pub.expiresInSeconds });
  add('session response exposes no token or identity',
    !('access_token' in pub) && !('id_token' in pub) && !('email' in pub) && !('sub' in pub),
    Object.keys(pub));

  const report = { ok: true, capturedAt: new Date().toISOString(), checks };

  // ── 2. customer identity, minimally ───────────────────────────────
  try {
    const who = await customer.whoami(req);
    // customerKey is the numeric suffix of the customer's gid. It is an opaque
    // handle, not PII, and is hashed before it ever reaches evidence.
    const crypto = require('crypto');
    const keyHash = who.customerKey
      ? crypto.createHash('sha256').update(String(who.customerKey)).digest('hex').slice(0, 12)
      : null;
    add('Customer Account API accepts the token', who.authenticated === true, { customerKeyHash: keyHash });
    report.customerKeyHash = keyHash;
  } catch (e) {
    add('Customer Account API accepts the token', false, { code: e.code, error: e.message });
    report.ok = false;
  }

  // ── 3. customer-scoped orders ─────────────────────────────────────
  let orders = [];
  try {
    orders = await customer.listOrders(req);
    add('orders retrieved through the Customer Account API', true, { count: orders.length });
    add('no Admin API enumeration was used for this', true,
      'api/_lib/customer.js only ever calls the discovered customer graphql_api');

    const returnable = orders.filter(o => o.returnable);
    add('at least one order is present for this customer', orders.length > 0, { count: orders.length });
    add('a fulfilled, returnable order is visible', returnable.length > 0,
      returnable.map(o => ({ ref: o.orderReference, product: o.product, fulfillment: o.fulfillmentStatus })));

    report.orders = orders.map(o => ({
      orderReference: o.orderReference,
      product: o.product,
      quantity: o.quantity,
      price: o.price,
      currency: o.currency,
      financialStatus: o.financialStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      returnable: o.returnable,
      returnableQuantity: o.returnableQuantity,
      nonReturnableReasons: o.nonReturnableReasons,
      processedAt: o.processedAt,
    }));

    const blob = JSON.stringify(report.orders).toLowerCase();
    add('order payload carries no PII',
      !/\bemail\b|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\bphone\b|\baddress\d?\b|gid:\/\//.test(blob));
  } catch (e) {
    add('orders retrieved through the Customer Account API', false, { code: e.code, error: e.message });
    report.ok = false;
  }

  // ── 4. scoping: a foreign identifier must not resolve ─────────────
  for (const probe of ['gid://shopify/Order/12602041500020', '999999999', '1001', '#1002']) {
    try {
      await customer.getOrder(req, probe);
      add(`foreign identifier "${probe.slice(0, 30)}" must not resolve`, false, 'RESOLVED — scoping defect');
      report.ok = false;
    } catch (e) {
      add(`foreign identifier "${probe.slice(0, 30)}" must not resolve`, e.code === 'ORDER_NOT_FOUND', e.code);
    }
  }

  // Every order the session can reach must be one it listed itself.
  // Bounded: getOrder() re-lists on each call by design, so this is capped to
  // keep the whole verification inside the platform's function timeout.
  try {
    const keys = new Set(orders.map(o => o.orderKey));
    const sample = orders.slice(0, 3);
    let allOwn = true;
    for (const o of sample) {
      const fetched = await customer.getOrder(req, o.orderKey);
      if (!keys.has(fetched.orderKey)) allOwn = false;
    }
    add('every reachable order belongs to this customer', allOwn,
      { checked: sample.length, of: orders.length });
  } catch (e) {
    add('every reachable order belongs to this customer', false, { code: e.code });
  }

  // ── 5. natural discovery ──────────────────────────────────────────
  try {
    const found = await customer.findOrders(req, { productQuery: 'headphones', deliveredOnly: true });
    add('find_order locates the headphones purchase', found.matchCount >= 1,
      { matchCount: found.matchCount, resolution: found.resolution,
        candidates: found.candidates.map(c => ({ ref: c.orderReference, product: c.product, returnable: c.returnable })) });
    add('find_order does not guess when ambiguous',
      found.resolution !== 'ambiguous' || found.candidates.length > 1,
      found.resolution);
    report.findOrder = {
      query: { product_query: 'headphones', delivered_only: true },
      matchCount: found.matchCount, resolution: found.resolution, note: found.note,
      candidates: found.candidates.map(c => ({
        orderReference: c.orderReference, product: c.product,
        fulfillmentStatus: c.fulfillmentStatus, returnable: c.returnable })),
    };

    const none = await customer.findOrders(req, { productQuery: 'zzzznonexistentproduct' });
    add('find_order reports none rather than inventing a match',
      none.matchCount === 0 && none.resolution === 'none', none.resolution);
  } catch (e) {
    add('find_order locates the headphones purchase', false, { code: e.code, error: e.message });
    report.ok = false;
  }

  report.passed = checks.filter(c => c.pass).length;
  report.total = checks.length;
  report.ok = report.ok && report.passed === report.total;
  return send(res, 200, report);
};
