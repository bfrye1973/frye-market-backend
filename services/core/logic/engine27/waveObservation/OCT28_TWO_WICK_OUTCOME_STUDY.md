# October 28, 2026 — Two upper-wick research cases and observed 10/30/60m outcomes

Source: [read-only historical Github Actions run 40796722201](https://github.com/bfrye1973/frye-market-backend/actions/runs/40796722201), ES one-minute completed aggregate candles requested from Backend-1 futures OHLC; resolver chose `ESZ6` under `env_contract_override`. **This does not prove the archived Engine 12 Replay price used the same physical ES contract**. Both owner-described Micro W3 wave endings are hypotheses, not Engine 27 autonomous confirmations.

| Feature | Oct28 11:00 Arizona | Oct28 13:01 Arizona |
|---|---:|---:|
| 1m OHLC | 7773.50 / 7788.50 / 7766.25 / 7769.50 | 7800.75 / 7819.50 / 7799.75 / 7805.25 |
| 1m volume | 7007 | 13125 |
| Upper wick | 15.00 | 14.25 |
| Upper wick share of range | 67.4157% | 72.1519% |
| T+10m 1m candle close | 7765.25 | 7777.25 |
| T+10m close minus event high | -23.25 | -42.25 |
| T+30m 1m candle close | 7771.25 | 7765.50 |
| T+30m close minus event high | -17.25 | -54.00 |
| T+60m 1m candle close | 7771.75 | MISSING (future when audit ran) |
| T+60m higher-high condition | Yes | Not yet determinable |

The 11:00 upper wick **did not establish the day's subsequent high**; later provider data reached 7819.50 at 13:01 AZ. The 13:01 candle coincided with a much stronger measured 10m/30m reversal, but no definitive completion or beyond-the-audit-window future-maximum claim follows.

**Important outcome-horizon limitation:** audit compares exact minute-start timestamps at T+N to the **close of that later minute**. Future outcome criteria should explicitly anchor either event bar start or completed event bar close, and report that basis. A later 60m close is unavailable for 13:01 at audit time. Mark as `PENDING`, not `OUTCOME_MISSING`.

No signed physical contract tie to original Replay or independent Elliott wave completion established. No production changes made.
