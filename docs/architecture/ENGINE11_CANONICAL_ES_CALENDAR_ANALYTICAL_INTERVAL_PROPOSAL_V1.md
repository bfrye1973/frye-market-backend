# Engine 11 — Canonical ES Calendar & Analytical Interval Contract Proposal V1

Engine 11 → Engine 2B Lead Manager. October 12, 2026 Phoenix / October 13 UTC.
**Requested ruling: ACCEPT or REVISE design only. No analytical runtime implementation,
source eligibility, consumer connection, merge or deployment is requested.**

## 1. Authority, continuity and recommendation

PR #106 development acceptance: comment 6134922968, exact accepted head
`949d7bac4f3df1718048a03846a83d56e6ac0ac1`. Research continues on separate branch
`engine11-es-calendar-interval-research-v1`, stacked on the V2 prototype. Accepted V1
modules and V2 runtime modules are unchanged. March 2020 through present remains the
initial acquisition target, not an approved PRIMARY wave origin or anchor.

**Recommendation:** approve the contract for an effective-dated, ES-specific calendar
registry and session-open-anchored elapsed-time analytical intervals. Preserve native
provider bars as source evidence; derive analytical intraday bars only from authentic,
calendar-compatible lower-resolution observations after binding and finality gates.
Keep open/closed segment membership explicit within each bucket. Do not select native
4h timestamp labels as analytical boundaries. This recommendation is a design choice
for Manager review, not an implemented or source-certified policy.

The evidence shows session-partitioned native records can share timestamp labels and
historical matching schedules changed. A calendar-led mapping avoids letting either
provider labels or today's schedule silently define historical structure. Missing source
proof remains UNAVAILABLE or QUARANTINED; no synthetic filling or alternate timeframe.

## 2. Primary exchange evidence and coverage limits

| Evidence | Established fact | Limit |
| --- | --- | --- |
| CME June 2021 Globex notice and SER-8788R, section 5 | Removal of 15:15–15:30 Central pause effective June 28, 2021 | Historical exceptions still needed |
| Linked affected-product list | E-mini S&P 500 futures, asset ES, included | Not a holiday calendar |
| CME chapter 358 | Chicago-time convention, general 17:00 session start / 16:00 close, exchange-defined trading schedule | Current rulebook is not a frozen 2020 rule set |
| CME trading-hours page | Product-specific holiday/regular schedules and changing notices are required | Retrieved page did not establish a complete dated ES 2020–2026 schedule |
| CME March 2020 delivery memo | Dated historical exchange document located | Retrieved delivery table did not establish ES H/M identity; no inference from other products |

The 2021 schedule change is evidence-backed and product applicability is explicit.
The full March 2020–present ES calendar is **not yet validated**. Historical holiday,
early-close, expiration and exceptional halt dates need product-specific official rows
and dated revisions. Generic federal holidays, clearing-only calendars, other exchange
products, current dynamic web text and price absence are not substitutes.

Source references:
- https://www.cmegroup.com/notices/electronic-trading/2021/06/20210621.html
- https://www.cmegroup.com/content/dam/cmegroup/notices/ser/2021/06/SER-8788R.pdf
- https://www.cmegroup.com/content/dam/cmegroup/notices/electronic-trading/2021/06/cme-equity-index-futures-options.pdf
- https://www.cmegroup.com/content/dam/cmegroup/rulebook/CME/IV/350/358/358.pdf
- https://www.cmegroup.com/trading-hours.html
- https://www.cmegroup.com/notices/clearing/2020/02/Chadv20-054.pdf
- https://massive.com/docs/rest/futures/contracts
- https://massive.com/docs/rest/futures/aggregates

No official holiday row is declared verified merely because a source URL was found.
The source ledger must archive original document bytes/digest, retrieval time, effective
dates, ES applicability and reviewer interpretation before registry acceptance.

## 3. Conflict classification and independent reconciliation

Prior authentic 2020 and 2026 4h comparisons exactly matched OHLC, volume and transaction
totals of same-session 1h children. This supports session-partitioned observations
sharing a UTC bucket label, not knowledge of vendor internals or a valid analytical 4h
interval. Evidence remains in PR #103 and the accepted source V2 proof packet.

New bounded script captures decoded original response-body bytes for pre/post June 2021
pause windows, 2020 spring/fall Sunday openings, 2026 maintenance, and the 2020 conflicting
minute/5m/10m/hour window. It reconciles native parents against same-session 1m children
with OHLC, volume and transaction counts. Matches and mismatches are both retained.
Provider timestamps and trading dates remain separate. Repeat observations do not
establish correction order or completion.

Classifications proposed:
- `DISTINCT_SESSION_SOURCE_BUCKET`: same provider timestamp/resolution, different
  session labels; preserve both observations and keys if authentic binding exists.
- `NATIVE_CHILD_RECONCILIATION_MATCH`: arithmetic agreement under a stated grouping;
  no claim of canonical calendar membership or underlying trade timestamp correctness.
- `NATIVE_CHILD_RECONCILIATION_MISMATCH`: quarantine pending missing-child, revision,
  query-snap, alignment or source-semantic evidence. Never silently adjust OHLC.
- `SESSION_LABEL_CLOCK_INCOMPATIBLE`: source label conflicts with approved exchange
  interval membership. Quarantine; never shift timestamp or trading date to fit.
- `SAME_KEY_CHANGED_CONTENT_UNCLASSIFIED`: preserve competing revisions; correction
  requires vendor indicators or independently approved correction/reconciliation policy.
- `UNKNOWN_SOURCE_ABSENCE`: no bar is not proof of no trading or exchange closure.

No DST, vendor bug, duplicate or late report cause is assigned without proof. A matching
same-session sum classifies an observable relationship, not causality. Full-year 2020
binding remains separate from source arithmetic and exchange contract-code conventions.

## 4. Calendar schema and effective-dated acceptance

Propose `engine11.es-calendar.v1`:
`calendarVersion`, exchange=CME, product=ES, IANA zone=America/Chicago, pinned tzdb
version, `effectiveFrom/To`, `knowledgeAsOf`, document receipts/digests, reviewer record,
coverage dates and unknown-date ledger. Version is a content digest of the immutable
registry and interpretation recipe; corrections append a version, never rewrite one.

Each session carries `sessionId`, exchange trading date, actual open/close UTC,
local Chicago labels/offsets, ordered disjoint matching segments, explicit maintenance/
pause/holiday/early-close/expiration/exceptional-halt segments, document references,
effective rules and validation state. PREOPEN/CLOSED/PAUSED are not matching intervals.
One session may cross UTC/local date boundaries. Holidays can change trading-date
conventions; use official assignment rather than a generic previous-day rule.

Calendar precedence: dated ES-specific exception overrides applicable dated baseline;
official historical amendments override earlier rule version only after their effective
date; an unresolved disagreement is a calendar blocker. The 2021 pause-removal boundary
must be retained. Do not treat the 2020 period as current uninterrupted matching hours.
Unscheduled halts/outages require an independent exception ledger, not inferred closure.

DST conversion uses pinned IANA rules, not fixed UTC-5/-6 arithmetic. Preserve actual
UTC instants and offset at every boundary, including spring/fall transitions. Phoenix
is presentation timezone only and must not define CME interval membership.

Evidence coverage is range-specific. A verified September 2026 ordinary session cannot
certify a holiday or 2020 session. Calendar partitions must cover the entire requested
range with OPEN/CLOSED/UNKNOWN segments; unknowns block only affected source intervals.

## 5. Alignment alternatives and chosen design recommendation

| Candidate | Benefit | Risk / acceptance requirement |
| --- | --- | --- |
| Native provider label intervals | Least transformation | Proven label collisions; undocumented identity/session clipping; not recommended as canonical |
| Fixed UTC buckets intersected with sessions | Simple UTC grid and consistent durations | Splits local-session structure differently with DST; needs session partitions and consumer agreement |
| Session-open anchored elapsed-time buckets with matching masks | Stable exchange-session relationship, explicit partials and closures | Requires authentic calendar, lower-resolution finality and independently validated aggregation |
| Accumulated trading-time buckets | Equal matching minutes | Joins time across pauses; changes wall-clock meaning and seven-degree interpretation; not recommended |

Recommend the third alternative for future prototype authorization. For 5m/10m/1h/4h,
nominal bucket starts are sessionOpen + k × duration, on the elapsed UTC timeline.
Bucket ends are clipped to accepted session close. Matching coverage is the intersection
with known OPEN segments; do not reset the grid or compress time when a pause occurs.
Terminal shorter buckets carry `PARTIAL_TERMINAL_SESSION_BAR`, actual elapsed/open
durations and nominal timeframe. Engine 22 must separately accept use of short terminal
bars; candle availability alone does not approve structural detector semantics.

A normal 23-hour session creates five full nominal 4h buckets and a three-hour terminal
bucket. The recommendation does not pretend that the terminal bucket has four hours.
An internal historical pause remains an explicit mask, not missing-trade filling. Unknown
calendar segments or ambiguous child membership quarantine the bucket. No cross-session
aggregation is permitted simply because native labels match.

Daily/session bars use verified session boundaries and trading date. Weekly candidates
use Monday–Friday exchange trading-date membership (subject to approval), monthly
candidates use exchange trading-date calendar-month membership, including sessions
opening in the preceding month. Use the registry's assigned dates, not 7/30-day periods.
Membership and holiday exceptions are versioned. Expiring contract fragments remain
raw contract periods, not complete continuous weekly/monthly market history. Rollover
selection/adjustment remain separately unapproved; no silent quarterly price combination.

## 6. Analytical contract, completeness and corrections

Propose `engine11.analytical-interval.v1`: seriesDefinitionId, full contract or approved
lineage version, priceBasis, timeframe, calendarVersion, alignmentPolicyVersion,
start/end UTC, session/trading-date membership, open-segment mask/durations, partial
status, source revision IDs, aggregation recipe, quality/finality evidence and as-of.
Preserve source observation/key/revision identities as separate provenance references.

Interval key pins series + lineage + basis + calendar + alignment + timeframe + boundaries;
revision pins all input revisions, values, recipe and completeness. Calendar changes
create a new dataset/interval policy, never repaint approved historical artifacts. Signed
cursors remain version/range/basis/policy/as-of pinned. Existing V1 readers/IDs stay intact.

Completion requires elapsed interval end, complete accepted calendar membership,
verified input contract provenance, successful bounded traversal, sufficient source
finality/watermark and explicit treatment of every expected matching interval. Price
close is final trade close, not settlement. Same-session sums prove arithmetic only.
Stable repeated values, observedAt, HTTP 200 or a historical date do not supply finality.

Absence decision table: accepted CLOSED mask → EXPECTED_CLOSURE; accepted OPEN plus
independent transaction/activity proof → VERIFIED_NO_TRADES; missing evidence → UNKNOWN
ABSENCE. Do not fabricate flat zero-volume candles. A no-trade interval may remain
absent while completeness metadata explains it, only under approved consumer semantics.

Source correction requirements: explicit original/replacement identifiers or accepted
revision ordering/watermark; immutable old/new receipts; source-key compatibility;
independent reconciliation where needed; correction reason/effective/observed timestamps.
If a source label changes, record explicit relabelling evidence instead of overwriting
the source key. All unidentified changed content remains competing candidates.

## 7. Source dependency and historical identity investigation

New 2020 metadata probes test short aliases, full-year ticker spelling and an unfiltered
ES product/date catalog. Empty or denied results remain negative observations, not a
fabricated contract mapping. CME delivery/code references cannot independently bind
the provider's archived instrument lineage without matching evidence. No paid catalog
or provider entitlement change is authorized. Additional vendor documentation or
authentic historical instrument records are an external dependency if lookups remain empty.

Holiday/early-close archive coverage has not been obtained for every year 2020–2026.
Therefore an authoritative all-year calendar cannot be delivered yet. The contract is
reviewable with an explicit unknown-date/source ledger; source acceptance remains on
hold until dated ES-specific documents and exceptional events are reconciled.

## 8. Regressions and proposed next development scope

Research tests cover Chicago DST transitions in 2020/2026, effective-date pause rule
separation, session-anchored terminal 4h partials, closure versus unknown absence,
elapsed-but-unfinalized periods and non-fixed month duration. These are design/clock
fixtures, not an implemented calendar or authentic holiday acceptance. Existing 158
source/foundation/research tests run alongside them. Native reconciliation artifacts
remain distinct from fixtures and retain original provider response bytes.

Required later acceptance matrix: ordinary and holiday sessions each year; pause removal;
both DST edges; maintenance; regulatory/operational halts; H/M2020 and U/Z2026 overlap;
all four intraday resolutions against authentic constituents; daily/session and weekly/
monthly membership; partial expiration/current periods; missing children/no-trade proof;
correction/as-of replay; interval identity/pinned paging; seven-degree independence;
frozen V1/runtime/trading/Replay/anchor/Fibonacci contracts.

Proposed next scope after design acceptance: a new unmounted calendar-evidence registry
and interval-membership diagnostic prototype, plus bounded authentic calendar-source
acquisition/reconciliation. No canonical publication or structural eligibility. Proposed
paths `services/core/logic/engine11/calendarEvidenceV1/` and
`services/core/logic/engine11/analyticalIntervalResearchV1/`; no coding of these modules
is authorized by this proposal. Preserve accepted source V2 modules and V1 modules.

Actual research paths are `services/core/tests/engine11/calendarResearch/`, workflow
`.github/workflows/engine11-calendar-interval-research.yml`, and this proposal/evidence
under `docs/architecture/`. Engine 22 structural mapping/sufficiency and short-bar
acceptance remain reserved decisions; all seven inputs stay proposed, not production
ratified. Missing higher-degree evidence never blocks independent lower-degree evaluation.

## 9. Acceptance request and protected boundaries

Engine 2B Lead Manager: ACCEPT or REVISE the calendar contract and session-open anchored
elapsed-time recommendation, including explicit segment masks and partial-bar states.
Please issue separate next prototype scope authorization if accepted. Calendar completeness,
source finality, correction semantics and 2020 binding remain later acceptance gates.
Formal Engine 22 Manager structural ratification is not assumed.

No production merges/deployments, accepted #102 module changes, Engine 22/frontend
integration, Elliott/Fibonacci changes, trading/account/execution/Journal/Replay changes,
adjusted continuous publication, paid infrastructure or provider purchases occurred.
Exact submission SHA, authentic runs, results and unresolved conditions are in the PR.

## 10. Authentic first-pass evidence and test result

Probe SHA `3ad24f9d6ee34346f9ea9904c0f587c77ba31682`:
https://github.com/bfrye1973/frye-market-backend/actions/runs/38325329705
Original decoded body-byte receipts/artifact:
https://github.com/bfrye1973/frye-market-backend/actions/runs/38325329705/artifacts/11780980924
Permanent log-derived summary: `ENGINE11_ES_CALENDAR_OBSERVATIONS_V1.json`.

June 25, 2021 returned 30 minute bars in the 45-minute sample; June 28 returned 45.
This is consistent with the dated pause removal and is not proof of every daily exception.
2020 spring Sunday opening first returned minute is 22:00 UTC; fall is 23:00 UTC.
The 2026 maintenance sample returned five minutes on each side of the break, none in
21:00–22:00 UTC. These are narrow observed windows, not full-year calendar certification.

At the March 2020 collision timestamp, 1m observations also carry two session labels.
All 18 sampled native 5m/10m/1h parent records matched same-session 1m OHLC, volume and
transaction totals. The ambiguity therefore survives at minute resolution: aggregation
alone cannot repair it. Source trading-date attribution remains unresolved without
trade-level/provider semantics or accepted historical calendar membership. Prior 4h
2020/2026 same-session 1h comparisons also matched. No timeframe substitution is proposed.

The short-code ESH0/ESM0 dated metadata queries returned one row each; full-year ticker
spelling returned zero, while the ES-wide date query returned 20 records. Counts alone
do not prove full-year binding. A follow-up records exact returned metadata and checks
settlement year/month, ES product, XCME venue and archived receipt dependency before
classifying binding. Earlier empty metadata receipts remain authentic negative evidence
of those earlier observations; no provider-change cause is assumed.

166 automated tests passed locally and in first-pass Node 20 CI: 158 prior plus eight
calendar/interval design regressions. Fixture timezone/alignment tests do not certify
exchange exceptions. Further authentic metadata and regression results are recorded
below and in the PR with their distinct commit provenance.

## 11. Historical metadata result and proposed binding extension

Follow-up SHA `5e2b72546911987454ba3b50e5132abeaf086512`:
https://github.com/bfrye1973/frye-market-backend/actions/runs/38325590125
Original byte-preserving provider artifact:
https://github.com/bfrye1973/frye-market-backend/actions/runs/38325590125/artifacts/11781016373
Permanent returned-metadata summary: `ENGINE11_ES_2020_METADATA_EVIDENCE_V1.json`.

ESH0 dated March 10, 2020 returns ES/XCME, first trade December 21, 2018, last trade
March 20, 2020. ESM0 returns ES/XCME, first trade March 15, 2019, last trade June 19,
2020. Both records report active=true and date=2020-03-10. Neither includes settlement_date.
The accepted V2 binding validator therefore correctly remains unresolved under its
current schema. The missing field is now an identified blocker; no nonexistent
settlement value is inferred. Earlier empty results remain separate historical receipts.

Propose an explicitly versioned alternate binding method:
`PROVIDER_LAST_TRADE_MONTH_YEAR_WITH_LIFESPAN`, preserving optional settlement separately.
Require one matching provider ticker/product/venue record in a complete dated catalog,
strict valid first/last trade dates, query/record date agreement, active/lifespan coherence,
last-trade month/year agreement with the proposed ES quarterly identity, and independent
historical exchange expiry/reference evidence before source acceptance. This is a
candidate full-year binding path, not a change to the accepted validator. Missing
independent expiry evidence keeps binding candidate/unapproved. A new binding version
must name its method and proof dependencies; it must not manufacture settlement_date.
Engine 2B must approve any subsequent V2 runtime change in a separate scope.

## 12. Calendar coverage ledger and immediate decision

| Year | Retrieved evidence in this research chain | Still unverified |
| --- | --- | --- |
| 2020 | Spring/fall native openings; H/M dated provider lifespans; native intraday conflicts | Complete ES holiday/early-close/halts/expiry calendar, accepted binding and source trade-date semantics |
| 2021 | Official dated pause removal and ES applicability; pre/post native minute windows | Complete year exception calendar |
| 2022 | Earlier native coverage observations only | Complete dated ES matching calendar |
| 2023 | Earlier native coverage observations only | Complete dated ES matching calendar |
| 2024 | Earlier native coverage observations only | Complete dated ES matching calendar |
| 2025 | Earlier metadata/native observations and source conflicts | Complete dated ES calendar including exceptional halts/outages |
| 2026 to observation time | Maintenance/roll-window native evidence and U/Z binding research | Complete dated ES holiday/early-close/calendar and finality acceptance |

Proposal can be reviewed now; historical source eligibility cannot be certified from
this partial ledger. Requested decisions are the calendar/interval design recommendation
and the alternate historical binding evidence method. The missing official all-year
archive and provider minute trade-date/correction semantics are genuine dependencies,
not invitations to fabricate a completed calendar. No new canonical runtime rules were
implemented. Next authorized scope should remain an unmounted evidence/membership
prototype with unknown-date guards and separately reviewed historical binding support.

Final verification: 170 tests passed locally (158 prior, eight calendar/interval design
tests and four archived authentic-result regressions). Final Node 20 CI and exact
proposal SHA are recorded in the draft PR submission. Authentic API results are pinned
to the two probe commits above; documentation-only commits do not re-run provider calls.
