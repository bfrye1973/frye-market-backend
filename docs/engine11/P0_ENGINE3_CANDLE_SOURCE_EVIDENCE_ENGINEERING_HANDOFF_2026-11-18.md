# Engine 11B → Engine 3 / Engine 12: P0 Candle Source Evidence Engineering Handoff
**Date:** 2026-11-18
**Status:** CODE PREPARATION ISOLATED / LIVE ATTESTATION BLOCKED / NO DEPLOY OR RECORDING
**Issue:** #344

## Invariants and protected authority
- Engine 3 and Engine 6 existing trading decisions remain unchanged.
- Engine 12 canonical `/var/data/replay/es` immutable Replay remains unchanged.
- Historical Engine 11 adjusted/unadjusted archives, roll formula and Engine 22 pivots remain unchanged.
- No vendor request, source-body storage, source capture, Render disk mutation, deploy or merger is authorized.
- Prior once-approved capture runner was removed; do not restore a PR-triggered provider fetch.

## Engine 11 code staged (draft PR #347)
HEAD at initial E11 isolated acceptance: `072d01ee553e7240b0c8ac93dd48cbdec7b82335`
- Pinned historical `rawCandles/identity.js` and `sourceObservationsV2/evidence.js` restored unchanged from `45a351f1bd264d807ee7a3fadc92bae5dba6f4dc`.
- New `sourceReceiptV3/captureReceiptV3.js` uses v2 exact-byte row parsing, safely strips the API key, emits response digest/size, exact row digest, normalised OHLCV digest, physical contract and request/first-byte/body-complete timestamps.
- Normal REST request still returns its original bare bar array. Metadata envelope `{bars,engine11Receipt,selectedBarReferences}` requires **both** environment `ENGINE11_SOURCE_RECEIPT_V3_ENABLED=1` and HTTP `evidence=1`. Route does not persist bytes, issue additional Massive requests or change trading logic.
- Source row references are validated against the selected bar's **OHLCV**, timeframe/contract, exact source digest and timestamp. Incomplete pagination and same-start conflicting source rows fail closed.
- `inspectSourceConsumptionTiming` tracks separately pre-fetch evaluation label, receipt completion, consumer receipt and decision completion. It does NOT claim the provider published earlier.
- `buildShadowObservation` checks all 1m/5m/10m frames together, exact contract/time/count and window-closed versus forming labels. It never claims provider finality, historical calibration, Engine3 consumption attestation or recording.
- E11 isolated synthetic CI: https://github.com/bfrye1973/frye-market-backend/actions/runs/44380432371 **SUCCESS**.

## Engine 3 review proposals (neither branch merged)
- **PR #351**: https://github.com/bfrye1973/frye-market-backend/pull/351
  - Corrects forming-count mismatch in `buildEngine3RawBarArchivePacket`, handoff and `auditEngine3RawBarPacketForCalibration`. One forming bar is explicitly not an invalid completed bar; unknown completion, multiple forming, truncation, source conflicts and gaps remain rejected.
  - Phase 1, Phase 2 and Phase 3 workflows **SUCCESS** at SHA `4fe2c4368b76225d80f4fdcbd09bf664dd2d0da5`.
- **PR #353**: https://github.com/bfrye1973/frye-market-backend/pull/353
  - Optional Engine11 receipt transport in `fetchEngine3DiagnosticBars` with unchanged default bar data and a separately captured `consumerReceivedAtMs`.
  - Not yet wired to `buildStrategySnapshot`; its separate CI acceptance has not been verified. Do not claim an end-to-end Engine3 snapshot handoff.

## Engine 12 proposed sandbox guards (not merged)
- **PR #352**: https://github.com/bfrye1973/frye-market-backend/pull/352
  - Conservative whole-mount `statfs` headroom stop at 70%, initial 1 GB archive cap, mode 0700 for archive folders, existing 0600 file write retained, strict completed/forming count invariant.
  - E12 sandbox CI: https://github.com/bfrye1973/frye-market-backend/actions/runs/44381168663 **SUCCESS**.
  - Important: the protected original Engine11 evidence namespace `engine11-source-evidence/` remains distinct from the E12 prepared candle archive `engine12-candles/`. Security/canary signoff is required separately for both.
  - This sandbox test does not independently attest live provider bytes.

## Remaining engineering tasks requiring cross-engine owners
1. Engine3 review/accept proposed #351 count fix and #353 transport; E3 owner wires 1m/5m/10m receipts into **shadow-only** snapshot, explicitly distinguishing evaluation label, data received and actual decision compute time, then proves v5 trading-output parity.
2. Engine11 and Engine3/12 agree on a provenance schema that can honestly represent REST-observed, provisional, policy-settled and later revised candles. Do not fabricate provider event IDs, revision IDs or a provider `CONFIRMED` flag.
3. Engine12 independently verifies source receipts and original bytes after separate owner-authorized protected source capture; runtime provenance cannot promote caller-supplied `verified:true`.
4. Execute true joint offline integration tests: synthetic HTTP response → E11 selected-row receipt → E3 consumed shadow/packet → E12 sandbox independent checks, including forming, gaps, roll mismatch, a provider revision and post-evaluation receipts.
5. Engine11 licensing and account-specific futures entitlement documentation, actual host independent clock uncertainty and provider futures-specific revision/finality truth remain external blockers. The user's Massive AI support response is informative but not a human licensing permission or independently timed original provider attestation.

## Manager decision gate
**Engineering proposals are available, not a complete P0 release.** Manager may review draft code, but should not approve deployment, continuous recording, historical calibration or trading-rule changes yet. Sign off owner-specific PRs and joint offline CI first. Any later protected canary must receive a separate explicit approval and satisfy Engine12's custody, clock, licensing, quota/permissions and fail-closed safety conditions.

**Known unrelated CI warning:** Engine6E cross-engine workflow has shown failures on feature branches; these must be diagnosed separately and must not be silently counted as overall green.
