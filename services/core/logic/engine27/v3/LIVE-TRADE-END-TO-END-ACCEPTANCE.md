# Engine 27 V3 — LIVE-TRADE-END-TO-END-ACCEPTANCE
**Verdict: BLOCKED for production acceptance.** Date: 2026-10-25 UTC. PR #200 draft, no merge/deployment/frontend modifications.

## Delivered implementation
- `services/streamer/routes/engine27V3TradeContract.js`: dedicated normalized Futures WebSocket `T` event: `ev=T, sym=ESZ6, p=price, s=size, t=Unix milliseconds, q=unique per-ticker trade sequence`. Source-specific timestamp *milliseconds* and sequence semantics verified against https://massive.com/docs/websocket/futures/trades; Futures REST has different timestamp semantics and must not be substituted.
- `services/streamer/routes/engine27V3TradeStream.js`: authorized header-token-only internal trade SSE, disabled without `ENGINE27_V3_TRADE_READ_TOKEN`; one Polygon WebSocket per **server instance**, shared across bounded maximum eight SSE consumers, exponential reconnect and disconnect notices; source contract resolver reused. No public browser subscription.
- `services/core/logic/engine27/v3/livePriceObserver/reduceTradeIngestion.js`: bounded 256 sequence IDs; reject duplicate IDs, old timestamps, wrong contracts and stale gaps; reset price continuity on disconnect/reconnect; preserve known IDs for same contract, discard on rollover.
- `services/core/logic/engine27/v3/livePriceObserver/createMicroTradeConsumer.js`: read-only callback binding real trade events to six-module V3 Micro Manager, no journal or order write, bounded cached telemetry.
- `services/core/logic/engine27/v3/livePriceObserver/createTradeIngestionRunner.js`: *explicitly started* one-per-process protected SSE consumer with receive-heartbeat watchdog and reconnect/backoff. No automatic production startup.
- `services/core/logic/engine27/v3/livePriceObserver/parseTradeSse.js`: bounded SSE frame parser.
- New test files: `tradeIngestion.test.js`, `tradeSseParser.test.js`; existing `liveTradeSourceContract.test.js` extended to enforce documented WebSocket ms and q contract. Updated V3 GitHub workflow.

## Producer / receiver field contract
Provider futures WebSocket `T`: `sym` physical ES futures ticker, `p` price, `s` size, `t` epoch **milliseconds**, `q` exchange/provider sequence per symbol. Output: `{ok:true,type:"trade",source:"POLYGON_DIRECT_ES_TRADE",symbol:"ES",resolvedSymbol,price,size,tradeTime,eventId,observedAt,readOnly:true}`. On reconnect, check same contract, existing dedup IDs and chronological watermark, but never assert continuous price crossing through a gap. No 10-minute bars in live intelligence manager.

## Real evidence vs test evidence
Owner observed real Backend2 Polygon websocket via existing SSE diagnostic on 2026-10-25T23:00:52Z; `ESZ6` contract, authenticated, subscribed T.ESZ6, 7 matched source trades, most recent reported price around 7686. User did **not** provide actual individual raw `T` message values (`t,q,p,s`) or a newly deployed internal trade SSE event; cannot label new feed live end-to-end verified.

Manager-approved sources: Engine22 micro owner live C DOWN anchors 7898/7678/B high 7813.25, levels provisional. Trade ticks cannot declare Engine22 completion, a confirmed target, or trading permission.
Engine10 SCHWAB_6380 REAL contract identifiers, original entry-thesis availability, Engine9 durable plan identity remain unverified using actual private journal records. Engine25/Engine29/QQQ/VIX exact live session/freshness acceptance and Engine12/28 real immutable replay remain pending.

## GitHub result
- Isolated V3 workflow SUCCESS after latest integration/fixes: https://github.com/bfrye1973/frye-market-backend/actions/runs/40244644902
- Existing Engine27 V2 compatibility SUCCESS: https://github.com/bfrye1973/frye-market-backend/actions/runs/40244644913
- These are **fixture/contract** successes, not production feed readiness.
- No old Engine22 or Engine27 A–E/V2 functionality changed and no trade permissions added.

## Resource / security limitations
The bounded SSE route shares **one upstream Polygon connection per Render instance**, not necessarily one connection across scaled replicas. Subscriber limit 8 and token auth are intentional; payer/subscriber clients must never access it directly. At subscription scale, a single secured ingestion service and downstream internal fanout will be needed, instead of per-subscriber provider sockets. Current runner is explicit and unstarted; no hosted preview exists.

## Pending approval and evidence
Manager/owner approval is required before deploying a private isolated test environment or exposing any SSE. An approved preview must demonstrate sanitized sequential raw `T` messages, exact documented timestamps and q, normalized SSE events, manager receipt, disconnect/reconnect and rollover with no provider credentials. Then verify actual SCHWAB_6380 Engine10/Engine9 and historic Engine12/28 records, before granting Micro acceptance.

**Final verdict: BLOCKED — safe to continue isolated development, NOT safe for production migration.**
