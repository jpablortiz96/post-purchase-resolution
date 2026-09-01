# M4.2 limitations

## 1. The full REQUESTED → OPEN cycle was not re-run in this milestone

This is the honest headline. M4.2's primary proof (§23) is:

```
BEFORE: no Return  →  customer requests  →  REQUESTED  →  merchant approves  →  OPEN
```

That cycle **was not executed here**, for a concrete reason:

- The development store contains exactly **one** order, `#1001`.
- Its single line item has already been fully returned by `#1001-R1`, which is
  already `OPEN` from the earlier manual spike.
- Shopify therefore reports `returnableFulfillments` as **empty** for `#1001`.
  There is nothing left to return.
- The app's granted scopes are `read_orders, write_returns`. Creating or
  fulfilling a new order needs `write_orders` / `write_draft_orders` /
  `write_fulfillments`, which this app does not have.

So a new return request is not merely untested — it is **not currently possible
against this store**. §21 forbids destroying `#1001-R1` to free the line item,
and that instruction was followed: nothing was deleted, cancelled or rewritten.

**What this means for claims.** The REQUESTED → OPEN transition is evidenced by
the earlier manual spike, not by this integration. Until a second fulfilled order
exists and the loop is run through the product, do not claim the *application*
performs that transition end to end. Claim only what §2 below covers.

## 2. What this milestone did verify against real Shopify

All of the following ran against the live deployment and the real store:

- `client_credentials` authentication, server-side, token cached and renewed
- `get_order` returning genuine Shopify facts for `#1001` — PAID, FULFILLED,
  delivered 2026-09-01, $129 Wireless Headphones, `returnStatus: IN_PROGRESS`
- the real return `#1001-R1` and its real status `OPEN`, read back through the
  product and rendered in both the customer page and the merchant desk
- **duplicate protection**: a second `returnRequest` against `#1001` did **not**
  create a second Return; Shopify was not mutated (`duplicate-protection.json`)
- **order allowlist**: `#9999` is refused — the public demo cannot enumerate or
  touch arbitrary orders (`order-allowlist.json`)
- **approval guard**: approving is refused when nothing is `REQUESTED`
  (`approve-guard.json`)
- **restart persistence**, trivially and genuinely: the app holds no local copy
  of return state. Every read is a fresh Shopify query, so a reload, redeploy or
  cold start shows the same external truth.
- no secret or PII on any public surface (checked on `/`, `/src/*.js`,
  `/api/order`, `/merchant.html`)

## 3. The state shown is real, but it is one snapshot

`#1001-R1` is `OPEN` and stays `OPEN`. The customer page's status polling and the
merchant desk's refresh are both implemented and running, but neither has been
observed *transitioning* in this milestone, because nothing can transition.

## 4. Scope and safety

- Development store, test payments. **No real money moved.** No real customer
  exists. The order was seeded for this purpose.
- The demo is restricted to `SHOPIFY_DEMO_ORDER_NAMES` (currently `#1001`). An
  anonymous visitor cannot reach any other order.
- `returnDecline` is not implemented — out of scope per §21.
- Repeated public demos would need Shopify state reset manually. No automatic
  destructive reset was added, deliberately.

## 5. Fixtures still exist, and are still labelled

The three deterministic scenarios remain, reachable from the scenario selector
and via `?mode=fixtures` for regression. They are not presented as live commerce:
the live order is labelled **Live Shopify order** and shows real Shopify status
values (`REQUESTED` / `OPEN`), never the fixture vocabulary.

## 6. Unchanged from earlier milestones

- ChatGPT in-app browser: **UNVERIFIED**.
- One model, one host in the agent evaluations.
- The WebMCP capability boundary is not a security boundary — an agent that can
  drive the DOM can still press buttons (M3 actuation test, 1 of 3 trials).
