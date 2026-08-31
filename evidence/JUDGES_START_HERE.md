# Evidence index

A short guide to what this project proves, what it does not, and where the raw
data is. Everything here is generated from preserved run records; no failed run
was deleted and no transcript was edited.

---

## What is proven

**1. The site publishes a smaller callable surface than its own UI.**
Two WebMCP tools — `get_order`, `prepare_resolution`. No tool that completes a
resolution exists in any state.
→ 22/22 checks: [`m3/capability-boundary/webmcp-boundary.json`](m3/capability-boundary/webmcp-boundary.json)

**2. Merchant facts are deterministic and unreachable by agent input.**
Eligibility, amounts, timing and requirements come from a policy engine with no
model in it. Hostile reasoning text does not change an executed amount.
→ [`../tests/policy.test.mjs`](../tests/policy.test.mjs), [`../tests/authority.test.mjs`](../tests/authority.test.mjs)

**3. A real agent drives the flow from natural language, with no tool names.**
Across four milestones, agents were given the customer's words and nothing else.
→ [`m0-agent/agent-session-1.md`](m0-agent/agent-session-1.md), [`m3/runs/`](m3/runs/)

**4. The customer can complete a resolution unaided, and only the customer can.**
`commit()` refuses any actor that is not the customer; the invariant check
refuses a resolved state committed by anyone else.
→ [`../tests/authority.test.mjs`](../tests/authority.test.mjs)

**5. The design changed because of measurement, not taste.**
The contract shrank from four tools to two, and approval merged into commitment,
both as direct consequences of M2 findings.
→ [`../docs/WHY_WEBMCP.md`](../docs/WHY_WEBMCP.md) §7

---

## What is NOT proven

| Not claimed | Why |
|---|---|
| WebMCP is faster | Measured: marginally **slower** (54.2s vs 50.6s median, M2) |
| WebMCP raises task success | Measured: 21/30 vs 20/30 (M2), then 36/36 vs 36/36 (M3) |
| WebMCP makes agents smarter | Never measured |
| WebMCP prevents agents clicking | **Disproven** — see the actuation test |
| WebMCP guarantees human consent | Follows from the above |
| Works in ChatGPT | **UNVERIFIED** — never tested |
| Business or support-cost impact | Never measured |

Full audit, including the exact wording permitted for each supported claim:
[`m3/claims.md`](m3/claims.md)

---

## The milestones

### M0 — does WebMCP actually work?
Real `document.modelContext` in Chrome 151. A real agent discovered the tools and
selected them from natural language, never being told a tool name.
Also caught a real bug: the app told the agent approval was still needed *after*
the customer had approved, and the agent correctly refused to proceed.
→ [`m0-real/`](m0-real/), [`m0-agent/`](m0-agent/) (incl. [`pre-fix-run/`](m0-agent/pre-fix-run/), the run that found it)

### M1 — a resolution product, not a demo
Deterministic policy engine, three scenarios, generic contract, state invariants.
72 tests. → [`m1/`](m1/)

### M1.1 — would a real customer survive this?
A production audit found the app was **agent-only**: a customer could not start a
resolution without one. Fixed before any comparison ran, which strengthened the
baseline. → [`m1-production/`](m1-production/)

### M2 — does WebMCP actually help? *(132 runs)*
Matched browser-UI baseline vs WebMCP on the same live product.

| | Baseline | WebMCP |
|---|---|---|
| Successful resolutions | 20/30 | 21/30 |
| Policy-clean | 30/30 | 30/30 |
| Median turns | 3 | 3 |
| Premature commitments | **7/30** | **0/30** |

→ [`m2/reports/comparison.md`](m2/reports/comparison.md)

### M3 — converge, and re-test honestly *(72 held-out runs)*
Final commitment removed from the contract. New dataset, frozen and hashed before
any run, zero overlap with M2. The simulated customer answers from a declared
profile instead of a fixed "yes", which removed a real M2 confound.

**Result: the two modes were identical on every metric, and M2's premature-commit
difference did not reproduce — 0/36 both.**

Two things changed at once (the customer became explicit *and* the product merged
three steps into one), so we cannot attribute the change to either alone. This is
recorded as a major qualifier on the M2 claim rather than quietly dropped.
→ [`m3/reports/comparison.md`](m3/reports/comparison.md), [`m3/limitations.md`](m3/limitations.md)

### The actuation test — the uncomfortable one
Can an agent with *both* the contract and browser actuation press the commit
button?

| | |
|---|---|
| A script can press it, no user gesture | **YES** |
| An agent told to finish the job pressed it | **1 of 3 trials** |
| Any completion tool callable via the contract | **NO** |

This is why no security claim appears anywhere.
→ [`m3/actuation-test/actuation-test.json`](m3/actuation-test/actuation-test.json)

---

## Known limitations

- Three deterministic **fixtures**. No real orders, refunds, inventory, carriers
  or payment rails.
- **Not a security boundary** — see the actuation test.
- One model, one host across evaluations. Matched across modes, so the comparison
  is internally fair; absolute numbers are model-specific.
- Samples of 30–36 per mode, one run each. No significance testing.
- M3's dataset hit a **ceiling** — 100% on every metric in both modes. Fixing the
  M2 confound removed the discriminating signal along with it.
- Policy-correctness is a numeric heuristic; it flags candidates, not intent.
- **ChatGPT in-app browser: UNVERIFIED.**
- WebMCP is experimental; Chrome requires a flag.

---

## Reproducing

```bash
npm test                     # 31 unit tests
npm run verify:webmcp        # 22 live capability-boundary checks
npm run audit:production     # 13 production checks
```

Every report is regenerated from raw records by scripts in [`../harness/`](../harness/);
run records are append-only and the drivers refuse to overwrite without `--force`.
Each milestone directory carries its own `manifest.json` with per-file hashes.
