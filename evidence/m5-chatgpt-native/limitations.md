# M4.5 — limitations

## 1. Two runs are existence proofs, not a measurement

Test A and Test B each ran once. They establish that the flow works end to end
through ChatGPT's built-in browser. They say nothing about how *often* it works,
how it behaves under ambiguity, or how it degrades. No reliability or success
rate may be quoted from them.

The only measured rates in this project come from the earlier matched
evaluation, and those were on a different harness.

## 2. The agent-side observations are human attestation

What ChatGPT enumerated and which tools it called were observed by the human
running the tests. No machine-readable trace of ChatGPT's tool calls was
captured — the built-in browser exposes none to us.

The Shopify side **is** machine-captured, by a process with no access to ChatGPT
or to the customer session. So the claim "the agent created nothing" rests on
independent evidence; the claim "the agent called `find_order` then `get_order`"
rests on the human's report.

## 3. Voice was not observed below the assistant layer

The observed chain is *spoken request → ChatGPT agent turn → Website Site Tools
→ WebMCP invocation*. Nothing was instrumented inside ChatGPT, so the internal
steps between speech and the tool call are inferred from its own displayed
trace, not measured.

Any claim of a voice-to-protocol binding is unsupported. See `claims.md`.

## 4. This is one client, one version, one day

"ChatGPT's built-in browser enumerates and calls this site's tools" is a product
behaviour observed on the date in `protocol.md`, against this deployment. It is
not a documented guarantee from OpenAI and may change without notice. Site Tools
behaviour is outside this project's control.

## 5. `#1005` remains unused

The order was read and a resolution prepared against it, and nothing was
committed — deliberately. It still has no return and no refund, so it remains
available if a further customer-commit demonstration is ever wanted.

## 6. Unchanged from M4.4

- Merchant identity is still a shared operator credential, not identity.
- Second-customer isolation still needs a second account with orders.
- The signed-out surface still names one configured order; the authenticated
  path names none.
- Development store, test payments. No real customers, no real money.
