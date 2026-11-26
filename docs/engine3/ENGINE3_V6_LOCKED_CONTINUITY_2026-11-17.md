# Engine 3 v6 — Locked Continuity and Manager-Approved Work Order
**Recorded:** 2026-11-17 (Arizona)  
**Owner priority:** P0  
**Authority:** Engine 3 Manager message dated 2026-11-17, “Engine 3 v6 Architecture Accepted for Shadow Development”  
**Development status:** Phase 1 IN PROGRESS, NOT COMPLETE. This document records decisions; it does not authorize merge, deployment, recording activation, or canonical promotion.

## Permanent recovery pointers
- Repository: https://github.com/bfrye1973/frye-market-backend
- **PR #337** (draft Phase 1 stability / Engine 10 lock): https://github.com/bfrye1973/frye-market-backend/pull/337
- **PR #336** (draft Engine 22 Submicro/Micro diagnostic): https://github.com/bfrye1973/frye-market-backend/pull/336
- Branch for this record and Phase 1: `engine3/v6-phase1-shadow-stability-20261117`
- PR #336 branch: `engine3/submicro-micro-structural-diagnostics-20261117`
- Source review: Claude's *Engine 3 v6 — Review & Redesign*, reviewed production commit `694cfb2` and original Engine 12 Replay on 2026-11-17 09:12–10:10 Arizona.

## Why this work exists
The November 17 missed-trade review found directional instability BEFORE mere latency:
- Around **09:27 AZ** Engine 26 switched from zone **7383.5–7416.75** to **7290–7348 (58 pt wide)**; pre-activation 5m bars were scored as if they reacted to the newly named zone. The 1m diagnostic showed FAILED_BREAKOUT / REJECTION_HIGH.
- Around **09:36 AZ**, Engine 3 established **SHORT**, then at **09:42 AZ** dropped to **NEUTRAL** after a single completed 5m CHOP / CONTESTED reading; price later fell toward **7325** without retained SHORT.
- Around **10:01 AZ** Engine 3 established **LONG**, then around **10:07 AZ** **SHORT** again while price spiked approximately **34 points against the SHORT**; releasing to NEUTRAL before re-establishment bypassed the intended opposite-direction reversal guard.
- Other code concerns: 1m evidence computed but not used for canonical fresh control; Engine 10 open PAPER lock inputs exist in v5 but were not passed at production call site; correlated reaction/bias/contact score double counting and quality overlap; 5m completion plus approximately three-minute full-snapshot cadence creates delay.
- These are audit findings / design motivations, NOT proof that any proposed experimental thresholds are optimal.

## NON-NEGOTIABLE AUTHORITY CONTRACT
- **Engine 26** owns WHERE price negotiates, candidate/zone identity, geometry and lifecycle authority.
- **Engine 3** owns WHAT PRICE IS DOING THERE and is the sole publisher of its own canonical LONG/SHORT/NEUTRAL.
- **Engine 4** owns participation; a v6 DEVELOPING state alone cannot count as confirmation.
- **Engine 6** owns final PAPER permission. No Engine 3 v6 shadow output may confer or change permission.
- **Engine 10** remains the sole truth of OPEN PAPER trade lifecycle; Engine 3 may only consume an exact matched open trade's locked direction.
- **Engine 22** owns canonical Elliott Wave structure; its working directions NEVER independently create price-action control, direction, reactionConfirmed, qualification, veto or permission.
- **Engine 3 v5 stays canonical**. v6 remains isolated shadow/read-only until separate management signoff. No merge/deploy authorized.

## MANAGER'S LOCKED DESIGN: Evidence → Conviction → Invalidation
- Preserve valid evidence modules: candle normalization, sequence/wicks, approach/contact/reaction/follow-through, buyer/seller observations, existing completed-10m departure and EMA10 travel.
- Intended v6 lifecycle: `NEUTRAL → DEVELOPING → CONFIRMED → HOLDING/DETERIORATING → INVALIDATED → NEUTRAL`, with independently verified opposite direction only **after** invalidation, not same evaluation.
- **Ordinary CHOP / CONTESTED / ABSORPTION / NO_CONTROL 5m bars must NOT automatically erase established direction.**
- `DETERIORATING` is an annotation on a held direction, not an independent permission or direction transition.
- Prototype anchor invalidation: completed 1m or 5m closes through reaction anchor, or sustained measured deterioration with no renewed progress. Candidate numerical values (2 × 1m closes, 1 × 5m close, 6m deterioration onset, 12m deterioration expiry) are RESEARCH HYPOTHESES ONLY.
- A pure deterministic shadow function must accept all prior state, bars, candidate, zone, and policy as arguments. No hidden reads/writes or execution.
- Reversal must not administratively bypass invalidation; no same-tick invalidation and opposite-direction establishment.
- Original open-trade position direction lock must be preserved according to Engine 10's recorded PAPER lifecycle.

## MANAGER'S EXACT PHASE ORDER — ONLY PHASE 1 IS CURRENTLY AUTHORIZED
**Phase 1 — directional stability (IN PROGRESS):**
1. Wire existing v5 open-trade lock.
2. Build pure v6 shadow state machine.
3. Replace pre-trade release with explicit anchor / invalidation model **in v6 shadow**, without altering v5 canonical pre-trade behavior.
4. Eliminate pre-trade reversal bypass **in v6 shadow**.
5. Add `DETERIORATING` annotation only.
**STOP and return ONE consolidated evidence report to the Engine 3 Manager before Phase 2.**

**Phase 2 — evidence integrity (NOT STARTED):**
6. Add `zoneActivatedAt` for true candidate activation; distinguish earlier market context from causal post-authorization reaction.
7. Prevent pre-activation bars from claiming to react to a new zone.
8. Edge reaction sites for very wide zones; preserve Engine 26 canonical geometry.
9. Forming-bar adverse displacement warning only; forming bars must not create or invalidate direction.

**Phase 3 — research foundation (NOT STARTED):**
10. Prepare bounded, additive immutable raw 1m/5m/10m OHLC archive (with timestamps, E26 candidate/zone, E22 publication as-of, E3 evaluation); coordinate Engine 12/18; **actual recording activation requires separate approval**.
11. Complete per-tick v6 trace / reason codes.
12. Full production-path regression and replay suite.

**Phase 4 — speed (NOT STARTED):**
13. Completed-1m fast confirmation in shadow.
14. Non-tradable BUYER_EVIDENCE_DEVELOPING / SELLER_EVIDENCE_DEVELOPING.
15. 1m evaluation cadence.
16. 5m conflict / slow-path confirmation with mature-opposition nuance, not blanket chop veto.
17. Preserve 10m departure and EMA10 travel.

**Phase 5 — intelligence (NOT STARTED):**
18. Research independent R=Reaction, P=Progress, S=Structure, C=Context evidence; follow-through/progress must be independently proved; no untested deletion of current scores.
19. Integrate Engine 22 diagnostic into v6 trace.
20. Only after out-of-sample calibration, assess whether alignment can modestly modulate fast-path parameters; no current permission to do so.

## Engine 22 Submicro / Micro add-on — tracked separately in PR #336
- **Canonical source:** `strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure`, validated using existing `readAuthorizedWorkingStructure` module. Do not parse legacy text or recompute Elliott Waves.
- Owner working context at review: **Submicro W2 DOWN; Micro C DOWN**. Their presence does not prove live price control or historical as-of availability.
- Draft output fields: submicroWave/submicroDirection, microWave/microDirection, source revision/fingerprint/publishedAt, as-of checks, `structureAvailable`, `alignmentState`, `waveMaturity: UNAVAILABLE`.
- Alignment states: `FULL_BEARISH_ALIGNMENT`, `FULL_BULLISH_ALIGNMENT`, `PARTIAL_ALIGNMENT`, `CONFLICT`, `STRUCTURE_PRESENT_PRICE_ACTION_UNRESOLVED`, `NO_STRUCTURAL_CONTEXT`.
- Critical distinction: valid wave structure plus CONTESTED/ABSORPTION/NO_CONTROL = structure present but price action unresolved; this is not permission.
- Source publication timestamp must be <= actual historical evaluation time; optional max-age freshness policy is research-only.
- Claude reported an earlier 3/3 PR #336 unit test pass; subsequent commits changing missing-vs-unresolved semantics must be independently retested.
- Ask Engine 22 for canonical `waveStartedAt`, `barsSinceWaveStart`, `completionZoneReached` (if supported), and publication as-of/source revision. Engine 3 never invents maturity.
- **PR #336 is NOT merged or deployed and is NOT yet wired into published Engine 3 output.**

## What is actually implemented on draft PR #337
1. `services/core/logic/engine3/v6/resolveEngine10OpenPaperDirection.js` checks the already-read Engine 10 Journal OPEN PAPER trades for exact `symbol=ES`, `strategyId=intraday_scalp@10m`, OPEN and PAPER, with a unique valid LONG/SHORT direction. Missing, invalid or conflicting records do not invent a lock.
2. `services/core/jobs/buildStrategySnapshot.js` has a **review-branch-only** call-site change passing the verified `openTradeActive` and `lockedTradeDirection` into the existing `buildEngine3V5Shadow` builder. It has not reached production.
3. `services/core/logic/engine3/v6/evaluateEngine3V6Phase1.js` is a **pure standalone prototype** with prior-direction hold, explicit anchor close invalidation, deterioration vote/timeout annotations, no same-tick reversal, candidate-change invalidation, explicit research policy input, and open-trade direction preservation.
4. Focused unit tests `engine3V6Phase1Shadow.test.js`, `engine3V6Engine10OpenTradeLock.test.js`, `engine3V6Phase1ProductionWiring.test.js`.
5. `.github/workflows/engine3-v6-phase1-shadow.yml` runs syntax, focused Phase 1 tests, and a broad discovery-based legacy Engine 3 suite.

**Important implementation limitations (do not overstate completion):**
- The prototype v6 reducer has **fresh establishment intentionally disabled** and is **not wired into a published shadow result**. Do not call it an end-to-end running v6.
- Reaction-anchor creation, durable state persistence over successive snapshots, lifecycle identity verification and production-path verification are outstanding.
- Engine 10 adapter's trade-schema mapping needs production-representative validation, including ambiguity and read-failure behavior. No inferred lock should be mistaken for confirmed Engine 10 truth.
- No raw bar archive or Phase 2 changes have been activated.
- No benchmark result from Nov 17 establishes safety of v6 parameters.

## Actual testing as of this record
- GitHub Actions on PR #337 last inspected commit `1077b5e38b36e922bf18a56c177194ad4ccd4e8f`: syntax checks PASS; new focused Phase 1 unit tests PASS.
- Broad legacy Engine 3 test discovery step FAILED: **49 pass / 130 fail** (e.g., `engine3Strategy1Readiness.phase3DC.test.js` expected different readiness reason codes). Need compare to clean baseline and triage before claiming regression readiness.
- See dedicated PR run: https://github.com/bfrye1973/frye-market-backend/actions/runs/44190554393
- Both PRs remain DRAFT and not merged/deployed.

## Phase 1 next-actions checklist (do NOT advance to Phase 2)
1. Verify the Engine 10 adapter against real journal schema and open PAPER lifecycle, including multiple active trades, missing identity/quantity and source-read failure; resolve any unsafe ambiguity.
2. Test the **actual `buildEngine3V5Shadow` production call path** with representative 1m/5m/10m and Engine 10 OPEN PAPER fixtures, including v5 travel/reset contract.
3. Complete deterministic v6 Phase 1 state persistence, anchor initiation, and no-same-tick inversion across successive evaluation ticks; remain shadow-only.
4. Test both LONG and SHORT for HOLD, DETERIORATING, INVALIDATED, opposite side blocked until later confirmation; ensure policy missing/invalid fails safely.
5. Establish clean-`main` baseline for broad legacy Engine 3 failures; triage introduced regressions separately from already-failing tests.
6. Read-only Replay verify Nov 17 original Engine 12 09:27, 09:34, 09:36, 09:42, 10:01, 10:07 AZ where available; don't fabricate historical raw bars.
7. Publish **one consolidated manager report** with test evidence and unresolved blockers; stop pending manager Phase 2 permission.

## Acceptance gates and research measures
Manager requires v5/v6 comparison on original point-in-time data, LONG/SHORT symmetry, no lookahead, no permission/control leakage, no same-tick reversal, and explainable reason codes. Later phases assess latency, churn, false confirmation/reversal, directional vs neutral time, MFE/MAE, move captured, and missed/late signals. Nov 17 is an AUDIT CASE, not a calibration data set. Walk-forward / out-of-sample testing and sustained shadow observation are required before any canonical promotion.

## Recovery instruction for any future Engine 3 teammate, Manager, or Claude
**Read this file first, then PR #337 and PR #336, then the Manager's Nov 17 directive and Claude's source review.** Report actual code/test status from the latest commits; do not treat plans as implemented. Start at the Phase 1 next-actions checklist. Never promote v6 or start Phase 2 without explicit manager decision. No production merge, deploy, raw recording activation, or downstream authority changes are authorized.

## Phase 1 implementation continuation — 2026-11-17 later checkpoint
**Prior sections above are retained as historical status at first lock. This addendum supersedes their earlier "not wired" descriptions.**

- The branch now assembles `engine3V6Shadow` alongside canonical `engine3V5`, not in its downstream handoff. State is saved to a **separate v6 shadow-only file**; neither Engine4 nor Engine6 receives v6 authority.
- The v6 phase-1 pure reducer supports: holding through ordinary chop, timestamp-guarded completed 1m/5m anchor invalidation, diagnostic deterioration with renewed-progress clock reset, candidate changes, no same-tick inversion, out-of-order Replay guard, and verified Engine10 PAPER lock inputs.
- Fresh Phase1 v6 direction is **seeded exclusively from a fresh, quality-validated canonical v5 establishment event**, with a provisional latest completed-5m extreme as anchor. This is only a Phase1 experimental comparison; **Phase2 still must establish `zoneActivatedAt` and a true causal reaction anchor**. Do not mistake the provisional anchor for approved final reaction geometry.
- The Engine10 source adapter requires an exact **single** OPEN PAPER ES Strategy1 Journal trade with valid LONG/SHORT, `tradeId`, and positive `qty.remainingQty`. Missing/ambiguous records and failed list reads cannot invent a lock. Its diagnostic is published separately.
- Added realistic builder-level LONG/SHORT lock tests, adapter tests, per-tick state tests, shadow-store tests and static production handoff tests.
- A clean-`main` GitHub Actions comparison at commit `fc3489438ec2a7a998f59e3fa3cdd41b08f9b45d` confirmed both clean main and this branch had **179 legacy tests, 49 passed, 130 failed**. Therefore those 130 broad-suite failures are pre-existing at that point; they are **not a green legacy suite**.
- All work remains **draft-only** in PR #337. No merge, deploy, recording, new 1m cadence, or v6 canonical promotion.
- Latest post-addendum CI must be checked before claiming comprehensive new Phase1 test clearance. Exact active head/test SHA should be taken from PR #337, not copied from an earlier run.
- Outstanding: verify newest test suite; verify Engine10 persistent journal read-health gap (the existing `listTrades` API returns an empty list for missing stored data, so "no open trade" is not always proof of healthy disk); historical original Engine12 Replay on Render; manager acceptance of provisional-anchor limitations. No Phase2 without manager authorization.

## Manager conditional-review corrections (2026-11-17 later)
**Manager status remains CONDITIONAL pending review; Phase 2 NOT authorized.**
- Manager PR #337 review: https://github.com/bfrye1973/frye-market-backend/pull/337#issuecomment-6963414775
- Corrected dead 1m opposing-reaction vote to canonical v5 `reactionBias: UP/DOWN`. Added tests that execute the actual v5 `evaluateReaction` producer and assert both LONG/SHORT opposite votes.
- Removed deterioration timeout as invalidation cause. `deteriorationResearch.timeoutExceeded` is diagnostic-only; two-sided tests prove LONG/SHORT are held under sustained deterioration unless explicit anchor/candidate invalidation occurs.
- Aligned overlap to v5 formula `intersection / smaller candle range` with explicit formula metadata, not prior `intersection / envelope span`.
- Claude identified a separate Engine10 lock-continuity bug: failed/ambiguous Journal reads formerly set `openTradeActive:false` and could unlock v5. Draft branch now uses a separately persisted, most-recent *verified* Engine10 OPEN PAPER lock for **maximum 10 minutes**, with `blocker:true`, `lifecycleVerified:false`, and no TTL renewal from fallback. An expired cache cannot assert active trade; Engine10 read-health / expired-lock operational semantics require Manager and execution-owner review. A healthy empty OPEN list remains distinct from a failed read; underlying Engine10 store's ability to silently return [] for missing disk is still a blocker for release assurance.
- **Important release distinction:** Engine10-to-v5 `openTradeActive` / `lockedTradeDirection` wiring and fallback change **CANONICAL v5 behavior if merged**, whereas v6 reducer remains shadow-only. Explicit Manager/execution owner approval or separate release/gate required; never describe whole PR #337 as wholly shadow-only.
- Focused GitHub Actions on latest code head `be8b7699668374ae820aaa6857266eef21e84e8b`: **40 tests, 40 pass, 0 fail**; workflow https://github.com/bfrye1973/frye-market-backend/actions/runs/44195972410. Broad legacy suite 179 tests / 49 pass / 130 fail baseline remains unresolved; no general regression health claim.
- **No merge, deploy, Phase 2, canonical v6 promotion, or recording activation.** Request Manager re-review and separate authorization for v5 lock change.
