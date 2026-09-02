# Security policy

## Reporting a vulnerability

Please report privately, through
[GitHub Security Advisories](https://github.com/jpablortiz96/post-purchase-resolution/security/advisories/new).

**Do not open a public issue containing credentials, personal data, session
cookies, tokens, or a proof-of-concept that embeds any of those.** If the
finding cannot be described without them, describe the shape of the problem and
say that the details are available privately.

Useful in a report: what you did, what happened, what you expected, and whether
the finding needs an authenticated session.

## Scope

This is a hackathon project running against a **Shopify development store with
test payments**. There is no production merchant deployment and no real
customer data. Findings are still welcome — the authority model is the point of
the project, so anything that breaks it is worth reporting.

Particularly interesting:

- reaching a customer's data without their session
- reaching *another* customer's order from a valid session
- performing a commerce mutation without the corresponding authority
- a credential reaching browser-delivered code
- causing an agent-reachable path to mutate anything

## What the design guarantees

- **No WebMCP tool mutates.** The published surface is `find_order`,
  `get_order`, `prepare_resolution`, in every state. There is no return
  request, approval or refund tool for an agent to call.
- **Secrets stay server-side.** The Shopify Admin token and client secret are
  read only inside `api/` serverless functions. Nothing in `src/` can import
  them, and the commerce security suite asserts they are absent from every
  browser-delivered file.
- **Customer scoping is enforced by the token**, not by filtering. Every
  customer query runs under that customer's own Customer Account API token, and
  order ids resolve against their own order list rather than being passed
  through — a forged or borrowed id does not resolve.
- **Mutations are `POST`-only**, re-read authoritative state immediately before
  acting, and refuse a duplicate when a live return already exists.

## Known limitations

Stated plainly, because pretending otherwise would be the real vulnerability:

- **Merchant access is a shared operator credential**, not merchant identity or
  OAuth. It is compared in constant time and prevents anonymous approval, but it
  is not production-grade merchant authentication, and anyone holding it holds
  merchant authority.
- **Second-customer isolation is proven only in the negative.** Forged and
  foreign identifiers are rejected; that customer A cannot reach customer B's
  order needs a second account and has not been run.
- **The `id_token` signature is not re-verified against JWKS.** Issuer, audience
  and nonce are checked, and the token arrives directly from the issuer over TLS
  in a back-channel code exchange, where OIDC does not require it. Moving to an
  implicit or hybrid flow would make JWKS verification mandatory.
- **Sessions do not refresh.** Shopify issues no refresh token to public
  clients, so a session lives as long as its access token and then requires
  signing in again.

## Handling of secrets and personal data

`.env` is gitignored and has never been committed. Public evidence is
PII-minimised: personal names in Shopify event logs are replaced with roles
before capture, and no token, authorization code, PKCE verifier or session
cookie appears in any committed file.

The repository's history was rewritten before public release to remove an email
address that an agent transcript had recorded into an evidence file. See
[`PUBLIC_HISTORY_SANITIZATION.md`](PUBLIC_HISTORY_SANITIZATION.md).
