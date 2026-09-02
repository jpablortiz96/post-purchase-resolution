/**
 * AUTHENTICATED CUSTOMER session.
 *
 * The customer signs in, and their purchases come from Shopify's Customer
 * Account API under their own token. Nothing here knows an order number: the
 * set of orders is whatever that customer owns, and an order is chosen either
 * by the customer tapping it or by an agent describing it in words.
 *
 * The capability boundary is unchanged. An agent can find, read and prepare.
 * Requesting the return is the customer's action, and approving it is the
 * merchant's; neither is a WebMCP tool.
 */

export const CUSTOMER_STATES = {
  LOADING: 'LOADING',
  SIGNED_OUT: 'SIGNED_OUT',
  NO_PURCHASES: 'NO_PURCHASES',
  BROWSING: 'BROWSING',              // signed in, no purchase selected
  ORDER_ACTIVE: 'ORDER_ACTIVE',
  RESOLUTION_PREPARED: 'RESOLUTION_PREPARED',
  RETURN_REQUESTED: 'RETURN_REQUESTED',
  RETURN_APPROVED: 'RETURN_APPROVED',
  UNAVAILABLE: 'UNAVAILABLE',
};

/**
 * Shopify's return states, in the customer's language.
 *
 * Every state Shopify can report has an entry. A missing state used to fall
 * through to "already returned", which is how a CLOSED return read as though
 * nothing had happened.
 */
const RETURN_LANGUAGE = {
  REQUESTED: { headline: 'Return requested', detail: 'Waiting for the merchant to review your request.', level: 'waiting' },
  OPEN:      { headline: 'Return approved',  detail: 'Your return is in progress.', level: 'action' },
  CLOSED:    { headline: 'Return completed', detail: 'This return is complete.', level: 'done' },
  DECLINED:  { headline: 'Return declined',  detail: 'The merchant did not approve this return.', level: 'none' },
  CANCELED:  { headline: 'Return cancelled', detail: 'This return was cancelled.', level: 'none' },
};

/** Why an item cannot be returned, in the customer's language. */
const REASON_LANGUAGE = {
  RETURNED: 'Already returned',
  RETURN_PERIOD_ENDED: 'The return window has closed',
  FINAL_SALE: 'Final sale',
  NO_RETURN_SHIPPING_CONFIGURED: 'Returns are not set up for this item',
  NOT_FULFILLED: 'Not delivered yet',
};

/**
 * A return state in customer language.
 *
 * `refunded` is only ever passed when Shopify itself reports the order as
 * refunded. A refund is never claimed on the strength of a CLOSED return alone:
 * a return can close without money moving.
 */
export function describeReturn(status, { refunded = false } = {}) {
  const base = RETURN_LANGUAGE[status];
  if (!base) {
    return { headline: `Return ${String(status || '').toLowerCase()}`, detail: '', level: 'none' };
  }
  if (status === 'CLOSED' && refunded) {
    return { ...base, detail: 'Your refund has been issued.' };
  }
  return base;
}

export function describeReason(code) {
  return REASON_LANGUAGE[code] || String(code || '').toLowerCase().replace(/_/g, ' ');
}

/**
 * The one line a customer most needs on a purchase.
 *
 * Derived strictly from authoritative state — nothing about carriers or
 * shipping is invented, because Shopify does not tell us those here.
 */
export function nextAction(order) {
  if (!order) return null;

  // The most recent return, whatever state it reached. Using only the
  // *actionable* return meant a completed one silently disappeared and the
  // purchase read as "already returned" instead of "return completed".
  const r = order.latestReturn || order.activeReturn;
  if (r && r.status) {
    const refunded = order.financialStatus === 'REFUNDED';
    const d = describeReturn(r.status, { refunded });
    return { level: d.level, label: d.headline, detail: d.detail };
  }

  if (order.returnable) {
    return { level: 'available', label: 'Eligible for return', detail: 'You can request a return for this purchase.' };
  }
  const reason = (order.nonReturnableReasons || [])[0];
  if (reason) return { level: 'none', label: describeReason(reason), detail: '' };
  return null;
}

export class CustomerSession {
  constructor(clock) {
    this.clock = clock || (() => new Date().toISOString());
    this.state = CUSTOMER_STATES.LOADING;
    this.purchases = [];
    this.selectedKey = null;
    this.preparedResolution = null;
    this.error = null;
    this.audit = [];
  }

  log(actor, action, metadata) {
    this.audit.push({ actor, action, timestamp: this.clock(), metadata: metadata || {} });
  }

  get selected() {
    return this.purchases.find(o => o.orderKey === this.selectedKey) || null;
  }

  /** Derive state from external truth, never from what we remember doing. */
  deriveState() {
    if (!this.purchases.length) return (this.state = CUSTOMER_STATES.NO_PURCHASES);
    const o = this.selected;
    if (!o) return (this.state = CUSTOMER_STATES.BROWSING);
    const active = o.activeReturn;
    if (active && active.status === 'OPEN') return (this.state = CUSTOMER_STATES.RETURN_APPROVED);
    if (active && active.status === 'REQUESTED') return (this.state = CUSTOMER_STATES.RETURN_REQUESTED);
    if (this.preparedResolution && this.preparedResolution.orderKey === o.orderKey) {
      return (this.state = CUSTOMER_STATES.RESOLUTION_PREPARED);
    }
    return (this.state = CUSTOMER_STATES.ORDER_ACTIVE);
  }

  async load() {
    try {
      const r = await fetch('/api/customer/orders');
      if (r.status === 401) { this.state = CUSTOMER_STATES.SIGNED_OUT; return this.state; }
      const body = await r.json();
      if (!body.ok) {
        this.state = CUSTOMER_STATES.UNAVAILABLE;
        this.error = body.error || 'Your purchases are unavailable right now.';
        return this.state;
      }
      const first = !this.purchases.length;
      this.purchases = body.orders || [];
      // A selection that no longer exists must not survive a refresh.
      if (this.selectedKey && !this.purchases.some(o => o.orderKey === this.selectedKey)) {
        this.selectedKey = null;
        this.preparedResolution = null;
      }
      if (first) this.log('SYSTEM', `Loaded ${this.purchases.length} purchase(s) from the customer's account`);
      return this.deriveState();
    } catch (e) {
      this.state = CUSTOMER_STATES.UNAVAILABLE;
      this.error = 'Could not reach the commerce system.';
      return this.state;
    }
  }

  async refresh() { return this.load(); }

  select(orderKey, actor = 'CUSTOMER') {
    const found = this.purchases.find(o => o.orderKey === String(orderKey));
    if (!found) return { ok: false, error: 'That purchase is not in your account.' };
    if (this.selectedKey !== found.orderKey) this.preparedResolution = null;
    this.selectedKey = found.orderKey;
    this.log(actor, `Opened ${found.orderReference} — ${found.product}`);
    this.deriveState();
    return { ok: true, order: this.buildOrderPayload() };
  }

  /**
   * Natural discovery over the customer's own purchases.
   * Runs server-side so scoping is enforced in one place.
   */
  async find({ productQuery, deliveredOnly, returnableOnly, recencyDays } = {}) {
    const p = new URLSearchParams();
    if (productQuery) p.set('q', productQuery);
    if (deliveredOnly) p.set('delivered_only', 'true');
    if (returnableOnly) p.set('returnable_only', 'true');
    if (recencyDays) p.set('since_days', String(recencyDays));
    // At least one filter, so this never degenerates into "list everything".
    if (![...p.keys()].length) p.set('q', '');

    const r = await fetch('/api/customer/orders?' + p.toString());
    if (r.status === 401) return { ok: false, signedOut: true, error: 'Please sign in to look up your purchases.' };
    const body = await r.json();
    if (!body.ok) return { ok: false, error: body.error || 'Could not search your purchases.' };

    // One credible match is selected for the customer to review. More than one
    // is handed back for them to choose: we never pick on their behalf.
    if (body.resolution === 'single') this.select(body.candidates[0].orderKey, 'AGENT');
    return { ok: true, ...body };
  }

  /** Agent action. Creates NO external mutation. */
  prepare({ reason, actor = 'AGENT' } = {}) {
    const o = this.selected;
    if (!o) {
      return { ok: false, error: 'No purchase is open. Find the purchase first.', currentState: this.state };
    }
    if (o.activeReturn) {
      return { ok: false, error: 'A return already exists for this purchase.', return: o.activeReturn };
    }
    if (!o.returnable) {
      return {
        ok: false,
        error: 'This purchase has no items available to return.',
        hint: (o.nonReturnableReasons || []).map(describeReason).join('; ') || undefined,
      };
    }
    this.preparedResolution = {
      type: 'RETURN',
      label: `Return ${o.product}`,
      reason: reason || null,
      preparedBy: actor,
      preparedAt: this.clock(),
      orderKey: o.orderKey,
      orderReference: o.orderReference,
      quantity: o.returnableQuantity,
    };
    this.deriveState();
    this.log(actor, `Prepared a return request for ${o.product}`, { reason: reason || null });
    return { ok: true, resolution: this.buildPreparedPayload() };
  }

  cancelPrepared() {
    this.preparedResolution = null;
    this.deriveState();
  }

  /** Customer action. The only call here that mutates Shopify. */
  async requestReturn(note) {
    const prepared = this.preparedResolution;
    if (!prepared) return { ok: false, error: 'There is no prepared return to request.' };

    // Re-read authoritative state before mutating: the prepared resolution may
    // be stale, or a return may already exist.
    await this.load();
    const o = this.selected;
    if (!o) return { ok: false, stale: true, error: 'That purchase is no longer available.' };
    if (o.activeReturn) {
      this.preparedResolution = null;
      return { ok: false, stale: true, error: 'A return already exists for this purchase.', return: o.activeReturn };
    }
    if (!o.returnable) {
      this.preparedResolution = null;
      return { ok: false, stale: true, error: 'This purchase is no longer returnable.' };
    }

    const res = await fetch('/api/customer/return-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderKey: o.orderKey, note: note || prepared.reason || undefined }),
    });
    const body = await res.json();
    if (!body.ok) {
      await this.load();
      return { ok: false, error: body.error, code: body.code, detail: body.detail, return: body.return };
    }

    this.log('CUSTOMER', `Requested a return of ${o.product}`);
    this.log('SYSTEM', `Shopify created ${body.return.reference} as ${body.return.status}`);
    this.preparedResolution = null;
    await this.load();
    return { ok: true, ...body };
  }

  buildPreparedPayload() {
    const p = this.preparedResolution;
    if (!p) return null;
    return {
      type: p.type,
      label: p.label,
      agentReasoning: p.reason,
      preparedBy: p.preparedBy,
      quantity: p.quantity,
      externalSystem: 'shopify',
      requiresCustomerRequest: true,
      committedByCustomer: false,
      nextStep: 'The customer submits this request themselves in the page. You cannot submit it for them.',
    };
  }

  /** What get_order returns. Customer-scoped facts only. */
  buildOrderPayload() {
    const o = this.selected;
    if (!o) {
      return {
        error: 'No purchase is open on this page.',
        hint: 'Use the tool that finds a purchase from the customer’s description first.',
        purchaseCount: this.purchases.length,
      };
    }
    const action = nextAction(o);
    return {
      source: 'shopify-customer-account',
      externalCommerceSystem: 'Shopify',
      scope: 'the signed-in customer’s own purchase',
      orderReference: o.orderReference,
      product: o.product,
      quantity: o.quantity,
      price: o.price,
      currency: o.currency,
      financialStatus: o.financialStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      purchasedAt: o.processedAt,
      returnable: o.returnable,
      returnableQuantity: o.returnableQuantity,
      whyNotReturnable: (o.nonReturnableReasons || []).map(describeReason),
      existingReturns: o.existingReturns,
      activeReturn: o.activeReturn,
      latestReturn: o.latestReturn,
      customerFacingStatus: action ? action.label : null,
      resolutionState: this.state,
      resolution: this.buildPreparedPayload(),
      permittedResolutions: o.returnable && !o.activeReturn
        ? [{
            id: 'return_item',
            type: 'RETURN',
            label: `Return ${o.product}`,
            customerReceives: 'A return authorised by the merchant, then a refund once received',
            requiresMerchantApproval: true,
            note: 'Merchant policy and the refund itself are decided in Shopify, not here.',
          }]
        : [],
      optionsNote: o.latestReturn
        ? `Shopify has return ${o.latestReturn.reference} for this purchase (${o.latestReturn.status}).`
        : o.returnable
          ? 'Shopify reports returnable items on this purchase. A return request needs merchant approval.'
          : 'Shopify reports no returnable items for this purchase.',
    };
  }

  /** A compact, customer-safe view of every purchase. */
  buildInbox() {
    return this.purchases.map(o => ({
      orderKey: o.orderKey,
      orderReference: o.orderReference,
      product: o.product,
      quantity: o.quantity,
      price: o.price,
      currency: o.currency,
      purchasedAt: o.processedAt,
      fulfillmentStatus: o.fulfillmentStatus,
      returnable: o.returnable,
      activeReturn: o.activeReturn,
      latestReturn: o.latestReturn,
      nextAction: nextAction(o),
    }));
  }
}
