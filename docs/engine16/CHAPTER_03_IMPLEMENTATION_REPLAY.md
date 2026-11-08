# Engine 16 - Chapter 3 programming proposals and replay requirements

Date2026-11-08. Proposed design only. **No executable code changed and no test was implemented or executed by this study.** Twenty specifications below add to the prior36 for56 total research specifications, not56 passing tests. Source and casebook: [handoff](CHAPTER_03_SOURCE_AND_HANDOFF.md), [detailed study](CHAPTER_03_DETAILED_STUDY.md), [rule registry](CHAPTER_03_RULE_REGISTRY.md).

## Candidate graph and invalidation scope

Extend the proposed Chapter1-2 candidate graph rather than introducing a second wave authority. Each triangle has parentCandidateId, childRolesAtoE, family CONTRACTING/BARRIER/OTHER/UNKNOWN, proposedParentRole4/B/X, degreeRef from Engine22, originA and endA..endE observations, childProofStatus, rulebookVersion and asOf/knownAt. A nested E triangle is a child graph with its own origin, roles and geometry. It is not flattened into the parent's A-E slots.

Each rule result should include `affectedEntityId`, `scope` (TERMINAL_HYPOTHESIS/CHILD/PARENT), `basis` (endpoint/extreme/close), `evidenceTime`, `knownAt`, `boundaryPrice`, `comparison`, PASS/FAIL/UNKNOWN and `reason`. A rule failure can supersede a terminal-E hypothesis while leaving the parent's family possible. Mapped transitions are proposals: `E_COMPLETION_REJECTED`, parent `DEVELOPING/RESEGMENTATION_REQUIRED`, or `PARENT_TRIANGLE_REJECTED`. Exact state names require manager approval.

For the p.91 contracting/barrier statement, crossing C is not automatically parent rejection. Crossing A rejects the named triangle case. The engine must not change Engine22 approved anchors to make either candidate survive. It can publish a new research segmentation with explicit link to the superseded one, or mark UNKNOWN if insufficient child evidence exists. All previous outputs/observations remain immutable.

## Geometry and target identity

Represent a line with two anchor observation IDs, prices, timestamps, coordinateBasis, units, sourceRevision, activeFrom and version. Evaluate `y(t)=p1+(p2-p1)*(t-t1)/(t2-t1)` only when t2 differs from t1 and price/time units match. Whether t is actual elapsed time, completed-session bar ordinal or another coordinate is a manager decision: gaps/weekends change slopes. Do not silently compare lines built on different time bases or adjusted price series.

Triangle width model: evaluate both parent A-C and B-D lines at the origin-of-a timestamp and take absolute vertical difference. Retain that timestamp and both raw line values. This is not a blanket max-high/min-low function and not separation at the end of A unless those times happen to coincide. The diagram gives DELL width3.03; raw chart anchor coordinates are unavailable, so3.03 is an author-measured input for an arithmetic fixture, not independently recovered geometric truth.

Model types should distinguish TRIANGLE_WIDTH, PARALLEL_CHANNEL, WAVE_EQUALITY, FIB_MEASURED_PROJECTION and BLENDED_OBJECTIVE. Each carries measurementScope, measured anchors, projectionOrigin, rawPrice, displayPrice, rounding/tolerance policy, createdAt, asOf and source/evidence IDs. The DELL midpoint17.66 and standalone width target17.78 must not share one unlabeled number. If terminal E shifts down.51, append translated models with originalModelId and reason; do not overwrite past targets. Parent/child scope prevents switching to nested-E width silently.

Confirmation observations similarly name FIXED_D_BREAK, BD_RANGE_BREAK, BD_LINE_BREAK or LOCAL_IMPULSE_CHANNEL_BREAK. Each identifies direction, price/time, wick/close/persistence policy and geometryVersion. A buffered example order is an annotation tied to one plan, not a generic Engine16 trigger price. Conflicting/opposing plans remain scenario objects; order placement belongs to authorized execution systems.

## Chronology and evidence separation

For every replay cutoff, use only data known by that point, including each bar's actual close and receipt time. March26 daily analysis and April4 hourly refinement are distinct snapshots. Later20.30 E identification must not replace20.81 in the original snapshot. A forming morning daily bar is provisional unless the actual source permits another declared evidence basis. The source narrative may describe a bar 'that morning' without providing all timestamps; mark the exact cutoff unknown rather than inventing a close.

Hypothetical execution models must declare midpoint assumptions, tick rounding, source bar, opportunity window, fees/slippage scope and non-verification status. DELL20.39/18.48 and gold825/875 are illustrative plan/outcome values. Their future chronology is not proof of actual broker execution. Source annotation 'Risk=0' remains a quoted field describing the author's nominal accounting; do not produce a guaranteed-zero-risk system status.

Qualification states must cover missing child proof, missing exact source cutoff, geometry ambiguity, unavailable raw bars and absent pp.80-81. No finite numeric score replaces UNKNOWN. Heuristic confidence cannot be displayed as probability without a calibrated independent dataset.

## Twenty replay/test specifications

Every row is **SPECIFIED / NOT IMPLEMENTED / NOT EXECUTED / MANAGER PENDING**. Synthetic tests establish proposed behavior/arithmetic, while historical tests require authorized bar fixtures. Each historical fixture must preserve source symbol/contract, provider, adjustment/roll policy, timezone/session, bar timestamps/knownAt, exact cutoff and candidate/rule versions. A screenshot is not an OHLC fixture.

| ID / rule trace | Input and exercise | Expected result and limitation |
|---|---|---|
| C3-R01 / C3-TRI-01 | Synthetic sideways converging A-C/B-D outline without child subdivisions; compare complete child tree | Geometry-only candidate stays developing/UNKNOWN structurally; no final E or direction solely from visual convergence. Full child grammar requires approval. |
| C3-R02 / C3-TRI-02 | Same child geometry as parent4, B and X; nested E triangle at lower degree; unsupported standalone role | Separate sequence/degree linkage and final-local-leg expectation; nested E is a child, not broad role exemption. Unsupported role UNKNOWN/rejected only by approved grammar. |
| C3-R03 / C3-ALT-01 | Gold initial supplied snapshots: bullish(4) and bearish B with relabeled internals; later upward bars withheld | Both alternatives remain; separate targets/protection; no invented50/50 probability, winner or opposing orders. Later evidence can favor one prospectively. |
| C3-R04 / C3-CONF-01/02 | Gold D822.8, minimally beyond822.9 reference, buffered825 plan; alternate780range trigger; separate BDline | Explicitly different event/plan types. No hard-coded gold buffer applied to ES. Wick/close policy results remain manager-dependent. |
| C3-R05 / C3-INV-01 | Contracting/barrier synthetic down-thrust case: A110,C108,E107; new108.25; new exactly108; intrawave-only excursion |108.25 defeats current E-complete hypothesis under approved comparison, while parent is resegmentation-required rather than automatically rejected. Exact equality/extreme basis pending. Engine22 unchanged. |
| C3-R06 / C3-INV-02 | Same case later110.25 crosses A; competing non-triangle scenario exists | Reject named parent triangle under approved basis, preserve its saved history and unaffected competitors; never rewrite approved Engine22 history. |
| C3-R07 / C3-INV-03 | DELL e20.81,c21.18, chosen stop21.19; compare tighter e-based protection | Practical stop, E invalidation and whole-parent invalidation remain separate objects. Stop hit doesn't collapse all structural scenarios or certify fill. |
| C3-R08 / C3-RISK-01,C3-TGT-07 | Gold chronological examples:788.1->reported797.1->815->845->855.2->860->875;834.8 then858.1 target versions | No future stop/target in older outputs. Target achievement event distinct from wave3 ending872.9. Missing intermediate frames/times remain unknown. |
| C3-R09 / C3-TGT-01/04 | Synthetic lines with declared originA/time basis and author width3.03; E20.81; separate midpoint17.78/17.53 | Arithmetic17.78 and17.655->display17.66. Different coordinate basis or zero-duration line rejected/UNKNOWN; don't replace line width with observed bar range. |
| C3-R10 / C3-TGT-02/03 | DELL projected17.78 lies inside channel; equality15.50, .61817.53; conditional lower-target branch | Channel evidence marked NONCONFIRMING/neutral, not positive confluence. Keep distinct models and prospectively conditioned objectives; equality guideline not hard validity. |
| C3-R11 / C3-NEST-01,C3-CONF-02 | Original E20.81 then April4 hourly nested[A]-[E] with end20.30 and BDbreak; forming/late childbar versions | Append superseding completion hypothesis; original output immutable. Availability time gates confirmation; absent child proof remains UNKNOWN. |
| C3-R12 / C3-NEST-02,C3-TGT-05 | Parent width3.03; nested E width differs; terminal20.81->20.30; original blended17.66 | Parent-width target17.27; shifted blended17.15. Distinguish both. Nested width never substitutes without a separately named new model. |
| C3-R13 / C3-MAT-01 | DELL five down to18.13 could be whole(v)or initial lower-degree five; small inner fourth triangle candidate | Retain both parent-degree interpretations. Local maturity/rebound evidence doesn't prove full parent completion or all-degree reversal. |
| C3-R14 / C3-EXIT-01 | Local channel break after18.13; later daily rebound withheld; entry20.39, hypothetical hourly-midpoint exit18.48 | Record1.91/share before unshown costs as modeled outcome. Target17.15 not hit. Later larger confirmation must have later timestamp. |
| C3-R15 / C3-EVID-01 | DELL stop20.31 below short entry20.39 and figure labelRisk0; add unmodeled costs/gaps | Preserve source nominal-risk annotation and execution assumptions; never emit guaranteed-zero-risk claim. No sizing or execution action. |
| C3-R16 / C3-TGT-06 | Measured move20.30->18.53 projected from19.05 at.618; actual low18.13 | Raw17.95614/display17.96; actual differs. Guideline evidence only with declared tolerance; no exact target hit or automatic completion. |
| C3-R17 / C3-TGT-08 | Gold labels840.51 versus prose843.0 and .382-wave3 wording; source anchor basis incomplete | Conflicting values stored with references; no silent replacement or invented wave3 origin. A source discrepancy blocks numeric historical assertion, not all research. |
| C3-R18 / C3-EVID-01 | Gold hypothetical5 contracts at825, stop-out875; reported1660/contract/8300total; unknown historical multiplier/costs | Price gain50;5*1660=8300 verified as report arithmetic. Do not assume current contract multiplier or claim verified net broker P&L. |
| C3-R19 / source timing/inventory | Missingpp80-81/Figs3.3-3.4; laterp82 retrospectively mentions797.1 adjustment | No fabricated source record, fill or prior cutoff. Mark available-source study finished versus full-chapter-source coverage incomplete; Chapter2 waiver doesn't transfer automatically. |
| C3-R20 / architecture and persistence | Repeat incremental runs/restart, delayed childbar, revised source, opposing candidates, immutable Engine22 fixture | Prefix outputs unchanged; idempotent event identity; append revisions; no Engine11 writes, Engine22 mutation, Engine27 changes or permission/sizing/order calls. |

## Acceptance and next implementation scope

The manager must first resolve invalidation scope, family grammar, equality/extreme basis, completion evidence and geometry coordinates. Programmers can then implement an approved isolated slice and map each rule to actual functions and tests. No route/live integration is proposed here. Require actual unit and historical replay results before advancing validation status. Lack of source80-81 remains recorded; the work delivered here is a complete study of all supplied Chapter3 material, not a claim to have read absent pages.
