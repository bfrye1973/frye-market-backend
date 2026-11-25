> **LATEST AUTHORITATIVE MANAGER CONTINUITY LOCK (Nov 11, 2026):** [MANAGER_CONTINUITY_2026-11-11.md](./MANAGER_CONTINUITY_2026-11-11.md). This supersedes stale Phase 2–4 statuses below: **PR #295 is merged**, Phase 5 is the active next assignment, and conditional ~$22/month budget is recorded. Read that file first on any chat restart.


## Owner budget approval — November 10, 2026
- Owner explicitly approved an **estimated ~$22/month incremental budget** for a dedicated Engine18 Render recorder worker, **new 50 GB persistent disk**, and private backups. **Approval is conditional: finish technical checks BEFORE provisioning**. This is not permission to deploy/turn on continuous recording or change the existing 100 GB main-backend disk.
- Preserve an estimated incremental cap of ~$22/month; actual billing and feature costs must be checked before creation. If the proposed configuration exceeds the estimate or has variable usage charges that cannot be capped, return with a priced alternative for owner authorization.
- Gate 1 Phase4 must complete bounded-memory crash recovery, separate-worker capture/lag isolation, backup upload/inventory/restore verification, credential-safe and clock/session tests, plus manager/Claude review. Only then plan provisioning. No paid resources created as of this update.

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


## Latest owner-approved organization and Gate1 recorder design (Nov 10, 2026)
- **Manager:** GPT-6 Engine 18 manager reviews architecture, isolation, GitHub/Render changes and acceptance; **Implementer:** Engine 18A dedicated recorder/replay teammate (separate ChatGPT conversation created by owner); **Quant research lead/reviewer:** Claude. Manager is not an autonomous background worker and cannot create/chat with the other teammate directly; handoffs and code reviews run through GitHub and owner-shared replies.
- **Read next:** [Claude/GPT-6 recorder architecture decisions](./RECORDER_ARCHITECTURE_DECISIONS.md). These are approved design principles, not a deployed raw data recorder.
- **Implementation gate:** first implement a noncollecting, offline-tested raw recorder component that stores the exact received message string, monotonic localSeq, wall/monotonic timestamps, connection-generation, classification, safe error/control records, and versioned event schema. Test rotation, manifest hashes, recovery and deterministic replay. No secret-bearing WebSocket URL in logs or records.
- **Before enabling live raw recording:** owner must verify Ironbeam licensing permits private historical recording, confirm secret rotation, and approve secure durable storage and retention. An isolated component may be developed/tested from synthetic fixtures before permissions are resolved. Do not activate collection or spend money unilaterally.
- **No additional LIVE chart changes or calibrated probability display during Gate1.**

## Storage discovery and owner confirmation — November 10, 2026

- **Owner explicitly states Ironbeam permits recording** for the project's internal use. Treat this as the owner's confirmation, not an independently examined license document. Do not repeatedly ask the owner to reapprove project development; if exact archival/replay/redistribution terms affect implementation, document a focused question only.
- **Verified existing Render disk:** service `frye-market-backend-1` (`srv-d2ds5nodl3ps73b7i2og`) has a 100 GB persistent disk `dsk-d6a9f9fgi27c73affbdg` mounted at `/var/data/replay` in workspace `tea-d2d7147diees73fu8sog`.
- **Do not confuse allocated capacity with free space**: actual free bytes and current disk contents not verified from the available service metadata. No file mutations performed.
- **Render disk limitation (official Render docs):** an existing disk is accessible only to its attached service instance. A separate background recorder worker cannot mount or share the existing backend disk. Do not attach/reassign/resize existing backend disk or disturb Engine 8/11/replay without independent audit and explicit approval.
- **Recommended isolation:** dedicated private single-writer recorder worker with its own durable volume and private backup; alternatively a carefully designed storage service/uploader on the existing backend only after formal impact analysis. First estimate real recorder size and existing free capacity, then approve recurring spend. Do not assume the 100 GB disk is available to Engine18.
- **Status:** this resolves WHERE the owner's existing 100 GB disk is, not a production authorization to record raw data or deploy a recorder.
- Render service dashboard: https://dashboard.render.com/web/srv-d2ds5nodl3ps73b7i2og ; official limitations: https://render.com/docs/disks


## November 10 latest updates: Claude approved synthetic recorder and owner institutional-context request
- **PR #292 merged SYNTHETIC ONLY** into isolated Engine18 foundation branch after Claude approved and required D1 docs correction. Merge commit `b39b76f10d13b89a2a14da289ee408d8b284da06`; all three current-head CI workflows passed. This did NOT deploy, connect raw capture, create paid storage or authorize trading.
- **Before real recording**, implement Claude's L1-L5 requirements: binary ArrayBuffer/Blob handling; per-socket generation; distinct WebSocket error versus recorder gap and sanitized close details; REST subscription ACK evidence including streamId without credentials; sanitized run header; trusted clock/NTP sample payload, plus dedicated durable worker, bounds, backups, session calendar and capacity tests.
- **Owner wants Engine18 context from institutional ES zones and current Engine22 Micro/Submicro strategy/Fib cards.** Read-only source mapping/constraints are documented in [institutional/micro/submicro context contract](./INSTITUTIONAL_MICRO_SUBMICRO_CONTEXT.md). Do not alter chart or infer order-book liquidity from an institutional or Fibonacci chart zone. Integrate as later research features only after point-in-time/source-basis validation.

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

## Gate 1 PR #291 manager and Claude review update (2026-11-10)
- [Isolated synthetic recorder PR #291](https://github.com/bfrye1973/frye-market-backend/pull/291) remains **DRAFT, UNMERGED and UNDEPLOYED** at head `be166d95ab6ef5228e7a240f02464835c5e7748e` pending corrections.
- Engine 18B corrected the original manager's four recorder integrity/recovery findings. Recorder GitHub Actions run #42943116147 **16/16 PASS** and Engine18 baseline #42943116196 PASS. Those tests do not establish licensed recording readiness.
- Claude independently reviewed and returned **APPROVE WITH CORRECTIONS**. He identified four **NEW schema blockers BEFORE synthetic merge**: (B1) durable RECORDER_START/RECORDER_STOP and crash GAP even without an open file, (B2) unique per-process runId on every record, (B3) distinct actual receive-wall/monotonic timestamps versus writer time and receive-time-based partition, (B4) rawEncoding utf8/base64 with lossless binary payloads. Minor gap counter fix also requested.
- Manager sent exact implementation/test requirements directly on PR #291 (comment #6784940681). **DO NOT MERGE** until Engine18B implements, tests, and receives manager re-review. Previous four original blockers remain closed.
- Additional before-live gates: throughput and group commit, structured GAP reasons, lifecycle/run headers, NTP-clock health, Render overlap behavior, remote protected retention and market-data licensing, contract/session calendar, five-session collection, Gate1 I1–I8/T1–T12 tests. No chart/trading changes.
