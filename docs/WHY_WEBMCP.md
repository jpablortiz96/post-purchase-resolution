# Why WebMCP here

An evidence-based answer, including the parts that did not go our way.

---

## 1. What the human website can do

A customer arriving at the page with no assistant at all can do the whole job:

- see the order, the reported issue and their own context
- see every resolution the merchant permits, with amounts, timing, whether a
  return is required, and the specific requirements
- choose one, review it, swap to a different one, or cancel
- **approve and complete it** — one action, one click

This matters for honesty about the comparison: the human UI is not a stub built
to lose. A gap found in the M1.1 production audit — that a customer could not
start a resolution unaided — was fixed *before* any comparison ran, which made
the browser baseline stronger, not weaker.

---

## 2. What is exposed to the agent

Two tools:

| Tool | Kind | What it does |
|---|---|---|
| `get_order` | read-only | order, issue, customer context, **every merchant-authorised option** with its amounts/timing/requirements, and the current resolution state |
| `prepare_resolution` | write, non-final | stages one eligible option for the customer, with the agent's stated reason |

`prepare_resolution` takes a `resolution_id` constrained by a schema `enum` to
the currently eligible ids, so the contract itself refuses an invented
resolution.

---

## 3. What is intentionally NOT exposed

**Completing a resolution.** There is no `confirm_resolution`,
`commit_resolution`, `complete_resolution` or `approve_resolution` in any state.

> The website exposes the mechanical resolution workflow to the agent, while the
> final customer commitment remains a human-facing application action.

The site deliberately publishes a **smaller** capability surface than its own UI.
That asymmetry is the design, not an omission.

**Bounded claim.** This is not a universal human-only security boundary. We
tested it: a script can press the commit control with no user gesture, and in
1 of 3 trials an agent holding both this contract *and* a browser click tool
pressed it when told to finish the job. See
[`evidence/m3/actuation-test/`](../evidence/m3/actuation-test/).

---

## 4. How dynamic state affects the tools

Tools are registered and withdrawn as state changes, using real WebMCP
`AbortController` lifecycle, so an agent only ever holds what is valid now.

```
ORDER_ACTIVE          get_order, prepare_resolution
RESOLUTION_PREPARED   get_order                       <- prepare withdrawn
RESOLVED              get_order
RESOLUTION_CANCELLED  get_order, prepare_resolution
```

Once something is staged, the decision belongs to the customer, and the tool that
would restage it is gone. No row contains a completion tool.

---

## 5. Deterministic merchant facts vs agent reasoning

They are separated in the data model and again in the interface.

- **Merchant facts** come from a deterministic policy engine with no model in it.
  The same order and issue always produce the same options, amounts and timings.
- **Agent reasoning** is a free-text `reason` the agent supplies. It is displayed
  under a dashed border reading *"Your assistant's reasoning — not merchant
  policy"*, visually distinct from the solid *"Merchant terms — fixed by
  policy"* block.
- The reasoning cannot change a single merchant value. If the customer swaps to a
  different option, the agent's reasoning is **dropped** rather than shown
  against an option it never argued for.

The app never claims the reasoning is *true* — only that it is the agent's, and
that it changed nothing.

---

## 6. What M2 taught us

30 matched customer tasks per mode, same live product, one browser-driving
baseline and one WebMCP contract.

| | Human UI baseline | WebMCP |
|---|---|---|
| Successful resolutions | 20/30 | 21/30 |
| Policy-clean runs | 30/30 | 30/30 |
| Invalid actions | 0 | 0 |
| Median customer turns | 3 | 3 |
| Median time to final | 50.6s | 54.2s |
| **Committed before explicit approval** | **7/30** | **0/30** |

Read that honestly:

- **WebMCP did not make the task more likely to succeed.** 21 vs 20 at n=30 is
  nothing.
- **It did not make it faster or shorter.** It was marginally slower.
- **It did not improve policy correctness** — because it did not need to. The
  human UI also shows only merchant truth, so neither mode invented a fact.
- **The difference was authority.** All 7 baseline premature commitments had the
  same shape: one ambiguous affirmative was taken as licence to stage, approve
  and execute in a single turn.

M2 also found that a customer who approves and then says nothing never resumes a
turn-based agent — 0/6 and 0/30 across both modes.

---

## 7. What changed in M3 because of that

1. **Final commitment removed from the agent contract.** If the measurable value
   is the authority boundary, the product should make that boundary structural
   rather than procedural. 4 tools → 2.
2. **Approval and execution collapsed into one customer action.** Asking someone
   to approve and then go wake their assistant up to execute was orchestration
   with no purpose; M2 showed it frequently just stalls.
3. **State machine simplified, 6 states → 4.** `HUMAN_APPROVED` and
   `RESOLUTION_EXECUTING` were unobservable once commitment became atomic, and an
   unobservable state name is the exact ambiguity that caused the M0.6 bug.
4. **The evaluation confound was fixed properly.** M2's harness replied "Yes, go
   ahead" even when the agent asked *which* option — invalid on `arrived_late`,
   where the options are close in value. M3 replies from a customer profile
   frozen before the run, identically in both modes.
5. **The actuation question was answered empirically** instead of being assumed,
   which is why the claim in §3 carries a qualifier.

---

## 8. So what is WebMCP actually good for here?

On this evidence, the defensible answer is narrow and worth stating plainly:

> **WebMCP let the site define a smaller callable capability surface than its own
> UI.** Inspection, comparison and preparation are exposed; final commitment is
> withheld. In M2, the browser-UI baseline committed before explicit approval in
> 7/30 matched tasks, and the WebMCP tool path in 0/30.

What we cannot claim from this work: that it is faster, that it makes agents
smarter, that it raises task success, that it prevents agents from clicking
things, or that it guarantees human consent. Every one of those was either
measured and found flat, or explicitly disproven.
