// Engine27 V3 — non-mutating sanitized runtime source inspection.
// No external requests, filesystem writes, or broker operations.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const core=path.resolve(here,"../../../..");
const readJson=(file)=>{try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return null;}};
const snapshot=readJson(path.join(core,"data/strategy-snapshot-es.json"));
const e22=snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy;
const cw=e22?.currentWavelength;
const owner=cw?.degrees?.micro?.ownerMicroCDown;
const posture=snapshot?.marketMeter?.layers?.emaPosture??snapshot?.emaPosture??{};
const ten=posture?.tenMinute?.bars;
const bars=Array.isArray(ten)?ten:[];
const fields=(o)=>o&&typeof o==="object"?Object.keys(o).sort():[];
const safeBar=(b)=>b?({
 fields:fields(b),timeType:typeof b.time,time:b.time??null,timestamp:b.timestamp??null,
 closeFlags:{completed:b.completed??null,isComplete:b.isComplete??null},
 ohlcValid:["open","high","low","close"].every(k=>typeof b[k]==="number"&&Number.isFinite(b[k])),
}):null;
const now=snapshot?.now??snapshot?.ts??snapshot?.snapshotTime??null;
const converted=bars.length&&Number.isSafeInteger(bars.at(-1)?.time)?new Date(bars.at(-1).time*1000).toISOString():null;
const report={
 schema:"engine27.v3.productionSourceInspection.v1",
 inspection:"READ_ONLY_SANITIZED",
 snapshot:{available:!!snapshot,symbol:snapshot?.symbol??null,timestamp:now,topLevelFields:fields(snapshot)},
 engine22:{present:!!e22,workingTimestamp:cw?.timestamp??null,currentPriceType:typeof cw?.currentPrice,
 micro:{exists:!!owner,version:owner?.version??null,degree:owner?.parentDegree??null,activeWave:owner?.activeWave??null,direction:owner?.direction??null,
 waveA:owner?.waveA?{high:owner.waveA.high??null,low:owner.waveA.low??null}:null,
 waveB:owner?.waveB?{high:owner.waveB.high??null}:null,
 levelCount:Array.isArray(owner?.levels)?owner.levels.length:null,
 levels:Array.isArray(owner?.levels)?owner.levels.map(l=>({key:l.key??null,price:l.price??null,status:l.status??null,provisional:l.provisional??null,touchEvidenceAvailable:l.touchEvidenceAvailable??null,touchEvidenceType:l.touchEvidenceType??null})):[],
 confirmedStatus:owner?.confirmationStatus??null},
 neighbors:{
 submicro:{version:cw?.degrees?.submicro?.ownerSubmicroCDown?.version??null},
 subminute:{version:cw?.degrees?.subminute?.ownerCurrentCDown?.version??null}
 }},
 esTenMinuteBars:{path:"marketMeter.layers.emaPosture.tenMinute.bars OR emaPosture.tenMinute.bars",count:bars.length,first:safeBar(bars[0]),last:safeBar(bars.at(-1)),
 lastTimeInterpretedAsUnixStart:converted,
 verifiedUnit:false, // Source consumer expectation is not direct producer proof.
 confidence:"REQUIRES_SOURCE_PROVENANCE_AND_SESSION_VALIDATION"},
 market:{engine25ContextPresent:!!snapshot?.engine25Context,engine29Embedded:!!snapshot?.engine29CrossMarketStress,
 engine27Fields:fields(snapshot?.engine27Strategies),crossMarketFields:fields(snapshot?.engine27Strategies?.engine27CrossMarketLevels)},
 journal:{status:"NOT_INSPECTED_BY_SNAPSHOT_SCRIPT",reason:"ENGINE10_PRIVATE_DURABLE_STORE_SEPARATE_FROM_ES_SNAPSHOT"},
 scope:{noWrites:true,noTrading:true,noAccountIdentifiers:true,noCredentials:true}
};
process.stdout.write(JSON.stringify(report,null,2)+"\n");
