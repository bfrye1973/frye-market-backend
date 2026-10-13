# Engine 22 Phase 2 — Independent Structural Conflict Audit V1

**Authority:** Engine 2B October 13, 2026 read-only authorization, GitHub Issue #130. **Classification: research; NO CANONICAL STRUCTURAL RULING.** This additive report supplements `PHASE2_READONLY_RECONCILIATION_BASELINE_V1.md` on draft PR #132, which is stacked on unmerged Phase 1 PR #131.

## Source-of-truth separation

- Source workbook original bytes SHA256: `6fb824cc5e8469bc66db004b903fbf3caf537d624ad18fcbc24a20815f9f40a8`, immutable imported source ledger `owner-workbook-ledger.v1.json`.
- Existing operational manual: `services/core/data/waves/active/active-wave-state-es.json`, blob `4dbcdead83ae7a27659f8cc69f562692364f1ce8`.
- Existing V3 owner-shadow: `services/core/logic/engine22/v3/buildOwnerBootstrap.js`, blob `1c6d5c0f7c4ee32c82a73ad6d607c9f5fcc496f9`.
- **A same-named mark is not necessarily the same Elliott count.** Price arithmetic below demonstrates differences only; it is not evidence of TradingView B-ADJ, rollover, source compatibility, or permission to replace official geometry.
- No document in this Phase 2 packet certifies matching native candles, canonical owner sourceCountIds, or official wave supersession.

## Completeness audit across all seven degrees

| Degree | Source node rows | Rows with numeric price | Blank-price nodes | Known workbook/manual price conflicts |
|---|---:|---:|---:|---:|
| SUBMICRO | 4 | 3 | 1 | 0 |
| MICRO | 6 | 2 | 4 | 0 |
| SUBMINUTE | 6 | 3 | 3 | 0 |
| MINUTE | 6 | 3 | 3 | 2 |
| MINOR | 6 | 5 | 1 | 5 |
| INTERMEDIATE | 6 | 3 | 3 | 2 |
| PRIMARY | 6 | 5 | 1 | 5 |
| **TOTAL** | **40** | **24** | **16** | **14** |

**Interpretation:** Blank-price rows are reserved wave labels, not missing data to interpolate; no fabricated endpoints should be plotted. There are **24** price-bearing owner nodes requiring historical comparison. **16** nodes have no recorded price and cannot be matched to an exact candle price.

Blank-price IDs: WB-ALL-005 (SUBMICRO C), WB-ALL-008 (MICRO W2), WB-ALL-009 (MICRO W3), WB-ALL-010 (MICRO W4), WB-ALL-011 (MICRO W5), WB-ALL-015 (SUBMINUTE W3), WB-ALL-016 (SUBMINUTE W4), WB-ALL-017 (SUBMINUTE W5), WB-ALL-021 (MINUTE W3), WB-ALL-022 (MINUTE W4), WB-ALL-023 (MINUTE W5), WB-ALL-029 (MINOR W5), WB-ALL-033 (INTERMEDIATE W3), WB-ALL-034 (INTERMEDIATE W4), WB-ALL-035 (INTERMEDIATE W5), WB-ALL-041 (PRIMARY W5).

## Exact known price differences (owner workbook minus legacy operational)

| Source ID | Degree | Identity label | Owner price | Legacy price | Difference ES points | Ruling |
|---|---|---|---:|---:|---:|---|
| WB-ALL-018 | MINUTE | W1 starting low | 7419.00 | 7591.00 | -172.00 | PRESERVE_BOTH |
| WB-ALL-019 | MINUTE | W1 ending high | 7905.00 | 7848.50 | +56.50 | PRESERVE_BOTH |
| WB-ALL-024 | MINOR | W1 starting low | 6496.00 | 6417.00 | +79.00 | PRESERVE_BOTH |
| WB-ALL-025 | MINOR | W1 ending high | 6973.00 | 6948.75 | +24.25 | PRESERVE_BOTH |
| WB-ALL-026 | MINOR | W2 | 6884.00 | 6829.00 | +55.00 | PRESERVE_BOTH |
| WB-ALL-027 | MINOR | W3 | 7758.00 | 7694.25 | +63.75 | PRESERVE_BOTH |
| WB-ALL-028 | MINOR | W4 | 7395.75 | 7398.00 | -2.25 | PRESERVE_BOTH |
| WB-ALL-031 | INTERMEDIATE | W1 ending high | 7205.00 | 7151.00 | +54.00 | PRESERVE_BOTH |
| WB-ALL-032 | INTERMEDIATE | W2 | 6511.00 | 6407.00 | +104.00 | PRESERVE_BOTH |
| WB-ALL-036 | PRIMARY | W1 starting low | 3096.00 | 3200.00 | -104.00 | PRESERVE_BOTH |
| WB-ALL-037 | PRIMARY | W1 ending high | 5692.00 | 5620.00 | +72.00 | PRESERVE_BOTH |
| WB-ALL-038 | PRIMARY | W2 | 4462.00 | 4306.00 | +156.00 | PRESERVE_BOTH |
| WB-ALL-039 | PRIMARY | W3 | 6548.00 | 6487.00 | +61.00 | PRESERVE_BOTH |
| WB-ALL-040 | PRIMARY | W4 | 5254.00 | 5182.00 | +72.00 | PRESERVE_BOTH |

All differences are derived only from **reported** prices, without interpretation. Note opposing signs and nonuniform magnitudes; no constant rollover correction is justified by these observations. The known list is **14**, not an exhaustive statement that all remaining 26 nodes equal their operational counterparts. `NOT_MAPPED` in the companion inventory means unproven identity, NOT agreement.

## Authority classification and ordered follow-up

1. **MINUTE (highest impact):** Legacy `W2_ABC_C_DOWN_ACTIVE_20260928` and current owner V3 `W3_UP_STARTED_CONFIRMATION_PENDING` are distinct, competing publications. HOLD automatic arbitration. Obtain actual count identifiers, scope, versions, source timestamps, degree-specific acceptance. Cannot call this an ES B-ADJ artifact based solely on price difference. Preserve original owner workbook W1/W2 marks and literal malformed W1 date `7/29/206`.
2. **SUBMINUTE:** Owner workbook W1 starting low 7616.25, W1 ending high 7847.00, W2 7673.25; legacy operational W3 Fib geometry 7575.00/7859.25/7671.50. These represent different source/semantic contexts, not necessarily three corresponding pivots. Record side by side, DO NOT recompute W3 ladder from owner coordinates without separate approval.
3. **MICRO:** Owner W1 7706.25→7897.25; V3 owner-shadow 7677.25→7897.50. Multiple independent differences; both are research candidates until count/source/basis reconciliation. No automatic W2, W3, W4 or W5 completion inference from blank cells.
4. **SUBMICRO:** Workbook A 7782.00 at 2026-10-08 07:00, B 7886.25 at 2026-10-11 19:00; V3 A 7787.50 at 2026-10-08 10:30, B 7886.50 at 2026-10-11 21:00. Both **time and price** differ. Check event identity and candle granularity before considering a pricing-basis explanation. Do not certify C.
5. **MINOR:** Explicit owner MINOR W1 low 2026-03-30 16:00 ES 6496.00 vs legacy 2026-03-30 17:00 ES 6417.00. Preserve owner correction; do not infer contract/timeframe transformation; other Minor wave-mark prices also disagree.
6. **INTERMEDIATE and PRIMARY:** Preserve old and workbook anchors and each source's independent time precision. They may predate the currently verified modern futures data window; NO_MATCH cannot count as invalid wave geometry. Wait for appropriate historical source/contract evidence.
7. **All degrees and Fib evidence:** Confirmed labels in the workbook reflect source annotations only and cannot grant live structural authority. All 34 Fib reference entries retain source provenance but need approved count/model hash and Engine11 price basis before chart eligibility.

## Decision protocol to hand to Engine2B

For each price-bearing source ID, the Engine22 structural outcome must be **PENDING_EVIDENCE**, **APPROVED_AS_SAME_COUNT**, **APPROVED_AS_DISTINCT_COUNT**, **SUPERSEDED_WITH_PROVENANCE**, or **REJECTED_WITH_PROVENANCE**. Today all are **PENDING_EVIDENCE** pending formal structural decision. A per-row judgment needs: exact source row, confirmed count identity/revision and scope, historical price/candle source identity, time/contract series/basis confidence, independent original versus legacy rationale, and explicit owner authorization for any count/geometry change.

A chart candidate may be considered only when Engine22 approves the count + node/model hash, Engine11 documents source/time/price basis and adequate candle evidence, and Engine2B certifies series compatibility. If any fail, fail visible with original data unchanged. This report does **not** authorize any status transition or plot.

## Pending research requests, not owner questions yet

- Engine11: map 24 price-bearing nodes where historical provider coverage exists, recording exact native candle ID, contract, OHLC, source receipt, session/timezone/finality, and unproven continuous-basis offsets as UNKNOWN; track out-of-coverage and malformed dates explicitly.
- Engine2B: provide chart time/price series identity and exact owner TradingView ES1!/ETH/B-ADJ evidence. Distinguish price drawn at a coordinate from historical high/low.
- Engine22: after source evidence arrives, submit one degree-specific authority decision packet; no source promotion from this audit alone.

**Invariants:** 0 runtime code changes, 0 official Fib calculations, 0 claimed historical matches, 0 updated source entries, 0 merges/deploys, 0 execution/order/risk changes.
