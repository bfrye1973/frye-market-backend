# Engine 11 ES historical coverage and integrity research

Stage authorization: Engine 2B Manager review on PR #102, comment 6134068011.
Accepted foundation remains pinned at `431d595eb4fabe1c19fe6059e7a420b361fe0e5f`.
Research branch: `engine11-es-history-integrity-research-v1`. No production change.

## Experiment

Point-in-time metadata queries test all 40 quarterly ES contracts for 2017–2026.
Settlement year must match the full identity before annual native-session observations
are attributed to that contract. This avoids relying on a decade-reused short alias.
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
