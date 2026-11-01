# Engine 22 → Engine 2 automatic wave history contract

This is an isolated development prototype. It does not change approved counts, Fibonacci formulas, trade permissions or broker behavior.

**Capture trigger:** Every successful ES `intraday_scalp@10m` strategy snapshot build examines the current `engine22WaveStrategy.authorizedWorkingStructure`. A changed seven-degree model, Fib touch evidence, approval selection or invalidation is appended as a new immutable revision; identical snapshots are deduplicated.

**Durability requirement:** Set `ENGINE22_WAVE_HISTORY_DURABLE_DIR` to an actual persistent mounted volume, with exactly one journal writer. If unset, the journal is unavailable and does not claim persistence. Do not use ephemeral Render filesystem. An HA/multi-writer production rollout needs PostgreSQL or a distributed lock, not this single-writer file prototype.

**Existing snapshot transport to Engine 2:**
`strategies["intraday_scalp@10m"].engine22WaveHistory`
contains `available`, `latestRevision`, `contentHash`, `latestObservation` (the full seven-degree selected models), and `historicalAsOfSupported:false`. Engine 2 should use `latestObservation` only for read-only presentation. The older Engine 22G `chartAnchors` contract is a separate draft PR #239 and is not included in this branch.

**History storage:** `wave-history.v1.jsonl` append-only with hash-linked event records, revision numbers, source model versions, owner selection reference, original source models, source timestamps, model/evidence fingerprints, official invalidation metadata and independent Submicro/Subminute data.

**Safety:** Never interpret an observed change as new owner approval. Missing or conflicting authority yields unavailable. Journal failure is visible but cannot create trading permissions. Historical publication times are not retroactively inferred.

**Release gates:** Review tests, verify persistence/restart/deduplication on an isolated persistent volume, coordinate with Engine 2D on consumer display and query endpoint for full historical revisions, then obtain separate owner approval for merge/deploy. No production change authorized.

## Automatic Excel history book — V1 implementation

When a changed ES Strategy card is recorded successfully, `exportWaveHistoryWorkbookV1.js` regenerates `Frye_Elliott_Wave_History.xlsx` in the same durable directory. It does not overwrite the append-only journal. If the workbook is missing, the next snapshot also regenerates it from the verified journal.

The workbook contains **Current Anchors**, **Complete History**, **Change Journal**, **Change Details**, **Fibonacci History**, and seven separate degree tabs (12 total). The Change Details tab retains before/after values and exact source field paths. Rows preserve available pivot times, owner approval references, model versions and source publication timestamps. Unknown values remain blank. Header filters and frozen rows support reading history.

## Secure Engine 2D access (development only)

The core API mounts:
- `GET /api/engine22/wave-history?afterRevision=0&limit=50` — authenticated paginated JSON (limit 1–100)
- `GET /api/engine22/wave-history/workbook` — authenticated XLSX download

Both require `Authorization: Bearer <ENGINE22_WAVE_HISTORY_READ_TOKEN>`, a secret of at least 32 characters configured on the backend. Never embed that token in a public browser bundle. Engine 2D's server-side integration should fetch the protected resource and apply its own subscriber/owner authorization before exposing any download.

`ENGINE22_WAVE_HISTORY_DURABLE_DIR` must point to a separately authorized persistent storage mount, **not Engine 12's protected replay disk**. The history endpoint fails closed when storage or authentication is unavailable.

## Outstanding operational acceptance

The first live journal event is explicitly `INITIAL_OBSERVATION_NOT_HISTORICAL_RECONSTRUCTION`. It does not claim the system was recording earlier publications. Earlier owner-supplied anchor tables remain historical source documents, not reconstructed historical predictions.

A real isolated persistent-volume restart/redeploy test, authenticated runtime snapshot test, Engine 2D consumer test, and owner-authorized production rollout remain outstanding. The journal's current file writer is single-instance only; never enable multiple writers without a database/coordination migration. PR #239 is separate and modifies the Engine 22 wave wrapper, while PR #240 captures the final strategy snapshot in the job. Integrate both branches and retest before merge.
