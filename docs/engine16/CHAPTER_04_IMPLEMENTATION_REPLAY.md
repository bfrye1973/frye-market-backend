# Engine 16 — Chapter 4 programming and replay proposals

**NOT IMPLEMENTED / NOT EXECUTED.** These are 24 reviewable specifications, bringing Chapters1–4 to80 proposed checks. Static book charts are not chronological OHLC fixtures, execution logs or evidence of classifier accuracy. Obtain verified historical data/metadata and manager decisions before implementation. [Rule registry](CHAPTER_04_RULE_REGISTRY.md), [casebook](CHAPTER_04_DETAILED_STUDY.md), [review](CHAPTER_04_MANAGER_REVIEW.md).

## Candidate/data contract proposed for review

Inputs: immutable Engine11 closed candles with instrument/contract, session, timezone, event and availability times; versioned Engine22 authorized parent/degree/anchor IDs; child subdivisions with provisional/confirmed state; price increment metadata. All evidence must be available at the evaluated as-of time. Missing candles, unavailable metadata and incomplete child structure produce qualified output, never invented subdivisions.

Candidate output: `candidateId`, `version`, `parentAuthorizationId`, `parentRole`, `degree`, `localDirection`, `patternType`, ordered anchor/child IDs, `strictValidity`, `guidelineFlags`, `asOf`, `availableAt`, `alternatives`, `sourceRefs`, `targetIds`, scoped invalidation entity/reason, superseded snapshot link. This is a proposal, not an existing API.

Projection output: measured start/end anchor IDs, projection origin ID, signed direction, ratio, unrounded level, displayed level, rounding policy, price basis/contract/session, known-at time. Keep equality target, extension target and channel comparison separate. Do not collapse disagreeing targets into an artificial precise consensus.

Separate research events for author-reported actions: episode ID, sequence, source page/figure, quantity, quote string, normalized price, event time precision, evidence type `AUTHOR_REPORTED`, stop selection time if known, stated target, reported aggregate result, calculated result/assumptions, cost status `UNKNOWN`. No transmission to broker. A claim in a book is not a broker-confirmed fill. Aggregate-only reentry losses stay aggregate-only.

Quote arithmetic: normalize bond example `p^t` to `32*p+t` integer ticks; compute ratios in rational/decimal precision before explicit rounding. Reject tick field≥32 for this source scheme; actual production fractional ticks require instrument metadata and cannot be guessed. Negative or malformed quotes require explicit parser policy. Source inconsistencies must be visible alongside normalized hypotheses.

Lifecycle: create candidate with evidence then qualify; append new observations and new alternate versions; record scoped invalidation/supersession; keep prior snapshot queryable. A June retrospective label is valid only in the June snapshot. Chronological replay must have no final-count labels attached to February input.

## Replay specifications

Every row is a proposed fixture with an expected result, not a passing test. Numeric fixtures may be synthetic; label them so they cannot be mistaken for recovered1998 bars.

| ID | Rule / source | Fixture and expected result |
|---|---|---|
| C4-R01 | ZIG-01;99,114 | Supply outer ABC pivots with no children: remain subdivision-UNVERIFIED, no orthodox zigzag confirmation. |
| C4-R02 | ZIG-01;99 | Supply verified five/three/five children under one authorized degree: structural candidate eligible; remove one required child or use three/three/five: reject zigzag qualification, preserve possible alternative. |
| C4-R03 | ALT-01;4.1–4.4 | TriangleC and wave2 alternatives both point down: retain both parent roles, no automatic winner or calibrated score from agreement. |
| C4-R04 | FIB-01;4.1–4.2 | From1002.6→854.4 project.618 from1000:908.4124; compare .618retracement1000→854.4:910.0192; preserve distinct anchor lineage. |
| C4-R05 | FIB-01;4.3 | W1000→934.9, X992.5: equality927.4,1.618887.1682. Swap origin to wrong candidateB: lineage validation blocks result. |
| C4-R06 | FIB-01;4.4 | A1000→957.5, B992.5, ratio1.618:923.735 unrounded; keep923.73 source display with precision note, no strict validity decision from display rounding. |
| C4-R07 | OVL-01/02;4.5 | Ordinary impulse4 overlaps2 but stays outside1: guideline flag only; move4 into1 territory: strict failure scoped to that impulse; parent remains separately evaluated. |
| C4-R08 | OVL-02;4.5 | Boundary at exact wave1 price and ±one tick: use pending approved equality/tolerance policy; until approved expose boundary-AMBIGUOUS, never silently assume. |
| C4-R09 | EXT-01;4.5–4.6 | Larger target distant while local fifth developing: extension remains hypothesis; incomplete candle through a threshold cannot confirm pivot or completed extension. |
| C4-R10 | PROT-01;4.6 | 974.8→962.8, .786 recovery972.232, stated973.5 protection: preserve two distinct levels and do not label stop structural invalidation automatically. |
| C4-R11 | FILL-01;4.6–4.8 |2@963.3,2@969,1@957.3,1@957.2: exact totals4avg966.15 and6avg963.183333…; displays966.2/963.2; prohibit average of rounded averages. |
| C4-R12 | BUF-01;4.9 |969→956 .618recovery964.034 and actual stated964 stop: retain original; append admitted missing buffer as process note. Do not replace historical stop with a safer invented fill. |
| C4-R13 | EXIT-01/OUTCOME-01;4.10 | Cover6@942:127.1contract-points; implied250 multiplier reconciles31775; costsUNKNOWN and evidenceAUTHOR_REPORTED remain. |
| C4-R14 | EXIT-01;4.11 | Following exit, observe926 then917.7: target reached-after-exit is separate observation; realized initial exit remains942. No retroactive target fill. |
| C4-R15 | REENTRY-01;4.12 | Report reentry loss17650 without fills: separate aggregate-only episode, combined reported14125; no fabricated entry timestamps/quantity. |
| C4-R16 | NEST-01;4.13–4.18 | Upward parentC with downward inner(a)-(b)-(c): local directionDOWN with parentUP preserved. Mismatched authorized parent ID blocks publication. |
| C4-R17 | BOND-01/FIB-01;4.17 |124^09→119^16 is153ticks;122^26−153=118^01. Decimal121.02 parsing fails source-normalization requirement. |
| C4-R18 | SOURCE-01;114/missing115 | B endpoint122^26 is prose-reported but supporting4.16 absent: partial evidence qualifier, missing figure not synthesized. |
| C4-R19 | PLAN-01;4.18–4.20 | Entry25@121^02 precedes stop selection after later decline: preserve plan-incomplete interval; never predate120^24 stop to entry. |
| C4-R20 | SOURCE-01/BOND-01;4.20 | Literal lower label121-14 conflicts with position/ladder; keep ambiguity. Hypothetical120^14 with121^01 produces midpoint120^23.5, not an observed exact120^24 anchor. |
| C4-R21 | RISK-01;4.19–4.21 | Stop below short entry nominally locks favorable ticks: no infinite reward/risk or guaranteed zero economic risk; quantity/slippage/fees remain separate. |
| C4-R22 | OUTCOME-01;4.21 |121^02−120^13=21ticks;25units=16.40625contract-points; assumed1000 gives16406.25, source rounded16406 retained; target118^01 not booked as cover. |
| C4-R23 | REVISE-01;4.23–4.24 | Evaluate February as-of with only then-known snapshot; June W-X-Y/degree revision excluded. Query June shows new linked version without mutation of February anchors. Later118^23 does not satisfy118^01. |
| C4-R24 | AUTH-01/REENTRY-01;122–123 | Report10938 aggregate later loss separately, no reconstructed fills; derived rounded combined5468. All outputs research-only; absent candle/quote metadata or unauthorized Engine22 count prevents actionable publication. |

## Verification performed for this documentation

Visual inspection of all13 supplied scans;23 supplied figure records and missing4.16 accounted for;24 unique replay IDs; local link and arithmetic checks. These checks validate documentation consistency only. No runtime unit suite, market replay, broker matching or production integration was executed as part of Chapter4 study.

Implementation follow-up, after approval: choose explicit subdivision/overlap policies; extend primitive candidate contracts without claiming unsupported pattern recognition; add trustworthy fixtures with availability times; implement meaningful deterministic tests, then replay evidence before requesting release approval. The existing prototype's child-subdivision, three-anchor and availability-time gaps remain unresolved by documentation.
