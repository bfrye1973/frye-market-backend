# Frye Dashboard 2 / Redline Trading — rules for every session

Automated ES trading research platform (backend: this repo; frontend: bfrye1973/Frye-Dashboard).

## Start / end of every session
- **Start:** read `docs/engines/README.md`, the file for the engine you are working on, and the last entries of `docs/HANDOFF_LOG.md`.
- **End:** append a short entry to `docs/HANDOFF_LOG.md` (what was done, PRs, what's next, what waits on the owner).
- Long chats get compacted. Decisions that matter go in these docs, not only in chat. "Lock this in" from the owner = write it into the engine file.

## Roles
- **Owner (Brian):** final authority. Approves every live-market action, merge to LIVE, and every new cost.
- **Claude:** lead engineer — design, code, tests, bounded live runs the owner approved.
- **Engine 18D (GPT):** independent auditor. Where an audit is required, nothing merges/deploys until 18D re-audits the exact SHA.
- **Claude Engine 8 teammate:** programs Engine 8 (PAPER execution): issue #425 and the Engine 8 trading files (`engine8CanonicalPaperAdapter.js`, `engine8DuplicateState.js`, `engine8PaperAcceptanceEligibility.js`, `engine8PaperExecutor.js`, `runEngine8Paper*.js`). Reviewed by the ChatGPT Engine 8 Manager. Start with `docs/engines/ENGINE8.md`.
- **Claude Engine 28:** owns the #412 verification package (PRs #417/#419/#422/#420/#423) and the Engine 28 plan. Reviewed by the ChatGPT Engine 8 / Engine 28 Managers.
- **Shared file:** `jobs/autoExecuteCanonicalPaperTrade.js`. Agree on #425 who edits it before anyone does. One owner per file.
- Owner prefers **concise, plain-language answers**.

## Guardrails (never break)
- Engines are **independent and confirmation-only**. They never tell the owner to buy or sell. No order plant, no order routing, no trading authority.
- **No credentials, usernames, API keys or secrets on GitHub** (code, docs, PRs, logs). Secrets live only in protected Render env vars.
- **No raw licensed market data in the repo.** Tests use synthetic fixtures.
- **Rithmic:** after every run set `RITHMIC_PAPER_CONNECT_ENABLED=NO` and `RITHMIC_PAPER_HISTORY_ENABLED=NO`. R Trader Pro must be closed for API sessions (market-data session limit is 1). Read-only plants only.
- **No LIVE chart change** before the owner approves a preview.
- **Owner zones are read-only** (`services/core/data/es-smz-manual-zones.txt` and related). Never move, create or edit them.
- **No new paid infrastructure** without owner OK.
- **PR #400 (Rithmic DBO book):** no merge/deploy/network activation until Engine 18D re-audit.
- No lookahead in research; evidence counts are descriptive, not probabilities, until validated.

## Workflow
1. Branch from the right base (engine branches are named `engineNN-topic-YYYYMMDD`).
2. Open a PR. CI must pass.
3. Audit where required (Engine 18 Rithmic work → Engine 18D).
4. Owner OK before anything touches LIVE or costs money.
- GitHub GraphQL is blocked from Claude sessions: use REST (`gh api repos/bfrye1973/<repo>/pulls ...`) to open/merge PRs.
- Commits/PR bodies end with the attribution lines the session provides.

## Where things are
- Engine index: `docs/engines/README.md`
- Engine 18: `docs/engines/ENGINE18.md` (older Gate 1 research docs: `docs/engine18/`)
- Session log: `docs/HANDOFF_LOG.md`
