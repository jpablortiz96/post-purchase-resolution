# Public history sanitisation

Before this repository's final public release, its git history was rewritten.
**Every commit hash changed.** Nothing about the *content* of the work changed.

This note exists because evidence files in this repository cite commit hashes,
and some of those hashes no longer resolve. Pretending otherwise would
undermine the point of keeping evidence at all.

---

## What was changed

Exactly two things, and nothing else.

### 1. An email address in two evidence files

During an early smoke run, an agent echoed the repository owner's email address
into its own reply. That reply was captured verbatim as evidence and committed:

- `evidence/m1/agent-smoke.json`
- `evidence/m1/raw-smoke-3-arrived_late-t4.jsonl`

The address was replaced with `[email redacted]` in **2 blobs** across all
history. The surrounding transcript is untouched, so the evidence still reads as
what the agent actually said.

### 2. Claude co-author trailers

Every commit carried a `Co-Authored-By: Claude …` trailer. These are attribution
metadata, not content, and were removed from **33 commit messages**.

**What was deliberately kept:** a commit message describing the verification
harness — *"(Claude Opus) as a generic MCP host against the live HTTPS
deployment"* — is a factual statement about how a test was run. That is
substantive evidence and remains. The aim was to remove co-author attribution,
not to pretend AI tooling was never used.

---

## What was NOT changed

- **No evidence content was altered** beyond the single redacted address. No
  result, status, timestamp, count or JSON value was edited.
- **Commit authorship was not rewritten.** The author identity is the
  repository owner's own public git identity, deliberately set. Rewriting it
  would falsify authorship rather than protect anyone.
- **No commit was squashed or dropped.** All 34 commits survive, in order, with
  their original messages minus the trailer.
- **No file was removed.**

---

## Hash mapping

| Ref | Before sanitisation | After |
|---|---|---|
| `master` (local tip) | `d100f4c` | `0cf691a` |
| `master` (last public push) | `481215d` | superseded |
| tag `submission-webmcp-2026` → commit | `a82905d` | `688dae1` |

Older hashes appearing in evidence files and milestone reports — `fb98703`,
`2014a42`, `65e0482`, `5c4c850`, `b46f439`, `7cbdb88`, `1158592`, `dcbdb19`,
`727882f`, `481215d` and others — are **pre-sanitisation internal checkpoint
IDs**. They identified real commits whose content is preserved in this history
under new hashes. They are kept in the evidence as written rather than
retro-edited, because rewriting a record to match a later action is exactly the
habit this project avoids.

To locate the equivalent commit, search by message:

```bash
git log --all --oneline --grep="M4.4: close the final clean flow"
```

---

## Verification

After the rewrite, a fresh clone from GitHub was scanned. Reachable through
public refs:

| Check | Result |
|---|---|
| Claude co-author trailers | **0** |
| Anthropic no-reply co-author address in any commit message | **0** |
| The redacted email in any blob | **0** |
| Credential material (`shpat_`/`shcat_` + token characters) | **0** |
| `.env` ever committed | **no** |
| Backup bundle committed | **no** |
| Old unsanitised tags on the remote | **0** |

`.env` has never been committed at any point in this repository's history.

A complete pre-rewrite backup was taken as a local git bundle before anything
was changed. It is held privately, outside the repository, and is not published.

---

## Why this note is public

The alternative was to rewrite the evidence files so their hashes matched, which
would have meant editing records after the fact to make them look consistent.
That is a worse failure than a broken hash reference. The commit IDs changed;
the work did not; and this file says so.
