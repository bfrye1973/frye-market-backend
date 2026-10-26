# Shared Polygon Stocks + Indices connection ownership

**State:** Read-only operational audit completed, migration design only.
**Branch:** engine27-v3-micro-intelligence (draft PR #200).
**Scope:** Polygon Stocks and Indices WebSockets. **ES futures feed stays as-is.** No trading, Journal, Engine22/25/29 changes.

## Direct Render audit — October 26, 2026

Active production Backend2 `srv-d3ffkhd6ubrc73a55ohg` runs `node services/streamer/server.js`. Its startup unconditionally calls `startEngine5B()`, and `services/streamer/engine5b/runner.js` opens a Stocks socket `wss://socket.polygon.io/stocks` and subscribes to `T.SPY`. Backend2 Render logs show repeated `[engine5b] WS closed; reconnecting in 2.5s` / `WS open, subscribed T.SPY` during the owner audit.

The same active Backend2 exposes `GET /stream/agg` through `services/streamer/routes/stream.js`. **Every SSE /stream/agg request creates a new Stocks WebSocket**, subscribes to `AM.<symbol>,T.<symbol>`, and closes it on request close. This can multiply the number of Stocks sockets for multiple dashboard viewers.

`services/streamer/polygonPump.js` is another Stocks WebSocket implementation (SPY/QQQ minute aggregates), but is NOT imported from the audited Backend2 startup; do not assume it runs. Other stock socket implementations (`routes/stream.js`, `polygon/ws.js`) exist, but their active runtime status remains unproven. Active Backend3 runs `node server.js`, Backend1 `node services/core/server.js`. Only audited active process logs and startup entrypoints justify running-connection claims.

Isolated Micro preview `srv-dbf98oq9lscs7398u5jg` currently opens one independent Stocks socket for `T.QQQ` and one Indices socket for `V.I:VIX`. Its observed Polygon `SUBSCRIPTION_LIMIT` signals are consistent with connection competition but do **not** prove the precise connection count, entitlement, or the origin of competing connections.

## Required long-term design

1. Designate **Backend2 shared streaming service** as the authoritative *Stocks connection owner*, subject to provider permission. One mutually exclusive socket per process, multiplex `T.SPY`, `T.QQQ`, and `AM.<symbol>` for existing permitted symbols onto that one connection; add subscriptions only when needed.
2. Preserve Engine5B behavior by delivering its existing `T.SPY` event shape to Engine5B's callback. Preserve existing `/stream/agg` client semantics by feeding each client's own aggregation state from the same shared event stream rather than making its own WebSocket.
3. Make the shared Stocks owner expose a **server-to-server authenticated, read-only, bounded SSE stream** of *only* `T.QQQ` observations for Engine27 Micro (not API keys, not raw provider permissions). Apply max clients, backpressure, gap signals, health/freshness and strict per-symbol identity. Do not put bearer tokens in URL/browser/local storage/logs.
4. Independently designate **one Indices connection owner** for the direct `V.I:VIX` value source (not a tradable stock or VIX trade). Where best to host this owner must be determined by real Indices consumers and confirmed provider entitlement; no duplicate VIX sockets.
5. Micro consumes internal QQQ/VIX streams and continues using its existing pure bounded tick/zone-observer modules. **Only cut over once the shared feeds qualify live with correct symbol, timestamps and price**, while current dedicated Preview sockets are disabled in the same controlled switch. Never run both sets indefinitely.
6. Keep **ES futures trade SSE** unchanged. Never substitute hourly or 10-minute bars for direct live prices. Keep existing QQQ/VIX completed-hourly reaction confirmation separate and continue respecting Engine25/29 and Engine6 authority.
7. Subscription and redistribution permissions: prior to subscriber/commercial use, confirm permitted internal forwarding and external distribution with Polygon/Massive. Internal architecture does not itself establish licensing.
8. Disconnect/reconnect: backoff on provider `max_connections`, bounded subscribers, disconnect/clock-gap means `UNAVAILABLE` (no cached-price masquerading), clear event continuity. Do not obtain extra API keys/accounts to evade vendor limits.
9. Protect other production users; no live Engine5B, /stream/agg or Render start/deploy changes without owner acceptance and tested rollback.

## Rollout

**A. Completed:** read-only Github startup and Render logs audit. Findings above.

**B. Isolated engineering (next):** pure shared event-dispatch core + unit tests (subscriber fanout, symbols, gap handling, duplicate events, drop/backpressure, single owner) and adapter tests for unchanged Engine5B and /stream/agg semantics. No provider socket during tests.

**C. Shadow acceptance:** verify new owner with one actual Stocks and one Indices connection if allowed, confirm QQQ/VIX direct updates and ES unchanged. For phase C, coordinate a one-at-a-time cutover to avoid exceeding plan limits; use feature flags and rollback.

**D. Production cutover (requires explicit change approval):** one consolidated Stocks stream on Backend2, hand over Engine5B and /stream/agg consumers, then move Micro's QQQ listener. Indices owner/relay separately. Require before/after logs proving no lost ES/SPY service and no Polygon max-connection conflicts.

## Explicit stop conditions

- Provider permission/plan unknown; no silent commercial redistribution.
- Any Engine5B or dashboard /stream/agg behavior fails baseline tests.
- QQQ or VIX latest source observation stale, dropped or not entitled.
- Duplicate owner instance, unknown symbol, gaps/reconnect or unbounded backlog.
- Failed parity against current SPY trading logic or client stream.
- No proof of rollback to prior isolated behavior.

No live Polygon subscription, production process, schedule, journal or trading permission was changed by this audit.
