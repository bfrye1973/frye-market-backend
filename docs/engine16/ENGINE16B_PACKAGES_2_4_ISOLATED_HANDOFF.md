# Engine 16B — isolated development packages 2–4 (November 9, 2026)

**Scope:** Backend research only, no Engine 11/22/2 changes, no routes, streams, data writes, permissions, trading, merge, or production deployment.

## Package 2: chronological Engine 11 replay

Read-only input contract for the actual `GET /api/v1/futures/ohlc` route in `services/core/routes/futuresOhlc.js`:
- Normal bars are returned as arrays with `time` in **UNIX seconds**, `open/high/low/close/volume`.
- Debug mode includes requested symbol, `resolvedSymbol`, timeframe, and source bars. The route currently lists 1m,5m,10m,15m,30m,1h,4h,1d; **20m is not in the source route TF_MAP**.
- The route's bar `time` is start time, not the candle-closed or first-known timestamp.
- It does not return a verified per-bar historical `knownAt` or a full physical-contract/roll-adjustment manifest.
- Engine 16 requires explicit ES contract and price basis rather than guessing from ES root symbol.

`replayAndChartContracts.js` adapts the route's shape in one of two explicit modes:
- `SIMULATED_CLOSE_CLOCKS`: uses bar start plus specified timeframe duration as a **simulation**. Does **not** represent actual first-known times. No historical availability or performance claim.
- `ATTESTED_CLOCKS`: consumes caller-supplied per-bar knownAt, requires knownAt at/after candle close. Caller attestation and a computed file checksum **do not independently prove provenance**; `historicallyVerified` stays false pending authenticated Engine 11 archive contract.

Run synthetic replay with the committed Node tests. For an authorized local dataset, use offline CLI (no network):
```
node services/core/qa/runEngine16AbcReplay.mjs /path/to/authorized-es-replay.json
```
Input JSON shape (example placeholders only, NOT authentic bars):
```json
{
  "schema":"engine16.engine11OfflineReplayFixture.v1",
  "symbol":"ES",
  "contract":"ESZ26",
  "priceBasis":"ES_PHYSICAL_UNADJUSTED",
  "timeframe":"10m",
  "mode":"SIMULATED_CLOSE_CLOCKS",
  "bars":[{"time":1794182400,"open":100,"high":105,"low":99,"close":103,"volume":1}]
}
```
Switch `mode` to `ATTESTED_CLOCKS` and add `attestedKnownAt` aligned with bars only if the authorized source actually supplies them. Do not place private datasets or secrets in public GitHub.

## Package 3: Engine 22 read-only context

Verified current real contracts:
- `services/core/logic/engine22/history/chartNodeHistoryFeedV1.js` yields `engine22.chartNodeCurrent.v1`: `records[].nodeId,waveId,degree,parentWaveId,modelVersion,marketAtUtc,publishedAtUtc,esPrice,contractSymbol,priceBasisId,approvalStatus,lifecycle,sourceRevision`.
- `engine22.waveHistoryEvent.v1` from `waveHistoryJournalV1.js` has an observed selection with source model and seven degree entries, but `historicalAsOfSupported:false`.
- Both history and current node feeds declare `historicalAsOfSupported:false`. Do not treat them as arbitrary old as-of views.
- The private Engine22 history route requires authorization and verified persistent mount. No token or private service access is introduced here.

`inspectEngine22CurrentNodes` may use OWNER_APPROVED matching physical-contract/basis node **from a caller-attested capture time forward**, with context explicitly labeled `CURRENT_CONTEXT_ONLY`. It excludes unapproved and mismatched references. `computeAbcMilestone1` can accept its immutable read-only result through `engine22ResearchContext` to attach Micro degree node IDs to the W3 *alternative only*. This does NOT confirm the local ABC or prove shared physical low equality. For earlier cutoffs, Engine22 context remains `UNKNOWN`.

## Package 4: Engine 2 display data contracts (not integrated)

`engine16.chartResearchPack.v1` packs versioned scenario ID, state, 0/A/B anchors with observation and knownAt times, C extreme/C? proposal, Fibonacci raw/tick targets and lineage, structural invalidation UNKNOWN, engine22 read-only refs and no-execution flags.

`buildEngine16ChartHistoryPack` returns a prior snapshot with only evidence events known no later than the requested cutoff. All payloads explicitly set `plotAuthorized:false`. Engine 2 must preserve its existing Engine 22 permanent nodes and decide overlay toggles/visual rendering in a separate integration.

Inspector row scope remains exactly **1m, 5m, 10m, 20m, 30m, 1h**. This is an allowed UI scope, **not** a claim that 20m Engine 11 OHLC or a strategy evaluator exists. No fabricated per-timeframe strategy signals.

## Remaining technical gates
1. Obtain authenticated Engine 11 candle data, authoritative physical-contract/roll basis and genuine available/received timestamps before claiming historical as-of replay validated.
2. Engine 22 historical-as-of approved node service remains unavailable under present source contracts; do not backdate current node captures.
3. C? wick/reversal thresholds are configurable *research policy only*, not approved orthodox 5-3-5/3-3-5 confirmation.
4. No full subwave grammar, historical storage, live route/SSE, frontend integration, production performance budget, Engine 6/27/8 access or execution changes.
5. Current prefix replay is research-scale re-computation, not optimized for large live archives.

## Verification
CI workflow `.github/workflows/engine16b-abc-milestone1.yml` runs the existing prototype, Milestone 1 and replay/contract tests. Only actual GitHub Actions runs count as tested. This document is not independent historical data validation.
