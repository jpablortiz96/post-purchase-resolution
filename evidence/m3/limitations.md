# M3 — Limitations

Read before quoting any M3 number. See also [`claims.md`](claims.md) for the
explicit list of what may and may not be said.

---

## 1. The headline metric is now structural, not behavioural

**Premature commitments in WebMCP mode is zero by construction.** There is no
completion tool in the contract, so the agent cannot commit no matter what it
decides. Reporting "0" as though the agent earned it would be dishonest.

The honest framing: the site chose a smaller callable surface. Whether that
matters depends entirely on whether the agent also has DOM actuation — which is
exactly what §4 measures, and the answer is uncomfortable for a strong claim.

---

## 2. The actuation test is n=3

Probe 1 (mechanical) is decisive: a script presses the commit control, no user
gesture required. That result is durable.

Probe 2 (behavioural) is **n=3 trials, one model, one environment**, and it split
1/3. That is far too small to characterise how often an agent with both surfaces
would bypass the intended flow. It is enough to disprove "agents can't press it",
which is what it was for. It is not enough to estimate a rate.

---

## 2b. The dataset hit a ceiling

Every metric came back 36/36 in both modes. A dataset that everything passes
cannot discriminate between the things being compared.

The likely cause is the fix itself: giving each case an explicit, articulate
customer preference removed the ambiguity that made M2 hard — and ambiguity was
precisely where the two modes differed. The confound is gone; so is the signal.

A future dataset that wants discriminating power needs cases that are genuinely
hard: under-specified goals, conflicting constraints, preferences that no
eligible option satisfies, and customers who answer a different question than the
one asked. That is M4 work, and designing it *after* seeing these results would
be exactly the trap this milestone was meant to avoid.

---

## 3. Sample size and repetition

36 matched intents per mode, **one run each**. Supports statements about these
matched tasks. Does not support a reliability figure, and no significance test
was performed. Run-to-run variation is real and was observed directly in earlier
milestones.

---

## 4. One model, one host

All runs use a single model at default settings, driven by the Claude Code CLI
acting as a generic MCP host. Both modes always use the same model, so the
comparison is internally fair; the absolute numbers are model-specific.

---

## 5. The customer profile is generous in a specific way

The simulated customer states its preference clearly when asked. Real customers
are often vaguer, change their minds, or answer a different question than the one
asked. The profile removes a genuine confound but replaces it with an idealised
respondent, and that likely flatters **both** modes equally.

It also means "preferred match" partly measures how well the agent listens to an
unusually articulate customer.

---

## 6. Agent task success depends on a judgement we authored

`acceptable` and `preferred` were written by us, before the runs, per case. They
are defensible readings of each intent, but they are still our readings. A
different author might mark a different option acceptable — particularly on
`MD10`, `MW05`, `MW11` and `ML06`, where the intent is deliberately open and
`acceptable` lists all three options.

The dataset is frozen and hashed, so the judgements can be inspected and
disputed. They were not changed after seeing results.

---

## 7. The baseline is a good-faith reconstruction

`read_page` + `click(ref)` mirrors how browser agents work (accessibility tree
plus refs), but it is our implementation, not a shipped product. It is not
crippled: it sees every merchant fact and reaches every control including commit.
A different browser agent could do better or worse.

---

## 8. Policy correctness remains heuristic

The numeric traceability check flags candidates, cannot prove intent, and cannot
catch an invented fact stated without a number. It is reported as "policy-clean
runs", never as a hallucination rate.

---

## 9. Fixtures, not commerce

Three deterministic fixtures. No real orders, refunds, inventory, carriers or
payment rails. The resolution is real inside the state machine; nothing external
is contacted. Reference ids are deterministic, not unique across runs.

---

## 10. ChatGPT in-app browser — still PENDING

`CHATGPT_IN_APP_BROWSER = PENDING`, unchanged since M0.6. The protocol in
`../m0-agent/chatgpt-protocol.md` needs a human with the ChatGPT app. No claim
about ChatGPT appears anywhere in this repository.

---

## 11. What M3 does not re-test

M3 changed the product, so M2's numbers describe a **different** product. They
are not pooled and must not be quoted as though they describe the current
contract. Specifically, M2's 7/30 premature commitments were measured against a
product that still exposed `confirm_resolution` to the agent; today's contract
does not.
