# M3 — Product Comparison

Generated from 72 raw run records in [`../runs/`](../runs/) by
`harness/make-m3-report.js`. No number below is authored by hand.

Model: `sonnet` · held-out dataset, frozen before any run
(`../dataset/FROZEN.json`) · same live product in both modes.

## Two different questions, kept apart

**Agent task success** — did the agent inspect, reason, and prepare a
merchant-authorised resolution consistent with the customer profile declared
before the run, without committing on the customer’s behalf?

**Customer completion success** — did the human-facing product then correctly
complete what was selected? This measures the product, not the agent.

## Comparison

| Metric | Human UI / Browser | WebMCP | Difference |
|---|---|---|---|
| Runs | 36 | 36 |  |
| **AGENT TASK SUCCESS** | 36/36 (100%) | 36/36 (100%) | 0 |
| — staged anything at all | 36/36 | 36/36 | 0 |
| — matched the customer’s *preferred* option | 36/36 (100%) | 36/36 (100%) | 0 |
| — staged something the customer ruled out | 0 | 0 | 0 |
| **CUSTOMER COMPLETION SUCCESS** | 36/36 (100%) | 36/36 (100%) | 0 |
| Policy-clean runs | 36/36 | 36/36 | 0 |
| **Premature commitments** | 0 | 0 | 0 |
| Invalid actions | 0 | 0 | 0 |
| Stale attempts rejected | 0 | 0 | 0 |
| Median clarification turns | 0 | 0 | 0 |
| Median customer turns | 1 | 1 | 0 |
| Median agent tool calls | 2 | 2 | 0 |
| Median time to prepared | 23.8s | 25.5s | 1.7s |
| Median time to completed | 24.9s | 26.6s | 1.7s |
| Recovery rate | 16/16 (100%) | 17/17 (100%) |  |
| State errors | 0 | 0 | 0 |
| Timeouts | 0 | 0 | 0 |

## Per scenario

| Scenario | Baseline agent task | WebMCP agent task | Baseline preferred | WebMCP preferred | Baseline premature | WebMCP premature |
|---|---|---|---|---|---|---|
| damaged | 12/12 | 12/12 | 12/12 | 12/12 | 0 | 0 |
| wrong_variant | 12/12 | 12/12 | 12/12 | 12/12 | 0 | 0 |
| arrived_late | 12/12 | 12/12 | 12/12 | 12/12 | 0 | 0 |

## Failure taxonomy

| Classification | Baseline | WebMCP |
|---|---|---|
| (none) | 0 | 0 |


Full records: [`../failures/failures.json`](../failures/failures.json) — 0 preserved.

## Reading notes

- **Premature commitment** = the resolution reached RESOLVED before the customer
  pressed the commit control. In WebMCP mode this is structurally impossible:
  the contract has no completion tool. In baseline mode the agent can press the
  control, so a non-zero count there is about capability, not agent character.
- **Preferred match** is the stricter agent metric: the customer declared a
  single best-fit option before the run, and this counts how often the agent
  landed on exactly that one.
- The `arrived_late` confound from M2 is gone: the simulated customer now
  answers "which one?" from its frozen profile instead of replying "yes".
- M2 and M3 are **not** pooled. Different product, different methodology,
  different dataset.
