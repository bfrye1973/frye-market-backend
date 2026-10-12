# ENGINE 11 — CANONICAL ES CANDLE IDENTITY & SESSION ALIGNMENT — REPAIR PROPOSAL V1

Engine 11 → Engine 2B Lead Manager. October 12, 2026. **Requested ruling: ACCEPT or REVISE the design. No runtime schema change or production approval requested.**

## 1. Authority and baseline

Continue PR #103, stacked on accepted PR #102 at `431d595eb4fabe1c19fe6059e7a420b361fe0e5f`.
Initial acquisition target is March 2020 through the present, including H/M 2020 overlap.
March 2020 is not a canonical PRIMARY W1 anchor. The seven proposed independent inputs
remain 5m / 10m / 1h / 4h / session / weekly / monthly. Formal Engine 22 Manager Gate 1
ratification remains pending. Design approval and later source acceptance are separate.

## 2. What is proved and what is unresolved

Authentic evidence is in `ENGINE11_ES_SOURCE_COLLISION_OBSERVATIONS_V1.json` and
`ENGINE11_ES_MARCH2020_OBSERVATIONS_V1.json`, with immutable commit/run provenance.
Broad research run 38320799154 at `48992b9` returned data for all 203 queries. Focused
run 38321193041 at `b2661bd` preserved actual contradictory source payloads.

- ESH0 4h: timestamp `1583784000000000000` appears with session dates March 9 and
  March 10, 2020, different OHLC, volume and transaction counts.
- ESU6 4h: timestamp `1788984000000000000` appears with September 9 and September 10,
  2026 session dates. The first closes at 7648 with volume 37,522; the second closes
  at 7652 with volume 7,678.
- ESH0 5m and 1h: `1583269200000000000` appears with March 2 and March 3 labels.
- ESH5 5m: `1738274100000000000` appears with January 30 and January 31 labels.
- Ten-minute conflicts are recorded in the broad experiment; exact native examples
  have not yet been independently isolated in the focused probe.

**Proved data-model defect:** a key made solely from provider/full contract,
resolution, timestamp and alignment cannot distinguish all returned session-labelled
rows. This is an insufficient uniqueness assumption, not proof of provider misconduct.
Distinct session labels must not be interpreted as content revisions of one candle.

**Unresolved causes:** exact vendor grouping semantics, late trade assignment,
correction/republication rules, historical exchange exceptions and smaller-timeframe
session labels. DST, duplicates, exchange halts and vendor defects are not established
causes. 4h UTC bucket sharing is a hypothesis tested by same-session 1h reconciliation;
matching aggregation supports it but cannot prove the vendor's internal algorithm.
March/September contract overlap is legitimate and distinct from same-contract collisions.

## 3. Two identities and a separate observation receipt

Propose `engine11.source-observation.v2` as immutable acquisition evidence, with:
provider + endpoint/API schema + receipt ID + page number + row ordinal + response byte
digest + original row byte span/digest + exact original payload. Preserve integer
nanosecond text losslessly, provider ticker, resolution, session label, unknown fields,
request filters, observedAt and provider watermark if supplied. Credentials are never
part of evidence URLs. A receipt is not a source completion watermark.

`sourceObservationId = H(v2, receiptId, page, ordinal, rowBytesDigest)` preserves every
occurrence even when identical payloads repeat. Content-addressed payload storage may
deduplicate bytes while retaining separate receipt references. The current JSON parser
preserves numeric timestamp precision but does not archive original byte slices; a later
approved capture implementation must store response bytes and parsed representations
separately. Reconstructed job-log payloads are labelled as such, not original HTTP bytes.

Propose `engine11.source-candle-key.v2`, only after contract binding is verified:
`H(provider, providerInstrumentId, fullContractIdentity, sourceResolution,
sourceWindowStartNs, sourceSessionEndDate, providerAggregationPolicyVersion)`.
The session label is a source discriminator, not an approved calendar interval.
Missing labels or ambiguous contract metadata produce unresolved identity, not a guessed
date. Before binding, observation identity remains receipt-scoped; a candidate full year
and a decade-reused short ticker cannot establish a globally stable candle key.

`sourceRevisionId = H(sourceKeyV2, rawPayloadContentDigest)` records distinct content.
Different content under one key is `SAME_KEY_CHANGED_CONTENT_UNCLASSIFIED` until a
documented correction indicator or approved vendor/as-of reconciliation policy resolves
it. Arrival order alone never chooses a canonical winner. Equal content is idempotent
payload evidence; every separate observation receipt remains preserved. Changes to a
session label require an explicit source relabelling relation if proved, not a silent
key update. Optional `supersedesRevisionId` requires evidence and remains append-only.

Propose `engine11.analytical-candle.v2` for validated intervals, separately:
`canonicalCandleKey = H(seriesDefinitionId, contractLineageVersion, priceBasis,
timeframe, calendarVersion, alignmentPolicyVersion, intervalStartUtc, intervalEndUtc)`.
The key never uses a vendor label as an interval boundary without proof. Its revision
adds OHLCV, source revision IDs, recipe version, coverage/finality evidence and quality
state. A derivation DAG records all contributing raw evidence and any exclusions.
One source observation may support a partial interval or be unusable; preservation does
not imply eligibility. Multiple incompatible candidates quarantine the interval.

Raw and adjusted basis are different series definitions. Adjustment methodology,
roll schedule and factor lineage would be pinned if separately approved; no adjusted
series is authorized here. Legitimate quarterly contracts retain separate identities.

## 4. Interval policy and calendar evidence

Calendar registry proposal: exchange/product, `America/Chicago`, pinned IANA tzdb,
effective date range, immutable dated exchange document digest, session trading date,
explicit OPEN/PAUSED/CLOSED segments, maintenance, early close and exceptional halts.
Holidays require ES Globex product-specific evidence. Federal calendars, clearing
notices, repo schedules or exchange-floor times cannot stand in for Globex matching.
Registry amendments create a new version; historical derived datasets are not rewritten.

CME chapter 358 describes Chicago-time conventions and generally 17:00 session start
and 16:00 close. The official trading-hours page provides changing/dated holiday
schedules. These references establish a research baseline, not a complete 2020–2026
calendar. Rules must be effective-dated; current hours cannot be projected backward
without evidence. DST conversion is pinned by tzdb and tested both spring and fall.
Regulatory halts, holiday exceptions and expiration truncation require distinct evidence.

Intraday canonical alignment alternatives for Manager review: session-open anchored
buckets intersected with approved open segments, or fixed UTC buckets with explicit
session partitions. Neither is selected here. Native 4h rows must not be silently
concatenated across a closure or treated as complete four hours of trading. Selection
must include cross-midnight/session behavior, terminal short bars, DST and halt rules.
An independently validated aggregation from authentic lower-resolution evidence is a
research candidate; it is not an approved replacement for native 4h.

Session candles use verified session open/close and trading date. Provider midnight
date labels remain separate from real exchange times. Trade close and settlement stay
separate. Weekly/monthly membership is defined by accepted trading-date calendar and
explicit week/month policy, not arbitrary 7/30-day durations. Holiday-shortened periods
and expiring contract fragments remain distinguishable from a full analytical period.

Completion requires both elapsed accepted interval end and source finality/watermark
or an independently accepted completion policy. A stable repeated fetch, HTTP 200,
last historical timestamp or observedAt is insufficient. Use PROVISIONAL, COMPLETE,
UNAVAILABLE and QUARANTINED with explicit reasons. No-trade classification needs
separate activity evidence; empty aggregate intervals remain unresolved otherwise.

## 5. Dataset, paging and migration proposal

Propose `engine11.source-dataset.v2` immutable manifests containing observation receipts,
binding versions, source key/revision versions and classified ambiguity. Propose
`engine11.analytical-dataset.v2` manifests pinning calendar, alignment, series definition,
lineage, recipe, revisions, finality and eligibility evidence. Manifest digest is the
dataset version; firstObservedAt and as-of receipt constraints remain mandatory.

Existing v1 datasets and cursors remain readable by their v1 reader. No in-place ID
translation, hash rewrite or latest-version fallback. Append explicit v1→v2 correspondence
records, possibly one-to-many or unresolved. A v1 timestamp collision cannot be repaired
by inventing one-to-one mappings. Reretrieve missing observations under a new receipt.

Source pagination sorts by full composite identity: contract + source timestamp +
session discriminator + resolution + source key + revision ID + observation ID as needed.
Analytical pagination sorts by interval start + end + canonical key + revision ID.
Versioned authenticated cursors pin identity schema, dataset, series, price basis,
calendar, alignment, lineage, as-of, range and finality filter. Ties spanning page
boundaries must return all records once; retries are deterministic. Separate source
research and analytical read endpoints prevent accidental source/canonical mixing.
No live route changes or cutover are included in this proposal.

## 6. Engine 22 shadow compatibility

PR #97's `ES:timeframe:timestamp` identifiers cannot certify source lineage. A future
separately authorized adapter should supply canonical key, analytical revision and
dataset version, complete price basis/contract lineage/calendar/alignment/finality,
and source revision IDs. Keep original provisional IDs in an explicit alias record,
never present aliases as complete identities. Node evidence IDs must pin dataset and
candle revisions. A changed input dataset invalidates/recomputes shadow evidence under
a new run version, never reassigns an approved anchor or official Fibonacci level.
Engine 22 decides degree sufficiency, structural detection and promotion. An unavailable
degree stays unavailable independently. Engine 27 remains a read-only consumer.

## 7. Exact affected paths — proposed, not authorized runtime edits

| Existing GitHub path | Proposed later change after schema approval |
| --- | --- |
| `services/core/logic/engine11/rawCandles/identity.js` | Retain v1; add explicit version dispatch or separate v2 module |
| `services/core/logic/engine11/rawCandles/provider.js` | Archive receipt bytes, session-discriminated observations; preserve v1 acquisition behavior |
| `services/core/logic/engine11/rawCandles/normalize.js` | Source binding/revision classification separate from analytical normalization |
| `services/core/logic/engine11/rawCandles/calendar.js` | Dated calendar and approved interval-policy adapter |
| `services/core/logic/engine11/rawCandles/store.js` | Append-only v2 namespaces/manifests and binding correspondence |
| `services/core/logic/engine11/rawCandles/reader.js` | Separate version-pinned composite cursors; retain v1 reader |
| `services/core/tests/engine11/` | New version-specific source/analytical regression suites |
| `services/core/logic/engine22/v3/buildIndependentNodeShadow.js` (PR #97) | Future version-pinned candle evidence adapter; Engine 22 owns any separately authorized integration |
| `services/core/tests/engine22V3IndependentNodeShadow.test.js` (PR #97) | Future alias/lineage and nonpromotion regressions; no edits authorized here |

Possible new isolated modules: `services/core/logic/engine11/sourceObservationsV2/`
and `services/core/logic/engine11/analyticalCandlesV2/`. These extend the existing shared
pipeline; they are not competing historical systems. Storage topology remains deferred.
Actual changes in this stage are restricted to research scripts/tests, the existing
research workflow, this proposal and evidence JSON in `docs/architecture/`.

## 8. Required acceptance regressions

1. Authentic same timestamp/different session rows survive as distinct source keys;
   missing/changed labels remain explicit ambiguity. Identical repeats retain receipts.
2. Same source key/changed content preserves both candidate revisions; no arrival-order
   winner without correction evidence. Contract metadata relabelling is append-only.
3. Full-year contracts cannot collide across quarters or decades. Unverified metadata
   never produces accepted global source identity; integer nanoseconds remain exact.
4. Approved 2020/2026 sessions, spring/fall DST, maintenance, holidays/early closes,
   expiration, halts, cross-session native 4h and terminal partials match authentic data.
5. Weekly/monthly membership reproduces approved trading-date policy, partial/current
   periods remain provisional; no silent timeframe substitution or missing-bar filling.
6. Native-versus-child OHLCV/count reconciliation records both matches and mismatches;
   fixtures are distinct from authentic exchange/provider evidence.
7. v1 readers/IDs remain unchanged; one-to-many mappings and cursor ties survive restart,
   retry, corrections, dataset/calendar upgrades, tampering and as-of restrictions.
8. Engine 22 shadow aliases cannot promote official counts/anchors/Fibonacci; frozen
   chart paging, live/history basis and protected trading/Replay contracts remain intact.

Design fixture tests exercise receipt separation, session/quarter identity, candidate
revisions, resolution/precision and analytical policy/version isolation. These tests
demonstrate proposal invariants only, not source sufficiency or a runtime implementation.

## 9. Manager gate and boundaries

Please ACCEPT or REVISE: separation of observation/source/canonical identity; explicit
session discriminator and unresolved-binding behavior; append-only candidate revisions;
versioned calendars, interval policies, datasets and cursors. Calendar alignment and
vendor correction policy may remain unresolved acceptance choices even if the model is
accepted. Request separate authorization before modifying PR #102 runtime identity.

Production routes/streams, consumers, trading contract selection, execution, risk,
stops/targets/sizing, PAPER/REAL accounts, journals, Replay history, Engine 26 geometry,
approved Engine 22 anchors/counts/Fibonacci and V3 promotion remain untouched. No merge,
deployment, provider plan change, infrastructure spending or adjusted publication.

## Primary sources and evidence

- https://massive.com/docs/rest/futures/aggregates
- https://www.cmegroup.com/content/dam/cmegroup/rulebook/CME/IV/350/358/358.pdf
- https://www.cmegroup.com/trading-hours.html
- https://github.com/bfrye1973/frye-market-backend/pull/103
- Authentic March 2020 research: run 38320799154, commit `48992b9fe58b9dc50a6cddbcf2c4efc18efc500f`.
- Authentic collision reproduction: run 38321193041, commit `b2661bdd85dcfa08dc2f17783d80e9d27ebe5be1`.
- Alignment reconciliation probe commit: `8117dfb5f78cc2319ca12a207d0419741715beb0`; results recorded below after CI.

## 10. Authentic alignment reconciliation and test record

Run https://github.com/bfrye1973/frye-market-backend/actions/runs/38322118778
Artifact https://github.com/bfrye1973/frye-market-backend/actions/runs/38322118778/artifacts/11778943282
Permanent full parsed response payloads: `ENGINE11_ES_ALIGNMENT_RECONCILIATION_V1.json`.
These JSON payloads are reconstructed from CI logs; original HTTP byte streams were
not archived by this experiment and are not represented as such.

In both March 2020 and September 2026, each of the two conflicting native 4h rows
matched the OHLC, volume and transaction total of its same-session 1h children.
The previous-session row matched one hourly child; the next-session row matched two.
This supports session-partitioned aggregation inside a shared UTC bucket label. It
does not prove vendor implementation, smaller-timeframe anomaly cause, correction
rules, full calendar or structural completeness. Preserve both session-labelled rows.

125 local automated tests passed: 117 prior tests plus eight new design invariants.
The authenticated alignment job passed; findings are evidence, not source acceptance.
Final proposal/test commit and CI run are identified in the PR's approval request.
