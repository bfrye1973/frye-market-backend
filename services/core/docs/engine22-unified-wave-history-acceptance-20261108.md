# Engine 22 unified permanent history — isolated acceptance increment
**Date:** 2026-11-08  
**Status:** DEVELOPMENT ONLY; not approved for merge or production.

## Single-system decision
Use the PR #240 / #241 hash-linked seven-degree publication journal, authenticated paging API, and workbook export as the integration foundation. Incorporate PR #255's per-wave event validation and replay contracts *as an additional validation layer in that same future system*, never a second database or second authority.

This branch is based on `engine22g-wave-history-chart-combined-acceptance` (PR #241's integration work), and adds:
- `waveHistoryV1.js` and its tests from PR #255
- `waveHistoryNodeViewV1.js`: a read-only adapter from journal observations to seven degree metadata with strict `plotAllowed:false` until immutable node IDs, price basis and market timestamp are fully verified
- regression tests and a focused integration workflow

**Important:** The two event formats are not yet combined into one durable node ledger. PR #240 stores *whole publication observations*, not permanently identified individual nodes; the PR #255 schema validates *per-node events*. The wrapper above intentionally does **not** invent node IDs to disguise that gap.

## Open technical requirements before merge
1. Model approved node transitions with permanent immutable node/wave/count IDs, degree/parent IDs, approval references, explicit source ES contract and unadjusted price-basis fingerprints, UTC market event time, published-at time, and supersedes lineage.
2. Decide how owner-supplied historical spreadsheet nodes enter the ledger without backdating the publication timestamp. Research models require separate statuses from canonical selection.
3. Integrate the node-level event validator with the journal's append/hash/replay operations as **one atomic writer**, not a parallel file or API.
4. Resolve the PR #241 branch against current backend main, including the subsequently updated Nov 5–8 research cards and owner selection revision 6. Do not revert or promote existing selected models.
5. Validate journal recovery on the authorized isolated `/var/data/replay/engine22-wave-history` folder; Engine 12 replay contents must not be touched.
6. Verify authenticated server-side Engine 2 consumer, zero browser-exposed bearer tokens, price/timestamp safety, cross-degree relationships, and nonregression for all Engine 11 candles.
7. Separate Engine 22 permanent journal from **Google Sheets synchronization**; only an approved publication should update the canonical current view. Research and archive rows remain preserved.
8. Proposed `WAVE_MODEL_UPDATED` notifications are not present in production; start with versioned revision polling/catch-up and only later add notification transport.

## Acceptance boundary
No changes to strategy selections, trading, live engines, chart rendering, Render environment, or production deployment in this increment. Existing #239/#240/#241 remain separate until consolidated technical acceptance. PR #255 remains a development prototype; cherry-picking it does not authorize promotion.

## Owner's long-term rule
Engine 22 owns waves; permanent journal remembers them; Google Sheets organizes approved and research history; Engine 2 displays only verified chart-safe anchors and automatically catches up on revisions.

## Isolated process-restart proof — November 8, 2026

Render service `srv-d2ds5nodl3ps73b7i2og` was inspected **read-only** using connected Render: deploy branch `main`, auto-deploy enabled, one instance, and a 100 GB disk mounted at `/var/data/replay`. Owner-authorized Engine 22 proposed subfolder remains `/var/data/replay/engine22-wave-history` and must not touch Engine 12 replay records. The configuration establishes disk presence in the service settings; it is **not** an in-container mount verification, writable directory proof, or actual Render restart/redeploy.

Added `engine22JournalProcessRestartV1.test.js` to the isolated branch and unified CI. It creates a temporary isolated history directory, writes a hash-linked observation + node event, starts separate brand-new Node.js processes to read it, retry idempotently, append a status revision, and page both revisions. Also checks that a corrupted original file blocks a subsequent process append without overwriting bytes.

GitHub CI at head `bcaa01119325e96cab5e1afebe95b2c313573fa5`:
- Engine22 unified wave history contract checks: **PASS**
- Engine22 Wave History Journal V1: **PASS**
- Engine22 Combined Chart History Acceptance: **PASS**

**Remaining production-level gate:** run a separately authorized isolated persistent-mount test on Render with verified `/proc/self/mountinfo`, directory ownership/permissions, restart or redeploy followed by hash-chain replay, and single-writer assurance. Do **not** restart the live main service or set runtime flags until manager technical acceptance and owner release approval. The current draft PR remains stacked on #241, not rebased onto current production `main`. Notifications, permanent real-node reconciliation, authenticated Engine 2 visualization, and Google Sheets auto-sync are not yet live.

## Engine 2 read-only node revision feed — isolated Nov 8 acceptance

- `GET /api/engine22/wave-history/nodes?afterRevision=0&limit=50`
  returns `engine22.chartNodeHistoryPage.v1`, ordered by the original immutable publication revision; includes zero or more node status/record events per publication and always advances the cursor even if no node was recorded.
- `GET /api/engine22/wave-history/nodes/current`
  returns `engine22.chartNodeCurrent.v1`, one latest known revision per immutable `nodeId` and `latestRevision`.
- Both inherit the existing route's mandatory server-side bearer-token and verified persistent-mount checks. **No credentials may appear in the public Engine 2 browser bundle.**
- The feed preserves research/approval status, supersession references, source/model identity, original market timestamp and publication timestamp, ES contract/price-basis metadata, and parent wave ID. **Every node is `plotAllowed:false`**, even if marked approved, until Engine 11 as-of chart basis acceptance is independently proven.
- The feed does not invent node events from old observation-only journals, because those events were never recorded historically. Empty node records must be shown as missing history, not inferred.
- CI suites passed at commit `1188113d3ddaaae9143954a34d4fcbb77b726e4e`: unified feed + history tests, Wave History Journal V1, and combined Chart History Acceptance.

**Still required before any real Engine 2 rollout:** owner-approved node ingestion and historical approval evidence, correct chart as-of semantics, real production mount/redeploy proof, server-side authorization, current-main reconciliation and dedicated client reconnect tests. No Google Sheets connector or notifications were deployed; this is an isolated API implementation only.

## Owner Google Sheets source import preview — November 8, 2026

The connected Google Sheets workbook `1oLsBV4Hbzg-6jApd2k960XU_CTxmCQwAxFcot4yQKJc` was inspected directly, including Primary, Intermediate, Minor Original Archive, Minor W1-W2 Proposed, Minute ABC Proposed, Subminute ABC Proposed, Micro W1-W2 Proposed, Submicro ABC Proposed.

An isolated 32-record **source snapshot** is committed at `history/fixtures/ownerSheetAnchorsNov8V1.json`. Each record keeps its original workbook ID, tab/sheet ID, actual row reference, degree, label, raw Arizona local date/time, raw ES price and owner-evidence text. This is a bounded reference fixture, **not an automatically connected production spreadsheet reader**, and it must be revalidated against the live workbook before any import/promotion.

`previewOwnerSheetAnchorsV1.js` creates a safe read-only reconciliation feed without assigning a permanent `nodeId`, `countId`, publication timestamp, verified market timestamp, or Engine 11 price-basis ID. Every record remains `plotAllowed:false`.

Unresolved source facts deliberately preserved:
- Minor proposed W2 candidate 7325 has **unknown exact Arizona time** and is approximate.
- Minute A high August 14 07:00 versus Minor W1 high August 14 03:00 is a **source timestamp mismatch**, not silently fixed.
- Micro research W1 high 7469.75 has **UNKNOWN date in its current worksheet**, despite a separately reported November 6 observation; do not overwrite source provenance.
- Subminute C, Micro W2 and Submicro C ending coordinates remain unconfirmed/unknown.
- Owner source rows tagged historical unchanged do not independently provide Engine 22 owner-approval record or proof of price-basis compatibility; archive and proposed rows must not become current selections.

CI branch head `303e046c0480bec336c8849a599ee398b0bf09ec`: unified history contract + owner-sheet import preview **PASS**, Wave History Journal **PASS**, Combined Chart History Acceptance **PASS**.

**Remaining acceptance:** reconcile source row evidence against current engine models and real Engine 11 unadjusted contract data, assign actual permanent IDs from an approved publication (no retroactive approval), persist those events to single authoritative journal, authenticate Engine 2 consumer and implement optional Sheets synchronization. The new fixture is not a source of live trading decisions.
