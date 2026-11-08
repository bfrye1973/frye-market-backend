> Current review status: see the 2026-11-08 update at the end of this document and SOURCE_PAGE_INDEX.md. Earlier progress notes below are retained as history; neither chapter is complete.

# Engine 16 — Verified Chapter Study Notes (incremental; NOT COMPLETE)

Source: Gorman & Kennedy, *Visual Guide to Elliott Wave Trading*. Notes refer to **printed book page numbers** where visible; PDF page numbers may differ. Only the cited pages/figures below were read closely for this initial record. Additional pages are queued in `CHAPTER_COMPLETION_STANDARD.md`.

## Chapter 1 — *The Anatomy of Elliott Wave Trading*

### Printed pages 6–7 (Chapter 1 PDF scan page 4)
- **Five ways the principle helps:** trend identification, countertrend identification, recognizing trend maturity, providing price targets, providing specific points of invalidation. The chapter treats these as practical analysis aids, not guarantees.
- **Figures 1.2–1.4** illustrate wave proportions/possible extensions; the narrative notes wave 3 or 5 can extend and technical Fibonacci relationships can guide objectives. These are illustrations/guidelines, not hard classification tests.
- **Figure 1.5** shows a correction from an upward swing and the 0.382/0.618 retracement references. **Engineering implication:** target levels are price hypotheses; touching a target does not prove the correction is complete.
- **Figure 1.6** shows a multi-swing labeled correction after a motive move. **Engineering implication:** visual swing counts must be checked against exact wave subdivisions before being promoted to confirmed Elliott structures.
- The page lists **three explicit invalidation examples**: (1) Wave 2 never retraces more than 100% of Wave 1; (2) Wave 4 does not enter Wave 1 price territory in a standard impulse; (3) among the actionary waves 1, 3, and 5, Wave 3 cannot be shortest. **Engineering implication:** implement separate strict validation for *standard impulses*, and treat diagonals using separate rules; reject candidates violating unambiguous impulse constraints.
- The heading **The Four Best Waves to Trade** discusses wave 3, 5, A and C; this is an author trading preference, *not* a mandatory classification rule or a forecast guarantee.

### Candidate rule registry
| ID | Kind | Trace | Candidate engine interpretation | Approval |
|---|---|---|---|---|
| C1-IMP-01 | STRICT (standard impulse) | Book p.7, invalidation rule 1 | Reject when wave 2 breaches origin of wave 1 | Manager pending |
| C1-IMP-02 | STRICT (standard impulse) | Book p.7, invalidation rule 2 | Reject standard impulses whose wave 4 enters wave 1 territory; separate diagonals | Manager pending |
| C1-IMP-03 | STRICT (standard impulse) | Book p.7, invalidation rule 3 | For known waves 1/3/5, reject wave 3 shortest | Manager pending |
| C1-FIB-01 | GUIDELINE | Book p.6, Fig 1.5 | Project common retracements but never confirm wave solely on Fib touch | Manager pending |
| C1-TRD-01 | TRADING OPINION | Book p.7, Four Best Waves section | Do not implement as a trade permission rule | Not proposed |

## Chapter 2 — *How Zigzags and Flats Set Up a Trade for the Next Impulse Wave*

### Printed pages 26–27 (Chapter 2 PDF scan page 5)
- **Case study:** Techne Corporation (TECH), 60-minute chart, March 2012. The author describes an interpretation where a possible expanded flat countertrend pattern is forming, then outlines a bearish plan conditioned on completion of the corrective wave.
- **Figure 2.5** includes labeled A-or-1 and B-or-2 alternatives and a proposed C-or-3 downward path. **Engineering implication:** do not collapse ambiguous wave labels into a certain flat; retain two competing structural interpretations.
- **Figure 2.6** shows a proposed short sale around **69.29** (price as visible in scan), representing a *historical example*, not an ES price or current recommendation.
- The author discusses arranging a plan after the countertrend movement and using structure to determine whether the view is tradable. **Engineering implication:** Engine 16 can output scenario evidence and invalidation references but should not turn this historical trade illustration into automatic execution or permission.

### Candidate casebook record
- **ID:** C2-TECH-EXPFLAT-2012-FIG25-26
- **Market/timeframe:** TECH, 60-minute, spring 2012
- **Source:** Chapter 2, printed p.26–27, Figures 2.5 and 2.6
- **Interpretation:** possible expanded flat vs other corrective/impulsive scenario, not indisputably confirmed
- **Candidate data fields:** `pivotA`, `pivotB`, `pivotC`, `scenarioAlternatives`, `confirmationTime`, `invalidationPrice`, `priceBasis`
- **Testing requirement:** replay sequential historical bars; model both alternatives as of analysis date, no subsequent hindsight relabeling
- **Missing from this first-pass note:** exact dated bar anchors, full detailed inner subdivisions, full execution/invalidation reasoning; pending full-resolution review, not suitable as a numeric replay fixture

## Important distinction
The source examples are a mixture of method, illustrative theory and trading choices. None of the above constitute owner-approved ES wave counts or fully validated implementation tests. Marking the chapters COMPLETE requires covering *all* scanned pages and case studies, not just these examples.

## 2026-11-08 expanded source review and explicit corrections

All 8 Chapter 1 and 23 Chapter 2 supplied PDF pages have now been visually inspected, including duplicate and partial scans. The detailed records cover 11 supplied Chapter 1 and 38 supplied Chapter 2 figures. This does **not** establish complete printed-chapter coverage. Chapter 1 lacks printed pp.12-13. Chapter 2 lacks pp.30-32,56-57,66-67, has an incomplete p.69, and its ending is unverified. Chapter 3 remains blocked. Manager approval is pending; 28 replay checks are proposed specifications, not implemented or executed tests. No production code, Engine 22 counts, merge or deployment changed.

The preceding notes remain an initial record, not the current comprehensive available-page casebook. Correct the following before relying on them for code:

1. TECH Fig 2.6/p.27 trigger is **69.28**, not 69.29. Fig 2.8 later revises it to 69.50; retain dated versions.
2. Chapter 1 p.7 describes where wave 4 **ends** relative to wave 1 territory. The earlier blanket 'enters' wording is stronger than the supplied wording. Endpoint versus intrawave wick and equality policy require M-02 review; neither policy is approved here.
3. Fig 1.4/p.6 illustrates **first-wave extension**, alongside the third/fifth extension illustrations. Do not omit it from the research taxonomy.
4. TECH's internal expanded-flat rebound is inside a larger B/2 scenario. Its internal a-b-c must not be confused with larger A/1 -> B/2 -> projected C/3.
5. A 5-3-5 or 3-3-5 pattern requires child structure evidence. Four outer pivots do not establish either subtype. The current abcCandidates filter excludes expanded-flat B overshoots and must remain unvalidated.
6. CAT Fig 2.4's $3,750 'profit' annotation appears to be gross proceeds; net before costs from the shown option values is $2,890 (~336.05%). AUD Fig 2.22 reports .9354 exit while retaining a .9230 stop label; protection chronology is unresolved. Neither discrepancy should be silently converted into training truth.

- [Source page index](SOURCE_PAGE_INDEX.md)
- [Chapter 1 detailed study](CHAPTER_01_DETAILED_STUDY.md)
- [Chapter 2 chart casebook](CHAPTER_02_CASEBOOK.md)
- [Rule registry](RULE_REGISTRY_CH01_CH02.md)
- [Implementation and 28 replay specifications](IMPLEMENTATION_REPLAY_CH01_CH02.md)
- [Manager review / missing sources](MANAGER_REVIEW_CH01_CH02.md)

All source-derived statements are separated from engineering proposals. Missing pages prevent completion of regular/running-flat, triangle/diagonal and combination specifications. Manager decisions and actual implementation/test evidence remain pending.
