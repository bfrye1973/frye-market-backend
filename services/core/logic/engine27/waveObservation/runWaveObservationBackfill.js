// Engine27 V6 owner-gated one-pass local Replay backfill entrypoint.
// Default is READ ONLY. No cron, API route, or production execution registered.
import fs from "node:fs";
import path from "node:path";
import {createOriginalReplayFileReader} from "./createOriginalReplayFileReader.js";
import {createWaveReplayConsumer} from "./createWaveReplayConsumer.js";
import {createWaveEvidenceEnricher} from "./createWaveEvidenceEnricher.js";
const validDate=d=>typeof d==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(d);
export async function runWaveObservationBackfill({
 replayRoot="/var/data/replay/es",root="/var/data/replay/engine27/wave-observations",
 dates=[],maxBatch=30,commit=false,request=fetch
}={}){
 if(!Array.isArray(dates)||dates.length<1||dates.length>14||dates.some(d=>!validDate(d))||
    !Number.isInteger(maxBatch)||maxBatch<1||maxBatch>120)
  return {ok:false,reason:"INVALID_BACKFILL_SCOPE"};
 const reader=createOriginalReplayFileReader({replayRoot});
 const enriched=commit?createWaveEvidenceEnricher({root,request}):null;
 const consumer=commit?createWaveReplayConsumer({root,readOriginalReplay:reader,onWaveEvidence:enriched}):null;
 const reports=[];
 for(const date of [...new Set(dates)].sort()){
  const folder=path.join(replayRoot,date);
  if(!fs.existsSync(folder)||!fs.statSync(folder).isDirectory())
   return {ok:false,reason:"REPLAY_DATE_NOT_FOUND",date,reports};
  const times=fs.readdirSync(folder).filter(t=>/^([01]\d|2[0-3])[0-5]\d\.json$/.test(t))
   .map(name=>name.slice(0,4)).sort();
  if(!commit){
   reports.push({date,mode:"DRY_RUN",filesAvailable:times.length,
    canReadOriginalFileBytes:true,willWrite:false});continue;
  }
  const result=await consumer.consumeDate({date,times,maxBatch});
  reports.push({date,mode:"COMMIT",...result});
  if(!result.ok)return {ok:false,reason:result.reason,date,reports};
 }
 return {ok:true,productionDeployed:false,dryRun:commit!==true,reports};
}
