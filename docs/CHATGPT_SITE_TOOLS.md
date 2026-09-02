# Trying it in ChatGPT

The app publishes its capabilities through WebMCP. A ChatGPT client with a
WebMCP-capable built-in browser discovers them as **Website Site Tools** — you
do not install anything, and you never mention WebMCP or a tool name.

---

## Setup

1. Open the app in ChatGPT's **built-in browser**:
   <https://post-purchase-resolution.vercel.app/>
2. **Sign in normally, in the page.** Shopify emails a one-time code.

> ⚠️ **Never paste an authentication code, password or session cookie into the
> chat.** Sign in through the page's own control. The agent does not need — and
> must never be given — your credentials. The tools operate on whatever session
> the browser already holds.

## Ask for help in plain language

Describe the problem the way you would to a person. Do not give an order number
and do not name a tool.

> *"The earbuds I bought recently arrived damaged. The left side doesn't work.
> Can you find the purchase and tell me what I can do? Don't submit anything."*

### What should happen

The agent enumerates the site's tools and calls:

- **`find_order`** — searching your own purchases for something matching
  "earbuds"
- **`get_order`** — reading the authoritative facts: product, amount, payment
  and delivery status, whether it is returnable and why not if it isn't

It should come back with the specific purchase, its real state, and what the
merchant allows — without you having supplied an order number.

If you ask it to go further — *"can you get a return ready for me?"* — it will
also call **`prepare_resolution`**, which stages a return for you to look at.

### What should not happen

**No return is created.** There is no WebMCP tool that submits one, in any
state, so there is nothing for the agent to call. Submitting is your action, in
the page, with your own credential — and approving is the merchant's, with
theirs.

You can confirm this from the outside: after any agent session, the order still
shows no return in Shopify.

## Things worth trying

| Ask | Why it is interesting |
|---|---|
| *"Which of my purchases can I still return?"* | `find_order` with `returnable_only` — the agent filters on authoritative eligibility, not guesswork |
| *"Something's wrong with my headphones"* when you own two | it should present both and **ask which you mean**, never pick one |
| *"Return my toaster"* when you own no toaster | it should say it found nothing, not invent a purchase |
| *"Just submit the return for me"* | it cannot. Watch how it explains that the decision is yours |
| *"What's happening with my return?"* after requesting one | it reads live state from Shopify — `REQUESTED`, then `OPEN` once the merchant approves |

## Speaking instead of typing

A spoken request works the same way, because speech is an input to the
assistant rather than a separate path to the site. The chain is:

```
spoken request → ChatGPT agent turn → Website Site Tools → WebMCP invocation
```

This was verified in a brand-new chat with no prior context: the spoken sentence
above led the agent to discover the tools and find the right purchase.

**What that does not mean:** voice does not invoke WebMCP at the protocol
transport layer, and this project makes no such claim. See
[`evidence/m5-chatgpt-native/claims.md`](../evidence/m5-chatgpt-native/claims.md).

---

## Testing in Chrome directly

WebMCP is behind flags in Chrome. To inspect the page's tools yourself:

```bash
chrome --enable-features=WebMCPTesting,DevToolsWebMCPSupport \
       --enable-experimental-web-platform-features
```

Then in DevTools on the app:

```js
(await document.modelContext.getTools()).map(t => t.name)
// → ['find_order', 'get_order', 'prepare_resolution']   (signed in)
```

The set changes with state — that is the point. What it never contains, in any
state, is something that commits. The repository's own suite asserts exactly
that against live production:

```bash
APP_URL=https://post-purchase-resolution.vercel.app/ npm run verify:webmcp
```

## If the tools are not discovered

- Confirm you are in the **built-in browser**, not an external one.
- Confirm the page finished loading — tools register after the app boots.
- Confirm you are signed in. Signed out, the page falls back to a single
  merchant-configured order and a smaller tool set.
- Site Tools behaviour is a client feature outside this project's control, and
  it varies by client version.
