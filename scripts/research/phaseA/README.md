# Phase A exploratory harness (research only)

Reproduces Claude's Phase A report (`claude/PHASE_A_EXPLORATORY_REPORT_2026-11-24.md`, Claude Project) for the Engine 3 / Engine 4 parallel research. Plan: Joint Plan v2 §4b, §6, §7.

**Read-only.** It only calls Replay and OHLC GET endpoints. No engine, threshold, recording or permission change. **EXPLORATORY:** this cannot pass the §6 acceptance test.

## Files
- `phaseAHarness.core.js`: `pullReplayRows()` (compact as-of engine states from Engine 12 Replay) and `scorePhaseA()` (one scoring function for every comparator).
- `runPhaseA.mjs`: Node 18+ runner.
- `data/inputs_manifest.json`: **the single input manifest.**
  - Replay snapshot selection: a deterministic enumeration (per-day count + first/last HHMM from `/api/v1/replay/es/times`) plus the **sha256 of the exact 2,497-ID list**. The runner re-enumerates and **fails if the count or sha256 differ**.
  - The 5m bar count, range, cutoff and **sha256**. The runner warns if your bars don't match. **Bar values are not committed** (Massive licensing hold; owner decision pending).
- `data/phaseA_event_tape.json`: the exact output (every Engine 3 fresh call and every Engine 4 zone-defense event, with R).

## Run
```
BASE=https://frye-market-backend-1.onrender.com \
node scripts/research/phaseA/runPhaseA.mjs [--bars your_bars_5m.csv] --out /tmp/phaseA_result.json
```
- Without `--bars`, it fetches `/api/v1/futures/ohlc` live. **That route only serves a rolling 7-day window**, so older runs can't be reproduced bar for bar. The runner compares the bars sha256 with `data/inputs_manifest.json` (`inputs.barsMatchManifest`).
- **Engine 3 v6 / A-B-C comparators:** feed your own decision rows (same fields as `pullReplayRows`) into `scorePhaseA(rows, bars)`. This keeps the scoring function, exits, stops and targets identical.

## Rule (pre-registered; do not tune)
- **Engine 4 zone defense (BUYERS):** a completed 5m bar touching the zone authorized as of bar close, with all of:
  - relVol ≥ 1.5× the median of the prior 20 bars
  - low in the zone's lower ¾, at or above the zone low
  - close in the upper half of its range and ≥ midline
  - lower wick ≥ 50% of range

  SELLERS is the mirror case.
- **Engine 3 signal:** every fresh canonical transition into LONG or SHORT while a zone is authorized. Held directions are excluded.
- **Outcome:**
  - entry at the signal price
  - stop 0.25 beyond the far zone edge
  - target = the nearest edge of the next zone seen in Replay, else 2R
  - first touch wins; 288-bar horizon, else mark to market
  - no fees or slippage; no Engine 6, trend filter or P1/P2/P3

## Provenance
- Replay engine states: **VERIFIED as-of**.
- 5m bars: **RETROSPECTIVE REST.** Arrival, finality and contract are UNKNOWN.
