# Evidence — M0.5 Real WebMCP Resolution Spike

## Purpose

This directory stores verified empirical evidence of the real WebMCP protocol execution for the **Post-Purchase Resolution** spike.

---

## 1. Executive Summary

| Status Field | Verified Result | Notes |
|---|---|---|
| **M0.5 STATUS** | **FULL PASS** | All 9 real browser WebMCP tests verified |
| **RUNTIME** | **Chrome 151.0.7922.174** | Headless Chrome with `--enable-features=WebMCPTesting,DevToolsWebMCPSupport` |
| **TOOL_DISCOVERY** | **YES** | Real `document.modelContext.getTools()` discovery verified |
| **WEBMCP_IMPLEMENTATION** | **YES** | Imperative WebMCP API with AbortController lifecycle management |
| **WEBMCP_RUNTIME** | **YES** | `document.modelContext` detected as `ModelContext` object in real browser |
| **REAL_AGENT_INVOCATION** | **YES** | Tools invoked via `document.modelContext.executeTool(tool, jsonArgs)` |
| **HUMAN_APPROVAL_ENFORCEMENT**| **FULLY_VERIFIED** | Negative test proves execution blocked prior to explicit UI approval |

> **Security & Control Assertion**:
> *The workflow requires explicit visible human approval before the resolution execution becomes valid.*

---

## 2. Real WebMCP Verification Suite Matrix (Tests A — I)

| Test | Description | Status | Evidence Artifact |
|---|---|---|---|
| **TEST A** | WebMCP Runtime Availability | **PASS ✓** | [runtime.json](m0-real/runtime.json), [01_webmcp_available.png](m0-real/01_webmcp_available.png) |
| **TEST B** | Real Tool Discovery | **PASS ✓** | [tools-initial.json](m0-real/tools-initial.json), [02_tools_discovered.png](m0-real/02_tools_discovered.png) |
| **TEST C** | Tool Annotations Inspection | **PASS ✓** | `readOnlyHint: true` (get_order), `readOnlyHint: false` (prepare) |
| **TEST D** | Real `get_order` Execution | **PASS ✓** | [executions.jsonl](m0-real/executions.jsonl) (line 1), [03_get_order_real.png](m0-real/03_get_order_real.png) |
| **TEST E** | Real `prepare_replacement` + Lifecycle Mutation | **PASS ✓** | [tools-prepared.json](m0-real/tools-prepared.json), [04_prepare_real.png](m0-real/04_prepare_real.png) |
| **TEST F** | Pre-Approval Negative Security Test | **PASS ✓** | Rejection error logged: `"Customer has not approved yet"`, state unchanged, [05_preapproval_rejected.png](m0-real/05_preapproval_rejected.png) |
| **TEST G** | Human Approval Enforcement | **PASS ✓** | User clicks `#btn-approve`, state transitions to `AWAITING_APPROVAL`, [tools-approved.json](m0-real/tools-approved.json), [06_human_approval.png](m0-real/06_human_approval.png) |
| **TEST H** | Post-Approval Real `confirm_replacement` | **PASS ✓** | Creates Replacement `R-1042`, deregisters tool, state `RESOLVED`, [07_confirm_real.png](m0-real/07_confirm_real.png), [08_resolved_real.png](m0-real/08_resolved_real.png) |
| **TEST I** | Full System Reset & Re-registration | **PASS ✓** | Initial tools restored, all state cleared, [09_reset_real.png](m0-real/09_reset_real.png) |

---

## 3. Directory Layout

```
evidence/
├── README.md                  ← Full report & verification matrix
├── scripts/
│   ├── verify-webmcp.js       ← Automated real WebMCP runner (v4)
│   ├── discover-api.js        ← API surface discovery script
│   └── probe-executetool.js   ← WebMCP executeTool calling convention probe
└── m0-real/
    ├── 01_webmcp_available.png
    ├── 02_tools_discovered.png
    ├── 03_get_order_real.png
    ├── 04_prepare_real.png
    ├── 05_preapproval_rejected.png
    ├── 06_human_approval.png
    ├── 07_confirm_real.png
    ├── 08_resolved_real.png
    ├── 09_reset_real.png
    ├── runtime.json
    ├── tools-initial.json
    ├── tools-prepared.json
    ├── tools-approved.json
    ├── executions.jsonl
    ├── toolchange.log
    ├── console.log
    ├── api-discovery.json
    └── executeTool-probe.json
```

---

## 4. WebMCP Protocol Protocol Discoveries (Chrome 151)

1. **Discovery API**: `document.modelContext.getTools()` returns a `Promise<Array<RegisteredTool>>`. Each tool object contains `{ name, description, inputSchema, annotations, origin, title, window }`.
2. **Execution API**: `document.modelContext.executeTool(toolObject, jsonStringArgs)` requires passing the exact tool object (including its internal `window` reference) along with serialized JSON string arguments. It returns a `Promise<string>`.
3. **Event Subscriptions**: `document.modelContext.addEventListener('toolchange', callback)` accurately emits notifications on tool registration/deregistration.
4. **Tool Lifecycle Asynchrony**: Unregistering or registering tools synchronously inside an active `execute` handler can interrupt the WebMCP execution context in the browser engine. Tool mutations must be scheduled (e.g. via `setTimeout`) to allow `executeTool` to resolve cleanly.
