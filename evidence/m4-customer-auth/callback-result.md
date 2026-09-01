# Callback

## Status: implemented, not exercised with a real code

A real authorization code requires a completed email one-time-code sign-in. See
`limitations.md` §1.

## What has been verified, live

| Case | Result |
|---|---|
| no `code` | 400 `MISSING_CODE` |
| no `state` | 400 `MISSING_STATE` |
| wrong `state` | 400 `STATE_MISMATCH` |
| no transaction cookie | 400 `NO_TRANSACTION` |
| tampered transaction cookie | 400 `NO_TRANSACTION` (AEAD auth tag fails) |
| forged transaction cookie | 400 `NO_TRANSACTION` |
| Shopify returns `error=access_denied` | 302 to `/?signin=failed`, no 500 |

Every failure path clears `ppr_txn`, so one-time material never survives a
failed attempt.

In normal use the callback redirects to `/?signin=ok` or `/?signin=failed` and
never renders a code, token or error body to the customer. `?debug=1` returns the
structured error instead — used by the security tests above.

## Not verified

Token exchange, nonce/issuer/audience validation on a real `id_token`, and
session establishment. All implemented; none observed.
