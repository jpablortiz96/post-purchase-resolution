/**
 * Resolution state machine.
 *
 * Pure: no DOM, no WebMCP, no network. Importable by tests.
 *
 * DESIGN NOTE — why these state names.
 *
 * M0.6 shipped a bug where a state called AWAITING_APPROVAL actually meant
 * "the human has already approved", and the payload said
 * requiresHumanApproval: true after approval. A real agent read that literally
 * and refused to finish the job. It was right; the app was lying.
 *
 * So every state here is named for what is TRUE, never for what is pending,
 * and every transition asserts its invariants. Two suggested states were
 * deliberately merged:
 *
 *   OPTIONS_AVAILABLE     - options are deterministic and synchronous, so they
 *                           exist the instant the order does. A separate state
 *                           would never be observably distinct from ORDER_ACTIVE.
 *   AWAITING_HUMAN_DECISION - identical condition to RESOLUTION_PREPARED.
 *                           Two names for one condition is the exact ambiguity
 *                           that produced the M0.6 bug.
 */

import { getEligibleResolutions, getResolutionOption, resolutionResultId } from './policy.js';
import { getScenario } from './fixtures.js';

export const STATES = {
  ORDER_ACTIVE: 'ORDER_ACTIVE',
  RESOLUTION_PREPARED: 'RESOLUTION_PREPARED',
  HUMAN_APPROVED: 'HUMAN_APPROVED',
  RESOLUTION_EXECUTING: 'RESOLUTION_EXECUTING',
  RESOLVED: 'RESOLVED',
  RESOLUTION_CANCELLED: 'RESOLUTION_CANCELLED',
};

/**
 * Which tools may be registered in each state.
 * An agent should only ever see tools that are valid right now.
 */
export const TOOLS_BY_STATE = {
  ORDER_ACTIVE:          ['get_order', 'get_resolution_options', 'prepare_resolution'],
  RESOLUTION_PREPARED:   ['get_order', 'get_resolution_options'],
  HUMAN_APPROVED:        ['get_order', 'get_resolution_options', 'confirm_resolution'],
  RESOLUTION_EXECUTING:  ['get_order', 'get_resolution_options'],
  RESOLVED:              ['get_order'],
  RESOLUTION_CANCELLED:  ['get_order', 'get_resolution_options', 'prepare_resolution'],
};

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
    this.humanApproved = false;
    this.approvedAt = null;
    this.resolutionResult = null;
    this.cancelledAt = null;
    this.audit = [];
    this.assertInvariants();
    return this;
  }

  get order() { return this.scenario.order; }
  get issue() { return this.scenario.issue; }

  // ── invariants ────────────────────────────────────────────────────

  assertInvariants() {
    const s = this.state;
    const fail = (msg) => { throw new InvariantViolation(`[${s}] ${msg}`); };

    if (!TOOLS_BY_STATE[s]) fail('unknown state');

    switch (s) {
      case STATES.ORDER_ACTIVE:
        if (this.humanApproved !== false) fail('humanApproved must be false');
        if (this.preparedResolution !== null) fail('preparedResolution must be null');
        if (this.resolutionResult !== null) fail('resolutionResult must be null');
        break;

      case STATES.RESOLUTION_PREPARED:
        if (this.preparedResolution === null) fail('preparedResolution must not be null');
        if (this.humanApproved !== false) fail('humanApproved must be false');
        if (this.resolutionResult !== null) fail('resolutionResult must be null');
        break;

      case STATES.HUMAN_APPROVED:
        if (this.preparedResolution === null) fail('preparedResolution must not be null');
        if (this.humanApproved !== true) fail('humanApproved must be true');
        if (this.approvedAt === null) fail('approvedAt must be set');
        if (this.resolutionResult !== null) fail('resolutionResult must be null');
        break;

      case STATES.RESOLUTION_EXECUTING:
        if (this.preparedResolution === null) fail('preparedResolution must not be null');
        if (this.humanApproved !== true) fail('humanApproved must be true');
        if (this.resolutionResult !== null) fail('resolutionResult must be null');
        break;

      case STATES.RESOLVED:
        if (this.resolutionResult === null) fail('resolutionResult must not be null');
        if (this.humanApproved !== true) fail('humanApproved must be true');
        if (this.preparedResolution === null) fail('preparedResolution must not be null');
        break;

      case STATES.RESOLUTION_CANCELLED:
        if (this.preparedResolution !== null) fail('preparedResolution must be null');
        if (this.humanApproved !== false) fail('humanApproved must be false');
        if (this.resolutionResult !== null) fail('resolutionResult must be null');
        if (this.cancelledAt === null) fail('cancelledAt must be set');
        break;
    }

    // M0.6 REGRESSION GUARD.
    // The payload an agent reads must never contradict the approval fact.
    const payload = this.buildOrderPayload();
    const r = payload.resolution;
    if (r) {
      if (r.humanApproved !== this.humanApproved) {
        fail(`payload humanApproved (${r.humanApproved}) contradicts session (${this.humanApproved})`);
      }
      if (r.requiresHumanApproval === this.humanApproved) {
        fail(`payload requiresHumanApproval (${r.requiresHumanApproval}) contradicts humanApproved (${this.humanApproved})`);
      }
    }
  }

  // ── audit ─────────────────────────────────────────────────────────

  log(actor, action, metadata) {
    this.audit.push({
      actor, action,
      timestamp: this.clock(),
      metadata: metadata || {},
    });
  }

  // ── transitions ───────────────────────────────────────────────────

  /** AGENT (or human) stages an option. Non-final: issues nothing. */
  prepare({ resolutionId, reason, actor = 'AGENT' }) {
    if (this.state !== STATES.ORDER_ACTIVE && this.state !== STATES.RESOLUTION_CANCELLED) {
      return {
        ok: false,
        error: 'Cannot prepare a resolution in the current state',
        currentState: this.state,
        hint: this.state === STATES.RESOLUTION_PREPARED
          ? 'A resolution is already prepared and is waiting for the customer to decide.'
          : 'This order already has a resolution in progress or completed.',
      };
    }

    const opt = getResolutionOption(this.order, this.issue, resolutionId);
    if (!opt) {
      return {
        ok: false,
        error: 'Not an eligible resolution for this order',
        requested: resolutionId,
        eligible: getEligibleResolutions(this.order, this.issue).map(o => o.id),
      };
    }

    this.preparedResolution = { option: opt, reason: reason || null, preparedBy: actor, preparedAt: this.clock() };
    this.cancelledAt = null;
    this.state = STATES.RESOLUTION_PREPARED;
    this.log(actor, `Prepared ${opt.label}`, { resolutionId: opt.id, reason: reason || null });
    this.assertInvariants();
    return { ok: true, resolution: this.buildPreparedPayload() };
  }

  /** HUMAN picks a different eligible option from the decision card. */
  chooseAnother(resolutionId) {
    if (this.state !== STATES.RESOLUTION_PREPARED) {
      return { ok: false, error: 'No resolution is currently awaiting a decision', currentState: this.state };
    }
    const opt = getResolutionOption(this.order, this.issue, resolutionId);
    if (!opt) {
      return { ok: false, error: 'Not an eligible resolution for this order', requested: resolutionId };
    }
    const previous = this.preparedResolution.option.label;
    // A human override replaces the agent's reasoning — it is no longer the
    // explanation for what is staged.
    this.preparedResolution = { option: opt, reason: null, preparedBy: 'HUMAN', preparedAt: this.clock() };
    this.state = STATES.RESOLUTION_PREPARED;
    this.log('HUMAN', `Chose ${opt.label} instead of ${previous}`, { resolutionId: opt.id, replaced: previous });
    this.assertInvariants();
    return { ok: true, resolution: this.buildPreparedPayload() };
  }

  /** HUMAN approves. This is the only path to HUMAN_APPROVED. */
  approve() {
    if (this.state !== STATES.RESOLUTION_PREPARED) {
      return { ok: false, error: 'Nothing is prepared to approve', currentState: this.state };
    }
    this.humanApproved = true;
    this.approvedAt = this.clock();
    this.state = STATES.HUMAN_APPROVED;
    this.log('HUMAN', `Approved ${this.preparedResolution.option.label}`, {
      resolutionId: this.preparedResolution.option.id,
    });
    this.assertInvariants();
    return { ok: true, state: this.state };
  }

  /** HUMAN cancels. Clears the staged option and the approval. */
  cancel() {
    if (this.state !== STATES.RESOLUTION_PREPARED && this.state !== STATES.HUMAN_APPROVED) {
      return { ok: false, error: 'Nothing to cancel', currentState: this.state };
    }
    const label = this.preparedResolution ? this.preparedResolution.option.label : 'resolution';
    this.preparedResolution = null;
    this.humanApproved = false;
    this.approvedAt = null;
    this.cancelledAt = this.clock();
    this.state = STATES.RESOLUTION_CANCELLED;
    this.log('HUMAN', `Cancelled ${label}`, {});
    this.assertInvariants();
    return { ok: true, state: this.state };
  }

  /**
   * AGENT executes. Consequential.
   * Requires: prepared, human-approved, and the id must match what is staged.
   */
  confirm({ resolutionId, actor = 'AGENT' }) {
    if (this.state === STATES.RESOLVED) {
      return {
        ok: false, error: 'This resolution has already been completed',
        currentState: this.state, resolutionResult: this.resolutionResult,
      };
    }
    if (this.state === STATES.RESOLUTION_EXECUTING) {
      return { ok: false, error: 'This resolution is already being executed', currentState: this.state };
    }
    if (this.state === STATES.RESOLUTION_PREPARED) {
      return {
        ok: false,
        error: 'The customer has not approved this resolution yet',
        currentState: this.state,
        humanApproved: false,
        hint: 'The resolution is staged but the customer has not approved it in the page UI.',
      };
    }
    if (this.state !== STATES.HUMAN_APPROVED) {
      return { ok: false, error: 'No approved resolution to execute', currentState: this.state };
    }

    // Staleness guard: the human may have swapped the option after the agent
    // read it. Executing the wrong one would be a consequential mistake.
    const staged = this.preparedResolution.option;
    if (resolutionId && resolutionId !== staged.id) {
      return {
        ok: false,
        error: 'The approved resolution is not the one supplied',
        supplied: resolutionId,
        approved: staged.id,
        hint: 'The customer changed the selection. Re-read the order before confirming.',
      };
    }

    this.state = STATES.RESOLUTION_EXECUTING;
    this.assertInvariants();

    const result = {
      resolutionId: staged.id,
      type: staged.type,
      referenceId: resolutionResultId(this.order, staged.type),
      customerReceives: staged.customerReceives,
      economicImpact: staged.economicImpact,
      timing: staged.timing,
      returnRequired: staged.returnRequired,
      requirements: staged.requirements,
      executedAt: this.clock(),
      status: 'completed',
    };

    this.resolutionResult = result;
    this.state = STATES.RESOLVED;
    this.log('SYSTEM', `Executed ${staged.label} — ${result.referenceId}`, {
      resolutionId: staged.id, referenceId: result.referenceId,
    });
    this.assertInvariants();
    return { ok: true, resolution: result };
  }

  // ── payloads read by the agent ────────────────────────────────────

  buildPreparedPayload() {
    if (!this.preparedResolution) return null;
    const p = this.preparedResolution;
    return {
      resolutionId: p.option.id,
      type: p.option.type,
      label: p.option.label,
      status: this.humanApproved ? 'approved_by_customer' : 'prepared',
      customerReceives: p.option.customerReceives,
      economicImpact: p.option.economicImpact,
      timing: p.option.timing,
      returnRequired: p.option.returnRequired,
      requirements: p.option.requirements,
      agentReasoning: p.reason,
      preparedBy: p.preparedBy,
      // These two are the M0.6 regression surface. They must always agree
      // with the session, and must always be opposites of each other.
      humanApproved: this.humanApproved,
      requiresHumanApproval: !this.humanApproved,
      nextStep: this.humanApproved
        ? 'The customer has approved. This resolution is ready to be finalized.'
        : 'Waiting for the customer to approve this resolution in the page UI.',
    };
  }

  buildOrderPayload() {
    const o = this.order;
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
      resolution: null,
      resolutionResult: null,
    };
    if (o.orderedVariant) payload.orderedVariant = o.orderedVariant;
    if (o.receivedVariant) payload.receivedVariant = o.receivedVariant;

    if (this.preparedResolution) payload.resolution = this.buildPreparedPayload();
    if (this.resolutionResult) payload.resolutionResult = this.resolutionResult;
    return payload;
  }

  buildOptionsPayload() {
    const resolvedOrDone = this.state === STATES.RESOLVED;
    return {
      orderId: this.order.orderId,
      issueType: this.issue.type,
      options: resolvedOrDone ? [] : getEligibleResolutions(this.order, this.issue),
      selectable: this.state === STATES.ORDER_ACTIVE || this.state === STATES.RESOLUTION_CANCELLED,
      note: resolvedOrDone
        ? 'This order has already been resolved. No further resolutions are available.'
        : 'These are the only resolutions permitted by merchant policy for this order.',
    };
  }

  allowedTools() {
    return TOOLS_BY_STATE[this.state].slice();
  }
}
