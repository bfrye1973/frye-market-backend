# START HERE — Engine 18 Successor Teammate Handoff

**Owner requested durable handoff on November 10, 2026.**
**This file and all links in this folder are on the backend repository's `main` branch so new conversations and teammates can find them without chat history.**
**READ FIRST:** [Locked principles](./LOCKED_RESEARCH_PRINCIPLES.md) then [Claude's Gate 1 operational specification](./GATE1_SPEC_AND_ACCEPTANCE.md).
These documents are engineering decisions/research specs, NOT claims of profitable trading, completed model validation, or that Gate 1 has passed. Do not silently change the locked decisions.

## Mission and team agreement
Engine 18 is a **predictive liquidity intelligence engine** for CME ES. It must test three independent targets: probability a level is reached, probability of rejection conditional on touch, and reaction/risk size. A current liquidity heatmap and attractive chart lines are not success criteria; out-of-sample predictive improvement versus price-only controls is.

The owner engaged Claude (quantitative research) and GPT-6 (integration/implementation). Their agreed process: alternate author and reviewer by gate, critically challenge rather than rubber-stamp, preregister thresholds, preserve a final untouched holdout, avoid research-only scores portrayed as probabilities. Claude authored the initial Gate 1 spec and detailed code-review findings. GPT-6 must red-team that spec and implement only reviewed, secure changes. No claim of direct autonomous communication with Claude; handoffs pass through the owner.

## Actual infrastructure
- Backend: https://github.com/bfrye1973/frye-market-backend
- **Engine 18 code is on dedicated branch, NOT `main`:** `engine18-liquidity-intelligence-foundation-20261109`.
- Engine 18 development PR: https://github.com/bfrye1973/frye-market-backend/pull/283
- Source path: `services/core/logic/engine18/`
- Isolated read-only research Render service: https://frye-engine18-liquidity-research.onrender.com/monitor ; service ID `srv-dbpijnon74is73e2sprg`; tracked branch above, auto-deploy disabled.
- Frontend: https://github.com/bfrye1973/Frye-Dashboard ; current LIVE chart: https://frye-dashboard.onrender.com/chart?symbol=ES&tf=10m ; overlay file `src/pages/rows/RowChart/overlays/Engine18LiquidityZonesOverlay.jsx`.
- Chart deploy last verified with two BUY + two SELL cap and two-distinct-refresh display confirmation. Those are **presentation filters**, not meaningful long-term order persistence. Do not edit Engine 11 candles or Engine 22 strategies/waves/fibs.
- GitHub/Render direct-access rule: use connected integrations; avoid asking owner to manually edit or paste code when tools can do it.
- All demo secrets must remain in protected Render environment. An earlier chat exposed Ironbeam credentials; rotation needs independent confirmation, never echo them.

## Market data actually connected
- Ironbeam v2 demo: `demo.ironbeamapi.com` / WebSocket; physical instrument `XCME:ES.Z26` (ES December 2026); subscribed `quotes`, `depths`, `trades`.
- **Empirically measured:** 93 valid sampled depth updates, each had 10 nonzero bid and 10 nonzero ask levels (Nov 10 diagnostic); not proof of the full order book, source delay or market-data entitlements.
- Order-book fields seen: `p` price, `sz` displayed quantity, `o` order count, `t` vendor timestamp of unverified meaning, `is` implied size. Other reported fields `l` and `ioc` need semantic verification.
- Current monitoring logic ranks aggregated resting size against side median (1.5x), requires 3 distinct images and has up to 180 images in RAM. Quotes and trades are received/countable but not integrated into scoring. **NOT** validated liquidity finding or calibrated prediction.
- Rithmic individual-order MBO: NOT connected/entitled; local feed contract is a research prototype.
- Databento historical CME MBO: NOT purchased for Engine18; its proposed pay-as-you-go pilot requires owner's approval. Databento live Plus subscription was considered too expensive. Do not imply it is active.
- Engine 11 ES candle history is available independently, but continuous price data must be reconciled with physical contract ESZ26. Engine22 wave nodes/fibs are context, not liquidity sources. Engine 16 ABC research, Engine 25 health and Engine 29 stress are potential future context, not currently synchronized Engine18 prediction features.

## Critical 11-code-findings list from Claude (audit, not yet all fixed)
1. Ironbeam parser treats a packet containing both bid and ask arrays as a complete image; may be delta.
2. Removes zero-size level rows; might discard delete instructions.
3. Ignores level index `l` and implied count `ioc`.
4. Counts image occurrences rather than elapsed wall-clock time as persistence.
5. Current size ranking and 10-level coverage create apparent moving/chasing walls.
6. Monitor recreates its in-memory zone reader on reconnect, losing memory; properly mark GAP/STALE.
7. Experimental `orderBookResearch.js` FILL may subtract quantity contrary to Databento semantics; verify no double-decrement.
8. Old research MBO event cap of 100k too small; needs Clear, F_LAST and streaming.
9. Existing order-research sequence check may incorrectly require contiguous numbers per filtered instrument; verify CME channel scope.
10. Unknown orders/duplicate adds should mark book INVALID until reseed, not kill replay.
11. Engine11-close-at-horizon replay cannot establish which barrier was hit first, nor physical-contract order-book outcomes.

**Caution:** Claude's audit findings are important but must be validated against vendor actual schemas and code before modification. Do not label every hypothesized vendor behavior proven.

## Agreed implementation layers
A. Vendor adapters (Ironbeam L2, future Rithmic MBO, historical Databento MBO; separate context adapters).
B. Canonical versioned events with quality, capability, receipt/availability clocks, exact tick prices and physical instrument IDs.
C. **Raw-first durable recorder** with gaps and replay, authorized storage/licensing and no public payload redistribution.
D. Correct MBP/MBO reconstruction and time/coverage validity.
E. Fixed-price identity and price-anchored liquidity registry (moving walls filtered, no automatic relocation).
F. Feature construction: relative depth by distance/time, survival/time-weighting, trades/replenishment/withdrawal and carefully gated context.
G. Separate reach, reject-on-touch and reaction/risk models.
H. Leakage-free preregistered out-of-sample comparisons to price-only, naive size, random matched levels; calibration/economic tests.
I. Existing LIVE chart as a read-only consumer with max 2 BUY and 2 SELL **display** zones. Evaluate every eligible research candidate, not just displayed 2+2.

## Immediate work order — NO new chart changes
1. Finish independent **review of Gate1 spec**, including its proposed 99.9% fill/trade reconciliation and 100% parity rules; verify Databento semantics against a real pilot before declaring a pass.
2. Verify Ironbeam per-frame level-index/zero-size/full-image-vs-delta behavior; record shape histograms for full ETH/RTH with safe counters. Already-established 10+10 counts do **not** prove full snapshots.
3. Decide secure durable recording storage and licensing; recorder must write authorized raw frames before parsing, including generation/receipt clocks and reconnect events. Not yet operating durably.
4. Obtain an overlapping historical Databento pilot **only after owner approves cost and dataset**; use physical contract and source definitions/status, MBO, comparable MBP-10.
5. Claude designs deterministic Gate1 T1–T12 fixtures and L2 parity; GPT-6 integrates and red-teams tests I1–I8.
6. End Gate1 with documented PROCEED / PROCEED WITH LIMITATIONS / REVISE, then build persistent zone registry only when justified.

## Owner decisions still open
- Typical ES holding period and usual stop distance; needed for Gate4 pre-registered labels.
- Whether Ironbeam demo key has been rotated after past exposure.
- Permission, budget and retention for durable raw capture and Databento pilot purchase.
- Whether Ironbeam/Rithmic can provide live MBO API; do not promise access before verification.

## Important distinctions for successor
- **Documented design ≠ implemented code ≠ verified real-time data ≠ validated trading edge.**
- A line at ES 7558 should remain price-anchored as long as order-book evidence supports it; if it leaves the 10-level observation window, mark OUT_OF_COVERAGE rather than canceled. Current chart lines are a provisional indicator, not a trade recommendation.
- Use BBO/trade reconciliation to estimate consumption vs pulling, but from aggregate L2 never assert certainty about hidden stops, orders or spoofers.
- Historical MBO-derived L2 parity is crucial: simulate what the real ten-level feed could have known; full-MBO features are separate and require future live MBO before deployment.
- Claude proposes an initial ten-session pilot and 3–6 months later for statistical power; do not buy without owner approval. Test L2-parity gain against price-only models before spending on live MBO.
- Preserve tick-size and session/roll logic. Use only point-in-time available features. Do not adjust/rewrite candles or Engine22 owner-approved pivots.
- Gate1 spec in this repo is an operational preservation of the Claude-owner-supplied original; do not imply the whole proposal was implemented or every detail formally approved.

## New teammate instruction
**Read these three markdown files, inspect branch code and PR #283 directly, check current Render status, and continue from Gate 1. Do not restart Engine 18 from scratch or repeat the 38-contract-line experiments.** Report exactly what is verified vs hypothesized; ask owner only for genuine permissions or essential personal trading thresholds.
