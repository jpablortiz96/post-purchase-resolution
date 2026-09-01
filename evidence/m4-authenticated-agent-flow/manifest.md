# M4.4 — evidence manifest

Production: <https://post-purchase-resolution.vercel.app>

## In this directory

| File | What it is |
|---|---|
| `security-tests.json` | commerce security suite, live production — 21/21 |
| `auth-security-tests.json` | customer auth negative suite, live production — 32/32 |
| `capability-boundary/` | WebMCP boundary suite, live production — 22/22 |
| `limitations.md` | what is implemented but unproven, and why |
| `manifest.md` | this file |

No token, authorization code, PKCE material, email, name, address or raw
Shopify gid appears in any file here.

## How to reproduce

```
npm test                                                   # 50/50, offline
APP_URL=https://post-purchase-resolution.vercel.app/ \
OUT_DIR=evidence/_latest node harness/security-tests.js
APP_URL=... OUT_DIR=evidence/_latest node harness/auth-security-tests.js
APP_URL=... OUT_DIR=evidence/_latest node harness/live-ui-check.js
APP_URL=... OUT_DIR=evidence/_latest/capability-boundary \
  node harness/webmcp-m3-check.js
```

`OUT_DIR` now defaults to `evidence/_latest`, never to a milestone directory.
An earlier run of the boundary check overwrote the M3 screenshots; that was
restored byte-for-byte, and the default was changed so a re-run cannot do it
again. Point `OUT_DIR` at a milestone directory only deliberately.

## The authenticated surface

The authenticated contract exists only inside a signed-in browser, so it cannot
be captured from a server or a headless run without that session. Open:

```
https://post-purchase-resolution.vercel.app/?verify=1
```

while signed in. The page exercises the **real registered WebMCP tools** and
appends a sanitized report (also on `window.__selfCheck`), covering:

- the tool surface is `find_order` / `get_order` / `prepare_resolution`
- no completion tool is exposed
- `find_order` finds a purchase from a plain description
- `find_order` returns `none` rather than inventing one
- `find_order` refuses to guess when several match (`NOT_PROVEN` with one purchase)
- `get_order` reads a customer-scoped purchase and leaks no PII
- an injected `purchase_id` cannot select another order
- `prepare_resolution` creates **no** return — returns are captured before and after
- the prepared resolution stays uncommitted

Server-side scoping and discovery are covered separately by
`/api/customer/verify`, which runs the same way and for the same reason.

## Not captured here

The customer mutation, the resulting `REQUESTED`, the merchant approval and the
resulting `OPEN` are absent because the mutation has never run — there is no
returnable order left in the account. See `limitations.md` §1.
