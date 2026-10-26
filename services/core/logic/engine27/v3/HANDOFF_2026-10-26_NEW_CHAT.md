# ENGINE 27 V3 MICRO — NEW CHAT CONTINUITY HANDOFF
**Updated:** October 26, 2026
**Repository:** bfrye1973/frye-market-backend
**Development branch:** engine27-v3-micro-intelligence
**Draft PR:** https://github.com/bfrye1973/frye-market-backend/pull/200
**Latest confirmed branch commit:** e5b2b22258ca76d9156dcf7393230e49247cc3dc
**CI:** Engine 27 V3 Micro isolated acceptance — SUCCESS at latest branch commit.
**Production merge of whole V3 branch:** NOT AUTHORIZED / NOT DONE.

## Why this exists
The original conversation hit its maximum chat length. This file is the authoritative context handoff for the new ChatGPT conversation under Frye Dashboard 2. Preserve all completed changes and resume with direct GitHub/Render inspection rather than recreating code.

## User's direction
- ES futures is primary; Micro strategy first, then seven Elliott degrees.
- Detect major QQQ and VIX price zones from existing daily source and live Polygon observations.
- Show when ES UP, QQQ UP and VIX DOWN support bullish cross-market context; a bullish context must NEVER be equated with official Engine22 wave reversal or Engine6 trade permission.
- User said fast 20-second UP/DOWN alignment was flipping too much. Use completed 1-minute **early warning** and two consecutive completed 5-minute **source-close comparisons** for confirmation.
- **Preserve actual history durably**, survive Render restarts, never reconstruct fictional past events.
- Keep shadow read-only/no trading; preserve functioning ES trade stream, production original dashboard and engine ownership. Engine5B no longer used (retired from Backend2 on main with user approval).
- User is non-programmer: provide full-file changes when needed, simple instructions. Follow GitHub/Render direct-access preference. Do not expose credentials or archive tokens.

## Architecture already built
1. Engine27 V3 Micro six intelligence modules plus isolated manager in services/core/logic/engine27/v3; protected shadow view at https://engine27-v3-micro-shadow-preview.onrender.com/
2. Individual live ES futures trades on existing V3 SSE (no 10m price substitutes); Engine22 owner Micro C-down and Fib touch safety.
3. Canonical Engine25 and Engine29 read-only consumption; degraded context does not become live trade confirmation. Engine10 account 6380 is read-only actual open position aggregate; no order actions.
4. Existing published QQQ/VIX up to 12 daily OHLC reaction candidate zones per instrument plus direct live T.QQQ Stock trade and V.I:VIX index value. Read-only zone touch/approach/cross observations; no automatic confirmed break/reversal.
5. Shared Polygon market connection architecture now applied to Backend2 main: one process owner for Stocks, one for Indices, bounded authenticated internal SSE relay. Backend2 /stream/agg viewers share one Stocks provider WebSocket. Micro receives internal live QQQ/VIX SSE without its own Polygon Stocks/Indices sockets. Existing ES independent. Verify ongoing connection entitlement and customer redistribution licensing.
6. VIX separate feed connection vs latest index-value freshness; strict 15sec live threshold, last observation labeled LAST only for <=120sec and never considered a live zone signal.
7. New Micro market alignment in `services/core/logic/engine27/v3/marketAlignment/createMicroCrossMarketAlignment.js`: event-driven direct price ingestion; computes **direction from two completed 5-minute buckets** (ES rise + QQQ rise + VIX fall) and two completed 1-minute buckets as early warning. Never use incomplete buckets to flip confirmed 5m state. In `microShadowServer.js` attached to accepted individual ES trade events, direct QQQ and VIX relay ticks; strictly separate official Micro wave direction and E25/E29 qualification; no execution authority. Existing web shadow view shows confirmed 5m, early 1m, wave and evidence checks.
8. Read-only durable alignment event archive `services/core/routes/engine27MicroAlignmentHistory.js`, mounted on **production Backend1 main** as authenticated `/api/v1/engine27/micro-alignment/history`. Append-only NDJSON on existing **100GB Render disk** under `/var/data/replay/engine27/micro-cross-market-alignment.ndjson`. Micro has bounded async writer/reader `services/streamer/shadow/createMicroAlignmentArchiveClient.js`, reads previous history after restart; status explicitly exposes verification. Only records actual post-activation completed 5m evidence; no backfill of unknown historical ES rallies. Secret in Render env, never print/share.
9. V3 test suites cover market alignment, window stability, wave conflict, source gaps, invalid data, zone observation, provider share sockets, archive client handling. Latest isolated CI SUCCESS.

## Render services and latest status confirmed
- Backend1 core, canonical ES snapshot, durable disk: `srv-d2ds5nodl3ps73b7i2og`; LIVE deploy commit `705800dcb907` at 2026-10-26T16:14:05Z. Disk /var/data/replay.
- Backend2 streamer and one-per-asset-class provider owner: `srv-d3ffkhd6ubrc73a55ohg`; owns Stocks and Indices shared SSE endpoints; ES route unchanged.
- Engine27 V3 Micro staging: `srv-dbf98oq9lscs7398u5jg`; LIVE deploy commit `e5b2b22258ca` at 2026-10-26T16:16:54Z.
- Render workspace ID: `tea-d2d7147diees73fu8sog`.

## Critical next verification
1. Check Micro Render logs for sanitized `[engine27-v3-micro-alignment-archive-acceptance]` state: reachable true / DURABLE. Be precise: an archive endpoint responding is not yet proof a real market event persisted.
2. Verify real eligible completed 5m ES/QQQ/VIX evidence accumulates and creates actual history rows. Note sparse VIX index events may leave completed buckets without observations; correctly show UNAVAILABLE, never interpolate or fake candles. Validate 5m trend sensibly vs end-user expectations.
3. Check after restart that actual archived rows are retrievable from Backend1 disk. Confirm duplicate 5m window dedup and no event loss on transient failures; consider preserving pending queue across restarts or adding retries if needed.
4. Verify snapshot and owner E25/29 evidence is not silently conflated with market environment. Engine22 Micro still DOWN unless official owner transitions.
5. Do not automatically authorize trades, push alerts or update other six strategies. Discuss external Pushover notifications only after live alignment timing and archive acceptance.

## Important cautions
- Do not assume the 5m confirmation design has been accepted by user until observed live. It compares last observed qualified source-price values in neighboring completed 5-minute time buckets; it is **not** a standard OHLC candle aggregate and may have data gaps, especially direct VIX index feed.
- Never claim historical events are already archived until checking actual disk-read results.
- The original screen's Engine29 often reads DEGRADED—NOT QUALIFIED; this must remain an independent qualification.
- Only isolated staging Micro is deployed; whole V3 draft PR #200 remains unmerged.
