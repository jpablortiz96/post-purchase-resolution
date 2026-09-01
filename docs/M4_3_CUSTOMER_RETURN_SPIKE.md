# Customer return authority — research, plan, and the blocker

Step 7 of the brief: move the customer's return request from the Admin API onto
the customer's *own* credential. This is the research lock. **Nothing here has
been executed.**

## Why this matters to the thesis

The product claims *"Merchant defines. Agent prepares. Customer commits."*

Today the commit is real but its **authority is borrowed**: the customer presses
the button, and the server performs `returnRequest` under the *merchant's* Admin
token. The customer's intent is genuine; the credential behind it is not theirs.

`orderRequestReturn` closes that gap — the request executes under the customer's
own access token, so the authority matches the actor.

## What the API actually provides

`orderRequestReturn` has been in the Customer Account API since **2025-01**
([changelog](https://shopify.dev/changelog/returns-now-supported-in-customer-accounts-api)).

```graphql
mutation OrderRequestReturn($id: ID!, $requestedLineItems: [RequestedLineItemInput!]!) {
  orderRequestReturn(orderId: $id, requestedLineItems: $requestedLineItems) {
    return { id }
    userErrors { message code }
  }
}
```

```json
{
  "id": "gid://shopify/Order/1",
  "requestedLineItems": [
    { "lineItemId": "gid://shopify/LineItem/1", "quantity": 1,
      "returnReason": "SIZE_TOO_SMALL", "customerNote": null }
  ]
}
```

The line item id comes from the same `returnInformation` block we already query:

```graphql
returnInformation {
  returnableLineItems(first: $first) {
    edges { node { lineItem { id presentmentTitle } quantity } }
  }
}
```

### The three findings that decide the design

1. **State semantics match M4.2 exactly.** Shopify: *"this mutation doesn't
   directly create a return. Instead, it submits a request that the merchant can
   approve or reject."* It produces a Return in `REQUESTED` — the same state the
   Admin `returnRequest` produced in M4.2, and the same state the merchant desk
   already knows how to approve.

2. **`returnReason` is a plain enum.** The mutation reference lists
   `returnReasonDefinitionId`, but the self-serve guide's own example passes
   `returnReason: "SIZE_TOO_SMALL"`. The enum path is the one to use: it is what
   M4.2 already maps onto, so the policy engine needs no change.

3. **No extra authorization is needed.** The changelog states partners can build
   return apps *"without needing extra app authorizations"*. The mutation
   reference names `customer_write_customers`, which is an **Admin** scope name
   and does not apply to a Customer Account API token. Our session already
   requests `customer-account-api:full`.

   This is the one point that is **reasoned, not observed**. It is exactly what
   the spike is for — and if it is wrong, the failure is a clean `userErrors`
   or a 403, not a partial mutation.

## What does *not* move

Merchant approval stays on the Admin API (`returnApproveRequest` → `OPEN`). That
is correct, not a shortcut: approval is the merchant's decision and must run
under the merchant's credential. The result is that each half of the loop runs
under the authority of the party actually making the decision:

| Action | Actor | Credential | Resulting state |
|---|---|---|---|
| request a return | customer | customer access token | `REQUESTED` |
| approve it | merchant | Admin API token | `OPEN` |

## The blocker

**There is no returnable order to spike against.** Verified read-only against
production:

```
#1002  fulfillmentStatus FULFILLED  orderReturnStatus IN_PROGRESS
       returnable false   returnableQuantity 0
       existingReturns [ #1002-R1 OPEN ]
```

`#1001` is in the same condition. Both had their returnable quantity consumed by
the returns created in M4.1 and M4.2, and **that evidence is immutable** — it
must not be cancelled or unwound to free up a line item.

So the spike needs a **new paid, fulfilled, delivered order** in the development
store, created manually, exactly as `#1002` was for M4.2.

## Migration gate

The brief permits migration only if state semantics and duplicate/stale
protections match proven M4.2 behaviour. Finding 1 satisfies the state half; the
protections must be re-proven, not assumed:

- a second request while one is `REQUESTED` or `OPEN` must be refused
- a request against zero returnable quantity must be refused
- a stale prepared resolution must not be committable after external change
- the customer page must derive state from Shopify, never from optimistic UI

Until those are observed on a real order, the Admin path stays. It works, and
shipping an unproven mutation path would be worse than an honest one.
