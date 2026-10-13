# ENGINE 11 — TWO-YEAR ES HISTORICAL DATA READINESS REPORT V1

Prepared for Engine 2B Lead Manager — ACCEPT or REVISE. Research-only milestone; no production/source-acceptance request.

## 1. Outcome and scope

Authentic native ES data is obtainable at every requested resolution using the existing provider credential. All 119 raw-contract/timeframe acquisitions completed, with 276,604 in-range source observations across 17 research windows. This is evidence of acquisition availability, **not verified continuous coverage or completed canonical candles**. Calendar proof, finality, missing-interval classification, and one full contract binding remain unresolved within the current two-year target.

Target begins October 12, 2024. Candle acquisition as-of is **2026-10-13T01:46:32.756Z**; individual receipts record their later observation times. The schedule/metadata follow-up has a separate as-of. Present means the capture instant, not a completed October 13 trading session. No 2020–2024 archival dependency is a delivery gate. Earlier research remains unchanged on PRs #103/#108/#109.

Authority: [Manager two-year directive](https://github.com/bfrye1973/frye-market-backend/pull/109#issuecomment-6136199485). Engine 11 owns data; Engine 22 alone decides per-degree historical sufficiency and structure; Engine 2B owns chart rendering and project approval. Engine 22 Manager's separate structural ratification is not represented as received.

## 2. Reproducible GitHub evidence

- Candle probe commit: `f004b5fee81b86511616811c5715354173a0eee3`; [run 38333722706](https://github.com/bfrye1973/frye-market-backend/actions/runs/38333722706), regression and authentic acquisition jobs passed.
- Schedule diagnostic commit: `693605378d6715e3c4806cb2ffc6fc3868ece869`; [run 38334116685](https://github.com/bfrye1973/frye-market-backend/actions/runs/38334116685), both jobs passed.
- Exact-date and dated metadata follow-up: `05e12119bce0fdf29b131a25c65f7e297a33c443`; [run 38334377818](https://github.com/bfrye1973/frye-market-backend/actions/runs/38334377818), both jobs passed.
- Full original decoded candle response bodies, capture receipts and readiness data: [artifact 11783458871](https://github.com/bfrye1973/frye-market-backend/actions/runs/38333722706/artifacts/11783458871). ZIP SHA-256 `3e24b3b3f0b737df84593c127109319b0aa22f89843ddd285ef15353f266e681`.
- Full schedule and metadata follow-up archive: [artifact 11784037859](https://github.com/bfrye1973/frye-market-backend/actions/runs/38334377818/artifacts/11784037859). Its original decoded body bytes are also permanently preserved in `evidence/engine11-two-year-schedule-receipts-v1.json` beside this report, with body hashes, receipt identities, requests, HTTP statuses and capture times.
- Permanent summary, all 732 date statuses, 119 window results, conflict samples, raw candle receipt manifest and per-window parent parity: `evidence/engine11-two-year-readiness-summary-v1.json`.

Actions artifacts retain 30 days. The permanent candle manifest and selected source examples do not replace a permanent archive of every original candle body. Durable raw-candle archive retention remains a completion requirement; no new paid storage was provisioned. The report's exact final head and final CI evidence are recorded in the draft PR review request.

## 3. Acquisition results by independent degree

Every row below has 17/17 completed, nonempty native queries, no exact duplicate observations, and no errors under the implemented OHLC, quarter-tick, volume and timestamp validators. Validators passing does not certify completeness or semantics.

| Degree | Native resolution | In-range source rows | Timestamp/session collision observations | Internal source gaps |
|---|---|---:|---:|---:|
| SUBMICRO | 5min | 170,991 | 1 | 1,717 |
| MICRO | 10min | 86,040 | 1 | 907 |
| SUBMINUTE | 1hour | 14,416 | 1 | 626 |
| MINUTE | 4hour | 4,392 | 486 | 124 |
| MINOR | 1session | 608 | 0 | Not evaluated by fixed-step gap detector |
| INTERMEDIATE | 1week | 125 | 0 | Not evaluated by fixed-step gap detector |
| PRIMARY | 1month | 32 | 0 | Not evaluated by fixed-step gap detector |

Counts include separately preserved successor overlaps and distinct source session observations. They are not deduplicated continuous-series bar counts. Fixed-step gaps include potential closures and illiquid-contract intervals; none are asserted to be missing trading candles yet. Zero reported gaps for daily/weekly/monthly is not a calendar-based completeness result.

The nine primary windows sample ESZ2024, ESH/M/U/Z2025 and ESH/M/U/Z2026 by calendar quarter. Eight additional windows capture each successor contract during the preceding roll month. Calendar-quarter sampling deliberately does not select an approved rollover date or splice prices. Native weekly/monthly records whose bucket start precedes the request boundary survive in original bodies but are excluded from in-range counts. The October 2024 monthly bucket therefore needs an explicit interval-intersection/guard-band rule; the first in-range monthly start is November 1, 2024. No October data was silently fabricated.

Intraday observations begin October 13, 2024 at 22:00Z (4h bucket labels begin 20:00Z). Latest observed starts are October 13, 2026 at 01:45Z / 01:40Z / 01:00Z / 00:00Z for 5m / 10m / 1h / 4h. Current daily, weekly and monthly observations are not automatically completed candles.

**All seven degrees remain independently structurally ineligible.** Two years does not reduce Engine 22's required origin, warm-up or confirmation history. A missing higher degree must not disable an eligible lower degree later.

## 4. Massive Schedules — measured availability and limitations

Authenticated `GET /futures/v1/schedules` works under the existing credential. The complete requested range traversed three pages and returned **2,448 events**. Only **1,224** belong to the observed outright ES labels; the other 1,224 are `ES Equity Calendar Spread` events and cannot complete outright schedules. Original mixed records remain preserved.

The initial request failed HTTP 400 because `timestamp` is not a supported sort field. A diagnostic response explicitly lists supported fields `product_code` and `session_end_date`. Removing that sort completed traversal; the reusable full probe now uses `session_end_date.asc`. Exact error body and digest are preserved. This was request incompatibility, not evidence of denied account access.

| Date ledger classification | Dates |
|---|---:|
| Provider schedule candidate, outright scope only | 390 |
| No returned schedule events | 332 |
| Incomplete open/close evidence | 2 |
| Unverified transition policy | 8 |
| Total requested calendar dates | 732 |

No-event days include weekends, holidays and unpopulated historical dates. They are not inferred closed. Range results' earliest session label is January 21, 2025, with only an open event; the first ordinary candidate is March 17, 2025, and March 18 has only a close. Exact-date queries confirm empty results for October 14 and November 28, 2024, and January 30 and March 10, 2025. This proves those requested observations are absent, not a universal account retention cutoff.

Thanksgiving November 27, 2025 is empty under its own session label; events for November 27 occur under November 28. Eight multi-day holiday sessions contain `pre_open` while the previous state is open, without an explicit intervening close. Their closure/transition semantics remain unavailable pending provider documentation and exchange corroboration. These dates are May 27, June 20, September 2 and November 28, 2025; January 20, February 17, May 26 and September 8, 2026. The classifier does not infer a tradable interval through those transitions.

Observed ordinary examples include November 3, 2025 opening 23:00Z and closing 22:00Z, versus March 9, 2026 opening 22:00Z and closing 21:00Z. April 3, 2026 reports a 13:15Z early close. These are provider observations, not an independently accepted CME calendar or proof of an actual completed session. Schedules include future closing events for the currently open October 13 session.

Source schedule revisions, immutable schedule version IDs, correction relationships and actual-session completion evidence are not supplied in the observed response. Captured body hashes/versioned research receipts preserve observations, but do not invent those missing provider guarantees. Product-name scoping is an explicit observed-label research policy, not an approved canonical instrument registry.

## 5. Contract and candle integrity

Seven contracts initially matched the protected V2 binding requirements. A March 20, 2025 metadata query additionally returns ESH5 settlement March 21, 2025, allowing **8/9** research bindings through the existing V2 function. January 2025's reduced metadata remains preserved; it is not overwritten. Initial summary rows keep their original unbound state, with a separate follow-up binding.

ESZ4 metadata queried October 14 and December 19, 2024 identifies ES/XCME, first trade June 4, 2021 and last trade December 20, 2024, but omits `settlement_date`. ESZ2024 remains unbound under the accepted V2 contract. `last_trade_date` is not silently promoted to settlement evidence. This is a current-window source dependency, separate from deferred 2020 contract research.

There are 486 4h timestamp collisions across different session labels. All **4,392** captured 4h parents exactly reproduce open, high, low, close, volume and transactions from captured 1h children belonging to the **same session label**. For example ESZ6 bucket `1788984000000000000` has session September 9 with volume 264 from its 20:00Z child, and session September 10 with volume 437 from its 22:00Z/23:00Z children. This supports distinct session-clipped contents inside one provider clock bucket. It does not establish canonical session-open 4h alignment, trade timing, source finality or a correction relationship.

The 5m/10m/1h conflicts share January 30, 2025's final clock bucket: different session labels and different prices/volumes. The 5m label is 21:55Z, with volume 219 under January 30 and 2,080 under January 31. Calendar evidence for that date is absent. Do not attribute this to DST, a provider defect or a corrected record without finer source and schedule proof. Both observations remain quarantined and retained.

## 6. Implemented paths and regression evidence

All changes are new files relative to PR #109's head, isolated under:

- `services/core/logic/engine11/twoYearResearchV1/schedules.js`
- `services/core/tests/engine11/twoYearResearch/` — authenticated acquisition, diagnostics, offline parent analysis, synthetic safety tests and authentic receipt/identity regression fixtures.
- `.github/workflows/engine11-two-year-readiness.yml`
- This report and its two evidence JSON files.

The final local suite passes **233 tests** (212 inherited plus 21 new). New tests verify exact original-body hashes, all paginated source pages, outright/spread separation, 732-date reproducibility, unknown holiday transitions, dated ESH2025 binding, preservation of distinct 4h session contents, altered-volume rejection, ambiguous-child rejection, bounded acquisition, secret isolation and unsafe cursor rejection. Probe jobs succeeding means they completed capture; unavailable evidence is intentionally reported rather than causing a false eligibility pass.

Render was inspected read-only: 18 services, no Engine 11 branch service; core service `srv-d2ds5nodl3ps73b7i2og` remains on `main`. No Render resources or settings were modified.

## 7. Exact work remaining to finish this foundation

1. Establish complete current-window ES calendar evidence. Recover missing October 2024–March 2025 schedules and verify multi-day holiday `pre_open`/reopen semantics, closed dates, maintenance and early-close exceptions. Obtain provider clarification through Manager coordination; do not buy a plan or backfill from guessed current schedules.
2. Corroborate ESZ2024 expiry/settlement identity from an authentic approved source or propose a separately approved versioned alternate binding. Preserve the accepted V1/V2 implementations.
3. Investigate January 30/31, 2025 using finer native source observations and provider explanations. Preserve each source/session observation; distinguish corrections only with explicit stable identity and correction evidence.
4. Build an isolated calendar-aware completeness/finality verifier. Separate closed intervals, open intervals without trades, acquisition gaps and unresolved evidence. Account for per-receipt as-of, session interruptions and weekly/monthly period ends. Current observations and future schedule closes cannot certify finality.
5. Specify interval-intersection and guard bands at the October 2024 start, quarter changes and live tail. Prove weekly/monthly session aggregation and retained raw-contract lineage independently. Do not silently select a roll method or mix contract prices.
6. Preserve all acquired raw candle bodies beyond the 30-day artifact expiry in an approved durable research archive, with hashes and repeatable retrieval. No topology or spending authorization is implied.
7. Repeat the dated completeness matrix for all seven resolutions and all contract periods after evidence gaps are resolved. Engine 22 then independently decides degree sufficiency at its later source gate.

## 8. Recommendation to Engine 2B

ACCEPT this acquisition/readiness research milestone with the above unavailable states retained. Recommend the next isolated scope: current-window source clarification, versioned provider-calendar interpretation, finer January 2025 conflict probes, durable evidence retention design and calendar-aware integrity verification. Any alternate contract-binding schema or canonical interval policy requires a separate Manager decision before changing protected modules. There is no request for chart/Engine 22 integration, adjusted-series publication, production merge or deployment.

The two-year raw acquisition capability is demonstrated. The reliable two-year canonical foundation is **not yet complete**. Outstanding work is confined to current-window evidence and acceptance, not older archival records. Existing live routes, streaming, consumers, trading/account lifecycle, Journal, Replay, approved Elliott anchors/Fibonacci and V3 shadow boundaries remain untouched.
