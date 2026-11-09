# Engine 16 - Chapter 5 rule registry

Status: proposed for manager review. STRICT identifies a structural condition in the discussed contracting subtype, not production approval. GUIDELINE is a tendency, EXAMPLE a historical/model choice, DESIGN our engineering proposal. [Casebook](CHAPTER_05_DETAILED_STUDY.md); [replays](CHAPTER_05_IMPLEMENTATION_REPLAY.md).

| ID / class | Source | Preconditions / interpretation | Scope, failure and uncertainty |
|---|---|---|---|
| C5-POS-01 STRICT |125,153 | Ending diagonal occupies terminal5 of impulse or C of flat/zigzag, within an authorized parent/degree | Reject arbitrary nonterminal role for this classifier. Leading diagonal not covered by these rules. |
| C5-SUB-01 STRICT |146;5.22 | Five diagonal legs with single/multiple zigzag internals, not five ordinary impulse children | A wedge/outer pivots alone is UNVERIFIED. Multiples have their own internal children/connectors. |
| C5-LEN-01 STRICT |125,127,148,153 | In contracting form,3 shorter than1 and5 shorter than3; length5 ceiling projected from4 | Longer5 defeats this contracting hypothesis, not every possible parent pattern. Equality/buffer/tolerance needs approved policy; expanding subtype outside reviewed scope. |
| C5-OVL-01 GUIDELINE |146;5.22 | Wave4 generally overlaps1 in diagonal; evaluate subtype-specific overlap | Do not apply Chapter4 ordinary-impulse restriction wholesale. Source note “almost always” leaves exact-touch/absence policy unresolved. |
| C5-SHAPE-01 GUIDELINE |145-146;5.21-5.22 | Overlapping five legs and contracting1-3/2-4 boundaries support diagonal | Shape alone insufficient; line coordinates must use actual pivot times. |
| C5-THROW-01 GUIDELINE |146,151-152 | Fifth may exceed1-3 boundary briefly, then reverse | Throw-over optional/supportive, not standalone confirmation. Boundaries change with time; “brief” lacks numeric specification. |
| C5-ENTRY-01 EXAMPLE |125-128;5.3-5.5 | Separate anticipation,2-4 line break and wave4 extreme break | Relative conservatism is descriptive, not automatic action permission. “Decisive break” lacks exact algorithm. |
| C5-INNER-01 EXAMPLE |139;5.15 | TCK uses break of inner[b] of5 at36.94 | Different trigger entity/degree from full wave4/2-4; cannot label it full diagonal confirmed by definition. |
| C5-REV-01 GUIDELINE |125,145-153 | Completed diagonal often reverses quickly toward origin, potentially beyond | No guaranteed velocity, target fill, calibrated likelihood or fixed holding period. |
| C5-GAP-01 DESIGN |130;5.7 | BSFT40.65 low then33.75 open skips40.62 | Never book threshold price as executed without order-type/available-market evidence. No-bars-gap is not continuous traversal. |
| C5-OPTIONS-01 EXAMPLE |partial134-135;5.11-5.12 | Ten34 puts,.82 debit,2.72 modeled exit; premium P&L separate from underlying | Missing132-133 limit setup reconstruction; underlying candles alone cannot recreate option bid/ask/time value. |
| C5-ALT-01 GUIDELINE |136-137;5.13 | Sharp2 may alternate with sideways4 at same degree | Failure to alternate does not invalidate structure. Duration/depth labels not defined numerically here. |
| C5-DEPTH-01 GUIDELINE |136-137;5.13 | Correction often enters prior fourth-wave range, frequently near its terminus | Preserve two different degrees; range target not identical to an order or structural constraint. |
| C5-EQUAL-01 GUIDELINE |136-137;5.13 | When3 extends,1 and5 often similar in length;1.618 and.382 provide context | Targets32.60/29.55 are price levels, not lengths. Near misses do not invalidate count; tolerances need explicit empirical design. |
| C5-FILLS-01 DESIGN |139-144;5.15-5.20 | Preserve TCK planned/fill distinction, quantities50/100, weighted average and stop history | Source actual experience is AUTHOR_REPORTED, not broker-confirmed; counts/positions never reconstructed from final average alone. |
| C5-STOP-01 EXAMPLE |140-144,148-150 | Protection may follow high38.09 or recent2 at37.17, then34/33; Euro ceiling then swing highs | Protection/stop-out differs from structural invalidation and target event; below-entry short stop can exit for profit. |
| C5-BASIS-01 DESIGN |145-149;5.21-5.25 | Euro daily continuation context and June2008 hourly data retain basis identity | Source says relevant continuation prices match June here; verify actual data before joining or calculating fills. |
| C5-UNITS-01 DESIGN |148-151;5.24-5.27 | Euro source “point”=.0001; retain quote distances.0204/.0684 | Point not automatically exchange tick; quantity/multiplier/cost unknown, no inferred dollar profit. |
| C5-OCO-01 DESIGN |150;5.26 | Retain modeled target-cover/protective-stop pairing as source intent | Mixed market/stop terminology for lower buy target unresolved; never translate to live broker orders. |
| C5-TIME-01 DESIGN |136-153 | Distinguish as-of evidence, outcome chart and later larger-degree diagonal | Future June/August/retrospective labels excluded from earlier features; source repeated peaks are distinct events. |
| C5-SOURCE-01 DESIGN |132-135;5.9-5.12 | Missing and clipped pages/figures remain explicit | Source status PARTIAL/ABSENT, no invented initial SLW anchors/stops. Duplicate125 counted once in unique coverage. |
| C5-AUTH-01 DESIGN |Frye contract | Engine11 candles, Engine22 authorized parent/degree, Engine16 research, Engine2 approved overlays | No engine sizing, order placement, competing approved count, merge or deployment granted. |

Cross-chapter reconciliation: C4-OVL-02 applies to ordinary impulses; C5 diagonal subdivision/overlap requires separate subtype handling. Chapter3 scoped invalidation remains mandatory: length failure of one contracting diagonal does not erase a larger parent correction. Chapter4 as-of/revision, reported-fill and quote-metadata protections remain active. Source enthusiasm about swift reversal is qualitative until independent replay establishes measured outcomes.
