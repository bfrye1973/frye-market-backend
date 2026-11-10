# Engine 25 Reconstructed EOD v1 — Frozen Shadow Formula

Status: FROZEN FOR DAILY SHADOW COMPARISON
Production authority: NONE
Effective research lock: 2026-10-31

## Breadth

For each stock:

1. Use daily bars.
2. Define a 10-session new high when the day's HIGH exceeds the highest HIGH of the prior 10 completed sessions.
3. Define a 10-session new low when the day's LOW falls below the lowest LOW of the prior 10 completed sessions.
4. Use a 2-session carry window:
   - 10NH = 1 if a qualifying new-high event occurred on either of the latest 2 sessions.
   - 10NL = 1 if a qualifying new-low event occurred on either of the latest 2 sessions.
5. Aggregate 10NH and 10NL by sector.

Purpose: preserve the slower, smoother behavior of the legacy spreadsheet instead of resetting the breadth signal completely each day.

## Momentum

For each stock:

1. Use daily bars.
2. Four-session directional move:
   move = current close - close 4 trading sessions ago.
3. Compute raw-dollar ADR over the latest 20 trading sessions, current session included:
   ADR20 = average(high - low).
4. UP = 1 when move >= 3 * ADR20.
5. DOWN = 1 when move <= -3 * ADR20.
6. No additional persistence is applied to the momentum event in v1.
7. Aggregate UP and DOWN by sector.

This preserves the spreadsheet concept of a multi-ADR move and deliberately replaces the current production EOD rule based on three consecutive rising/falling closes.

## Display names

Legacy spreadsheet labels may continue to use:
- 10NH / 10NL for breadth.
- 5U / 5D for momentum display compatibility.

In reconstructed EOD v1, 5U/5D are display labels only. They do NOT mean a five-session calculation.

## Daily comparison rule

Reconstructed EOD v1 remains shadow-only.

Each completed trading day should record:
- sector 10NH
- sector 10NL
- sector UP
- sector DOWN
- breadth percentage
- momentum percentage
- reconstructed EOD score
- comparison against production EOD
- comparison against legacy spreadsheet values when available

No tuning is allowed from one isolated session. Formula changes require repeated evidence across multiple daily comparisons and owner approval.
