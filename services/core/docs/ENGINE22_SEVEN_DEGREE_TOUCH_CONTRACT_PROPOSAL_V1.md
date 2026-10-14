# Engine22/Engine27 seven-degree strategy-card integration — audit and contract proposal

**Research only; no runtime imports, no wave-count/Fibonacci changes, no frontend modifications.**

## Verified source audit
- Frontend `Frye-Dashboard/src/pages/rows/RowChart/overlays/Engine22MarketStructureCard.jsx`: `waveDegreeOverride={null}` for submicro, micro, subminute disables the normal `currentWavelength.degrees[degree]` Fib panel; the special Subminute W3 presentation substitutes only ~7700 W2 low instead of an existing full ladder.
- Engine22 `wave/buildCurrentWavelength.js` has provisional Subminute W3 geometry (older anchor set). That model is NOT automatically official.
- `engine22/microV2/applyCanonicalMicroIntrabarFibObservation.js` can record raw high/low touch observations, but this audit has NOT shown the current live builder invokes, persists and publishes them to the seven cards.
- Engine27 V2 `v2/buildTraderIntelligenceV2.js` copies Engine22 level status and `touchedAt`. It has **six** presentation degrees: micro, subminute, minute, minor, intermediate, primary. It does not by itself supply seventh Submicro semantics or certify touches.
- Engine22 legacy `buildEngine22Display.js` also lists six degrees; the seven-degree frontend/V3 additions represent a migration boundary that must be explicitly mapped. Do not alias Micro and Submicro.

## Required canonical ownership
Engine11 supplies qualified ES candle evidence; Engine22 solely approves structural wave identities/Fib geometry and persists eligible touches; Engine27 consumes/explains those facts; frontend renders rather than invents statuses.

**Touch event identity:** degree + approved count ID + model key + level key + price basis/series ID + validated native bar ID/source timestamp + first touch. Intrabar high/low must cross eligible level **after model origin**, on the same compatible source series; replay/repeated builds must be idempotent and first touch should persist for same model. A model revision never inherits an incompatible touch. Stale/no bar, missing source IDs, and provisional owner-only models remain WATCH or UNVERIFIED with explicit reason codes. A price print near 7800 alone cannot confer TOUCHED.

## Current additive artifact
`services/core/logic/engine22/research/inspectSevenDegreeDisplayV1.js` is an **isolated research-only normalizer** covering all seven degrees. It neither reads market data nor calculates a touch; it separates reported `TOUCHED` from provenance-verified display `TOUCHED`. It is **not a replacement** for published Engine22 contracts or a claim that current production timestamps/IDs are populated. Tests in `services/core/tests/engine22SevenDegreeDisplayResearchV1.test.js` cover seven independent rows, no fabricated touch, verified-published touch eligibility, provisional Subminute, missing prices, and nonmutating output.

## Next gates
1. Inspect timestamped live Render snapshot and code invocation: price source, actual raw high/low, refresh time, model origin, Engine22 Micro event and persistence. Do not assume frontend problem is the sole cause.
2. Ask Engine27 manager for exact current V2/V3 presentation-degree contract, Submicro mapping, and consumer read-path; Engine27 cannot author Elliott touch decisions.
3. Engine2B accept/revise a source-compatibility design to migrate the special frontend states without accidentally displaying obsolete provisional Fibs as official.
4. Only after approval: production-connected seven-degree Engine22 publication and corresponding Engine27/frontend adapters, shared replay/live regression tests, and independent acceptance. Keep changes limited to respective owner boundaries.

**Hard hold:** no production integration, no approved Fib geometry recalculation, no count promotion, no trading/execution, no merge/deploy. Existing PR #131/#132 remain untouched.
