// Engine27 V6 read-only enrichment. Completed 10m is primary Micro/Submicro
// evidence; 5m/1m are optional research, never polled in unattended intake.
import {fetchBoundedWaveCandles} from "./fetchBoundedWaveCandles.js";
import {createWaveEvidenceRecorder} from "./createWaveEvidenceRecorder.js";
import {createCandleRequestGate} from "./createCandleRequestGate.js";
const valid=s=>typeof s==="string"&&Number.isFinite(Date.parse(s));
export function createWaveEvidenceEnricher({root,request=fetch,gate=createCandleRequestGate(),now=()=>Date.now()}={}){
 const recorder=createWaveEvidenceRecorder({root});
 const cache=new Map();
 return async ({snapshot,sourceReplay}={})=>{
  if(!valid(snapshot?.snapshotTime)||!sourceReplay?.sha256)
   return {ok:false,reason:"REPLAY_EVIDENCE_SOURCE_UNVERIFIED"};
  const end=Date.parse(snapshot.snapshotTime);
  const completedBucket=Math.floor(end/600000)*600000;
  const key="ES:10m:"+completedBucket;
  // Deterministic historical expiry, not a temporary provider outage.
  if(now()-end>14*86400000)return {ok:true,disposition:"HISTORICAL_OHLC_UNAVAILABLE",
   reason:"HISTORICAL_10M_OHLC_UNAVAILABLE",sourceReplaySha256:sourceReplay.sha256};
  let packet=cache.get(key);
  if(!packet){
   const fromUtc=new Date(completedBucket-60*60000).toISOString();
   const toUtc=new Date(completedBucket).toISOString();
   const attempt=await gate.execute(()=>fetchBoundedWaveCandles({
    timeframe:"10m",fromUtc,toUtc,request}));
   if(!attempt?.available)return {ok:false,reason:attempt?.reason==="CANDLE_REQUEST_BACKPRESSURE"
    ?"CANDLE_REQUEST_BACKPRESSURE":"PRIMARY_COMPLETED_10M_SOURCE_UNAVAILABLE",
    sourceReason:attempt?.reason??null};
   packet=attempt;
   cache.clear();cache.set(key,packet);
  }
  const zoneCandidate=snapshot?.strategies?.["intraday_scalp@10m"]?.engine26LocationCandidate??null;
  return recorder.record({snapshot,sourceReplay,ohlc:{"10m":packet},zoneCandidate,
    waveExtremePrices:{},asOf:snapshot.snapshotTime});
 };
}
