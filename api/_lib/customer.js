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
  constructor(code, message, detail, diag, extra) {
    super(message); this.code = code; this.detail = detail; this.diag = diag || null;
    if (extra) Object.assign(this, extra);
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
  const returnable = ret.returnableLineItems?.nodes || [];
  const nonReturnable = ret.nonReturnableLineItems?.nodes || [];

  // Every level here is optional: an order with nothing to return may omit
  // returnInformation, the summary, or both. Absence must read as "no reasons",
  // never as a crash.
  const returns = o.returns?.nodes || [];
  const activeReturn = returns.find(r => r?.status === 'REQUESTED' || r?.status === 'OPEN') || null;

  const summaryReasons = ret.nonReturnableSummary?.nonReturnableReasons || [];
  const detailReasons = nonReturnable.flatMap(
    n => (n?.quantityDetails || []).map(q => q?.reasonCode).filter(Boolean));

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
    returnableQuantity: returnable.reduce((n, r) => n + (r?.quantity || 0), 0),
    nonReturnableQuantity: nonReturnable.reduce((n, r) => n + (r?.quantity || 0), 0),
    nonReturnableReasons: [...new Set([...summaryReasons, ...detailReasons])],
    existingReturns: returns.map(r => ({
      reference: r?.name || null,
      status: r?.status || null,
      externalId: shortId(r?.id),      // opaque suffix, never the raw gid
      createdAt: r?.createdAt || null,
    })),
    activeReturn: activeReturn ? {
      reference: activeReturn.name || null,
      status: activeReturn.status || null,
      externalId: shortId(activeReturn.id),
    } : null,
    // no email, no name, no address, no phone, no raw gid — the lineItem ids
    // fetched above stop here.
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
  returns(first: 10) { nodes { id name status createdAt } }
`;

/**
 * Return eligibility, per the 2026-07 Customer Account API schema.
 *
 * `NonReturnableLineItem` exposes lineItem / quantity / quantityDetails. It has
 * no `unreturnableReason` — the reason lives on `quantityDetails.reasonCode`,
 * with an order-level rollup on `nonReturnableSummary`.
 *
 * `lineItem { id }` is selected because the return mutation will need it, but
 * it is a raw gid and sanitizeOrder deliberately never emits it.
 */
const RETURN_FIELDS = `
  returnInformation {
    returnableLineItems(first: 20) {
      nodes {
        quantity
        lineItem { id name quantity }
      }
    }
    nonReturnableLineItems(first: 20) {
      nodes {
        quantity
        lineItem { id name quantity }
        quantityDetails { quantity reasonCode }
      }
    }
    nonReturnableSummary { nonReturnableReasons }
  }
`;

/**
 * The authenticated customer's own orders, raw.
 *
 * Server-side only: raw nodes carry Shopify gids, which the return mutation
 * needs and no caller outside this module may see.
 */
async function listOrdersRaw(req, { first = 25 } = {}) {
  const d = await gql(req, `query($first: Int!) {
    customer { orders(first: $first, sortKey: PROCESSED_AT, reverse: true) {
      nodes { ${ORDER_FIELDS} ${RETURN_FIELDS} } } }
  }`, { first: Math.min(Math.max(1, first), 50) });
  return d.customer?.orders?.nodes || [];
}

/** The authenticated customer's own orders. No parameter widens this. */
async function listOrders(req, opts) {
  return (await listOrdersRaw(req, opts)).map(sanitizeOrder);
}

/**
 * One raw order, resolved by session-scoped key.
 *
 * Same rule as getOrder: the key is matched against the customer's own list
 * rather than passed to Shopify, so a forged key cannot reach another order.
 */
async function getOrderRaw(req, orderKey) {
  const raw = await listOrdersRaw(req, { first: 50 });
  const found = raw.find(o => shortId(o.id) === String(orderKey));
  if (!found) throw new CustomerError('ORDER_NOT_FOUND', 'That order is not in your account.');
  return found;
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
async function findOrders(req, { productQuery, deliveredOnly = false, returnableOnly = false, sinceDays } = {}) {
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
  if (returnableOnly) orders = orders.filter(o => o.returnable);
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

/**
 * Customer-initiated return request.
 *
 * This is the one mutation a customer performs, and it runs under the
 * *customer's own* access token — not the merchant's Admin token. That is the
 * point: the authority matches the actor. It produces a Return in REQUESTED;
 * only the merchant can approve it, and that still happens on the Admin API.
 *
 * Shopify decides returnability. Nothing here overrides that verdict.
 */
async function requestReturn(req, { orderKey, note, reason } = {}) {
  // Re-read authoritative state immediately before mutating. A resolution
  // prepared a minute ago may already be stale.
  const raw = await getOrderRaw(req, orderKey);
  const view = sanitizeOrder(raw);

  // Duplicate protection: an existing live return means no second request.
  if (view.activeReturn) {
    throw new CustomerError('RETURN_ALREADY_EXISTS',
      'A return already exists for this order.', undefined, null, { return: view.activeReturn });
  }
  if (!view.returnable) {
    throw new CustomerError('NOT_RETURNABLE',
      'This order no longer has items that can be returned.', view.nonReturnableReasons);
  }

  const nodes = raw.returnInformation?.returnableLineItems?.nodes || [];
  const items = nodes
    .filter(n => n?.lineItem?.id && (n.quantity || 0) > 0)
    .map(n => ({ lineItemId: n.lineItem.id, quantity: n.quantity }));
  if (!items.length) {
    throw new CustomerError('NOT_RETURNABLE', 'This order no longer has items that can be returned.');
  }

  const MUTATION = `mutation OrderRequestReturn($orderId: ID!, $requestedLineItems: [RequestedLineItemInput!]!) {
    orderRequestReturn(orderId: $orderId, requestedLineItems: $requestedLineItems) {
      return { id name status createdAt }
      userErrors { field message code }
    }
  }`;

  const withReason = items.map(i => ({
    ...i,
    returnReason: reason || 'DEFECTIVE',
    customerNote: note || undefined,
  }));

  let data;
  try {
    data = await gql(req, MUTATION,
      { orderId: raw.id, requestedLineItems: withReason }, { label: 'orderRequestReturn' });
  } catch (e) {
    // A GraphQL *validation* error means the mutation never executed, so
    // retrying without the optional reason is safe. The mutation reference and
    // the self-serve guide disagree on how a reason is supplied; rather than
    // guess, fall back to the minimum the schema certainly accepts.
    const validation = e.code === 'GRAPHQL_ERROR' &&
      (e.diag?.errorCategory === 'INVALID_GRAPHQL' ||
       (e.diag?.upstreamMessages || []).some(m => /returnReason|customerNote/i.test(m)));
    if (!validation) throw e;
    data = await gql(req, MUTATION,
      { orderId: raw.id, requestedLineItems: items }, { label: 'orderRequestReturn:noReason' });
  }

  const payload = data?.orderRequestReturn || {};
  const userErrors = payload.userErrors || [];
  if (userErrors.length) {
    throw new CustomerError('RETURN_REFUSED', 'Shopify did not accept this return request.',
      userErrors.map(u => u.message));
  }
  const ret = payload.return;
  if (!ret) throw new CustomerError('RETURN_REFUSED', 'Shopify did not return a created return.');

  return {
    source: 'shopify-customer-account',
    authority: 'CUSTOMER',
    reference: ret.name || null,
    status: ret.status || null,
    externalId: shortId(ret.id),
    createdAt: ret.createdAt || null,
  };
}

module.exports = { whoami, listOrders, listOrdersRaw, getOrder, getOrderRaw, findOrders,
  requestReturn, CustomerError, gql, probe, classify, sanitizeOrder };
