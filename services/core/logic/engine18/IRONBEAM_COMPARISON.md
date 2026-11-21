# Engine 18 — Ironbeam v2/v3 vs Rithmic comparative acceptance plan

Owner-approved goal: test the Ironbeam REST/WebSocket API and the separate Rithmic feed, then keep the source that produces the most useful, reliable ES liquidity evidence at acceptable total cost.

## Important facts from the owner-supplied Ironbeam documentation
- Ironbeam **v2**: demo and live are currently available according to representative.
- Ironbeam **v3**: demo available, live coming soon according to representative.
- Ironbeam v3 REST endpoints: `POST /v3/auth/login`, `GET /market/depth`, `GET /market/trades`, `GET /market/quotes` (server base URL includes `/v3`).
- Ironbeam v3 depth: aggregate market-by-price levels with price, size, orderCount, and implied quantity; not verified order-by-order MBO messages.
- Ironbeam v3 trades: exchange prints, sendTime in epoch milliseconds, optional aggressorSide.
- v3 depth, trade and quote API can return **delayed data even when requests succeed**; entitlement and market freshness must be separately attested.
- Ironbeam's `/stream` documents live depth and trades but detailed streaming subscription protocol must be obtained/verified before implementation.
- Rithmic R|Protocol/R|API+ is a separate vendor integration; neither the Ironbeam v3 OpenAPI document nor an aggregate-depth API proves Rithmic MBO entitlements.

## Provider scorecard — same ES contract, same session window
1. Data tier: live vs delayed (vendor entitlement and external clock).
2. Depth fidelity: aggregate MBP levels vs individual order ID/action MBO, side, timestamp, depth coverage, implied size.
3. Trades: price, contracts, aggressor side if sourced, sequence, duplicate and gap rates.
4. Latency and uptime: exchange-to-receiver age, staleness, disconnect/recovery, dropped packets.
5. Research value: rank previously declared high/low targets, detect sweeps, classify reversal vs continuation with no look-ahead; evaluate ablation against Engine 11 candle-only baseline.
6. Pricing: API fee, exchange fee, platform/broker fee, one-month minimum, historical replay/retention rights.
7. Integration effort: runtime dependencies and supported hosting on Render.

## Gating / safety
- No vendor credentials in repo, logs, screenshots or chat. Reissue credentials exposed in a previous message.
- Only use authenticated **read-only** market-data actions. Absolutely no order/risk/account writes.
- No new LIVE chart overlays until contractual entitlements, server use, and as-of proof are validated.
- A snapshot cannot be labeled real-time merely because HTTP status is 200.
- Market-by-price REST snapshot order-count cannot be interpreted as individual order additions/cancellations.
- Local test harness uses mock packets; production ingestion not started.
- Never use example futures symbols/quotes from documentation as actual current prices.
- Do not auto-switch production brokerage or change Schwab configurations.

## Current development status
- `ironbeamV3ReadOnly.js`: fixed-host, read-only REST login/depth/trades/quotes, strict ES contract, normalized events, delayed-status unverified.
- `rithmicFeedContract.js`: Rithmic normalized event schema and fail-closed MBO readiness gate, waiting for approved transport and packet docs.
- Next: secure demo credentials in the isolated Engine 18 Render service; inspect v2 docs for live-compatible structure; obtain Rithmic packet definitions and API instructions; test one session with both using the same contract.
