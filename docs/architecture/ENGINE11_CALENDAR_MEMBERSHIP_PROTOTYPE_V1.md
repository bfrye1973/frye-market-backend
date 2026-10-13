# Engine 11 — Calendar & Interval Membership Prototype V1

Authorized by Engine 2B Manager PR #108 comment 6135569782. Separate branch
`engine11-calendar-membership-prototype-v1`, stacked on accepted `e688b251`.
This is unmounted research code; no production, consumer, V1 or source V2 changes.

## Implementation

New `services/core/logic/engine11/calendarEvidenceV1/registry.js` captures original
decoded document bytes/digests and explicit reviewer/product/effective-date scope.
Baseline rules, dated full-session evidence, dated expiry evidence and fixtures are
distinct. Generic reviewed rules cannot become complete dated session proof. Registry
identity pins documents, rules, actual Chicago-labelled UTC boundaries, tzdb, session
partitions, previous version and unknown-date reasons. Revision is append-only.
Unknown dates, baseline-only sessions, unknown segments, invalid partitions, timezone
mismatches, tampering or future evidence fail closed. Fixture evidence stays labelled.

New `services/core/logic/engine11/analyticalIntervalResearchV1/membership.js` creates
only research interval candidates for 5m/10m/1h/4h. It anchors elapsed UTC buckets to
verified research-session open, intersects segment masks, records open duration and
terminal partials, and leaves elapsed intervals pending source finality. No OHLCV,
week/month aggregation or eligible structural bars are emitted. Source start membership
requires receipt-bound V2 snapshot integrity, verified source key, matching session date
and a timestamp in an actual OPEN segment. Native source extent remains unverified;
labels outside their session are quarantined, never snapped or reassigned.

New `services/core/logic/engine11/calendarEvidenceV1/historicalBinding.js` is a separate
lifespan-based historical candidate method. It verifies preserved metadata, ES/XCME,
query-date/active/lifespan/month/year coherence and independently reviewed dated expiry
scope. No missing settlement is fabricated. Missing expiry proof remains UNRESOLVED;
even a corroborated result is only a research candidate with bindingAccepted=false.
It does not modify or bypass the accepted source V2 settlement-based binding validator.

All outputs remain ISOLATED_RESEARCH_ONLY / structuralEligible=false. Full calendar,
analytical publication, correction winners and Engine 22 terminal-bar use are not accepted.
These modules extend the shared Engine 11 pipeline rather than create a second history
system. Storage remains in-memory/serializable research evidence, not provisioned storage.

## Tests and authentic research

40 new tests cover document bytes and scopes, unknown-date rejection, complete partition,
Chicago DST, June 2021 boundary, policy revision/as-of, interval masks/partial/early-close
fixtures, snapshot/source quarantine, overlapping contract identities, independent expiry
requirements and authentic archived 2020 metadata. Initial combined local suite: 210
passing tests (170 prior + 40 new). Fixtures are not authentic holiday schedules.

New live script `services/core/tests/engine11/calendarPrototype/livePrototype.mjs` makes
three bounded public CME PDF requests and two historical provider metadata queries using
existing credentials. It archives successful original decoded body bytes and digests;
HTTP denial or incorrect content stays explicit unavailable evidence. The dated pause
rule can be registered as baseline evidence only when both the notice and ES product
applicability documents are captured. Current rulebook capture stays bibliographic.
It does not infer a complete historical calendar from those documents.

Twenty date/timeframe membership checks must remain unavailable without complete dated
ES session/exception proof. 2020 lifespans remain unresolved without independent expiry
corroboration. The artifact records the entire March 2020–observation-date unresolved
complete-calendar range alongside baseline evidence, preventing sparse observations from
being advertised as all-year validation. Earlier native conflict and finality studies
remain preserved in PR #103/#108; this job does not repeat multi-year price acquisition.

## Remaining conditions and acceptance request

Need authoritative dated ES holiday/early-close/exception/expiry coverage, authentic
2020 expiry corroboration, source trading-date/correction/finality semantics, no-trade
proof, independent parity, and separately accepted source/structural sufficiency. The
2021 pause baseline is not a full-session or holiday certificate. Complete proof is
range-specific; missing evidence cannot be replaced by weekday arithmetic.

Engine 2B Lead Manager: ACCEPT or REVISE this development milestone. This request does
not seek source eligibility, canonical OHLCV publication, weekly/monthly policy, consumer
connection, merge or deployment. Accepted #102/#106 modules remain unchanged. No
Engine 22/frontend, official Elliott/Fib, trading/execution/account/Journal/Replay,
Engine 26, paid infrastructure/provider plan or live-route/stream changes occurred.
Formal Engine 22 Manager ratification remains separately undocumented.
