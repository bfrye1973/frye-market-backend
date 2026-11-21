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
