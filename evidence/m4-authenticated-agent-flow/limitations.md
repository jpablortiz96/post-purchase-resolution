# M4.4 — limitations

## 1. The customer mutation test has not been run

`orderRequestReturn` is implemented and deployed. **It has never executed.**

There is nothing to run it against. Verified read-only against production:

```
#1002  FULFILLED  returnable false  returnableQuantity 0
       nonReturnableReasons ["RETURNED"]
```

`#1001` is in the same condition. Both had their returnable quantity consumed by
the returns created in M4.1 and M4.2, and that evidence is immutable — it must
not be cancelled or unwound to free a line item.

So every step downstream of the customer's click is **implemented but unproven**:

| | Status |
|---|---|
| customer authentication | **verified** (17/17, human production run) |
| customer-scoped purchases | **verified** |
| `find_order` / `get_order` / `prepare_resolution` | **implemented**, verifiable via `?verify=1` |
| `orderRequestReturn` under the customer token | **unproven** |
| Return reaches `REQUESTED` | **unproven** |
| merchant approval moves it to `OPEN` | **unproven** |
| customer sees `OPEN` from external state | **unproven** |

Nothing was stubbed to paper over this. There is no fake return, no simulated
status, and no code path that fabricates a mutation result.

**What unblocks it:** one new paid, fulfilled, delivered order belonging to the
authenticated customer. No code change and no environment change is needed —
`find_order` discovers it from the Customer Account API.

## 2. The return reason is sent optimistically

The mutation reference names `returnReasonDefinitionId`; Shopify's own
self-serve returns guide passes a plain `returnReason` enum. Rather than guess,
`requestReturn()` sends `returnReason` and falls back to the minimum input the
schema certainly accepts if — and only if — the first attempt fails **GraphQL
validation**, which means the mutation never executed.

This fallback has never fired, because the mutation has never run.

## 3. Ambiguity handling is unproven in production

`find_order` returns `resolution: 'ambiguous'` and refuses to choose whenever
more than one purchase matches. The unit tests cover it, and the `?verify=1`
self-check exercises it — but the authenticated account currently holds **one**
purchase, so ambiguity cannot arise there. The self-check reports that case as
`NOT_PROVEN` rather than passing it vacuously.

## 4. The signed-out surface still knows an order

Signing out falls back to the Admin-API view of a single configured order
(`SHOPIFY_DEMO_ORDER_NAMES`), inherited from M4.2. That path is what the M4.2
regression and the signed-out preview exercise, and it is the one place
production code still names an order.

The authenticated path — the product — contains no order number anywhere.

## 5. Merchant identity is still an operator token

The merchant desk is gated by a shared operator token held in `sessionStorage`.
It stops anonymous approval; it is not merchant identity, and the UI says so.
Real merchant sessions remain out of scope.

## 6. Second-customer isolation

Cross-order protection is proven against forged and foreign identifiers within
one account. Proving that customer A cannot reach customer B's order needs a
**second** customer account with orders. That test is written down as required
and has not been run.

## 7. Unchanged

- ChatGPT Desktop Site Tools: **not started**, correctly gated.
- Voice: **UNVERIFIED_BY_DOCUMENTATION**.
- Development store, test payments. No real customers, no real money.
