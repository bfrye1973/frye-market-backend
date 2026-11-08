> **Current source status after supplemental scan, 2026-11-08:** Chapter 1 printed pp.3-17 are fully supplied and visually reviewed. Chapter 2 now ends at p.75 and lacks only printed pp.30-32 (TECH Figs2.9-2.11). Combined review:39 PDF pages,62 unique figures,36 proposed replay specifications. Manager review remains pending; neither chapter is COMPLETE; Chapter3 stays blocked. Earlier missing-page references below describe the first scan set and are superseded by [SUPPLEMENTAL_SOURCE_REVIEW.md](SUPPLEMENTAL_SOURCE_REVIEW.md).

# Engine 16 - Chapter 1 detailed study of supplied pages

Source: Gorman and Kennedy, *Visual Guide to Elliott Wave Trading*, Chapter 1, printed pp.3-11, 14-17. Source inventory: [SOURCE_PAGE_INDEX.md](SOURCE_PAGE_INDEX.md). Study date 2026-11-08. **Incomplete chapter: printed pp.12-13 absent.** All explanations are paraphrases; software decisions are separately labeled proposals. This is research, not trading authorization or an independently validated performance claim.

## p.3: recognition, analysis and trading are separate tasks

The opening distinguishes interpreting price structure from carrying out a trading method. The authors' trading preferences depend on horizon, portfolio and tolerance for loss; they are not universal Elliott validity constraints. The introductory recognition inventory contains impulse, ending diagonal, zigzag, flat and triangle. Motive versus corrective is the first useful distinction: the former advances the relevant larger trend, while the latter interrupts it. This passage is an introductory inventory, not a complete specification of every structure requested in the Engine 16 handoff. In particular, it does not establish a leading-diagonal detector.

Implementation proposal (C1-CTX-01): publish structural family and uncertainty independently from any trade plan. A recognized pattern does not produce LONG/SHORT permission. A missing recognizable pattern should produce UNRESOLVED, not a forced label. Parent direction must accompany any trend claim: a rising B wave can be corrective within a larger decline.

## pp.4-5: five analytical uses and the context problem

The chapter compares trend indicators, oscillators and sentiment measures with structural analysis. Its criticism is that those measurements alone do not describe a move's place in a larger sequence. It presents five benefits: identify the trend, identify countertrend action, assess maturity, estimate price objectives, and locate invalidation. Those are author claims about analytical utility, not calibrated statistical confidence levels for this software.

The maturity example is specific: when a fifth wave already contains several of its expected smaller waves, there may be less remaining trend development than at the start. The same local direction can therefore have different structural implications at different stages. A larger wave comprises smaller motive and corrective sequences. A three-wave countertrend move may permit the prior trend to resume, but its completion must be tested rather than assumed from three visible swings.

Fig 1.1 casebook (C1-FIG-01): schematic of a nested upward five-wave sequence and a following correction. The diagram carries multiple notational degrees, but no symbol, dates or price scale. Its observed evidence is the drawn hierarchy; it has no historical as-of record. It supports a parent-child representation, not a historical ES fixture or a fixed degree-to-timeframe mapping. Test proposal R-08 requires every child to retain parent identity and temporal boundaries; R-01 prevents assigning a finished fifth before its evidence exists.

## pp.6-7: targets are evidence; impulse constraints invalidate

The authors discuss equality and Fibonacci multiples among motive segments, including 1.618 and 2.618 and their inverse ratios. Corrective objectives use portions of the prior advance/decline. A target is an area to watch, not proof that a structure has ended. The text also suggests that exceeding a correction's B extreme can support resumption of the prior trend. Such a break is an observation/confirmation guideline, distinct from verifying every child subdivision.

| Figure ID | Source | What the drawing establishes | Engine 16 use and limits |
|---|---|---|---|
| C1-FIG-02 | Fig 1.2, p.6 | Third-wave extension schematic, with a 1.000 relationship between other motive portions | Preserve compared anchors and measured wave IDs. No requirement that every wave 3 extend. |
| C1-FIG-03 | Fig 1.3, p.6 | Fifth-wave extension schematic; a 1.618 relationship is illustrated | Distinguish which segment is being projected; do not reuse an unlabeled generic extension. |
| C1-FIG-04 | Fig 1.4, p.6 | First-wave extension; remaining move is illustrated with a .618 proportion | First-wave extensions are possible too. A detector limited to extended 3 or 5 omits this case. |
| C1-FIG-05 | Fig 1.5, p.6 | A-B-C retracement after wave 1; .618/.382 partition references | Specify measured range and retraced fraction. A Fib touch cannot confirm wave 2. |
| C1-FIG-06 | Fig 1.6, p.7 | Correction following wave 3; b overshoots its comparison high; .382/.618 partition references | The illustration itself warns against assuming B always stays within A's origin. Detailed subtype validation needs child evidence. |

These are scale-free illustrations. Neither absolute prices nor numerical as-of replay anchors can be extracted from them.

The three explicit impulse constraints on p.7 yield candidate rules C1-IMP-01/02/03. They concern: wave 2 exceeding a full retracement of wave 1; wave 4's termination within wave 1 territory; and wave 3 being shortest among 1, 3 and 5. They must be scoped to their structure, rather than applied indiscriminately to every correction or diagonal.

Two boundary questions remain open. First, the wave 2 wording excludes *more than* a full retracement; it does not by itself resolve whether an exact origin touch is a valid operational boundary. Second, the wave 4 wording concerns the *end* of the wave; an implementation rejecting every intrawave wick needs a separately approved interpretation. The preliminary notes were stronger than this wording. Neither a live wick exception nor an endpoint-only exception is approved here. Wave 3's final length comparison cannot be fully evaluated before wave 5 is known; the engine may expose a conditional fifth-length bound earlier, but must retain its assumptions.

## pp.7-9: preferred setups and confirmation

The authors favor participating in 3, 5, A and C, and illustrate corrective pauses as setups for those moves. Their preference is an execution guideline, not an extra Elliott rule. Fig 1.7 (p.8, C1-FIG-07) provides bullish and bearish mirror schematics with setups around waves (2), (4), (5) and (B). It does not establish win rates or specify ES entry orders. A completed fifth can precede the A leg of a larger correction; therefore detecting a reversal at one degree need not imply a reversal of every larger degree.

The discussion of corrections emphasizes complexity, duration and psychological difficulty. It allows that a correction on a sufficiently large horizon may contain meaningful shorter moves, whereas a small correction may offer little practical room. This is a horizon-dependent observation. Engine 16 should not suppress corrective evidence solely because the author prefers other trading setups.

The main confirmation principle on p.9 is to wait for price behavior supporting the interpretation. For a finished impulse, the illustrated reversal method looks beyond a prior internal fourth-wave extreme and uses the overall pattern extreme as protection. The text also discusses the common tendency of a correction to return near a preceding lesser-degree fourth-wave area. Neither tendency guarantees a destination.

## pp.10-11: figure casebook and different confirmation methods

| Case ID | Figure/page | Observed structure and proposed confirmation | Invalidation/protection and limitations |
|---|---|---|---|
| C1-FIG-08 | Fig 1.8, p.10 | Mirrored completed impulses; reversal evidence beyond internal (iv) of 5 | Protective extreme at 5; no numeric price or real-market test. Model trigger and structural state separately. |
| C1-FIG-09 | Fig 1.9, p.10 | Ending diagonals with overlapping, three-part internal labels; conservative trigger beyond wave 4 | Pattern extreme used for protection. Do not feed into a standard-impulse overlap validator. |
| C1-FIG-10 | Fig 1.10, p.11 | More aggressive diagonal approach using a decisive close through the line joining 2 and 4 | Line break differs from wave-4 extreme break. Exact close threshold needs approval. |

The accompanying diagonal discussion also considers entering during developing 5 when 3 is shorter than 1, using the constraint on 3's relative length to bound 5. This is a conditional aggressive example, not permission to announce a completed diagonal or a general rule that every diagonal contracts. Confirm the complete diagonal taxonomy before implementation.

The zigzag discussion on p.11 offers two approaches: a break beyond internal (iv) of C, qualified by its relationship to A's termination, or a break of B's extreme. In the second approach protection is at C's extreme. The missing pp.12-13 contain the referenced figures and the continuation, so the exact first-method qualification and flat methods must remain unresolved. Do not reverse-engineer absent Fig 1.11/1.12 solely from the prose fragment.

## pp.14-15: triangles and risk management

Fig 1.14 (p.14, C1-FIG-14) shows bullish/bearish triangle schemes with A-E, a subsequent break, and marked protection. The surrounding discussion notes that triangles can occupy 4, B or X and can mislead an analyst about the next move. The author does not endorse the aggressive triangle method here. The continuation discusses a more cautious initial reference at A rather than C for an early entry and notes that intraday excursions can be deceptive. The absent introduction prevents claiming a complete triangle-entry specification.

Risk/reward is illustrated arithmetically rather than as a statistical finding: $1 upside for $1 downside versus $10 upside for $1 downside, and a ten-trade example comparing 70% winners at 1:1 with 40% winners at 3:1. These assume the stated outcomes and omit real-world execution costs. They do not establish an Elliott win probability. The notation is described as reward relative to risk despite the section's name; software fields should be explicitly named to avoid inversion.

The discussion of trade size uses small fractions of capital and emphasizes surviving losing sequences. Engine 16 must not import those percentages as sizing policy; sizing belongs to the existing authorized pipeline. The same distinction applies to stop placement: a protective stop can be a trading choice, while structural invalidation is a statement about the interpretation.

## pp.16-17: process and psychology

Four process risks are discussed: no defined method, failure to follow it, unrealistic expectations, and impatience. The author asks for a written method that defines the tools, signals, protection and exits. The chapter cautions that attractive return claims may hide risk and encourages patience during unproductive market conditions. Its rough comments about how often markets trend are attributed opinion, not a measured dataset for our probabilities.

Implementation proposal C1-PROC-01: unknown evidence, no recognizable pattern and ambiguous alternatives are legitimate outputs. Persist the rule version and reasons for each interpretation so the programmer can reconstruct what was actually known. This is our design response to the chapter's process lessons, not the authors' prescribed software architecture.

## Work still required

Obtain pp.12-13 and review all missing figures and continuation text. Resolve the impulse boundary semantics and diagonal scope with the manager. Define as-of evidence, exact pivot segmentation and degree mapping through approved contracts. Implement and execute the tests only after rule approval. No chapter-complete status is justified yet; Chapter 3 remains blocked.

## Recovered pp.12-13 and closed source gap

C1-FIG-11,12,13 and their detailed lesson/implementation records are now documented in [SUPPLEMENTAL_SOURCE_REVIEW.md](SUPPLEMENTAL_SOURCE_REVIEW.md), section2. They distinguish internal(iv)ofC, B-extreme and five-through-B-then-correction zigzag evidence; family-qualified flat confirmation; and triangle D-extreme/E-protection guidance. Full chapter source coverage is established; precise boundary/confirmation policy and manager approval are still pending. The preceding 'work still required' source request for pp.12-13 is closed; no resubmission needed.
