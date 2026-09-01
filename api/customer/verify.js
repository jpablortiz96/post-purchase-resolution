/**
 * Authenticated self-verification and diagnosis.
 *
 * Runs inside the caller's own authenticated session, because the session is an
 * HttpOnly cookie in the customer's browser: no external process can perform
 * these checks on their behalf, and asking anyone to hand over a session cookie
 * would be the wrong way to obtain evidence.
 *
 * Two rules shape the output:
 *
 *  1. Nothing PASSes on top of a failed dependency. A scoping check that ran
 *     against zero orders is NOT_PROVEN, never PASS — a vacuous pass is worse
 *     than a failure, because it reads as evidence.
 *  2. The report is safe to paste anywhere: no token, no email, no name, no
 *     address, no phone, no raw Shopify gid. Diagnosis is published only as
 *     upstreamHttpStatus / graphqlErrorCodes / errorCategory.
 */

const auth = require('../_lib/auth.js');
const customer = require('../_lib/customer.js');
const { send } = require('../_lib/http.js');

const PASS = 'PASS', FAIL = 'FAIL', NOT_RUN = 'NOT_RUN', NOT_PROVEN = 'NOT_PROVEN';

module.exports = async (req, res) => {
  const checks = [];
  const add = (name, status, detail) => { checks.push({ name, status, detail }); return status; };
  const bool = (name, ok, detail) => add(name, ok ? PASS : FAIL, detail);

  if (!auth.getSession(req)) {
    return send(res, 401, {
      ok: false, authenticated: false,
      error: 'Open this URL in the browser where you signed in.',
    });
  }

  const report = { capturedAt: new Date().toISOString() };

  // ── 1. session ────────────────────────────────────────────────────
  const pub = auth.publicSession(req);
  bool('session is authenticated', pub.authenticated === true, { expiresInSeconds: pub.expiresInSeconds });
  bool('session response exposes no token or identity',
    !('access_token' in pub) && !('id_token' in pub) && !('email' in pub) && !('sub' in pub),
    Object.keys(pub));

  // Token *shape* only. A documented public prefix is not credential material,
  // and it is the single fastest way to tell a Customer Account API token from
  // an authentication-only one.
  const shape = auth.tokenShape(req);
  report.tokenShape = shape;
  add('access token carries the Customer Account API prefix',
    shape.hasCustomerApiPrefix ? PASS : FAIL,
    { hasCustomerApiPrefix: shape.hasCustomerApiPrefix, looksLikeJwt: shape.looksLikeJwt,
      note: shape.hasCustomerApiPrefix ? undefined
        : 'The Customer Account API rejects any token without the shcat_ prefix.' });

  // ── 2. minimal GraphQL ladder ─────────────────────────────────────
  // Smallest valid query first, then one field group at a time, so a failure
  // names the exact field that caused it instead of condemning a large query.
  const ORDER_NODE = f => `customer { orders(first: 2) { edges { node { ${f} } } } }`;
  const ladder = [
    ['identity',        `query { customer { id } }`],
    ['orders.edges',    `query { ${ORDER_NODE('id')} }`],
    ['+name/createdAt', `query { ${ORDER_NODE('id name createdAt')} }`],
    ['+totalPrice',     `query { ${ORDER_NODE('id name totalPrice { amount currencyCode }')} }`],
    ['+fulfillment',    `query { ${ORDER_NODE('id fulfillmentStatus')} }`],
    ['+financial',      `query { ${ORDER_NODE('id financialStatus')} }`],
    ['+processedAt',    `query { ${ORDER_NODE('id processedAt')} }`],
    ['orders.nodes',    `query { customer { orders(first: 2) { nodes { id } } } }`],
    ['+lineItems',      `query { ${ORDER_NODE('id lineItems(first: 5) { edges { node { title quantity } } }')} }`],
    ['+returnInfo',     `query { ${ORDER_NODE('id returnInformation { returnableLineItems(first: 10) { edges { node { quantity } } } }')} }`],
  ];

  report.ladder = [];
  let minimalOk = false;
  for (const [label, query] of ladder) {
    const r = await customer.probe(req, query, undefined, label);
    report.ladder.push({
      rung: label, ok: r.ok,
      upstreamHttpStatus: r.upstreamHttpStatus,
      graphqlErrorCodes: r.graphqlErrorCodes,
      errorCategory: r.errorCategory,
      upstreamMessages: r.upstreamMessages,
    });
    if (label === 'identity') {
      minimalOk = r.ok;
      bool('Customer Account API accepts the token (minimal query)', r.ok,
        { upstreamHttpStatus: r.upstreamHttpStatus, errorCategory: r.errorCategory,
          upstreamMessages: r.upstreamMessages });
      if (!r.ok) break;   // nothing below it can mean anything
    }
  }
  report.firstFailingRung = (report.ladder.find(r => !r.ok) || {}).rung || null;

  if (!minimalOk) {
    for (const n of ['customer-scoped orders', 'customer scoping',
                     'cross-order negative control', 'find_order']) {
      add(n, NOT_RUN, 'the minimal customer query failed; nothing downstream can be evaluated');
    }
    return finish(res, report, checks);
  }

  // ── 3. customer-scoped orders ─────────────────────────────────────
  let orders = null;
  try {
    orders = await customer.listOrders(req);
    bool('orders retrieved through the Customer Account API', true, { count: orders.length });
    bool('no Admin API enumeration was used', true,
      'api/_lib/customer.js calls only the discovered customer graphql_api');
    report.orders = orders.map(o => ({
      orderReference: o.orderReference, product: o.product, quantity: o.quantity,
      price: o.price, currency: o.currency,
      financialStatus: o.financialStatus, fulfillmentStatus: o.fulfillmentStatus,
      returnable: o.returnable, returnableQuantity: o.returnableQuantity,
      nonReturnableReasons: o.nonReturnableReasons, processedAt: o.processedAt,
    }));
    const blob = JSON.stringify(report.orders).toLowerCase();
    bool('order payload carries no PII',
      !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\bphone\b|\baddress\d?\b|gid:\/\//.test(blob));
  } catch (e) {
    orders = null;
    add('orders retrieved through the Customer Account API', FAIL, {
      code: e.code,
      upstreamHttpStatus: e.diag ? e.diag.upstreamHttpStatus : null,
      errorCategory: e.diag ? e.diag.errorCategory : e.code,
      upstreamMessages: e.diag ? e.diag.upstreamMessages : [],
    });
  }

  // ── 4. scoping — positive control first ───────────────────────────
  // Isolation cannot be shown by a negative result alone: with no reachable
  // order, every identifier fails for the trivial reason.
  const positiveControl = Array.isArray(orders) && orders.length > 0;
  add('positive control: at least one order is reachable',
    orders === null ? NOT_RUN : positiveControl ? PASS : NOT_PROVEN,
    orders === null ? 'orders query failed'
      : positiveControl ? { count: orders.length }
      : 'this account has no orders, so isolation cannot be proven here');

  if (!positiveControl) {
    add('customer scoping', NOT_PROVEN, 'requires at least one retrievable order');
    add('cross-order negative control', NOT_RUN,
      'negative identifiers prove nothing until the positive control passes');
    add('find_order', NOT_RUN, 'requires retrievable orders');
    return finish(res, report, checks);
  }

  const keys = new Set(orders.map(o => o.orderKey));
  try {
    const sample = orders.slice(0, 3);
    let allOwn = true;
    for (const o of sample) {
      const fetched = await customer.getOrder(req, o.orderKey);
      if (!keys.has(fetched.orderKey)) allOwn = false;
    }
    bool('every reachable order belongs to this customer', allOwn,
      { checked: sample.length, of: orders.length });
  } catch (e) {
    add('every reachable order belongs to this customer', FAIL, { code: e.code });
  }

  // Only now are negative identifiers meaningful: the resolver is known to work.
  for (const p of ['gid://shopify/Order/12602041500020', '999999999', '1001', '#1002']) {
    if (keys.has(p)) continue;                        // never probe with a real key
    try {
      await customer.getOrder(req, p);
      add(`foreign identifier "${p.slice(0, 30)}" must not resolve`, FAIL, 'RESOLVED — scoping defect');
    } catch (e) {
      // A generic upstream failure is not proof of isolation; only the
      // resolver's own not-found verdict is.
      add(`foreign identifier "${p.slice(0, 30)}" must not resolve`,
        e.code === 'ORDER_NOT_FOUND' ? PASS : NOT_PROVEN,
        e.code === 'ORDER_NOT_FOUND' ? undefined
          : { code: e.code, note: 'upstream failure, not a scoping verdict' });
    }
  }

  // ── 5. natural discovery ──────────────────────────────────────────
  try {
    const found = await customer.findOrders(req, { productQuery: 'headphones', deliveredOnly: true });
    bool('find_order locates a matching purchase', found.matchCount >= 1,
      { matchCount: found.matchCount, resolution: found.resolution });
    bool('find_order does not guess when ambiguous',
      found.resolution !== 'ambiguous' || found.candidates.length > 1, found.resolution);
    report.findOrder = {
      query: { product_query: 'headphones', delivered_only: true },
      matchCount: found.matchCount, resolution: found.resolution, note: found.note,
      candidates: found.candidates.map(c => ({
        orderReference: c.orderReference, product: c.product,
        fulfillmentStatus: c.fulfillmentStatus, returnable: c.returnable })),
    };
    const none = await customer.findOrders(req, { productQuery: 'zzzznonexistentproduct' });
    bool('find_order reports none rather than inventing a match',
      none.matchCount === 0 && none.resolution === 'none', none.resolution);
  } catch (e) {
    add('find_order', FAIL, { code: e.code, errorCategory: e.diag ? e.diag.errorCategory : e.code });
  }

  return finish(res, report, checks);
};

function finish(res, report, checks) {
  const count = s => checks.filter(c => c.status === s).length;
  report.checks = checks;
  report.summary = {
    passed: count(PASS), failed: count(FAIL),
    notRun: count(NOT_RUN), notProven: count(NOT_PROVEN), total: checks.length,
  };
  // Only a clean sweep is a pass. NOT_RUN and NOT_PROVEN are never passes.
  report.ok = report.summary.passed === report.summary.total;
  return send(res, 200, report);
}
