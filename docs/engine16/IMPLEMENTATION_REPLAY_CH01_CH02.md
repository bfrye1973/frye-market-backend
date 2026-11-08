> **Current source status after supplemental scan, 2026-11-08:** Chapter 1 printed pp.3-17 are fully supplied and visually reviewed. Chapter 2 now ends at p.75 and lacks only printed pp.30-32 (TECH Figs2.9-2.11). Combined review:39 PDF pages,62 unique figures,36 proposed replay specifications. Manager review remains pending; neither chapter is COMPLETE; Chapter3 stays blocked. Earlier missing-page references below describe the first scan set and are superseded by [SUPPLEMENTAL_SOURCE_REVIEW.md](SUPPLEMENTAL_SOURCE_REVIEW.md).

# Engine 16 - proposed implementation contracts and replay requirements

Date: 2026-11-08. **Design proposal only. No executable code changed, no tests authored/executed by this study, no production authorization.** Read [rule registry](RULE_REGISTRY_CH01_CH02.md) and [manager sheet](MANAGER_REVIEW_CH01_CH02.md). Missing source pages block comprehensive classifier approval. The book teaches analysis; the contracts and test designs here are our engineering proposals.

## 1. Data contracts before recognition

Inputs must identify instrument, exchange/provider, contract, session, timezone, timeframe, tick/precision and price basis. Continuous futures need an explicit adjustment/roll policy. A back-adjusted history and a live individual contract must not silently share immutable price anchors. For source cases, CAT/TECH equities and silver/AUD/coffee futures retain their own precision; default ES .25 rounding is inappropriate.

Use Engine 11 as the ES candle source and Engine 22 as the authority for approved anchors/degrees/count versions. Read approved count provenance without editing it. The seven-degree names/order are supplied by the current Engine 22 contract; no book notation or chart timeframe may silently redefine them. SMT instruments need their own authorized data paths; the chapters do not supply those contracts.

Each input bar needs `barStartTime`, `barCloseTime`, `closed`, `knownAt`, OHLC and source identity. Each observation needs `eventTime` (when the price event occurred) and `knownAt` (when available). For a delayed pivot, `pivotTime` and `confirmedAt` differ. A previously closed bar delivered late is unavailable to earlier evaluations. Explicitly handle corrected candles by retaining old evidence and publishing a correction event; do not silently overwrite a historical analysis.

Forming bars may update a **provisional observation channel** on every live update. Closed bars advance the confirmation channel. Nothing in this design authorizes a forming-candle confirmation. Research computation should be isolated from Engine 11's render path; processing lag must be published and measured. If lag/freshness is unknown, output DEGRADED/UNAVAILABLE qualification rather than inventing certainty.

## 2. Proposed recognition records

`Candidate` fields: candidateId, scenarioGroupId, parentCandidateId, engine22AnchorVersion, proposedDegree, direction, family, subtype, role, origin/A/B/C or origin/1..5 anchors, childCandidateIds, childEvidenceStatus, ruleResults, targetModels, structuralInvalidations, confirmationObservations, alternatives, asOf, knownAt, rulebookVersion, sourceRevision, status and reasonCodes.

`RuleResult`: ruleId, predicateVersion, result PASS/FAIL/UNKNOWN, sourceEvidenceIds, measuredValues, comparisonBasis, pendingManagerDecisionIds. PASS means that predicate passed, not that the whole count is proven. UNKNOWN applies to missing internal bars, unapproved boundary semantics, unavailable source history and undetermined intrabar order. FAIL applies only to an approved predicate with adequate evidence.

`TargetModel`: modelId, candidateVersion, formulaId, measuredStart, measuredEnd, projectionOrigin, ratio, rawPrice, displayPrice, tickSize, roundingPolicy, priceBasis, createdAt, anchorsKnownAt, status PROJECTED/TOUCHED/EXCEEDED/RETIRED. A target touch is an outcome event, not a wave-completion event. Relation types include RETRACEMENT, C_FROM_B, W3_FROM_W2, W5_FROM_W4, and Y_FROM_X. Generic 'extension' without anchor semantics is insufficient.

`StructuralInvalidation`: predicateId, boundaryPrice, inclusiveOrExclusive, endpointOrExtremeBasis, applicableFamily, applicableDegree, status and evidence. `ConfirmationObservation` separately names a B break, internal-iv break or 2-4 line close, including price/time/close policy. The research record may reference an illustrative protective stop, but must label it `AUTHOR_EXAMPLE_PROTECTIVE_STOP`; it is not an executable risk/sizing instruction.

Alternatives are separate candidates with independent child graphs and invalidation predicates, grouped by shared evidence. A directionally agreed outlook does not collapse A/1, B/2 or differing parent degrees. Any ranking is a heuristic score with disclosed components until calibrated on a separate historical evaluation set; no percentages should be inferred from book language such as 'high confidence'.

## 3. Lifecycle proposal

Possible lifecycle: OBSERVED -> DEVELOPING -> COMPLETION_CANDIDATE -> CONFIRMED_RESEARCH, with REJECTED, SUPERSEDED and UNAVAILABLE qualification/history. This is **research confirmation**, not Engine 22 approval. The exact evidence required for each transition is manager pending. Fib confluence or pivot confirmation alone never authorizes CONFIRMED_RESEARCH.

During A, publish competing motive/corrective roles if children are incomplete. During B, update family hypotheses (for example a B overshoot defeats a particular zigzag hypothesis while supporting an expanded flat). During C, track five-wave child candidates and alternatives; do not require C already completed before exposing the developing correction. Upon confirmation evidence, retain the previous completion candidate and add a dated transition. On later contradiction, reject or supersede the interpretation as a new event; do not move old confirmed price observations.

Interpretation labels can change without falsifying immutable observations. For example TECH's apparent truncated fifth can become an ongoing fourth-wave triangle hypothesis in a later analysis version. AUD figures change prior correction labels from W-X-Y to A-B-C. Preserve what each snapshot said. Approved Engine 22 history cannot be changed by either process. Correction handling, retention and restart behavior require manager-approved identity/version rules.

## 4. Proposed function boundaries (names illustrative, not implemented)

| Boundary | Inputs | Deterministic output | Main rules |
|---|---|---|---|
| normalizeEvidence | declared raw bars, asOf, source policy | available closed/provisional channels, gaps, reason codes | E16-TIME-01 |
| derivePivotEvidence | closed prefix, approved pivot parameters | immutable pivot observations, delayed availability, ambiguous same-bar order flags | E16-PIV-01 |
| enumerateStructuralCandidates | pivots, approved Engine 22 references, parent graph | zigzag/flat/impulse/combination candidates plus UNKNOWN children | C2-ZZ-01, C2-FLAT-01 |
| validatePatternTree | candidate, child proofs, predicate version | PASS/FAIL/UNKNOWN per rule, family-qualified invalidations | C1-IMP-01..03, E16-FAM-01 |
| deriveTargets | measured anchors, projection origin, instrument rounding | labeled raw/display targets, no structural confirmation | Fibonacci registry |
| observeConfirmation | candidate + new permitted evidence | trigger observations independent of taxonomy proof | C1-CONF-01/02 |
| advanceResearchLifecycle | prior event history and deterministic results | appended version/transition, preserved alternatives | C1-PROC-01 |
| publishResearchProjection | approved snapshot contract, qualified candidates | Engine 2 display projection; history/uncertainty accessible | E16-AUTH-01 |

Missing child proof should not make a flat impossible or a zigzag valid. Existing prototype output can remain UNVALIDATED_SWING_CANDIDATE while a separate parser is approved. Stage large searches by parent context/degree with bounded compute and deterministic pruning, but manager must approve pruning criteria so valid alternatives are not silently lost. Performance targets need measurement against real Engine 11 update rates, not an invented latency guarantee.

## 5. Read-only prototype findings

Audited `services/core/logic/engine16StructuralTracker/research.js` at `fe8e6683ee8c334083539557e637cef3d54523d5` (PR #265). Findings below are visible code behavior, not results of running the tests.

| Existing function | Verified behavior | Limitation / proposed follow-up |
|---|---|---|
| abcCandidates | Uses four alternating outer pivots; DOWN requires B below origin and C below A, mirrored UP; labels unvalidated | Excludes expanded-flat B overshoots. Does not verify 5-3-5/3-3-5, parent trend, chronology of arbitrary caller pivots or developing A/B/C. Keep name/status honest; do not extend by simply loosening one inequality. |
| fibonacciLevels | Two anchors; retracement from end; extensions from start; .25 default tick | This is internally labeled in its formula, but cannot directly express a measured A projected from B or measured 1-3 projected from 4. Add explicit three-anchor model only after approval; preserve raw values. |
| confirmedPivots | Strict extrema relative to `strength` bars on each side; records confirmationTime as rightmost bar's `time` | Confirmation availability depends on whether `time` is bar start or close, not resolved in function. Outside bar may yield high and low at same timestamp; their intrabar order is unknown. Equal extrema rejected by strict comparisons; manager must approve tie/plateau semantics. |
| detectFvg | Strict first/third closed-bar price gaps; midpoint and untouched status | No mitigation/inversion lifecycle; no guaranteed bar continuity/session contract; c.time may be start time, not knowable-at close. These are owner requirements beyond these chapters. |
| computeEngine16Research | Validates closed ordered OHLC bars, requires priceBasis, sets snapshot asOf to last bar.time; no nested classifier; empty fib/SMT/alternatives arrays | No ingestion/evaluation clocks, live provisional update channel, persistence or approved candidate lifecycle. Cannot claim all-candle live recognition or historically replay-safe publication time from pure function alone. |

The module explicitly calls itself research-only and its ABC status is correctly unvalidated. No route, chart integration, production merge or code repair is proposed in this documentation PR. Test files on PR #265 were not executed by this study; execution status must be obtained from actual results.

## 6. Replay harness requirements

Each fixture must identify source/provider/contract/session/price basis, immutable candle revision, timeframe, exact cutoff and availability times, source page/figure IDs, rule IDs, expected candidate IDs/versions/states and rationale. Distinguish synthetic unit fixtures from author-reported chart examples and fully sourced historical replays. Never reconstruct missing chart bars by guessing their prices or timestamps.

Replay chronologically at every permitted candle event, retain each output and assert prefix stability: replaying a prefix alone yields the same saved output as that prefix encountered during a longer run. Adding future data must never edit the stored earlier output. Reset/restart and repeated delivery must reproduce identity/history, not duplicate confirmations. Author-reported fills are evidence annotations; simulated fills require their own execution model and do not certify actual broker fills.

All R-01..R-28 are **SPECIFIED, NOT IMPLEMENTED, NOT EXECUTED, NOT MANAGER-APPROVED**. A conditional expected result below must remain blocked until its decision is resolved. No test is described as passing.

| Test ID / rules | Input and chronological exercise | Expected result / required assertion | Fixture readiness |
|---|---|---|---|
| R-01 / E16-TIME-01, C1-CTX-02 | Synthetic closed bars arrive sequentially; final bar still forming; later bars finish a fifth | Earlier output unchanged; forming update remains provisional; no earlier completed fifth appears retroactively | Synthetic design ready; transition gates pending |
| R-02 / E16-PIV-01 | Strength=2 pivot at t; right bars close later; repeat a delivered bar; outside bar has both extreme types; plateau highs | Confirm only at second right-bar close/knownAt; no assumed same-bar ordering; duplicate replay idempotent; plateau result matches approved policy | Tie and identity decisions pending |
| R-03 / C1-IMP-01 | UP origin100, 1=110; terminal2=100.25,100,99.75; mirrored DOWN | 99.75 breaches source constraint; 100.25 does not fail this constraint alone; equality result pending M-01. Passing one rule does not validate whole impulse | Synthetic; boundary pending |
| R-04 / C1-IMP-02 | UP origin100,1=110,2=105,3=125; terminal4=111,110,109.75; separate intrawave wick109 then end111 | End109.75 fails territory condition; end111 does not fail this one constraint; equality and wick-only case stay policy-pending. Same anchors as diagonal routed separately | Synthetic; M-02 pending |
| R-05 / C1-IMP-03 | L1=10,L3=8,L5=9; then L3=9,L5=8; then L3=8,L5=8; partial5 | First fails shortest rule; second doesn't fail it; tie pending M-03; partial fifth does not get fully evaluated final comparison | Synthetic; tie pending |
| R-06 / C1-FIB-01, C1-CONF-01/02 | Fib target touched before child5 complete; later B/internal-iv break occurs; wick-only then close-through versions | Touch adds outcome evidence only; each trigger type separately dated; no guaranteed structure confirmation; wick/close behavior follows M-04 | Synthetic with explicit anchor tree required |
| R-07 / diagonal/triangle rules | Same outer overlapping geometry routed as impulse and diagonal; wave4 break versus 2-4 line close; triangle parent4 versus parentB | No cross-family validator reuse; different trigger fields; missing subtype/triangle proof remains UNKNOWN | Missing Chapter1 pages/full grammar |
| R-08 / C1-CTX-01/02, C2-NEST-01, C2-MTF-01 | Child upward five nested in larger downward scenario; two plausible parent-degree assignments | Child direction not substituted for parent direction; both scenarios retain parent IDs; no hard timeframe-degree conversion | Synthetic; Engine22 mapping pending |
| R-09 / C2-ZZ-01, C2-FLAT-01, C2-BTRI-01 | Same four outer anchors but child proofs 5-3-5,3-3-5,missing; B represented as contracting triangle | No validation from outer swings alone; family-specific results; UNKNOWN for missing proof; zigzag B triangle treated through approved grammar | Child grammar approval pending |
| R-10 / C2-ALT-01 | CAT Fig2.1 cutoff, initial decline116.55->108.39, rally112.47-112.84 region; A/1 and B/2 alternatives | Two larger-role candidates; common downside outlook not mislabeled certain subtype; future Fig2.3 bars absent at first cutoff | Historical bars/timestamps missing |
| R-11 / C2-SLOPE-01 | Two synthetic otherwise valid zigzags with C steeper/shallower than A; identical child validity | Slope contributes guideline evidence only; neither rejected solely by slope; time basis explicit | Synthetic; scoring threshold pending |
| R-12 / E16-OUT-01 | CAT 10 options at .86, sold3.75, multiplier100; compare figure's profit label | Gross3750, basis860, net2890 before costs, return~336.05%; contradiction preserved; no ES signal/order emitted | Arithmetic ready; not executed |
| R-13 / C2-FLAT-01, C2-ALT-01 | TECH internal origin68.84,A71.00,B67.69; C developing with four childwaves | Expanded-flat candidate permitted despite B overshoot; running-triangle alternative retained until justified exclusion; projected downward larger C/3 remains separate | Historical child bars missing |
| R-14 / C2-TRUNC-01, C1-PROC-01 | TECH Fig2.7 apparent70.78 vs70.80 truncation, then Fig2.8 triangle/consolidation | Prior snapshot intact; new version supersedes provisional completion interpretation; trigger69.28 revised69.50 with timestamps | pp.30-32 not needed for concept, bars needed for replay |
| R-15 / C2-NEST-01, E16-OUT-01 | TECH 66.60->67.85 rebound with two degree possibilities; later stop67.15 and target64.06 | Alternatives separate; exit100*(69.50-67.15)=235 before costs; no target-fill claim from arrow | Full execution chronology/data missing |
| R-16 / C2-DZZ-01, C2-COMB-01 | AUD W/Y zigzag children versus silver Wzigzag/Xflat/Yexpanded-flat; change WXY to ABC in later AUD snapshot | Correct family trees; no double-zigzag label solely from WXY; append interpretation version; preserve actual anchors | Synthetic grammar plus historical sources pending |
| R-17 / C2-BAR-01, C2-ALT-01 | Daily bar close above range midpoint after sell-off; close below midpoint; zero-rangebar; AUD1-2/ABC candidates | Support metric changes without automatic wave confirmation; zero-range defined/UNKNOWN; alternatives survive unless approved invalidation fails | Synthetic; measurement policy pending |
| R-18 / E16-OUT-01 | AUD Fig2.21 stop.9230 then reported exit.9354 while chart still shows.9230 | Store author-reported exit separately; unresolved stop history flagged; do not simulate unobserved protective adjustment | Reconciliation source missing |
| R-19 / Fibonacci registry | CAT midpoint112.47; silver C from B644 and A650->637.5; silver fifth540.5+.618*(639.5-418); coffee1090+1.618*(1220-795); mirrored cases | Raw112.47,631.5,677.387,1777.65; formulas/anchors named; no generic-start extension substitution; no completion solely from target | Synthetic arithmetic ready |
| R-20 / C2-FIB-W5/STOP-01 | Silver raw677.387 vs displayed677.5; coffee1144.626 approximation then protective1144; vary instrument tick | Raw values preserved; instrument-specific display/tolerance; ES default rounding not inherited; unresolved source precision explicit | Manager rounding policy pending |
| R-21 / E16-OUT-01 | Silver hypothetical earlier channel stop-entry versus actual later678.5 buy; reported news gap | Counterfactual never becomes executed fill; gap isn't mandatory fill or FVG proof; missing intrabar sequence remains unknown | Exact bars/execution records missing |
| R-22 / E16-OUT-01 | Silver10 entry678.5, add2 at682.5, later narrative sale10 at698; missing Figs2.34/35 | No invented exit for remaining2 or net total; reported11300 retained as unverified narrative amount | pp.56-57 required |
| R-23 / C2-STOP-01 | Coffee hypothetical1229 entry,1144 stop, structural origin1090; price1143, then1088 | At1143 risk setup stopped while structural origin not crossed; at1088 applicable structural constraint may fail once approved; log separate events. 85 risk,549 reward | Synthetic ready; actual historical cutoffs missing |
| R-24 / C2-COMB-02 | Coffee prior1306, W795, X1308; propose zigzag-Y or other combination; later sideways evidence | Under source's stated comparison, X overshoot rejects that double-zigzag interpretation; keep eligible combination alternatives; do not retroactively rewrite January thesis | pp.66-67 and complete ending required |
| R-25 / E16-FAM-01, C2-FLAT-02 | Coffee Fig2.40 question-mark running-flat child; insufficient childbars | UNKNOWN subdivision result; no confirmed running flat; parent may remain qualified developing | Historical bars and grammar pending |
| R-26 / source completion | Manifest omits C1pp12-13/C2gaps/ending; attempt COMPLETE transition or rules derived solely from missing figs | Completion gate blocks; missing evidence list exact; no inferred source attribution; Chapter3 stays blocked | Manifest design ready |
| R-27 / E16-AUTH-01 | Generate/update/reject research candidates against immutable Engine22 snapshot and stub trade interfaces | Engine22 byte identity preserved; no calls to permission/sizing/execution, Engine27 mutation or Engine11 candle writes | Integration harness not built |
| R-28 / E16-EVID-01 | Delayed/stale/mismatched-session QQQ/VIX inputs; FVG evidence absent in chapter extraction | Mark SMT unavailable/qualified; no cross-session false confirmation; FVG/SMT never substitutes for missing wave children; separate specification reference | Owner module contract needed |

## 7. Acceptance and limitations

The source-study deliverable can be reviewed now, but a comprehensive chapter gate cannot pass with source gaps. Pattern-rule approval requires source reconciliation and manager decisions. Implementation approval then requires deterministic unit tests, actual chronological historical replays with recorded cutoffs, failure cases, alternative scenarios and evidence of no historical mutation. Live integration separately requires measured performance/freshness/restart behavior and Engine 2 contract review. Nothing here establishes live prediction accuracy or authorizes merge/deploy.

## Supplemental replay update -36 total specifications

[SUPPLEMENTAL_SOURCE_REVIEW.md](SUPPLEMENTAL_SOURCE_REVIEW.md), section6, adds R-29..R-36 and revises R-22,R-24,R-26. R-22 now resolves the author-chart twelve-contract silver exit while retaining conflicting prose quantities; it no longer expects an unaccounted remaining-two exit. R-24 can use recovered coffee reassessment/end figures without inferring missing pages. R-26 now blocks source completion only on Chapter2pp30-32; Chapter1 sourceREAD passes while manager gate remains pending. New tests cover distinct trigger types, nested E, same-direction alternatives, contracting boundary cases, hypothetical coffee outcomes, guideline-only slope warnings, silver source reconciliation and current completion gates. All36 remain SPECIFIED, NOT IMPLEMENTED, NOT EXECUTED, manager pending.
