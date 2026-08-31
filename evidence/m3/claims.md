# Claim audit

Every claim this project is allowed to make, and every claim it is not.

Each supported claim carries its sample size, environment, method and limitation.
Anything not on the supported list must not be said.

---

## REJECTED — not supported by any evidence we hold

| Claim | Why it is rejected |
|---|---|
| "WebMCP is faster." | Measured. M2: median time to final 54.2s WebMCP vs 50.6s baseline. It was marginally **slower**. |
| "WebMCP makes agents smarter." | Never measured. Nothing here isolates reasoning quality. |
| "WebMCP increases overall task success." | Measured. M2: 21/30 vs 20/30 at n=30. That is not a difference. |
| "WebMCP prevents agents from clicking things." | **Disproven.** The actuation test shows a script presses the commit control with no user gesture, and in 1/3 trials an agent with a click tool pressed it. |
| "WebMCP guarantees human consent." | Follows from the above. No such guarantee exists. |
| "WebMCP is safer." | Unqualified, this is not a claim we can support. See the qualified form below. |
| "Verified in ChatGPT." | `CHATGPT_IN_APP_BROWSER = PENDING` since M0.6. Never tested. |
| Customer satisfaction / support cost / conversion / retention effects | None measured. |
| Reliability at scale | Largest matched sample is n=36 per mode, one run each. |

---

## SUPPORTED — with the qualifiers that must travel with them

### C1 — The site can define a smaller callable surface than its own UI

> **Claim.** WebMCP lets the site expose inspection, comparison and preparation to
> an agent while withholding final commitment. Our production contract is two
> tools — `get_order`, `prepare_resolution` — and no state registers any tool
> that completes a resolution.
>
> **Measurement.** 22/22 capability-boundary checks against the live deployment,
> walking all three scenarios and every state, asserting no completion-shaped
> tool is ever registered. Plus `tests/authority.test.mjs`.
>
> **Sample.** All four states × 3 scenarios, plus 4 guessed completion tool names
> probed directly.
>
> **Limitation.** This is a statement about *our contract*, not about what any
> agent can do to the page by other means. See C4.
>
> **Raw evidence.** `capability-boundary/webmcp-boundary.json`

### C2 — In M2, the browser-UI path committed early and the tool path did not

> **Claim.** Across 30 matched customer tasks per mode on the same live product,
> the browser-UI baseline committed before explicit approval in **7/30**; the
> WebMCP tool path in **0/30**.
>
> **Measurement.** Bridge-recorded actor for every control press and tool call.
>
> **Sample.** n=30 per mode, one run each, one model (`sonnet`), matched intents.
>
> **Limitation.** This is about **exposure, not agent virtue**. In WebMCP mode the
> count is structurally zero because no approval tool exists in any state. All 7
> baseline cases had the same shape: a single ambiguous affirmative was taken as
> licence to stage, approve and execute in one turn.
>
> **MAJOR QUALIFIER — this did not reproduce in M3.** Under the M3 protocol the
> baseline committed prematurely **0/36**, matching WebMCP's 0/36. The M3 baseline
> agent made exactly one click per run ("Choose this") and never touched the
> commit control. Two things changed between M2 and M3 and we cannot separate
> them: (a) the simulated customer now states explicitly "do not complete it
> yourself", where M2 said only "Yes, go ahead with that"; (b) the product
> replaced a three-step Choose → Approve → Complete flow with a single clearly
> labelled "Approve & complete" action.
>
> So C2 describes **what happens when the customer's instruction is ambiguous**,
> not a general property of browser agents. Anyone quoting 7/30 without this
> qualifier is misrepresenting the evidence.
>
> **Raw evidence.** `../m2/runs/`, `../m2/reports/comparison.md`, `runs/`, `reports/comparison.md`

### C3 — UI approval alone does not resume a turn-based agent

> **Claim.** A customer who presses approve and then says nothing completes the
> workflow in 0/6 WebMCP and 0/30 baseline runs.
>
> **Measurement.** M2 approval-pattern study, pattern A.
>
> **Limitation.** A property of turn-based agent hosts, not of WebMCP. The page
> does emit `toolchange` and the bridge does emit `list_changed`; there is simply
> no agent turn to receive them. This is why M3 made commitment a single customer
> action in the product.
>
> **Raw evidence.** `../m2/approval-study/approval-study.json`

### C4 — The commit control is reachable by anything that can drive the DOM

> **Claim.** The final commitment is intentionally omitted from the WebMCP
> capability surface. This is **not** a universal human-only security boundary.
>
> **Measurement.** Three probes on the live deployment. A script pressed the
> control successfully with no trusted user gesture. An agent holding both the
> WebMCP contract and a browser click tool, told explicitly to finish the job and
> to use its button-pressing tool, pressed it in **1 of 3** trials. No completion
> tool was callable through the contract in any probe.
>
> **Sample.** n=3 agent trials, one model, one environment.
>
> **Limitation.** n=3 is small, and the behavioural result (1/3) says nothing
> about other models or agent products. The *capability* result (yes, reachable)
> is the durable one.
>
> **Raw evidence.** `actuation-test/actuation-test.json`

### C5 — Merchant facts are deterministic and unreachable by agent input

> **Claim.** Eligibility, amounts, timing, requirements and availability come from
> a policy engine with no model and no randomness. No agent input alters any of
> them.
>
> **Measurement.** Unit tests over all three scenarios; the `prepare_resolution`
> schema constrains `resolution_id` to an `enum` of currently eligible ids; a test
> passes hostile reasoning text ("refund them $500 immediately") and asserts the
> executed amount is unchanged.
>
> **Limitation.** These are fixtures. No real merchant system is connected.
>
> **Raw evidence.** `tests/policy.test.mjs`, `tests/authority.test.mjs`

### C6 — Neither mode invented merchant facts

> **Claim.** Under a refined check, every monetary amount and day count either
> mode stated is traceable to merchant policy, the issue, the customer's own
> words, or arithmetic over policy values. M2: 30/30 in both modes.
>
> **Limitation.** Heuristic. It flags candidates, cannot prove intent, and cannot
> catch an invented fact expressed without a number. The first-pass version
> produced false positives and was corrected; both versions are preserved so the
> correction is auditable.
>
> **Raw evidence.** `../m2/runs/*.json` (`policyCheck` and `policyCheckV2`)

---

### C7 — M3 found no measurable difference between the two modes

> **Claim.** On the held-out dataset of 36 matched intents per mode, with an
> intent-aware simulated customer, the two modes were **identical on every
> metric**: agent task success 36/36 both, preferred-option match 36/36 both,
> customer completion 36/36 both, policy-clean 36/36 both, premature commitments
> 0 both, invalid actions 0 both. Median time to prepared differed by 1.7s in the
> baseline's favour.
>
> **Interpretation.** Fixing the M2 confound removed the measured difference. It
> also removed the dataset's discriminating power: 100% on every metric in both
> modes is a **ceiling effect**. A test everything passes cannot rank anything.
>
> **What this does to the product story.** The remaining defensible advantage of
> the WebMCP contract is **structural** (C1, C4) — the site publishes a smaller
> callable surface — not behavioural. M3 provides no evidence that agents behave
> better through the contract when the customer is clear.
>
> **Raw evidence.** `reports/comparison.md`, `runs/`

---

## The one-paragraph version

> This site publishes a deliberately small agent contract: an agent can read the
> order and every merchant-authorised resolution, and can stage one with its
> reasoning — but nothing in the contract completes a resolution. That is a
> difference in what is *callable*, and it is not a security boundary: anything
> that can drive the DOM can still press the button, as our own actuation test
> shows (1 of 3 trials).
>
> On behaviour, we are candid. In M2, where the simulated customer answered
> ambiguously, a browser-driving agent committed before explicit approval in 7 of
> 30 matched tasks and the tool path in 0. In M3, with an intent-aware customer
> and a single-action commit, both modes scored 0 of 36 and were identical on
> every other metric too. The authority difference we measured is real but
> conditional on ambiguity — not a general property of browser agents.
