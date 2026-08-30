# M1 — Limitations and Claim Discipline

Read this before quoting any M1 result.

---

## 1. These are fixtures, not commerce

The three orders are **deterministic hackathon fixtures implementing realistic
post-purchase policies**. They are not:

- real Shopify (or any merchant platform) orders
- real refunds, credits or payments
- real inventory or availability lookups
- real shipping bookings or carrier estimates

What *is* real: the resolution executes inside this application's state machine,
the state transitions are enforced, the approval gate is enforced, and the
reference id (`R-1042`, `SC-2087`, `RF-3155`, …) is a genuine record of what the
state machine executed. No external commerce system is connected.

`price`, `refundToCustomer`, `storeCreditToCustomer`, `businessDays`,
availability and requirements are all authored constants in
[`src/policy.js`](../../src/policy.js).

---

## 2. ChatGPT in-app browser — still PENDING

`CHATGPT_IN_APP_BROWSER = PENDING`, unchanged from M0.6.

The re-run protocol in [`../m0-agent/chatgpt-protocol.md`](../m0-agent/chatgpt-protocol.md)
has still not been executed — it needs a human with the ChatGPT app. Do not
claim "verified in ChatGPT" anywhere until it has been.

M1 was not blocked on this, per the brief. But M1 cannot be called
FINAL / SUBMISSION_READY while it is outstanding.

---

## 3. What the "real agent" is here

Same substitute environment as M0.6, and the same caveat applies: Claude Opus
driven by the Claude Code CLI acting as a generic MCP host, with the live page's
WebMCP tools bridged in. The agent had no built-in tools, no other MCP servers,
and was never given a tool name.

This proves *a real LLM* selects and drives the contract from natural language.
It does not prove *a specific commercial agent product* does — see §2.

---

## 4. Scope of the smoke test

§20 of the brief asks for **one** natural-language flow per scenario. That is what
this is. It is not the M2 benchmark:

- one prompt phrasing per scenario, not a phrasing sweep
- one model, at one temperature setting, one run each
- no adversarial prompting, no prompt-injection testing
- no measurement of how often the agent picks the *contextually best* option
  across repeated trials

Run-to-run variation was directly observed: whether the agent finalises on a bare
`"Continue."` after approval changed between runs of the identical setup. A
single passing run therefore says the path works, not how often it works.
Quantifying that is M2's job.

A single passing run per scenario is smoke verification, not a claim about
reliability. Where a run needed a second user turn, that is recorded explicitly
in `agent-smoke.json` as `nudgeUsed: true`, with the exact wording used.

---

## 5. What the approval gate does and does not prove

**Supported:**

> The workflow requires a visible approval step before execution becomes valid.

Three independent things hold that gate, and all three are tested:

1. `confirm_resolution` is **not registered** at all until the state is
   `HUMAN_APPROVED` — the agent cannot see a tool it must not use yet.
2. The state machine rejects `confirm` from any state other than
   `HUMAN_APPROVED`, so registration is not the only defence.
3. `confirm` carries a staleness check: if the human swapped the option after
   the agent read it, confirming the old id is rejected.

**Not supported, and not claimed:**

- ~~"The agent can never bypass human approval."~~
- ~~Cryptographic proof of human identity.~~ The Approve control is a button.
  Anything that can drive the page's DOM can press it. What the app guarantees
  is that *pressing it is a distinct, visible step that WebMCP does not expose*.

`approve` is not a WebMCP tool. It is not in `TOOLS_BY_STATE` in any state.

---

## 6. Agent reasoning is labelled, not verified

The decision card shows the agent's `reason` string under a dashed border reading
**"Agent reasoning — not merchant policy"**, visually separated from the solid
**"Merchant terms — fixed by policy"** block.

The application does **not** check whether the reasoning is accurate, honest, or
consistent with the option it accompanies. It only guarantees that the reasoning
cannot change any merchant fact. An agent could write a misleading justification
for a real, eligible option; the amounts and timings shown next to it would still
be the deterministic ones.

If the human picks a different option via "Choose another", the agent's reasoning
is dropped rather than shown against an option it never argued for.

---

## 7. State and persistence

- All state is in memory. A reload resets everything.
- Reference ids are deterministic from order + type, not generated or unique
  across runs — resolving `#1042` twice always yields `R-1042`.
- One session at a time; no concurrency, no multi-user, no auth.
- Scenario switching hard-resets the session, by design.

---

## 8. Environment

Chrome 151 with `--enable-features=WebMCPTesting,DevToolsWebMCPSupport` is a
**testing** configuration, not a shipping consumer browser setup. The M0.6
finding still applies: Chrome returns `inputSchema` and `annotations` from
`getTools()` as **serialized JSON strings**, so any WebMCP→MCP bridge must parse
them or every tool is silently dropped as schema-invalid.

---

## 9. Deliberate deviations from the M1 brief

Both were explicitly permitted ("audit whether all five are necessary", "do not
blindly implement this exact lifecycle if another version is cleaner"), and both
are argued rather than assumed:

**Four tools, not five.** `get_resolution_status` was dropped. `get_order`
already returns `resolutionState` and, once resolved, `resolutionResult`. A
second read tool for the same truth is a tool per UI state, which §22 lists as a
failure condition.

**Six states, not seven.** `OPTIONS_AVAILABLE` was merged into `ORDER_ACTIVE`
(options are deterministic and synchronous, so the two are never observably
distinct) and `AWAITING_HUMAN_DECISION` into `RESOLUTION_PREPARED` (identical
condition). Two names for one condition is exactly the ambiguity that produced
the M0.6 bug, so collapsing them is a fix, not a shortcut.
