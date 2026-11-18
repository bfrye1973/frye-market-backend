# Engine 3 v6 — Phase 3 Research-Foundation Preparation
**2026-11-17 | Manager-approved preparation only | All PRs draft and unmerged**

## Status and boundaries
Engine 3 v6 Phase 2 is **accepted in shadow**, at PR #340 commit `06afd4f0846a5fc84a646d8d954aa0ed18d462ef` with 39/39 Phase2 and 36/36 Phase1 compatibility checks. This is not release authorization. Phase1 PR #337 still includes a separate canonical-v5 Engine10 lock behavior change requiring execution-owner signoff.

**No merge, no deployment, no archive recording, no Phase4 1m fast path/cadence, no Engine22/Engine4/Engine6 authority changes.**

## Current Phase3 preparation artifacts
- `buildEngine3V6ResearchTrace.js`: bounded reason-coded state, activation provenance, selected Engine3 control lens, exact Engine26 source zone, 1m/5m counts, adverse/anchor warnings, diagnostic deterioration, limited Engine22 alignment metadata, v5/v6 comparison; no private state or execution.
- `inspectEngine26AuthorizationContract.js`: validates future `engine3AuthorizationStartedAt` as-of, identity, source agreement, continuous authorization run; reports missing/invalid authority; never uses `candidateLifecycleStartTime` or invents historical times.
- `runEngine3V6ResearchFixture.js`: pure production-shaped Phase2 evaluator, no IO, receives only supplied OHLC and prior state. Does not claim original immutable historical Replay reconstruction.
- Snapshot assembly attaches trace and readiness **after** v6 shadow evaluation and separately from downstream trade qualification.
- Phase2 `buildEngine3RawBarArchivePacket.js` remains an in-memory bounded/checksummed *preparation* object. Its `recordingActivated` field remains false. No writer is called or scheduled by Engine3.

## Raw bar archive design and cross-engine interface
Coordination issue: https://github.com/bfrye1973/frye-market-backend/issues/344 (Engine12/18 ownership).
Engine26 authoritative timestamp: https://github.com/bfrye1973/frye-market-backend/issues/341.

**Preserve Engine12's original** `/var/data/replay/es/YYYY-MM-DD/HHMM.json` records, no overwrite/reformat. Existing `archiveEsReplaySnapshot.js` intentionally compacts `normalized`, `candleFacts`, `zoneRelation` and records `ENGINE3_CAUSAL_EVIDENCE_NO_RAW_BAR_HISTORY` because original snapshot rows are large. Never claim existing Replay can restore raw bars from those derived records.

Proposed separate immutable artifact (subject to Engine12/18 review):
`schemaVersion, ES instrument/source price basis, complete bar-start and bar-close UTC timestamps, evaluationTimeMs, candidateId, zoneId, Engine26-authorized/observed activation provenance, frozen Engine3 site geometry, exact unchanged Engine26 zone, Engine22 canonical publication timestamp/revision/fingerprint if available as-of, completed 1m/5m/10m OHLC, data-source lineage, deterministic SHA256, unique session + evaluation ID, byte/retention budget, failure reason codes`.

Acceptance before requesting activation: no future or forming bars; no historical re-run presented as original; no double-recording with Engine12 or vendor Engine18; dedicated immutable namespace agreed by owner; hash/dedupe/recovery/atomic-create strategy; enforce fail-closed on missing disk/clock/source; bounds/backpressure; operational guard default OFF with explicit owner approval; test on sandbox-only temporary fixtures; separate release checkpoint.

## Pre-registered A/B/C research: NOT YET RUN
Policy A: hold to anchor or candidate invalidation only (main shadow). Policies B (deterioration timeout) and C (timeout + independent opposing progress) may produce *wouldInvalidateAt* annotations only and cannot alter Policy A direction.

Out-of-sample acceptance gates locked before results:
- Minimum **N=50** held-direction episodes
- At least **20% reduction** in median give-back against A
- No more than **+5 percentage points** false-invalidation-rate increase
- Direction change churn per hour must **not increase**
- November 17 is regression/audit only, excluded from tuning

All those require legitimate raw or newly preserved historical evidence and a separate research phase. Do not report performance improvement from synthetic harness fixtures.

## Phase3 readiness and remaining blockers
1. Review complete Phase3 trace semantics, bounded volume, and replay compaction behavior with Engine12.
2. Engine26 issue #341 must be fulfilled before replacing shadow-observed authorization with authoritative source time. Preserve original observation time to avoid lookahead when the field appears later.
3. Engine12/18 signoff of writer ownership, immutable format, retention, timestamp accuracy, and operational activation checklist (issue #344).
4. Manager must separately approve any canonical-v5 Engine10 lock merge/deploy, and address the inherited legacy suite failures.
5. Manager must approve next research or Phase4 development; this Phase3 branch is preparation only.

## Recovery protocol
Read this file, accepted PR #340 decision, Engine26 issue #341, Engine12/18 issue #344, and stacked Phase1 PR #337. Verify latest CI run by SHA before claiming readiness. Never merge/deploy or start raw recording as part of this preparation.
