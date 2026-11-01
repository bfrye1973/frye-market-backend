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
