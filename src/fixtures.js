/**
 * Deterministic merchant fixtures.
 *
 * These are hackathon fixtures implementing realistic post-purchase policies.
 * They are NOT real Shopify orders, real refunds, real inventory, or real
 * payment rails. Every amount, timing and requirement below is defined by the
 * application — never by an agent.
 */

export const SCENARIOS = {
  damaged: {
    key: 'damaged',
    label: 'Damaged',
    order: {
      orderId: '1042',
      product: 'Wireless Headphones',
      price: 129.0,
      currency: 'USD',
      status: 'delivered',
      orderedDate: '2026-08-22',
      promisedDate: '2026-08-26',
      deliveredDate: '2026-08-26',
    },
    issue: {
      type: 'DAMAGED',
      headline: 'Arrived damaged',
      description: 'Left earphone does not work.',
      reportedDate: '2026-08-27',
    },
    customerContext: {
      summary: 'Customer travels tomorrow.',
      urgency: 'high',
      note: 'Anything that does not arrive before departure is of limited use.',
    },
  },

  wrong_variant: {
    key: 'wrong_variant',
    label: 'Wrong Size',
    order: {
      orderId: '2087',
      product: 'Running Shoes',
      price: 96.0,
      currency: 'USD',
      status: 'delivered',
      orderedDate: '2026-08-24',
      promisedDate: '2026-08-28',
      deliveredDate: '2026-08-28',
      orderedVariant: 'Size 9',
      receivedVariant: 'Size 8',
    },
    issue: {
      type: 'WRONG_VARIANT',
      headline: 'Wrong size received',
      description: 'Customer ordered size 9 and received size 8.',
      reportedDate: '2026-08-29',
    },
    customerContext: {
      summary: 'Customer needs the shoes for an event in three days.',
      urgency: 'high',
      note: 'A resolution arriving after the event does not solve the problem.',
    },
  },

  arrived_late: {
    key: 'arrived_late',
    label: 'Arrived Late',
    order: {
      orderId: '3155',
      product: 'Birthday Gift',
      price: 74.0,
      currency: 'USD',
      status: 'delivered',
      orderedDate: '2026-08-20',
      promisedDate: '2026-08-26',
      deliveredDate: '2026-08-28',
    },
    issue: {
      type: 'ARRIVED_LATE',
      headline: 'Arrived after the promised date',
      description: 'Order arrived two days after the promised delivery date.',
      reportedDate: '2026-08-28',
    },
    customerContext: {
      summary: 'The event has already passed.',
      urgency: 'low',
      note: 'The item is intact; the timing is what failed.',
    },
  },
};

export const SCENARIO_KEYS = Object.keys(SCENARIOS);

export const DEFAULT_SCENARIO = 'damaged';

export function getScenario(key) {
  return SCENARIOS[key] || null;
}

export function findScenarioByOrderId(orderId) {
  const id = String(orderId);
  return SCENARIO_KEYS.map(k => SCENARIOS[k]).find(s => s.order.orderId === id) || null;
}
