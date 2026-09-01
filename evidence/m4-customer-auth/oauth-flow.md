# OAuth flow as implemented

```
customer clicks "Sign in"
        │
        ▼
GET /api/auth/login
  discover  /.well-known/openid-configuration
            /.well-known/customer-account-api
  generate  state, nonce, code_verifier   (crypto.randomBytes)
  derive    code_challenge = BASE64URL(SHA256(verifier))
  seal      {state, nonce, verifier, exp} -> AES-256-GCM -> ppr_txn cookie
  302 -> discovered authorization_endpoint
        │
        ▼
Shopify customer sign-in  (email one-time code)
        │
        ▼
GET /api/auth/callback?code=...&state=...
  unseal ppr_txn            (null on any tampering -> rejected)
  check  expiry
  check  state              (timing-safe compare)
  POST   discovered token_endpoint
         grant_type=authorization_code
         client_id           (public client - NO secret)
         redirect_uri        (exactly the registered URI)
         code, code_verifier
  check  id_token nonce / issuer / audience
  seal   {access_token, exp} -> ppr_sess cookie
  clear  ppr_txn            (one-time material)
  302 -> /?signin=ok
        │
        ▼
GET /api/customer/*   ->  Customer Account API, discovered graphql_api,
                          Authorization: customer token (server-side only)
```

## Properties

| Requirement | How |
|---|---|
| Endpoints discovered, not hardcoded | `discover()` reads both well-known documents, cached 10 min |
| Public client, PKCE S256 | `code_challenge_method=S256`, no client secret in the customer flow |
| Admin secret never reused | `api/_lib/auth.js` never reads `SHOPIFY_CLIENT_SECRET` |
| `code_verifier` never in a URL | only inside the sealed cookie |
| Transaction survives serverless instances | it travels in the cookie, not process memory |
| Transaction integrity | AES-256-GCM; any tamper fails the auth tag and yields `null` |
| State compared securely | `crypto.timingSafeEqual` on equal-length buffers |
| One-time material cleared | `ppr_txn` cleared on success *and* on every failure |
| Token never reaches the browser | sealed in an `HttpOnly` cookie; `/api/auth/session` returns only a boolean and a countdown |
| Expected invalid input is not a 500 | missing code/state, bad state, forged or expired cookie all return 400 (or a clean redirect) |

## Minimum scope

`openid customer-account-api:full`

`email` is **not** requested. Nothing in the product needs it, and §6 forbids
returning it.
