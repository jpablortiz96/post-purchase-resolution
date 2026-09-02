# Screenshots

Two rules govern this directory:

1. **Nothing here is generated, mocked or reconstructed.** Every image is a real
   capture of the deployed application.
2. **A shot that cannot be captured honestly is left as a slot**, described
   below, rather than faked.

## Captured

| File | What it shows | How it was captured |
|---|---|---|
| `05-merchant-access-required.png` | Merchant desk with no operator credential: access required, queue hidden | headless Chrome against production |
| `06-merchant-access-rejected.png` | Merchant desk with an invalid credential: explicitly rejected, queue still hidden | headless Chrome against production, deliberately wrong credential |

Together these two are the access-control proof: without an accepted
credential the desk shows no queue and offers no approve control, and it says
which of the two situations applies rather than failing silently.

## Slots — must be captured by a human

These need something this environment does not have, and must not be
substituted with anything else.

| File | What it must show | Why it cannot be captured here |
|---|---|---|
| `01-customer-inbox.png` | The purchase inbox: Noise Cancelling Earbuds, Smart Fitness Watch, state labels | The customer session is an `HttpOnly` cookie in the signed-in browser. No external process can hold it. |
| `02-agent-ready.png` | "Ready for your decision" — a prepared resolution the customer has not committed | same |
| `03-site-tools.png` | ChatGPT's own trace showing `find_order`, `get_order`, `prepare_resolution` | Inside the human's ChatGPT Desktop session. It exposes no trace to this environment. **Do not reconstruct this image.** |
| `04-requested.png` | Customer view of `#1004-R1` at `REQUESTED` | Needs the signed-in session, and `#1004-R1` has since moved to `OPEN` |
| `07-merchant-queue.png` | The queue listing a `REQUESTED` return with its Approve control | Needs the current production operator credential, which is held by the merchant operator |
| `08-approved.png` | Customer view of `#1004-R1` at `OPEN` / "Return approved" | Needs the signed-in session |
| `09-shopify-proof.png` | Shopify Admin showing the same Return, **redacted** | Shopify Admin shows customer email and shipping address. Any capture must be redacted before it is committed. |

`docs/CAPTURE_GUIDE.md` gives the exact sequence and redaction rules.

## Redaction rules for anything added here

Before committing an image, remove: email addresses, customer or staff names,
postal addresses, phone numbers, the operator credential, and any access token.
Crop browser chrome that carries a session or a URL with query credentials.

The machine-readable proof of every claim in the README lives in `evidence/`
and does not depend on any screenshot.
