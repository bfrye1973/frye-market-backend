# Engine 16 - Chapter 3 source inventory and research handoff

Date: 2026-11-08 (America/Phoenix). Reviewer: Engine 16 research assistant. Source: Wayne Gorman and Jeffrey Kennedy, *Visual Guide to Elliott Wave Trading*, Chapter 3, **How a Triangle Positions You for the Next Move**.

Status: **SUPPLIED_SOURCE_RESEARCH_FINISHED / READY_FOR_MANAGER_REVIEW**. The owner's explicit request to complete Chapter 3 authorizes this study despite the prior hold. It does not approve unresolved Chapter 1-2 predicates, authorize code changes, or authorize Chapter 4. Full chapter-source coverage is not claimed: printed pp.80-81 are absent. The Chapter 2 page waiver is not silently extended to Chapter 3.

## Source identity and method

| Field | Verified value |
|---|---|
| Accepted filename | Chapter 3(1).pdf |
| Source ID | SRC-C3-20261108 |
| PDF pages | 10 |
| Bytes | 101536787 |
| SHA-256 | 07e15bec69b77a983bb22f8c3d80c857aabf680af7d3fa8673e5a8ceb25b649e |
| Chapter printed span | pp.77-97, ending established by summary/resources on p.97 |
| Supplied chapter pages | p.77, pp.78-79, pp.82-97: 19 of 21 printed pages |
| Supplied figures | 3.1-3.2 and 3.5-3.19: 17 unique figures |
| Absent source | pp.80-81, Figs3.3-3.4 |

All ten supplied PDF pages were rendered and visually examined, including both sides of spreads. PDF1/2/10 were rotated for reading. Skew, warm lighting and clipped margins are noted below. Supplemental higher-resolution crops were used where necessary in the preceding research workflow; no OCR transcript is treated as source truth. No copyrighted scan or copied chart is committed.

The earlier upload named Chapter 3.pdf had the same SHA-256 as the Chapter 1-2 supplement and was rejected as a Chapter 3 source. Its eight pages do not add to Chapter 3 coverage. The corrected file identified above is distinct.

## Every PDF page and printed-page mapping

| PDF page | Printed pages | Figures | Page/illustration study record |
|---:|---|---|---|
| 1 | Chapter3p.77; facing prior-chapter exercise fragment | None | Chapter title and gold opening. Sideways/converging geometry, D trigger822.8, initial E protection788.1, discretionary buffered order825.0. Facing exercise questions are not Chapter3 rules or answered statements. |
| 2 | 78-79 | 3.1,3.2 | Bullish wave4 triangle versus bearish B-triangle interpretation; independent plans and protective anchors. Left p.78 visible; right p.79 inferred by spread continuity. |
| 3 | 82-83 | 3.5,3.6 | Gold advance, projected third target858.1, stops815/845; retrospective797.1 stop report. pp.80-81 absent, not read or inferred. |
| 4 | 84-85 | 3.7,3.8 | Fourth-wave retracement target840.51,855.2 protection; later small triangle and860 protection. Prose also cites843.0, which conflicts with displayed target. |
| 5 | 86-87 | 3.9,3.10 | Tightened875 protection and hypothetical stop-out; reported1660/contract,8300 aggregate. Warm lighting, some edge clipping; core values readable. |
| 6 | 88-89 | 3.11,3.12 | End of gold discussion; DELL contracting fourth wave; origin30.77; assumed terminal E20.81; parent triangle width3.03 projected17.78. |
| 7 | 90-91 | 3.13 | DELL channels, alternative equality targets, midpoint17.66, hypothetical entry20.39/stop21.19; source distinguishes E invalidation from whole-triangle invalidation. Right edge crops definition box; central prose is legible. |
| 8 | 92-93 | 3.14,3.15 | Daily hesitation; hourly E resolves as nested triangle with final20.30; stop20.31 and revised target17.15. Right edge clips callout; nested-E conclusion is also explicitly stated in main prose. |
| 9 | 94-95 | 3.16,3.17 | Five down to18.13; possible small internal fourth triangle; projection17.96 from20.30/18.53/19.05; ambiguity full5 versus first part retained. Left p.94 inferred; right95 visible. |
| 10 | 96-97 | 3.18,3.19 | Hourly channel break, hypothetical buy-to-cover18.48 and1.91/share; daily aftermath confirms broader reversal later; summary/resources close chapter. Rotated spread. |

The title page and final resources establish the chapter span, and the figure sequence identifies the two missing figures. There is no reason to invent their contents. Later visible prose may be recorded as retrospective report about earlier events; it cannot reconstruct the absent figures' exact as-of state.

## Deliverable map

| Deliverable | File | Scope |
|---|---|---|
| Detailed concepts and figure casebook | [CHAPTER_03_DETAILED_STUDY.md](CHAPTER_03_DETAILED_STUDY.md) | Gold and DELL, all 17 supplied figures, targets, alternatives, changing completion candidates and outcomes |
| Candidate rule registry | [CHAPTER_03_RULE_REGISTRY.md](CHAPTER_03_RULE_REGISTRY.md) | Strict structural statements versus guidelines/examples and our design proposals; earlier-rule crosswalk |
| Programming and replay requirements | [CHAPTER_03_IMPLEMENTATION_REPLAY.md](CHAPTER_03_IMPLEMENTATION_REPLAY.md) | Proposed hierarchical invalidation, nested triangles, projection geometry and 20 new replay specifications |
| Manager questions and decisions | [CHAPTER_03_MANAGER_REVIEW.md](CHAPTER_03_MANAGER_REVIEW.md) | C3-M01..C3-M10; no fabricated approvals |
| Current chapter status | This file and study ledger | Supplied-source research finished; complete-source and manager gates remain distinct |

## Primary findings for the manager and programmer

1. The source on p.91 explicitly distinguishes **invalidating terminal E** from **invalidating the whole triangle**. In the contracting/barrier example, crossing C can defeat the E-complete hypothesis while C may still be developing; crossing A defeats the whole triangle case. This qualifies Chapter2 C2-TRI-01 and R-32: do not reject every parent automatically on an E/C failure.
2. Gold permits a wave4 bullish interpretation and a B-wave bearish alternative before later evidence distinguishes them. A common triangle shape alone does not establish direction. Buffering an illustrative order is a trading guideline, not an Elliott validity rule.
3. DELL's E contains another triangle. The larger triangle still supplies the post-triangle width; the nested E does not replace the parent's measurement scope.
4. Width projection, equality/.618 targets and a midpoint blend are separate target models. A projected minimum is a guideline, not a promised destination: the modeled DELL trade exits profitably before its projected downside target.
5. Model/report assumed fills as hypothetical. DELL's20.39 entry and18.48 exit are midpoint assumptions; neither is an independently verified execution. Gold's8300 outcome is author-reported hypothetical arithmetic, not validated contract P&L.

## Completion, next handoff and limitations

All supplied pages/figures have detailed extraction, rule linkage and proposed replay requirements. Twenty new specifications C3-R01..C3-R20 are **not implemented or executed**. Combined with the prior36 there are56 research specifications; this is not a test-pass count. Source page80-81 coverage and historical raw bars remain unavailable. Manager decisions remain pending. No accuracy or probability is inferred from book terminology.

Review C3-M01 first because it changes how earlier triangle boundary proposals must be scoped. Then review geometry/target semantics, scenario timing and source numeric discrepancies before authorizing a programming slice. Engine11 remains candle authority, Engine22 remains approved-wave authority, and Engine16 remains research-only. No merge/deploy or Chapter4 study is authorized by this handoff.
