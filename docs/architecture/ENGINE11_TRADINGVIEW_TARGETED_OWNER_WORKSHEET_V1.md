# Engine 11 — targeted TradingView verification worksheet V1

For Engine 2B coordination under Issue #130. Five existing records only; no re-entry of the registry. This worksheet requests evidence, not approval of new Elliott counts.

## One shared configuration capture

Use **CME_MINI:ES1!** if that is the exact exchange-qualified symbol shown on the owner's original chart; preserve any different prefix rather than silently changing it. ETH; chart timezone **America/Phoenix / UTC−7** as an unconfirmed hypothesis. Capture actual timezone selection, symbol/exchange, chart type (ordinary candles versus synthetic), chart timeframe, ETH selection, the **Adjust for contracts changes checkbox** and **Use settlement as close** selection. Do not infer B-ADJ from highlight color. Record capture date/time and current terminal contract. Original chart vintage is unknown: record what can be established and retain UNKNOWN for anything unavailable.

For each row below: open the preserved drawing's coordinate properties, capture its exact price/time, and the candle's Data Window OHLC and timestamp. Record whether the drawing points at an actual high/low, a bar label, an intrabar event, or an intentionally placed coordinate. Do not drag the drawing to a wick.

With everything else held fixed, capture the **same candle** under B-ADJ OFF and ON. Preserve the drawing property separately under each state; do not assume drawings automatically follow candle adjustment. For daily/weekly comparisons also capture SET ON/OFF with B-ADJ held fixed. Intraday SET comparisons are not required for the candle close itself, but the daily roll-reference close convention remains a separate question.

## Five-node checklist

| Registry / source cells | Original coordinate, timezone unconfirmed | Required comparison views | Specific distinguishing evidence |
|---|---|---|---|
| WB-ALL-030; All Nodes C30/D30/E30 | INTERMEDIATE W1 starting low; Apr 8 2025 10:00; 5188.50 | Original drawing timeframe first; 1W structural comparison; 1m only if the original event time is meant literally | ES1! weekly low and actual extremum date/time, B-ADJ OFF/ON, SET OFF/ON; original drawing may differ from weekly wick. Raw M2025 weekly low in provider label Apr11 is 4832; candidate shifts 348 / 348.75 yield 5180 / 5180.75, not 5188.50. |
| WB-ALL-031; C31/D31/E31 | INTERMEDIATE W1 ending high; Jan 28 2026 09:00; 7205.00 | Original drawing timeframe; 1W; diagnostic 1m only with confirmed event time | Same-week actual high/time under both B-ADJ states. H2026 weekly high in provider label Jan30 is 7043; candidate shifts 179.75 / 180 yield 7222.75 / 7223. Do not select a different week's closer price. |
| WB-ALL-032; C32/D32/E32 | INTERMEDIATE W2 low; Mar 30 2026 16:00; 6511.00 | Original drawing timeframe; 1W; compare alongside Minor mark without changing either | Exact drawing properties and weekly wick/event identity; distinguish separate count/event, basis or vintage from a shared extremum. M2026 weekly provider label Apr2 low 6353.25 +130 /130.25 =6483.25 /6483.50. |
| WB-ALL-024; C24/D24/E24 | MINOR W1 starting low; Mar 30 2026 16:00; 6496.00 | Original drawing timeframe; 1D/ETH session; same event alongside Intermediate mark | Same drawing properties, daily low and trading-date/bar-label convention. M2026 provider session label Mar30 low 6359.50 +130 /130.25 =6489.50 /6489.75. Preserve owner's corrected March30 date. |
| WB-ALL-012; C12/D12/E12 | SUBMINUTE W1 starting low; Sep16 2026 16:00; 7616.25 | Original drawing timeframe; 1h; 1m diagnostic with confirmed label/event time | Confirm actual ES1! underlying September/December contract at this bar, ETH boundary and B-ADJ pair. Z2026 23:00Z hourly low 7635.75; earlier 22:00Z low 7617.50 is a different interval and cannot be snapped to the node. |

The 1W / daily / 1h views are proposed independent structural inputs, **not proof of the original drawing timeframe**. If the owner's original chart differs, preserve and compare it as a separate view.

## Rollover evidence needed once

Capture TradingView's actual switch cards (from/to contract and switch date) for the relevant sequence **M2025→U2025→Z2025→H2026→M2026→U2026→Z2026**. Obtain the daily old/new contract closes nearest each switch, their dates and SET convention. Existing Massive calendar and sampled-volume dates agree for these six switches; that agreement does not verify TradingView's history.

For September, compare the same historical ES1! bars immediately before and after the *actual* switch under OFF/ON. Existing Massive paired close gaps: Sep9 65.50; Sep10 66.00; Sep11 67.75. These distinguish reference-day choices; none is a universal adjustment.

## Small evidence return

Engine 2B should preserve screenshots or CSV exports with settings and capture metadata; raw files need a hash/receipt. Five drawing-property captures, same-bar OFF/ON OHLC values, the shared settings capture and switch history are sufficient to begin the next proof. Do not request all 40 nodes again. Any missing evidence remains UNKNOWN. No owner evidence was received or independently verified by this milestone.
