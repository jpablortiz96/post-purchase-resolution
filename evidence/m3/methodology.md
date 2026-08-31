# M3 — Methodology

## What changed from M2, and why

M2 ended CONDITIONAL PASS with two named defects in the *evaluation*, not the
product. M3 fixes both, and changes the product on the basis of what M2 measured.

### 1. The reply-policy confound

M2's simulated customer replied `"Yes, go ahead with that."` regardless of what
the agent asked. On `arrived_late` — where the options are close in value ($12
cash, $20 credit, $74 with a return) — the agent reasonably asked *"which one?"*,
and a bare affirmative answered nothing. Runs then exhausted their turn budget
with nothing staged, and the resulting per-scenario split measured the harness,
not the two modes.

**Fix.** Every case now declares a customer profile **before** execution:

```json
{ "goal": "keep_item_cash_compensation", "urgency": "low", "maxWaitDays": 7,
  "preferred": "keep_shipping_refund",
  "acceptable": ["keep_shipping_refund"],
  "unacceptable": ["return_refund", "keep_store_credit"],
  "preferKeepItem": true, "preferStoreCredit": false,
  "approvalConstraint": "explicit" }
```

[`harness/customer-policy.js`](../../harness/customer-policy.js) composes the
customer's reply from those declared fields. It contains no model and no
randomness. It may paraphrase; it may **not** invent a preference that is not in
the profile. The identical policy serves both modes — there is no mode-specific
cooperation.

### 2. The success model was doing two jobs

With commitment now a customer action, "did the task succeed" conflates a
question about the agent with a question about the product. They are separated:

- **Agent task success** — did the agent inspect, reason, and prepare a
  merchant-authorised resolution consistent with the declared profile, without
  committing on the customer's behalf? Scored against `acceptable`.
- **Customer completion success** — did the product then complete the selected
  resolution, recorded as committed by the customer?

A stricter secondary measure, **preferred match**, counts how often the agent
landed on the single best-fit option the customer declared.

---

## The held-out dataset

36 intents: 12 damaged, 12 wrong variant, 12 arrived late.

| | |
|---|---|
| File | `dataset/customer-intents-m3.json` |
| SHA256 | see `dataset/FROZEN.json` |
| Generation | hand-authored |
| Overlap with M2 prompts | **0**, verified programmatically |
| Frozen | before any M3 run; no prompt edited after results were seen |

Varied across language, urgency, clarity, stated preference, return constraints
and approval wording. No prompt contains a tool name or system terminology.

---

## The two modes

Unchanged from M2, so the comparison stays like-for-like:

| | MODE A — Human UI / browser | MODE B — WebMCP |
|---|---|---|
| Tools | `read_page`, `click(ref)` | `get_order`, `prepare_resolution` |
| Sees | rendered page text + referenced control list | structured JSON incl. every option |
| Product | identical live deployment | identical live deployment |

The baseline remains deliberately competent: it sees every merchant fact the
contract returns, reaches every control a customer can — including the commit
control — and gets the same model, system prompt, customer words and turn budget.

---

## Protocol (identical in both modes)

1. Reset; select the case's scenario.
2. **Turn 1** — the customer's words, verbatim from the frozen dataset.
3. If nothing is staged, the customer replies **from the profile**, up to 4 turns
   total. Clarification turns are counted and reported.
4. The **customer** presses "Approve & complete" in the product.

Step 4 is one action. There is no separate approve-then-wake-the-agent step,
because M2 showed that pattern completes 0/6 and 0/30.

---

## Metrics and their sources

All computed from the bridge's append-only log and the raw agent streams.

| Metric | Source |
|---|---|
| Agent task success | staged option ∈ profile `acceptable`, and no premature commitment |
| Preferred match | staged option === profile `preferred` |
| Customer completion success | final state RESOLVED, reference id exists, `committedBy === CUSTOMER` |
| Policy correctness | refined numeric traceability check, identical rule both modes |
| Premature commitment | RESOLVED before the customer pressed commit |
| Invalid actions | bridge log entries rejected |
| Stale attempts | commits refused for a mismatched resolution id |
| Clarification turns | replies generated from the profile |
| Time to prepared / completed | wall clock |
| Recovery rate | needed a clarification or hit an invalid action and still succeeded |

---

## Reproducing

```
node harness/bridge-m1.js                 # per mode, own port and OUT_DIR
node harness/run-evals-m3.js --mode webmcp
node harness/run-evals-m3.js --mode baseline
node harness/make-m3-report.js            # regenerates every reported number
node harness/webmcp-m3-check.js           # capability boundary, 22 checks
node harness/actuation-test.js            # actuation boundary probes
```

Run records are append-only: `run-evals-m3.js` refuses to overwrite an existing
record without `--force`.

**M2 and M3 are not pooled.** Different product, different methodology, different
dataset. They are reported separately and must be quoted separately.
