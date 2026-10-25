# Engine 27 V3 — Live Price Observer developer handoff
Status: OWNER APPROVED ARCHITECTURE; ISOLATED FEATURE-BRANCH IMPLEMENTATION ONLY. No live service subscription or production job has been created.

## Purpose
Read active ES 10m SSE bar updates from existing Backend-2 /futures/agg?symbol=ES&tf=10m&mode=eth when a future approved runtime consumer supplies events. Interpret provisional Engine22 Micro C-down Fibonacci touches immediately WITHOUT claiming confirmed wave completion, execution, an approved price objective, or a finalized candle.

## Existing producer evidence (GitHub main)
- services/streamer/routes/futuresStream.js GET /agg emits SSE type=bar, symbol=ES, resolvedSymbol=active ES contract, tf=10m, mode=eth, bar={time,open,high,low,close,volume}. bucketStartSecEth uses Unix seconds at bucket start. It emits live updating bars and does NOT promise finality.
- services/core/routes/futuresOhlc.js retrieves ES futures OHLC independently from Polygon/Massive historical aggregates with window_start in nanoseconds and normalizes bars to Unix seconds. It is not yet wired into V3.
- Engine22 current micro owner contract v1 includes provisional Fibonacci levels; the owner confirmed current observed Micro C down. Live current time/contract must match resolved ES contract to prevent rollover contamination.

## Files
- contracts/livePriceObserver.v1.js: contract engine27.v3.livePriceObserver.v1
- livePriceObserver/observeLiveEs.js: pure streaming-event state reducer, no network/file/trading side effects.
- tests/livePriceObserver.test.js: 14 negative/safety checks.
- manager/buildMicroIntelligenceV3.js: optional `livePriceObservation` advisory field; six original module outputs remain unchanged.
- tests/microManagerIntegration.test.js: two new shadow-manager isolation tests.
- .github/workflows/engine27-v3-micro-isolated.yml: runs observer and integrated tests.

## Important evidence semantics
- Live updating 10m OHLC records give immediate provisional price observations and level-touch watches.
- A new 10m bucket permits reporting the PREVIOUS bucket's elapsed time, but NOT certifying its OHLC as canonical final. `elapsedBucket.confirmation = BUCKET_ELAPSED_FINAL_OHLC_UNVERIFIED`. Last completed canonical candle remains null until independently sourced from verified closed OHLC history.
- `confirmedFibObjective`, wave completion, trade permission, order modification, hold/exit recommendation remain unavailable/false.
- Require exact ES root, verified resolved ES contract, timeframe 10m, ETH mode, numeric Unix seconds bar start, chronological event order, valid OHLC and bounded source age.
- Contract rollover resets old observer; no ES-to-MES or price normalization fallback.

## Still outstanding
1. Existing streamer must NOT be modified or deployed for this PR. Create an authorized read-only V3 runner/ingestion interface and demonstrate actual live SSE event replay with source metadata under separate approved runtime plan.
2. Prove real event continuity including disconnect/reconnect/duplicates/out-of-order, updated-last-bar semantics, weekend Globex reopen, and ES contract rollover.
3. Source-select independently verified completed 1m/5m/10m candle evidence; do not infer a final candle from a stream bar rollover.
4. Manager must review combined real-record evidence and accept migration separately. PR stays draft, no merge/deploy/frontend.
