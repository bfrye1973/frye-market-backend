# Engine 16 - manager review request for available Chapter 1-2 research

Date: 2026-11-08. Request: review the source interpretations and proposed predicates below. **Not a request to mark either chapter COMPLETE, merge production, deploy, alter Engine 22, or approve trades.** Branch is isolated from the programming teammate. Owner remains final approval authority.

## Evidence delivered

- [Source page index](SOURCE_PAGE_INDEX.md): all 8 Chapter 1 and 23 Chapter 2 PDF pages visually examined, including duplicates/cropped areas; cryptographic source fingerprints and missing-page manifest.
- [Detailed Chapter 1 study](CHAPTER_01_DETAILED_STUDY.md): supplied-page lessons and all 11 supplied figure IDs.
- [Chapter 2 casebook](CHAPTER_02_CASEBOOK.md): five cases and all 38 supplied figure IDs, keeping forecasts, later observations and outcomes separate.
- [Rule registry](RULE_REGISTRY_CH01_CH02.md): strict source statements versus guidelines/examples and our design proposals; stable IDs and source links.
- [Implementation/replay proposal](IMPLEMENTATION_REPLAY_CH01_CH02.md): read-only prototype findings, proposed contracts and 28 replay/test specifications. No implementation or execution claim.

## Source requests required for completion

1. Chapter 1 printed pp.12-13, including Figs 1.11-1.13 and continued prose.
2. Chapter 2 printed pp.30-32, 56-57 and 66-67, including Figs 2.9-2.11, 2.34-2.35 and 2.42-2.43.
3. Complete Chapter 2 p.69 and all following pages through its end. Current scan ends mid-discussion; chapter ending not verified.
4. For executable historical fixtures: authorized raw bar histories, sessions/timezones/price bases and exact as-of cutoffs. Static charts are not raw data.

## Decisions requested (all PENDING)

| ID | Question needing judgment | Research recommendation / consequence |
|---|---|---|
| M-01 | Does wave2 exactly touching wave1 origin fail the standard impulse? What is the comparison's tick/price basis? | The supplied p.7 wording alone doesn't settle equality. Keep boundary UNKNOWN until approved; reject an unequivocal beyond-origin breach. |
| M-02 | For wave4 overlap, use terminal pivot, any intrawave extreme, or another approved interpretation? Does exact boundary contact count? | Source says ending in wave1 territory; preliminary any-entry wording needs correction. Do not silently choose a permissive wick exception or strict wick rejection. |
| M-03 | Wave3 shortest ties: can equal lengths pass? How measure lengths for diagonals/extensions? | Use explicit family-specific predicates and raw same-basis price magnitudes. Do not assume3 must be longest; resolve ties explicitly. |
| M-04 | What qualifies a B/internal-iv break or a decisive2-4 line close: wick, completed close, tick buffer, persistence? | Separate confirmation observations from structural proof. No single automatic confirmation threshold derived from these discretionary examples. |
| M-05 | Which child structures count as motive-five/corrective-three, including diagonals and B triangles? | Require validated child grammar; retain UNKNOWN when unsupported. Leading diagonals and full flat/triangle grammar need additional source review. |
| M-06 | Can every seven-degree mapping and parent relationship come from Engine22's current contract? | Yes as proposed ownership; verify exact contract before implementation. Book timeframes/notational degrees must not create competing hierarchy. |
| M-07 | How should provisional candidates be superseded, confirmed research interpretations revised and corrected source bars handled? | Append dated revisions; immutable observation anchors and saved as-of outputs. Engine22 approval distinct from Engine16 research confirmation. |
| M-08 | Pivot strength, plateau/tie handling and same-bar high/low order? | Do not invent intrabar ordering. Publish ambiguity or require finer bars. Delayed pivot clock uses actual bar close and availability. |
| M-09 | Does Fibonacci need a new three-anchor contract and instrument-specific rounding/tolerance? | Yes: preserve measured move, origin, raw/display prices and provenance. Keep existing two-anchor function's meaning unchanged until migration approved. |
| M-10 | How to label confidence and rank alternatives before calibration? | Qualitative/heuristic evidence with disclosed reasons; no invented probability from author 'high confidence'. Unresolved is valid output. |
| M-11 | Resolve CAT gross-proceeds/profit annotation and AUD exit/stop snapshot mismatch? | Keep contradictions explicit; do not infer broker outcomes or unshown stop adjustments. Missing silver execution pages block full P&L reconstruction too. |
| M-12 | Full combination grammar for coffee W-X-Y, including X overshoot and eligible Y families? | Review missing pp.66-67 and full ending first; conditional p.68 statement is not a complete universal parser. |
| M-13 | Which source case should become first executable replay, and what is the approved data source/basis? | Start with CAT simple zigzag, TECH expanded-flat alternative and coffee failed setup as a trio; no fabricated chart OHLC. |
| M-14 | Can live provisional research run outside the chart render path with separate close-confirmation publishing? | Recommended; define latency/freshness budget, event availability, bounded search and restart/idempotency requirements before integration. |

## Corrections and programming implications

The earlier notes' TECH 69.29 is corrected to **69.28** from p.27/Fig2.6. Chapter1 Fig1.4 illustrates a **first-wave** extension, so the extension inventory cannot be limited to waves3/5. The initial chapter1 notes overstated source wave4 wording; M-02 blocks automatic translation. These corrections preserve the old notes as an initial record with an explicit superseding addendum.

At audited PR #265 head fe8e6683ee8c334083539557e637cef3d54523d5, `abcCandidates` excludes the expanded-flat B overshoot and validates no child subdivisions; it must stay unvalidated. `fibonacciLevels` is start-origin/two-anchor and does not express the chapter's third-anchor projections directly. Pivot `confirmationTime`/snapshot `asOf` use bar.time without establishing start-versus-close availability. Outside-bar pivot order and lifecycle/alternatives remain unimplemented. Detailed findings in the implementation document are requests for scoped design review, not unilateral code changes.

## Approval record template

For each M-ID, record decision, rationale, source pages reviewed, approved rule IDs/predicate version, allowed scope, reviewer and date. Disapproval is recorded too. Code-function/test mapping remains PROPOSED/NOT IMPLEMENTED until actual programming and test evidence exist. Chapter completion requires all missing source pages and manager-review gates. Chapter3 remains blocked.
