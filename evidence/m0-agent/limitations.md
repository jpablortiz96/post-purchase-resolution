# M0.6 — Limitations and Claim Discipline

This file records what the M0.6 evidence does **not** prove, and the exact
boundaries of what it does. Read it before quoting any result.

---

## 1. The primary specified environment was NOT tested

The brief names **ChatGPT's in-app browser with WebMCP support** as the primary
test environment. **That test was not performed.** It requires a human operating
the ChatGPT application on a device; it is not reachable from this automation
environment.

Everything in this evidence directory comes from the substitute environment
described in section 2. Any claim of the form *"this works in ChatGPT"* is
**unsupported** by this evidence.

A re-run protocol for a human to execute the same J1–J6 sequence inside ChatGPT
is in [`chatgpt-protocol.md`](chatgpt-protocol.md).

---

## 2. What the "real agent" actually was

| Component | What it really is |
|---|---|
| Model | Claude Opus, chosen by `--model opus` |
| Host | Claude Code CLI in non-interactive mode, acting as a generic MCP host |
| Transport | A local MCP stdio server (`harness/mcp-webmcp.js`) that re-publishes the page's own tools |
| Page | The live public HTTPS deployment, in Chrome with the WebMCP runtime enabled |
| Execution | `document.modelContext.executeTool()` in the real page |

The model was given:

- the natural-language prompt only — **no tool names**
- a neutral system prompt that names no tools (reproduced verbatim in the session files)
- **zero** built-in agent tools (`--tools ""`)
- **no** other MCP servers (`--strict-mcp-config`)

So the tool *set* came from the page, and the tool *choice* came from the model.

### The executeTool distinction

M0.5 was correctly downgraded because a **script** decided which tool to call and
then invoked `executeTool`. That is manual invocation.

In M0.6 the **model** decides which tool to call; `executeTool` is only the
transport that carries that decision into the page. This is architecturally the
same thing a WebMCP-capable host browser does internally.

**However** — the bridge that performs this translation is our own code, not a
third-party host. A reviewer is entitled to say that we have proven *"a real LLM
selects and drives the page's WebMCP tools from natural language"* but **not**
*"an independent commercial agent product works against this page."* Only the
ChatGPT test in section 1 would establish the latter.

---

## 3. The approval gate — what is and is not proven

**Supported claim:**

> The workflow requires a visible approval step before execution becomes valid.

**NOT supported, and not claimed:**

- ~~"The agent can never bypass human approval."~~
- ~~Cryptographic proof of human identity.~~
- ~~Proof that a hostile agent could not reach the approval control by another route.~~

What actually holds the gate is two separate things, and both should be stated:

1. **Application-side:** `confirm_replacement` returns an error unless the state
   machine is in `AWAITING_APPROVAL`, and only the UI Approve control performs
   that transition. Approve is **not** a WebMCP tool.
2. **Harness-side:** the bridge's human surface (`/approve`, `/reset`) is not
   exposed through MCP, so the model had no path to it.

Point 2 is a property of this harness, not of the application. In a real browser
the agent also cannot click the button — but that is a property of the *host
browser's* sandboxing, which this evidence does not test.

---

## 4. A real defect the agent found (and why it matters)

The first full run **failed J5**, and the failure was the application's fault.

In state `AWAITING_APPROVAL` — which in this state machine means *the human has
already approved* — `get_order` was reporting:

```json
{ "status": "awaiting_human_approval", "requires_human_approval": true }
```

The agent read that literally, said the customer had not approved yet, and
refused to finalize. It was right; the payload was lying.

The M0.5 manual `executeTool` script never caught this, because it called
`confirm_replacement` blindly without reading the semantics of the response.
**This is the concrete value of testing with a real agent.**

The raw pre-fix transcripts are preserved unmodified in
[`pre-fix-run/`](pre-fix-run/). The fix changed only the reported payload; the
4-state machine, its transitions and the dynamic tool lifecycle are unchanged.

---

## 5. Environment quirks that required workarounds

### 5.1 Chrome returns `inputSchema` as a JSON string

`document.modelContext.getTools()` in Chrome 151 returns `inputSchema` and
`annotations` as **serialized JSON strings**, not objects. An MCP host that
forwards them verbatim has every tool silently rejected as schema-invalid — the
tools simply never reach the model, with no error anywhere.

This cost a full invalid run before it was spotted. Any WebMCP→MCP bridge must
`JSON.parse` these fields. See `normalize()` in `harness/bridge-server.js`.

### 5.2 Tool-search deferral had to be disabled

Claude Code defers tool schemas behind a search step by default. Left on, the
page's tools would not sit directly in the model's context, which would confound
"did the agent discover the tools". Disabled with `ENABLE_TOOL_SEARCH=0`.

### 5.3 `--tools ""` also strips MCP tools

The flag filters the *entire* tool set, not just built-ins. It is safe here only
because the MCP tools are re-added afterwards; this was verified explicitly
(`init.tools` in every session file shows exactly the page's tools).

---

## 6. Scope of the application itself

- One hard-coded order fixture (`#1042`). No database, no persistence, no auth.
- State is in-memory; a page reload resets everything.
- `R-1042` is a fixed string, not a generated identifier.
- Three tools only. No error-recovery paths beyond the state guards.
- Headless Chrome with `--enable-features=WebMCPTesting,DevToolsWebMCPSupport`
  is a **testing** configuration, not a shipping consumer browser setup.

---

## 7. Agent resume behaviour

The agent does **not** spontaneously notice the new tool after human approval and
continue on its own. It requires a further user message (`"Continue."`).

This is behaviour **B** in the brief's taxonomy and is explicitly acceptable for
M0. It is a property of the turn-based host, not of WebMCP: the page does emit a
`toolchange` event and the bridge does emit
`notifications/tools/list_changed`, but nothing wakes a turn-based agent that is
not currently in a turn.
