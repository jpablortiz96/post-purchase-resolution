# Customer journey — wrong variant

Live product: `https://post-purchase-resolution.vercel.app/`

**10 of 10** customer intents for this scenario completed end to end
with a real agent, in the customer's own words, with no tool names given.

## Intents exercised

| id | customer said |
|---|---|
| W01 | These aren't the ones I ordered. I need the correct version, not my money back. I have an event in three days. Ask me before finalising. |
| W02 | This isn't what I ordered. What can you do? Don't commit to anything yet. |
| W03 | Wrong size shoes turned up and I need the right pair for an event on Thursday. Sort out the best option and let me approve it. |
| W04 | You sent the wrong size. I'd rather get credit if it's worth more than a refund. What's available? Wait for my okay. |
| W05 | Ordered a 9, got an 8. Please get me the right ones. Nothing final until I say so. |
| W06 | Wrong size, and I need something wearable by Thursday. If the exchange can't make it in time tell me what else there is. Ask me before you do anything. |
| W07 | Wrong item. Options? Run them by me first. |
| W08 | Wrong size arrived. I'm happy with the brand so I'd prefer to stay with them rather than take my money back. What do you suggest? Get my approval before acting. |
| W09 | The shoes are the wrong size. Which option gets me the correct pair soonest? Don't finalise until I confirm. |
| W10 | Wrong size delivered. I can't get to a post office until next week — does that rule anything out? Tell me my options and wait for me. |

---

## Worked example — W01

**Customer:**

> These aren't the ones I ordered. I need the correct version, not my money back. I have an event in three days. Ask me before finalising.

**Agent called:**

```json
[
  {
    "name": "mcp__webmcp__get_order",
    "input": {}
  },
  {
    "name": "mcp__webmcp__get_resolution_options",
    "input": {}
  },
  {
    "name": "mcp__webmcp__prepare_resolution",
    "input": {
      "resolution_id": "exchange",
      "reason": "Customer received the wrong size (8 instead of 9) and needs the correct pair before an event in 3 days. Exchange delivers Size 9 in 2 business days, meeting the deadline, and does not require a refund since the customer wants the correct item, not their money back."
    }
  }
]
```

**Agent:**

> The exchange is prepared and waiting for your approval — you'll get the correct Size 9 shoes, arriving in about 2 days, well ahead of your event. You'll need to send back the Size 8 pair using the included prepaid label, but there's no charge to you.
> 
> Please review and confirm/approve it in the page UI when you're ready to finalize.

**Agent called:**

```json
[
  {
    "name": "mcp__webmcp__confirm_resolution",
    "input": {
      "resolution_id": "exchange"
    }
  }
]
```

**Agent:**

> All set! Here's the confirmation:
> 
> - **Exchange reference:** X-2087
> - **You'll receive:** Running Shoes, Size 9
> - **Arrival:** ~2 days (well before your event)
> - **Next step:** Return the Size 8 pair using the prepaid return label included with your shipment
> - **Cost to you:** $0
> 
> You're good to go — the correct pair should reach you in time for your event. Let me know if you need anything else.

**Customer pressed Approve in the page.**

| | |
|---|---|
| Resolution staged | `exchange` |
| Staged by | AGENT |
| Finalised before approval | no |
| Final state | `RESOLVED` |
| Reference | `X-2087` |
| Customer turns | 2 |
| Merchant facts unsupported by policy | 1 |

**Reasoning the agent wrote onto the decision card (verbatim):**

> Customer received the wrong size (8 instead of 9) and needs the correct pair before an event in 3 days. Exchange delivers Size 9 in 2 business days, meeting the deadline, and does not require a refund since the customer wants the correct item, not their money back.

---

Raw, unedited agent streams for every run above: [`../m2/runs/streams/`](../m2/runs/streams/)
