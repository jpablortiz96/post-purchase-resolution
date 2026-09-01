# Shopify configuration status

The blocker reported at the end of the previous milestone is **resolved**. The
Shopify side was verified, not modified.

| Item | Status |
|---|---|
| `[customer_authentication]` block present | yes |
| Callback registered | `https://post-purchase-resolution.vercel.app/api/auth/callback` |
| JavaScript origin registered | `https://post-purchase-resolution.vercel.app` |
| Logout URL registered | `https://post-purchase-resolution.vercel.app` |
| Client id | matches `SHOPIFY_CLIENT_ID` |
| Released version | `webmcp-resolution-connector-3` (reported by operator) |

## Verified independently

Driving the **discovered** authorization endpoint in a real browser with the
registered redirect URI now returns **HTTP 200** and lands on Shopify's real
customer sign-in page.

The previous run returned **HTTP 400 — "redirect_uri is not a valid match"**.
That error is gone.

## The 404 that prompted this milestone

`GET /api/auth/login` returned Vercel's 404 for a plain reason, confirmed rather
than assumed:

| Check | Result |
|---|---|
| `api/auth/*` files exist locally | **no** |
| present in commit `62bd94b` | **no** |
| present at `HEAD` at the time | **no** |
| `vercel.json` rewrites interfering | **no** — there is no `vercel.json`; routing is zero-config |
| `.vercelignore` excluding them | **no** |

**Cause: the routes had never been written.** The previous milestone named
`/api/auth/callback` in `docs/M4_3_PREFLIGHT.md` as the *planned* redirect target
to be registered on the Shopify side, and reported customer auth as
`BLOCKED_CUSTOMER_AUTH_CONFIGURATION`. No auth code was ever created. The 404 was
correct behaviour for a route that did not exist — not a deployment, routing or
configuration fault.

They exist now:

| Route | Live status |
|---|---|
| `GET /api/auth/login` | 302 → Shopify authorize |
| `GET /api/auth/callback` | 302 (redirects with a status; 400 with `?debug=1`) |
| `GET /api/auth/session` | 200 `{"authenticated":false}` |
| `POST /api/auth/logout` | 200 · GET returns 405 |
| `GET /api/customer/whoami` | 401 until signed in |
| `GET /api/customer/orders` | 401 until signed in |
