# Engine 18 — Liquidity Intelligence Engine (LOCKED FOUNDATION)

Owner authorization: November 9, 2026. Engine number: **18**. Engine 17 is unchanged.

## Purpose
Rank candidate ES liquidity destinations above and below current price; detect candidate liquidity raids (sweeps), then assess evidence for reversal versus continuation. Observe market microstructure instead of attributing intent to specific institutions or algorithms.

## Boundaries
- Research/alerts only. No order placement, position sizing, execution, broker API calls, or permissions.
- Do not change Engine 11 history/candle loading, Engine 22 owner-approved strategy-card waves, Engine 16 ABC/FVG calculations, Engine 17 overlays, or Engine 2 chart.
- Existing chart integration later must be read-only, behind a feature flag, with its own endpoint and UI switch.
- Source, provenance, timestamp (UTC and derived America/Phoenix presentation), exact instrument/contract/roll, price basis, revisions, staleness and missingness must be explicit.
- Inferred structural liquidity, visible resting order book, executed prints, and modeled gamma are four different evidence types. Never label inferred stops as observed.
- Predictions must be generated as-of the available market event time; no lookahead, repainting, fabricated confidence numbers, or replacement of owner-approved nodes.

## First milestone
`services/core/logic/engine18/liquidityBaseline.js` is pure, deterministic and OHLCV-only, for ES only. It builds window-high/low and equal-high/low candidate levels, and identifies wick sweeps versus close-through candidates. It intentionally does NOT claim validated target-ranking, order-book absorption, options gamma or predicted profitability.

## Data trial gates
1. Test existing Massive/Polygon entitlements without exposing API keys.
2. Obtain vendor-written server-side/non-display and exchange classification for Databento CME MBO/MBP/trades and historical replay; pricing previously discussed is conditional, not licensed total.
3. Ensure options OI source/contract/expiration and timing provenance, including whether SPX/SPY options are merely proxies for ES.
4. Isolate raw event capture and retention from Backend 1's replay disk. No unrestricted depth feed storage.
5. Run paper/shadow-only one-month evaluation with data-quality SLAs, baseline-versus-paid-feed ablation, and predeclared target/raid/reversal/continuation definitions.

## Next development stages
- Add a separate Engine 18 ingestion service and append-only timestamped event log; reconnect/replay/gap monitoring.
- Add market-by-order book reconstruction, cancellations/additions, trades-at-price, aggression, replenishment, absorption and liquidity-void evidence.
- Add CME futures/options open interest and optional SPX/SPY gamma scenario overlays with cross-instrument reconciliation.
- Freeze objective forward-looking scoring and outcome metrics; track probability calibration, false raids, precision/recall, missed targets, latency, drawdown, and reliability.
- Wire a read-only Engine 18 snapshot to the existing chart only after tests and owner approval.

## Safety / rollout
Work exclusively on `engine18-liquidity-intelligence-foundation-20261109`. Do not merge or deploy from main automatically. Automated testing required before release. Current files do not register any routes or start any new services.
