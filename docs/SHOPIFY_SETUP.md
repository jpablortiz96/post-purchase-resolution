# Shopify setup

From an empty Shopify development store to a working authenticated flow. Allow
about half an hour, most of it waiting for Shopify.

Nothing here reveals this project's credentials. Every value is one you create.

---

## 1. Development store

In the [Shopify Dev Dashboard](https://shopify.dev/dashboard), create a
**development store**. Choose one that supports **test payments** — the whole
flow depends on placing real orders that move no money.

Note the store domain, e.g. `my-store.myshopify.com`.

## 2. App

In the same dashboard, create an **app**. You need three things from it:

- **Client ID** — public, goes in `SHOPIFY_CLIENT_ID`
- **Client secret** — server-side only, goes in `SHOPIFY_CLIENT_SECRET`
- the ability to edit its configuration (`shopify.app.toml`)

## 3. Scopes

The app needs **both** Admin API and Customer Account API scopes. Missing
customer scopes is the failure that looks most confusing: authentication
succeeds, and then every GraphQL query fails.

```toml
[access_scopes]
scopes = "read_orders,read_returns,write_returns,customer_read_customers,customer_read_orders,customer_write_customers"
```

| Scope | Needed for |
|---|---|
| `read_orders` | reading orders through the Admin API |
| `read_returns` | reading return state |
| `write_returns` | `returnApproveRequest` — merchant approval |
| `customer_read_customers` | the `customer` root field — without it *every* customer query fails |
| `customer_read_orders` | the customer's own orders |
| `customer_write_customers` | `orderRequestReturn` — the customer's own return request |

## 4. Customer authentication

Still in `shopify.app.toml`:

```toml
[customer_authentication]
redirect_uris = [
  "https://YOUR_DOMAIN/api/auth/callback"
]
javascript_origins = [
  "https://YOUR_DOMAIN"
]
logout_urls = [
  "https://YOUR_DOMAIN"
]
```

The callback must match **exactly** — scheme, host, path, no trailing slash.
A mismatch produces `redirect_uri is not a valid match` at the authorize
endpoint.

**On localhost.** Shopify Customer Accounts requires HTTPS for the callback, so
`http://localhost` will not work as a registered redirect URI. Develop the
authenticated flow against a deployed HTTPS URL (a Vercel preview is enough), or
put an HTTPS tunnel in front of your local server and register the tunnel's
URL. Everything that does *not* need a customer session — the unit tests and
`?mode=fixtures` — runs on plain localhost with no configuration at all.

## 5. Release the configuration

```bash
shopify app deploy
```

**Editing the toml is not enough.** Until this releases, the file is local and
Shopify still enforces the previously released scopes. If customer queries fail
straight after a scope change, this is almost always why.

## 6. Install and approve

Install the app on the development store and approve the scopes.

## 7. Test customer

Create a customer on the store with an email address **you can receive mail
at** — Shopify Customer Accounts signs in with an emailed one-time code, so a
fake address makes sign-in impossible.

## 8. Test order

Place an order **as that customer**, through the storefront, paid with the test
gateway. Then in Shopify Admin:

1. **Mark as fulfilled**
2. **Mark as delivered**

Both matter. Return eligibility depends on delivery, and an order that is only
"fulfilled" may report nothing returnable.

Use a **distinct product per test order**. Ambiguous product names make
`find_order` correctly refuse to guess, which is right behaviour but a confusing
first experience.

## 9. Environment

Copy `.env.example` to `.env` and fill it in. Every variable is documented
there. The two you generate yourself:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

— once for `SESSION_SECRET`, once for `MERCHANT_OPERATOR_TOKEN`.

⚠️ **Quote any value containing `#`.** Node's `--env-file` treats an unquoted
`#` as a comment, which silently truncates the value — order names begin with
`#`, so `SHOPIFY_DEMO_ORDER_NAMES` must be quoted.

For a deployment, set the same variables as Vercel environment variables so
they stay server-side:

```bash
vercel env add SHOPIFY_CLIENT_SECRET production
```

## 10. Sign in

Open the deployed app and use the sign-in control. Shopify emails a one-time
code to the customer's address. After the callback you should see that
customer's purchases.

## 11. Verify

Signed in, open:

```
https://YOUR_DOMAIN/api/customer/verify
```

It runs the whole customer-scoped checklist inside your own session and returns
a sanitized report — session state, a minimal-query ladder that names the exact
field if something is wrong, customer scoping, foreign-identifier rejection, and
`find_order` behaviour. It never passes a check whose dependency failed.

Add `?verify=1` to the app itself to exercise the **registered WebMCP tools** in
the browser and confirm that preparing a resolution creates nothing — it
captures returns before and after.

---

## When it goes wrong

| Symptom | Cause |
|---|---|
| `redirect_uri is not a valid match` | callback in `shopify.app.toml` differs from `SHOPIFY_CUSTOMER_REDIRECT_URI` |
| Auth succeeds, every customer query fails | customer scopes not released — run `shopify app deploy`, then sign out and back in |
| `Invalid token, missing prefix shcat_` | an Admin token was sent to the Customer Account API |
| A `Bearer` prefix is rejected | the Customer Account API takes the bare token, no scheme |
| Nothing is returnable | the order was not marked **delivered**, or a return already consumed it |
| A variable is silently empty | an unquoted `#` truncated it |

The `/api/customer/verify` ladder is the fastest way to find which of these you
have: it reports the first failing field rather than condemning a large query.
