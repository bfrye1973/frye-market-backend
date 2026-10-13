# Engine 11 — source verification, evidence tier and chart handoff V1

October 13, 2026. Development acceptance request to Engine 2B Lead Manager.
Authority: PR #121 Manager comment 6151907952. Stacked isolated branch: `engine11-source-verification-chart-handoff-v1`. Research only; no source acceptance, consumer integration, storage transfer, merge or deployment.

## Delivered

1. A separate additive historical identity evidence tier. It imports protected V2 receipt verification without editing accepted modules. ESZ2024 original payload evidence yields provider ticker ESZ4, lifespan June 4, 2021–December 20, 2024, **settlementDate:null**. Its two preserved observation references remain UNRESOLVED. Exact content digest and evidence-tier identity pin the original metadata and sample observation records. Append-only evidence never replaces V2 bindings; no independent December 2024 expiration corroboration was obtained. This tier is not a verified contract.
2. Versioned read-only coverage/confidence metadata. Receipt capture timestamps and immutable body digests are pinned; capture-vector provenance is explicitly not an atomic as-of snapshot. New captures cannot be called corrections merely because their content differs. Full period edges, approved calendars and source finality remain distinct requirements for every timeframe.
3. Executable replay of authentic archived source evidence. `buildHistoricalEvidence.mjs` verifies the original 74,028,287-byte corpus SHA and every original HTTP-body digest before producing the ESZ2024 tier and provenance report. Executed locally against the original 128-receipt corpus and original finality receipts. This does not constitute durable preservation.
4. A read-only live Engine 22/chart source capture and exact compatibility handoff. Only selected Engine 22/overlay fields and candle resolver metadata are persisted; the dashboard's trading/accounts/journal payload is not archived. All requests are GET. No Fibonacci calculations or renderer modifications occur.
5. One consolidated private-archive decision and source escalation bundle, below. No private data was transferred to a new destination.

## Source readiness, independently by timeframe

The accepted original acquisition remains sampled quarterly/successor windows, **not exhaustive uninterrupted two-year coverage**. The new report pins this limitation. No new provider resolution or calendar certification is asserted by replaying those receipts.

| Degree | Native timeframe | Captured in target range | Verified canonical | State |
|---|---|---:|---:|---|
| SUBMICRO | 5m | 170,991 | 0 | Source/calendar acceptance unavailable |
| MICRO | 10m | 86,040 | 0 | Source/calendar acceptance unavailable |
| SUBMINUTE | 1h | 14,416 | 0 | Source/calendar acceptance unavailable |
| MINUTE | 4h | 4,392 | 0 | Source/calendar acceptance unavailable |
| MINOR | daily/session | 608 | 0 | Period/calendar acceptance unavailable |
| INTERMEDIATE | weekly | 125 | 0 | Period/calendar acceptance unavailable |
| PRIMARY | monthly | 32 | 0 | Period/calendar acceptance unavailable |

276,604 observations: COMPLETE 0, PROVISIONAL 4, UNKNOWN 275,622, QUARANTINED 978. Quarantined source observations are retained. Two years is not structural sufficiency approval for any degree. No degree is promoted; unavailable degrees cannot suppress other degrees. Older March 2020 research is preserved and deferred.

## Remaining authentic-source conditions and reproducible escalation

Use the preserved source reproduction ledger `evidence/engine11-provider-request-ledger-v1.json` and approved support wording `ENGINE11_PROVIDER_SUPPORT_INQUIRY_DRAFT_V1.md`. The escalation package is prepared; no external provider message was sent in this milestone.

| Condition | Actual evidence | What would resolve it |
|---|---|---|
| January 30/31, 2025 session label transition | ESH5 trade timestamps 1738274136387378265 and 1738274136407828355 differ by 20,450,090ns; preserved minute fragments reproduce from same-session trade groups | Dated provider explanation of trading-date semantics, timestamp labels and correction policy plus approved calendar reconciliation |
| Aggregate filtering | Aggregate documentation does not specify `session_end_date` request filtering; the corresponding trade filter worked | Official aggregate filter semantics; do not assume a provider defect from unsupported filtering |
| Calendar coverage | 732 dates: 390 candidate, 332 no events, 2 incomplete and 8 holiday pre-open semantic uncertainties | Authentic complete schedule/calendar evidence, including holiday closures/early closes; empty API results cannot certify closure |
| ESZ2024 | Original provider record identifies ES/XCME lifespan, absent settlement | Independent dated ES-specific expiration corroboration and reserved source acceptance; alternative tier remains research only |
| Completed candles | Arithmetic and stable re-fetch demonstrate consistency but no completion watermark/correction authority | Provider finality/revision evidence and accepted completed-candle policy |
| Weekly/monthly | Native acquisitions exist; incomplete window/constituent/calendar evidence remains | Entire approved period guards, constituent completeness, calendar and finality verification |

The previous direct CME Actions requests returned 403. Current rolling tables cannot prove a December 2024 contract expiration. Neither modern schedules nor elapsed wall time is substituted for missing historical evidence. Further resolution requires authoritative external evidence, not repeated identical probes or treating an absence as a holiday.

## Exact Engine 2B / Engine 22 handoff

Inspected branch `engine2b-chart-overlays-v1` paths:

- `services/core/routes/engine2ChartOverlays.js`: reads runtime `services/core/data/strategy-snapshot-es.json`; GET `/api/v1/engine2/chart-overlays/v1?symbol=ES` with ETag/cache controls.
- `services/core/logic/engine2/buildEngine2ChartOverlayV1.js`: first four displayed degree models come from `strategies["intraday_scalp@10m"].engine22WaveStrategy.degreeStates.{primary,intermediate,minor,minute}.activeFibModel`, only active models. Micro source is `currentWavelength.degrees.micro.levels`; prior projected W1/W2 references are separate FIB_CONTEXT with referenceOnly true. V2 shadow references do not supply official Fibonacci authority. No subminute substitution.
- `services/core/routes/futuresOhlc.js`: existing core GET `/api/v1/futures/ohlc?symbol=ES&timeframe=10m&limit=3&debug=1` exposes resolver evidence. Normal response is an array and omits contract metadata. Existing route normalizes/deduplicates timestamps and uses timeframe lookbacks; none of these behaviors is changed here.

Authentic GitHub Actions capture at commit `d3ab3fb88ceb8bdcabbaed10762283b94ddc14e1`, run **38445477293**, artifact **11837168951** (ZIP SHA `d182409554156e2181ca6d23f88cb1a20ac270e6e0e5c6467900649a4363f83f`):

- Core snapshot and preview overlay GET: HTTP 200.
- Core OHLC debug GET: HTTP 200, 3 bars, 10min, resolvedSymbol ESZ6, `env_contract_override`, request window September 29–October 14, 2026. This establishes the route's current short ticker, not complete full-year immutable lineage or official anchor-basis compatibility.
- Preview API OHLC GET: HTTP 404. Engine 2B must establish the chart's actual candle endpoint/proxy and resolver identity. No route was added.
- Observed active Intermediate extension values match the preview: 8369.50, 8903.25, 9582.25, 10332.00, 11544.75 with published alias keys. No values recalculated or adjusted.
- Primary/Minor/Minute active models were inactive in this capture. Micro active level list was empty; preview displayed prior W1/W2 context separately. No prior reference is relabeled current approved Fib.
- Overlay `snapshot.authorityConflict:true`, null generatedAt/sourceTimestamp and null sourceCountId for Intermediate/Micro. Engine 22 must reconcile the published conflict and certify applicable official count/source identity; Engine 11 cannot resolve Elliott truth.
- `priceBasis:ES_INDEX_POINTS` denotes units, not RAW_CONTRACT/adjusted series. Both actual anchor basis and applicable chart contract must be explicitly reconciled by Engine 22/Engine 2B. A research fixture proving the guard is not a real approval record.

Read-only Render verification found core deployment `d0781ecd5448ca74009f069d79f39b3a5c32f9d5` completed at 18:18:02Z **after** the 18:17 probe. Another teammate's changes must not be represented as Engine 11 work. Captured evidence is dated, not proof of the post-deployment snapshot. Engine 2B must revalidate the exact payload/version it will display. The immutable probe hash remains usable for comparison.

### Engine 2B acceptance tests to execute under its chart authority

T24: historical zoom/scroll/pagination retain visible time range, pinned source version, stable candle identities and deterministic page boundary deduplication; no unrequested history expansion.

T25: stale page and stale overlay responses arriving after a symbol/timeframe/version change cannot modify the new view; live candle updates cannot race historical commits. Match contract/basis/calendar/finality metadata at history/live boundary.

T26: 25,000 bars remain a deterministic cap with eviction that preserves viewport/overlay references; measure retained memory and test repeated navigation. Engine 11 has specified this test, not claimed browser execution.

T27: displayed numeric Fibonacci values, approved timestamps/precision/locks and source identities match the exact accepted Engine 22 payload. Keep context-only and shadow values clearly distinct; require explicit compatible chart basis. Changing candle source cannot move approved anchors. ETag/304 cache use must not retain obsolete count/version; independently reversible chart rollback.

These requirements do not wait for canonical two-year history. Their source/basis/authority gates still apply to the faster existing-data preview.

## Private evidence preservation decision

Candidate primary: owned Library `/Frye Dashboard 2`, folder ID `6a4ff35787748191b77c8aac9fc6884f`. Ownership was visible; available capacity (minimum 100MiB), custodian/access matrix, retention/deletion policy, and source-license permissions remain unverified. Folder ownership alone cannot prove private archival suitability.

Independent backup: **no actual independently located private destination was verified**. The two sandbox/Actions copies share ephemeral infrastructure and do not qualify. Visible private-repository search did not find a backup; it is not proof none exists elsewhere. Render `/var/data/replay` is excluded, and no new storage or paid commitment is proposed as authorized.

Transfer HOLD. Lead Manager must coordinate a named primary and independent backup with verified remaining capacity, private access, custodian, lifecycle, source-data rights, restore test policy and explicit destination approval. Then transfer authorization must precede bytes. Original artifact retention expires November 12 01:46:58Z (November 11 18:46:58 Phoenix); earliest retained evidence expiry is November 11 18:00:11 Phoenix. Do not call local hash replay permanent preservation.

## Exact additive paths and validation

- `services/core/logic/engine11/evidenceTierResearchV1/{alternativeIdentity,coverageLedger,chartHandoff}.js`
- `services/core/tests/engine11/evidenceTierResearch/{evidence.test,liveHandoff,buildHistoricalEvidence}.mjs`
- `.github/workflows/engine11-evidence-tier-handoff.yml`
- This report and three compact JSON evidence reports in `docs/architecture/evidence/`.

All runtime imports are one-way from the separate research namespace. Accepted #102/#106 modules and production routes, renderer, execution, journals, Replay and protected Elliott/Fibonacci evidence are untouched. No canonical publication or adjusted series is provided.

Tests: 321 inherited tests plus 21 new tests = **342**. New tests cover immutable evidence and null settlement, incorrect full-year collisions, receipt tampering, revision semantics, seven independent period guards, no shadow/subminute substitution, unchanged prices, missing basis, empty Micro levels and published authority-conflict blocking. Authentic archived payload replay and live GET capture are separately evidenced; passing unit tests is not source acceptance.

## Consolidated Manager action

Request **ACCEPT or REVISE** for this additive development milestone. External conditions are authoritative provider/calendar/finality evidence, independent December 2024 corroboration, verified private destinations and actual Engine 2B/Engine 22 preview compatibility. No production approval requested. Route coordination through Engine 2B Lead Manager; the project owner should not shuttle routine technical questions. Formal Engine 22 Gate 1 ratification remains unverified.
