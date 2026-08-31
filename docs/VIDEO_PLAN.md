# Demo video plan

**Target: 2:15–2:35. Hard ceiling 2:45 in the source edit.**
Public YouTube, audio narration, no copyrighted music, no third-party marks.

> **Status: NOT PRODUCED.** This is the shot list and script. Recording, editing
> and uploading still need to be done by a person.

---

## Before you record

Launch a clean Chrome with WebMCP enabled and nothing else running:

```bash
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --enable-features=WebMCPTesting,DevToolsWebMCPSupport \
  --enable-experimental-web-platform-features
```

Checklist:

- [ ] New Chrome profile — no bookmarks bar, no extensions, no personal tabs
- [ ] Notifications off (macOS Focus / Windows Focus Assist)
- [ ] Zoom to ~125% so text is readable at 1080p
- [ ] Badge reads **WebMCP Active**
- [ ] "How the agent interacts" panel **collapsed** to start
- [ ] Press *Reset scenario* before each take
- [ ] No terminal, no IDE, no localhost — use the live URL only
- [ ] Deliberate cursor movement; pause ~1s after each click

Record at 1080p or better. Capture the agent side in whatever WebMCP-capable
agent you're using, side by side with the page or cut between them.

---

## Script

Timings are targets, not a straitjacket. Narration is written to be read at a
natural pace — roughly 150 words/min.

### 0:00–0:12 · The problem

**Screen:** the live app, damaged headphones order. Slow scroll over the issue
and "Customer travels tomorrow".

> "Agents are getting good at helping us shop. Buying is the easy half. This is
> about what happens when the purchase goes wrong."

---

### 0:12–0:25 · The customer's own words

**Screen:** cut to the agent. Type it live.

> *"The headphones arrived broken and I travel tomorrow. Find the best option,
> but let me decide before anything is completed."*

> "No order number. No policy reading. No tool names."

---

### 0:25–0:55 · The agent works

**Screen:** the agent calls `get_order`, then `prepare_resolution`. Show the
returned options briefly — enough to see real amounts and timings, not enough to
become a JSON tour. Cut back to the page as the decision card appears.

> "The site hands the agent the order and every resolution this merchant allows —
> as data. Amounts, timing, whether a return is needed. The agent doesn't decide
> what's permitted; it compares what is."
>
> "It picks the replacement, because it's the only option that arrives before the
> flight. And it prepares it."

---

### 0:55–1:12 · The payoff

**Screen:** the decision card, full width. Let it breathe. Point out the two
blocks: the dashed **assistant's reasoning**, the solid **merchant terms**.
Then click **Approve & complete**. Show RESOLVED and the reference id.

> "Here's what the customer sees. The assistant's reasoning, clearly marked as
> reasoning. The merchant's terms, fixed by policy. And one action — theirs."

*(Click. Beat. Let RESOLVED land.)*

---

### 1:12–1:35 · Why WebMCP

**Screen:** the capability table (slide or the README table).

> "The website can do more than it exposes. Through WebMCP it publishes two
> tools: inspect the order, and prepare a resolution. Completing one isn't in the
> contract at all. That's the design — a site can offer a smaller surface than
> its own interface."

---

### 1:35–1:55 · Under the hood

**Screen:** `src/app.js`, just the two `registerTool` blocks. Then the "How the
agent interacts" panel expanded, showing the tool list change as state changes.

> "Two tools, registered against `document.modelContext`. And they're state-aware
> — once a resolution is staged, the tool that would restage it is withdrawn.
> The decision now belongs to the customer."

*Do not scroll the repository.*

---

### 1:55–2:15 · It generalises

**Screen:** switch to **Arrived Late**. Same flow, fast cuts: ask → prepare →
approve & complete.

> "Same contract, different problem. A gift that arrived after the birthday —
> where the best answer isn't a refund, it's keeping the item and taking the
> credit. The merchant defines that. The agent just reads it."

---

### 2:15–2:30 · Close

**Screen:** the three-line thesis, then the live URL.

> "Merchant defines. Agent prepares. Customer commits."
>
> "It's live, and the evaluations that shaped it are in the repository —
> including the ones that didn't go our way."

**End card:** `<FINAL_NAME_CHOSEN_BY_USER>` · production URL

---

## Claim discipline while narrating

**Do not say:**

- "WebMCP was 30% safer" — or any percentage framed as safety
- "7 out of 30 versus 0 out of 30" — M3 did not reproduce it; don't headline it
- "prevents agents from clicking" — disproven by our own actuation test
- "guarantees", "safest", "dramatically faster", "smarter"

**Optional, and true, if you want an evidence beat:**

> "Our evaluations changed the product. Rather than have the customer approve and
> then go back to the agent to execute, we shrank the agent's callable surface
> and let the customer complete it directly."

---

## Screenshots to pull from the same session

Four to six, no more:

1. Order + issue + customer context (the problem)
2. Decision card — reasoning and merchant terms side by side
3. Resolved state + audit trail showing AGENT / CUSTOMER / SYSTEM
4. Capability table
5. *(optional)* Second scenario decision card
6. *(optional)* "How the agent interacts" panel, tools visible

Existing captures suitable for reuse: `evidence/m3/screenshots/`
