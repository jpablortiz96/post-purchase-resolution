# Submission copy

Reusable sections. Devpost field names are not assumed — map these to whatever
the form actually asks for.

Replace `<FINAL_NAME_CHOSEN_BY_USER>` throughout.

---

## Tagline (≤ 60 chars)

> Merchant defines. Agent prepares. Customer commits.

Alternates:

> A smaller agent surface for when a purchase goes wrong.
> Post-purchase resolution with the commitment left to the customer.

---

## Short summary (≈ 40 words)

> Agents are learning to help us buy. This is what happens when the purchase goes
> wrong. The site publishes two WebMCP tools so an agent can inspect an order and
> prepare a merchant-authorised resolution — while the customer keeps the final
> commitment.

---

## Longer description

Buying is the easy half of commerce. When something goes wrong afterwards, the
customer has to find the order, work out which remedies the merchant actually
allows, weigh them against their own situation — *I fly tomorrow, so a refund in
three to five days is no use* — and then click through a flow. An agent trying to
help has to infer all of that by reading the page, and the site has no way to say
what is permitted, or to keep the consequential step out of the agent's reach.

`<FINAL_NAME_CHOSEN_BY_USER>` is a post-purchase resolution flow built on a
different division of labour:

**The merchant defines the truth.** A deterministic policy engine — no model, no
randomness — owns eligibility, refund amounts, store credit, replacement timing,
return requirements and availability. The same order and issue always produce the
same options.

**The agent prepares.** Through two WebMCP tools it reads the order and every
permitted resolution as structured data, compares them against what the customer
said, and stages one with a short reason. It never decides what is permitted.

**The customer commits.** The product shows a decision card with the agent's
reasoning and the merchant's fixed terms visually separated. The customer can
swap option, cancel, or press **Approve & complete**. That action is not in the
WebMCP contract.

Three scenarios are implemented end to end: a damaged product, a wrong variant,
and a late delivery — each with three merchant-authorised remedies.

---

## Why this is a strong fit for WebMCP

Most agent-web integrations ask: *how do we let an agent do everything a user can
do?* This project asks the opposite question: **what should a site deliberately
not expose?**

WebMCP is what makes that question answerable. Because the site publishes its own
tool contract, it can offer a surface shaped for the collaboration it wants
rather than a mirror of its interface:

| | Inspect | Compare | Prepare | Change option | Commit |
|---|:---:|:---:|:---:|:---:|:---:|
| Website UI | ✓ | ✓ | ✓ | ✓ | ✓ |
| WebMCP contract | ✓ | ✓ | ✓ | — | **—** |
| Customer | ✓ | ✓ | ✓ | ✓ | ✓ |

Two other WebMCP properties do real work here:

- **Structured merchant facts.** The agent receives amounts, timings and
  requirements as data, so it reasons over merchant truth instead of inferring
  policy from prose.
- **State-aware tool lifecycle.** Tools register and deregister as the state
  changes. Once a resolution is staged, `prepare_resolution` is withdrawn — the
  decision now belongs to the customer.

We are explicit about the limit: this is a statement about the published
contract, not a security boundary. We tested whether an agent with both the
contract and browser actuation could press the commit control. It could, and in
one of three trials it did. That result is in the repository.

---

## How it improves the user experience

- The customer describes the problem in their own words. No order lookup, no
  policy reading, no comparing remedies by hand.
- Everything the merchant permits arrives as one comparable set, so the
  recommendation is grounded in the customer's actual constraint — travel
  tomorrow, an event in three days, cannot reach a post office this week.
- The decision card separates **the agent's reasoning** from **the merchant's
  terms**, so a recommendation is never mistaken for policy.
- One action completes it. An earlier design had the customer approve and then
  return to the agent to execute; measurement showed that frequently just stalls,
  so it was removed.
- A customer with no agent at all can do the whole thing themselves.

---

## What humans and agents can do together that was difficult before

Without a published contract, an agent helping with a return is guessing: which
remedies exist, what they are worth, how long they take, whether a return is
required. And a site has no way to distinguish *let the agent prepare this* from
*let the agent commit to this* — a click is a click.

WebMCP makes that separation expressible. The agent does the mechanical and
interpretive work and hands over a concrete, merchant-valid proposal; the person
sees exactly what was prepared, on what terms, and by whom; and the consequential
act stays with them by design rather than by convention.

---

## How WebMCP was implemented

Tools are registered imperatively with `document.modelContext.registerTool()`,
each with an `AbortController` so the set can change with application state.

**`get_order`** (`readOnlyHint: true`) returns the order, issue, customer
context, the current resolution state, and `resolutionOptions` — every permitted
remedy with its monetary effect, timing, return requirement and availability.

**`prepare_resolution`** stages one option with the agent's reason. Its
`resolution_id` is constrained by a schema `enum` to the currently eligible ids,
so the contract itself refuses an invented resolution.

The registered set follows the state machine:

```
ORDER_ACTIVE          get_order, prepare_resolution
RESOLUTION_PREPARED   get_order
RESOLVED              get_order
RESOLUTION_CANCELLED  get_order, prepare_resolution
```

No state registers a tool that completes a resolution. Completion is a customer
action in the page, guarded by a state machine that refuses any actor other than
the customer and rejects a commit raised against a stale selection.

One implementation note worth passing on: Chrome returns `inputSchema` and
`annotations` from `getTools()` as **serialized JSON strings**. A host that
forwards them verbatim has every tool silently dropped as schema-invalid, with no
error anywhere. That cost us a full invalid evaluation run before we found it.

---

## Testing instructions

WebMCP is experimental, so Chrome needs a flag. Close Chrome first, then:

**macOS**
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --enable-features=WebMCPTesting,DevToolsWebMCPSupport \
  --enable-experimental-web-platform-features
```

**Windows**
```bat
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --enable-features=WebMCPTesting,DevToolsWebMCPSupport ^
  --enable-experimental-web-platform-features
```

1. Open **https://post-purchase-resolution.vercel.app/** — the badge should read
   *WebMCP Active*.
2. Pick a scenario (Damaged / Wrong Size / Arrived Late), or press *Reset*.
3. Ask your agent, in your own words:
   > *"The headphones arrived broken and I travel tomorrow. Find the best option,
   > but let me decide before anything is completed."*
4. Watch the resolution appear as a decision card — the agent's reasoning and the
   merchant's terms shown separately.
5. Press **Approve & complete**, or *Choose another* first. The result and the
   audit trail update in the page.

You never need to know a tool name. Expand *"How the agent interacts"* if you
want to watch the live tool set change with state.

To verify the contract yourself:

```bash
npm install
npm test                  # 31 unit tests
npm run verify:webmcp     # 22 live capability-boundary checks
```

---

## Built with

JavaScript (ES modules, no framework) · WebMCP (`document.modelContext`) ·
Chrome 151 · Vercel · Node.js `node:test` · puppeteer-core (verification harness
only)

---

## What's next *(future — not built, not validated)*

Merchant integration, a Shopify app, or a reusable post-purchase WebMCP package
so any merchant could publish a resolution contract. No demand has been
validated and nothing here is a revenue claim.
