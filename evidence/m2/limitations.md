# M2 — Limitations and Claim Discipline

Read this before quoting any M2 number.

---

## 1. Sample size

30 matched intents per mode, one run each for the main comparison. That supports
statements of the form *"across these 30 matched customer tasks…"* and nothing
stronger. It does **not** support:

- a reliability figure for production traffic
- a claim that a difference would hold at n=1000
- statistical significance testing (none was performed)

Run-to-run variation is real and was directly observed in M1: whether the agent
finalises on a bare `"Continue."` changed between runs of an identical setup.
Single runs therefore measure *whether a path works*, not *how often*.

---

## 2. One model, one configuration

All runs use a single model at its default settings, in the Claude Code CLI
acting as a generic MCP host. A different model, or a different agent product,
could distribute these results differently. Both modes always use the same
model, so the *comparison* is internally fair even though the absolute numbers
are model-specific.

---

## 3. The baseline is a good-faith reconstruction, not a shipped browser agent

`read_page` + `click(ref)` mirrors how real browser agents work (accessibility
tree plus refs), but it is our implementation, not ChatGPT Operator, Claude in
Chrome, or any commercial product. A different browser agent could be better or
worse at this UI.

What the baseline is **not**: deliberately crippled. It sees every merchant fact
the WebMCP tools return, reaches every control a customer can, and gets the same
model, prompt and turn budget. See `methodology.md` §"The baseline is
deliberately competent".

---

## 4. Approval violations measure exposure, not misbehaviour

In WebMCP mode this metric is **structurally zero** — there is no approval tool
in any state, so the agent cannot press consent no matter what it decides.

In baseline mode the agent *can* press it, because a click is a click.

So a difference here is not evidence that one agent is better behaved. It is
evidence that **the WebMCP contract removes the possibility**, while the human UI
cannot distinguish an agent's click from a customer's. That is the honest claim,
and it is the one made.

---

## 5. Policy correctness is a heuristic

It extracts `$` amounts and day counts from the agent's text and checks them
against the scenario's policy. It will:

- **miss** an invented fact expressed without a number ("we can expedite this")
- **false-positive** on a number used incidentally (an order number, a date)

Flagged runs are candidates for review, listed in the failures directory. The
metric is reported as "policy-clean runs", not "hallucination rate".

---

## 6. Timings include model latency

`time to prepared` and `time to final` are wall-clock and dominated by model
inference and process startup, not by the product. They are useful for comparing
the two modes *under identical conditions* and are meaningless as a production
performance claim.

---

## 7. Fixtures, not commerce

Unchanged from M1: three deterministic fixtures. No real orders, refunds,
inventory, carriers or payment rails. The resolution is real inside the state
machine; nothing external is contacted.

---

## 8. ChatGPT in-app browser — still PENDING

`CHATGPT_IN_APP_BROWSER = PENDING`, unchanged since M0.6. The protocol in
`../m0-agent/chatgpt-protocol.md` needs a human with the ChatGPT app. Nothing in
M2 changes this, and no claim about ChatGPT is made anywhere.

---

## 9. What is measured vs what is hypothesised

**Measured** (see `reports/comparison.md`): successful resolutions, policy-clean
runs, invalid actions, approval violations, customer turns, agent tool calls,
time to prepared/final, recovery, state errors — across 30 matched tasks per
mode on the live deployment.

**Not measured, and therefore not claimed:**

- customer satisfaction
- support-cost reduction
- merchant cost savings
- conversion or retention effects
- productivity gains of any kind
- anything about real merchants or real money

The business paths in the final report are **hypotheses**, explicitly labelled as
such. No revenue claim is validated by anything in this directory.
