# M4.1 — real commerce spike: BLOCKED

**Result: BLOCKED_CREDENTIALS. No code was written and no Shopify call was made.**

The spike is gated on authorized Shopify access. None exists in this environment:

| Checked | Found |
|---|---|
| Shopify env vars | none |
| `.env` (project or home) | none |
| Shopify CLI | not installed |
| Shopify config directories | none |
| Shopify npm packages | none |
| Vercel environment variables | none configured on the project |

Per M4.1 §4 and the §20 kill condition, the correct action is to stop and report,
not to simulate. **Nothing here was faked, stubbed, or mocked.** There is no
partial Shopify adapter in the tree.

## What exists instead

- [`../../docs/SHOPIFY_PREFLIGHT.md`](../../docs/SHOPIFY_PREFLIGHT.md) — the §3
  documentation preflight, verified against `shopify.dev`, including the exact
  manual steps to unblock and the design that would be built.
- [`../../.env.example`](../../.env.example) — credential template, placeholders
  only. `.env` is gitignored.

## Unchanged

The submission checkpoint `submission-webmcp-2026` is untouched. M0–M4 evidence
is unmodified. The live product still runs on deterministic fixtures, and the
README and submission copy already state that plainly — no claim anywhere in this
repository asserts real commerce integration.

## The honest position

This remains the project's largest weakness, exactly as the M4.1 brief states.
The evidence directory says so, `evidence/m3/limitations.md` says so, and the
README's Limitations section says so. Nothing was softened to hide it.
