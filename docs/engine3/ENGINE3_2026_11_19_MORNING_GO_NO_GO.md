# Thursday, November 19, 2026 — Engine 3 / Engine 26 Morning Readiness Checklist
**DRAFT release candidate PR #356 · Prepared November 18 · NO implicit deployment approval**

## Decision A — operate the currently deployed v5 dashboard
- **Current live Render service:** `frye-market-backend-1` (`srv-d2ds5nodl3ps73b7i2og`), deployed `main` SHA `694cfb2b73386344ece042abdd4fab46c902eb3b`. Verified via read-only Render service/deployment metadata on November 18. This confirms a deployment record with status **live**, not health-check endpoint success or order-path correctness.
- **The accepted new integrated code IS NOT deployed.** Candidate PR #356 SHA `9153e3470c50201e03374e4a9ff9ffa0f239f546` remains DRAFT/unmerged.
- Check live `/api/health` and current ES snapshot time, data source/contract freshness, latest completed 1m/5m/10m timestamps, Engine26/3/4/6 diagnostic readiness, original Engine12 Replay writer health, and journal/execution status. Record the timestamps, exact response status and blockers; do not infer healthy from a service being `live`.
- Keep existing PAPER/REAL execution controls in their previously authorized state. No newly authorized trading or recording activation follows from release preparation.
- If source, snapshot, Replay, Engine3, Engine4/6, journal or permissions are degraded, fail closed and report the exact failing engine; do not force a trade or promote shadow results.

## Decision B — optionally release new combined preparation code
**This requires separate explicit Manager+owner authorization identifying exact SHA, scope, flags, deployment and rollback. Approval of PR #355 engineering preparation did NOT approve PR #356 merge/deploy.**

Pre-release must have:
1. Manager signoff on PR356 current SHA/diff and accepted canonical-v5 behavior, including the independent Engine10 PAPER lock disposition. Candidate flag `ENGINE3_V5_ENGINE10_PAPER_LOCK_ENABLED=0` preserves the old v5 call shape.
2. No active PR-triggered external provider capture. `ENGINE11_SOURCE_RECEIPT_V3_ENABLED=0`, `ENGINE3_SOURCE_EVIDENCE_SHADOW_ENABLED=0`, `ENGINE12_CANDLE_ARCHIVE_ENABLED=false`. All live trading/automatic PAPER execution flags unchanged from the owner-approved baseline. V6 is read-only shadow, not canonical.
3. Exact-head CI from November 18: combined `44447257566` SUCCESS, E3 Phase1/2/3, E11, E12, E26 all SUCCESS. New offline Engine26 cross-process 5/5 PASS. Broad legacy Engine3 remains 49/179 PASS with 130/179 already failing on clean main; document any introduced delta and independent disposition. Not globally green.
4. **Engine26 runtime persistence remains BLOCKING** before its authorization timestamp may be called durable/live: actual disk is mounted `/var/data/replay`, not default `/var/data/engine26`. Engine12 path signoff is reported complete by owner; exact signoff receipt/conditions should be attached if needed. Proposed override after authorization: `ENGINE26_ENGINE3_AUTHORIZATION_CLOCK_PATH=/var/data/replay/engine26/engine3-authorization-clock.json`. Test live mount containment, permissions, disk headroom, checksum before/after ONE controlled restart and Engine3 source health gating. The test needs explicit permission; no restart or env changes happened in preparing this checklist.
5. Single rollback decision: preserve existing deployment `694cfb2b73386344ece042abdd4fab46c902eb3b` as fallback, snapshot prechange settings, prevent surprise main auto-deploy, and verify source archive/Replay immutable state and canonical v5/E4/E6 parity after deployment. Do not overwrite or silently remove persisted Engine26 continuity evidence during rollback.
6. Real Massive/CME entitled original-source attestation, provider finality, capture-host clock and independent original byte verification still UNVERIFIED. They block any trustworthy raw recording/research calibration and remain separate from an OFF-by-default code release.

## Go / no-go
- **GO (existing v5 baseline only)** if current morning health and original execution permissions are satisfactory. The current live version is unchanged.
- **NO-GO (new PR356 release)** until explicit signed release approval and Engine26 runtime-path/restart plan with acceptable risk disposition. Passing GitHub tests by itself is insufficient.
- **NO-GO (raw recording / Phase4 / v6 canonical promotion)**; require distinct later approvals and real source evidence.

## Future authorized runtime test evidence (not executed)
Capture actual file bytes/SHA, identity `candidateId/zoneId`, `engine3AuthorizationStartedAt`, `sourceAsOf`, health flags and filesystem identity before restart; independent readback immediately after restart before a subsequent write; verify unchanged start, monotonic sourceAsOf, Engine3 rejects any false/missing readiness. Compare canonical Replay hashes and record rollback/stop criteria.

**Owner / Manager decision needed:** choose whether tomorrow morning means **use the existing v5 dashboard** or a separately approved **OFF-by-default shadow code release**. These are materially different operational states.
