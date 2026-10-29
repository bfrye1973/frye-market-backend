# Engine 27 V6 — Oct 28 verified ES candle research case

**Provenance:** read-only GitHub Actions run https://github.com/bfrye1973/frye-market-backend/actions/runs/40765978352, job `replay-probe`, 2026-10-28. Production Backend-1 `/api/v1/futures/ohlc?symbol=ES&timeframe={1m|5m|10m}&limit=5000&debug=1`. Historical provider query resolves ES to **ESZ6** by `env_contract_override`. No broker or original Replay contract match is asserted.

**Owner historical reference:** Engine22 W3 UP → W4 DOWN (Micro) and W5 UP → A DOWN (Submicro), reference high 7788.50 at 2026-10-28 11:00 America/Phoenix (18:00 UTC). This is owner-referenced structure, not an independent automated Elliott completion decision.

## Raw OHLCV at 18:00 UTC (bar-start timestamp)

| Timeframe | Open | High | Low | Close | Volume | Expected bar close (UTC) |
|---|---:|---:|---:|---:|---:|---|
| 1m | 7773.50 | 7788.50 | 7766.25 | 7769.50 | 7007 | 18:01 |
| 5m | 7773.50 | 7788.50 | 7766.25 | 7768.50 | 17279 | 18:05 |
| 10m | 7773.50 | 7788.50 | 7761.25 | 7764.50 | 34437 | 18:10 |

### Derived, reproducible features (1-minute bar)

- Range: 22.25 ES points.
- Real body: 4.00 points (down candle).
- Upper rejection wick: 15.00 points, 67.4157% of range.
- Lower wick: 3.25 points, 14.6067% of range.
- Close location: (7769.50−7766.25)/22.25 = 14.6067% up from candle low.
- Engine22 earlier Micro W3 last **published** Fib touch: 1.000 at 7787.25 (touchedAt 2026-10-28 16:50 UTC).
- This verified 18:00 candle **crosses the 7787.25 level**, with its high 1.25 points above that level and its close 17.75 below it. Do not infer exact intraminute ordering or update the official Engine22 touch timestamp.
- Engine22 earlier Submicro W5 last published touch: 0.618 at 7778.50 (touchedAt 17:01:20 UTC). The 18:00 1m bar includes 7778.50 in its high-low range; it also has an upper wick reaching the level. Do not call it the **last** intraminute contact without ticks.
- Last sampled Engine26 negotiated zone [7730.25, 7758.00] is 30.50 points below the owner-reference high, but exact point-in-time zone selection at the turning bar should be independently crosschecked.

## Evidence limitations

- A new provider query's `resolvedSymbol=ESZ6` is **not** proof that the historical Engine12 Replay snapshot's root ES price was from ESZ6.
- These are retrieved completed aggregate candles, not live tick sequence. Multiple Fib contacts within the same candle are unordered.
- Historical 1m lookback is short. The original probe's **GitHub job logs** are durable developer evidence but do **not** constitute an activated permanent Engine27 observation archive.
- No production writer, scheduler, dashboard upgrade, automatic wave completion, or Engine28 learning is activated by this report.
