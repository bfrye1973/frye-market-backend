# Engine 22 V3 — seven-degree independent candle evidence audit (2026-10-12)

**Scope:** real production ES inputs read-only by isolated GitHub Actions; PR #97 **draft/unmerged/undeployed**. No canonical anchor writes, Fibonacci promotion, trading, or frontend changes.

## Verified independent pivot evidence

| V3 degree | Proposed timeframe | Completed candle depth | Latest completed candle time (UTC) | Swing highs | Swing lows | Candidate state |
|---|---|---:|---|---:|---:|---|
| INTRADAY_SUBMICRO | 5m | 299 | 2026-10-12T14:50:00Z | 35 | 35 | W3 HIGH candidate 7858.25, **not** confirmed |
| MICRO | 10m | 120 | 2026-10-12T14:30:00Z (previous live snapshot) | 15 | 16 | W5 HIGH candidate 7870, **not** confirmed |
| SUBMINUTE | 1h | 120 | 2026-10-12T14:00:00Z (previous live snapshot) | 11 | 11 | No wave candidate: ACTIVE_WAVE_REQUIRED |
| MINUTE | 4h | 120 | 2026-10-12T12:00:00Z (previous live snapshot) | 18 | 14 | W2 LOW candidate 7826.75, **not** confirmed |
| MINOR | 1d | 120 | 2026-10-11T00:00:00Z (previous live snapshot) | 15 | 18 | No wave candidate: WAVE_START_TIMESTAMP_REQUIRED |
| INTERMEDIATE | 1w | 0 legitimate | None | 0 | 0 | SOURCE_HISTORY_UNAVAILABLE |
| PRIMARY | 1mo | 0 legitimate | None | 0 | 0 | SOURCE_HISTORY_UNAVAILABLE |

Evidence IDs use immutable-style source candle timestamp identities, e.g. `ES:5m:2026-10-12T14:20:00.000Z`, `ES:10m:2026-10-12T13:30:00.000Z`, `ES:4h:2026-10-09T12:00:00.000Z`. Actual pivot record also contains its confirmation timestamp and two right-confirmation bars. Outputs preserve independent degree/count identity. Each degree detects swings without parent approval or lifecycle gating; wave *candidate* assessment can be unavailable if its own wave metadata is insufficient.

## Data provenance and gaps

- 5m: native `/api/v1/futures/ohlc?symbol=ES&timeframe=5m&limit=300`; 300 returned, median 300-second spacing; 299 closed as of snapshot clock.
- 10m/1h/4h/daily: production strategy snapshot `marketMeter.layers.emaPosture` source arrays (120 bars each). Existing buildStrategySnapshot.js passes these to V3 wave builder on the draft branch; isolated proof uses the same public snapshot.
- The existing `engine3DiagnosticBars.fiveMinute` is **not present as a public snapshot array**; the independent 5m OHLC endpoint is available, so wiring 5m directly to Engine 22 instead of relying on Engine 3 is the outstanding live-pipeline task.
- 1w and 1mo queries on the same OHLC endpoint responded HTTP 200 with 300 records each, but **median spacing was 60 seconds** (1m data) for both. **Reject** as mislabeled fallback data. Weekly/monthly live history depth is zero validated bars, with source/gap resolution required.
- Higher degree source recommendation: secure validated ES native weekly/monthly candles from a provider with exact session and close rules and sufficient multi-year history. Do not silently aggregate incomplete daily history into weekly/monthly candles. The existing 120 daily bars is insufficient for Primary multi-year wave structure.

## Safety and publication

The isolated PR #97 pipeline runs the *existing* swing and wave-candidate detectors; no new detector. All seven degrees are separate records and read-only. Pivot timestamps, source bar IDs, confirmation timestamps, and HIGH/LOW nodes are reported. No parent-degree approval gates detection. Official anchors, Fibonacci authority, execution, Engine 6, 26, 27, 28A contracts, and frontend layout remain unchanged.

**What this does NOT prove:** autonomous seven-degree Elliott Wave counting; sufficient 1w/1mo history; legitimate live shadow publication (PR unmerged); correctness of provisional wave counts; completed structural confirmations.

Proof CI: Engine22 V3 Independent Nodes Shadow workflow; previous run `38264285608` and follow-up `38266693088` with raw 5m probe. All tests run on draft PR head; not on Render production.

## Additional source audit — 2026-10-12T15:18Z

Direct source-code inspection of `services/core/routes/futuresOhlc.js` establishes that the endpoint's `TF_MAP` supports only 1m, 5m, 10m, 15m, 30m, 1h, 4h, 1d. An unrecognized `1w` or `1mo` request falls back to `1m` by `const tf = TF_MAP[tfRaw] ? tfRaw : "1m"`. An HTTP 200 therefore **must not** be regarded as weekly/monthly data authority.

Direct 1d `limit=1200&debug=1` probe: `resolvedContract=ESZ6`, `actualTf=1d`, `resolution=1day`, **159** daily bars from 2025-09-09T00:00Z to 2026-10-11T00:00Z, **eight date gaps longer than 7 days**, maximum gap **30 days**. This is a **single resolved futures contract**, not a verified multi-contract, rollover-normalized continuous ES history. Thus it cannot serve as official multi-year Intermediate/Primary wave node authority and has not been plugged into 1w/1mo lanes.

### Higher-degree source acceptance requirements

- Obtain approved continuous ES futures history with contract identity, rollover method/adjustment, exchange session/calendar, monthly/weekly interval finality, and timestamps.
- Validate independent 1w and 1mo OHLCV bars, correct spacing, and sufficient multi-year structural lookback. Record missing sessions and bar count; **do not hide gaps or infer filled candles**.
- Only after those provenance checks, pass completed 1w to INTERMEDIATE and completed 1mo to PRIMARY **in read-only shadow**, without anchor or Fibonacci promotion.
- Preserve the existing first-five evidence proof, including standalone native 5m ES source in the draft build job.

Audit source: GitHub Actions isolated read-only run `38269281369`; no production changes.
