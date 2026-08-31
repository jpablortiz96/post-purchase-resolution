/**
 * Resolution state machine — M3 authority model.
 *
 *   Agent prepares.  Merchant defines the truth.  Customer commits.
 *
 * WHAT CHANGED IN M3, AND WHY.
 *
 * M2 measured 30 matched tasks per mode on the live product. The browser-UI
 * baseline committed before explicit approval in 7/30; the WebMCP tool path in
 * 0/30. It also showed that a customer pressing Approve and then saying nothing
 * never resumes a turn-based agent (0/6 and 0/30).
 *
 * Both findings point the same way: the final consequential act should be a
 * single customer action in the product, not an approval that then has to wake
 * an agent up to execute it. So:
 *
 *   - there is no agent-callable final-commit transition at all
 *   - approve-and-execute collapsed into one customer commit
 *   - HUMAN_APPROVED and RESOLUTION_EXECUTING are gone: with commitment atomic
 *     they were never observable, and an unobservable state name is exactly the
 *     ambiguity that caused the M0.6 bug
 *
 * Pure: no DOM, no WebMCP, no network. Importable by tests.
 */

import { getEligibleResolutions, getResolutionOption, resolutionResultId } from './policy.js';
import { getScenario } from './fixtures.js';

export const STATES = {
  ORDER_ACTIVE: 'ORDER_ACTIVE',
  RESOLUTION_PREPARED: 'RESOLUTION_PREPARED',
  RESOLVED: 'RESOLVED',
  RESOLUTION_CANCELLED: 'RESOLUTION_CANCELLED',
};

/**
 * The WebMCP capability surface, per state.
 *
 * Note what is absent everywhere: any tool that completes a resolution. That
 * absence is the design. See docs/CAPABILITY_BOUNDARY.md.
 */
export const TOOLS_BY_STATE = {
  ORDER_ACTIVE:         ['get_order', 'prepare_resolution'],
  RESOLUTION_PREPARED:  ['get_order'],
  RESOLVED:             ['get_order'],
  RESOLUTION_CANCELLED: ['get_order', 'prepare_resolution'],
};

/** Actions only the customer may take. Never reachable through WebMCP. */
export const CUSTOMER_ONLY_ACTIONS = ['chooseAnother', 'commit', 'cancel'];

export class InvariantViolation extends Error {}

export class ResolutionSession {
  constructor(scenarioKey, clock) {
    this.clock = clock || (() => new Date().toISOString());
    this.reset(scenarioKey);
  }

  reset(scenarioKey) {
    const scenario = getScenario(scenarioKey);
    if (!scenario) throw new Error(`Unknown scenario: ${scenarioKey}`);
    this.scenario = scenario;
    this.state = STATES.ORDER_ACTIVE;
    this.preparedResolution = null;
    this.resolutionResult = null;
    this.committedAt = null;
    this.committedBy = null;
    this.cancelledAt = null;
    this.audit = [];
    this.assertInvariants();
    return this;
  }

  get order() { return this.scenario.order; }
  get issue() { return this.scenario.issue; }
  get options() { return getEligibleResolutions(this.order, this.issue); }

  // ── invariants ────────────────────────────────────────────────────

  assertInvariants() {
    const s = this.state;
    const fail = (msg) => { throw new InvariantViolation(`[${s}] ${msg}`); };

    if (!TOOLS_BY_STATE[s]) fail('unknown state');

    switch (s) {
      case STATES.ORDER_ACTIVE:
        if (this.preparedResolution !== null) fail('preparedResolution must be null');
        if (this.resolutionResult !== null) fail('resolutionResult must be null');
        if (this.committedAt !== null) fail('committedAt must be null');
        break;

      case STATES.RESOLUTION_PREPARED:
        if (this.preparedResolution === null) fail('preparedResolution must not be null');
        if (this.resolutionResult !== null) fail('resolutionResult must be null');
        if (this.committedAt !== null) fail('committedAt must be null');
        break;

      case STATES.RESOLVED:
        if (this.preparedResolution === null) fail('preparedResolution must not be null');
        if (this.resolutionResult === null) fail('resolutionResult must not be null');
        if (this.committedAt === null) fail('committedAt must be set');
        if (this.committedBy !== 'CUSTOMER') fail('only the customer may commit');
        break;

      case STATES.RESOLUTION_CANCELLED:
        if (this.preparedResolution !== null) fail('preparedResolution must be null');
        if (this.resolutionResult !== null) fail('resolutionResult must be null');
        if (this.cancelledAt === null) fail('cancelledAt must be set');
        break;
    }

    // M0.6 REGRESSION GUARD, carried forward.
    // What the agent reads must never contradict what actually happened.
    const r = this.buildOrderPayload().resolution;
    if (r) {
      const committed = this.state === STATES.RESOLVED;
      if (r.committedByCustomer !== committed) {
        fail(`payload committedByCustomer (${r.committedByCustomer}) contradicts state`);
      }
      if (r.requiresCustomerCommitment === committed) {
        fail(`payload requiresCustomerCommitment (${r.requiresCustomerCommitment}) contradicts committedByCustomer`);
      }
    }
  }

  // ── audit ─────────────────────────────────────────────────────────

  log(actor, action, metadata) {
    this.audit.push({ actor, action, timestamp: this.clock(), metadata: metadata || {} });
  }

  // ── AGENT-REACHABLE TRANSITION ────────────────────────────────────

  /**
   * Stage an eligible option for the customer to decide on.
   * Issues nothing, ships nothing, finalises nothing.
   */
  prepare({ resolutionId, reason, actor = 'AGENT' }) {
    if (this.state !== STATES.ORDER_ACTIVE && this.state !== STATES.RESOLUTION_CANCELLED) {
      return {
        ok: false,
        error: 'Cannot prepare a resolution in the current state',
        currentState: this.state,
        hint: this.state === STATES.RESOLUTION_PREPARED
          ? 'A resolution is already prepared and is waiting for the customer to decide.'
          : 'This order has already been resolved.',
      };
    }

    const opt = getResolutionOption(this.order, this.issue, resolutionId);
    if (!opt) {
      return {
        ok: false,
        error: 'Not an eligible resolution for this order',
        requested: resolutionId,
        eligible: this.options.map(o => o.id),
      };
    }

    this.preparedResolution = { option: opt, reason: reason || null, preparedBy: actor, preparedAt: this.clock() };
    this.cancelledAt = null;
    this.state = STATES.RESOLUTION_PREPARED;
    this.log(actor, `Prepared ${opt.label}`, { resolutionId: opt.id, reason: reason || null });
    this.assertInvariants();
    return { ok: true, resolution: this.buildPreparedPayload() };
  }

  // ── CUSTOMER-ONLY TRANSITIONS ─────────────────────────────────────

  /** Customer swaps to a different eligible option before committing. */
  chooseAnother(resolutionId) {
    if (this.state !== STATES.RESOLUTION_PREPARED) {
      return { ok: false, error: 'No resolution is currently awaiting a decision', currentState: this.state };
    }
    const opt = getResolutionOption(this.order, this.issue, resolutionId);
    if (!opt) return { ok: false, error: 'Not an eligible resolution for this order', requested: resolutionId };

    const previous = this.preparedResolution.option.label;
    // A customer override replaces the agent's reasoning: it no longer explains
    // what is staged, so it is not shown against an option it never argued for.
    this.preparedResolution = { option: opt, reason: null, preparedBy: 'CUSTOMER', preparedAt: this.clock() };
    this.log('CUSTOMER', `Selected ${opt.label} instead of ${previous}`, { resolutionId: opt.id, replaced: previous });
    this.assertInvariants();
    return { ok: true, resolution: this.buildPreparedPayload() };
  }

  /**
   * THE consequential act. Approves and executes in one customer action.
   *
   * There is no agent-callable equivalent. `resolutionId` is required and must
   * match what is staged, so a commit raised against a stale view is refused.
   */
  commit({ resolutionId, actor = 'CUSTOMER' } = {}) {
    if (actor !== 'CUSTOMER') {
      return { ok: false, error: 'Only the customer can complete a resolution', attemptedBy: actor };
    }
    if (this.state === STATES.RESOLVED) {
      return {
        ok: false, error: 'This resolution has already been completed',
        currentState: this.state, resolutionResult: this.resolutionResult,
      };
    }
    if (this.state !== STATES.RESOLUTION_PREPARED) {
      return { ok: false, error: 'There is no prepared resolution to complete', currentState: this.state };
    }

    const staged = this.preparedResolution.option;
    if (resolutionId && resolutionId !== staged.id) {
      return {
        ok: false,
        error: 'The prepared resolution is not the one supplied',
        supplied: resolutionId, prepared: staged.id,
        hint: 'The selection changed. Re-read the order before completing.',
      };
    }

    const result = {
      resolutionId: staged.id,
      type: staged.type,
      referenceId: resolutionResultId(this.order, staged.type),
      customerReceives: staged.customerReceives,
      economicImpact: staged.economicImpact,
      timing: staged.timing,
      returnRequired: staged.returnRequired,
      requirements: staged.requirements,
      completedAt: this.clock(),
      committedBy: 'CUSTOMER',
      status: 'completed',
    };

    this.resolutionResult = result;
    this.committedAt = result.completedAt;
    this.committedBy = 'CUSTOMER';
    this.state = STATES.RESOLVED;

    this.log('CUSTOMER', `Approved and completed ${staged.label}`, { resolutionId: staged.id });
    this.log('SYSTEM', `Created ${result.referenceId}`, { referenceId: result.referenceId, resolutionId: staged.id });
    this.assertInvariants();
    return { ok: true, resolution: result };
  }

  cancel() {
    if (this.state !== STATES.RESOLUTION_PREPARED) {
      return { ok: false, error: 'Nothing to cancel', currentState: this.state };
    }
    const label = this.preparedResolution.option.label;
    this.preparedResolution = null;
    this.cancelledAt = this.clock();
    this.state = STATES.RESOLUTION_CANCELLED;
    this.log('CUSTOMER', `Cancelled ${label}`, {});
    this.assertInvariants();
    return { ok: true, state: this.state };
  }

  // ── payloads the agent reads ──────────────────────────────────────

  buildPreparedPayload() {
    if (!this.preparedResolution) return null;
    const p = this.preparedResolution;
    const committed = this.state === STATES.RESOLVED;
    return {
      resolutionId: p.option.id,
      type: p.option.type,
      label: p.option.label,
      status: committed ? 'completed' : 'prepared',
      customerReceives: p.option.customerReceives,
      economicImpact: p.option.economicImpact,
      timing: p.option.timing,
      returnRequired: p.option.returnRequired,
      requirements: p.option.requirements,
      agentReasoning: p.reason,
      preparedBy: p.preparedBy,
      // These two must always be opposites and always match the real state.
      committedByCustomer: committed,
      requiresCustomerCommitment: !committed,
      nextStep: committed
        ? 'The customer completed this resolution. Nothing further is required.'
        : 'The customer completes this themselves in the page. You cannot complete it for them.',
    };
  }

  buildOrderPayload() {
    const o = this.order;
    const resolved = this.state === STATES.RESOLVED;
    const payload = {
      orderId: o.orderId,
      product: o.product,
      price: o.price,
      currency: o.currency,
      status: o.status,
      orderedDate: o.orderedDate,
      promisedDate: o.promisedDate,
      deliveredDate: o.deliveredDate,
      issue: {
        type: this.issue.type,
        headline: this.issue.headline,
        description: this.issue.description,
        reportedDate: this.issue.reportedDate,
      },
      customerContext: this.scenario.customerContext,
      resolutionState: this.state,
      // Folded in from the former get_resolution_options tool: across 42 M2
      // runs the agent called that tool immediately after get_order every
      // single time and never alone, so the split only cost a round trip.
      resolutionOptions: resolved ? [] : this.options,
      optionsNote: resolved
        ? 'This order has been resolved. No further resolutions are available.'
        : 'These are the only resolutions permitted by merchant policy for this order. Do not offer anything that is not in this list.',
      canPrepare: this.state === STATES.ORDER_ACTIVE || this.state === STATES.RESOLUTION_CANCELLED,
      resolution: null,
      resolutionResult: null,
    };
    if (o.orderedVariant) payload.orderedVariant = o.orderedVariant;
    if (o.receivedVariant) payload.receivedVariant = o.receivedVariant;

    if (this.preparedResolution) payload.resolution = this.buildPreparedPayload();
    if (this.resolutionResult) payload.resolutionResult = this.resolutionResult;
    return payload;
  }

  allowedTools() {
    return TOOLS_BY_STATE[this.state].slice();
  }
}
