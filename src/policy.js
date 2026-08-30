/**
 * Deterministic policy engine.
 *
 * This layer owns eligibility, amounts, timing, requirements and availability.
 * It contains NO model, NO randomness and NO agent input. Given an order and an
 * issue it always returns the same options.
 *
 * An agent may read these options and recommend one. An agent may never add an
 * option, change an amount, or declare something eligible.
 */

const RESULT_PREFIX = {
  REPLACEMENT: 'R',
  EXCHANGE: 'X',
  REFUND: 'RF',
  PARTIAL_REFUND: 'PR',
  STORE_CREDIT: 'SC',
  SHIPPING_REFUND: 'SR',
};

function money(amount, currency) {
  return { amount, currency };
}

/**
 * Every option carries enough structured fact for an agent to compare options
 * without scraping the UI.
 */
function option(o) {
  return {
    id: o.id,
    type: o.type,
    label: o.label,
    eligible: true,
    customerReceives: o.customerReceives,
    economicImpact: {
      currency: o.currency,
      refundToCustomer: o.refundToCustomer || 0,
      storeCreditToCustomer: o.storeCreditToCustomer || 0,
      customerKeepsItem: !!o.customerKeepsItem,
      replacementShipped: !!o.replacementShipped,
    },
    timing: {
      summary: o.timingSummary,
      businessDays: o.businessDays,
      immediate: !!o.immediate,
    },
    returnRequired: !!o.returnRequired,
    requirements: o.requirements || [],
    availability: o.availability || { applicable: true },
    estimatedCompletion: o.timingSummary,
  };
}

const POLICY = {
  // ── Scenario A — DAMAGED ────────────────────────────────────────────
  DAMAGED: (order) => [
    option({
      id: 'replacement',
      type: 'REPLACEMENT',
      label: 'Replacement',
      currency: order.currency,
      customerReceives: `Replacement ${order.product}`,
      replacementShipped: true,
      timingSummary: 'Arrives tomorrow',
      businessDays: 1,
      returnRequired: true,
      requirements: [
        'Return the original item within 14 days',
        'Prepaid return label included',
      ],
      availability: { applicable: true, inStock: true, shipsBy: 'tomorrow' },
    }),
    option({
      id: 'refund',
      type: 'REFUND',
      label: 'Refund',
      currency: order.currency,
      customerReceives: `${order.price.toFixed(2)} ${order.currency} refunded to original payment method`,
      refundToCustomer: order.price,
      timingSummary: '3–5 business days',
      businessDays: 5,
      returnRequired: true,
      requirements: [
        'Return the original item',
        'Prepaid return label included',
      ],
    }),
    option({
      id: 'keep_partial_refund',
      type: 'PARTIAL_REFUND',
      label: 'Keep Item + Partial Refund',
      currency: order.currency,
      customerReceives: `Keep the ${order.product} and receive 40.00 ${order.currency} back`,
      refundToCustomer: 40.0,
      customerKeepsItem: true,
      timingSummary: 'Processed immediately',
      businessDays: 0,
      immediate: true,
      returnRequired: false,
      requirements: ['No return needed — the damaged item stays with the customer'],
    }),
  ],

  // ── Scenario B — WRONG VARIANT ──────────────────────────────────────
  WRONG_VARIANT: (order) => [
    option({
      id: 'exchange',
      type: 'EXCHANGE',
      label: 'Exchange',
      currency: order.currency,
      customerReceives: `${order.product} in ${order.orderedVariant}`,
      replacementShipped: true,
      timingSummary: 'Arrives in 2 days',
      businessDays: 2,
      returnRequired: true,
      requirements: [
        `Return the ${order.receivedVariant} pair`,
        'Prepaid return label included',
      ],
      availability: { applicable: true, inStock: true, variant: order.orderedVariant },
    }),
    option({
      id: 'refund',
      type: 'REFUND',
      label: 'Refund',
      currency: order.currency,
      customerReceives: `${order.price.toFixed(2)} ${order.currency} refunded to original payment method`,
      refundToCustomer: order.price,
      timingSummary: '3–5 business days',
      businessDays: 5,
      returnRequired: true,
      requirements: [
        `Return the ${order.receivedVariant} pair`,
        'Prepaid return label included',
      ],
    }),
    option({
      id: 'store_credit',
      type: 'STORE_CREDIT',
      label: 'Store Credit',
      currency: order.currency,
      customerReceives: `105.00 ${order.currency} in store credit`,
      storeCreditToCustomer: 105.0,
      timingSummary: 'Available immediately',
      businessDays: 0,
      immediate: true,
      returnRequired: true,
      requirements: [
        `Return the ${order.receivedVariant} pair`,
        'Prepaid return label included',
      ],
    }),
  ],

  // ── Scenario C — ARRIVED LATE ───────────────────────────────────────
  ARRIVED_LATE: (order) => [
    option({
      id: 'return_refund',
      type: 'REFUND',
      label: 'Return + Refund',
      currency: order.currency,
      customerReceives: `${order.price.toFixed(2)} ${order.currency} refunded to original payment method`,
      refundToCustomer: order.price,
      timingSummary: '3–5 business days',
      businessDays: 5,
      returnRequired: true,
      requirements: ['Return the item', 'Prepaid return label included'],
    }),
    option({
      id: 'keep_shipping_refund',
      type: 'SHIPPING_REFUND',
      label: 'Keep Item + Shipping Refund',
      currency: order.currency,
      customerReceives: `Keep the item and receive 12.00 ${order.currency} shipping refund`,
      refundToCustomer: 12.0,
      customerKeepsItem: true,
      timingSummary: 'Processed immediately',
      businessDays: 0,
      immediate: true,
      returnRequired: false,
      requirements: ['No return needed'],
    }),
    option({
      id: 'keep_store_credit',
      type: 'STORE_CREDIT',
      label: 'Keep Item + Store Credit',
      currency: order.currency,
      customerReceives: `Keep the item and receive 20.00 ${order.currency} in store credit`,
      storeCreditToCustomer: 20.0,
      customerKeepsItem: true,
      timingSummary: 'Available immediately',
      businessDays: 0,
      immediate: true,
      returnRequired: false,
      requirements: ['No return needed'],
    }),
  ],
};

export const POLICY_VERSION = 'fixtures-2026-08-30';

/**
 * The only entry point. Deterministic for a given (order, issue).
 */
export function getEligibleResolutions(order, issue) {
  const build = POLICY[issue.type];
  if (!build) return [];
  return build(order);
}

export function getResolutionOption(order, issue, resolutionId) {
  return getEligibleResolutions(order, issue).find(o => o.id === resolutionId) || null;
}

export function isEligible(order, issue, resolutionId) {
  return !!getResolutionOption(order, issue, resolutionId);
}

export function eligibleIds(order, issue) {
  return getEligibleResolutions(order, issue).map(o => o.id);
}

/** Deterministic identifier for an executed resolution. */
export function resolutionResultId(order, resolutionType) {
  const prefix = RESULT_PREFIX[resolutionType] || 'RES';
  return `${prefix}-${order.orderId}`;
}

export { money };
