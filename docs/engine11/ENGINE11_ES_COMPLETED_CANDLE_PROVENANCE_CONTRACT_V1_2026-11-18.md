# Engine 11 → Engine 12 / Engine 3: ES Completed-Candle Provenance Contract v1 (DESIGN, NOT AN ATTESTATION)
**Issue:** #344 · **Date:** 2026-11-18 · **Owner:** Engine 11 (source/contract/roll/clock); Engine 12 (storage/readback/receipt); Engine 3 (packet preparation only).
**Release state:** DRAFT DESIGN + SYNTHETIC TESTS. Recording OFF. No source has been newly captured, independently attested or certified by this document. Engine 12 MUST reject source claims until a real Engine 11 evidence generator and independent verification pass.

## 1. What existing code actually proves vs. does NOT prove
Verified current `main`:
- Backend 1 `services/core/routes/futuresOhlc.js`: Massive/Polygon REST `/futures/v1/aggs/{resolvedSymbol}`; query `window_start` in nanoseconds and return normalized **bar opening** `time` seconds, OHLCV. `?debug=1` includes `requestedSymbol`, `resolvedSymbol`, resolver `selectionRule`, `checkedAt`, time frame, period, and bars. `ES` may resolve by explicit env override or cached snapshot's nearest nonexpired settlement, volume as secondary tiebreak. Cache normally 2 minutes. Root ES is **NOT** immutable physical-contract identity. Ordinary normalized candles omit per-bar source metadata. No verified as-of timestamp/finality/entitlement evidence is included in that endpoint.
- Backend 2 `services/streamer/routes/futuresStream.js`: live Massive/Polygon futures websocket trade/aggregate → one-minute and higher candles. Present code admits multiple source timestamp formats and contains a **Date.now() fallback** if trade timestamps are missing. A bar produced through fallback cannot satisfy primary event-clock provenance. It has `rth/eth` bucketing; day and 4-hour session semantics cannot be inferred from a generic UTC floor.
- Existing Engine 11 2020+ chart dataset (frontend `src/pages/rows/RowChart/engine11HistoricalAdapter.js`) explicitly declares `view:UNADJUSTED`, research-only, no execution-price authority. Its dataset/price-basis version identifies a **historical chart series**, not a time-of-original-availability receipt. Existing archived data cannot prove which values were actually known at Engine 3's earlier evaluation instant by re-fetching them now.
- Engine 3 draft `services/core/logic/engine3/v6/buildEngine3RawBarArchivePacket.js` at PR #345 prepares `engine3.v6.rawBarPacket.preparation.v1`, completed 1m/5m/10m arrays, but filters bad/as-of-ineligible items without before/after counts. `recordingActivated:false`. Engine 12 must NOT treat its output as validated contemporaneous source or replace canonical Replay.
- An actual provider entitlement mode (LIVE_ENTITLED/SAMPLE/DELAYED), provider ingest identifiers, first receipt clock uncertainty and monotonic receive times **cannot be inferred from existing normalized OHLC alone**. Unknown must remain `UNKNOWN`; calibration eligibility false.

## 2. Proposed strict envelope and scopes
Schema: `engine11.es.completedCandleProvenance.v1`. An attestation covers ONE fixed evaluation time and exact list of bars, per timeframe. Never reuse a present-day receipt to certify a historical evaluation.

Top-level required fields:
```json
{
  "schema": "engine11.es.completedCandleProvenance.v1",
  "receiptId": "<SHA256 of canonical unsigned evidence envelope>",
  "providerId": "MASSIVE_POLYGON",
  "feedId": "<actual provider account/feed/channel identifier or UNKNOWN>",
  "entitlementMode": "LIVE_ENTITLED|DELAYED|SAMPLE|UNKNOWN",
  "sourceMode": "ORIGINAL_CAPTURE|HISTORICAL_REFETCH|RESEARCH_REPLAY",
  "symbol": "ES",
  "physicalContract": "ESZ6",
  "physicalContractCanonical": "ESZ2026",
  "priceBasis": { "kind": "UNADJUSTED_PHYSICAL", "currency": "USD", "tickSize": 0.25, "adjustmentApplied": false },
  "rollPolicy": { "policyId": "<versioned actual policy>", "resolverRule": "<source>", "resolverCheckedAtMs": 0, "rollEventId": null },
  "timeframeSourceMap": { "1m": "<exact provider/resolution>", "5m": "<exact provider/resolution>", "10m": "<exact provider/resolution>" },
  "barStartSemantics": "UTC_OPEN_INCLUSIVE",
  "barCloseSemantics": "UTC_END_EXCLUSIVE",
  "evaluationTimeMs": 0,
  "clock": { "eventClock": "PROVIDER_UTC", "receiveClock": "UTC_WALL", "clockStatus": "VERIFIED|UNVERIFIED", "maxUncertaintyMs": null },
  "parserVersion": "<immutable build/version>",
  "configVersion": "<immutable config hash>",
  "sourceFingerprint": "<SHA256 of provider identity, subscription/resolver/roll/clock/config>",
  "sourceHealth": { "state": "HEALTHY|DEGRADED|UNVERIFIED|OUTAGE", "reasonCodes": [] },
  "coverage": { "1m": {}, "5m": {}, "10m": {} },
  "bars": { "1m": [], "5m": [], "10m": [] },
  "signatureOrDigest": { "algorithm": "SHA256", "value": "<canonical envelope digest>", "attestor": "ENGINE11", "signatureStatus": "UNVERIFIED|INDEPENDENTLY_VERIFIED" }
}
```
All `<...>` above are schema placeholders, **not real production identities**. Deterministic canonical JSON encoding and signing key management must be versioned and agreed by Engines 11 and 12; a SHA generated by the *caller* proves only byte integrity, not source origin. Until separate protected source capture plus independent verification exists, `signatureStatus=UNVERIFIED`, never claim signed provenance.

Per-bar required: `sourceBarId`, `timeframe`, `startMs`, `endMs`, `open`, `high`, `low`, `close`, `volume`, `sourceContract`, `providerEventId` or explicit unavailable reason, `firstReceivedAtMs`, `availableAtMs`, `completionObservedAtMs`, `finality` (`CONFIRMED|PROVISIONAL|CORRECTED|UNKNOWN`), `sourceRevisionId`, `sourcePayloadDigest`, `clockStatus`, `sourceHealth`. `endMs-startMs` exactly 60,000/300,000/600,000 for 1m/5m/10m. A stable key is `providerId|feedId|physicalContract|timeframe|startMs|sourceRevisionId`; NEVER key solely by ES root or price. Raw source payload bytes or an immutable reference + digest must be independently accessible.

Coverage per timeframe: `requestedCount`, `observedCount`, `rejectedCount`, `acceptedCount`, `firstStartMs`, `lastEndMs`, `expectedIntervalCount`, `gapCount`, `gaps:[{startMs,endMs,reason}]`, `duplicateCount`, `outOfOrderCount`, `lateCount`, `correctionCount`, `sessionCalendarVersion`, `coverageState:COMPLETE|PARTIAL|UNKNOWN`. Document CME Globex maintenance/holiday/early-close periods with a versioned actual exchange calendar. A closed market period isn't assumed to be a data gap, but an unexplained missing interval cannot be silently marked complete. Counts reconcile `observedCount = acceptedCount + rejectedCount` under documented duplicate classification.

## 3. Strict time and as-of policy
- `startMs` is the provider bar **opening** instant in UTC; `endMs` is exclusive expected time boundary, not evidence that the bar was delivered. Engine 3 evaluation timestamp is separate.
- Calendar conversion: `America/Phoenix` UTC−7 all year; `America/Chicago` observes CST/CDT. Record UTC epoch ms as authority, Phoenix/Chicago strings as derived **presentation only**. Do not subtract a hardcoded six hours for Chicago across DST.
- A bar is **as-of eligible** iff `endMs <= evaluationTimeMs`, `firstReceivedAtMs <= availableAtMs <= evaluationTimeMs`, `completionObservedAtMs <= evaluationTimeMs`, `finality=CONFIRMED`, source clock verified within accepted uncertainty, source contract/price basis/roll policy verified, payload digest/receipt integrity independently verified, and source health is acceptable. A completed-looking REST candle refetched later is **not** time-of-original-availability proof.
- For a late arrival: if end=09:31, first received=09:33, evaluation=09:32, REJECT at 09:32 even if bar timestamp is earlier. A revision/correction received 09:40 must **never replace** the 09:32 historical version. Store a NEW `sourceRevisionId`, superseding link and `availableAtMs`; preserve original bytes and as-of visibility.
- Duplicate same identity+digest may be idempotent; same identity with different payload digest is a conflict, NOT an overwrite. Out-of-order arrivals carry event and receive times; enforce chronological ordering **at evaluation** without discarding evidence. Data gaps, clock uncertainty, provider outage, missing entitlement, unresolved roll or mixed contracts => fail closed for calibration.
- No adapter may label incomplete or provisional candles `CONFIRMED` merely because `Date.now()>endMs`. Finality must be evidenced by provider or validated source close/finality policy, with explicit late-correction window and source provenance.

## 4. Contract rollover / pricing
- Each bar binds exact `ES[FGHJKMNQUVXZ][0-9]{1,2}` (e.g. ESZ6); normalized historical `ESZ2026` is an alias, **not a separate price source**. Preserve provider ticker and normalization rule in roll evidence.
- On a roll, new physical contract starts a distinct source series. A source chunk spanning old and new physical contracts is inadmissible unless each bar retains contract and a separately verified roll event identifies effective event/receive times, policy and both providers. Do not silently stitch or back-adjust.
- `UNADJUSTED_PHYSICAL` means exchange-traded raw contract candles, not automatically an unadjusted continuous historical chart. Historic multi-contract `UNADJUSTED_CONTINUOUS` requires separate provenance/lineage. Reject as-of packet if its declared basis conflates the two. Never convert adjusted TradingView B-ADJ ON pivots to source OHLC.
- The Backend-1 active root ES resolver (overrides/snapshot selection) is a presentation/convenience rule and not sufficient rollover provenance by itself; collect resolver decision receipt, candidates/selection rule and timestamp for each contract epoch.

## 5. Source modes and trust
- `ORIGINAL_CAPTURE`: immutable raw upstream event and receipt clock recorded at the time, entitlement verified and provider identity present. Can be considered for independent attestation only after tests.
- `HISTORICAL_REFETCH`: valid for research and chart reconstruction, **not** proof the bar was visible earlier; calibration status `UNVERIFIED`.
- `RESEARCH_REPLAY`: no claim of original provider arrival/finality; calibration status `UNVERIFIED`.
- If feed is SAMPLE/DELAYED/UNKNOWN or provider clock is UNVERIFIED, the archive may preserve bytes for diagnostics with clear labels but Engine 3/12 must mark `calibrationAdmissible=false`. Do not silently substitute Rithmic sample, Ironbeam L2 or chart reference feed for Massive ES candle truth.

## 6. Engine 3 / 12 exact handoff
Engine 3 must extend `engine3.v6.rawBarPacket.preparation.v1` via reviewed schema revision, with `engine11ProvenanceReceiptId`, `engine11ProvenanceDigest`, `engine11ProvenanceSchema`, per-bar `sourceBarId`/revision, and `sourceCountsBeforeFiltering`, `sourceCountsAfterFiltering`, `gapState`, `sourceTimeframeMap`, `evaluationTimeMs`. It must not call filtered-to-zero complete or invent `receivedAt`. Pure preparation, recorder remains OFF.
Engine 12 independently verifies exact source envelope bytes against Engine11 issuer/source trust anchor, digest, per-bar identity and OHLC values, source counts, roll/clock/finality/gap policy, as-of eligibility, Engine26 identity and Engine22 as-of publication; reject entire inadmissible packet with reason code. Only after independent exclusive write+fsync+readback+receipt can Engine 12 return `RECORDED_VERIFIED`. Engine 12 owns `/var/data/replay/engine12-candles/` storage and retention; Engine 11 does NOT mutate canonical `/var/data/replay/es/`.
**Required failure codes** (proposed): `CANDLE_SOURCE_PROVENANCE_UNVERIFIED`, `CANDLE_SOURCE_RECEIPT_DIGEST_MISMATCH`, `CANDLE_SOURCE_CONTRACT_MISMATCH`, `CANDLE_SOURCE_ROLLOVER_UNVERIFIED`, `CANDLE_SOURCE_CLOCK_UNVERIFIED`, `CANDLE_BAR_FUTURE_EVIDENCE`, `CANDLE_BAR_UNAVAILABLE_ASOF`, `CANDLE_BAR_NOT_FINAL`, `CANDLE_SOURCE_GAP_UNDECLARED`, `CANDLE_SOURCE_COVERAGE_INCOMPLETE`, `CANDLE_SOURCE_DUPLICATE_CONFLICT`, `CANDLE_SOURCE_ENTITLEMENT_UNVERIFIED`. Missing reason fields must not turn a reject into success.

## 7. Synthetic fixture matrix (no actual provider source attestation)
Synthetic fixture A: normal original 1m bar 09:30–09:31 UTC, firstReceived 09:31:00.200, completionObserved 09:31:00.250, eval 09:31:01 => eligible ONLY after independently verified source identity/clock and digest.
B: completed 5m 09:30–09:35, evaluation 09:34:59 => reject future bar.
C: 10m 09:30–09:40, received 09:41, evaluation 09:40:30 => reject late arrival.
D: roll ESU6→ESZ6 same clock, new physical contract; without roll event => contract/roll reject.
E: same sourceBarId/sourceRevisionId, changed SHA => duplicate conflict.
F: absent expected 1m 09:32–09:33, session open => gapCount=1, coverage partial, reject calibration; session holiday/maintenance requires versioned calendar evidence.
G: America/Chicago DST transitions March/November vs Phoenix UTC−7 (no Phoenix DST); compare UTC epoch, never local string order.
H: provider/network outage, missing entitlement, source receive clock unknown => fail closed.
I: corrected bar received AFTER evaluation => retain earlier version; later correction not backdated.
J: samples/fake Rithmic data and unrelated Ironbeam L2 events => cannot identify ES candle feed or claim LIVE entitlement.

## 8. Gate and outstanding source evidence (BLOCKING)
This document specifies the **contract**; it is not an Engine11-signed source receipt. Before Engine12 declares trustworthy: implement Engine11 real point-in-time collector/attestor using the ACTUAL feed, independently verify protected source bytes and timestamp clocks, document exact provider feed entitlement, parser/config build, source quality, rollover evidence and source fixtures (normal 1m/5m/10m, roll, late, gap, DST, outage), test with real readback and deterministic hash. Engine12 sandbox fault suite and acceptance must follow. **Record OFF. No new directories/schedulers/deploys.**
