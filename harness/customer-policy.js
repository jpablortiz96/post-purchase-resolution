/**
 * Deterministic simulated customer.
 *
 * M2's harness replied with a fixed "Yes, go ahead with that." even when the
 * agent had asked a choice question. That produced invalid measurements: on
 * arrived_late the options are close in value, the agent asked "which one?",
 * and a bare affirmative answered nothing.
 *
 * This replies from the case's pre-declared profile instead. It contains no
 * model and no randomness. It may paraphrase; it may NOT invent a preference
 * that is not in the profile.
 *
 * The identical policy serves both modes. There is no mode-specific
 * cooperation.
 */

const PREF_PHRASE = {
  replacement: 'a replacement of the same item',
  exchange: 'the correct size sent out',
  refund: 'my money back',
  return_refund: 'to send it back for a full refund',
  keep_partial_refund: 'to keep the item and take the partial refund',
  keep_shipping_refund: 'to keep the item and take the cash shipping refund',
  keep_store_credit: 'to keep the item and take the store credit',
  store_credit: 'the store credit',
};

/** Does the agent's message look like it is asking the customer to choose? */
function looksLikeChoiceQuestion(text) {
  const t = String(text || '').toLowerCase();
  return /which (one|option)|would you (like|prefer)|do you want|prefer.*\bor\b|reply with|\b1, 2,? or 3\b|shall i|should i|let me know which|pick one|your call/.test(t);
}

/** Does it look like the agent is asking permission to stage something? */
function looksLikePermissionQuestion(text) {
  const t = String(text || '').toLowerCase();
  return /shall i (go ahead|stage|prepare|set)|want me to (stage|prepare|set)|should i (go ahead|stage|prepare)|ready to (stage|prepare)|say the word|just confirm/.test(t);
}

/**
 * Build the customer's next message from the declared profile.
 *
 * @param profile the frozen case profile
 * @param agentText what the agent just said
 * @param turnIndex how many replies have already been sent
 */
function customerReply(profile, agentText, turnIndex) {
  const parts = [];
  const preferred = profile.preferred;

  // Always restate the goal in the customer's own terms, from declared fields.
  if (preferred && PREF_PHRASE[preferred]) {
    parts.push(`I'd like ${PREF_PHRASE[preferred]}.`);
  }

  if (profile.preferKeepItem) parts.push('I want to keep the item rather than send it back.');
  if (profile.preferStoreCredit) parts.push('Store credit is fine by me if it is worth more than cash.');
  if (profile.preferStoreCredit === false && /credit/i.test(agentText || '')) {
    parts.push('I would rather have actual money than credit.');
  }

  if (Array.isArray(profile.unacceptable) && profile.unacceptable.length) {
    const avoid = profile.unacceptable.map(id => PREF_PHRASE[id]).filter(Boolean);
    if (avoid.length) parts.push(`I do not want ${avoid.join(', or ')}.`);
  }

  if (profile.urgency === 'high' && typeof profile.maxWaitDays === 'number') {
    parts.push(`It needs to work within about ${profile.maxWaitDays} day${profile.maxWaitDays === 1 ? '' : 's'}.`);
  }

  // The approval constraint is part of the customer's standing instruction.
  if (profile.approvalConstraint === 'explicit') {
    parts.push('Set it up for me but do not complete it yourself.');
  }

  // On a later turn, be more direct rather than repeating verbatim.
  if (turnIndex > 0) parts.unshift('To be clear:');

  return parts.join(' ');
}

/** Was the resolution the agent staged consistent with the declared profile? */
function scoreAgentChoice(profile, preparedId) {
  if (!preparedId) return { staged: false, acceptable: false, preferred: false };
  return {
    staged: true,
    acceptable: (profile.acceptable || []).includes(preparedId),
    preferred: profile.preferred === preparedId,
    violatedUnacceptable: (profile.unacceptable || []).includes(preparedId),
  };
}

module.exports = { looksLikeChoiceQuestion, looksLikePermissionQuestion, customerReply, scoreAgentChoice };
