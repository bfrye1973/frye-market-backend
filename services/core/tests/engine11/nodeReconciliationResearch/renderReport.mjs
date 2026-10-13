import fs from 'node:fs/promises';
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: renderReport.mjs REPORT_JSON OUTPUT_MARKDOWN');
const r=JSON.parse(await fs.readFile(input,'utf8')),money=x=>x===null||x===undefined?'—':Number(x).toFixed(2),esc=x=>String(x??'—').replaceAll('|','/').replaceAll('\n',' '),ohlc=x=>['open','high','low','close'].map(k=>money(x[k])).join('/');
let text=`# ENGINE 11 — SEVEN-DEGREE ES HISTORICAL NODE & PRICE-BASIS RECONCILIATION V1

Phase 2 read-only research. Engine 2B Lead Manager review: ACCEPT or REVISE. Central record [Issue #130](https://github.com/bfrye1973/frye-market-backend/issues/130); immutable registry [PR #131](https://github.com/bfrye1973/frye-market-backend/pull/131) at 482ef74bc46367718fb207148d5e92a7b0cc248a. Engine 22 structural audit [PR #132](https://github.com/bfrye1973/frye-market-backend/pull/132) remains a separate owner deliverable.

## Outcome and limits

**40 rows reconciled: 24 price-bearing nodes and 16 intentionally blank placeholders. All 34 Fibonacci references reviewed.** All seven degrees accounted for. 280 bounded authenticated queries succeeded, returning 8,422 original source observations; no timeframe substitution or fabricated endpoints. All 280 HTTP bodies were digest-verified during replay.

Node results: **0 VERIFIED MATCH, 0 CANDIDATE MATCH, 14 CONFLICT, 26 UNRESOLVED**. CONFLICT identifies preserved workbook-versus-operational coordinate discrepancies, not proof that the workbook is wrong. UNRESOLVED includes 16 blank placeholders. The malformed MINUTE W1 date remains unavailable for candle comparison; its primary CONFLICT result records the separate legacy-coordinate discrepancy. No exact OHLC-field equality was found at the recorded minute under the tested Phoenix/UTC hypotheses and close/settlement calendar-roll models. This bounded test does not disprove owner drawing coordinates, higher-timeframe extrema, different TradingView roll rules or other data vintages. Nearby observations are not promoted to matches.

**Verified canonical candles and approved derived chart coordinates remain zero.** Numerical acquisition success is not calendar, contract, finality, price-basis or Elliott approval. No official Fibonacci recalculation or count decision is made.

## Source preservation and reproducibility

Original corrected XLSX restored from the existing seven Phase 1 fragments: **21,141 bytes**, SHA-256 **${r.workbookSha256}**. Independent cell archive SHA-256 **3242facd72f1ec1a1d14db02f5a063f8d3bc0b78018c5d434ceeb164c311d604**; **11 sheets / 1,113 populated cells**. No registry cell or imported coordinate changed. Independent ZIP/XML inspection confirmed the 1900 date system and All Nodes C24/D24/E24 values 46111, 0.66666666666666663, 6496: **March 30, 2026, 16:00, 6496.00**. C18 is shared-string text **7/29/206**; D18 is numeric 1 with duration format 46 ([h]:mm:ss). Neither a year nor a midnight timestamp was guessed.

Workbook ledger IDs WB-ALL / WB-FIB and importer aliases OWNER-ALL / OWNER-FIB are preserved side-by-side by source row. This report is a derived analysis, not a competing registry. Twelve All Nodes-versus-degree-tab price conflicts remain attached in the full evidence; fourteen old manual conflicts remain independent. Matching labels are not proof of the same Elliott count.

Authentic capture SHA **5343f083c115c4d36e755b118c9549fb194084c3**, Actions run **38482575971**, artifact **11857526637**. ZIP SHA **b1d4791e35b5bec885875c3adcacd99b4942d7db108369deb7acd3841a072f4b**. Uncompressed original evidence SHA **${r.originalEvidenceSha256}**. Capture ended **${r.asOf}** (October 13, approximately 16:10 Phoenix). Original bodies, requests, provider rows and capture contexts are preserved in the existing Actions artifact; no full HTTP bodies are committed to this public repository or transferred to a new private destination.

Dataset version: **${r.datasetVersion}**. It pins the per-receipt capture vector, not an atomic TradingView vintage. Each selected candle carries complete query ID, original/V2 receipt ID, V2 observation ID, row digest, body digest, observedAt, native resolution, original nanosecond window_start and session_end_date. Source finality and interval/calendar acceptance remain UNKNOWN. No source corrections inferred from differing observations; no accepted V1/V2 identity module edited.

Full derived evidence: engine11-seven-degree-reconciliation-v1.json.zlib.b64, with its integrity JSON and readReport.mjs reader. It contains all OHLC candidates, both timezone hypotheses, native-frame observations, strict/weak adjustment lineage, all 40 source rows, 34 Fib rows and receipt identities. The zlib encoding stores selected analysis without changing coordinates; original evidence stays separately pinned.

## All 40 node records

Prices are ES points; OHLC shown as O/H/L/C. This table shows diagnostic **1-minute source observations at the hypothesized Phoenix instant**, not replacement structural inputs. UTC alternatives and full native-frame evidence remain in the JSON. A recorded minute is not a verified exchange interval or original TradingView bar-label convention. No nearest-bar snapping occurs.

The first listed raw candidate's close-based adjusted OHLC is shown. Weak means the arithmetic uses unaccepted lifespan-only contract proposals; strict missing links remain unavailable. Candidate adjustment versions and every component coefficient are in the full evidence. Future H2027 candidates are not relabeled current ESZ2026. Original versus operational coordinates are kept separate.

| Registry ID / cell | Degree / node | Workbook date/time and price | Existing manual coordinate | Raw contract OHLC at hypothesized time | Candidate adjusted OHLC | Result / cross-tab conflicts |
|---|---|---|---|---|---|---|
`;
for(const n of r.nodes){const c=n.coordinateInterpretation,date=c.recordedLocalTime??(n.original.rawDate!==null?String(n.original.rawDate)+' / raw time '+String(n.original.rawTime):'blank'),price=money(n.original.price),raw=n.rawCandidates.filter(x=>x.hypothesis==='OWNER_REPORTED_PHOENIX_UNCONFIRMED'),manual=n.existingOperationalCoordinate;let adjustment='unavailable';if(raw.length){const a=raw[0].adjustedCandidates.find(x=>x.field==='close'),w=raw[0].weakIdentityArithmeticCandidates.find(x=>x.field==='close');const used=a?.offset===null?w:a;adjustment=used?.adjustedOhlc?ohlc(used.adjustedOhlc)+(used.weakIdentityResearch?' (weak identity arithmetic)':' (research)'):'unavailable';}
 text+=`| ${n.registryNodeId} / All Nodes!${n.original.source.priceCell} | ${n.degree} ${esc(n.node)} | ${esc(date)}; ${price} | ${manual?.price!=null?money(manual.price)+'; '+esc(manual.time):'unavailable / '+esc(manual?.status)} | ${raw.length?raw.map(x=>x.source.contract+' '+ohlc(x.originalOhlc)).join('<br>'):'unavailable'} | ${adjustment} | ${n.result} / ${n.workbookCrossSheetConflicts?.length??0} |\n`;
}
text+=`
Cross-tab counts in the last column identify preserved All Nodes-versus-degree-sheet discrepancies; full conflicting cells/values remain in the evidence. The primary CONFLICT result specifically records the fourteen operational-manual discrepancies. No conflicting source was selected as canonical.

Dates/times retain original Excel values/types and source precision in the JSON. Original basis/contract/timezone remain unconfirmed. Structural status stays SOURCE_EVIDENCE_PENDING_ENGINE22_RECONCILIATION. Operational source is pinned manual git blob **4dbcdead83ae7a27659f8cc69f562692364f1ce8**, body SHA **${r.operationalSourceAudit.bodySha256}**. Date-only operational timestamps are not upgraded to minute precision. Blank endpoints stay blank even where an older operational mark exists.

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
`;
for(const q of r.rolls)text+=`| ${q.old.full} → ${q.next.full} | ${q.rollDate} | ${q.referenceSessionDate??'unavailable'} | ${money(q.coefficients.close)} | ${money(q.coefficients.settlement_price)} | ${q.identityState} |\n`;
text+=`
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
`;
for(const f of r.fibs)text+=`| ${f.registryFibId} / Fib Levels!${f.original.source.priceCell} | ${f.original.degree} ${esc(f.original.model)} | ${esc(f.original.ratioRaw)} | ${money(f.original.price)} | ${f.publishedNumericCandidates.length} | UNRESOLVED / no promotion |\n`;
text+=`
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
`;
await fs.writeFile(output,text);console.log('Reconciliation report written: '+r.nodes.length+' nodes / '+r.fibs.length+' Fib references.');
