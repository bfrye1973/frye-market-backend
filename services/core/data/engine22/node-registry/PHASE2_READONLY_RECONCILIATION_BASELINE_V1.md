# Engine 22 — Phase 2 read-only seven-degree reconciliation baseline V1

**Status: RESEARCH ONLY, ZERO CERTIFIED CANDLE MATCHES IN THIS REPORT.** Authorized by Engine 2B Lead Manager in [Issue #130](https://github.com/bfrye1973/frye-market-backend/issues/130#issuecomment-6156970944) October 13, 2026. This is an additive evidence report; it does not modify registry/source values or authorize canonical Engine22, Fibonacci, source promotion, plotting or trading changes.

## Immutable source references

- Phase 1 PR #131 HEAD `482ef74bc46367718fb207148d5e92a7b0cc248a`; original workbook bytes SHA256 `6fb824cc5e8469bc66db004b903fbf3caf537d624ad18fcbc24a20815f9f40a8`.
- Preserved source ledger `services/core/data/engine22/node-registry/owner-workbook-ledger.v1.json`; 40 All Nodes and 34 separate Fib Level references, all 11 sheets/1,113 original populated cells captured.
- Legacy operational: `services/core/data/waves/active/active-wave-state-es.json` (blob SHA `4dbcdead83ae7a27659f8cc69f562692364f1ce8`).
- Separate V3 owner shadow: `services/core/logic/engine22/v3/buildOwnerBootstrap.js` (blob SHA `1c6d5c0f7c4ee32c82a73ad6d607c9f5fcc496f9`).
- Engine11 PR #125 SHA `53be56a5c88194f959f81ea928cd2e4ceb7f9923`; PR #128 SHA `7eeb3ded0502ceaba919b2dd7ecdb0ad3a1268fe`. Its historical dataset has **zero fully verified canonical candles**. The captured core chart OHLC endpoint used ESZ6 10min with environment override; no proof that this is an ES1!/ETH/B-ADJ compatible series.
- Source chart as reported: ES1!, ETH. Phoenix timezone is *reported, not cell-verified*. Back-adjustment, continuous basis, chart contract and exact candle identifiers remain **UNKNOWN**.
- This is a Phase 2 STARTING inventory, not the final per-node match/transform report.

## Degree completeness

| Degree | Original All Nodes rows | Workbook vs legacy price conflicts |
|---|---:|---:|
| SUBMICRO | 4 | 0 |
| MICRO | 6 | 0 |
| SUBMINUTE | 6 | 0 |
| MINUTE | 6 | 2 |
| MINOR | 6 | 5 |
| INTERMEDIATE | 6 | 2 |
| PRIMARY | 6 | 5 |
| **TOTAL** | **40** | **14** |

## Forty-source-node comparison matrix (raw cell evidence preserved)

Date serial/time fractions are shown literally without inventing timestamps. `NOT_MAPPED` means no same-node legacy mapping established by Phase 1 conflict evidence; **it does not mean the node agrees**. All candle matches and any back-adjusted coordinates are explicitly pending independent Engine 11 source evidence.

| Source ID | Degree | Wave mark | Original date/time/price cells | Raw date | Raw time | Workbook price | Legacy conflicting price (legacy date/time) | Reconciliation state |
|---|---|---|---|---|---|---:|---|---|
| WB-ALL-002 | SUBMICRO | A low | C2/D2/E2 | 46303 | 0.2916666666666667 | 7782 | NOT_MAPPED | UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-003 | SUBMICRO | A high | C3/D3/E3 | 46301 | 0.2916666666666667 | 7897.25 | NOT_MAPPED | UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-004 | SUBMICRO | B | C4/D4/E4 | 46306 | 0.7916666666666666 | 7886.25 | NOT_MAPPED | UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-005 | SUBMICRO | C | C5/D5/E5 | UNKNOWN | UNKNOWN | MISSING | NOT_MAPPED | MISSING_DATE; CANDLE_NOT_VERIFIED |
| WB-ALL-006 | MICRO | W1 starting low | C6/D6/E6 | 46296 | 0.4583333333333333 | 7706.25 | NOT_MAPPED | UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-007 | MICRO | W1 ending high | C7/D7/E7 | 46301 | 0.2916666666666667 | 7897.25 | NOT_MAPPED | UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-008 | MICRO | W2 | C8/D8/E8 | UNKNOWN | UNKNOWN | MISSING | NOT_MAPPED | MISSING_DATE; CANDLE_NOT_VERIFIED |
| WB-ALL-009 | MICRO | W3 | C9/D9/E9 | UNKNOWN | UNKNOWN | MISSING | NOT_MAPPED | MISSING_DATE; CANDLE_NOT_VERIFIED |
| WB-ALL-010 | MICRO | W4 | C10/D10/E10 | UNKNOWN | UNKNOWN | MISSING | NOT_MAPPED | MISSING_DATE; CANDLE_NOT_VERIFIED |
| WB-ALL-011 | MICRO | W5 | C11/D11/E11 | UNKNOWN | UNKNOWN | MISSING | NOT_MAPPED | MISSING_DATE; CANDLE_NOT_VERIFIED |
| WB-ALL-012 | SUBMINUTE | W1 starting low | C12/D12/E12 | 46281 | 0.6666666666666666 | 7616.25 | NOT_MAPPED | UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-013 | SUBMINUTE | W1 ending high | C13/D13/E13 | 46287 | 0.2916666666666667 | 7847 | NOT_MAPPED | UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-014 | SUBMINUTE | W2 | C14/D14/E14 | 46296 | 0.2916666666666667 | 7673.25 | NOT_MAPPED | UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-015 | SUBMINUTE | W3 | C15/D15/E15 | UNKNOWN | UNKNOWN | MISSING | NOT_MAPPED | MISSING_DATE; CANDLE_NOT_VERIFIED |
| WB-ALL-016 | SUBMINUTE | W4 | C16/D16/E16 | UNKNOWN | UNKNOWN | MISSING | NOT_MAPPED | MISSING_DATE; CANDLE_NOT_VERIFIED |
| WB-ALL-017 | SUBMINUTE | W5 | C17/D17/E17 | UNKNOWN | UNKNOWN | MISSING | NOT_MAPPED | MISSING_DATE; CANDLE_NOT_VERIFIED |
| WB-ALL-018 | MINUTE | W1 starting low | C18/D18/E18 | 7/29/206 | 1 | 7419 | 7591 (2026-09-16 12:30) | PRICE_CONFLICT; MALFORMED_DATE; CANDLE_NOT_VERIFIED |
| WB-ALL-019 | MINUTE | W1 ending high | C19/D19/E19 | 46247 | 0.2916666666666667 | 7905 | 7848.5 (2026-09-23) | PRICE_CONFLICT; UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-020 | MINUTE | W2 | C20/D20/E20 | 46281 | 0.4583333333333333 | 7576.75 | NOT_MAPPED | UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-021 | MINUTE | W3 | C21/D21/E21 | UNKNOWN | UNKNOWN | MISSING | NOT_MAPPED | MISSING_DATE; CANDLE_NOT_VERIFIED |
| WB-ALL-022 | MINUTE | W4 | C22/D22/E22 | UNKNOWN | UNKNOWN | MISSING | NOT_MAPPED | MISSING_DATE; CANDLE_NOT_VERIFIED |
| WB-ALL-023 | MINUTE | W5 | C23/D23/E23 | UNKNOWN | UNKNOWN | MISSING | NOT_MAPPED | MISSING_DATE; CANDLE_NOT_VERIFIED |
| WB-ALL-024 | MINOR | W1 starting low | C24/D24/E24 | 46111 | 0.6666666666666666 | 6496 | 6417 (2026-03-30 17:00) | PRICE_CONFLICT; UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-025 | MINOR | W1 ending high | C25/D25/E25 | 46119 | 0.9583333333333334 | 6973 | 6948.75 (2026-04-10 08:00) | PRICE_CONFLICT; UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-026 | MINOR | W2 | C26/D26/E26 | 46124 | 0.6666666666666666 | 6884 | 6829 (2026-04-12 15:00) | PRICE_CONFLICT; UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-027 | MINOR | W3 | C27/D27/E27 | 46175 | 0.4583333333333333 | 7758 | 7694.25 (2026-06-02 19:00) | PRICE_CONFLICT; UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-028 | MINOR | W4 | C28/D28/E28 | 46232 | 0.6666666666666666 | 7395.75 | 7398 (2026-07-29 13:30) | PRICE_CONFLICT; UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-029 | MINOR | W5 | C29/D29/E29 | UNKNOWN | UNKNOWN | MISSING | NOT_MAPPED | MISSING_DATE; CANDLE_NOT_VERIFIED |
| WB-ALL-030 | INTERMEDIATE | W1 starting low | C30/D30/E30 | 45755 | 0.4166666666666667 | 5188.5 | NOT_MAPPED | UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-031 | INTERMEDIATE | W1 ending high | C31/D31/E31 | 46050 | 0.375 | 7205 | 7151 (2026-01-28) | PRICE_CONFLICT; UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-032 | INTERMEDIATE | W2 | C32/D32/E32 | 46111 | 0.6666666666666666 | 6511 | 6407 (2026-03-30) | PRICE_CONFLICT; UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-033 | INTERMEDIATE | W3 | C33/D33/E33 | UNKNOWN | UNKNOWN | MISSING | NOT_MAPPED | MISSING_DATE; CANDLE_NOT_VERIFIED |
| WB-ALL-034 | INTERMEDIATE | W4 | C34/D34/E34 | UNKNOWN | UNKNOWN | MISSING | NOT_MAPPED | MISSING_DATE; CANDLE_NOT_VERIFIED |
| WB-ALL-035 | INTERMEDIATE | W5 | C35/D35/E35 | UNKNOWN | UNKNOWN | MISSING | NOT_MAPPED | MISSING_DATE; CANDLE_NOT_VERIFIED |
| WB-ALL-036 | PRIMARY | W1 starting low | C36/D36/E36 | 43914 | 0.375 | 3096 | 3200 (2020-04-02) | PRICE_CONFLICT; UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-037 | PRIMARY | W1 ending high | C37/D37/E37 | 44564 | 0.2916666666666667 | 5692 | 5620 (2022-01-05) | PRICE_CONFLICT; UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-038 | PRIMARY | W2 | C38/D38/E38 | 44846 | 0.2916666666666667 | 4462 | 4306 (2022-10-12) | PRICE_CONFLICT; UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-039 | PRIMARY | W3 | C39/D39/E39 | 45708 | 0.20833333333333334 | 6548 | 6487 (2025-02-20) | PRICE_CONFLICT; UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-040 | PRIMARY | W4 | C40/D40/E40 | 45756 | 0.125 | 5254 | 5182 (2025-04-09) | PRICE_CONFLICT; UNVERIFIED_EXCEL_SERIAL; CANDLE_NOT_VERIFIED |
| WB-ALL-041 | PRIMARY | W5 | C41/D41/E41 | UNKNOWN | UNKNOWN | MISSING | NOT_MAPPED | MISSING_DATE; CANDLE_NOT_VERIFIED |

## Structural and chart-authority conflicts (not numerical transform instructions)

1. **MINUTE — COUNT_AUTHORITY**: {"degree":"MINUTE","type":"COUNT_AUTHORITY","manual":"W2_ABC_C_DOWN_ACTIVE_20260928","currentOwnerV3":"W3_UP_STARTED_CONFIRMATION_PENDING","decision":"UNRESOLVED_STRUCTURAL_RECONCILIATION_REQUIRED"}.
2. **SUBMINUTE — W3_FIB_ANCHOR_SET**: {"degree":"SUBMINUTE","type":"W3_FIB_ANCHOR_SET","legacyOperational":[7575,7859.25,7671.5],"newerOwnerExcel":[7616.25,7847,7673.25],"decision":"OWNER_OBSERVATIONS_NOT_AUTOMATICALLY_PROMOTED"}.
3. **MICRO — W1_ORIGIN**: {"degree":"MICRO","type":"W1_ORIGIN","v3":[7677.25,7897.5],"ownerExcel":[7706.25,7897.25],"decision":"UNRESOLVED;NO_ROLLOVER_OFFSET_ASSUMED"}.
4. **SUBMICRO — ABC_ENDPOINT**: {"degree":"SUBMICRO","type":"ABC_ENDPOINT","v3A":[7787.5,"2026-10-08 10:30"],"excelA":[7782,"2026-10-08 07:00"],"v3B":[7886.5,"2026-10-11 21:00"],"excelB":[7886.25,"2026-10-11 19:00"],"decision":"KEEP_SOURCE_RECORDS_SEPARATE"}.
5. **MINOR — DATE_CORRECTION**: {"degree":"MINOR","type":"DATE_CORRECTION","excelOwnerW1Low":{"price":6496,"dateSerial":46111,"timeFraction":0.6666666666666666},"legacyW1Low":{"price":6417,"date":"2026-03-30","time":"17:00"},"decision":"OWNER_CORRECTION_RECOVERED_BUT_PRICE_MISMATCH_REQUIRES_REVIEW"}.

- There are additional 12 All Nodes vs per-degree worksheet same-label conflicts preserved by Phase 1; they must be assessed from archived source-cell evidence rather than flattened/silently collapsed.
- **Owner correction is preserved:** MINOR W1 low, All Nodes C24/D24/E24: March 30 2026 / 16:00 / ES 6496.00; legacy records 6417.00 at March 30 17:00. Price/time discrepancy is NOT a proven roll adjustment.
- **Malformed entry:** MINUTE W1 raw date `7/29/206`, All Nodes C18; preserve literal; do not infer a century/year. The raw time fraction `1` requires an explicit source session/day-boundary policy.
- Source row labels/worksheet descriptions do not grant official approval. Workbook-confirmed status != runtime canonical approval. Candidate Fib levels and workbook statuses remain reference-only until separately ratified.

## Engine 11 matching questions — exact evidence required

1. Per row: source interval or contract identity (including ESU2026/ESZ2026 where available), vendor/provider dataset, receipt/body hash, native candle ID/start/end, exchange session, timezone, timestamp units and precision, raw OHLC, completeness/finality/status.
2. Where authentic evidence does NOT match or is unavailable, report `NO_MATCH`, `MISSING_CANDLE`, `MULTI_CONTRACT_AMBIGUITY`, `TIMEZONE_UNCONFIRMED` or `INSUFFICIENT_SOURCE`, not a computed price adjustment. Preserve no-data as unknown, never zero.
3. For ES1!/ETH TradingView: record exact chart B-ADJ setting, contract rollover choices/method and documented derived-price transformations only when independently established. Separate owner-drawn position from candle high/low.
4. Cross-check whether any reported 10m native ESZ6 sample is the SAME historical series/moment as the owner node; a live three-bar probe does not certify a historical node.
5. Preserve original 34 workbook Fib references separately. Do not recompute or automatically align levels against candle prices.

## Manager gate and coordination

**Engine22** owns structural identity, count conflicts, statuses and owner provenance. **Engine11** owns independent historical source/candle/rollover evidence. **Engine2B** owns chart series compatibility and eventual plotting. Return results through Issue #130 with exact source IDs, evidence, SHA and test proof. This report claims **zero matches verified** and does not authorize merge/deploy or change official Elliott count/Fibs, Engine26 zones, Engine27, source eligibility, frontend, execution or Replay.

**Next research result required:** append independently verified candle mappings and explicit candidate price-basis methodology per source row as a separate additive revision; unresolved cells remain explicitly UNKNOWN.
