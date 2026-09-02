# M4.4 final clean flow — evidence manifest

Production: <https://post-purchase-resolution.vercel.app>
Order: `#1004` · Smart Fitness Watch · Return `#1004-R1` (`57460621684`)

One return, one id, three states, two different credentials.

## The run

| File | What it establishes |
|---|---|
| `00-external-before-anything.json` | `#1004` PAID / FULFILLED / DELIVERED, `NO_RETURN`, zero refunds — before any agent or customer action |
| `06-external-requested.json` | after the customer's own request: `#1004-R1` `REQUESTED` |
| `07-merchant-queue-visible.json` | still `REQUESTED` while the merchant desk showed it — captured before approval so queue evidence cannot be confused with one |
| `08-authority-timeline.json` | who performed each transition, from Shopify's own event log |
| `09-external-open.json` | after merchant approval: same id, now `OPEN`, still zero refunds, still one return |
| `10-customer-open.md` | the customer-side view — **human attestation**, kept separate from machine capture, with what it does and does not establish |
| `auth-security-tests.json` | customer auth negative suite, live — 32/32 |
| `security-tests.json` | commerce security suite, live — 21/21 |
| `capability-boundary/` | WebMCP boundary suite, live — 22/22 |
| `limitations.md` | what is unproven and why |

## The authority split, from Shopify's own events

```
15:40:39Z  app=true  user=false  WebMCP Resolution Connector
           "Test payment gateway requested return #1004-R1 through WebMCP Resolution Connector."

17:43:12Z  app=true  user=false  WebMCP Resolution Connector
           "WebMCP Resolution Connector approved return #1004-R1."
```

`attributedToUser=false` on both means neither was a person acting inside
Shopify Admin — each ran through the deployed application. The contrast that
makes this readable is the previous, contaminated order: `#1003-R1` was approved
by `Shopify Web` with `attributedToUser=true`, because a human approved it in
the Admin UI. `#1004` has no such event.

The two halves nonetheless ran under **different credentials**:

| Action | Actor | Credential | Result |
|---|---|---|---|
| request the return | customer | their own Customer Account API token | `REQUESTED` |
| approve it | merchant | Admin API token, behind an operator credential | `OPEN` |

The Admin request path is structurally incapable of having created this return:
`shopify.requestReturn()` reads `getOrder(ACTIVE_ORDER)`, and `ACTIVE_ORDER` is
`#1002`. `#1004` was reachable only through `orderRequestReturn`.

## Reproduce the read-only checks

```
node --env-file=.env harness/shopify/capture-external.js out.json "#1004"
node --env-file=.env harness/shopify/inspect-events.js "#1004"
node --env-file=.env harness/shopify/inspect-queue.js
```

None of these mutate anything. No order number appears in production code —
they take it as an argument.

## Sanitisation

No token, authorization code, PKCE material, email, name, address or phone is in
any file here. Personal names in the event timeline are replaced with roles.

The two security suite files contain strings like
`gid://shopify/Order/12602041…` — these are the **forged probe inputs the suites
deliberately send** to prove such identifiers are rejected. They are test inputs,
not customer data.
