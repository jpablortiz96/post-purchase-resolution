# Shopify preflight — M4.1 real commerce spike

**Status: BLOCKED_CREDENTIALS.** No authorized Shopify access exists in this
environment, so nothing was built. This document records what was verified
against official documentation, and the exact steps needed to unblock.

Verified 2026-08-31 against `shopify.dev`. Nothing below is guessed; anything I
could not confirm is marked **UNVERIFIED**.

---

## 1. What was checked, and what was found

| Checked | Result |
|---|---|
| `SHOPIFY_SHOP_DOMAIN` / token / API version in env | **absent** |
| `.env` in project or home | **absent** |
| Shopify CLI installed | **absent** |
| Shopify config directories | **absent** |
| Shopify npm packages | **absent** |
| Vercel environment variables on the project | **none configured** |
| Any Shopify code in the repo | none — the three text matches are prose stating we do *not* use Shopify |

No secrets were printed at any point.

---

## 2. API version

Shopify releases a new API version quarterly, named by date (`2026-01`,
`2026-04`, `2026-07`, `2026-10`). Each stable version is supported for a minimum
of 12 months. At time of writing the GraphQL Admin API lists `2026-07` as latest
stable, with `2026-10` as release candidate.

**Recommendation:** pin `SHOPIFY_API_VERSION=2026-07` (latest stable). Do not use
`unstable` or a release candidate — release candidates may contain
backwards-incompatible changes.

→ [About Shopify API versioning](https://shopify.dev/docs/api/usage/versioning)

---

## 3. The mutation to use

**`returnRequest`** — creates a return that requires merchant approval, with
status **`REQUESTED`**. This is the correct choice for our authority model, and
matches the brief's requirement.

**Not `returnCreate`** — that assumes prior approval and produces an `OPEN`
return, which would collapse the merchant approval boundary we are trying to
preserve.

**Required scope:** `write_returns` (or `write_marketplace_returns`).

→ [`returnRequest` mutation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/returnRequest)
→ [`Return` object](https://shopify.dev/docs/api/admin-graphql/latest/objects/Return)

### Fulfilled line item requirement

A return can only be requested against a **fulfilled** line item. The flow is two
steps:

1. Query **`returnableFulfillments`** for the order → returns the returnable
   fulfillment line items and their IDs.
2. Pass those `fulfillmentLineItem` IDs into the `returnRequest` mutation input.

This confirms the brief's assumption: the seeded test order **must have a
fulfilled line item**, or there will be nothing returnable.

→ [`returnableFulfillment` query](https://shopify.dev/docs/api/admin-graphql/latest/queries/returnableFulfillment)
→ [Build for return management](https://shopify.dev/docs/apps/build/orders-fulfillment/returns-apps/build-return-management)

### Approval mutations — deliberately out of scope

`returnApproveRequest` and `returnDeclineRequest` exist for the merchant side.
Per M4.1 §21 these are **not** to be built until M4.1 passes. Their existence is
noted only to confirm the `REQUESTED → approved/declined` lifecycle is real.

---

## 4. Access scopes

| Scope | Why |
|---|---|
| `read_orders` | fetch the order and its fulfillment state |
| `read_returns` | read return state before/after, and on restart |
| `write_returns` | required by `returnRequest` |

Least privilege: request these three only. Do **not** add `write_orders`,
customer scopes, or payment scopes — none are needed for this spike.

→ [Shopify API access scopes](https://shopify.dev/docs/api/usage/access-scopes)

---

## 5. Protected customer data

`read_orders` falls under **protected customer data**, because order information
relates to a customer.

The important finding for this spike:

> For an app installed **only on a development store**, protected customer data
> access does not require submitting for review. Approval is required for any
> store that is not a development store.

So a development store is sufficient for M4.1, and no Shopify review cycle is
needed — provided the app is never installed on a production store.

You still need to **select a distribution method** for the app before requesting
protected customer data access, even on a development store.

→ [Work with protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data)

**Our obligation regardless of approval:** §8 of the M4.1 brief requires that
`get_order` never exposes customer email, address or phone. That constraint is
ours and stands independently of what Shopify permits.

---

## 6. Development store restrictions — UNVERIFIED

I did not confirm, from primary documentation, the current specifics of:

- whether test-mode payments are required to produce a fulfillable order
- any throttle or transfer restrictions on development stores
- whether a development store can be created without a Partner account

These do not block writing the adapter, but should be confirmed before relying
on the flow for a demo.

---

## 7. Exact manual steps to unblock

Everything below requires a person with a Shopify Partner account. None of it can
be done from this environment.

1. **Create a Partner account** at `partners.shopify.com` (free).
2. **Create a development store** from the Partners dashboard.
3. **Create a custom app** in that store: *Settings → Apps and sales channels →
   Develop apps → Create an app*.
4. **Configure Admin API scopes**: `read_orders`, `read_returns`,
   `write_returns`. Nothing else.
5. **Request protected customer data access** for the app. On a development
   store this does not need review, but a distribution method must be selected.
6. **Install the app** on the development store and reveal the **Admin API access
   token** (`shpat_…`). It is shown once.
7. **Seed one test order**:
   - one product, one line item
   - place the order using **test payments**
   - **mark it fulfilled** — without this there is nothing returnable
   - confirm `returnableFulfillments` returns a line item for it
8. **Provide the credentials** as environment variables — never in git:

   ```
   SHOPIFY_SHOP_DOMAIN=your-dev-store.myshopify.com
   SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxx
   SHOPIFY_API_VERSION=2026-07
   SHOPIFY_DEMO_ORDER_ID=gid://shopify/Order/1234567890
   ```

   Locally: a `.env` file (already gitignored).
   Production: `vercel env add` for each, so the token stays server-side.

9. Tell me they are in place, and M4.1 can proceed.

---

## 8. What I would build once unblocked

Recorded now so the plan is reviewable before any code exists.

**Server-side adapter** (Vercel serverless functions — the token must never
reach browser JavaScript):

```
GET  /api/commerce/order/:demoId      sanitized order + returnable fulfillments
POST /api/commerce/returns/request    returnRequest mutation, once
GET  /api/commerce/returns/:id        current external return state
```

**`get_order` in `REAL_COMMERCE` mode** returns only: public order reference,
product title, variant, quantity, fulfillment state, relevant timestamps, and
current return state. No email, address or phone — enforced by an explicit
allowlist in the adapter, not by omission.

**`prepare_resolution` performs no Shopify mutation.** It validates against live
order state, applies merchant policy, and stores a short-lived prepared
resolution with the same stale-state protection the fixture path already has.

**Customer commit** re-reads authoritative order state, rejects a stale prepared
resolution, calls `returnRequest` exactly once, inspects `userErrors`, requires a
real `Return` object back, and renders the external status. A `userErrors`
response must **not** mark the resolution complete.

**The kill condition applies.** If the chain cannot reach real order → real
return request → real external status, I stop and report rather than simulate.

---

## Sources

- [returnRequest mutation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/returnRequest)
- [returnableFulfillment query](https://shopify.dev/docs/api/admin-graphql/latest/queries/returnableFulfillment)
- [Return object](https://shopify.dev/docs/api/admin-graphql/latest/objects/Return)
- [Build for return management](https://shopify.dev/docs/apps/build/orders-fulfillment/returns-apps/build-return-management)
- [Shopify API access scopes](https://shopify.dev/docs/api/usage/access-scopes)
- [Work with protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data)
- [About Shopify API versioning](https://shopify.dev/docs/api/usage/versioning)
