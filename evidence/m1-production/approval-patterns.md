# Approval & continuation UX (A8)

Three production interaction patterns, measured rather than assumed.

| Pattern | What the customer does |
|---|---|
| **A** | Presses Approve. Sends no message. |
| **B** | Presses Approve, then says "Continue." |
| **C** | Presses Approve, then says "I've approved the resolution. Continue." |

## Measured

| Pattern | Mode | Runs | Reached RESOLVED | Successful | Median customer turns | Approval violations |
|---|---|---|---|---|---|---|
| A | baseline | 30 | 8/30 | 0/30 | 2 | 8 |
| A | webmcp | 6 | 0/6 | 0/6 | 2 | 0 |
| B | baseline | 30 | 27/30 | 19/30 | 3 | 8 |
| B | webmcp | 6 | 4/6 | 4/6 | 3 | 0 |
| C | baseline | 30 | 27/30 | 20/30 | 3 | 7 |
| C | webmcp | 30 | 21/30 | 21/30 | 3 | 0 |

## Finding

**Pattern A does not work, in either mode.** A turn-based agent is not running
when the customer presses a button, so nothing wakes it. The approval lands, the
workflow stops, and the customer is left with a staged resolution and no
obvious way forward. This is a property of turn-based agents, not of WebMCP:
the page does emit `toolchange`, and the bridge does emit
`notifications/tools/list_changed`, but there is no agent turn to receive them.

That result is the direct justification for the **"Complete resolution now"**
control added during M1.1. It means the customer is never dependent on an
assistant noticing: after approving, they can finish the resolution themselves,
in the product, in one click.

## Production recommendation, based on the above

1. **Keep the customer able to finish unaided.** The "Complete resolution now"
   control makes pattern A a dead end only for the *agent*, not for the person.
2. **Prefer pattern C wording for agent continuation.** Stating that approval
   happened is more reliable than a bare "Continue.", which agents reasonably
   read as ambiguous before an irreversible action.
3. **Do not rely on the agent resuming by itself.** Any product built on this
   should assume the customer speaks again, or completes it in the UI.
