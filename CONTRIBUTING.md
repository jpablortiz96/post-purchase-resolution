# Contributing

Thanks for looking. This repository holds itself to an unusual standard about
evidence, so it is worth reading this before opening a PR.

## Setup

```bash
git clone https://github.com/jpablortiz96/post-purchase-resolution.git
cd post-purchase-resolution
npm install
npm test        # 56 offline unit tests — no credentials needed
npm start       # http://localhost:3000
```

Open <http://localhost:3000/?mode=fixtures> for the deterministic scenarios.
They need no Shopify connection and are how most changes can be developed.

For the live commerce path, copy `.env.example` to `.env` and follow
[`docs/SHOPIFY_SETUP.md`](docs/SHOPIFY_SETUP.md).

## The rules that matter

### No secrets, ever

No credential belongs in a commit, a test fixture, an evidence file, a
screenshot or a log. Everything sensitive is read from the environment inside
`api/` and never crosses into `src/`.

Naming a credential is fine — `SHOPIFY_CLIENT_SECRET`, the `shpat_` prefix, a
leak-detection regex. **Credential material is not.** The security suites make
that distinction deliberately, matching a prefix followed by token characters
rather than the prefix alone.

### No PII

No email address, name, postal address or phone number in any committed file.
That includes evidence: Shopify event logs name real people, so personal names
are replaced with roles before capture, and Admin screenshots are redacted
before they are committed — never after.

An agent transcript can leak PII without anyone noticing; this happened here
once, and it is why evidence is scanned rather than trusted.

### No mutation tests against real commerce

Do not write a test that creates, approves, refunds or cancels anything in a
live store. Verification against real commerce is **read-only**; the harnesses
under `harness/shopify/` are inspectors by design.

Commerce mutations happen only through a deliberate human action in the product,
against a development store, with evidence captured either side.

### Evidence discipline

If you change behaviour that a claim depends on, re-run the suite that proves it
and update the evidence. The chain is **claim → test → external system → raw
evidence**, and a claim without the last link does not go in.

Two specifics:

- **Historical evidence is immutable.** Do not overwrite a milestone directory.
  `OUT_DIR` defaults to `evidence/_latest` for exactly this reason; point it at
  a milestone only deliberately.
- **A vacuous pass is worse than a failure**, because it reads as evidence. If a
  check's dependency failed, it is `NOT_RUN`; if it ran against nothing, it is
  `NOT_PROVEN`. Never `PASS`.

### The capability boundary is not negotiable

The WebMCP surface exposes `find_order`, `get_order` and `prepare_resolution`.
It exposes **no tool that commits** — no return request, no approval, no refund,
in any state.

That is the project's central design decision, not an oversight. A PR adding a
mutating WebMCP tool will not be merged. If you think a case needs one, open an
issue and make the argument first.

## Tests

```bash
npm test                                            # unit, offline
APP_URL=<url> node harness/security-tests.js        # commerce security
APP_URL=<url> node harness/auth-security-tests.js   # customer auth
APP_URL=<url> node harness/live-ui-check.js         # live UI
APP_URL=<url> npm run verify:webmcp                 # capability boundary
```

The live suites need a deployment and Chrome. `npm test` needs neither and
should always pass.

## Pull requests

- One concern per PR.
- Match the surrounding style. Comments here explain *why*, not *what* — if a
  line is subtle, say what would go wrong without it.
- Update `.env.example` if you add an environment variable, with which category
  it belongs to.
- Update the relevant `limitations.md` if you change what is or is not proven.
- Say plainly what you verified and what you did not. An honest gap is welcome;
  an overstated claim is not.
