# M1.1 — Limitations and Claim Discipline

---

## 1. What M1.1 actually validated

That the **live public deployment** behaves like a customer product: a person
arriving at the URL with no special knowledge can see their problem, see the
merchant's permitted resolutions, get an agent to recommend and stage one,
approve it themselves, and end up with a recorded outcome — with the approval
boundary holding throughout.

It did **not** validate real commerce. The three orders remain deterministic
fixtures. No real refund, credit, exchange, carrier or payment rail is touched.

---

## 2. A production gap was found and fixed mid-phase

The first A1 audit scored **10/12**. The failure that mattered: the only
customer-visible controls were the scenario switcher and reset, so **a customer
could not start a resolution without an agent**. The product was agent-only.

This was fixed (a "Choose this" control per option, and "Complete resolution
now" in the approved state) and deployed before any M2 run. Two consequences
worth stating plainly:

- The M1.1 customer journeys ran against the **fixed** build, not the build that
  failed the audit.
- The fix **strengthened** the M2 human-UI baseline. Without it the baseline
  could not have completed a single task, and the comparison would have been
  meaningless rather than merely favourable.

---

## 3. Ordering deviation from the brief

The brief sequences M1.1 fully, then M2. In practice A1 was completed and its
failures fixed and deployed first — that was the gating step — but A2–A5 were
satisfied by the 30 WebMCP runs that are also M2's evidence, rather than by a
separate earlier pass. A6, A7 and A9 were run separately.

This is a real deviation. It does not weaken the evidence (the runs exercise the
same live build with the same customer language), but the A2–A5 journeys and the
M2 WebMCP arm are the *same* runs, not independent ones.

---

## 4. Agent behaviour varies run to run

Whether the agent stages a resolution on the first turn or recommends one and
asks first changes between runs of an identical setup. Both are reasonable, so
the protocol allows the customer a neutral affirmative (`"Yes, go ahead with
that."`) up to a cap of three turns, and reports the turn count as a metric.

A6 was observed failing twice for this reason before the protocol was aligned
with the eval protocol — once because the agent asked a sensible clarifying
question about a real consequence ("you'll still have the broken left earphone
for your flight"), once because it asked which option the customer wanted. Those
were harness assertions being too strict, not product defects, and are recorded
as such.

---

## 5. A9 is contract-level, not agent-level

The error-state checks drive the tools directly rather than through an agent.
That is deliberate — it tests the product's guarantees rather than one model's
behaviour — but it means A9 is **protocol evidence, not agent evidence**, and it
is labelled that way in `production-errors.md`.

---

## 6. The approval boundary — what is and is not proven

**Supported:** the workflow requires a visible approval step before execution
becomes valid, and in the WebMCP contract there is no tool in any state that can
supply that approval.

**Not supported:** that approval cannot be bypassed by anything at all. The
Approve control is a button; anything that can drive the page's DOM can press
it. M2 measures exactly that: in the human-UI baseline the agent *can* and
sometimes *does* press it.

---

## 7. ChatGPT in-app browser — still PENDING

Unchanged since M0.6. `../m0-agent/chatgpt-protocol.md` still needs a human with
the ChatGPT app. No claim about ChatGPT is made anywhere in M1.1.
