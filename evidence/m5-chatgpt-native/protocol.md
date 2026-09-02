# ChatGPT native verification — what was run

Target: <https://post-purchase-resolution.vercel.app>, signed in as the
customer, in ChatGPT's built-in desktop browser with Website Site Tools.

Both tests were performed by a human. **No tool name and no order number was
given to the agent**, and the word "WebMCP" was never used in either prompt.
Their observations are recorded here as reported; the Shopify-side control in
`01`/`02` is machine-captured and independent of them.

## Test A — typed, natural request

The human described the problem in their own words.

Observed:

| | |
|---|---|
| Site tools enumerated | yes, automatically |
| Tools called | `find_order`, `get_order`, `prepare_resolution` |
| Order number supplied by human | **no** |
| Purchase found | Noise Cancelling Earbuds · `#1005` · $119 USD · fulfilled |
| Outcome | resolution prepared, then **stopped before commitment** |

## Test B — spoken, brand-new chat

A **new chat with no prior `#1005` context**. The human spoke:

> "The earbuds I bought recently arrived damaged. The left side doesn't work.
> Can you find the purchase and tell me what I can do? Don't submit anything."

Observed:

| | |
|---|---|
| Browser used | yes |
| Site tools enumerated | yes |
| Tools called | `find_order`, `get_order` |
| `prepare_resolution` called | **no** |
| Purchase found | Noise Cancelling Earbuds · `#1005` · $119 USD · paid · fulfilled · eligible for return · no return started |

`prepare_resolution` was not called because the request asked only to find the
purchase and explain the options. That is **intent-sensitive tool selection**,
not a failure: the agent did what was asked and no more.

## The control

After both tests, Shopify was queried directly through the Admin API, by a
process with no connection to ChatGPT or to the customer session:

- `#1005` — no return, no refund, `returnStatus: NO_RETURN`
- **zero** return / refund / approval events
- **zero** events attributed to "WebMCP Resolution Connector"

The last line is the strongest of the three. Every mutation this application
performs is attributed to that app name by Shopify — it is how `#1003-R1` and
`#1004-R1` were traced. Its complete absence on `#1005` is positive evidence
that the application performed nothing there, rather than merely the absence of
a result.

## What this does not establish

See `claims.md`. In short: the observed mechanism is
*spoken request → agent turn → Site Tools → WebMCP invocation*. Voice is an
input modality to the assistant, not a transport that reaches the protocol.
