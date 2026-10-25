# Engine 27 V3 — LIVE Micro source acceptance
**Status: BLOCKED — source-code provenance mapped; real runtime ES and Engine10 values NOT verified.**
Inspection date: 2026-10-25 America/Phoenix. No trading activity or production change.

## Source-to-contract matrix
|Source|Verified code path / canonical record|Timestamp / closure semantics|Identity|Runtime availability|
|---|---|---|---|---|
|ES 10m OHLC|snapshot marketMeter.layers.emaPosture.tenMinute.bars OR emaPosture.tenMinute.bars; Engine22 touch processing applyOwnerPriceTouchesV1 observations(bars10m)|Engine22 touch processor requires Unix seconds BAR START, barStart + 600000 <= evaluationTime; source producer not yet verified|ES / 10m|NOT VERIFIED in live snapshot|
|Engine22 Micro owner|strategies['intraday_scalp@10m'].engine22WaveStrategy.currentWavelength.degrees.micro.ownerMicroCDown|owner working model, version engine22.microCDownOwnerWatch.v1; Fib level status/touchedAt separate from completion|micro C down inside subminute C|NOT VERIFIED live|
|Neighbors|currentWavelength.degrees.submicro.ownerSubmicroCDown; subminute.ownerCurrentCDown|owner publication age unknown|submicro/micro/subminute|NOT VERIFIED live|
|Engine25|buildStrategySnapshot engine25Context -> engine27UnifiedMarketContext.participation|updatedAt; present module policy 90m; equity-session rules require inspection|market participation|Render refresh job identified; specific snapshot NOT VERIFIED|
|Engine29|data/engine29-cross-market-stress.json -> buildStrategySnapshot|timestamp, dataDegraded; present module policy 90m|Micro + Submicro only|Refresh job identified; record NOT VERIFIED|
|QQQ|engine27CrossMarketLevels.instruments.QQQ; engine27LiveCrossMarketReactions.instruments.QQQ|daily lastCandleTime + hourly lastCompletedAt; completed direct Polygon candles|QQQ|Render logs show 12 zones as of Oct 23; live reaction NOT VERIFIED|
|VIX|engine27CrossMarketLevels.instruments.VIX; engine27LiveCrossMarketReactions.instruments.VIX|daily lastCandleTime + hourly lastCompletedAt|I:VIX direct|Render logs show 12 zones as of Oct 23; live reaction NOT VERIFIED|
|ES zones|logic/engine27/crossMarket/readEsInstitutionalContextV1.js -> data/es-smz-manual-structures.json|manual structure status, no OHLC reaction until independently checked|ES|NOT VERIFIED current|
|Engine10 REAL|logic/journal/tradeJournalStore.js -> listTrades; trade.realBroker.contracts[] + trade.structuralContextAtEntry|entry.fillTime, snapshotTime, status OPEN; check immutable capture|SCHWAB_6380 / MICRO (legacy INTRADAY)|Actual contracts NOT VERIFIED|
|Engine9 plan|strategy.engine9OfficialManagementPlan; only planId, candidateId, strategyId, direction and official flags fully joined|plan snapshot and creation identity required|Micro specific, no accidental Minute plan mapping|NOT VERIFIED linked to live REAL trades|
|Engine12 replay|Engine12 stored replay snapshot archive, auditor read path needs verification|immutable historical snapshotTime, observation-time cutoff|ES|NOT VERIFIED live|
|Engine28|engine28a/buildMicroReplayLearning.js|historical replay observation/outcome timeline|Micro shadow learning|Existence confirmed, calibration authority NOT VERIFIED|

## Contract reconciliation findings
- Engine22 *consumer code* treats source ES 10m bar.time as seconds at bar start. Live producer proof and session rollover have not been independently observed. V3 must continue rejecting unknown units.
- Engine22 current owner levels are provisional; TOUCH and qualified hold/failure and approved tradable objective must remain separate. No live next-objective claim is authorized.
- Snapshot route reads services/core/data/strategy-snapshot-es.json, without recomputing engines; snapshot timestamp may lag Render live refresh.
- V3 sourceAssembly.qualified means ONLY basic owner/ES source-adapter qualification, not six-source freshness or strategy permission. The unified manager returns entryAuthorized:false, confirmedObjective:null, holdExitRecommendation:null.
- Real account 6380 journal identity may be internally represented as INTRADAY while its degree role is MICRO. Check actual trade shape rather than filling absent plan or thesis from current market.
- Engine10 structuralContextAtEntry may legitimately indicate ENTRY_STRUCTURE_UNAVAILABLE. Do not backfill.

## Safe readonly live verification
The connected Render API exposes metadata/logs but no shell-execution action. No actual ES snapshot or private Engine10 record was retrieved. A sanitized ES snapshot field-inspection script is committed at `manager/inspectProductionMicroSources.readonly.js` on the feature branch. Do NOT deploy the feature branch just to run it.

**One exact command for the existing production Render Shell, using code already on main (no remote script, writes, secrets or network):**
```bash
cd /opt/render/project/src/services/core && node --input-type=module -e 'import fs from "node:fs"; const p="data/strategy-snapshot-es.json"; let s=null; try{s=JSON.parse(fs.readFileSync(p,"utf8"))}catch{} const w=s?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy?.currentWavelength; const m=w?.degrees?.micro?.ownerMicroCDown; const bars=s?.marketMeter?.layers?.emaPosture?.tenMinute?.bars??s?.emaPosture?.tenMinute?.bars; const b=Array.isArray(bars)?bars:[]; const sample=x=>x?{fields:Object.keys(x),time:x.time??null,timeType:typeof x.time,completed:x.completed??null,isComplete:x.isComplete??null,hasOHLC:["open","high","low","close"].every(k=>Number.isFinite(x[k]))}:null; console.log(JSON.stringify({symbol:s?.symbol??null,asOf:s?.now??s?.ts??null,ownerVersion:m?.version??null,ownerDirection:m?.direction??null,ownerStage:m?.stage??null,ownerConfirmation:m?.confirmationStatus??null,anchors:m?{Ahigh:m.waveA?.high,Alow:m.waveA?.low,Bhigh:m.waveB?.high}:null,levels:m?.levels?.map(l=>({key:l.key,price:l.price,status:l.status,provisional:l.provisional,touchEvidenceAvailable:l.touchEvidenceAvailable}))??[],neighbors:{submicro:w?.degrees?.submicro?.ownerSubmicroCDown?.version??null,subminute:w?.degrees?.subminute?.ownerCurrentCDown?.version??null},esTenMinute:{count:b.length,first:sample(b[0]),last:sample(b.at(-1))}},null,2))'
```
The command outputs NO broker records or credentials, and performs only an fs.readFileSync on ES snapshot. It confirms shape and timestamps but not the bar producer's original time contract. Real Engine10 verification requires an independently authorized read-only store inspection; do not dump full journal or account numbers.

## Test / gate
GitHub draft PR #200: integrated 13 fixtures plus 6 modules; recent GitHub V3 and V2 workflows succeeded before this audit-only addition. Run links: https://github.com/bfrye1973/frye-market-backend/actions . No real-record replay acceptance pass.
**Recommendation: BLOCKED for production.** Continue isolated feature-branch source qualification only; no merge, deployment, frontend change or expansion to other strategies.


## Actual production ES evidence received — October 25, 2026
Owner supplied sanitized **read-only** Render Shell output from production service `frye-market-backend-1`. Snapshot timestamp `2026-10-25T22:31:25.615Z`; symbol ES; recorded bar count 120. No broker records were included.

**Verified live snapshot fields:**
- Owner `currentWavelength.degrees.micro.ownerMicroCDown`: `engine22.microCDownOwnerWatch.v1`, direction DOWN, stage DEVELOPING_CANDIDATE, confirmation C_DOWN_WORKING_COUNT_NOT_CONFIRMED.
- A high 7898, low 7678; B high 7813.25. All nine owner Fib records have `key`, `price`, `status`, `provisional`, `touchEvidenceAvailable`.
- Touched provisional references: e236 7761.25, e382 7729.25, e500 7703.25, e618 7677.25. Untouched provisional references: e786 7640.25, e1000 7593.25, e1272 7533.50, e1618 7457.25, e2000 7373.25. None is a confirmed trade objective.
- Neighbor owner versions: `engine22.submicroCDownOwnerWatch.v1`, `engine22.subminuteCurrentCDownReference.v1`.
- ES 10m bar records contain keys `time,open,high,low,close,volume`. `time` is a number. No `completed` or `isComplete` flags. Sample OHLC fields numerical.
- First sampled bar time `1792719600` = `2026-10-23T01:40:00Z` (assumed Unix seconds). Last `1792967400` = `2026-10-25T22:30:00Z`. These values are consistent with Unix seconds at bar START, as expected by Engine22's touch processor.
- Last bar at 22:30Z would complete 22:40Z, after snapshot 22:31:25Z; therefore it was **in progress**, not admissible to the completed-bar evaluator. This is a verified producer-shape/consumer mismatch. The previous bar's presence and last completed time have NOT been independently observed.
- The 120 bars span Friday–Sunday with normal nontrading intervals possible; snapshot row availability does not establish continuous freshness. Weekend/session handling remains unverified.

**Acceptance impact:**
Source owner contract, owner levels, neighbor model versions, bar field names and numeric timestamp representation are now **live-snapshot verified**. Strict UNIX_SECONDS_BAR_START interpretation is strongly supported by matching date/clock alignment, but authoritative upstream producer code must still be checked. V3 input assembler currently passes raw `esBars10m` to a strict adapter which rejects any unfinished candle; feeding the full live snapshot array would fail because it contains the in-progress 22:30 bar. This is a genuine V3-specific source adapter contract issue, not an Engine22 defect.

**Proposed fix for Manager review (NOT IMPLEMENTED):**
Introduce a V3-only source-qualified 10m completion selector *before* `adaptEngine22Micro`. Require numeric integer Unix seconds bar-start, explicit ES/10m identity, chronological/nonduplicate OHLC, time+600000 <= observation time. Exclude trailing unfinished candle(s) as IN_PROGRESS with reason code and count; never silently adjust unknown units or reorder malformed candles. Preserve previous completed candles across Globex maintenance/weekends and classify market-closed age separately from stale/incomplete live data, following actual session schedule. Validate at least two adjacent genuine completed bars when hold/failure confirmation eventually becomes authorized. Keep Engine22 Fib owner levels provisional and `confirmedObjective=null`.
Do not change V2, Engine22, Engine10, trading permissions or production code. Manager approval requested for this V3 adapter contract reconciliation prior to implementation.

**Still blocked:** actual live Engine10 SCHWAB_6380 contracts / entry provenance, linked Engine9 plans, E25/29/QQQ/VIX reaction records and historical Replay/Engine28. **Overall production verdict remains BLOCKED.**
