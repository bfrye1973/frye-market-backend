# Engine 27 V3 — Micro-first, trade-native price observation

Development-only, draft PR #200. No production wiring, orders, sizing, journal writes, frontend changes, merge, or deployment.

## Approved price-evidence direction
**Engine 27 V3's active Micro manager and live observer no longer consume or construct 10-minute bars.** They require a source-qualified individual ES trade-price event (contract, price, size, trade timestamp) and use Engine22's owner Fib ladder without recalculating it.

- `livePriceObserver/observeLiveEs.js`: trade-only observation; rejects aggregate/bar events, stale/future trades, wrong contracts and reordered events.
- `priceActionFib/evaluateTradePriceFib.js`: trade observation vs provisional owner price ladder; touch is never wave completion or trading permission.
- `manager/buildMicroIntelligenceV3.js`: single read-only orchestrator using trade-native price intelligence and five other independent modules.
- `manager/assembleMicroInputs.js`: requires ES/Engine22 snapshot identity; no 10m bar inputs.
- Existing `priceActionFib/evaluatePriceActionFib.js` and `adaptEngine22Micro.js` remain isolated, unreferenced legacy V3 experiment code for test compatibility. They are not imported into the active V3 manager. Do not connect them to live Micro intelligence.

## Live feed limitation
The existing Backend 2 `/stream/futures/agg` SSE publishes aggregated `bar` events, not individual `trade` events. It does internally receive Polygon `T.ESZ6` trades. An approved, strictly read-only, source-qualified **trade event feed** is required for fully automatic continuous observation. The V3 manager currently does not have a deployed live subscription and correctly reports live price unavailable without a qualified trade event.

## Separate modules preserved
27.2 neighboring alignment, 27.3 market context, 27.4 positions, 27.5 entry-thesis memory, and 27.6 historical validation remain isolated. All remain advisory. The Engine29 gate remains Micro/Submicro only.

## Validation
`node --test services/core/logic/engine27/v3/tests/*.test.js` from repo root. Workflow `.github/workflows/engine27-v3-micro-isolated.yml` also tests V2.
No production acceptance until live trade feed and Engine10 identity/provenance verified.
