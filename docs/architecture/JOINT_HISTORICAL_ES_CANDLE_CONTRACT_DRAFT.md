# JOINT HISTORICAL ES CANDLE CONTRACT — DRAFT v0.1
**Frye Dashboard 2 | Engine 22 + Engine 2B | 2026-10-12**
**STATUS: FOR ENGINE 22 MANAGER AND ENGINE 2B MANAGER REVIEW — NOT APPROVED FOR IMPLEMENTATION OR PRODUCTION**
**Owners:** Proposed: existing shared backend market-data/provider team (formal owner/teammate designation PENDING Manager approval). Engine 22 owns Elliott structure; Engine 2B owns visualization.

## 0. Scope and non-negotiable boundaries
One historical ES candle authority, consumed by both engines. Do not promote Engine 22 V3 shadow nodes, modify approved manual anchors/Fibonacci, change execution prices/contracts or trading systems. Do not alter existing live `/api/v1/futures/ohlc` semantics. Engine 2B's draft `/api/v1/engine2/historical-futures` is an isolated *research adapter*, **not** a second canonical history owner or approved production source. No merge/deploy without Manager authorization.

## 1. Price-basis model
- `RAW_CONTRACT`: actual unadjusted OHLCV from individual quarterly symbols (ESH6, ESM6, ESU6, ESZ6, etc.). No stitching and no price transforms.
- `CONTINUOUS_UNADJUSTED` (optional research view): explicitly scheduled, individual raw contracts concatenated. Roll discontinuities are real *series construction* discontinuities, flagged as such; not a claim of executable prices.
- `CONTINUOUS_ADJUSTED`: deterministic roll-adjusted research view derived from immutable raw contract bars. **Proposed candidate:** additive backward adjustment anchored to current/front contract, using the difference between outgoing and incoming prices at a specific common eligible completed-bar time near each approved roll. Freeze exact choice of eligible bar, schedule, and adjustment sign in a versioned rule before implementation. No auto-approval of this candidate methodology.
- OHLC components must receive the identical per-segment additive adjustment; volume remains raw, no invented adjusted volume. Derivative views have `priceBasisVersion`, `rollScheduleVersion`, `adjustmentRuleVersion`, `sourceSeriesId`.
- Never infer original Engine 22 manual-anchor price basis. Report mismatches rather than shifting anchors.

## 2. Candle identity and public contract
**Proposed envelope** (subject to Manager acceptance):
```json
{
 "schemaVersion":"historical-es.v1",
 "rootSymbol":"ES",
 "seriesId":"ES:CONTINUOUS_ADJUSTED:<version>",
 "priceBasis":"CONTINUOUS_ADJUSTED",
 "priceBasisVersion":"pending",
 "timeframe":"10m",
 "sessionCalendarVersion":"pending",
 "range":{"fromInclusive":"ISO8601","toExclusive":"ISO8601"},
 "bars":[{
   "candleId":"immutable-source-identity",
   "rootSymbol":"ES","symbol":"ES","contract":"ESU6",
   "timeframe":"10m","timestamp":"ISO8601 UTC",
   "open":0,"high":0,"low":0,"close":0,"volume":0,
   "complete":true,"source":"massive-polygon-futures",
   "priceBasis":"CONTINUOUS_ADJUSTED",
   "rawCandleId":"immutable-raw-identity",
   "adjustmentPoints":0,"rollRuleVersion":"pending",
   "adjustmentRuleVersion":"pending","provenanceHash":"sha256:..."
 }],
 "quality":{"complete":false,"gaps":[],"duplicates":[],"rolls":[]},
 "nextCursor":null
}
```
Values above are **shape examples**, not real candles or approved prices. CandleId must be stable across repeated requests; do not assume vendor returns a unique native ID. If none exists derive a documented collision-resistant ID from vendor + contract + resolution + UTC start timestamp + session calendar (and identity algorithm version), with raw IDs distinct from adjusted series IDs. UTC instants are canonical; Phoenix zone only for display of manually recorded timestamps whose timezone convention is verified.

## 3. Source lineage
Each bar records vendor/source file, provider ticker (including year-normalization), contract month/year, retrieval timestamp and immutable identity, source start timestamp, source timeframe, completed flag, session calendar version, raw hash, transformed hash, cumulative adjustment, roll event ID, and adjustment method/rule versions. Credential or key material MUST NOT enter logs/hashes. Historical corrections create a new dataset/version, rather than silently rewriting published historical evidence.

## 4. Data quality and pagination
- Half-open UTC range `[from,to)`; deterministic ascending order, stable `nextCursor`, explicit `hasMore` and `truncated`. No hidden oldest/latest clipping and no silently omitted rows.
- Gap check against exchange trading sessions, holiday and maintenance closures, not a naive 24/7 fixed 10-minute grid. Classify `EXPECTED_CLOSURE`, `MISSING_SOURCE_BAR`, `ROLLOVER_BOUNDARY`, `SOURCE_UNAVAILABLE`. Provider-unavailable and missing candles are never synthetic OHLC.
- Deduplicate by *source identity* within each contract; simultaneous ESU6 and ESZ6 bars are valid distinct candles. Detect conflicting duplicate identity, invalid OHLC, nonmonotonic time, future/incomplete bars, and missing provenance. Fail closed where structural use requires verified completeness.
- Snapshot/version pinning for paginated reads: cursor includes/authorizes dataset version, series ID, price basis, timeframe, and boundaries. Requests may not quietly switch price basis mid-scroll.
- Support intraday through monthly completed-bar aggregation only after calendar/session/roll provenance validation. Multi-year depth target is degree-driven, not an arbitrary N-bar count.

## 5. Engine 22 consumption
Seven independently operating degrees: INTRADAY_SUBMICRO (5m), MICRO (10m), SUBMINUTE (1h), MINUTE (4h), MINOR (1d), INTERMEDIATE (1w), PRIMARY (1mo), **as stated in V3 draft PR #97**. Preserve project operational six presentation labels independently; do not conflate Engine22 V3 structural MICRO with frontend strategy Micro. Exact source mapping is subject to Engine 22 Manager's sign-off.
Only actual completed candles with unique identities may feed shadow swing-node detection. Source continuity, history depth and per-degree freshness/completeness must be independently verified; no parent-degree gating. V3 node evidence remains provisional/shadow. No new automatic anchor/Fibonacci authority; `active-wave-state-es.json` remains approved historical manual record without invented candle identities.

## 6. Engine 2B consumption
Historical chart sets a single explicit `seriesId`/`priceBasisVersion` when initialized; labels RAW contract vs CONTINUOUS_ADJUSTED. Scrolling left requests earlier bounded pages using *same* pinned version and merges by bar identity and time. Timeframe changes request compatible candle history on the same price basis; if unavailable display an explicit incompatibility warning, never substitute another basis. Preserve visible logical range/zoom and live bars, prevent overlapping requests/race conditions, respect memory cap with predictable re-page behavior. Do not draw a verified wave mark at another time or price just to make it visible. Date-only approved anchors remain unresolved until Engine 22 establishes precise timestamp. Rendering the current production live contract alongside adjusted history requires explicit boundary design; never append raw live price points onto a back-adjusted historical scale without a proven compatible front-anchor mapping.

## 7. Execution boundary
Continuous adjusted and continuous unadjusted views are analytical/chart-only. No execution, stop, sizing, order-routing, P&L, journal, risk, or quote service may accept those series as tradable live contract prices. Execution path stays linked to actual explicit broker futures contracts and existing permissions.

## 8. Acceptance matrix (test evidence required)
1. Raw provider replay: unchanged OHLCV, stable contract IDs, exact timestamps, reproducible hashes.
2. Rollover replay: verified overlap on approved roll, deterministic roll offsets, transformed OHLC invariant, independently repeated history produces matching hashes.
3. Price-basis parity: no silent mixing; ESU6/ESZ6 overlap from September 10–14, 2026 showed 277 matching timestamps with median **+66.00 ESZ6−ESU6** points, range +64.50–+68.25. Confirm basis handling, not an assumed constant gap.
4. Approved-anchor compatibility: manual Minor W1/W3/W4 and Minute A/B prices vs raw and candidate adjusted sources, each with basis/match/uncertainty explanation. Preserve unmatched anchors untouched.
5. Pagination: deterministic windows across day and roll boundaries, cursor pinning, no skips/duplicates, zoom/scroll retains series identity under concurrent live updates.
6. Quality: synthetic gap, duplicate, contract overlap, expected session close/holiday, conflicting source revision, provider failure, incomplete bar.
7. Engine 22: seven independent degrees, real completed source candles, unique IDs, sufficient weekly/monthly depth, V3 shadow-only; no official anchor/Fibonacci mutations.
8. Execution isolation: unchanged live OHLC behavior, unchanged broker contract/live price, no side effects.
9. Scale/load: rate-limit budgets, bounded response, storage index/query latency, multi-user concurrency, long-history cost and graceful insufficient-depth states.

## 9. Existing evidence and known blockers
- Backend current route `services/core/routes/futuresOhlc.js`: fixed history 10m=14 days and 1h=90 days, one resolved contract.
- Engine2B draft historical route: `services/core/routes/engine2HistoricalFutures.js` (branch `engine2b-chart-overlays-v1`). Explicit contract/day-range research only.
- Live provider research: ESM6 April/June, ESU6 July, ESZ6 September/October historical 10m bars available. ESU6 September 22–26 returned zero while ESZ6 returned 540.
- Engine 22 original anchor file `services/core/data/waves/active/active-wave-state-es.json` does not consistently carry source contract/adjustment identities.
- Engine22 V3 independent candle/node evidence: draft PR #97; no promotion authority.
- Outstanding: formal **market-data owner designation**, ratified source/provider budget and complete multi-year access, price-basis choice for new structural evidence, versioned roll schedule/method, raw-vs-manual-anchor compatibility, chart live/history seam, and test sign-off.

## 10. Governance and approval gates
**Gate 0 (current):** Design only, circulate contract to Engine 22 Manager, Engine 2B Manager and proposed market-data owner. **No merge/deploy.**
**Gate 1:** Managers designate provider owner and approve schema, timeframe mapping, canonical roll/adjustment proposal, initial depth, and acceptance criteria.
**Gate 2:** Provider owner implements on isolated branch/preview with read-only evidence; Engine22+2B separately integrate after gate.
**Gate 3:** Managers inspect parity, safeguards, live chart and seven-degree proofs; explicit production authorization required.

### Manager decisions requested
1. Assign shared market-data owner/team, initially propose owner of `services/core/providers/futuresOhlcProvider.js` and related shared provider infrastructure; clarify that Engine2B draft adapter is research-only.
2. Approve/revise proposed explicit basis schema and pending additive-adjustment experiment (not automatically canonical).
3. Confirm the V3 seven-degree timeframe mapping from PR #97 and required lookback per degree.
4. Authorize (later, separately) implementation gate once contract is approved.
