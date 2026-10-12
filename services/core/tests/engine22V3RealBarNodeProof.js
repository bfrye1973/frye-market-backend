import fs from "node:fs";
import {buildEngine22V3IndependentNodeShadow as build} from "../logic/engine22/v3/buildIndependentNodeShadow.js";
import {buildEngine22V3OwnerBootstrap} from "../logic/engine22/v3/buildOwnerBootstrap.js";
const snapshot=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const source=JSON.parse(fs.readFileSync("services/core/data/waves/active/active-wave-state-es.json","utf8"));
const bootstrap=buildEngine22V3OwnerBootstrap({activeWaveState:source});
const posture=snapshot.marketMeter?.layers?.emaPosture||snapshot.emaPosture||{};
const barsByTf={"10m":posture.tenMinute?.bars,"1h":posture.oneHour?.bars,"4h":posture.fourHour?.bars,"1d":posture.daily?.bars};
const latest=Math.max(...Object.values(barsByTf).flat().filter(Boolean).map(b=>Number(b.time||0)*1000));
const result=build({canonical:bootstrap.canonical,barsByTf,evaluationTimeMs:latest+86400000});
const output={snapshotTimestamp:snapshot.now,canonicalAvailable:bootstrap.available,sevenDegrees:Object.fromEntries(Object.entries(result.degrees).map(([degree,s])=>[degree,{
 timeframe:s.sourceTimeframe,candles:s.sourceCandleCount,latestCompleted:s.latestCompletedCandle,
 evidenceAvailable:s.nodeEvidenceAvailable,highs:s.detectedNodes.HIGH.length,lows:s.detectedNodes.LOW.length,
 lastHigh:s.detectedNodes.HIGH.at(-1)||null,lastLow:s.detectedNodes.LOW.at(-1)||null,
 candidate:s.waveCandidate,reasonCodes:s.reasonCodes,
 noParentGate:true,shadowOnly:s.shadowOnly,anchorPromotion:s.anchorPromotionAllowed,
 officialFibChanged:s.officialFibAuthorityChanged
}]))}; console.log("REAL_BAR_NODE_PROOF",JSON.stringify(output,null,2));
