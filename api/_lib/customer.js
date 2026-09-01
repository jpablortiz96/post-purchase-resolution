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
  constructor(code, message, detail, diag) {
    super(message); this.code = code; this.detail = detail; this.diag = diag || null;
  }
}

/**
 * Classify an upstream failure into a category that is safe to publish.
 *
 * The categories exist so a failure can be diagnosed without exposing the raw
 * upstream response, which may carry identity.
 */
function classify(status, messages) {
  const m = messages.join(' | ').toLowerCase();

  // Message first, status second. Shopify reports an authorization failure on
  // a *field* as HTTP 200 with an errors array, so keying off status alone
  // buries the most likely cause under OTHER.
  if (m.includes('missing prefix shcat_')) return 'TOKEN_NOT_CUSTOMER_ACCOUNT_TOKEN';
  if (m.includes('missing authorization header')) return 'WRONG_AUTH_HEADER';
  if (/access denied|required access|access scope|missing scope|not approved|unauthorized field/.test(m)) {
    return 'MISSING_CUSTOMER_SCOPE';
  }
  if (/audience/.test(m)) return 'TOKEN_AUDIENCE';
  if (/cannot query field|doesn't exist|didn't exist|no such field|syntax error|invalid value|unknown argument/.test(m)) {
    return 'INVALID_GRAPHQL';
  }

  if (status === 401 || status === 403) return 'TOKEN_INVALID';
  if (status === 404) return 'WRONG_ENDPOINT';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 400) return 'INVALID_GRAPHQL';
  return 'OTHER';
}

/**
 * Upstream messages are Shopify's own schema/auth strings, not customer data.
 * They are still passed through a redactor, because a diagnostic surface is the
 * wrong place to discover an exception to that rule.
 */
function safeMessage(msg) {
  return String(msg)
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/gid:\/\/shopify\/\w+\/\d+/g, '[gid]')
    .replace(/shcat_[A-Za-z0-9._-]+/g, '[token]')
    .slice(0, 200);
}

/**
 * One Customer Account API call.
 *
 * The discovered `graphql_api` URL is used exactly as published — no version,
 * path or suffix is appended — and the token is sent bare. Shopify rejects a
 * `Bearer` prefix on this API, so adding one would break every call.
 */
async function gql(req, query, variables, { label } = {}) {
  const sess = auth.getSession(req);
  if (!sess) throw new CustomerError('NOT_AUTHENTICATED', 'Please sign in to view your orders.');

  const d = await auth.discover();
  let res, text;
  try {
    res = await fetch(d.graphqlApi, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: sess.at },
      body: JSON.stringify({ query, variables }),
    });
    text = await res.text();
  } catch (e) {
    throw new CustomerError('UNREACHABLE', 'Could not reach the commerce system.', undefined,
      { label, errorCategory: 'UNREACHABLE' });
  }

  let body = null;
  try { body = JSON.parse(text); } catch (e) { /* non-JSON upstream */ }

  const errors = (body && body.errors) || [];
  const messages = errors.map(e => e && e.message).filter(Boolean);
  const graphqlErrorCodes = errors
    .map(e => (e && e.extensions && (e.extensions.code || e.extensions.problems)) || null)
    .filter(Boolean)
    .map(c => (typeof c === 'string' ? c : 'DETAIL'));

  // Kept for server-side diagnosis; only the sanitized view is ever published.
  const diag = {
    label: label || null,
    upstreamHttpStatus: res.status,
    graphqlErrorCodes,
    errorCategory: res.ok && !errors.length ? 'OK' : classify(res.status, messages),
    upstreamMessages: messages.map(safeMessage),
  };

  if (res.status === 401 || res.status === 403) {
    throw new CustomerError('SESSION_EXPIRED',
      'Your session has expired. Please sign in again.', undefined, diag);
  }
  if (res.status === 429) throw new CustomerError('RATE_LIMITED', 'Too many requests. Try again shortly.', undefined, diag);
  if (!res.ok) throw new CustomerError('HTTP_ERROR', `The commerce system returned ${res.status}.`, undefined, diag);
  if (errors.length) {
    throw new CustomerError('GRAPHQL_ERROR', 'That request could not be completed.',
      diag.upstreamMessages, diag);
  }
  if (!body || !body.data) throw new CustomerError('EMPTY_RESPONSE', 'The commerce system returned no data.', undefined, diag);

  return body.data;
}

/**
 * Run a query purely to observe how it fails. Never throws: the caller wants
 * the diagnosis, not an exception.
 */
async function probe(req, query, variables, label) {
  try {
    const data = await gql(req, query, variables, { label });
    return { label, ok: true, upstreamHttpStatus: 200, errorCategory: 'OK', data };
  } catch (e) {
    return {
      label, ok: false, code: e.code,
      upstreamHttpStatus: e.diag ? e.diag.upstreamHttpStatus : null,
      graphqlErrorCodes: e.diag ? e.diag.graphqlErrorCodes : [],
      errorCategory: e.diag ? e.diag.errorCategory : e.code,
      upstreamMessages: e.diag ? e.diag.upstreamMessages : [],
    };
  }
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

module.exports = { whoami, listOrders, getOrder, findOrders, CustomerError, gql, probe, classify };
