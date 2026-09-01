/**
 * Customer Account API client.
 *
 * Every query here runs under the *customer's own* token, so scoping is
 * enforced by Shopify rather than by us filtering an admin result set. There is
 * no code path that accepts a customer id, an order GID or an order number and
 * uses it to widen access: the token defines the universe.
 */

const auth = require('./auth.js');

class CustomerError extends Error {
  constructor(code, message, detail) { super(message); this.code = code; this.detail = detail; }
}

async function gql(req, query, variables) {
  const sess = auth.getSession(req);
  if (!sess) throw new CustomerError('NOT_AUTHENTICATED', 'Please sign in to view your orders.');

  const d = await auth.discover();
  let res;
  try {
    res = await fetch(d.graphqlApi, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: sess.at },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new CustomerError('UNREACHABLE', 'Could not reach the commerce system.');
  }

  if (res.status === 401 || res.status === 403) {
    throw new CustomerError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }
  if (res.status === 429) throw new CustomerError('RATE_LIMITED', 'Too many requests. Try again shortly.');
  if (!res.ok) throw new CustomerError('HTTP_ERROR', `The commerce system returned ${res.status}.`);

  const body = await res.json();
  if (body.errors) {
    throw new CustomerError('GRAPHQL_ERROR', 'That request could not be completed.',
      body.errors.map(e => e.message));
  }
  return body.data;
}

// ── sanitisers: allowlist only ───────────────────────────────────────

const shortId = gid => String(gid || '').split('/').pop() || null;

function sanitizeOrder(o) {
  const line = (o.lineItems?.nodes || [])[0] || null;
  const total = o.totalPrice || {};
  const ret = o.returnInformation || {};
  const returnable = (ret.returnableLineItems?.nodes || []);
  const nonReturnable = (ret.nonReturnableLineItems?.nodes || []);
  return {
    source: 'shopify-customer-account',
    orderReference: o.name,
    orderKey: shortId(o.id),              // opaque handle, scoped to this session
    processedAt: o.processedAt,
    product: line ? line.title : null,
    quantity: line ? line.quantity : null,
    price: total.amount ? Number(total.amount) : null,
    currency: total.currencyCode || null,
    financialStatus: o.financialStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    returnable: returnable.length > 0,
    returnableQuantity: returnable.reduce((n, r) => n + (r.quantity || 0), 0),
    nonReturnableReasons: nonReturnable
      .map(n => n.unreturnableReason || n.reason)
      .filter(Boolean),
    // no email, no name, no address, no phone, no raw gid
  };
}

// ── queries ──────────────────────────────────────────────────────────

/** Smallest possible authenticated query: proves the token belongs to someone. */
async function whoami(req) {
  const d = await gql(req, `query { customer { id } }`);
  return { authenticated: true, customerKey: shortId(d.customer?.id) };
}

const ORDER_FIELDS = `
  id name processedAt financialStatus fulfillmentStatus
  totalPrice { amount currencyCode }
  lineItems(first: 5) { nodes { title quantity } }
`;

const RETURN_FIELDS = `
  returnInformation {
    returnableLineItems(first: 10) { nodes { quantity } }
    nonReturnableLineItems(first: 10) { nodes { unreturnableReason } }
  }
`;

/** The authenticated customer's own orders. No parameter widens this. */
async function listOrders(req, { first = 25 } = {}) {
  const d = await gql(req, `query($first: Int!) {
    customer { orders(first: $first, sortKey: PROCESSED_AT, reverse: true) {
      nodes { ${ORDER_FIELDS} ${RETURN_FIELDS} } } }
  }`, { first: Math.min(Math.max(1, first), 50) });
  return (d.customer?.orders?.nodes || []).map(sanitizeOrder);
}

/**
 * One order, BY SESSION-SCOPED KEY.
 *
 * The key is matched against the customer's own order list rather than being
 * passed to Shopify as an identifier, so a forged or borrowed key simply does
 * not resolve. There is no way to reach another customer's order.
 */
async function getOrder(req, orderKey) {
  const orders = await listOrders(req, { first: 50 });
  const found = orders.find(o => o.orderKey === String(orderKey));
  if (!found) throw new CustomerError('ORDER_NOT_FOUND', 'That order is not in your account.');
  return found;
}

/**
 * Natural discovery over the customer's own purchases.
 * Never silently picks between plausible matches.
 */
async function findOrders(req, { productQuery, deliveredOnly = false, sinceDays } = {}) {
  let orders = await listOrders(req, { first: 50 });

  if (productQuery) {
    const terms = String(productQuery).toLowerCase().split(/\s+/).filter(t => t.length > 2);
    orders = orders.filter(o => {
      const hay = String(o.product || '').toLowerCase();
      return terms.length ? terms.some(t => hay.includes(t)) : true;
    });
  }
  if (deliveredOnly) {
    orders = orders.filter(o => String(o.fulfillmentStatus || '').toUpperCase().includes('FULFILLED')
      || String(o.fulfillmentStatus || '').toUpperCase() === 'DELIVERED');
  }
  if (sinceDays) {
    const cutoff = Date.now() - Number(sinceDays) * 86400000;
    orders = orders.filter(o => o.processedAt && Date.parse(o.processedAt) >= cutoff);
  }

  return {
    matchCount: orders.length,
    // The caller must disambiguate. We never return "the best guess".
    resolution: orders.length === 0 ? 'none'
      : orders.length === 1 ? 'single'
      : 'ambiguous',
    candidates: orders.slice(0, 10),
    note: orders.length > 1
      ? 'More than one purchase matches. Ask the customer which one they mean; do not choose for them.'
      : orders.length === 1 ? 'Exactly one purchase matches.'
      : 'No purchase in this account matches.',
  };
}

module.exports = { whoami, listOrders, getOrder, findOrders, CustomerError, gql };
