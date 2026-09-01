# Claim matrix — what each observation would license

Nothing in this table may be claimed until the corresponding observation is
actually made by a human in ChatGPT Desktop. Every row is currently
**unobserved**.

| # | Observation | Claim it would license | Claim it would NOT license |
|---|---|---|---|
| 1 | The Site Tools arrow appears on the production URL | "The site exposes WebMCP tools that ChatGPT Desktop discovers." | anything about tool *use* |
| 2 | The tool list shows exactly `get_order` and `prepare_resolution` | "The published contract is two tools." | that no other capability exists elsewhere |
| 3 | From natural language, with no tool named, ChatGPT calls `get_order` | "ChatGPT selected the site's tool from natural language." | that it will always do so |
| 4 | It reports the real order facts | "The agent read authoritative Shopify state through WebMCP." | that Shopify data is otherwise validated |
| 5 | It calls `prepare_resolution` and stops | "The agent prepares but does not submit." | that it *cannot* submit — it has no such tool, which is a contract fact, not an observation |
| 6 | Shopify shows no new Return afterwards | "Preparation creates no external mutation." | anything about the request path |
| 7 | Voice, with no tool named, triggers a Site Tool call | "Voice invoked the site's WebMCP tools." | that voice support is *official* — that needs OpenAI documentation |
| 8 | Voice only transcribes and the text agent then calls tools | "Voice input reached the agent, which then used Site Tools." | "voice-native WebMCP" |

## Hard rules

- **Never** write "Voice is officially supported for WebMCP." No documentation
  says so. See `docs/M4_3_PREFLIGHT.md` §1.
- **Never** attribute a ChatGPT observation to Claude or Codex. If a human did
  not run it in ChatGPT Desktop, it did not happen.
- If tools do not appear, that is a result worth recording, not a reason to
  change the app until the cause is understood.
