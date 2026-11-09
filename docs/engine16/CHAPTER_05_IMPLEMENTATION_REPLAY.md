# Engine 16 - Chapter 5 programming and replay proposals

**28 specifications, NOT IMPLEMENTED / NOT EXECUTED.** Earlier chapters80 plus these28 =108 research checks. [Registry](CHAPTER_05_RULE_REGISTRY.md), [casebook](CHAPTER_05_DETAILED_STUDY.md), [manager review](CHAPTER_05_MANAGER_REVIEW.md). Source charts are not recovered OHLC fixtures, option chains or fill logs.

## Proposed contracts, not current APIs

Input: Engine11 closed candles with instrument/contract/session/timezone and both event/availability time; Engine22 versioned authorized parent, terminal role, degree and anchor IDs; confirmed/provisional child subdivisions; instrument tick/multiplier and price-basis metadata. Candidate must not import terminal role from a later author label as if known at creation.

`EndingDiagonalCandidate`: candidate/version/parent authorization IDs, subtype`CONTRACTING`, terminal role, direction, ordered pivots0-5, child zigzag/multiple structure references, length1/3/5, separate4/1 overlap observation,1-3 and2-4 line definitions, strict-validity state, guideline flags, source references, as-of/available-at. Missing children => UNVERIFIED. Expanding/leading forms unsupported until separately specified/approved. Preserve former hypotheses rather than repaint confirmed pivots.

`EvidenceEvent`: entity ID and degree, type`ANTICIPATION`/`THROW_OVER`/`BREAK_2_4`/`BREAK_WAVE4`/`BREAK_INNER_B`/`TARGET_OBSERVED`/`HYPOTHESIS_INVALIDATED`, candle/anchor references, event/available times, boundary at that time, source/model status. Types carry different meaning; no event is a broker instruction.

Line evaluation proposal: `y(t)=p2+(p4-p2)*(t-t2)/(t4-t2)`; require distinct ordered timestamps, shared contract/session basis and eligible confirmed anchors. Decide elapsed exchange-time versus bar-index coordinate explicitly. A line breach based on an open candle stays provisional; manager must choose touch/wick/close, buffers and required follow-through. The source does not set these parameters.

`TradeIllustrationEvent` stays separate: evidence kind`HYPOTHETICAL`/`AUTHOR_REPORTED`, intended trigger, executed-price evidence if any, quantity, quote units, exact fill-derived average, displayed average, protective-level history, target history, entry/exit time precision, cost statusUNKNOWN. TCK actual narrative and modeled Euro/SLW examples must not mix in classifier performance statistics.

Execution feasibility research: distinguish market crossed/traded threshold, gap skipped level, actual reported fill, modeled fill and unknown execution. OHLC cannot establish within-bar event order when both stop/target were touched. Requires higher-resolution evidence or AMBIGUOUS result; no optimistic ordering. Option analysis requires historical instrument/chain/bid-ask metadata rather than substituting underlying return.

## Replay specification table

All fixtures are proposals. Numeric-only/synthetic fixtures must be labeled synthetic; they are not reconstructed1998/2008/2011/2012 candle histories.

| ID | Rule / source | Fixture and expected result |
|---|---|---|
| C5-R01 | POS-01;125,153 | Same wedge in authorized impulse5 versus nonterminalA: terminal candidate eligible only for first; do not manufacture approved parent. |
| C5-R02 | SUB-01;146/5.22 | Five outer turns without child internals: UNVERIFIED, not orthodox diagonal. Add single/multiple zigzag children: eligible if remaining constraints met. |
| C5-R03 | SUB-01;5.22 | Supply ordinary impulse children or connector-free concatenation pretending double zigzag: no verified ending-diagonal qualification. |
| C5-R04 | LEN-01;127/5.3 | Synthetic upward lengths1=10,3=8, fifth from4=6: contracting length checks pass; fifth8+tick fails scoped candidate; preserve parent. |
| C5-R05 | LEN-01;5.3,5.24 | Fifth exactly equals3 and ±one tick: expose boundary policy unresolved until approved; source stop9344.8/1.6161 retained separately from strict comparison. |
| C5-R06 | OVL-01;146 |4 overlaps1 with valid diagonal internals: no ordinary-impulse automatic rejection; same overlap in ordinary impulse follows Chapter4 constraint. |
| C5-R07 | SHAPE-01;5.21-5.22 | Wedge outline with no authorized terminal role or child evidence cannot produce confirmed diagonal. |
| C5-R08 | THROW-01;5.22 | Fifth beyond1-3 line at event time produces throw-over flag only; remove throw-over but retain valid structure: candidate not rejected solely for its absence. |
| C5-R09 | ENTRY-01;5.3-5.5 | April23 line break versus April24 wave4 break remain distinct dated events, no backdated confirmation of anticipatory signal. |
| C5-R10 | SHAPE-01/ENTRY-01 | Synthetic p2=100 at t2=0,p4=104 at t4=2 =>line106 at t=3; require ordered nonzero-duration anchors; same prices/different times change threshold. |
| C5-R11 | ENTRY-01 | Open bar temporarily below2-4 then closes above: source's undefined “decisive” cannot silently become confirmed-close breach; policy-qualified/provisional output. |
| C5-R12 | GAP-01;130/5.7 | Low40.65 then open33.75 around threshold40.62: no exact40.62 fill; mark skipped-level, order execution unknown/different according to actual specified order type. |
| C5-R13 | OPTIONS-01;135/5.12 |10*.82*100=820;10*2.72*100=2720;1900 nominal gain/231.7073% premium return. Keep source230% display separate. |
| C5-R14 | OPTIONS-01/SOURCE-01 | Underlying alone hits32.43, absent option quotes/setup pages: no inferred option fill, initial diagonal anchors or precise protection. |
| C5-R15 | OPTIONS-01;5.12 | Later bid3.90 implies375.6098% gain on.82 before costs; retain modeled2.72 exit rather than improve realized record with future quote. |
| C5-R16 | ALT-01;5.13 | Same-degree zigzag2/flat4 sets alternation support; both zigzags produce absent-support flag, not strict invalidation. |
| C5-R17 | DEPTH-01/EQUAL-01;5.13 | Distinguish projected terminal32.60 versus observed32.43 from leg lengths;17cent near miss not zero/identical. Higher29.55 vs29.79 remains guideline observation. |
| C5-R18 | EQUAL-01;5.13 |31.62 vs32.43,34.61 vs34.34,36.85 vs37.20: preserve ratio target/actual separation; no hard exact-touch rejection or calibrated score. |
| C5-R19 | INNER-01;139/5.15 | Break inner[b]36.94 before fullwave4: eventBREAK_INNER_B; no automaticBREAK_WAVE4 or2-4 confirmation. |
| C5-R20 | FILLS-01;5.16-5.18 |50@36.94 then100@35.13 =>150avg35.733333...; plan add beforeMay4 stays unfilled; never simple-average to36.035. |
| C5-R21 | STOP-01;5.16-5.20 | Chronological38.09→37.17→34→33; final reported cover33 exits for profit, not pattern failure/loss; later levels excluded from earlier risk snapshots. |
| C5-R22 | FILLS-01;144 | Displayavg35.73→33 produces2.73/7.640638...%; exact weighted nominal aggregate410. CostsUNKNOWN, no margin-return claim; source7.64% retained. |
| C5-R23 | BASIS-01;5.21-5.25 | Unverified continuation vsJune basis: block automatic anchor merge. Verified source-specific mapping allows qualified comparison with lineage intact. |
| C5-R24 | UNITS-01;5.24 |1.6161−1.5957=.0204;1.5957−1.5273=.0684;reward/risk3.35294; source204/684points. No unknown dollar multiplier inferred. |
| C5-R25 | BASIS-01;5.23 |1.5985 high,1.4355 base => .382=1.536234, .500=1.5170, .618=1.497766;1.5273 between.382/.5. Preserve source display rounding. |
| C5-R26 | OCO-01;5.26-5.27 | Source lower buy target paired with protective stop but order terminology ambiguous: research intent retained, live-order serialization prohibited; hypothetical fill1.5273 separate from low1.5255. |
| C5-R27 | TIME-01;5.28 | Later peak1.5988/large diagonal origin1.5255 not available at April1.5985 event; separate degree/version/episode, no independent simultaneous vote. |
| C5-R28 | AUTH-01/SOURCE-01 | Missing132-133,partial134 and duplicate125 retained in coverage; incomplete bars or unauthorized Engine22 structure cannot generate approved overlay/order; same-bar stop/target ambiguity stays unresolved. |

## Implementation sequence after manager review

Specify subtype, equality, overlap and “decisive” policies; obtain actual candle/metadata fixtures with known-at timing; implement candidate/evidence contracts and tests; verify historical execution feasibility independently; measure outcomes before deriving probabilities. The primitive three-swing candidate does not gain diagonal recognition merely because this registry exists.

Documentation validation covers page/figure accounting, stable IDs, relative links and highlighted arithmetic. No production classifier tests, market replay, option valuation backtest or broker reconciliation were executed in this study.
