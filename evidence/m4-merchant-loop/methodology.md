# M4.2 methodology

## Architecture

```
CUSTOMER ─── customer page ───┐
                              ├── Vercel serverless (/api/*) ── Shopify Admin GraphQL
MERCHANT ─── /merchant.html ──┘         (secrets live here only)
AGENT ────── WebMCP: get_order, prepare_resolution
```

The browser never holds a Shopify credential. `SHOPIFY_CLIENT_SECRET` and the
access token exist only inside the serverless functions; the token is obtained
with `client_credentials`, cached in module scope, and renewed a minute before
expiry.

## Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/order` | GET | sanitized order + returnability + existing returns |
| `/api/return-request` | POST | `returnRequest` — customer action |
| `/api/return-approve` | POST | `returnApproveRequest` — merchant action |
| `/api/return-status` | GET | independent re-read of external return state |

Mutations are POST-only; a GET returns 405.

## Sanitization

An **allowlist**, not a deny-list, in `api/_lib/shopify.js`. A field reaches the
browser only if named there, so a Shopify schema change cannot silently start
leaking customer data. Global IDs are reduced to their last path segment; no
email, name, address, phone, admin URL or token is ever included.

## The WebMCP contract is unchanged

Still exactly `get_order` and `prepare_resolution`, and still state-aware. In
live mode:

| Live state | Tools registered |
|---|---|
| order active, returnable | `get_order`, `prepare_resolution` |
| order active, not returnable | `get_order` |
| resolution prepared | `get_order` |
| return requested / approved | `get_order` |

`returnRequest` and `returnApproveRequest` are **not** agent tools. The customer
submits the request in the page; the merchant approves it on their own surface.
The M3 capability-boundary thesis survives the integration intact.

## Authority

| Actor | Can |
|---|---|
| **Shopify** | holds eligibility, returnability and status. System of record. |
| **Agent** | read the order, prepare a return request. No mutation. |
| **Customer** | submit the request. Creates a real Shopify Return. |
| **Merchant** | approve it. `REQUESTED → OPEN`, in Shopify. |

## No optimistic UI

Neither surface renders a state it has not read back from Shopify. After the
merchant approves, the desk re-queries and renders whatever Shopify returns —
including a failure. The customer page polls `/api/order` every 6 seconds and
derives its state from external truth, never from what it remembers doing.

## Reproducing

```bash
cp .env.example .env          # fill in the four Shopify values
node --env-file=.env harness/dev-server.js       # static + /api on :3000
node --env-file=.env harness/shopify/verify-adapter.js   # adapter vs real Shopify
node harness/live-ui-check.js                    # live UI + merchant desk
node harness/webmcp-m3-check.js                  # fixture regression, ?mode=fixtures
npm test                                         # 31 unit tests
```
