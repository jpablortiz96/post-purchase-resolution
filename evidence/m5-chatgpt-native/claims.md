# What ChatGPT verification does and does not support

Two tests were run by a human against the deployed production site in ChatGPT's
built-in browser, using its Website Site Tools. Their observations are recorded
in `protocol.md`. The Shopify-side control is machine-captured and independent.

## Supported

**On discovery**

> A person described a problem in their own words and the agent found the right
> purchase. No order number was given.

Test A: the human described the situation; the agent enumerated the site's tools
and returned Noise Cancelling Earbuds, `#1005`, $119 USD, fulfilled. Test B did
the same in a **new chat with no prior context**.

**On the spoken request**

> A spoken request in ChatGPT led the agent to discover and use the site's
> WebMCP tools.

That is the exact wording that is supported, and no stronger.

**On the capability boundary**

> The agent read and prepared. It could not commit, and it did not.

Independently verified against Shopify: `#1005` has **no return**, **no refund**,
`returnStatus: NO_RETURN`, and — the sharper point — **zero events attributed to
this application**. Every mutation this app performs is attributed by Shopify to
"WebMCP Resolution Connector", as on `#1003-R1` and `#1004-R1`. On `#1005` there
is no such event to find.

**On intent-sensitivity**

> The agent chose tools according to what was asked. Told to find and explain,
> it found and explained; it did not stage a resolution.

Test B asked only to find the purchase and explain the options, and the agent
called `find_order` and `get_order` but **not** `prepare_resolution`. Test A,
which asked for help resolving it, did prepare one and then stopped.

## Not supported — do not claim

**"Voice directly invokes WebMCP at the protocol transport layer."**

It does not, and nothing observed suggests it does. The mechanism actually
observed has four steps, and the voice part ends at the first:

```
spoken user request
  → ChatGPT agent turn
    → Website Site Tools
      → WebMCP tool invocation
```

Speech is an input modality to the assistant. The tool call is made by the agent
turn that follows, over the same path a typed request uses. Anything that
implies a voice-to-protocol binding is false.

**"ChatGPT natively supports WebMCP" as a general statement.**

What was observed is that ChatGPT's built-in browser enumerated and called this
site's tools, on this date, on this deployment. That is a product behaviour
observed twice — not a documented guarantee, and not something this project can
promise about future versions.

**Any claim of statistical reliability.**

Two runs. They are existence proofs that the flow works end to end, not a
measurement of how often it does.

**"The agent was prevented from committing by ChatGPT."**

The restraint is in the *site*, not the client. The WebMCP surface contains no
completion tool in any state — verified by the boundary suite, 22/22 — so there
was nothing for any agent to call. In an earlier milestone an agent did press
the commit control in the page's UI in 1 of 3 trials, which is exactly why the
guarantee is stated as "the tool does not exist" rather than "the agent
behaves".
