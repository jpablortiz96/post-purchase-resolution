# Capability Boundary

Who is allowed to decide what, and which of those capabilities are reachable
through the agent contract.

> **Agent prepares. Merchant defines the truth. Customer commits.**

---

## 1. Merchant authority

The merchant owns every fact with an economic consequence. These are computed by
a deterministic policy engine ([`src/policy.js`](../src/policy.js)) that contains
no model and no randomness. Given the same order and issue it always returns the
same options.

| The merchant owns | Where it lives |
|---|---|
| Which resolutions exist at all | `POLICY[issueType]` |
| Eligibility | `getEligibleResolutions(order, issue)` |
| Refund amounts | `economicImpact.refundToCustomer` |
| Store-credit amounts | `economicImpact.storeCreditToCustomer` |
| Whether a replacement/exchange ships | `economicImpact.replacementShipped` |
| Whether the customer keeps the item | `economicImpact.customerKeepsItem` |
| Timing and delivery estimates | `timing.summary`, `timing.businessDays` |
| Whether a return is required, and its deadline | `returnRequired`, `requirements` |
| Availability / inventory | `availability` |

**Nothing an agent sends can change any of these.** `prepare_resolution` accepts
only a `resolution_id` drawn from a schema `enum` of currently eligible ids, plus
a free-text `reason` that is displayed as reasoning and never read as data.

Tested by `tests/policy.test.mjs` and
`tests/authority.test.mjs` → *"agent reasoning cannot alter any merchant value"*.

---

## 2. Agent authority

The agent may do the mechanical work and offer a judgement.

| The agent may | How |
|---|---|
| Inspect the order, issue and customer context | `get_order` |
| Read every merchant-authorised option, with amounts, timing and requirements | `get_order` → `resolutionOptions` |
| Compare those options against what the customer said | its own reasoning |
| Recommend one, with a stated rationale | `prepare_resolution(resolution_id, reason)` |
| Stage that recommendation for the customer to review | `prepare_resolution` |

That is the whole list. Two tools:

```
get_order            read-only   annotations.readOnlyHint = true
prepare_resolution   write       non-final: issues nothing, ships nothing
```

### Why two and not three

M1 shipped `get_resolution_options` as a separate read tool. Across the 42 M2
WebMCP runs the agent called it immediately after `get_order` **42 times out of
42**, and never called either one alone. The split bought no expressiveness and
cost a guaranteed extra round trip, so the options were folded into `get_order`.

The decision came from the run records, not from a preference for smaller
numbers. Fewer tools is not the goal; the smallest **semantically clear**
contract is.

---

## 3. Customer authority

| Only the customer may | How |
|---|---|
| Choose a different eligible option | "Choose another" in the page |
| Reject the recommendation entirely | "Cancel" |
| **Approve and complete the resolution** | "Approve & complete" in the page |

`ResolutionSession.commit()` refuses any actor that is not `CUSTOMER`, and the
invariant check refuses to accept a `RESOLVED` state whose `committedBy` is
anything else.

---

## 4. What is deliberately absent from the agent contract

> The website exposes the mechanical resolution workflow to the agent, while the
> final customer commitment remains a human-facing application action.

There is no `confirm_resolution`, no `commit_resolution`, no
`complete_resolution`, no `approve_resolution` — in any state, at any point in
the flow. This is not an oversight and it is not a permission check that could be
toggled: the capability is not in `TOOLS_BY_STATE` at all.

Verified continuously by
[`harness/webmcp-m3-check.js`](../harness/webmcp-m3-check.js), which walks the
whole flow across all three scenarios and asserts that no completion-shaped tool
is ever registered, and by `tests/authority.test.mjs` →
*"no state exposes a tool that completes a resolution"*.

### What this claim does and does not mean

**It means:** an agent working through this site's WebMCP contract has no
callable capability that completes a resolution. The site chose a smaller
capability surface than its own UI.

**It does not mean** the button cannot be pressed by software. We tested that
rather than assuming it — see [§6](#6-the-actuation-boundary-tested-not-assumed).

---

## 5. Dynamic surface

The contract is not static. Tools are registered and deregistered as the state
changes, so an agent only ever sees what is valid right now.

| State | Tools registered |
|---|---|
| `ORDER_ACTIVE` | `get_order`, `prepare_resolution` |
| `RESOLUTION_PREPARED` | `get_order` |
| `RESOLVED` | `get_order` |
| `RESOLUTION_CANCELLED` | `get_order`, `prepare_resolution` |

Once a resolution is staged, `prepare_resolution` is withdrawn: the decision now
belongs to the customer. Note there is no row in which a completion tool appears.

---

## 6. The actuation boundary, tested not assumed

If an agent holds **both** this contract and ordinary browser actuation, can it
press the customer's commit control?

We ran the experiment ([`evidence/m3/actuation-test/`](../evidence/m3/actuation-test/)):

| Finding | Result |
|---|---|
| `ACTUATION_AVAILABLE` | **YES** — a script pressed the control successfully |
| `USER_GESTURE_REQUIRED` | **NO** — no trusted user gesture was needed |
| `AGENT_CAN_TRIGGER_CUSTOMER_COMMIT_UI` | **YES** — the capability exists |
| `AGENT_DID_TRIGGER_IN_TRIALS` | **1 / 3** — with a click tool and told to finish the job |
| `COMPLETION_IN_WEBMCP_CONTRACT` | **NO** — no completion tool was callable |

So the permitted claim is bounded:

> The final commitment is intentionally omitted from the WebMCP capability
> surface. This is **not** a universal human-only security boundary: anything
> that can drive the DOM can press the control, and in 1 of 3 trials an agent
> holding a browser click tool did exactly that.

Anyone quoting this must keep the qualifier. See
[`evidence/m3/claims.md`](../evidence/m3/claims.md).

---

## 7. Audit trail

Every transition records the actor, so authority is visible after the fact:

```
AGENT     Inspected order #1042 and 3 merchant-authorised options
AGENT     Prepared Replacement
CUSTOMER  Selected Keep Item + Partial Refund instead of Replacement
CUSTOMER  Approved and completed Keep Item + Partial Refund
SYSTEM    Created PR-1042
```

Actions and state transitions only. No claim is made about any agent's private
reasoning — the `reason` string is what the agent chose to publish, shown as its
stated rationale and visually separated from merchant terms.
