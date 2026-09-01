# M4.3 customer auth — limitations

## 1. No real sign-in was completed

The flow is built and deployed. **It has not been driven end to end**, because
Shopify customer sign-in is an **email one-time code**: the login page asks for
an email address and sends a code to that mailbox. Nothing in this environment
can receive email.

Observed on the real login page:

```
inputs : [{type: email, name: customer-authentication-web-email}, {type: checkbox, name: marketing-consent}]
buttons: ["Enviar"]
```

So everything downstream of the redirect is **implemented but unproven**:

| | Status |
|---|---|
| authorization request | **verified** (live, 302 to Shopify, correct params) |
| Shopify accepts the redirect URI | **verified** (200, real login page) |
| code → token exchange | **unproven** |
| id_token nonce / issuer / audience checks | **unproven** |
| customer session established | **unproven** |
| Customer Account API call | **unproven** |
| customer-scoped orders | **unproven positively** — proven negatively (401 on every attempt) |
| `find_order` behaviour | **unproven** |

Nothing was stubbed or mocked to paper over this. There is no fake session, no
pretend token, and no code path that fabricates an authenticated state.

## 2. Customer scoping is proven only in the negative

32/32 security tests confirm nothing reaches customer data **without** a valid
session, and that no parameter — `key`, `customerId`, an order GID, an order
number — widens scope. That is the important half.

The other half, that a signed-in customer sees *their own and only their own*
orders, rests on Shopify enforcing the token, plus `getOrder()` resolving keys
against the customer's own order list rather than passing an identifier through.
Sound by construction, **not yet observed**.

Proving it properly needs **two** customer accounts with orders, then checking
that account A cannot reach account B's order. That test is written down here as
required, and has not been run.

## 3. `find_order` is not in the WebMCP contract

It exists in the customer API layer, gated behind the session. It is deliberately
**not** exposed as a WebMCP tool, because §11 permits that only after customer
scoping passes, and scoping is unproven (§2).

Exposing it now would put a search tool in front of agents whose scoping has
never been observed working. The contract therefore remains **two** tools:
`get_order`, `prepare_resolution`.

## 4. The product still reads orders through the merchant path

The live customer page continues to read the order via the Admin-API route from
M4.2. Sign-in is additive — it establishes a session and proves the flow — but
the order shown is not yet customer-scoped.

That migration is deliberately not done: §13 says not to migrate until
equivalence and state semantics are proven, and they cannot be proven without a
completed sign-in.

## 5. `orderRequestReturn` was not spiked

Researched (documented in `docs/M4_3_PREFLIGHT.md`) but not exercised: it needs a
customer token. Until then the buyer-facing request still runs through the Admin
API path, which works but places the customer's action under merchant authority
— the weaker arrangement, and the reason the migration is wanted.

## 6. id_token signature is not verified against JWKS

Nonce, issuer and audience are checked. The signature is not re-verified,
because the token is received directly from the issuer over TLS in a
back-channel code exchange, where OIDC does not require it. If this ever moves to
an implicit or hybrid flow, JWKS verification becomes mandatory.

## 7. Session storage

The customer session is an AES-256-GCM sealed, `HttpOnly; Secure; SameSite=Lax`
cookie. It is opaque to browser JavaScript and tamper-evident. No database was
introduced for OAuth.

Consequence: the session lives as long as the token (no refresh token is issued
to public clients, per Shopify docs). Re-authorisation with `prompt=none` is
**not** implemented — it would be guesswork before a single real sign-in has
been observed.

## 8. Unchanged

- ChatGPT Desktop Site Tools: **not started**, correctly gated behind auth.
- Voice: **UNVERIFIED_BY_DOCUMENTATION**.
- Development store, test payments. No real customers, no real money.
