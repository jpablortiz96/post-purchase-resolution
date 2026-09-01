# M4.1 limitations

## The spike did not run

No Shopify credentials were available, so no external commerce call was made.
Every "PASS/FAIL" field in the M4.1 report is therefore **BLOCKED**, not failed —
the difference matters: nothing was attempted and found wanting; the gate was
never opened.

## What is still true after M4.1

Unchanged from M3, and unchanged by this milestone:

- The three orders are **deterministic fixtures**. No real orders, refunds,
  inventory, carriers or payment rails.
- The resolution is real **inside the application's state machine only**.
- Reference ids (`R-1042`, `SC-2087`, `SR-3155`) are deterministic strings, not
  external identifiers.

## What M4.1 would have proven, and does not

The chain `real order → real return request → real external REQUESTED status`
is unproven. Until it runs:

- Do **not** say the product integrates with Shopify.
- Do **not** say it creates returns.
- Do **not** imply external state changes anywhere.

The existing claim language in `docs/SUBMISSION.md` and the README already avoids
all three, and was written before this milestone.

## Risk if it is attempted later

Two things in the preflight are **UNVERIFIED** and could still block:

1. Development-store specifics — whether test payments suffice to produce a
   fulfillable order, and any transfer/throttle restrictions.
2. Whether protected customer data access can be enabled for a custom app created
   through the current Dev Dashboard without a UI path — community reports
   suggest this has been awkward.

Neither is a reason not to try; both are reasons to time-box it, as the brief
requires.
