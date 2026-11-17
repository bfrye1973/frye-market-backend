# Engine 3 v6 Phase 2 — Locked Evidence Integrity and Research Contract
**2026-11-17 | Approved: shadow development only | No merge / deploy / recording activation.**

Manager decision is recorded in PR #337, linked by draft Phase 2 PR #340.
Phase 2 PR is stacked on unmerged Phase 1 branch, not on main. Do not interpret this as canonical v5 approval.

## Authority
Engine 26 owns candidate/zone, exact geometry, authorization lifecycle and the requested new `engine3AuthorizationStartedAt`. Engine 3 must not infer authoritative start from `candidateLifecycleStartTime`. Until Engine26 publishes the new field, first observed eligible `(candidateId,zoneId)` may be used in **v6 shadow only**, with explicit uncertainty and zero directional authority for earlier/grace bars. Any eligibility interruption resets the continuous run.

Phase 2 pure evidence observer:
- completed bars closing **after** authoritative/observed activation may be causal reaction evidence;
- older bars remain pre-activation/background; two completed 5m bars are required before any slow-path shadow seed;
- activation-run ATR5m uses only completed history available as of activation; frozen zone edge geometry is preserved unchanged until authorization run resets, even if ATR changes;
- wide zone and band parameters (2 ATR5m, 0.25 ATR5m half-band, 1-point floor) are *research defaults only*;
- UPPER SHORT: highest eligible post-activation engaged 1m high; LOWER LONG: mirrored lowest eligible 1m low;
- no trailing reaction anchor; no hindsight re-dating after a later source publication;
- forming bar adverse displacement is a warning only: cannot change direction, conviction, permission or validity;
- Engine22 diagnostic only, no threshold modulation or veto;
- v5 canonical retains its separate authority; Phase4 fast path/cadence explicitly prohibited.

## Research A/B/C pre-registration (before outcomes)
- **A:** anchor/candidate invalidation only; main v6 shadow policy.
- **B:** sustained deterioration wouldInvalidateAt (research output only).
- **C:** deterioration plus independently confirmed opposing price progress wouldInvalidateAt (research only).
- Minimum **N = 50** out-of-sample held-direction episodes.
- Compared to A, candidate must reduce median give-back by **at least X = 20%**.
- False-invalidation rate may increase by **at most Y = 5 percentage points**.
- Direction changes/hour (churn) must **not increase**.
- November 17 remains a regression/audit case; it is excluded from tuning.
- B/C cannot change A's authoritative shadow direction in Phase 2.

## Raw-bar archive — PREPARATION ONLY
Proposed bounded artifact per evaluation/session:
`schema, recordedAt, evaluationTimeMs, symbol, strategyId, candidateId, zoneId, source authorizationStartedAt/observed uncertainty, immutable Engine26 zone, Engine22 authorizedWorkingStructure with publishedAt/revision/fingerprint, completed1m/5m/10m OHLC and start/end times, origin/provenance, checksum, dedupe key, expected retention/disk quota.`
Guardrails: no overwriting canonical Engine12 Replay; no duplicate recorder; coordinate Engine12/Engine18 storage ownership; atomic immutable writes, integrity hashes, max size, backpressure and explicit failure reporting; never read future bars; no journal writes. **The archive is not activated by PR #340.** Operations approval required separately.

## Phase 2 acceptance evidence
LONG/SHORT symmetry; activation reset/continuity; source timestamp vs fallback; uncertainty bars cannot establish; pre-activation filtering; strict completed bars; minimum two postactivation 5m bars; valid locked ATR geometry; narrow/wide zones; upper/lower anchors; frozen anchor; warning invariance; v5/Engine4/Engine6 isolation; no merge/deploy.

Open dependency: Engine26 owner to implement and test the authoritative `engine3AuthorizationStartedAt` continuity contract. See PR #340 change request. Separate canonical v5/Engine10 lock release decision and legacy tests remain tracked in PR #337.

## Phase 2 Manager + Claude conditional review corrections (2026-11-17)
**Still awaits Manager acceptance; no merge, deploy, recording or Phase3/4 start.**

Corrections on stacked draft PR #340:
- **Causal evidence is now consumed**, not merely filtered: `buildEngine3V6CausalControl` runs the existing v5 1m/5m evidence and buyer/seller-control modules on strictly post-activation completed bars. The v6 reducer receives this independently recomputed control; old v5 canonical control never supplies a Phase2 initial direction. Phase2 also scopes v6 deterioration and anchor invalidation bar evidence post-activation.
- **Deferred seed:** once genuine mature post-activation 5m control qualifies and a true reaction anchor is available, the v6 shadow may establish even if v5's one-shot `establishedNow` happened earlier. This is the existing 5m slow path, NOT a new 1m fast path.
- **Actual engagement:** wide-zone upper/lower site follows the actual post-activation band engaged, not presumed LONG/SHORT mapping. Ambiguous both-edge candle contact does not seed; narrow zones retain the exact whole-zone site. The original Engine26 zone object is preserved.
- **Directional anchor lifecycle:** anchor and reaction site are frozen for an established direction and cleared when invalidated; an opposite direction cannot inherit the previous direction's anchor/site. Post-activation 1m extremes are preferred, with eligible completed-5m extreme fallback where 1m engagement is unavailable; no retrospective prior bars.
- **Separate warning annotations:** `adverseWarning` triggers on adverse forming-bar movement >=0.75 activation ATR5m from forming open or >=1 ATR5m from progress extreme; `anchorThreatened` triggers at/within 0.25 ATR5m of the fixed reaction anchor. Both remain strictly diagnostic, with no direction, conviction, Engine4, Engine6, invalidation, reversal or execution authority.
- **Regression evidence:** code head `86318d19c2be3acd70be7f18b6c1b7c5e1b7bce5` passed Phase2 focused **28/28** plus Phase1 compatibility **36/36**, including syntax checks (Actions run https://github.com/bfrye1973/frye-market-backend/actions/runs/44200752083).
- Nov17-shaped tests are synthetic causal fixtures, **not exact original raw-bar re-simulation**; original immutable Replay lacks raw history. No claimed empirical trade improvement or A/B/C research result.
- Engine26-owned authorization timestamp remains separate issue #341 and raw archive remains **in-memory packet preparation only**, not wired to production recording.
