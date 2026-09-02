# 10 — Customer view after merchant approval

**This file is a human attestation, not a machine capture.** It is kept separate
from the JSON evidence for that reason.

The authenticated customer session is an `HttpOnly` cookie in the customer's own
browser. No external process can issue a Customer Account API query on their
behalf, and asking anyone to hand over a session cookie would be the wrong way
to obtain evidence. So the customer-side observations below were made by the
human operating the signed-in production browser, and are recorded as their
report.

## Reported by the human

| Point in the flow | What the customer page showed |
|---|---|
| before merchant action | `#1004` · Smart Fitness Watch · Return `#1004-R1` · Shopify status `REQUESTED` |
| after merchant approval | Smart Fitness Watch · **Return approved** · Return `#1004-R1` · Shopify status `OPEN` |

## What this is independently corroborated by

Everything above concerns the same Return that the Admin API reports on, and
that side **was** machine-captured, by a process with no access to the customer
session:

- `06-external-requested.json` — `#1004-R1` `REQUESTED`, id `57460621684`
- `09-external-open.json` — `#1004-R1` `OPEN`, id `57460621684`
- `08-authority-timeline.json` — who performed each transition

The customer page holds no `localStorage`, `sessionStorage`, `indexedDB` or
cookie state of its own — verified in source — so every value it displayed was
derived from the Customer Account API at read time. It cannot show a status it
was not told.

## What is NOT established here

**Whether the transition appeared without a reload.** The brief is explicit that
polling must not be inferred, and nothing in this evidence distinguishes "the
page polled and updated itself" from "the page was reloaded and re-read". No
client-side log was captured, and the server cannot tell the two apart: both
issue the same `GET /api/customer/orders`.

The polling code is deployed and verifiable in the served asset
(`startCustomerPolling`, 10s interval, does not stop at `OPEN`), but *that this
particular transition arrived through it* is **NOT_PROVEN**.
