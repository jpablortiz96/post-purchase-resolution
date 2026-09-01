# M4.3 preflight

Verified 2026-09-01. Every item is labelled **DOCUMENTED** (stated in official
docs), **OBSERVED** (measured here, against the real store or the deployment),
or **UNVERIFIED** (neither).

---

## 1. OpenAI — ChatGPT desktop, Site Tools, WebMCP

| | Finding | Class |
|---|---|---|
| Site Tools exist | ChatGPT can use tools a website provides, in the desktop app's built-in browser | **DOCUMENTED** |
| Mechanism | Site tools use WebMCP | **DOCUMENTED** |
| Discovery UI | If a site provides tools, **an arrow appears in the address bar**; selecting it lists available tools | **DOCUMENTED** |
| Availability | Requires a supported **account, model, and webpage**; built-in desktop browser only, **not** the Chrome extension | **DOCUMENTED** |
| Whether *this* site's tools appear for a given account | — | **UNVERIFIED** — needs a human with ChatGPT Desktop |

→ [Using site tools in the ChatGPT desktop app](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app)
· [Using the built-in browser](https://help.openai.com/en/articles/20001277-using-the-built-in-browser-in-the-chatgpt-desktop-app)

### Voice

| | Finding | Class |
|---|---|---|
| Voice exists on desktop (macOS/Windows) | yes | **DOCUMENTED** |
| Voice **can** invoke Site Tools | no official statement found either way | **UNVERIFIED** |
| Nearest documented limit | "voice mode currently does not support **apps**" — that is Apps/connectors, a *different* feature from Site Tools | **DOCUMENTED (adjacent, not equivalent)** |

**`VOICE_WEBMCP_SUPPORT: UNVERIFIED_BY_DOCUMENTATION`.** No claim either way. The
adjacent limitation is suggestive but is not about Site Tools, and treating it as
if it were would be inference, not evidence.

→ [Voice Mode FAQ](https://help.openai.com/en/articles/9617425-advanced-voice-mode-faq)

---

## 2. Shopify — Customer Account API

| | Finding | Class |
|---|---|---|
| Customer Account API available on this store | discovery endpoints resolve | **OBSERVED** |
| `/.well-known/openid-configuration` | 200 · issuer `https://shopify.com/authentication/102186582388` | **OBSERVED** |
| `/.well-known/customer-account-api` | 200 · GraphQL at **2026-07**; an `mcp_api` endpoint is also advertised | **OBSERVED** |
| Scopes offered | `openid`, `email`, `customer-account-api:full`, `customer-account-mcp-api:full` | **OBSERVED** |
| PKCE | `code_challenge_methods_supported: ["S256"]` | **OBSERVED** |
| Public clients use PKCE, receive **no refresh token** | | **DOCUMENTED** |
| `orderRequestReturn` initiates a customer return request | | **DOCUMENTED** |
| `returnInformation` → `returnableLineItems` / `nonReturnableLineItems` | buyer-facing eligibility, incl. ineligibility reasons | **DOCUMENTED** |
| Requires Headless/Hydrogen channel **or** `customer_authentication` app config | | **DOCUMENTED** |
| Callback URLs must be HTTPS; localhost unsupported | | **DOCUMENTED** |
| Protected customer data: no review needed on a **development store** | | **DOCUMENTED** (confirmed in M4.1) |

→ [Customer Account API](https://shopify.dev/docs/api/customer/latest)
· [Build self-serve returns](https://shopify.dev/docs/apps/build/orders-fulfillment/returns-apps/build-self-serve-returns)
· [Customer authentication](https://shopify.dev/docs/api/customer-authentication)
· [Getting started](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/getting-started)

### The decisive probe

Driving the authorization endpoint in a real browser with the existing app
`client_id` returned **HTTP 400** with:

> *"El parámetro redirect_uri no es una coincidencia válida"* — the `redirect_uri`
> parameter is not a valid match.

**This is the useful result.** The error is about the *redirect URI*, not the
client. The client is recognised as a customer-authentication client; what is
missing is a registered callback URL. **OBSERVED.**

So customer authentication is **not architecturally blocked** — it is one
configuration entry away.

---

## 3. `BLOCKED_CUSTOMER_AUTH_CONFIGURATION`

Registering a callback URL requires the Shopify Dev/Partner dashboard or a CLI
deploy with partner credentials. Neither exists in this environment.

### Exact manual steps

1. Open the app in the Shopify **Dev Dashboard** (the app whose client id ends
   `…5e90`), or open `shopify.app.toml` if managing it by CLI.
2. Find **Customer Account API** → *Customer authentication* (in TOML: the
   `[customer_authentication]` module).
3. Add this **callback / redirect URI** exactly:

   ```
   https://post-purchase-resolution.vercel.app/api/auth/callback
   ```

4. Confirm the app is a **public client using PKCE** (no client secret in the
   customer flow — the secret stays with the Admin API app).
5. Ensure **Customer accounts** are enabled for the store, and that the store has
   the **Headless** (or Hydrogen) channel if the dashboard requires it for
   Customer Account API credentials.
6. Save, then tell me. No code change is needed to *begin* the flow — the client
   id and discovery endpoints are already correct.

Nothing was faked in the meantime: there is no stub customer session, no
pretend sign-in, and no mock token anywhere in the tree.

---

## 4. Why `find_order` was not shipped

§5 asks for natural order discovery. It is **deliberately not implemented yet**,
because implementing it now would make security *worse*, not better.

Without an authenticated customer there is no customer to scope a search to. A
`find_order` built on the Admin API would search **every order in the store** —
precisely the arbitrary-order access §4 requires be removed. Shipping it before
auth would contradict the milestone's own security requirement.

The design, ready to build the moment auth lands:

```
find_order({ product_query, delivered_only, since_days })
  → Customer Account API, scoped to the authenticated customer's own orders
  → returns sanitized candidates, never a silent best guess
  → 0 matches  → say so
  → 1 match    → return it
  → 2+ matches → return all candidates and ask which one
```

Final surface would then be **three** tools — `find_order`, `get_order`,
`prepare_resolution` — because folding find into get would overload one tool with
two different questions ("which purchase?" vs "what about this purchase?") and
lose the ambiguity path.

---

## 5. Security defects found in production, and what was done

All three were found by probing the live URL during this milestone.

| Defect | Status |
|---|---|
| `/api/return-approve` callable by **anyone** — merchant authority, publicly exposed | **FIXED** — now requires a server-side operator credential; returns 401 without it |
| `/api/order?order=…` allowed cross-order lookup within an allowlist | **FIXED** — callers cannot select an order at all; the parameter is ignored and only the server-side active order is served |
| `/api/return-request` callable anonymously | **MITIGATED, NOT FIXED** — see below |

### On the merchant credential

It is a 64-hex-character token held only in server environment variables and
compared in constant time. The operator pastes it once per browser session; it is
**never** in page source.

It is **not** merchant identity and is not presented as production
authentication. §13 forbids an insecure static PIN dressed up as auth — so the
honest description is: *a stopgap that makes anonymous approval impossible until
a real merchant session exists*. The UI says the same thing in customer language.

### On the customer request path

`/api/return-request` still has no authenticated customer, because customer auth
is blocked (§3). What it can now touch is bounded to a single server-chosen
development-store order, and it cannot be pointed at anything else. That is a
mitigation, not a fix. The fix is `orderRequestReturn` under a customer token,
which is designed in §6 and blocked on the same callback URL.

---

## 6. Planned authority migration, once auth lands

| Action | Authority | API |
|---|---|---|
| find / read the customer's orders | **customer** | Customer Account API |
| return eligibility | **Shopify** | `returnInformation` |
| prepare a resolution | agent | no mutation |
| request the return | **customer** | `orderRequestReturn` (customer token) |
| approve the return | **merchant** | `returnApproveRequest` (Admin API) |

That split is cleaner than today's, where the customer's action runs under an
Admin credential. Per §7 it will not be migrated blindly: API equivalence, state
semantics, error shapes and duplicate behaviour get established first.

---

## 7. What remains UNVERIFIED

- ChatGPT Desktop Site Tools discovery for this site — needs a human.
- Natural-language tool selection by ChatGPT — needs a human.
- Voice → Site Tools, in documentation **and** in observation.
- Customer Account API end-to-end — blocked on the callback URL.
- `orderRequestReturn` behaviour, duplicate semantics and errors — untested,
  because it cannot be reached without a customer token.
