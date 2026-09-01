/**
 * Server-side Shopify adapter.
 *
 * The client secret and access token never leave this process. Nothing here is
 * importable from browser code — everything the browser sees goes through the
 * sanitisers below.
 *
 * Auth: client_credentials, as configured for this app. Tokens are cached in
 * module scope and renewed before expiry.
 */

const RAW = (process.env.SHOPIFY_SHOP || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const SHOP = RAW.includes('.') ? RAW : `${RAW}.myshopify.com`;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

/**
 * The order this deployment serves.
 *
 * SECURITY NOTE. Until Customer Account authentication is wired (see
 * docs/M4_3_PREFLIGHT.md), there is no authenticated customer to scope orders
 * to. So the surface exposes exactly ONE order chosen server-side and offers no
 * way for a caller to select a different one — callers cannot pass an order at
 * all. That removes cross-order lookup; it is not a substitute for customer
 * scoping, and is documented as such.
 */
const ORDER_LIST = (process.env.SHOPIFY_DEMO_ORDER_NAMES || '#1001')
  .split(',').map(s => s.trim()).filter(Boolean);
const ACTIVE_ORDER = ORDER_LIST[0];

/** Is a caller allowed to perform commerce mutations at all? */
function mutationsEnabled() {
  return process.env.COMMERCE_MUTATIONS_ENABLED !== 'false';
}

/**
 * Merchant approval is merchant authority and must never be anonymous.
 *
 * This checks a high-entropy operator token held server-side. It is NOT
 * merchant identity and is not presented as production authentication: it is a
 * stopgap that prevents anonymous approval until a real merchant session
 * exists. If no token is configured, approval is refused outright rather than
 * left open.
 */
function merchantAuthorized(req) {
  const expected = process.env.MERCHANT_OPERATOR_TOKEN;
  if (!expected) return false;
  const got = (req.headers['x-merchant-token'] || '').trim();
  if (!got || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

let cached = null;   // { token, expiresAt }

function configured() {
  return !!(RAW && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET);
}

async function token() {
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) {
    // Deliberately does not echo the body: it can contain credential material.
    throw new ShopifyError('AUTH_FAILED', `Shopify authentication failed (${res.status})`);
  }
  const body = await res.json();
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in || 3600) * 1000 };
  return cached.token;
}

class ShopifyError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

async function gql(query, variables) {
  const t = await token();
  let res;
  try {
    res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': t },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new ShopifyError('UNREACHABLE', 'Could not reach Shopify.');
  }
  if (res.status === 429) throw new ShopifyError('RATE_LIMITED', 'Shopify is rate limiting this app. Try again shortly.');
  if (!res.ok) throw new ShopifyError('HTTP_ERROR', `Shopify returned ${res.status}.`);

  const body = await res.json();
  if (body.errors) {
    throw new ShopifyError('GRAPHQL_ERROR', 'Shopify rejected the query.',
      body.errors.map(e => e.message));
  }
  return body.data;
}

// ── sanitisers ───────────────────────────────────────────────────────
// Allowlists, not deny-lists. A field reaches the browser only if it is named
// here, so a schema change cannot silently start leaking customer data.

function sanitizeReturn(r) {
  if (!r) return null;
  return { reference: r.name, status: r.status, externalId: shortId(r.id) };
}

/** Last path segment only — never the full gid, never an admin URL. */
function shortId(gid) {
  return String(gid || '').split('/').pop() || null;
}

function sanitizeOrder(o, returnable) {
  const line = o.lineItems.nodes[0] || null;
  const money = o.currentTotalPriceSet?.shopMoney || {};
  return {
    source: 'shopify',
    orderReference: o.name,
    product: line ? line.title : null,
    variant: line ? line.variantTitle : null,
    quantity: line ? line.quantity : null,
    price: money.amount ? Number(money.amount) : null,
    currency: money.currencyCode || null,
    financialStatus: o.displayFinancialStatus,
    fulfillmentStatus: o.displayFulfillmentStatus,
    deliveredAt: o.fulfillments?.[0]?.deliveredAt || null,
    orderReturnStatus: o.returnStatus,
    returnable: returnable.items.length > 0,
    returnableQuantity: returnable.items.reduce((n, i) => n + i.quantity, 0),
    existingReturns: (o.returns?.nodes || []).map(sanitizeReturn),
    // NOTE: no email, no name, no address, no phone, no admin URL, no gid.
  };
}

// ── queries ──────────────────────────────────────────────────────────

const ORDER_FIELDS = `
  id name displayFinancialStatus displayFulfillmentStatus returnStatus createdAt
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  fulfillments(first: 5) { deliveredAt }
  lineItems(first: 5) { nodes { id title quantity variantTitle } }
  returns(first: 10) { nodes { id name status } }
`;

async function fetchOrderByName(name) {
  // Callers cannot choose an order. Any supplied name is ignored in favour of
  // the server-side active order, so there is no cross-order lookup surface.
  if (name && name !== ACTIVE_ORDER) {
    throw new ShopifyError('ORDER_NOT_ACCESSIBLE',
      'This application does not expose that order.');
  }
  name = ACTIVE_ORDER;
  const data = await gql(
    `query($q: String!) { orders(first: 1, query: $q) { nodes { ${ORDER_FIELDS} } } }`,
    { q: `name:${name}` });
  const order = data.orders.nodes[0];
  if (!order) throw new ShopifyError('ORDER_NOT_FOUND', 'That order could not be found in Shopify.');
  return order;
}

async function fetchReturnable(orderGid) {
  const data = await gql(`query($id: ID!) {
    returnableFulfillments(orderId: $id, first: 10) {
      nodes {
        id
        returnableFulfillmentLineItems(first: 10) {
          nodes { quantity fulfillmentLineItem { id lineItem { title } } }
        }
      }
    }
  }`, { id: orderGid });

  const items = [];
  for (const n of data.returnableFulfillments.nodes) {
    for (const li of n.returnableFulfillmentLineItems.nodes) {
      items.push({
        fulfillmentLineItemId: li.fulfillmentLineItem.id,
        title: li.fulfillmentLineItem.lineItem?.title,
        quantity: li.quantity,
      });
    }
  }
  return { items };
}

/** The customer-facing read. Sanitised; safe to send to the browser. */
async function getOrder(name) {
  const order = await fetchOrderByName(name);
  const returnable = await fetchReturnable(order.id);
  return { sanitized: sanitizeOrder(order, returnable), _internal: { order, returnable } };
}

/** Any return that is still live for this order. Used for duplicate protection. */
function activeReturn(order) {
  const live = ['REQUESTED', 'OPEN'];
  return (order.returns?.nodes || []).find(r => live.includes(r.status)) || null;
}

// ── mutations ────────────────────────────────────────────────────────

/**
 * Customer-initiated. Produces a Return in REQUESTED status, preserving the
 * merchant approval boundary. Refuses if a live return already exists.
 */
async function requestReturn({ reason = 'DEFECTIVE', customerNote } = {}) {
  if (!mutationsEnabled()) {
    throw new ShopifyError('MUTATIONS_DISABLED',
      'Return requests are disabled on this deployment.');
  }
  const { _internal } = await getOrder(ACTIVE_ORDER);
  const { order, returnable } = _internal;

  const existing = activeReturn(order);
  if (existing) {
    return { created: false, duplicate: true, return: sanitizeReturn(existing) };
  }
  if (!returnable.items.length) {
    throw new ShopifyError('NOT_RETURNABLE',
      'This order has no fulfilled items available to return.');
  }

  const item = returnable.items[0];
  const data = await gql(`mutation($input: ReturnRequestInput!) {
    returnRequest(input: $input) {
      return { id name status }
      userErrors { field message }
    }
  }`, {
    input: {
      orderId: order.id,
      returnLineItems: [{
        fulfillmentLineItemId: item.fulfillmentLineItemId,
        quantity: item.quantity,
        returnReason: reason,
        customerNote: customerNote || undefined,
      }],
    },
  });

  const r = data.returnRequest;
  if (r.userErrors && r.userErrors.length) {
    throw new ShopifyError('USER_ERRORS', 'Shopify rejected the return request.',
      r.userErrors.map(e => e.message));
  }
  if (!r.return) throw new ShopifyError('NO_RETURN', 'Shopify did not return a Return object.');

  return { created: true, duplicate: false, return: sanitizeReturn(r.return) };
}

/** Merchant-initiated. REQUESTED -> OPEN. */
async function approveReturn({ req } = {}) {
  if (!mutationsEnabled()) {
    throw new ShopifyError('MUTATIONS_DISABLED', 'Approvals are disabled on this deployment.');
  }
  if (!merchantAuthorized(req)) {
    throw new ShopifyError('MERCHANT_UNAUTHORIZED',
      'Approving a return requires merchant authority.');
  }
  const { _internal } = await getOrder(ACTIVE_ORDER);
  const pending = (_internal.order.returns?.nodes || []).find(r => r.status === 'REQUESTED');
  if (!pending) {
    const any = activeReturn(_internal.order);
    throw new ShopifyError('NOT_REQUESTED',
      any ? `This return is already ${any.status}.` : 'There is no requested return to approve.',
      any ? { current: sanitizeReturn(any) } : undefined);
  }

  const data = await gql(`mutation($id: ID!) {
    returnApproveRequest(input: { id: $id }) {
      return { id name status }
      userErrors { field message }
    }
  }`, { id: pending.id });

  const r = data.returnApproveRequest;
  if (r.userErrors && r.userErrors.length) {
    throw new ShopifyError('USER_ERRORS', 'Shopify rejected the approval.',
      r.userErrors.map(e => e.message));
  }
  if (!r.return) throw new ShopifyError('NO_RETURN', 'Shopify did not return a Return object.');
  return { return: sanitizeReturn(r.return) };
}

/** Independent re-read of external state. Never served from local memory. */
async function returnStatus() {
  const order = await fetchOrderByName(ACTIVE_ORDER);
  return {
    orderReference: order.name,
    orderReturnStatus: order.returnStatus,
    returns: (order.returns?.nodes || []).map(sanitizeReturn),
    active: sanitizeReturn(activeReturn(order)),
  };
}

module.exports = {
  configured, getOrder, requestReturn, approveReturn, returnStatus,
  activeReturn, sanitizeReturn, ShopifyError, API_VERSION,
  ACTIVE_ORDER, mutationsEnabled, merchantAuthorized,
  shopHost: () => SHOP,
};
