# Engine 11 ES historical coverage and integrity research

**Current acquisition priority: March 1, 2020 through observation time.**
Project Owner direction relayed by Engine 22C on October 12 supersedes the initial
priority to investigate 2017 coverage. Earlier findings remain evidence; they are
not a current requirement to backfill to 2017. March 2020 is an approximate research
start, not an approved canonical PRIMARY W1 timestamp, price or anchor. Structural
warm-up or earlier history may still be requested separately by Engine 22.
Formal Engine 22 Manager ratification remains pending.

Stage authorization: Engine 2B Manager review on PR #102, comment 6134068011.
Accepted foundation remains pinned at `431d595eb4fabe1c19fe6059e7a420b361fe0e5f`.
Research branch: `engine11-es-history-integrity-research-v1`. No production change.

## Experiment

Point-in-time metadata queries test all 40 quarterly ES contracts for 2017–2026.
Settlement year must match the full identity before annual native-session observations
are accepted as belonging to that contract. Unverified older aliases are still queried
to distinguish metadata absence from aggregate absence, with attribution unresolved.
This avoids relying on a decade-reused short alias.
Annual samples count observed native session bars; these are not promised full coverage.
Ten bounded diagnostics test the documented 2017 limit, current maintenance/weekend
absence, a daylight-saving weekend, unsupported/legacy interval behavior, native session
semantics, real pagination exceeding 50,000 bars if available, and repeat observation.
Maximum 40 metadata requests, 40 one-page session requests and 14 diagnostic pages,
with at most three HTTP attempts per request. Existing credentials only; no purchases.

The JSON artifact and logs retain HTTP denial, empty data, unverified identity, truncated
pagination, malformed OHLC, duplicate/conflicting revisions, and unidentified gaps.
A successful workflow means research execution completed, not source acceptance.
Fixtures verify diagnostic behavior separately from authentic provider findings.

## Calendar and finality limits

CME Rulebook chapter 358 defines Chicago-time conventions and general 17:00 session
start / 16:00 close. Historical and holiday exceptions still require product-specific,
dated exchange schedules. The current general schedule is not certified for all years.
Daylight-saving tests verify clock conversion, not an exchange calendar.
CME's trading-hours page warns schedules can change and holiday schedules finalize
approximately two weeks beforehand. Clearing, repo and trading-floor schedules cannot
be substituted for ES Globex trading sessions.

Provider aggregates are trade-derived: an empty interval alone does not distinguish
exchange closure, no trades, unavailable entitlement or missing upstream history.
Unknown gaps stay `UNKNOWN_SOURCE_ABSENCE`. No inferred closure or synthetic filling.
Repeated historical values can establish observation stability, never immutable
provider finality. No source completion watermark is invented.

All outputs remain `ISOLATED_RESEARCH_ONLY`, `calendarAccepted=false`,
`coverageComplete=false`, `structuralEligible=false`, `sourceFinality=UNKNOWN`.
No canonical series, historical source acceptance, structural promotion or cutover.

## Primary references

- Manager: https://github.com/bfrye1973/frye-market-backend/pull/102#issuecomment-6134068011
- Provider native aggregates: https://massive.com/docs/rest/futures/aggregates
- Point-in-time contract metadata: https://massive.com/docs/rest/futures/contracts
- CME rulebook: https://www.cmegroup.com/content/dam/cmegroup/rulebook/CME/IV/350/358/358.pdf
- CME schedules: https://www.cmegroup.com/trading-hours.html

## Next source acceptance gate

Reconcile authentic artifact findings with dated ES exchange calendars, provider
entitlement and retention evidence, full contract metadata, source completion policy,
independent feed parity and no-trade evidence. Establish per-degree eligibility with
Engine 22; this stage cannot approve Elliott sources, anchors or Fibonacci changes.
Continuous history/adjustment publication, new paid infrastructure, consumer migration,
merge and deployment each remain outside this authorization.

## Authentic findings — October 12, 2026

Evidence commit: `6a7756be15d12a8e4cbf4b3f1ca75be1c4f90cb8`.
Authenticated run: https://github.com/bfrye1973/frye-market-backend/actions/runs/38319385077
Original JSON artifact (30-day retention): https://github.com/bfrye1973/frye-market-backend/actions/runs/38319385077/artifacts/11778330136
Permanent compact evidence: `ENGINE11_ES_HISTORY_RESEARCH_OBSERVATIONS_V1.json` beside this document.
The compact evidence is a diagnostic summary reconstructed from the authenticated job
logs, not an archive of all raw candles. Request and row digests are retained; credentials
and provider error bodies are not. The source observations occurred around 22:55 UTC.

| Experiment | Observed result | Acceptance limit |
| --- | --- | --- |
| 40 quarterly contract/year queries, 2017–2026 | 39 returned session bars; ESH2017 returned zero | Nonempty is not complete history |
| Full-year metadata | ESM/ESU/ESZ2025 and ESH/ESM/ESU/ESZ2026 verified | 33 queries lacked matching metadata; 32 had data anyway |
| Early session history | ESM2017 first window label April 2, with April 3 session end | Matches documented April 3 trading coverage; identity still unresolved |
| Pre-2017 diagnostic | ESZ6 query September–December 2016 returned zero | No verified 2016 identity; does not establish a universal provider limit |
| 1-minute ESU6, June 1–September 18, 2026 | 105,327 rows; 50,000 + 50,000 + 5,327 pages | Real pagination demonstrated, full coverage not certified |
| Pagination integrity | 0 duplicates, conflicting rows, malformed OHLC/tick/volume, ordering errors | Tests only returned data, not absent intervals |
| Spacing gaps | 1,413 internal gaps in large minute sample | Unknown absence; includes potentially sparse trading and expected closures |
| September 10 maintenance candidate | No rows 21:00–22:00 UTC; rows on either side | Consistent with general Chicago 16:00–17:00 break; not a ratified calendar |
| September 12 weekend sample | Zero rows | Empty aggregates alone cannot prove exchange closure |
| Spring DST sample | First row Sunday March 8 at 22:00 UTC | Consistent with Chicago 17:00 after DST; conversion tests are fixtures |
| Legacy `1day` versus `1session` | Same two rows and digest in bounded sample | One sample does not establish universal semantic equivalence |
| Repeat 10-minute history | Three rows identical across two observations | Stability is not completion evidence or provider finality |

### Session label and close-convention integration finding

The native session row labeled `2026-09-09T00:00:00Z` carries
`session_end_date=2026-09-10`. Its trade close is `7602`, while settlement is `7598.5`.
The next row has trade close `7660.75` and settlement `7659.5`.
The UTC-midnight source label is not the actual CME session-open instant. Any future
session adapter must preserve that exact source label while separately describing
real exchange boundaries and trading date. Completion cannot be inferred by treating
the label as session open and adding 24 hours. Trade close and settlement remain distinct;
no replacement of candle close, approved anchors or execution prices is authorized.
This is a source-adapter acceptance condition, not permission to change the accepted foundation.

### Research limits and next gate

This stage measured native session availability, not minute coverage for every older
contract. No 2017–2024 metadata matches were returned by these dated lookups. That is
an observed lookup limitation, not proof of a universal metadata-retention policy or
wrong entitlement. No entitlement denials occurred in these probes, but successful
requests do not certify contractual redistribution rights, exact plan or expenses.
The 2026 December metadata date was clamped to the observation date; a future metadata
snapshot would have produced a misleading unavailable result.

No provider completion/watermark field appeared in the returned aggregate fields.
The current ESZ2026 annual query includes the current session and remains provisional.
The entire result set keeps unknown finality and false calendar/coverage/structural
acceptance flags. There is no independent-feed parity or transaction-level no-trade
proof yet, and no complete dated holiday calendar has been accepted.

Engine 2B review requested for this research milestone and next source-verification
work: authentic older contract identity, dated CME calendar evidence, provider completion
policy, independent source parity and classification of absent intervals. Engine 22's
per-degree origin/warm-up/confirmation requirements remain later structural acceptance.
No additional architecture authority or production permission is inferred.

Validation: 112 local automated tests and GitHub Node 20 tests passed (99 foundation +
13 research). Both PR checks passed at the evidence commit; authenticated research
completed and uploaded negative findings. No production modules or routes changed.
Connected Render inspection found no service tracking the research branch and no PR
preview generation enabled. Production services continue to track `main`; no Render
mutation, merge or deployment was performed.

For deliberate future authenticated reruns, use a research-branch commit message
containing `[provider-research]`. Fixture checks continue on every branch push and
matching PR change; documentation updates do not repeat paid-provider requests.

## March 2020 seven-degree probe

Existing PR #103 now includes a separate bounded experiment (`liveMarch2020.mjs`),
triggered by `[march2020-research]`. It does not rerun the earlier 2017 investigation.
It queries 28 calendar-quarter windows through the current as-of and an explicit
ESM2020 March overlap alongside ESH2020, for seven independent native resolutions.
Each query is bounded to three pages of at most 50,000 rows, with existing credentials.
The current period is truncated at observation time and remains provisional.

Calendar-quarter windows are sampling boundaries, not canonical contract selection
or rollover dates. Raw contracts are not concatenated, adjusted or published. Cross-
contract gaps around expiration may need successor overlap evidence. This experiment
measures returned source coverage and does not certify a continuous ES series.
Native weekly and monthly queries remain independent of daily results. Missing or
unsupported inputs are recorded unavailable, without timeframe substitution.

The per-degree readiness report separately records nonempty/empty/failed windows,
returned counts, malformed rows, duplicates, conflicting revisions and internal gaps.
Completed-candle finality, dated calendars, full rollover lineage, contract attribution
and Engine 22 structural sufficiency remain gates before shadow source integration.
No detected candle or pivot can promote approved anchors or official Fibonacci.

### Authentic March 2020 results

Evidence commit `48992b9fe58b9dc50a6cddbcf2c4efc18efc500f`:
https://github.com/bfrye1973/frye-market-backend/actions/runs/38320799154
Full diagnostic artifact:
https://github.com/bfrye1973/frye-market-backend/actions/runs/38320799154/artifacts/11778736751
Permanent compact observations: `ENGINE11_ES_MARCH2020_OBSERVATIONS_V1.json`.

All 203 native queries completed; each degree returned data in all 29 sampling windows.
These counts include the intentional March H/M overlap, repeated source timestamps,
and incomplete current/expiration periods. They are not unique continuous-series counts.

| Degree | Native input | Returned rows | Windows with timestamp conflicts | Internal spacing gaps |
| --- | --- | ---: | ---: | ---: |
| SUBMICRO | 5m | 410,849 | 3 | 2,014 |
| MICRO | 10m | 205,683 | 3 | 1,866 |
| SUBMINUTE | 1h | 34,373 | 3 | 1,513 |
| MINUTE | 4h | 10,479 | 29 | 290 |
| MINOR | session | 1,452 | 0 | Not measured without dated calendar |
| INTERMEDIATE | weekly | 295 | 0 | Not measured without dated calendar |
| PRIMARY | monthly | 81 | 0 | Not measured without dated calendar |

No malformed OHLC/tick/volume or nonmonotonic ordering was detected in these samples.
Conflicting same-timestamp rows were retained as diagnostic findings. A green workflow
means the research ran and recorded findings, not that these sources passed acceptance.
No conflicting rows are published or silently deduplicated. Existing raw acquisition
continues to fail closed on conflicting revisions; its runtime code was not changed.

Both ESH2020 and ESM2020 returned native evidence in the March transition window.
Neither overlap establishes an approved roll instant, adjustment amount or PRIMARY anchor.
Weekly/monthly bars remain raw individual-contract periods; an expiring contract's final
week/month is not automatically a complete continuous-market period. Current bars remain
provisional independently of earlier periods.

**Seven-degree shadow readiness: diagnostic evidence available; structural-source
integration NOT READY.** Blocking evidence conditions include timestamp/alignment
conflicts, older full-contract identity, rollover selection/lineage, completed-candle
policy, dated calendars, unresolved gaps and per-degree Engine 22 sufficiency.
No unavailable degree blocks independent review of another degree.

### Reproduced 4h source identity collision — Manager decision required

Focused research commit `2a0af1c76287e6f70b06547f5134c7c80f4e34dc`:
https://github.com/bfrye1973/frye-market-backend/actions/runs/38321041011
Full conflicting raw rows:
https://github.com/bfrye1973/frye-market-backend/actions/runs/38321041011/artifacts/11779191611

ESH0 native 4h rows share `window_start=1583784000000000000` but have session end
dates March 9 and March 10, 2020, different OHLC, transactions and volume. ESU6
reproduces the same issue in September 2026. This is evidence of a source bucket
collision across session labels, not evidence that one row corrects the other.
The accepted foundation rejects conflicts; it was not changed to bypass that rejection.

**Escalation to Engine 2B Lead Manager:** review whether the next raw schema must
include an explicit provider session/bucket discriminator and how validated 4h
analytical inputs should align to exchange sessions. A source-specific identity
extension or an independently validated lower-resolution aggregation requires design
review; neither native 4h selection nor an aggregation methodology is authorized here.
Preserve original timestamps and all conflicting raw payloads. Do not snap timestamps,
choose a winner, silently merge sessions or promote these rows to Engine 22 shadow input.

The follow-up reproduced smaller-timeframe collisions as well:
https://github.com/bfrye1973/frye-market-backend/actions/runs/38321193041
Artifact: https://github.com/bfrye1973/frye-market-backend/actions/runs/38321193041/artifacts/11778472401
Permanent conflicting native rows: `ENGINE11_ES_SOURCE_COLLISION_OBSERVATIONS_V1.json`.
ESH0 5m and 1h share a timestamp across March 2/March 3 session labels; ESH5 5m
shares a timestamp across January 30/January 31 labels. Narrow DST-only samples did
not reproduce these cases; the original query windows did. No cause such as DST,
provider correction or exchange halt is assigned without further evidence.
The session-aware identity review therefore covers intraday source evidence generally,
not just 4h. Ten-minute conflicts remain recorded in the broad seven-degree experiment.

117 local and GitHub automated tests pass, including source-label collision diagnosis.
Authentic research findings remain negative acceptance evidence even with green CI.
