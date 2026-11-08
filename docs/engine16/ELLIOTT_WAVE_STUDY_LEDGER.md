> **Current Chapter 4 update, 2026-11-08:** Owner supplied Chapter 4 to continue this study, superseding earlier no-Chapter4 study language for this chapter only. All 13 supplied scans / 24 printed pages / 23 figures are studied and documented in [CHAPTER_04_SOURCE_AND_HANDOFF.md](CHAPTER_04_SOURCE_AND_HANDOFF.md). Printed115/Fig4.16 is absent and uninspected. Supplied-source research is finished and ready for manager review; full-source and formal COMPLETE gates remain separate. Twenty-four new replay specifications bring the cumulative total to80 proposals, not implemented/executed tests. No runtime, merge, deployment or Chapter5 authorization follows. Older progress and hold statements below are historical.

> **Chapter3 update,2026-11-08:** Owner explicitly authorized Chapter3 study. Its supplied-source research is finished; [CHAPTER_03_SOURCE_AND_HANDOFF.md](CHAPTER_03_SOURCE_AND_HANDOFF.md) is the current index. Earlier Chapter3 hold language below is historical. Chapter1-2 decisions and production authorization remain unchanged.

> **Final research status, owner decision 2026-11-08:** The Chapter 1-2 research deliverable is FINISHED and ready for manager review. The owner accepted omission of Chapter 2 pp.30-32/Figs2.9-2.11; those pages remain uninspected and are no longer an open source request. Do not request them again to finish this assignment. All 39 supplied PDF pages and 62 unique figures are reviewed; 36 replay specifications are documented, not implemented/executed. Manager predicate approval and production authorization remain separate. See [RESEARCH_HANDOFF_CH01_CH02.md](RESEARCH_HANDOFF_CH01_CH02.md) for the current scope, deliverable index and next handoff. Earlier incomplete/source-request statuses below are historical and superseded.

> **Current source status after supplemental scan, 2026-11-08:** Chapter 1 printed pp.3-17 are fully supplied and visually reviewed. Chapter 2 now ends at p.75 and lacks only printed pp.30-32 (TECH Figs2.9-2.11). Combined review:39 PDF pages,62 unique figures,36 proposed replay specifications. Manager review remains pending; neither chapter is COMPLETE; Chapter3 stays blocked. Earlier missing-page references below describe the first scan set and are superseded by [SUPPLEMENTAL_SOURCE_REVIEW.md](SUPPLEMENTAL_SOURCE_REVIEW.md).

> Current review status: see the 2026-11-08 update at the end of this document and SOURCE_PAGE_INDEX.md. Earlier progress notes below are retained as history; neither chapter is complete.

# Engine 16 — Elliott Wave Study Ledger

**Purpose:** Persistent training record for the replacement Engine 16 live ABC and Elliott Wave structural tracker. This is a *study ledger*, not authority to deploy or alter Engine 22 approved counts.

**Source:** Wayne Gorman and Jeffrey Kennedy, *Visual Guide to Elliott Wave Trading* (Bloomberg). Owner-provided scans from November 8, 2026. Copyrighted source pages stay with owner; do not commit scans, book passages, or copied diagrams to this repository.

## Study protocol (mandatory)
1. Read every page and inspect every labeled chart; note book page and figure number.
2. Record author-derived statements separately from our own mathematical implementation decisions and external Elliott Wave conventions.
3. For each structure: starting pivot; internal subdivisions; constraints; candidate confirmation; invalidation; alternate counts; evidence timeframe; degree; provenance.
4. Label each extracted rule as STRICT, GUIDELINE, EXAMPLE, or OPEN QUESTION. Never turn a guideline into a hard rule without manager approval.
5. Convert every approved strict rule into deterministic unit tests; add chronologically replayable examples (no future candles or repainted confirmed pivots).
6. Obtain manager review of the rulebook before implementing orthodox corrective-pattern classification or production integrations.
7. Maintain traceability: source chapter/book page -> rule ID -> code function -> test -> manager approval.

## Source inventory and review progress
| Source | Owner upload | Review status | Notes |
|---|---|---|---|
| Foreword | Foreword.pdf, 3 scanned PDF pages | PARTIAL | Initial review, not complete rule extraction |
| Chapter 1: The Anatomy of Elliott Wave Trading | Chapter 1.pdf, 8 scanned PDF pages | PARTIAL | Initial review of scans and illustrations |
| Chapter 2: How Zigzags and Flats Set Up a Trade for the Next Impulse Wave | CHAPTER.pdf, 23 scanned PDF pages | PARTIAL | Pages sampled; comprehensive page/figure extraction pending |

**Do not mark any chapter COMPLETE until its entire PDF and all diagrams have been independently reviewed.**

## Chapter 2 — initial rule candidates (NOT YET APPROVED)
- C2-001 [OPEN REVIEW]: Zigzag is typically a 5-3-5 corrective subdivision. Validate specifics against chapter pages and figures; distinguish textbook convention from actual chart evidence.
- C2-002 [OPEN REVIEW]: Flat is typically a 3-3-5 corrective subdivision. Classify regular, expanded, and running variants separately after review.
- C2-003 [OPEN REVIEW]: Countertrend patterns can precede the next impulse. Do not treat an ABC-like three-swing sequence as sufficient proof that an impulse will follow.
- C2-004 [OPEN REVIEW]: Every candidate must retain its actual as-of timestamp and invalidation level; compare alternatives without hindsight.

## Current code caution
Draft PR #265 implements primitive pivot, Fibonacci, FVG and **unvalidated three-swing ABC candidate** functions only. It does NOT enforce Chapter 2 internal wave subdivisions and must not be presented as orthodox zigzag/flat recognition.

## Chapter 2 deep-review worksheet
For each page/figure record:
- Book page / figure / market / timeframe:
- Author's observed count and narrative:
- ABC pivot sequence and internal wave count:
- Rule type and numerical conditions:
- Entry context, invalidation, targets (if explicitly shown):
- Alternative and how evidence distinguishes it:
- Engine 16 candidate detection / state transition:
- Replay fixture and expected result:
- Ambiguities / manager ruling needed:

## Approval state
- Elliott Wave rulebook: IN PROGRESS
- Chapter 2 comprehensive study: NOT COMPLETE
- Manager approval: NOT REQUESTED for extracted rules
- Production authorization: NOT GRANTED

## 2026-11-08 source-study update (supersedes earlier progress rows)

All 8 Chapter 1 and 23 Chapter 2 supplied PDF pages have now been visually inspected, including duplicate and partial scans. The detailed records cover 11 supplied Chapter 1 and 38 supplied Chapter 2 figures. This does **not** establish complete printed-chapter coverage. Chapter 1 lacks printed pp.12-13. Chapter 2 lacks pp.30-32,56-57,66-67, has an incomplete p.69, and its ending is unverified. Chapter 3 remains blocked. Manager approval is pending; 28 replay checks are proposed specifications, not implemented or executed tests. No production code, Engine 22 counts, merge or deployment changed.

The original PARTIAL inventory and preliminary candidates above are retained as a historical first-pass record. The current available-page extraction, corrections and approval queue are linked below. No scan or copied diagram is committed.

- [Source page index](SOURCE_PAGE_INDEX.md)
- [Chapter 1 detailed study](CHAPTER_01_DETAILED_STUDY.md)
- [Chapter 2 chart casebook](CHAPTER_02_CASEBOOK.md)
- [Rule registry](RULE_REGISTRY_CH01_CH02.md)
- [Implementation and 28 replay specifications](IMPLEMENTATION_REPLAY_CH01_CH02.md)
- [Manager review / missing sources](MANAGER_REVIEW_CH01_CH02.md)

Source fingerprints and exact PDF-to-book-page mappings are in SOURCE_PAGE_INDEX.md. Stable earlier C1 rule IDs remain; C2-001..004 crosswalks appear in the new registry. Next work is missing-page acquisition, source reconciliation, manager decisions, then approved programming and actual replay evidence. Neither chapter is COMPLETE.

## Supplemental study progress - current

[SUPPLEMENTAL_SOURCE_REVIEW.md](SUPPLEMENTAL_SOURCE_REVIEW.md) records8 additional supplied PDF pages,13 new unique figures, closed Chapter1 source gap, silver quantity/outcome reconciliation and coffee conclusion. Total39 PDF pages/62figures/36 proposed replay checks. Chapter1: sourceREAD and draft extraction complete, manager review pending. Chapter2: only printed30-32/Figs2.9-2.11 missing; ending75verified. No chapter COMPLETE, no Chapter3, no implementation/test execution or production change. Earlier source/progress rows are historical and superseded by this update.

## Owner-accepted source scope and finalized handoff

On 2026-11-08 the owner closed the Chapter 2 pp.30-32 source request and directed completion using available material. Those pages and Figs2.9-2.11 remain unverified; do not fabricate their content or use them as fixtures. The available-source research deliverable is finished. [RESEARCH_HANDOFF_CH01_CH02.md](RESEARCH_HANDOFF_CH01_CH02.md) is the final index/status. Manager rule decisions and implemented/executed tests remain pending; no automatic Chapter3, merge or deployment authorization follows.

## Chapter3 supplied-source research finished -2026-11-08

The owner explicitly requested Chapter3 study after the Chapter1-2 handoff, superseding the earlier study hold for Chapter3 only. Accepted source Chapter3(1).pdf is distinct from the earlier mislabeled duplicate; identity/fingerprint and all10PDFpage mappings are documented. All19supplied printed Chapter3pages and17supplied figures are studied. Printed80-81/Figs3.3-3.4 are absent and remain uninspected; Chapter2's source exception is not automatically extended. The chapter ends97.

Current deliverable: [CHAPTER_03_SOURCE_AND_HANDOFF.md](CHAPTER_03_SOURCE_AND_HANDOFF.md), linking detailed study, rule registry, programming/replay proposals and manager review. Twenty new C3-R01..C3-R20 specifications make56total research specifications, none implemented/executed by this study. All supplied-source work is finished; full-source/formal managerCOMPLETE gates remain separate.

Priority reconciliation: Chapter3p91 distinguishes invalidating terminalE from rejecting the parent triangle. C2-TRI-01/R-32 require entity-scoped interpretation under C3-INV-01/02. No approved Engine22 counts or runtime code changed; no Chapter4 authorization.
