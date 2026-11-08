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
