# Capture guide — screenshots and demo video

The exact sequence, so a capture run is reproducible and so nothing in the
README depends on an image that cannot be retaken.

**Two rules, without exception:**

1. **Never fabricate a shot.** No mockup, no reconstruction, no generated image
   standing in for product proof. A shot that cannot be captured honestly stays
   a documented slot.
2. **Redact before committing.** Details below.

---

## Before you start

You need a **fresh, unconsumed order** — paid, fulfilled, **delivered**, with no
return against it. A previously returned order shows `Already returned` and the
flow cannot be demonstrated. See [`SHOPIFY_SETUP.md`](SHOPIFY_SETUP.md) §8.

Use a product name distinct from every other test order.

Confirm the starting state from outside the app first:

```bash
node --env-file=.env harness/shopify/capture-external.js 00-before.json "#YOUR_ORDER"
```

It must report `returnStatus=NO_RETURN` and `returns: none`.

---

## The sequence

| # | Shot | What must be visible | Notes |
|---|---|---|---|
| 1 | **Customer inbox** | the purchase list with state labels | signed in |
| 2 | **The request** | the spoken or typed sentence in ChatGPT | no order number in the prompt |
| 3 | **Site Tools** | ChatGPT's own trace: `find_order`, `get_order` | ChatGPT's UI, not ours |
| 4 | **Resolution ready** | "Ready for your decision", the agent's reasoning | nothing submitted yet |
| 5 | **Shopify still clean** | Admin showing **no return** on the order | the boundary proof — redact |
| 6 | **Customer requests** | the customer pressing *Request return* | the commitment moment |
| 7 | **REQUESTED** | the customer view and the Return reference | |
| 8 | **Merchant queue** | the desk listing that return as `REQUESTED` with *Approve* | operator credential entered |
| 9 | **Approve** | the merchant's click | from the desk, **not** Shopify Admin |
| 10 | **OPEN** | the customer view reading *Return approved* | ideally without a reload |

Shot 5 is the one people underestimate. It is the moment that proves the agent
prepared something and still could not act — the whole thesis in one frame.

Shot 10 is best captured **without reloading**, so the page updates by itself.
If you do reload, say so; the repository records polling as `NOT_PROVEN` rather
than claim it.

## Between shots, capture the outside

The screenshots show the product; these show the system of record. Run them
between the steps above:

```bash
node --env-file=.env harness/shopify/capture-external.js 05-still-clean.json "#ORDER"
node --env-file=.env harness/shopify/capture-external.js 07-requested.json  "#ORDER"
node --env-file=.env harness/shopify/capture-external.js 09-open.json       "#ORDER"
node --env-file=.env harness/shopify/inspect-events.js "#ORDER"
```

All read-only. The event log is what proves *who* performed each transition.

---

## Redaction

Shopify Admin shows customer email and shipping address on every order page.
**Never commit an unredacted Admin screenshot.**

Before committing any image, remove:

- email addresses
- customer and staff names
- postal addresses and phone numbers
- the operator credential (it is a password field, but check anything pasted)
- access tokens, session cookies, URLs carrying credentials

Crop browser chrome that carries a session or a credentialed URL. Keep enough
chrome to show it is the real product.

Prefer redacting the **original** and committing only the derivative. A file
that ever contained PII should not be committed even if a later commit removes
it — git keeps both.

---

## For the video

Same order, same sequence. Three beats worth landing:

1. **The problem** — a person says what went wrong, in their own words. No order
   number, no menus.
2. **The boundary** — the agent has it ready, and stops. Cut to Shopify showing
   no return. This is the moment that distinguishes the project.
3. **The two decisions** — the customer submits; the merchant approves; Shopify
   moves `REQUESTED` → `OPEN`. Two different credentials, both visible.

Show the Shopify state alongside the product at least once. The claim is that
Shopify is the system of record, and the cheapest way to prove it is to show
both agreeing.

Do not narrate reliability. The runs are existence proofs, and the repository
claims no success rate.
