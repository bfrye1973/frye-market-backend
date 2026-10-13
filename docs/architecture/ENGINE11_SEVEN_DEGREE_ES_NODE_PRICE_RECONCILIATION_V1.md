# ENGINE 11 — SEVEN-DEGREE ES HISTORICAL NODE & PRICE-BASIS RECONCILIATION V1

Phase 2 read-only research. Engine 2B Lead Manager review: ACCEPT or REVISE. Central record [Issue #130](https://github.com/bfrye1973/frye-market-backend/issues/130); immutable registry [PR #131](https://github.com/bfrye1973/frye-market-backend/pull/131) at 482ef74bc46367718fb207148d5e92a7b0cc248a. Engine 22 structural audit [PR #132](https://github.com/bfrye1973/frye-market-backend/pull/132) remains a separate owner deliverable.

## Outcome and limits

**40 rows reconciled: 24 price-bearing nodes and 16 intentionally blank placeholders. All 34 Fibonacci references reviewed.** All seven degrees accounted for. 280 bounded authenticated queries succeeded, returning 8,422 original source observations; no timeframe substitution or fabricated endpoints. All 280 HTTP bodies were digest-verified during replay.

Node results: **0 VERIFIED MATCH, 0 CANDIDATE MATCH, 14 CONFLICT, 26 UNRESOLVED**. CONFLICT identifies preserved workbook-versus-operational coordinate discrepancies, not proof that the workbook is wrong. UNRESOLVED includes 16 blank placeholders. The malformed MINUTE W1 date remains unavailable for candle comparison; its primary CONFLICT result records the separate legacy-coordinate discrepancy. No exact OHLC-field equality was found at the recorded minute under the tested Phoenix/UTC hypotheses and close/settlement calendar-roll models. This bounded test does not disprove owner drawing coordinates, higher-timeframe extrema, different TradingView roll rules or other data vintages. Nearby observations are not promoted to matches.

**Verified canonical candles and approved derived chart coordinates remain zero.** Numerical acquisition success is not calendar, contract, finality, price-basis or Elliott approval. No official Fibonacci recalculation or count decision is made.

## Source preservation and reproducibility

Original corrected XLSX restored from the existing seven Phase 1 fragments: **21,141 bytes**, SHA-256 **6fb824cc5e8469bc66db004b903fbf3caf537d624ad18fcbc24a20815f9f40a8**. Independent cell archive SHA-256 **3242facd72f1ec1a1d14db02f5a063f8d3bc0b78018c5d434ceeb164c311d604**; **11 sheets / 1,113 populated cells**. No registry cell or imported coordinate changed. Independent ZIP/XML inspection confirmed the 1900 date system and All Nodes C24/D24/E24 values 46111, 0.66666666666666663, 6496: **March 30, 2026, 16:00, 6496.00**. C18 is shared-string text **7/29/206**; D18 is numeric 1 with duration format 46 ([h]:mm:ss). Neither a year nor a midnight timestamp was guessed.

Workbook ledger IDs WB-ALL / WB-FIB and importer aliases OWNER-ALL / OWNER-FIB are preserved side-by-side by source row. This report is a derived analysis, not a competing registry. Twelve All Nodes-versus-degree-tab price conflicts remain attached in the full evidence; fourteen old manual conflicts remain independent. Matching labels are not proof of the same Elliott count.

Authentic capture SHA **5343f083c115c4d36e755b118c9549fb194084c3**, Actions run **38482575971**, artifact **11857526637**. ZIP SHA **b1d4791e35b5bec885875c3adcacd99b4942d7db108369deb7acd3841a072f4b**. Uncompressed original evidence SHA **0177e95c58e711d78456b00d952d56f0efe77d64d195a5c86024b0d9cff5b0e4**. Capture ended **2026-10-13T23:10:38.266Z** (October 13, approximately 16:10 Phoenix). Original bodies, requests, provider rows and capture contexts are preserved in the existing Actions artifact; no full HTTP bodies are committed to this public repository or transferred to a new private destination.

Dataset version: **node-research-dataset:887b284abd2906788b45902cbf7d00055998dc09533f70ed1ee3b03c15ab6ddd**. It pins the per-receipt capture vector, not an atomic TradingView vintage. Each selected candle carries complete query ID, original/V2 receipt ID, V2 observation ID, row digest, body digest, observedAt, native resolution, original nanosecond window_start and session_end_date. Source finality and interval/calendar acceptance remain UNKNOWN. No source corrections inferred from differing observations; no accepted V1/V2 identity module edited.

Full derived evidence: engine11-seven-degree-reconciliation-v1.json.zlib.b64, with its integrity JSON and readReport.mjs reader. It contains all OHLC candidates, both timezone hypotheses, native-frame observations, strict/weak adjustment lineage, all 40 source rows, 34 Fib rows and receipt identities. The zlib encoding stores selected analysis without changing coordinates; original evidence stays separately pinned.

## All 40 node records

Prices are ES points; OHLC shown as O/H/L/C. This table shows diagnostic **1-minute source observations at the hypothesized Phoenix instant**, not replacement structural inputs. UTC alternatives and full native-frame evidence remain in the JSON. A recorded minute is not a verified exchange interval or original TradingView bar-label convention. No nearest-bar snapping occurs.

The first listed raw candidate's close-based adjusted OHLC is shown. Weak means the arithmetic uses unaccepted lifespan-only contract proposals; strict missing links remain unavailable. Candidate adjustment versions and every component coefficient are in the full evidence. Future H2027 candidates are not relabeled current ESZ2026. Original versus operational coordinates are kept separate.

| Registry ID / cell | Degree / node | Workbook date/time and price | Existing manual coordinate | Raw contract OHLC at hypothesized time | Candidate adjusted OHLC | Result / cross-tab conflicts |
|---|---|---|---|---|---|---|
| WB-ALL-002 / All Nodes!E2 | SUBMICRO A low | 2026-10-08T07:00:00; 7782.00 | unavailable / — | ESZ2026 7831.25/7834.25/7830.75/7832.50<br>ESH2027 7910.00/7910.00/7910.00/7910.00 | 7831.25/7834.25/7830.75/7832.50 (research) | UNRESOLVED / 1 |
| WB-ALL-003 / All Nodes!E3 | SUBMICRO A high | 2026-10-06T07:00:00; 7897.25 | unavailable / — | ESZ2026 7879.00/7883.50/7878.25/7882.50 | 7879.00/7883.50/7878.25/7882.50 (research) | UNRESOLVED / 0 |
| WB-ALL-004 / All Nodes!E4 | SUBMICRO B | 2026-10-11T19:00:00; 7886.25 | unavailable / — | ESZ2026 7882.25/7882.75/7882.25/7882.50 | 7882.25/7882.75/7882.25/7882.50 (research) | UNRESOLVED / 0 |
| WB-ALL-005 / All Nodes!E5 | SUBMICRO C | blank; — | unavailable / — | unavailable | unavailable | UNRESOLVED / 0 |
| WB-ALL-006 / All Nodes!E6 | MICRO W1 starting low | 2026-10-01T11:00:00; 7706.25 | unavailable / — | ESZ2026 7720.75/7722.50/7715.25/7716.50<br>ESH2027 7795.75/7795.75/7794.00/7794.00 | 7720.75/7722.50/7715.25/7716.50 (research) | UNRESOLVED / 1 |
| WB-ALL-007 / All Nodes!E7 | MICRO W1 ending high | 2026-10-06T07:00:00; 7897.25 | unavailable / — | ESZ2026 7879.00/7883.50/7878.25/7882.50 | 7879.00/7883.50/7878.25/7882.50 (research) | UNRESOLVED / 1 |
| WB-ALL-008 / All Nodes!E8 | MICRO W2 | blank; — | unavailable / — | unavailable | unavailable | UNRESOLVED / 0 |
| WB-ALL-009 / All Nodes!E9 | MICRO W3 | blank; — | unavailable / — | unavailable | unavailable | UNRESOLVED / 0 |
| WB-ALL-010 / All Nodes!E10 | MICRO W4 | blank; — | unavailable / — | unavailable | unavailable | UNRESOLVED / 0 |
| WB-ALL-011 / All Nodes!E11 | MICRO W5 | blank; — | unavailable / — | unavailable | unavailable | UNRESOLVED / 0 |
| WB-ALL-012 / All Nodes!E12 | SUBMINUTE W1 starting low | 2026-09-16T16:00:00; 7616.25 | unavailable / — | ESU2026 7569.75/7570.50/7569.25/7569.25<br>ESZ2026 7636.50/7637.50/7636.00/7636.25 | 7637.50/7638.25/7637.00/7637.00 (research) | UNRESOLVED / 1 |
| WB-ALL-013 / All Nodes!E13 | SUBMINUTE W1 ending high | 2026-09-22T07:00:00; 7847.00 | unavailable / — | ESZ2026 7835.00/7836.75/7834.50/7835.25 | 7835.00/7836.75/7834.50/7835.25 (research) | UNRESOLVED / 1 |
| WB-ALL-014 / All Nodes!E14 | SUBMINUTE W2 | 2026-10-01T07:00:00; 7673.25 | unavailable / — | ESZ2026 7711.50/7712.50/7697.75/7698.00<br>ESH2027 7787.00/7787.00/7778.75/7778.75 | 7711.50/7712.50/7697.75/7698.00 (research) | UNRESOLVED / 0 |
| WB-ALL-015 / All Nodes!E15 | SUBMINUTE W3 | blank; — | unavailable / — | unavailable | unavailable | UNRESOLVED / 0 |
| WB-ALL-016 / All Nodes!E16 | SUBMINUTE W4 | blank; — | unavailable / — | unavailable | unavailable | UNRESOLVED / 0 |
| WB-ALL-017 / All Nodes!E17 | SUBMINUTE W5 | blank; — | unavailable / — | unavailable | unavailable | UNRESOLVED / 0 |
| WB-ALL-018 / All Nodes!E18 | MINUTE W1 starting low | 7/29/206 / raw time 1; 7419.00 | 7591.00; 2026-09-16 12:30 | unavailable | unavailable | CONFLICT / 1 |
| WB-ALL-019 / All Nodes!E19 | MINUTE W1 ending high | 2026-08-13T07:00:00; 7905.00 | 7848.50; 2026-09-23 | ESU2026 7820.75/7824.50/7819.75/7824.25<br>ESZ2026 7887.50/7889.00/7887.50/7889.00 | 7888.50/7892.25/7887.50/7892.00 (research) | CONFLICT / 1 |
| WB-ALL-020 / All Nodes!E20 | MINUTE W2 | 2026-09-16T11:00:00; 7576.75 | unavailable / ABC_PULLBACK_ACTIVE | ESU2026 7616.50/7630.00/7609.50/7610.25<br>ESZ2026 7684.50/7691.00/7676.50/7678.25 | 7684.25/7697.75/7677.25/7678.00 (research) | UNRESOLVED / 0 |
| WB-ALL-021 / All Nodes!E21 | MINUTE W3 | blank; — | unavailable / NOT_CONFIRMED | unavailable | unavailable | UNRESOLVED / 0 |
| WB-ALL-022 / All Nodes!E22 | MINUTE W4 | blank; — | unavailable / — | unavailable | unavailable | UNRESOLVED / 0 |
| WB-ALL-023 / All Nodes!E23 | MINUTE W5 | blank; — | unavailable / — | unavailable | unavailable | UNRESOLVED / 0 |
| WB-ALL-024 / All Nodes!E24 | MINOR W1 starting low | 2026-03-30T16:00:00; 6496.00 | 6417.00; 2026-03-30 17:00 | ESM2026 6384.00/6384.00/6379.75/6380.00<br>ESU2026 6428.00/6428.00/6428.00/6428.00 | 6514.00/6514.00/6509.75/6510.00 (research) | CONFLICT / 1 |
| WB-ALL-025 / All Nodes!E25 | MINOR W1 ending high | 2026-04-07T23:00:00; 6973.00 | 6948.75; 2026-04-10 08:00 | ESM2026 6836.25/6838.00/6835.25/6837.75 | 6966.25/6968.00/6965.25/6967.75 (research) | CONFLICT / 1 |
| WB-ALL-026 / All Nodes!E26 | MINOR W2 | 2026-04-12T16:00:00; 6884.00 | 6829.00; 2026-04-12 15:00 | ESM2026 6778.25/6778.50/6776.50/6776.75 | 6908.25/6908.50/6906.50/6906.75 (research) | CONFLICT / 0 |
| WB-ALL-027 / All Nodes!E27 | MINOR W3 | 2026-06-02T11:00:00; 7758.00 | 7694.25; 2026-06-02 19:00 | ESM2026 7616.75/7617.25/7616.00/7617.25<br>ESU2026 7678.00/7678.50/7678.00/7678.50 | 7746.75/7747.25/7746.00/7747.25 (research) | CONFLICT / 0 |
| WB-ALL-028 / All Nodes!E28 | MINOR W4 | 2026-07-29T16:00:00; 7395.75 | 7398.00; 2026-07-29 13:30 | ESU2026 7370.00/7371.75/7370.00/7371.50 | 7437.75/7439.50/7437.75/7439.25 (research) | CONFLICT / 0 |
| WB-ALL-029 / All Nodes!E29 | MINOR W5 | blank; — | unavailable / ACTIVE_CANDIDATE | unavailable | unavailable | UNRESOLVED / 0 |
| WB-ALL-030 / All Nodes!E30 | INTERMEDIATE W1 starting low | 2025-04-08T10:00:00; 5188.50 | 5188.50; 2025-04-08 | ESM2025 5123.25/5130.25/5111.25/5117.75<br>ESU2025 5161.00/5161.00/5152.00/5155.75 | 5471.25/5478.25/5459.25/5465.75 (research) | UNRESOLVED / 0 |
| WB-ALL-031 / All Nodes!E31 | INTERMEDIATE W1 ending high | 2026-01-28T09:00:00; 7205.00 | 7151.00; 2026-01-28 | ESH2026 7007.50/7010.00/7007.50/7009.75 | 7187.25/7189.75/7187.25/7189.50 (research) | CONFLICT / 1 |
| WB-ALL-032 / All Nodes!E32 | INTERMEDIATE W2 | 2026-03-30T16:00:00; 6511.00 | 6407.00; 2026-03-30 | ESM2026 6384.00/6384.00/6379.75/6380.00<br>ESU2026 6428.00/6428.00/6428.00/6428.00 | 6514.00/6514.00/6509.75/6510.00 (research) | CONFLICT / 0 |
| WB-ALL-033 / All Nodes!E33 | INTERMEDIATE W3 | blank; — | unavailable / ACTIVE | unavailable | unavailable | UNRESOLVED / 0 |
| WB-ALL-034 / All Nodes!E34 | INTERMEDIATE W4 | blank; — | unavailable / — | unavailable | unavailable | UNRESOLVED / 0 |
| WB-ALL-035 / All Nodes!E35 | INTERMEDIATE W5 | blank; — | unavailable / — | unavailable | unavailable | UNRESOLVED / 0 |
| WB-ALL-036 / All Nodes!E36 | PRIMARY W1 starting low | 2020-03-24T09:00:00; 3096.00 | 3200.00; 2020-04-02 | ESM2020 2401.25/2404.00/2397.00/2402.50<br>ESU2020 2396.75/2397.50/2391.50/2396.25 | 3220.75/3223.50/3216.50/3222.00 (weak identity arithmetic) | CONFLICT / 1 |
| WB-ALL-037 / All Nodes!E37 | PRIMARY W1 ending high | 2022-01-03T07:00:00; 5692.00 | 5620.00; 2022-01-05 | ESH2022 4775.50/4775.50/4773.25/4775.50 | 5658.25/5658.25/5656.00/5658.25 (weak identity arithmetic) | CONFLICT / 1 |
| WB-ALL-038 / All Nodes!E38 | PRIMARY W2 | 2022-10-12T07:00:00; 4462.00 | 4306.00; 2022-10-12 | ESZ2022 3610.75/3615.50/3608.25/3610.25<br>ESH2023 3642.00/3642.00/3637.25/3637.25 | 4483.50/4488.25/4481.00/4483.00 (weak identity arithmetic) | CONFLICT / 0 |
| WB-ALL-039 / All Nodes!E39 | PRIMARY W3 | 2025-02-20T05:00:00; 6548.00 | 6487.00; 2025-02-20 | ESH2025 6144.00/6148.25/6144.00/6146.75 | 6544.25/6548.50/6544.25/6547.00 (research) | CONFLICT / 0 |
| WB-ALL-040 / All Nodes!E40 | PRIMARY W4 | 2025-04-09T03:00:00; 5254.00 | 5182.00; 2025-04-09 | ESM2025 5005.50/5006.50/4999.25/5005.75<br>ESU2025 5040.25/5040.25/5040.25/5040.25 | 5353.50/5354.50/5347.25/5353.75 (research) | CONFLICT / 0 |
| WB-ALL-041 / All Nodes!E41 | PRIMARY W5 | blank; — | unavailable / ACTIVE | unavailable | unavailable | UNRESOLVED / 0 |

Cross-tab counts in the last column identify preserved All Nodes-versus-degree-sheet discrepancies; full conflicting cells/values remain in the evidence. The primary CONFLICT result specifically records the fourteen operational-manual discrepancies. No conflicting source was selected as canonical.

Dates/times retain original Excel values/types and source precision in the JSON. Original basis/contract/timezone remain unconfirmed. Structural status stays SOURCE_EVIDENCE_PENDING_ENGINE22_RECONCILIATION. Operational source is pinned manual git blob **4dbcdead83ae7a27659f8cc69f562692364f1ce8**, body SHA **e88558cadfdb86a35de43e00d0e7a1541d8841bd58da440a2777e4c45c79640d**. Date-only operational timestamps are not upgraded to minute precision. Blank endpoints stay blank even where an older operational mark exists.

### Native seven-degree evidence, separate from diagnostics

| Degree | Native resolution queried | Node-associated native queries | Acceptance |
|---|---|---:|---|
| SUBMICRO | 5min | 6 | research only |
| MICRO | 10min | 4 | research only |
| SUBMINUTE | 1hour | 6 | research only |
| MINUTE | 4hour | 4 | research only; malformed node not queried |
| MINOR | 1session | 10 | period/calendar/finality unaccepted |
| INTERMEDIATE | 1week | 6 | period/calendar/finality unaccepted |
| PRIMARY | 1month | 10 | period/calendar/finality unaccepted |

All 46 native-frame queries returned observations. Monthly/weekly prices are authentic source fields, but original node chart timeframe, accepted period boundaries, completion and structural sufficiency remain unknown. We did not replace a missing degree with another timeframe. The older Primary node queries are bounded point investigations; they do not assert complete continuous archival acquisition from 2020.

## Contract lineage and rollover research

28 full-year contract contexts were investigated. Nine satisfy the protected V2 metadata rule as research bindings; nineteen remain UNRESOLVED because dated legacy metadata lacks settlement_date. Historical first/last-trade lifespan proposals are retained additively with settlement null; they are not verified identities and do not replace existing bindings. Raw provider aliases and full-year proposals remain separate.

26 sequential quarterly overlap pairs from M2020→U2020 through U2026→Z2026 were measured. Reference selection uses the latest shared provider session label strictly before a **calendar research roll date**; shared window_start and unique rows are required. Reference labels are provider labels, not exchange-calendar certification. Close and settlement_price are tested separately. Strict adjustment chains stop at an unresolved identity; weak arithmetic is separately exposed only where dated lifespan proposals exist. A missing coefficient never becomes zero.

| Pair | Candidate roll date | Shared reference label | New-old close | New-old settlement | Identity context |
|---|---|---|---:|---:|---|
| ESM2020 → ESU2020 | 2020-06-15 | 2020-06-12 | -11.25 | -11.00 | UNRESOLVED |
| ESU2020 → ESZ2020 | 2020-09-14 | 2020-09-11 | -10.25 | -10.50 | UNRESOLVED |
| ESZ2020 → ESH2021 | 2020-12-14 | 2020-12-11 | -7.50 | -7.75 | UNRESOLVED |
| ESH2021 → ESM2021 | 2021-03-15 | 2021-03-12 | -8.75 | -9.50 | UNRESOLVED |
| ESM2021 → ESU2021 | 2021-06-14 | 2021-06-11 | -9.00 | -9.25 | UNRESOLVED |
| ESU2021 → ESZ2021 | 2021-09-13 | 2021-09-10 | -9.00 | -9.25 | UNRESOLVED |
| ESZ2021 → ESH2022 | 2021-12-13 | 2021-12-10 | -7.50 | -7.50 | UNRESOLVED |
| ESH2022 → ESM2022 | 2022-03-14 | 2022-03-11 | -9.00 | -9.00 | UNRESOLVED |
| ESM2022 → ESU2022 | 2022-06-13 | 2022-06-10 | 1.25 | 1.50 | UNRESOLVED |
| ESU2022 → ESZ2022 | 2022-09-12 | 2022-09-09 | 17.75 | 18.25 | UNRESOLVED |
| ESZ2022 → ESH2023 | 2022-12-12 | 2022-12-09 | 32.75 | 32.00 | UNRESOLVED |
| ESH2023 → ESM2023 | 2023-03-13 | 2023-03-10 | 34.50 | 34.75 | UNRESOLVED |
| ESM2023 → ESU2023 | 2023-06-12 | 2023-06-09 | 43.75 | 44.00 | UNRESOLVED |
| ESU2023 → ESZ2023 | 2023-09-11 | 2023-09-08 | 49.25 | 49.50 | UNRESOLVED |
| ESZ2023 → ESH2024 | 2023-12-11 | 2023-12-08 | 52.75 | 52.75 | UNRESOLVED |
| ESH2024 → ESM2024 | 2024-03-11 | 2024-03-08 | 64.00 | 63.50 | UNRESOLVED |
| ESM2024 → ESU2024 | 2024-06-17 | 2024-06-14 | 64.50 | 64.75 | UNRESOLVED |
| ESU2024 → ESZ2024 | 2024-09-16 | 2024-09-13 | 60.75 | 61.25 | UNRESOLVED |
| ESZ2024 → ESH2025 | 2024-12-16 | 2024-12-13 | 70.25 | 70.25 | UNRESOLVED |
| ESH2025 → ESM2025 | 2025-03-17 | 2025-03-14 | 52.25 | 52.25 | FULL_YEAR_METADATA_MATCH_RESEARCH_ONLY |
| ESM2025 → ESU2025 | 2025-06-16 | 2025-06-13 | 51.75 | 52.25 | FULL_YEAR_METADATA_MATCH_RESEARCH_ONLY |
| ESU2025 → ESZ2025 | 2025-09-15 | 2025-09-12 | 56.75 | 56.75 | FULL_YEAR_METADATA_MATCH_RESEARCH_ONLY |
| ESZ2025 → ESH2026 | 2025-12-15 | 2025-12-12 | 59.75 | 59.75 | FULL_YEAR_METADATA_MATCH_RESEARCH_ONLY |
| ESH2026 → ESM2026 | 2026-03-16 | 2026-03-13 | 49.75 | 49.75 | FULL_YEAR_METADATA_MATCH_RESEARCH_ONLY |
| ESM2026 → ESU2026 | 2026-06-15 | 2026-06-12 | 62.25 | 62.50 | FULL_YEAR_METADATA_MATCH_RESEARCH_ONLY |
| ESU2026 → ESZ2026 | 2026-09-14 | 2026-09-11 | 67.75 | 67.75 | FULL_YEAR_METADATA_MATCH_RESEARCH_ONLY |

Policy version CME_CUSTOMARY_MONDAY_CALENDAR_RESEARCH_V1 is **not an approved TradingView roll history**. Current CME tables corroborate 2025–2026 customary roll dates; earlier dates are generated calendar research hypotheses and may have historical holiday/rule exceptions. No roll is selected for production.

### September–December 2026 findings

September 11 provider closes: ESU6 **7660.75**, ESZ6 **7728.50**, difference **67.75**. Settlement fields: **7659.50 / 7727.25**, also **67.75**. September 10 closes yield **66.00**; September 9 closes yield **65.50**. These differences depend on reference day and convention. First sampled session with December volume exceeding September is **September 14** (849,992 vs 737,362); this is an observed crossover, not proof of TradingView's switching rule. Original paired observation identities and all overlap-day spreads are preserved.

Under this specific research policy, an ESU2026-to-ESZ2026 close-based historical shift is **+67.75**, ESM2026-to-ESZ2026 cumulative shift is **+130.00**, and the settlement-based M2026 chain is **+130.25**. Nothing supports a universal +75 or +66 rule. In this Z2026-terminal candidate, post-roll October ESZ2026 records receive no earlier-contract adjustment; adding the September gap to those current-contract prices would apply it to the wrong segment. Same-time prices across two contracts are not interchangeable; intraday spreads can differ from the selected daily-close coefficient.

For older M2020, the complete weak-identity arithmetic sum to Z2026 is **+819.50 close / +819.75 settlement**. Nineteen unresolved legacy identities block treating that as a verified continuous series. It does not reproduce the owner's recorded coordinates in the tested exact-minute comparison and is not published or supplied to a consumer.

### TradingView documented behavior and remaining independent evidence

TradingView describes additive adjustment of earlier contracts using old/new daily closes near each switch, usually the preceding daily bar. Its switching rule is set per symbol from historical volume patterns; it need not be the first observed volume crossover. TradingView also distinguishes settlement versus last-trade closes on daily/higher intervals. The owner ES1! switch dates, close setting, B-ADJ state, ETH/timezone/bar timeframe and original data vintage have not been independently certified here.

Primary documentation (retrieved October 13, 2026):

- [TradingView back adjustment](https://www.tradingview.com/support/solutions/43000685266-how-can-i-enable-backadjustment-for-continuous-futures/)
- [TradingView switch-date rules](https://www.tradingview.com/support/solutions/43000691027-how-is-the-switching-date-of-contracts-determined-in-continuous-futures/)
- [TradingView switch cards](https://www.tradingview.com/support/solutions/43000689313-switching-continuous-futures-contracts/)
- [TradingView settlement/last closes](https://www.tradingview.com/support/solutions/43000685268-can-i-switch-settlement-and-last-prices-as-close-for-futures/)
- [CME customary equity roll dates](https://www.cmegroup.com/trading/equity-index/rolldates.html)

A reproducible candidate uses adjustedPrice = rawPrice + sum(newClose-oldClose) across its subsequent roll links, with explicit terminal contract, price field, roll policy, source captures and coefficient versions. Coefficients were not tuned to workbook prices. No best-fit per-node offset was invented. Neither a raw future contract chart nor this candidate is automatically TradingView ES1!.

## All 34 Fibonacci references

Published numeric occurrences are read-only evidence from the current Engine 22 snapshot, with exact source paths retained. Equality is not an approved count/basis certificate. Projections, scenario values, touch labels and V3 shadow remain distinct from official authority. No official levels recalculated.

| Registry ID / source cell | Degree / model | Original ratio | Original ES price | Current same-degree numeric occurrences | Price-basis result |
|---|---|---|---:|---:|---|
| WB-FIB-002 / Fib Levels!D2 | SUBMICRO C down scenario | 0.618 | 7818.50 | 4 | UNRESOLVED / no promotion |
| WB-FIB-003 / Fib Levels!D3 | SUBMICRO C down scenario | 1.000 | 7776.50 | 4 | UNRESOLVED / no promotion |
| WB-FIB-004 / Fib Levels!D4 | SUBMICRO C down scenario | 1.272 | 7746.50 | 4 | UNRESOLVED / no promotion |
| WB-FIB-005 / Fib Levels!D5 | SUBMICRO C down scenario | 1.618 | 7708.50 | 4 | UNRESOLVED / no promotion |
| WB-FIB-006 / Fib Levels!D6 | SUBMICRO C down scenario | 2.000 | 7666.50 | 4 | UNRESOLVED / no promotion |
| WB-FIB-007 / Fib Levels!D7 | MICRO W2 retracement | 0.236 | 7845.50 | 4 | UNRESOLVED / no promotion |
| WB-FIB-008 / Fib Levels!D8 | MICRO W2 retracement | 0.382 | 7813.25 | 4 | UNRESOLVED / no promotion |
| WB-FIB-009 / Fib Levels!D9 | MICRO W2 retracement | 0.500 | 7787.50 | 4 | UNRESOLVED / no promotion |
| WB-FIB-010 / Fib Levels!D10 | MICRO W2 retracement | 0.618 | 7761.50 | 4 | UNRESOLVED / no promotion |
| WB-FIB-011 / Fib Levels!D11 | MICRO W2 retracement | 0.786 | 7724.50 | 4 | UNRESOLVED / no promotion |
| WB-FIB-012 / Fib Levels!D12 | SUBMINUTE W3 extension old model | W1 LOW | 7575.00 | 0 | UNRESOLVED / no promotion |
| WB-FIB-013 / Fib Levels!D13 | SUBMINUTE W3 extension old model | W1 HIGH | 7859.25 | 0 | UNRESOLVED / no promotion |
| WB-FIB-014 / Fib Levels!D14 | SUBMINUTE W3 extension old model | W2 LOW | 7671.50 | 2 | UNRESOLVED / no promotion |
| WB-FIB-015 / Fib Levels!D15 | SUBMINUTE W3 extension old model | 0.382 | 7780.00 | 1 | UNRESOLVED / no promotion |
| WB-FIB-016 / Fib Levels!D16 | SUBMINUTE W3 extension old model | 0.500 | 7813.75 | 1 | UNRESOLVED / no promotion |
| WB-FIB-017 / Fib Levels!D17 | SUBMINUTE W3 extension old model | 0.618 | 7847.25 | 1 | UNRESOLVED / no promotion |
| WB-FIB-018 / Fib Levels!D18 | SUBMINUTE W3 extension old model | 1.000 | 7955.75 | 1 | UNRESOLVED / no promotion |
| WB-FIB-019 / Fib Levels!D19 | SUBMINUTE W3 extension old model | 1.272 | 8033.00 | 1 | UNRESOLVED / no promotion |
| WB-FIB-020 / Fib Levels!D20 | SUBMINUTE W3 extension old model | 1.618 | 8131.50 | 1 | UNRESOLVED / no promotion |
| WB-FIB-021 / Fib Levels!D21 | SUBMINUTE W3 extension old model | 2.000 | 8240.00 | 1 | UNRESOLVED / no promotion |
| WB-FIB-022 / Fib Levels!D22 | MINUTE W3 extension legacy operational | 0.382 | 7674.25 | 1 | UNRESOLVED / no promotion |
| WB-FIB-023 / Fib Levels!D23 | MINUTE W3 extension legacy operational | 0.500 | 7704.75 | 1 | UNRESOLVED / no promotion |
| WB-FIB-024 / Fib Levels!D24 | MINUTE W3 extension legacy operational | 0.618 | 7735.25 | 1 | UNRESOLVED / no promotion |
| WB-FIB-025 / Fib Levels!D25 | MINUTE W3 extension legacy operational | 1.000 | 7833.50 | 1 | UNRESOLVED / no promotion |
| WB-FIB-026 / Fib Levels!D26 | MINUTE W3 extension legacy operational | 1.272 | 7903.50 | 1 | UNRESOLVED / no promotion |
| WB-FIB-027 / Fib Levels!D27 | MINUTE W3 extension legacy operational | 1.618 | 7992.75 | 1 | UNRESOLVED / no promotion |
| WB-FIB-028 / Fib Levels!D28 | MINUTE W3 extension legacy operational | 2.000 | 8091.00 | 1 | UNRESOLVED / no promotion |
| WB-FIB-029 / Fib Levels!D29 | MINOR W5 projection legacy operational | 0.382 | 7601.25 | 1 | UNRESOLVED / no promotion |
| WB-FIB-030 / Fib Levels!D30 | MINOR W5 projection legacy operational | 0.500 | 7664.00 | 1 | UNRESOLVED / no promotion |
| WB-FIB-031 / Fib Levels!D31 | MINOR W5 projection legacy operational | 0.618 | 7726.50 | 1 | UNRESOLVED / no promotion |
| WB-FIB-032 / Fib Levels!D32 | MINOR W5 projection legacy operational | 1.000 | 7929.75 | 9 | UNRESOLVED / no promotion |
| WB-FIB-033 / Fib Levels!D33 | MINOR W5 projection legacy operational | 1.272 | 8074.50 | 7 | UNRESOLVED / no promotion |
| WB-FIB-034 / Fib Levels!D34 | MINOR W5 projection legacy operational | 1.618 | 8258.25 | 7 | UNRESOLVED / no promotion |
| WB-FIB-035 / Fib Levels!D35 | MINOR W5 projection legacy operational | 2.000 | 8461.50 | 7 | UNRESOLVED / no promotion |

Thirty-two references have same-degree numeric occurrences in the captured model-price fields; two have none in that captured scope. The Engine 22 intraday_submicro spelling is mapped explicitly for source comparison only; it does not grant shadow authority. All 34 remain unverified for the proposed price basis. Source-cell official fields (NO / UNVERIFIED), caveats and reported touch states are preserved. No actual coordinate discrepancy has been conclusively attributed to an approved TradingView adjustment. In particular, a single translation cannot be imposed on anchors belonging to different roll segments/vintages; Engine 22 must approve any structural reconciliation and official Fib geometry.

## Exact unresolved decisions — route through Issue #130 / Lead Manager

1. **MINUTE WB-ALL-018 / All Nodes C18,D18:** confirm malformed 7/29/206 and duration 1. Do not infer 2026 from legacy W1, or turn 24 hours into midnight.
2. **TradingView source configuration:** use a bounded ES1! data export and configuration evidence covering the specific nodes and roll cards. Confirm B-ADJ, settlement-versus-last close, ETH, timezone, original chart timeframe/bar labels, relevant switch dates and saved/export vintage. Existing workbook Source Notes preserve settings as reported/unknown; no need to re-enter all nodes.
3. **Count authority:** Engine 22 must reconcile workbook/legacy/V3 counts and fourteen manual plus twelve cross-tab conflicts, especially Minute W2/W3, Subminute anchors, Micro W1 and Submicro ABC. Same labels do not establish same counts. Candidate prices stay unchanged while deciding.
4. **Same recorded instant, different workbook low prices:** MINOR W1 6496 and INTERMEDIATE W2 6511 both record March 30, 2026 16:00. Confirm intended events, bar timeframes and basis/vintage; different degree intervals may identify different extrema. Engine 11 does not silently choose one value or attribute their 15-point difference to rollover.
5. **Source contracts/calendars/finality:** nineteen legacy identity gaps, historical provider session/bar alignment and completion evidence remain independent acceptance conditions. Weekly/monthly sufficiency is owned structurally by Engine 22. No blanket calendar approval from a successful query.

Do not ask the owner to redo the workbook. The targeted settings/date questions above arise after exhausting preserved evidence and bounded source queries. No external support message or source purchase was sent. Broader old-history acquisition and private archive transfer are not authorized by this research milestone.

## Engine 2B chart handoff contract

No node receives a certified derived chart coordinate from this milestone; every row's derivedChartCoordinate remains null. The original coordinates are preserved and available for owner/Engine 22 review.

A future chart source certificate must pin seriesId, datasetVersion/capture vector, full contract lineage, raw/unadjusted/back-adjusted basis, adjustmentVersion with terminal contract and per-roll coefficient/source references, close convention, ETH/session calendar and native interval policy, timestamp labels/units/timezone, source finality and source vintage. A compatible node certificate must identify original registry cell and coordinate, Engine 22 approved count/revision/status, exact time precision, and independently justified display mapping. Missing fields produce a visible unavailable state, not a nearby-candle fallback or guessed offset.

- RAW_INDIVIDUAL_CONTRACT, CONTINUOUS_UNADJUSTED and BACK_ADJUSTED_RESEARCH are separate series and cannot be mixed in a page/live stream or overlay.
- Original structural coordinates and any separately approved derived chart coordinates remain separate immutable fields. Count approval cannot be inferred from candle availability or a price match.
- Historical/live transition must pin active contract, basis and dataset; rollover changes require a new explicit lineage/version. Active execution prices remain raw instrument/broker authority. Adjusted history never enters sizing, stops, targets, Engine 26 zones or PAPER/REAL positions.
- Engine 2B owns T24–T27: stable zoom/scroll and page boundaries, no timeline expansion, timeframe/source-version race protection, 25,000-bar memory behavior, exact approved overlay/source/basis parity and independently reversible rollback. Date-only and ambiguous anchors must not be fabricated into intraday positions.
- Preview may proceed independently of completing all historical degrees only after its own approved count/source/basis/time certificate. No chart/engine integration occurs here.

## Acceptance and reproducibility

367 automated tests (350 inherited +17 reconciliation tests) cover unchanged March30 correction, invalid date/duration, full-year alias context, independent native/diagnostic frames, nanosecond precision, segment-specific offsets, missing links, distinct close policies, weak identity separation, preserved operational records, candidate-only equality, nearby-time rejection and ambiguous session handling. Authentic archived analysis independently verifies all original body digests, workbook/source hashes and all 40/34 records. No browser/T24–T27 execution claimed.

Source artifact expires **November 12, 2026 23:10:38Z / 16:10:38 Phoenix**. It is not an approved independent permanent archive. The prior private primary/backup verification and transfer hold remain intact.

All paths are additive under isolated Engine 11 research/tests/workflow/docs. No accepted registry, V1/V2 runtime, production route/streamer/frontend, Elliott count/anchor/Fib, Engine 26 geometry, trading/accounts/risk/Journal/Replay, merge or deployment changed.

Submit this full milestone to Engine 2B for ACCEPT or REVISE. Any later coordinate conversion, structural promotion, chart integration or production activity requires its own authority.
