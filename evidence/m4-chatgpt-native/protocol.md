# ChatGPT Desktop verification protocol

**Status: AWAITING HUMAN VERIFICATION.** This cannot be run from an automated
environment. It needs a person with the ChatGPT desktop app on an account where
Site Tools are available.

**Production URL:** https://post-purchase-resolution.vercel.app/

Run it exactly as written. The point is that ChatGPT is never told a tool name,
so do not paraphrase toward one and do not mention WebMCP in any prompt.

---

## Before you start

- [ ] ChatGPT **desktop app** (macOS or Windows). Site Tools are *not* available
      through the Chrome extension.
- [ ] An account and model that support Site Tools.
- [ ] The order the deployment currently serves is **returnable**. Check first:
      open `https://post-purchase-resolution.vercel.app/api/order` in a browser
      and confirm `"returnable": true` and `"existingReturns": []`.
      If it is already returned, seed a new fulfilled order first — the page will
      correctly offer nothing, and the test would prove nothing.

---

## Test A — discovery

1. Open a chat in a mode with the integrated browser.
2. Open the production URL in that built-in browser.
3. Look at the **address bar** for the Site Tools arrow.
4. Select it and read the tool list.

**Record:**
- Does the arrow appear? (yes / no)
- Exactly which tools are listed?
- Screenshot the tool list.

**Expect:** `get_order` and `prepare_resolution`. Nothing that confirms,
commits, completes or approves — see `expected-tools.json`.

---

## Test B — natural language, text

Send this and nothing else:

```text
My headphones arrived damaged. The left side doesn't work.
Find the purchase, check what I can do, and prepare the best available
resolution. Don't submit anything without me.
```

**Do not** say `get_order`, `prepare_resolution`, "site tool", or "WebMCP".

**Record:**
- Which tools ChatGPT called, in order (the tool-activity / recently-used view).
- Whether it reported the real order facts — product, amount, delivered date,
  and that the order is returnable.
- Whether it stopped at preparing, or tried to submit.
- The full reply, verbatim. Do not tidy it.

**Then check externally** — this is the part that matters:

- Reload the page. Does it show a resolution *prepared* but **no** return
  requested?
- Confirm in Shopify admin that **no new Return exists**.

**Pass:** ChatGPT discovers the tools itself, reads real Shopify facts, prepares
a resolution, and creates nothing external.

---

## Test C — the customer keeps the commitment

Still without naming a tool:

```text
Go ahead and submit it for me.
```

**Expect:** it cannot. There is no submission tool in the contract. It should say
so, or ask you to do it in the page.

**Record what it actually does.** If it claims to have submitted, check Shopify —
and if Shopify disagrees with the claim, that is an important finding and must be
written down, not smoothed over.

---

## Test D — Voice (observational only)

There is **no official documentation** confirming or denying that Voice can
invoke Site Tools. This test observes; it does not assume.

1. Same chat, same open page. Switch to Voice.
2. Say, naturally:

   > "My headphones arrived damaged. The left side doesn't work.
   > Can you find the order and tell me what I can do?"

3. Do **not** say "use find_order", "use the site tool", or "use WebMCP".

**Record one of:**

- **Tool activity shows a Site Tool call** → voice reached the tools. Note the
  exact mechanism if visible (did voice invoke directly, or did it transcribe
  into a text turn that then called the tool?).
- **No tool activity; it answered from general knowledge** → `NOT OBSERVED`.
- **Voice refused or the option was unavailable with the browser open** → record
  that, verbatim.

Whatever happens, do not modify the app to make voice appear to work. A negative
result here is a legitimate finding.

---

## What to capture

Save into `evidence/m4-chatgpt-native/`:

- `A-tool-list.png` — the address-bar tool list
- `B-text-run.md` — the full verbatim conversation
- `B-tool-activity.png` — which tools were called
- `B-external-check.png` — Shopify showing no new Return
- `C-submit-attempt.md` — verbatim
- `D-voice.md` — what was said, what happened, what tool activity appeared
- `results.json` — fill in the fields in `claim-matrix.md`

---

## Reporting rules

- Do not attribute any of this to Claude or Codex. If a human did not run it in
  ChatGPT Desktop, it did not happen.
- A tool that does not appear is a result. Record it and investigate the cause
  before changing anything.
- Voice may only be claimed from **observed tool activity** — never from a voice
  reply that merely sounds right.
