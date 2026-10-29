// Inject into createWaveReplayConsumer(onWaveEvidence) for isolated point-in-time
// futures-candle enrichment. No scheduler, no changes to live Engine22 or orders.
import {fetchBoundedWaveCandles} from "./fetchBoundedWaveCandles.js";
import {createWaveEvidenceRecorder} from "./createWaveEvidenceRecorder.js";
const valid=s=>typeof s==="string"&&Number.isFinite(Date.parse(s));
export function createWaveEvidenceEnricher({root,request=fetch}={}){
 const recorder=createWaveEvidenceRecorder({root});
 return async ({snapshot,sourceReplay}={})=>{
  if(!valid(snapshot?.snapshotTime)||!sourceReplay?.sha256)
   return {ok:false,reason:"REPLAY_EVIDENCE_SOURCE_UNVERIFIED"};
  const end=Date.parse(snapshot.snapshotTime),start=end-60*60*1000;
  const ohlc={};
  for(const timeframe of ["10m","5m","1m"]){
   const p=await fetchBoundedWaveCandles({timeframe,fromUtc:new Date(start).toISOString(),
    toUtc:new Date(end).toISOString(),request});
   if(p.available)ohlc[timeframe]=p;
   else if(timeframe==="10m")return {ok:false,reason:"PRIMARY_COMPLETED_10M_SOURCE_UNAVAILABLE",sourceReason:p.reason};
  }
  const strategy=snapshot?.strategies?.["intraday_scalp@10m"];
  const zoneCandidate=strategy?.engine26LocationCandidate??null;
  return recorder.record({snapshot,sourceReplay,ohlc,zoneCandidate,
    // Extreme is unknown unless a verified source supplies it; do not infer.
    waveExtremePrices:{},asOf:snapshot.snapshotTime});
 };
}
