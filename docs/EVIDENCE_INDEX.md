# Evidence index

One claim per row, one file that settles it. You should not need to browse the
tree.

Everything here follows the same discipline: **claim → test → external system →
raw evidence.** Where external state is claimed, it was re-read from Shopify by
a process with no connection to the page or session that produced it.

---

## The headline claims

| Claim | Proof | Where |
|---|---|---|
| An agent found the right purchase from a spoken sentence, with no order number | ChatGPT trace + external control | [`m5-chatgpt-native/protocol.md`](../evidence/m5-chatgpt-native/protocol.md) |
| That agent created **nothing** in Shopify | zero returns **and** zero events attributed to this app | [`m5-chatgpt-native/02-authority-absence.json`](../evidence/m5-chatgpt-native/02-authority-absence.json) |
| A customer committed a return under **their own** credential | `orderRequestReturn` → `REQUESTED` | [`m4-final-clean-flow/06-external-requested.json`](../evidence/m4-final-clean-flow/06-external-requested.json) |
| A merchant approved it under **separate** authority | `returnApproveRequest` → `OPEN` | [`m4-final-clean-flow/09-external-open.json`](../evidence/m4-final-clean-flow/09-external-open.json) |
| Both halves ran through the app, under different credentials | Shopify event log, `attributedToUser=false` | [`m4-final-clean-flow/08-authority-timeline.json`](../evidence/m4-final-clean-flow/08-authority-timeline.json) |
| It is the **same** Return throughout | id `57460621684` in all three captures | [`m4-final-clean-flow/manifest.md`](../evidence/m4-final-clean-flow/manifest.md) |
| No WebMCP tool can commit, in any state | 22/22 boundary suite against live production | [`m5-chatgpt-native/capability-boundary/`](../evidence/m5-chatgpt-native/capability-boundary/) |
| No credential or PII reaches the browser | 21/21 commerce security suite, live | [`m5-chatgpt-native/security-tests.json`](../evidence/m5-chatgpt-native/security-tests.json) |
| Nothing reaches customer data without a session | 32/32 auth security suite, live | [`m5-chatgpt-native/auth-security-tests.json`](../evidence/m5-chatgpt-native/auth-security-tests.json) |

---

## Read these three first

**1. [`m4-final-clean-flow/08-authority-timeline.json`](../evidence/m4-final-clean-flow/08-authority-timeline.json)**

Shopify's own event log for the full loop. Two lines carry the entire authority
argument:

```
15:40:39Z  app=true user=false  WebMCP Resolution Connector  requested return #1004-R1
17:43:12Z  app=true user=false  WebMCP Resolution Connector  approved  return #1004-R1
```

`attributedToUser=false` means neither was a person clicking in Shopify Admin.
The contrast is `#1003-R1`, approved by `Shopify Web` with
`attributedToUser=true` — a human in the Admin UI. `#1004` has no such event.

**2. [`m5-chatgpt-native/02-authority-absence.json`](../evidence/m5-chatgpt-native/02-authority-absence.json)**

The non-mutation proof, and the most interesting file here because the evidence
is an *absence with a matching presence*. Shopify labels every mutation this app
performs `WebMCP Resolution Connector`. After an agent read `#1005` and prepared
a resolution against it: **zero** such events, and no return at all.

**3. [`m5-chatgpt-native/claims.md`](../evidence/m5-chatgpt-native/claims.md)**

The claim-discipline document. What the ChatGPT verification supports in exact
words, and what must never be claimed from it — including why "voice invokes
WebMCP at the transport layer" is false.

---

## By milestone

| Directory | What it covers |
|---|---|
| [`m5-chatgpt-native/`](../evidence/m5-chatgpt-native/) | **ChatGPT Site Tools** — typed and spoken discovery, external non-mutation control, claim discipline |
| [`m4-final-clean-flow/`](../evidence/m4-final-clean-flow/) | **The full loop** — `REQUESTED` → `OPEN` on a real Return, with the authority timeline |
| [`m4-authenticated-agent-flow/`](../evidence/m4-authenticated-agent-flow/) | Customer Account API discovery, `find_order` exposure, the `#1003` post-refund incident |
| [`m4-customer-auth/`](../evidence/m4-customer-auth/) | OAuth + PKCE implementation and its negative tests |
| [`m4-merchant-loop/`](../evidence/m4-merchant-loop/) | The first real merchant approval loop |
| [`m4-real-commerce/`](../evidence/m4-real-commerce/) | The first real Shopify Return |
| [`m3/`](../evidence/m3/) | Capability boundary, the actuation test, the held-out evaluation |
| [`m2/`](../evidence/m2/) | Matched baseline vs WebMCP evaluation |
| [`m1/`](../evidence/m1/), [`m0-agent/`](../evidence/m0-agent/) | Policy engine, state invariants, first real-agent runs |

---

## Suites at freeze

| Suite | Result | Reproduce |
|---|---|---|
| Unit | 56 / 56 | `npm test` — offline, no credentials |
| Auth security | 32 / 32 | `APP_URL=… node harness/auth-security-tests.js` |
| Commerce security | 21 / 21 | `APP_URL=… node harness/security-tests.js` |
| Live UI | 12 / 12 | `APP_URL=… node harness/live-ui-check.js` |
| Capability boundary | 22 / 22 | `APP_URL=… npm run verify:webmcp` |

Set `OUT_DIR` to control where a run writes. It defaults to `evidence/_latest`
and **never** to a milestone directory — a re-run must not be able to overwrite
the artefacts of the run that produced them.

---

## What the evidence does *not* establish

Read this alongside the tables above. Each milestone carries its own
`limitations.md`; the recurring ones:

- **No reliability rate.** These are existence proofs. No success percentage is
  computed anywhere, and the suite totals are not averaged into one.
- **Agent-side traces are human attestation.** ChatGPT's built-in browser
  exposes no machine-readable trace to the harness. The *Shopify* side is
  machine-captured and independent — so "the agent created nothing" is proven,
  while "it called `find_order` then `get_order`" is reported.
- **Customer-side UI reads are human attestation** for the same reason: the
  session is an `HttpOnly` cookie in the customer's browser.
- **One client, one version, one day** for the ChatGPT Site Tools behaviour.
- **Development store, test payments.** No real money, no real customers.
- **Polling was not proven** to be what updated the page on the final
  transition — the code is deployed and does not stop at `OPEN`, but nothing
  captured distinguishes a poll from a reload. Recorded as `NOT_PROVEN`.

---

## Sanitisation

No token, authorization code, PKCE verifier, session cookie, email, name,
address or phone appears in any evidence file. Personal names in Shopify event
timelines are replaced with roles before capture.

Two security-suite files contain strings like `gid://shopify/Order/12602041…`.
Those are the **forged probe inputs the suites deliberately send** to prove such
identifiers are rejected — test inputs, not customer data.
