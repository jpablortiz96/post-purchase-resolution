/**
 * LIVE COMMERCE session — backed by a real Shopify order.
 *
 * Mirrors enough of ResolutionSession's shape for the UI, but every
 * authoritative fact comes from Shopify via the server-side adapter. Nothing
 * here decides eligibility, amounts or status: it reads them.
 *
 * The WebMCP capability boundary is unchanged. The agent can read the order and
 * prepare a resolution. Requesting the return is a customer action, and
 * approving it is a merchant action; neither is a WebMCP tool.
 */

export const LIVE_STATES = {
  LOADING: 'LOADING',
  ORDER_ACTIVE: 'ORDER_ACTIVE',
  RESOLUTION_PREPARED: 'RESOLUTION_PREPARED',
  RETURN_REQUESTED: 'RETURN_REQUESTED',
  RETURN_APPROVED: 'RETURN_APPROVED',
  UNAVAILABLE: 'UNAVAILABLE',
};

/** Shopify's own return semantics, mapped to what the customer is shown. */
const SHOPIFY_STATUS_LABEL = {
  REQUESTED: 'Requested — waiting for the merchant',
  OPEN: 'Approved by the merchant',
  CLOSED: 'Closed',
  DECLINED: 'Declined by the merchant',
  CANCELED: 'Cancelled',
};

export class LiveSession {
  constructor(clock) {
    this.clock = clock || (() => new Date().toISOString());
    this.state = LIVE_STATES.LOADING;
    this.order = null;
    this.preparedResolution = null;
    this.activeReturn = null;
    this.error = null;
    this.audit = [];
  }

  log(actor, action, metadata) {
    this.audit.push({ actor, action, timestamp: this.clock(), metadata: metadata || {} });
  }

  /** Derive state from external truth, never from what we remember doing. */
  applyOrder(order) {
    this.order = order;
    const live = (order.existingReturns || [])
      .find(r => r.status === 'REQUESTED' || r.status === 'OPEN');
    this.activeReturn = live || null;

    if (live && live.status === 'OPEN') this.state = LIVE_STATES.RETURN_APPROVED;
    else if (live && live.status === 'REQUESTED') this.state = LIVE_STATES.RETURN_REQUESTED;
    else if (this.preparedResolution) this.state = LIVE_STATES.RESOLUTION_PREPARED;
    else this.state = LIVE_STATES.ORDER_ACTIVE;
    return this.state;
  }

  async load() {
    try {
      const r = await fetch('/api/order');
      const body = await r.json();
      if (!body.ok) {
        this.state = LIVE_STATES.UNAVAILABLE;
        this.error = body.error || 'Live commerce is unavailable.';
        return this.state;
      }
      const first = !this.order;
      this.applyOrder(body.order);
      if (first) this.log('AGENT', `Inspected Shopify order ${body.order.orderReference}`);
      return this.state;
    } catch (e) {
      this.state = LIVE_STATES.UNAVAILABLE;
      this.error = 'Could not reach the commerce system.';
      return this.state;
    }
  }

  /** Agent action. Creates NO external mutation. */
  prepare({ reason, actor = 'AGENT' }) {
    if (this.state !== LIVE_STATES.ORDER_ACTIVE) {
      return { ok: false, error: 'Cannot prepare a resolution in the current state', currentState: this.state };
    }
    if (!this.order || !this.order.returnable) {
      return {
        ok: false,
        error: 'This order has no fulfilled items available to return',
        hint: 'Shopify reports no returnable fulfillment line items for this order.',
      };
    }
    this.preparedResolution = {
      type: 'RETURN',
      label: `Return ${this.order.product}`,
      reason: reason || null,
      shopifyReturnReason: 'DEFECTIVE',
      preparedBy: actor,
      preparedAt: this.clock(),
      orderReference: this.order.orderReference,
      quantity: this.order.returnableQuantity,
    };
    this.state = LIVE_STATES.RESOLUTION_PREPARED;
    this.log(actor, `Prepared return request for ${this.order.product}`, { reason: reason || null });
    return { ok: true, resolution: this.buildPreparedPayload() };
  }

  /** Customer action. This is the one that mutates Shopify. */
  async requestReturn() {
    if (this.state !== LIVE_STATES.RESOLUTION_PREPARED) {
      return { ok: false, error: 'There is no prepared resolution to request' };
    }
    // Re-read authoritative state before mutating: the prepared resolution may
    // be stale, or a return may already exist.
    await this.load();
    if (this.state !== LIVE_STATES.RESOLUTION_PREPARED && this.activeReturn) {
      return { ok: false, stale: true, error: 'A return already exists for this order', return: this.activeReturn };
    }
    if (!this.order.returnable) {
      this.preparedResolution = null;
      return { ok: false, stale: true, error: 'This order is no longer returnable. Prepare it again.' };
    }

    const res = await fetch('/api/return-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'Product arrived damaged. Left earphone is not working.' }),
    });
    const body = await res.json();
    if (!body.ok) return { ok: false, error: body.error, code: body.code, detail: body.detail };

    this.log('CUSTOMER', `Requested return of ${this.order.product}`);
    if (body.duplicate) {
      this.log('SYSTEM', `Shopify already had ${body.return.reference} — no second return created`);
    } else {
      this.log('SYSTEM', `Shopify created ${body.return.reference} as ${body.return.status}`);
    }
    await this.load();
    return { ok: true, ...body };
  }

  /** Re-read external truth. Used for polling and after a restart. */
  async refresh() { return this.load(); }

  buildPreparedPayload() {
    if (!this.preparedResolution) return null;
    const p = this.preparedResolution;
    return {
      type: p.type,
      label: p.label,
      agentReasoning: p.reason,
      preparedBy: p.preparedBy,
      shopifyReturnReason: p.shopifyReturnReason,
      quantity: p.quantity,
      externalSystem: 'shopify',
      requiresCustomerRequest: true,
      committedByCustomer: false,
      nextStep: 'The customer requests this return themselves in the page. You cannot request it for them.',
    };
  }

  /** What get_order returns in LIVE mode. Merchant facts only. */
  buildOrderPayload() {
    if (!this.order) return { error: this.error || 'Order not loaded' };
    return {
      source: 'shopify',
      externalCommerceSystem: 'Shopify',
      orderReference: this.order.orderReference,
      product: this.order.product,
      quantity: this.order.quantity,
      price: this.order.price,
      currency: this.order.currency,
      financialStatus: this.order.financialStatus,
      fulfillmentStatus: this.order.fulfillmentStatus,
      deliveredAt: this.order.deliveredAt,
      returnable: this.order.returnable,
      returnableQuantity: this.order.returnableQuantity,
      orderReturnStatus: this.order.orderReturnStatus,
      existingReturns: this.order.existingReturns,
      resolutionState: this.state,
      resolution: this.buildPreparedPayload(),
      permittedResolutions: this.order.returnable
        ? [{
            id: 'return_damaged',
            type: 'RETURN',
            label: `Return ${this.order.product}`,
            reason: 'DEFECTIVE',
            customerReceives: 'A return authorised by the merchant, then a refund once received',
            requiresMerchantApproval: true,
            note: 'Merchant policy and the refund itself are decided in Shopify, not here.',
          }]
        : [],
      optionsNote: this.order.returnable
        ? 'Shopify reports this order has returnable fulfilled items. A return request requires merchant approval.'
        : 'Shopify reports no returnable fulfilled items for this order.',
    };
  }

  statusLabel() {
    return this.activeReturn ? (SHOPIFY_STATUS_LABEL[this.activeReturn.status] || this.activeReturn.status) : null;
  }
}
