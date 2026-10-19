# Engine 22 Master Elliott Wave Node Registry — Phase 1 evidence only

**Management authorization:** [Issue #130](https://github.com/bfrye1973/frye-market-backend/issues/130). This is an isolated, read-only intake, **not** a replacement for canonical counts, approved Elliott anchors, official Fibs, Engine 11 source data, or chart prices. **Do not merge or deploy without Engine 2B / Engine 22 management acceptance.**

## Source integrity and provenance

- Owner workbook physically inspected in this project: `Engine22_Wave_Nodes_Corrected_Minor_W1_Date.xlsx` (user's corrected downloadable copy; the management letter refers to `Engine22_Seven_Degree_Wave_Nodes_and_Fibs_corrected.xlsx`; exact visible attachment names differ).
- Workbook SHA-256: `6fb824cc5e8469bc66db004b903fbf3caf537d624ad18fcbc24a20815f9f40a8`.
- Lossless **populated-cell** archive: `source-cells-zlib/chunk-01.b64` through `chunk-03.b64`, concatenated then base64-decoded and zlib-inflated. Decompressed JSON SHA-256: `3242facd72f1ec1a1d14db02f5a063f8d3bc0b78018c5d434ceeb164c311d604`.
- Original corrected XLSX binary **also** preserved byte-for-byte in seven reversible zlib+base64 chunks at `source-workbook-zlib/chunk-01.b64` through `chunk-07.b64` (21,141 source bytes). `readOriginalOwnerWorkbookBytes()` verifies the exact source SHA-256 before returning the XLSX; this retains **all workbook formatting and original binary bytes**, while the independent 11-sheet populated-cell archive permits auditing individual values and source addresses.
- Source tabs: All Nodes, Start Here, Submicro, Micro, Subminute, Minute, Minor, Intermediate, Primary, Fib Levels, Source Notes.
- Source ledger `owner-workbook-ledger.v1.json` contains 40 All Nodes entries and 34 original Fib Levels entries, with source-cell references. `source-cells-zlib` preserves all worksheet source cells including all legacy seven degree tabs and notes.
- Node source status is **SOURCE_EVIDENCE_PENDING_ENGINE22_RECONCILIATION**, regardless of spreadsheet's historical status labels. No workbook-provided number is promoted into canonical runtime authority.
- All timestamp serial numbers and strings are retained literally. Missing and malformed timestamps remain missing or malformed; the archive does not convert any naive timestamp into UTC, infer America/Phoenix, or assume ESU6/ESZ6/ES1! equivalence.

## Source inventory

| Sheet | Rows including header/title | Populated cells |
|---|---:|---:|
| All Nodes | 41 | 157 |
| Start Here | 19 | 37 |
| Submicro | 5 | 55 |
| Micro | 4 | 43 |
| Subminute | 6 | 61 |
| Minute | 9 | 98 |
| Minor | 17 | 201 |
| Intermediate | 6 | 63 |
| Primary | 7 | 76 |
| Fib Levels | 35 | 280 |
| Source Notes | 14 | 42 |
| **Total** | **163** | **1113** |

The All Nodes sheet has 40 node records (some have no established endpoint); Fib Levels has 34 informational price records. These are **not** 40 validated chart-pinnable pivots.

## Priority review items

1. **MINOR W1 corrected:** All Nodes C24 holds Excel date serial `46111` = **2026-03-30**, D24 = `0.6666666666666666` (16:00), E24 = **6496.00**. Original manual Engine 22 marks remain **6417.00, 2026-03-30 17:00**. Preserve both; no implied 79-point adjustment.
2. **MINUTE W1 malformed date:** workbook All Nodes C18 contains literal `7/29/206`, D18 = `1` (00:00 boundary), E18 = 7419.00. Do not guess the missing year or choose whether 00:00 belongs to the next session. Request targeted confirmation.
3. **MINUTE W2/W3 structural conflict:** older approved manual source `services/core/data/waves/active/active-wave-state-es.json` reports W2 ABC C-down active, while the owner V3 shadow `services/core/logic/engine22/v3/buildOwnerBootstrap.js` reports W3 UP, started, confirmation pending. No Phase 1 decision promotes or overwrites either representation.
4. **SUBMINUTE W1/W2:** owner's new All Nodes values **7616.25 / 7847.00 / 7673.25**, with date/time source cells, differ from the older untimed operational W3 Fib anchors **7575.00 / 7859.25 / 7671.50**. Older Subminute degree tab and prior `~7700` V3 context remain distinct records.
5. **MICRO W1:** new All Nodes **7706.25 / 7897.25**, conflicting with V3 owner read **7677.25 / 7897.50**; owner W1 high time in that V3 read is missing.
6. **SUBMICRO ABC:** workbook A **7782.00 Oct 8 07:00**, B **7886.25 Oct 11 19:00**, while current shadow tracks A **7787.50 Oct 8 10:30**, B **7886.50 Oct 11 21:00**. Do not certify the C ending low.
7. **PRIMARY / INTERMEDIATE / MINOR price differences:** many same-labeled endpoints differ from older manual records. `reconciliation-evidence.v1.json` inventories exact old/new price conflicts and original legacy date fields.
8. **Historical chart basis:** owner evidence reports TradingView **ES1! / ETH**; actual B-ADJ setting, source candle identities, chart contract, continuous-series adjustment methodology and timezone evidence remain unverified. Engine 11 must reconcile before Engine 2B pins chart coordinates.
9. **Fibonacci:** all 34 workbook entries are preserved but treated as evidence only; the reported “Official?” field is not auto-approval. 0.618 “TOUCHED” in a legacy model is not candle-verified just because a workbook labels it touched.
10. **Source count IDs:** historical manual records lack stable sourceCountIds. V3 `ES-V3-BASELINE-*` IDs belong to isolated shadow snapshots, not automatically approved underlying structural count identities.

## Validation and integration

```bash
node --test services/core/tests/engine22NodeRegistryPhase1.test.js
node services/core/scripts/auditEngine22NodeRegistryV1.mjs
```

The audit imports from a tamper-detecting source-cell archive, cross-checks same-label source-tab conflicts, enforces 7 independent degrees, reports missing/invalid timestamps, and fails on lost owner corrections or ES tick violations. It never updates any production output.

**Do not import this registry from `buildStrategySnapshot.js`, `buildCurrentWavelength.js`, `buildOwnerBootstrap.js`, frontend, Engine 11, Engine 27, Engine 6/7/8/10 or execution/Journal/Replay.** Only Phase 1 test tooling reads it.

## Phase gate

**Phase 1 status: DRAFT, FOR MANAGEMENT REVIEW.** Phase 2 Engine 11 historical reconciliation, Phase 3 structural authority acceptance, Phase 4 chart overlays, Phase 5 production acceptance require separate authorization. Both binary-corrected-XLSX archival and exact 11-sheet populated-cell ledger are covered by SHA-256 verification. Formal Engine22/11/2B structural, contract-roll and chart approvals remain separate future gates.
