# Engine 27 V3 — Trade-only Backend 2 source handoff
Status: isolated feature branch, source adapter/route implemented; GitHub V3 tests passed; **NOT LIVE DEPLOYED / NOT PRODUCTION ACCEPTED**.

## User instruction
User explicitly instructed **do not use 10-minute bars for Engine27**. Active V3 Micro Manager consumes individual trade observations only. Legacy Engine22/V2 production contracts untouched.

## Source design
1. `services/streamer/routes/engine27V3TradeContract.js`: normalize direct Polygon futures `T` events to `POLYGON_DIRECT_ES_TRADE`, with ESZ6-style contract validation, positive price/size, explicit timestamp normalization, no wall-clock fallback, rejection of wrong contract/stale/future events.
2. `services/streamer/routes/engine27V3TradeStream.js`: dedicated additive read-only trade-only SSE endpoint; subscribes to `T.{resolvedSymbol}` after provider auth; does not aggregate prices, never outputs provider key and never touches order/broker APIs.
3. `services/streamer/routes/futuresStream.js`: solely exports existing contract resolver; all existing `/stream/futures/agg` behavior remains.
4. `services/streamer/server.js`: registers new isolated endpoint `/stream/futures/trades-v3?symbol=ES` before existing futures router. No existing path moved or removed.
5. `services/core/logic/engine27/v3/tests/liveTradeSourceContract.test.js`: pure source adapter assertions; added to isolated V3 CI.

## Evidence
Actual user-observed Backend2 `/stream/futures/agg?symbol=ES&tf=10m&mode=eth` at 2026-10-25T23:00:52Z: resolver ESZ6, Polygon websocket authenticated, `AM.ESZ6` and `T.ESZ6` subscriptions successful; 7 matched trades; no unmatched trades. Aggregated bar events are NOT accepted by V3 live price observer. New dedicated SSE is not yet live-tested because it is unmerged and undeployed.

## Gate
- V3 CI initial new-source contract suite successful: https://github.com/bfrye1973/frye-market-backend/actions/runs/40243639636
- Existing V2 acceptance had earlier successful run, latest run may still be active at time of writing.
- No production trading, Engine22, or frontend modifications.
- PR #200 remains draft. Deployment, merge and public exposure require Manager plus owner migration approval.
- Remaining: end-to-end actual trade event from new SSE once safely approved for isolated preview; source-auth/reconnect test; Engine10 account 6380 original-thesis live audit; Engine9 official plan joins; canonical replay acceptance.
