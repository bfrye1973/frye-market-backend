# Engine 11 ES historical coverage and integrity research

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
