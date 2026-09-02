# M4.4 final clean flow — limitations

## 1. Polling was not proven to be what updated the page

`CUSTOMER_POLLING_SYNC` is **NOT_PROVEN**, not PASS.

The polling code is deployed and can be read in the served asset
(`startCustomerPolling`, 10-second interval, explicitly does not stop at
`OPEN`). The transition from `REQUESTED` to `OPEN` was observed on the customer
page. But nothing captured distinguishes *the page polled and updated itself*
from *the page was reloaded and re-read*: both issue the same
`GET /api/customer/orders`, and no client-side log was kept.

The brief says not to infer this, so it is not inferred.

## 2. The customer-side reads are human attestation

Steps 01–05 and 10 — the purchase list, `find_order`, `get_order`, preparation
creating no return, and the final `OPEN` view — happened inside the customer's
signed-in browser and were reported by the human operating it. They are recorded
in `10-customer-open.md`, labelled as attestation and kept out of the JSON.

The session is an `HttpOnly` cookie in that browser; no external process can
query the Customer Account API on their behalf, and asking for a session cookie
would be the wrong way to obtain evidence.

What *is* machine-captured is the entire Admin-side view of the same Return, by
a process with no access to that session — which is the half an attacker or a
mistaken UI could not fake.

## 3. `PREPARE_NO_MUTATION` rests on structure, not on this run

No before/after capture was taken around the preparation step of this particular
run. The claim rests on two other things:

- a test isolates `CustomerSession.prepare()` and asserts it contains no
  `fetch`, `XMLHttpRequest`, `sendBeacon` or `WebSocket` — it cannot reach the
  network at all;
- a second test asserts exactly one call site touches the mutation route, and
  that it lives inside `requestReturn`.

Plus the run itself: `00-external-before-anything.json` shows no return existed,
and the only return that ever appeared is the one the customer submitted.

## 4. `orderRequestReturn` succeeded, but its reason field is still unproven

The mutation sends `returnReason` and falls back to the minimum input if — and
only if — the first attempt fails GraphQL *validation*, which means nothing
executed. The run succeeded, and Shopify recorded reason `DEFECTIVE` on
`#1003-R1`. Whether the fallback path works has still never been exercised,
because it has never been needed.

## 5. Merchant identity is still an operator credential

The desk is gated by a shared high-entropy operator token held in
`sessionStorage`. It stops anonymous approval — verified: anonymous and
wrong-credential approvals both return `MERCHANT_UNAUTHORIZED` — but it is not
merchant *identity*, and the UI says so. Real merchant sessions remain out of
scope.

## 6. Second-customer isolation

Cross-order protection is proven against forged and foreign identifiers within
one account. That customer A cannot reach customer B's order needs a **second**
customer account with orders. Still not run.

## 7. The signed-out surface still knows one order

Signed out, the page falls back to the Admin view of a single configured order
(`SHOPIFY_DEMO_ORDER_NAMES`), inherited from M4.2. That is the one place
production code still names an order. The authenticated path — the product —
contains no order number anywhere, which is what `#1004` demonstrates: it was
discovered, requested and approved without appearing in any configuration.

## 8. Stopped at OPEN, deliberately

No refund, no close, no restock, no second return. `#1004` remains `PAID` with
zero refunds and exactly one Return at `OPEN`. Financial settlement is not part
of this proof.

## 9. Unchanged

- ChatGPT Desktop Site Tools: **not started**.
- Voice: **UNVERIFIED_BY_DOCUMENTATION**.
- Development store, test payments. No real customers, no real money.
