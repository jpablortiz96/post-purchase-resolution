# M4.5 — ChatGPT native verification, evidence manifest

Production: <https://post-purchase-resolution.vercel.app>
Order under test: `#1005` · Noise Cancelling Earbuds · $119 USD

Product functionality is **frozen** for this milestone: no file under `src/`,
`api/`, `index.html` or `merchant.html` was modified. Everything here is
evidence and documentation.

| File | What it is |
|---|---|
| `protocol.md` | what was run, in what order, and by whom |
| `claims.md` | the exact claim language that is supported, and what must not be claimed |
| `01-external-no-mutation-control.json` | `#1005` after both tests: no return, no refund, `NO_RETURN` |
| `02-authority-absence.json` | `#1005` event log: zero return/refund/approval events, zero events attributed to this app |
| `03-prior-run-unchanged.json` | `#1004-R1` still `OPEN` — the M4.4 clean run was not disturbed |
| `auth-security-tests.json` | customer auth negative suite, live — 32/32 |
| `security-tests.json` | commerce security suite, live — 21/21 |
| `capability-boundary/` | WebMCP boundary suite, live — 22/22 |
| `limitations.md` | what these two runs do not establish |

## The shape of the proof

The interesting evidence here is an **absence**, and it is only meaningful
because the corresponding presence was established earlier.

Shopify attributes every mutation this application performs to
`WebMCP Resolution Connector`. That is how the earlier milestone traced who did
what:

```
#1004-R1  15:40:39Z  app=true user=false  WebMCP Resolution Connector  requested return
#1004-R1  17:43:12Z  app=true user=false  WebMCP Resolution Connector  approved return
```

On `#1005`, after an agent read it and prepared a resolution against it, there
is **no such event, and no return at all**. The agent could not commit because
the WebMCP surface exposes no tool that commits — in any state — and the
boundary suite re-confirms that on the live deployment at 22/22.

## Regression at freeze

unit **56/56** · auth security **32/32** · commerce security **21/21** ·
live UI **12/12** · capability boundary **22/22**

## Sanitisation

No token, authorization code, PKCE material, email, name, address or phone
appears in any file here. Personal names in the event timeline are replaced with
roles.

The two security suite files contain strings such as
`gid://shopify/Order/12602041…`; these are the **forged probe inputs the suites
deliberately send** to prove such identifiers are rejected. They are test
inputs, not customer data.
