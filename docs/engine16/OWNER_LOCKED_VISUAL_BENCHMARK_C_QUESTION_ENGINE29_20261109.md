# Engine 16 — Owner-Locked Wick / Possible C Completion + Engine 29 Context Benchmark

**Decision/reference ID:** E16-OWNER-VISUAL-003
**Date:** 2026-11-09 (America/Phoenix)
**Status:** OWNER-LOCKED VISUAL AND BEHAVIORAL REQUIREMENT. Not an approved structural confirmation predicate, measured statistical correlation, or live integration authorization.
**Source:** Owner-provided TradingView screenshot ES and owner-provided Frye Engine 29 Market Character screenshot. Images remain in owner chat; this document paraphrases the visible state, without copying external proprietary indicators.

## Observable snapshot (do not overclaim)
1. On the owner's TradingView chart, an automatically displayed **C?** label appears at a recent swing high with an upper wick. A question-mark label denotes uncertainty visually, but the precise TriggerTrades proprietary predicate and whether it is waiting for a particular next candle **are UNKNOWN**.
2. Engine 29 screenshot simultaneously displays:
   - **1W BIGGER PICTURE: STRONG DOWNWARD PRESSURE**.
   - **1H CURRENT PRESSURE: CAUTION**.
   - **30M FAST SHIFT: BUYING PRESSURE INCREASING**.
   - **ES PARENT MOVE: UPSIDE MOVE ACTIVE**.
   - **10M LIVE CONDITION / 20M DIAGNOSTIC: COUNTERTREND SELLOFF FADING**.
   - Liquidity panel: **RECLAIMED HIGH**, with a marked level appearing near **7469.00** (visually approximate; verify with engine source).
   - Squeeze context: **DOWN — SQUEEZE WATCH** and **DOWN — SQUEEZE NARROW** in displayed diagnostic sections.
   - Some panel labels concurrently show **TRAP WATCH (BULL)** and divergent horizons; these are source-specific observations, not necessarily contradictory because time horizons and authorities differ.
3. The displayed evidence supports a **possible local change or completion candidate** but **does not prove** that C is over, that a top is confirmed, or that a breakout must occur.
4. Do not claim TriggerTrades uses any specific next-candle confirmation rule without observation/replay or source documentation.
5. Screenshot capture/candle timestamps and exact matching data contracts are not independently established. These are visual test references, not authoritative Engine 11 replay fixtures.

## Owner-required behavior for Engine 16
**Causal ABC + parent-degree interpretation remains E16-OWNER-ARCH-001.** Add a qualified completion-candidate lifecycle:

- `C_DEVELOPING`: C-wave hypothesis remains in progress; projected target models and alternatives retained.
- `C_COMPLETION_CANDIDATE` (display **C?**): observed wick/rejection or other *manager-approved* completion evidence raises a provisional hypothesis; store candidateHigh/pivot reference, event timestamp, knownAt, evidence type and parent degree. **A wick alone is not orthodox confirmation**. No mandated threshold has yet been approved.
- `C_CONFIRMED_RESEARCH`: only after a separately approved closed-candle structural/pivot/child-proof confirmation rule. Not equivalent to Engine 22 approved count.
- `C_CANDIDATE_REVISED/SUPERSEDED`: if subsequent price exceeds a former candidate high or new children change the structure, append evidence and re-evaluate instead of changing saved historical states. A mere new high does not by itself rule out an extending C; it can invalidate only the *proposed end at old high* under approved rules.
- Preserve competing `W3_DEVELOPING` and `W3_COMPLETION_CANDIDATE` interpretations when Engine 22 higher-degree context supports them. Shared pivot evidence does not merge scenario IDs.

**Engine 29 as optional read-only evidence, never structure authority:**
- Capture time-specific fields independently: weekly trend/down pressure; hourly caution; 30m buying pressure; 10m/20m fading countertrend selloff; ES parent move up; liquidity reclaimed high; squeeze watch/narrow; trap-watch status, with original field provenance and freshness.
- Do not reduce different time horizons to a single bullish/bearish boolean. Different horizons can express broader bearish pressure and near-term bullish counter-movement simultaneously.
- A reclaimed high, squeeze warning, or increase in buying pressure can be *counterevidence* to prematurely declaring an upward C completed. The same signs may be consistent with a continuing C or Wave 3; report as context, not proof.
- Exact Engine 29 output contract remains to be checked in GitHub before implementation. Never silently scrape text labels or infer live API JSON keys from a screenshot.

## Replay / testing requirements (PROPOSED, NOT EXECUTED)
1. Given valid provisional C with top wick and additional corroborating evidence, emit `C?` only when approved evidence predicate passes; no 'confirmed' status on the wick alone.
2. When the next closed candle makes a higher high: append revision to the completion-at-old-high hypothesis; C can still extend, and W3 remains possible. Historical snapshot at the earlier cutoff stays unchanged.
3. When subsequent candles confirm a swing high and structurally valid children: advance the **specific** C candidate through approved confirmation; do not convert it automatically into Engine 22 approval.
4. After an apparent rejection, if upward pressure increases and liquidity is reclaimed, retain both continuation and completion alternatives with reason-coded evidence; no forced top inference.
5. Preserve weekly/down, hourly/caution, 30m/up and 10m/20m fading as independently timestamped features. Stale/missing fields are UNKNOWN, never fabricated.
6. Restart/idempotent replay: same source cutoff/configuration yields identical candidate IDs and event history; no look-ahead or repaint.
7. Engine 29 unavailable or inconsistent should degrade optional confirmation context without blocking Engine 11 candles or base Engine 16 ABC computation.

## Manager questions
- What objective wick/pivot and candle-close evidence is sufficient to publish `C?`? What degree/tick/ATR normalization and minimum child evidence are needed?
- When does an old C? high become superseded versus actually invalidating the overall C-family candidate?
- Which authoritative Engine 29 read-only API/snapshot fields, evidence time and freshness budget can Engine 16 safely consume?
- How should evidence be ordered/ranked across higher-degree Engine 22 structure and Engine 29 short-term conditions, with no calibration-based probability claims?

## Boundary
No Engine 29 logic changes, no Engine 22 approved-count mutation, no trade permissions or executions, no production merge/deploy. This is a visual acceptance benchmark and pending engineering scope only.
