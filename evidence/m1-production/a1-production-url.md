# A1 — production URL audit

Audited: `https://post-purchase-resolution.vercel.app/` at 2026-08-31T00:09:43.507Z

**12/12 checks pass.**

| Check | Result |
|---|---|
| https + 200 | **PASS** |
| no console errors on load | **PASS** |
| no debug/simulation panel | **PASS** |
| no "simulate" wording in customer UI | **PASS** |
| no "debug" wording in customer UI | **PASS** |
| badge reads Active in a WebMCP environment | **PASS** |
| initial state is clean | **PASS** |
| all three scenarios reachable | **PASS** |
| merchant options are visible to the customer | **PASS** |
| tools register in a supported WebMCP environment | **PASS** |
| CUSTOMER CAN START A RESOLUTION UNAIDED | **PASS** |
| reset works | **PASS** |

## Controls a customer can press in the initial state

- Damaged
- Wrong Size
- Arrived Late
- Choose this
- Choose this
- Choose this
- ↺ Reset scenario

## What the first audit found

The first run scored **10/12**. Two real gaps:

1. **A customer could not start a resolution unaided.** The only controls were
   the scenario switcher and reset — every route to a resolution required an
   agent to call `prepare_resolution`. That is an agent-only product, and it
   would have made the M2 human-UI baseline impossible rather than merely
   weaker. Fixed by adding a "Choose this" control per option and a
   "Complete resolution now" control in the approved state.
2. A missing favicon — the only 404 on load.

Both were fixed and deployed before any M2 run. The fix strengthened the
baseline rather than weakening it.
