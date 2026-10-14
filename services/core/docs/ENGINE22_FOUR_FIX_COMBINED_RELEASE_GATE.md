# Engine 22 — Coordinated four-fix release gate

**Owner-approved combined scope:** One coordinated review/release covering all four features. This checklist is an engineering acceptance gate, not approval to merge, deploy or replace source counts.

| Feature | Draft evidence | Still required before merge |
|---|---|---|
| Subminute W3 Fib ladder from updated owner nodes | Owner All Nodes W1 7616.25→7847.00; W2 7673.25; research comparison in PR139 | Engine22 source/count/price-basis authorization; prevent old provisional 7575/7859.25/7671.50 ladder from masquerading as current |
| All seven structural degrees, WATCH yellow → verified TOUCHED green | Frontend draft PR62 shared target grid | Validate actual Engine22 published touch statuses and correct source model on each card |
| Persistent touch history | Research-only reducer in PR139 | Durable store and replay/live publication integration keyed by degree/count/model/level/series/basis; reboot/model-revision tests |
| Submicro C candidate around owner-observed ES 7740 | Research-only post-B candidate detector and tests in PR139 | Independent timestamped ES candles, correct Submicro/TradingView basis and structural confirmation criteria; candidate does not equal confirmed C, and Micro W2 cannot auto-complete |

**Cross-engine invariants**

- Seven independently identified trading strategies (SUBMICRO, MICRO, SUBMINUTE, MINUTE, MINOR, INTERMEDIATE, PRIMARY), per owner's latest ruling. Do not alias degrees or share touch memory between models.
- Engine 22 owns wave/Fibonacci/count truth and touch status; Engine 27 interprets and preserves separate strategy thesis/account context; Engine 2B/frontend renders; Engine 11 supports candle identity.
- Neither the research reducer nor the C candidate function is connected to production. Their passing unit tests do **not** certify live market behavior.
- No false green on stale/wrong contract, unknown rollover price basis, provisional model, missing count ID, or price touch before model origin.
- The currently archived owner workbook values and existing production model must remain side-by-side until explicitly reconciled.
- No execution, Journal, Replay, Engine26 zones, Fib geometry, count, or production deployments are authorized by this checklist.

## Exact acceptance sequence

1. Approve Engine 22 source/count/price-basis authority for new Subminute W3 levels; document chosen model version and source provenance.
2. Wire a read-only observation feed and durable level-specific first-touch record into Engine22, with fail-closed source timestamps and bar IDs.
3. Authorize Submicro C structural confirmation rules. Observe 7740 as a candidate until qualified evidence establishes end of C.
4. Expose one versioned Engine22 display payload covering all seven degrees. Keep Engine27 intelligence and frontend as consumers, not touch authorities.
5. Run end-to-end replay (crossing, no crossing, retreat, restart, model revision, out-of-order, duplicate bars, stale prices, seven independent accounts/strategies), then a read-only live parity check.
6. Require Engine22 + Engine27 + Engine2B manager acceptance, rollback plan, and explicit owner approval before the combined merge/deploy.

**Status as of October 14, 2026:** tests on backend draft PR139 HEAD `eb06c0ebe42acb3b03e05861b4e31365bd466fa2` PASS (Engine22 research, Engine27 V2 validation); frontend PR62 remains DRAFT. Operational fix and live completion NOT YET VERIFIED.
