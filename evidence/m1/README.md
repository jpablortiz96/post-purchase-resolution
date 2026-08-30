# M1 — Resolution Engine Evidence

A deterministic post-purchase resolution product over a generic WebMCP contract:
three issue types, three policy-valid resolutions each, agent recommendation,
visible human approval, generic execution, auditable outcome.

> Read [`limitations.md`](limitations.md) before quoting anything here.
> `CHATGPT_IN_APP_BROWSER` is still **PENDING**.

---

## 1. What changed from M0

M0 was one hard-coded path: damaged headphones → replacement, with a tool per
step (`prepare_replacement`, `confirm_replacement`).

M1 separates three concerns that were previously tangled:

| Layer | Owns | Where |
|---|---|---|
| **Policy engine** | eligibility, amounts, timing, requirements, availability | [`src/policy.js`](../../src/policy.js) |
| **State machine** | what is true now, what may happen next, invariants | [`src/state.js`](../../src/state.js) |
| **Agent** | reading the options and recommending one, with reasoning | external, via WebMCP |
| **Human** | the consequential decision | the Approve control, not a tool |

The policy engine contains no model and no randomness. An agent can read options
and recommend one; it can never add an option, change an amount, or declare
something eligible.

---

## 2. Tool contract — audited down to four

The brief suggested five tools. `get_resolution_status` was **dropped**:
`get_order` already returns `resolutionState`, and once resolved,
`resolutionResult`. A second read tool for the same truth is a tool per UI state,
which the brief lists as a failure condition.

| Tool | Kind | Registered in |
|---|---|---|
| `get_order` | read (`readOnlyHint: true`) | every state |
| `get_resolution_options` | read (`readOnlyHint: true`) | every state except `RESOLVED` |
| `prepare_resolution` | write, non-final | `ORDER_ACTIVE`, `RESOLUTION_CANCELLED` |
| `confirm_resolution` | write, consequential | **only** `HUMAN_APPROVED` |

`prepare_resolution`'s input schema carries an `enum` of exactly the currently
eligible option ids, so the contract itself refuses an invented resolution — and
the enum follows the scenario (verified: test O2).

There is no `approve` tool. Approval is not reachable through WebMCP in any state.

---

## 3. State machine — six states, named for what is true

```
ORDER_ACTIVE ──prepare──> RESOLUTION_PREPARED ──approve──> HUMAN_APPROVED
     ^                          │      │                        │
     │                       cancel  choose another          confirm
     │                          v      (stays prepared)         v
     └──────────────── RESOLUTION_CANCELLED          RESOLUTION_EXECUTING ──> RESOLVED
```

Two suggested states were merged, with reason:

- `OPTIONS_AVAILABLE` — options are deterministic and synchronous, so they exist
  the instant the order does. Never observably distinct from `ORDER_ACTIVE`.
- `AWAITING_HUMAN_DECISION` — identical condition to `RESOLUTION_PREPARED`.

Two names for one condition is precisely the ambiguity that produced the M0.6
bug, so collapsing them is a fix rather than a shortcut.

Every transition calls `assertInvariants()`, which throws rather than continuing
in a contradictory state.

---

## 4. The M0.6 bug has a regression test

The shipped M0.6 defect: after the human approved, the payload still said
`status: "awaiting_human_approval"` and `requiresHumanApproval: true`. A real
agent believed it and refused to finish.

Three separate guards now exist:

1. `buildPreparedPayload()` derives `requiresHumanApproval` as `!humanApproved`,
   so they cannot drift apart.
2. `assertInvariants()` **fails the transition** if the payload ever contradicts
   the session — checked on every state change.
3. Tests assert it directly, including an exhaustive walk over five transition
   paths across all three scenarios
   (`tests/invariants.test.mjs`), and against the **live deployment**
   (`webmcp-lifecycle.json`, test L).

---

## 5. Results

| Suite | Result | Artifact |
|---|---|---|
| Policy engine | 10/10 | `tests/policy.test.mjs` |
| State machine | 18/18 | `tests/state.test.mjs` |
| Security / approval gate | 9/9 | `tests/security.test.mjs` |
| Invariants + M0.6 regression | 12/12 | `tests/invariants.test.mjs` |
| WebMCP lifecycle (live) | 23/23 | [`webmcp-lifecycle.json`](webmcp-lifecycle.json) |
| Agent smoke, 3 scenarios | see [`agent-smoke.json`](agent-smoke.json) | raw transcripts below |

Run the deterministic suites with `node --test "tests/*.test.mjs"`.

---

## 6. Agent smoke test

One natural-language flow per scenario, against the **live deployment**. The
agent received the prompt and nothing else — no tool names, no built-in tools
(`--tools ""`), no other MCP servers (`--strict-mcp-config`).

Prompts used are exactly those in the M1 brief §20.

| Scenario | Agent chose | Nudge needed | Finalized early | Final |
|---|---|---|---|---|
| DAMAGED | `replacement` | no | **no** | `RESOLVED` · `R-1042` |
| WRONG_VARIANT | `exchange` | no | **no** | `RESOLVED` · `X-2087` |
| ARRIVED_LATE | `keep_store_credit` | no | **no** | `RESOLVED` · `SC-3155` |

In all three the agent read the order, read the options, and picked one on its
own — no follow-up was needed to get it to stage anything.

### It reasoned over the structured options, not over the UI

Verbatim, written by the agent into `prepare_resolution`:

> **WRONG_VARIANT** — "The Size 9 is in stock and arrives in 2 days — the only
> option that delivers wearable shoes before the event. Refund (3–5 days) and
> store credit both leave the customer without shoes in time, despite store
> credit's slightly higher value."

> **ARRIVED_LATE** — "The gift arrived two days late but intact and still usable,
> so only the timing failed. This option keeps the item and provides the highest
> available compensation ($20 store credit vs. $12 shipping refund), applied
> immediately with no return needed."

Both compare options on `businessDays`, `storeCreditToCustomer` and
`customerKeepsItem` — fields the policy engine supplied. The agent never invented
an amount or a timing.

### Finding: a bare "Continue." is not a reliable resume signal

In this run all three scenarios **held** on `"Continue."` rather than finalizing.
One said:

> "I don't want to read 'Continue' as your approval, since you explicitly asked
> to be the one to sign off, and confirming is irreversible."

This is run-to-run variable — in an earlier run DAMAGED did resolve on the bare
`"Continue."`. It is defensible caution rather than a defect, and it is the
*safe* direction to fail in. But it means a resume message should say what
happened. The second turn used was `"I've approved it on the page."`, which names
no tool and does not say which option to use; all three then completed.

Per-case turn sequences are recorded in `agent-smoke.json` as
`resumedOnBareContinue` and `explicitApprovalMessageUsed`.

---

## 7. Files

| File | Contents |
|---|---|
| `agent-smoke.json` | Per-scenario turns, tool calls, states, pass/fail |
| `raw-smoke-*.jsonl` | Unedited agent stream transcripts, one per turn |
| `agent-tools.jsonl` | Every agent tool call: args, result, state before/after |
| `agent-events.jsonl` | Page console, `toolchange`, human actions, screenshots |
| `webmcp-lifecycle.json` | 23 browser WebMCP checks against the live page |
| `ui_0*.png` | Product surface: initial, decision card, choose another, approved, resolved |
| `smoke_*_*.png` | Screenshots per scenario per stage |
| `webmcp_*.png` | Lifecycle verification screenshots |
| `limitations.md` | What this does **not** prove |
