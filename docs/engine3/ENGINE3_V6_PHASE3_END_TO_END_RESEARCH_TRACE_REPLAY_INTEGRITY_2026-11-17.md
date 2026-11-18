# ENGINE 3 v6 — PHASE 3 END-TO-END RESEARCH-TRACE / REPLAY-INTEGRITY AUDIT
**Review date:** 2026-11-17 Arizona  
**Status:** PREPARATION VERIFIED; END-TO-END RECORDING INTEGRITY NOT ACCEPTED  
**Authority:** Engine 3 Manager Phase 2 acceptance and Phase 3 preparation-only gate, PR #340  
**Evidence sources:** current main source for Engine26, Engine12 Replay/retention, Engine18 continuity and recorder architecture; stacked Phase3 PR #345 at the exact code/test head below.

## Executive decision
**NO RECORDING AUTHORIZATION, NO CALIBRATION ADMISSIBILITY CERTIFICATION, NO PHASE 4 AUTHORIZATION.** Existing architecture is coherent; remaining gaps are source ownership/contract fulfillment and actual operational integration testing. No additional strategy redesign is justified.

The current Phase3 branch has a pure read-only audit that is intentionally unwilling to infer recorder safety from a packet builder's checksum or synthetic fixture success.

## Verified GitHub code/test revision
- Phase3 repository: `bfrye1973/frye-market-backend`, stacked draft PR #345 based on accepted-but-unmerged Phase2 PR #340.
- Latest verified CI on audit branch revision: `7232d0cab93f391295b0c0fc349f29b24de4e10c`.
- Workflow: https://github.com/bfrye1973/frye-market-backend/actions/runs/44221461655
- Syntax **PASS**; Phase3 preparation and provenance-admissibility checks **17/17 PASS**; accepted Phase2 regression **39/39 PASS**; Phase1 compatibility **36/36 PASS**; **92/92 in these focused suites**.
- Historical main legacy 130/179 failures were separately reported previously. These focused counts are not a clean repo-wide test verdict.
- Phase3 `auditEngine3RawBarPacketForCalibration.js` and tests introduce no storage writes, trade outcomes, or recording activation.

## Gate 1 — Source-of-truth ownership (BLOCKED)
**Engine26:** The source owns `(candidateId,zoneId)`, exact zone geometry, authorization lifecycle and proposed `engine3AuthorizationStartedAt`. On inspected `main` source, `services/core/logic/engine26/buildEngine26LocationCandidate.js` contains `candidateLifecycleStartTime` but **not the required `engine3AuthorizationStartedAt`**. The former derives from direction/contact continuity and must not substitute for the latter. GitHub issue https://github.com/bfrye1973/frye-market-backend/issues/341 remains **OPEN**, no implementation/signoff in that issue at audit time. Future Engine26 source acceptance must test uninterrupted run identity, terminal/ineligible interruption, restart persistence, as-of non-backdating, source agreement and exact timestamp contract.

**Engine12:** Current `services/core/jobs/archiveEsReplaySnapshot.js` owns canonical ES snapshot Replay writing, NOT the future raw-candle archival writer.

**Engine18:** The currently documented recorder design is for a separate **Ironbeam/vendor depth feed**, with a dedicated worker/disk and clock provenance. It must not be relabeled as the completed 1m/5m/10m OHLC owner without explicit agreement. Engine18 continuity warns the live backend's existing persistent disk is already shared by other engines; do not place new Engine18 data there without authorization.

**Owner assignment still missing:** GitHub issue https://github.com/bfrye1973/frye-market-backend/issues/344 remains **OPEN**, with no recorded Engine12/18 signoff or named raw-candle writer/storage owner. Recommended proposal for review: Engine12 owns immutable ES candle archive **storage/integrity**, Engine11 owns candle-source/roll provenance, and Engine18 owns only its separate licensed L2 vendor recorder; actual assignment requires Manager/engine-owner confirmation.

**Engine3:** Consumes verified source/time and builds shadow reasoning/trace only; never substitutes source-of-truth ownership.

## Gate 2 — Replay provenance (BLOCKED)
Existing `buildEngine3RawBarArchivePacket.js` prepares a bounded deterministic packet with completed candle start/end times, evaluation as-of, Engine26 candidate/zone and activation, Engine22 publication as-of filtering, SHA256 and dedupe key. **This is in-memory preparation, not proof any packet was durably captured at its claimed historical time.**

Still absent from source-attested persisted evidence: approved feed/provider and feed ID; physical ES contract/roll and adjusted/unadjusted price basis; bar-generation/completion and clock method; coverage/gap declaration; immutable writer identity/version; independent readback checksum and dedupe verification; and durable source attestation linking the packet to the evaluation instant. A checksum calculated on a synthetic or current payload does **not** prove that those bytes existed when a historical snapshot was made.

New Phase3 audit rejects missing source attestation, gaps/roll coverage proof, missing Engine26 identity, observed-only activation for authoritative historical calibration, mismatched/future timestamps, empty timeframes, bad OHLC, invalid/duplicate bars, unverified storage receipts and independent readback failures. These are **preparation tests**, not successful verification of a real archive.

## Gate 3 — Historical integrity (EXISTING REPLAY PROTECTED; NEW ARCHIVE UNPROVEN)
Verified in `archiveEsReplaySnapshot.js`: ES Replay snapshots are written to `/replay/es/YYYY-MM-DD/HHMM.json`; duplicate final files are protected by exclusive temp creation and an atomic hard-link claim, preserving existing snapshot files against overwrite. Engine12 Replay projection intentionally strips large normalized/candle evidence trees and reports `replayRawMarketDataOmitted`.

Consequences:
1. Existing Replay is historical snapshot evidence and MUST stay byte-unaltered.
2. Original Replay does **not** contain enough full raw candles to rerun novel Engine3 v6 historical price-action decisions; no invented Nov17 trades or calibration claims are acceptable.
3. A future raw archive must be a **separate immutable namespace and manifest**, not a rewritten or retroactively enriched Engine12 snapshot.
4. Engine12 has separate retention logic (default deletion disabled; optional aged replay retention exists); agreeing on raw archive retention and deletion governance is still required. Immutable means "no historical rewrite" and does not automatically guarantee indefinite retention.

No new raw archive writer or data collection was enabled by Phase3.

## Gate 4 — Failure/restart/disk-full/backpressure (BLOCKED)
| Failure | Verified existing behavior | New raw-candle archive verdict |
|---|---|---|
| Duplicate final replay file | Engine12 final-file exclusive hard-link claim protects existing file | New archive writer/dedupe unimplemented |
| Missing source candles / sparse bars | Archive packet filters completed as-of bars; Phase3 audit refuses empty timeframe/coverage without attestation | No live writer stop/alert semantics tested |
| Corrupt packet/readback | Phase3 audit checks SHA against claimed independent receipt and rejects mismatches | No durable writer recovery or independent readback yet |
| Restart/interrupted write | Engine12 writer uses exclusive temp and final hard-link claim | New writer crash/restart recovery unimplemented |
| Disk full/ENOSPC | No demonstrated real archive ENOSPC/recovery tests | BLOCKED — must alert, stop, preserve old files, not falsely mark success |
| Backpressure/data gaps | No new candle-writer queue/drop accounting | BLOCKED — must fail visibly and never silently skip bars |
| Source-clock failure / futures-roll ambiguity | Research audit requires explicit source attestation/clock and roll reconciliation | BLOCKED pending actual provider evidence |

The existing Engine12 `storageHealth.js` explicitly documents best-effort health state, not a hard operational stop for future raw collection. Do not extrapolate protection from it to the unimplemented writer.

**Required tests before activation:** isolated sandbox with atomic O_EXCL or no-overwrite final claims, temp cleanup, interruption at each write stage, duplicated evaluation, corrupt manifest/readback, failed source, DST/clock skew, disk quota/ENOSPC, queue overflow/backpressure, process restart and reconciliation. Each failure must have an observable reason code, no false "recorded" status, and preservation of existing replay. Real storage smoke tests must use a designated sandbox, never canonical Replay paths.

## Gate 5 — Preparation versus activation (DESIGN PASS; OPERATIONAL SWITCH UNPROVEN)
**Verified:** `buildEngine3RawBarArchivePacket` returns `recordingActivated:false`, does not write files, and is not scheduled/used as a recorder in Phase3 assembly. Phase3 `auditEngine3RawBarPacketForCalibration` is pure read-only. The separate Engine18 architecture also calls for isolated worker/disk rather than piggybacking on the production Replay disk.

**Not verified:** existence or test of the future recorder's explicit off-by-default environment controls, independent authorization record, actual scheduler/worker OFF state, kill switch, backup/retention controls and post-activation metrics. Those cannot be confirmed until the writer is implemented under the designated owner. A prepared packet does **not** constitute authorization to collect.

**Release rule:** merging preparation-only code (if ever separately approved) must not start a recorder. The future writer and operational `OFF→ON` decision must require a separate explicit Manager/owner signoff with command/change record, storage owner approval, license/clock verification, recovery tests and reversible stop control.

## Cross-engine signoff required to close this report
1. **Engine26 owner:** implement issue #341; return code SHA, CI tests and restart/re-authorization as-of proofs.
2. **Engine12/18 + Engine11 for candle provenance:** resolve issue #344 with named accountable raw-candle writer and storage lifecycle owners, separate mount/namespace, source/roll/clock contract, manifests, retention quotas and licensing review. Engine18's depth recorder is a different feed and must stay separate unless explicitly approved.
3. **Storage/writer team:** implement sandbox-only fault injection and independently verified durable readback, gap accounting, checksum/dedupe and NO-OVERWRITE tests. Do not run a production recorder.
4. **Engine3 Manager:** verify independent per-tick shadow trace and source-readiness diagnostics, agree calibration admissibility criteria, then hold a **separate recording activation gate**. No Phase4/canonical promotion at this point.

## Live Render verification limitation
A direct Render service read was attempted. The connector responded that **no workspace was selected** and requires explicit workspace confirmation before workspace-specific inspection. No Render service, free disk bytes, runtime environment or current recorder process state was verified in this audit. GitHub historical Render infrastructure notes are reference material and not proof of the present live runtime. No Render mutations were made.

## Manager decision recommendation
**Phase3 preparation: focused tests PASS; architecture on track.**
**End-to-end raw-bar replay integrity: NOT YET ACCEPTED.**
**Recorder activation: NOT AUTHORIZED.**
**Phase4 fast path: NOT AUTHORIZED.**
**Engine3 v5: canonical; Engine3 v6: draft shadow.**
**No new Engine3 strategy redesign is needed.**
