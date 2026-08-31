# Production error states (A9)

Contract-level probes against the live deployment. These drive the tools
directly, which is protocol testing — **not** agent evidence.

| Check | Result |
|---|---|
| invalid option: rejected with the eligible set, no state change | **PASS** |
| option from another scenario: rejected | **PASS** |
| repeated preparation: refused, first choice preserved | **PASS** |
| confirm is not offered before approval | **PASS** |
| stale option: rejected, names what was actually approved | **PASS** |
| repeated confirmation: second call refused, one result only | **PASS** |
| malformed input: handled without a crash | **PASS** |
| malformed input left the state intact | **PASS** |
| unsupported order id: explains which order is open | **PASS** |
| reset mid-flow: clean state and correct tool set | **PASS** |
| no stack traces or internal paths in customer-facing errors | **PASS** |

## Messages the customer/agent actually receives

| Situation | Response |
|---|---|
| invalid option | `"Not an eligible resolution for this order"` |
| option from another scenario | `"Not an eligible resolution for this order"` |
| repeated preparation | `{"error":"Tool \"prepare_resolution\" is not currently available on this page.","kept":"replacement"}` |
| confirm is not offered before approval | `["get_order","get_resolution_options"]` |
| stale option | `"The approved resolution is not the one supplied"` |
| repeated confirmation | `{"first":true,"second":"Tool \"confirm_resolution\" is not currently available on this page.","ref":"RF-1042"}` |
| malformed input | `"{\"ok\":false,\"error\":\"Not an eligible resolution for this order\",\"requested\":12345,\"eligible\":[\"replacement\",\"refund\",\"keep_partial_ref` |
| malformed input left the state intact | `"ORDER_ACTIVE"` |
| unsupported order id | `{"error":"That order is not the one open on this page","requested":"9999","openOrder":"1042"}` |
| reset mid-flow | `{"state":"ORDER_ACTIVE","tools":["get_order","get_resolution_options","prepare_resolution"]}` |

No stack traces, no internal paths, no silent failures, and no impossible
state transition was reachable.
