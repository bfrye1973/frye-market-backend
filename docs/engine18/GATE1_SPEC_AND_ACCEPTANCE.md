# Engine 18 — Gate 1 Market Data Integrity and Order-Book Reconstruction

**Status:** Claude-authored technical specification received November 10, 2026; GPT-6 review and implementation acceptance **PENDING**. This document is an operational preservation of the attached Claude spec; consult the source document for exact wording. **NOT** a production-release approval or completed verification.

**Author:** Claude, Quant Research. **Reviewer/integration:** GPT-6. **Owner:** Frye Dashboard owner.
**Companion:** [Locked research principles](./LOCKED_RESEARCH_PRINCIPLES.md), [successor handoff](./START_HERE.md).
**Operating rule:** No further LIVE chart or trading changes during Gate 1.

## Objective and existing evidence
Gate 1 must reconstruct ES order books deterministically from historical Databento MBO and actual Ironbeam v2 aggregated Level 2, label reliability/coverage at every moment, and stamp features by the first time they could have been known live. Ironbeam v2 **demo** ESZ26 diagnostic: 93 accepted observations; each had 10 nonzero bid levels and 10 nonzero ask levels. Unknown: full image vs increment, feed delay/entitlement, meaning of `l` and per-level `t`, whether `sz` includes implied size, how zero-size rows and `ioc` are encoded. DO NOT claim full depth or verified real-time data.

## 1. Canonical `engine18.event.v1` contract
Required/event fields:
- schemaVersion; provider [DATABENTO, IRONBEAM_V2, RITHMIC]; exchange and **physical** contract (no continuous symbol); vendor instrumentId.
- eventType; side [BID, ASK, NONE]; exact integer `priceTicks` (ES tick $0.25); source quantity; vendor orderId or null (never invent one).
- `tExchNs`, `tSendNs`, `tVendorNs`, `tLocalNs` (nullable; preserve their distinct meanings).
- sequence and sequenceScope [CHANNEL, INSTRUMENT, NONE]; batchId/batchEnd; raw vendor flags; quality [VALID, SUSPECT, INVALID] with reasons; rawRef (partition/offset/hash).
- Order events: ORDER_ADD, ORDER_MODIFY, ORDER_CANCEL, BOOK_CLEAR, informational FILL, NONE. Aggregated: LEVEL_SET, LEVEL_DELETE, IMAGE_BEGIN/END. Common: TRADE, QUOTE_BBO, FEED_STATUS, CLOCK_SAMPLE.

Capability flags by source and derived state: `depthMode` MBO_FULL vs AGGREGATED_10; individualOrderIdsAvailable; fullDepthAvailable; impliedIncluded; aggressorSideVerified; sequenceVerified; originalOrderAgeKnown; entitlement. Rithmic flags TBD until verified.

**Immutable data semantics:** missing != zero. MBO can be reduced to comparable aggregated levels, but aggregated levels must never become fabricated individual orders or queues. Every level is OBSERVED_QTY, OBSERVED_ZERO, OUT_OF_COVERAGE, or FEED_INVALID. Use integer physical-contract ticks; never splice contracts across rolls.

## 2. Databento MBO book reconstructor
Maintain an order map by vendor order ID (side, priceTicks, quantity, firstSeenTs, snapshot/live-add source, priorityKnown), plus summed price-level quantities, order count and FIFO queues.
- A/Add: insert to rear; duplicate ID => SUSPECT.
- C/Cancel: subtract record's size; remove at zero; unknown ID => SUSPECT (verify size semantics in T2).
- M/Modify: update price and size; price change/size increase loses FIFO priority subject to vendor/exchange verification; decrease normally retains priority.
- R/Clear: clear the book; may begin SEEDING.
- T/Trade: informational, does **not** independently mutate book.
- F/Fill: informational passive order detail; does **not** independently mutate book because paired cancellation changes order quantities; avoid double-decrement.
- N/None: no book change; may terminate the batch.
Apply records in source order; **publish book, BBO and features ONLY at Databento F_LAST** for that instrument's exchange-event batch. Do not impose the old 100,000-record cap. A sequence-number gap in one filtered instrument does not necessarily mean the full CME channel gapped; verify scope rather than requiring contiguous per-instrument sequence.

Validity lifecycle: UNSEEDED => SEEDING => VALID. Duplicate/unknown/negative/crossed anomalies => SUSPECT; an unresolved anomaly by batch end => INVALID. F_MAYBE_BAD_BOOK or verified sequence regression => INVALID immediately. Invalid book must recover from a proper snapshot; **never interpolate** features across a gap. Keep anomaly records; don't crash the whole replay.

## 3. Snapshots, queue priority and age
Start historical replay from weekly open when possible. Carry VALID books through week; use daily 00:00 UTC snapshot as independent continuity check, not routine replacement. Reseed only when INVALID. CME Sunday GTC restatement may lack F_SNAPSHOT after 2025-12-07; inspect Clear markers and official source docs. Confirm official snapshot semantics before implementation.
- Snapshot order true entry time is unknown: `ageCensored=true`; age is lower bound from first observed snapshot time. Never impute unknown true age.
- Age-derived features must include censored share; test robustness with censored share below 10% if useful.
- Priority ordering within CME-origin snapshots may be unknown; `priorityKnown=false`, queue-ahead features null where unverifiable. Compare with documented Databento synthetic snapshot behavior.
- On Ironbeam reconnect: write GAP, mark old state STALE, pause persistence clocks and require a new complete image; preserve historical zone registry rather than declaring orders canceled.
- Roll week excluded initially; all books and outcomes use a physical contract.

## 4. Implied liquidity and trades
Databento MBO represents outright order-level depth. Its own MBP-10 may be an MBO-derived outright comparison; **verify** documentation and compare only semantically equivalent quantities. Ironbeam `is`/`ioc` implied fields need empirical checks: does `sz` include `is` or separate it? Keep implied values separate, not summed twice or trained into historical MBO-only features.

Trade/fill reconciliation at completed batch: compare T, F and corresponding C/M changes by price/order. Explanations may include aggressor not on book, spread/implied leg, and unexplained; verify event meanings before claiming exactness. At aggregate L2, best-price reductions versus trade prints do **not** conclusively establish execution vs cancellation without trustworthy synchronization: label inferred/ambiguous as necessary. Away from touch, withdrawal vs modification generally cannot be separated.

## 5. Clocks and point-in-time information
Keep three-plus distinct clocks:
- `tExch`: exchange event ordering and later outcome labels.
- `tSend`: exchange send time when derivable.
- `tVendor`: vendor capture/receipt; Ironbeam per-level `t` meaning UNVERIFIED.
- `tLocal`: actual Engine18 receive timestamp using disciplined host clock.
Record CLOCK_SAMPLE every minute and clock-offset quality. Measure live latency L = local receipt − exchange event, stratified by time/session and bursts, avoiding negative or untrusted-clock assumptions. For historical simulation, expose features only after an appropriate measured live-feed latency allowance (Claude proposes p95). Gate 1 must review whether p95 treatment adequately models burst/gap tails. Freeze contact features strictly before availability; F_LAST must have completed. Never use future order-book changes to score an earlier touch.

## 6. Ironbeam raw recorder and aggregated book ingestion
- Store every authorized unmodified `d` depth, `tr` trade, `q` quote and relevant status/subscribe/gap records **before parsing**, with local receipt time and connection-generation ID; gzip JSONL partitioned per day in access-controlled **durable** storage (not an ephemeral Render service filesystem). Record source schema, source hash/offset and retention/license settings. No credentials/raw licensed events on public endpoints.
- FULL_IMAGE vs INCREMENT must be empirically determined from shape, zero rows, one-/two-sided frames, `l` index behavior and source documentation over an entire ETH+RTH session.
- Only a proven complete image supports asserting observed coverage 10 levels on each side. Otherwise reconstruct deltas according to verified vendor semantics or fail closed.
- Include true wall-clock persistence, coverage changes and disconnects; a missing level outside coverage is not a cancellation.
- Replay the identical raw input twice and demand byte-identical deterministic normalized output.

### Ironbeam tests (I1–I8; author's proposed acceptance)
I1: classify frame shapes and level-index/zero handling during full ETH+RTH; ≥99.99% explained or explicitly support increments.
I2: 10-level coverage checked over **five** full sessions incl. overnight/open, or report session-dependent exceptions.
I3: measure demo/live lag using clocks plus aligned overlapping Databento BBO; mark VERIFIED_LIVE or DELAYED only after proof.
I4: match Ironbeam observed 10-depth to time-aligned comparable Databento MBO-derived levels; list all lag/implied/unexplained differences.
I5: establish whether Ironbeam `sz` includes implied `is`.
I6: match trade counts, price, volume and aggressor with the vendor reference; target ≥99.9% matched volume or qualify.
I7: forced disconnect: GAP marker durable, registry intact but STALE, persistence paused until resync.
I8: deterministic raw replay: byte-identical normalized output.

## 7. Historical Databento tests (T1–T12; author's proposed acceptance)
Pilot: approximately ten overlapping physical-front-contract ES sessions; include weekly open, quiet day and scheduled macro release; exclude roll week. Purchase mbo, definition, status, and comparable mbp-10 only with owner approval.
T1: identical book hash on two replays at each F_LAST.
T2: exact comparable outright top-10 MBP parity (price, size, orderCount) at F_LAST on valid intervals; investigate every discrepancy; this isn't independent feed truth.
T3: zero crossed/locked BBO at F_LAST during valid continuous trading, with exchange phase exceptions.
T4: week-carried book and 00:00 UTC snapshot match IDs/size/price/priority within proven source semantics.
T5: document CME sequence scope and detect no unexplained regressions.
T6: FIFO queue matches passive fill observations at least 99.9%; classify residuals, verify priority assumptions.
T7: trade/fill reconciliation ≥99.9% traded volume explained, <0.1% unexplained, subject to verified source semantics.
T8: injected gap/duplicate add/unknown cancel/F_MAYBE_BAD_BOOK causes proper INVALID/SUSPECT state, no crash, and suppressed features.
T9: report time/phase distribution of age-censored resting quantity.
T10: report single-thread session processing time and peak RAM; Claude's provisional language threshold is 5 minutes/session, not yet an engineering requirement.
T11: no feature at prediction time earlier than event's available time (tExch+L).
T12: MBO->AGGREGATED_10 parity adapter coverage matches Ironbeam-shaped deterministic unit fixtures.

## 8. Gate 1 exit (review required)
- PROCEED only if T1/T2/T3/T4/T8/T11 pass within verified semantics; T6/T7 ≥99.9% with categorized residuals; T5/T9/T10 reported; I1/I2 settled (≥5 full sessions); I3 measured and labeled; I4/I5/I6 investigated; raw recorder survives at least **five consecutive sessions** with every gap marked; real latency distribution measured; and all previously discovered implementation defects closed or explicitly deferred.
- PROCEED WITH LIMITATIONS when the MBO reconstruction is validated but Ironbeam is delayed or diverges; restrict Gate 2 research to validated historical data until the live mismatch is resolved.
- REVISE on unexplained parity gaps or invalid semantics. Record failures, fix, rerun and independently review.
- **No LIVE chart modifications or live probability claims** during Gate 1; tests do not authorize trading.

## 9. Owner input and project handoff
Open owner decisions: typical trade hold time and stop size for later Gate 4 labels; historical pilot purchase; Ironbeam entitlement and Rithmic MBO access; protected durable storage/licensing; credential rotation.
Claude: author/refine Gate1 reconstruction and T1–T12 fixtures; review recorder and GPT-6 future label draft.
GPT-6: red-team Gate1, confirm Ironbeam stream shape, implement safe durable recorder after storage/legal gate, run I1–I8 and publish reproducible evidence.
Do not request credentials in chat; keep secrets in protected Render environment.
