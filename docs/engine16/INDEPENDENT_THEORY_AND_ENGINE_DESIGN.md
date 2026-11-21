# Engine 16 — Independent Elliott Wave Theory & Algorithm Design Research (2026-11-08)

**Status:** engineering recommendation, **NOT manager-approved rulebook or implemented software**. Owner delegated independent study while another teammate examines the source book. No production integration authorized.

## Sources independently checked
- StockCharts ChartSchool, [Guidelines for Applying Elliott Wave Theory](https://chartschool.stockcharts.com/table-of-contents/market-analysis/elliott-wave-analysis-articles/guidelines-for-applying-elliott-wave-theory): equality, alternation, corrective depth and channeling described as guidelines, not inviolable rules.
- StockCharts ChartSchool, [Identifying Elliott Wave Patterns](https://chartschool.stockcharts.com/table-of-contents/market-analysis/elliott-wave-analysis-articles/identifying-elliott-wave-patterns): degrees and labeling.
- [ELWAVE Elliott Wave rules and guidelines](https://www.elwave.com/elwave/faq/principle/principle2.html): correction/triangle grammar, illustrating differences between pattern types.
- [Elliott Wave Club — Elliott Wave 2.0 profiles](https://elliottwaveclub.com/elliott-wave-2-0/): deliberately simplified counting approach. **Alternative methodology, not Frye rule authority.**
- [Elliott Wave Radar design notes](https://casoon.github.io/pine-scripts/docs/market-structure/elliott-wave-radar/): example confirmed-pivot candidate enumeration with explicit confirmation delay and bounded pattern support. **Engineering inspiration only, not copied code.**

## Findings and source distinctions
1. Many explanations agree on fundamental standard-impulse constraints; **boundary equality, endpoint versus wick, triangles and diagonal families still require Frye-specific reviewed predicates**. Do not infer a manager decision from an internet article.
2. Guidelines (alternation, wave equality, channels, Fibonacci confluence, lesser-degree fourth area) are evidence, **never hard invalidations** in the absence of an approved family-specific rule.
3. Mechanical detection examples commonly use confirmed pivots, introducing delayed recognition. **An accurate real-time solution needs two channels:** provisional forming-wave updates on incoming data and confirmed pivots based on closed, chronology-valid bars. Never backdate detection as if observed at the pivot extreme.
4. Some public indicators only choose one best current pattern and retain a runner-up, or omit triangles/complex corrections. Frye should not inherit those limitations: retain multiple hierarchical candidates, stable history, and UNKNOWN when unsupported evidence is missing.
5. Different published 'mechanical Elliott' variants intentionally change the family catalog. Freeze a **versioned Frye grammar**, with provenance at rule level, before training any ranking heuristics.
6. There is no demonstrated source-grounded evidence that pattern counting alone predicts profitable trades. Design for auditable structure and honest replay, not untested win-rate or confidence claims.

## Proposed engine architecture, independent of book-study work

```
Engine 11 authoritative ES closed/live candles
    -> source contract validation + availability clocks + price basis
    -> multi-resolution swing observations (confirmed and provisional separate)
    -> wave candidate grammar / family-qualified child proof
    -> structural predicate evaluation PASS/FAIL/UNKNOWN
    -> alternative candidate graph with Engine 22 approved anchors READ ONLY
    -> model library (3-anchor Fibonacci, triangle geometry, invalidation)
    -> append-only as-of snapshots and lifecycle event log
    -> separate FVG and ES/QQQ/VIX SMT evidence
    -> engine16.structuralTracker.v1 read-only overlay -> Engine 2 chart
```

## Implementation order after manager rule approval
A. **Evidence layer:** explicit OHLC bar start/close/received/knownAt times, session alignment, missing data, physical ES contract/roll basis, source revision.
B. **Pivot layer:** causal chronological confirmed pivots, provisional extrema, tie/plateau and same-bar order as UNKNOWN until policy/lesser bars resolve. Preserve stable IDs.
C. **Grammar layer:** typed child candidate tree with strict standard impulse and properly differentiated zigzag 5-3-5, flat 3-3-5, diagonal, triangle and WXY grammar; require internal evidence, never label from coarse four-pivot geometry alone.
D. **Decision layer:** rule-result records with severity, scope (child/terminal interpretation/parent), evidence timestamp, source rule, predicate version; parent does not necessarily fail with nested child hypothesis (Chapter 3 E/C vs A case).
E. **Targets:** explicit measuredStart/measuredEnd/projectionOrigin; raw + rounded prices, tick-size and time/price basis. Separate parent triangle width, translated objective and midpoint blend; never overwrite older models.
F. **Alternatives/persistence:** multiple competing candidates, append-only snapshots with rulebookVersion and asOf; no silent historical repaint. Ranking after rule compliance, preferably qualitative until calibration.
G. **Evidence adjuncts:** FVG and SMT are independent signals; synchronize ES/QQQ/VIX sessions, mark stale/missing inputs unavailable; they cannot 'prove' wave subdivisions.
H. **Frontend:** fast candle rendering independent of Engine 16; overlay pack includes active candidate, nearest invalidation, completion status, targets, SMT/FVG and alternative chooser; seven degrees come from Engine 22 contract, not inferred fixed timeframe mappings.

## Candidate search performance
Use bounded, incremental dynamic programming over confirmed pivot evidence and typed children, with candidate deduplication keyed by structural anchors, degree, grammar version and parent scenario. Keep candidates pruned for presentation separate from retained historical research evidence. **Exact pruning budget and ranking must be calibrated and manager approved**; no arbitrary probabilities.

## Prioritized tests to build
1. Prefix-stability: results at historical cutoff unchanged when later bars added; restart/idempotency.
2. Valid impulse/invalid impulse vs diagonal with overlap boundaries; UP and DOWN symmetry.
3. Zigzag versus expanded flat with B overshoot and child proof; missing children UNKNOWN.
4. Triangle terminal E rejection scoped separately from parent rejection; nested E maintains parent width.
5. Fib raw/rounded targets with different anchors and ES tick; unknown source basis blocked.
6. Missing/closed/forming candles and delayed pivot confirmation, no future access.
7. Multiple candidate retention, model version replacement, parent-child degree consistent with Engine 22.
8. Engine 11/22/2 and execution pipeline unchanged by research failure.

## Coordination
Research teammate PR #267 (Chapters 1–2) and PR #268 (Chapter 3) contain book-sourced proposals and manager decision queues. **Their source-derived rules take precedence as explicit evidence; this document is external corroboration and engineering design, not replacement.** Record disagreements and unresolved source boundary conditions, ask manager to decide before encoding hard predicates. No changes to production or legacy strategy functions.
