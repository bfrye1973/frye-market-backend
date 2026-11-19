# Engine3/11/12/26 Combined OFF-by-default Release Candidate
**2026-11-18 — DRAFT ENGINEERING INTEGRATION, NOT AN AUTHORIZED RELEASE**

This **single main-parent code candidate** composes exact accepted owner work for testing together, not for merge/deploy. Main parent `694cfb2b73386344ece042abdd4fab46c902eb3b`.

## Pinned component heads
- Engine3 PR #355 HEAD `0ca585384e8ac91e3bad9c9513d390a5e338b2c7`, containing the Phase1 #337, Phase2 #340, Phase3 #345 stack, forming-count correction and OFF-by-default source receipt shadow.
- Engine11 PR #347 HEAD `174e134fedc69c4956b49b2f358f42bf721fcb31` (synthetic/metadata-only, real source NOT attested).
- Engine12 sandbox PR #349 HEAD `ba8ed6c99e9feaf3ed7c975cc95d794f4efb200f` with guard fixes from stacked #352 `b49d7edf63c39abd1ccb524e78ffd8525e6b5fd5`.
- Engine26 PR #346 HEAD `9cf80a89c21ec1d9161b1107c2e5ab85f3465516` (runtime storage path remains UNVERIFIED).
- Synthetic PR #354 was **NOT merged or copied as a runtime implementation**; only its standalone offline integration test `engine11P0ThreeEngineIntegration.test.js` is included for independent validation.

## Safety separation: canonical v5 Engine10 lock
Upstream Phase1 PR #337 wired Engine10 PAPER lock into the canonical Engine3 v5 builder. The Manager did not authorize this behavior change with the v6 shadow acceptance. **Candidate explicitly gates those two canonical-v5 arguments under `ENGINE3_V5_ENGINE10_PAPER_LOCK_ENABLED === "1"`. Default is OFF**, preserving the main production caller's original argument shape. The separate v6 shadow may inspect verified Engine10 PAPER lock as read-only research context. Before production, Manager must separately approve/exclude this optional canonical-v5 behavior; do not enable by default.

## Required OFF defaults
`ENGINE3_V5_ENGINE10_PAPER_LOCK_ENABLED=0`, `ENGINE11_SOURCE_RECEIPT_V3_ENABLED=0`, `ENGINE3_SOURCE_EVIDENCE_SHADOW_ENABLED=0`, `ENGINE12_CANDLE_ARCHIVE_ENABLED=false`. No new provider capture, source collection, scheduler, Phase4 cadence, raw-recording or live futures execution enabled. Canonical Engine3 v5 remains sole price-action direction.

## Release blockers
1. Final same-commit combined CI and canonical v5/E4/E6 parity. Legacy 49/179 vs 130 failures remain pre-existing but repository not globally green; compare failures to base and independently review any delta.
2. Engine26 default `/var/data/engine26` **outside confirmed Render mount `/var/data/replay`**. Propose manager-approved durable path override (e.g. separate approved namespace within existing persistent mount) and actual restart/readback smoke test only after separate operational permission. Do NOT change Render configuration or write production now.
3. Engine10 v5 PAPER lock separate release decision; OFF unless separately authorized.
4. E11 Massive/CME specific license and entitlement; verified original capture host clock and futures finality/correction/availability; protected raw source evidence and independent Engine12 original-byte attestation.
5. Engine12 private source-custody conditionally approved `/var/data/replay/engine11-source-evidence`: <=1GB approved canary ceiling, stop whole disk >=70%, 0700/0600, no overwrite, SHA/readback, quota/backpressure, backup/encryption disposition and explicit independent read-only verifier.
6. Exact final release SHA, rollback and health checks + explicit Manager and owner merge/deploy permission.
7. New bounded provider canary has its **own later owner approval**. Permanent recorder a separate approval. V6 promotion and Phase4 unauthorized.

## Acceptance definition
Passing offline tests means **code integration candidate reviewable**, not production-ready, source attested, recorder authorized, or manager-approved merge. Candidate has one parent on current clean main and does not modify the individual review PRs.
