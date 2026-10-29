// Engine27 V6 owner-gated one-pass local Replay backfill entrypoint.
// Default is READ ONLY. No cron, API route, or production execution registered.
import fs from "node:fs";
import path from "node:path";
import {createOriginalReplayFileReader} from "./createOriginalReplayFileReader.js";
import {createWaveReplayConsumer} from "./createWaveReplayConsumer.js";
import {createWaveEvidenceEnricher} from "./createWaveEvidenceEnricher.js";
import {createCandleRequestGate} from "./createCandleRequestGate.js";
import {createReplayIntakeLedger} from "./createReplayIntakeLedger.js";
const validDate=d=>typeof d==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(d);
export async function runWaveObservationBackfill({
 replayRoot="/var/data/replay/es",root="/var/data/replay/engine27/wave-observations",
 dates=[],maxBatch=30,commit=false,request=fetch,gate=null,enricher=null,maxTotalBatch=1,currentFirst=false
}={}){
 if(!Array.isArray(dates)||dates.length<1||dates.length>14||dates.some(d=>!validDate(d))||
    !Number.isInteger(maxBatch)||maxBatch<1||maxBatch>120||
    !Number.isInteger(maxTotalBatch)||maxTotalBatch<1||maxTotalBatch>120)
  return {ok:false,reason:"INVALID_BACKFILL_SCOPE"};
 const reader=createOriginalReplayFileReader({replayRoot});
 const sharedGate=commit?(gate??createCandleRequestGate({root})):null;
 const enriched=commit?(enricher??createWaveEvidenceEnricher({root,request,gate:sharedGate})):null;
 const ledger=commit?createReplayIntakeLedger({root}):null;
 let totalProcessed=0;
 let totalLegacySkipped=0;
 const consumer=commit?createWaveReplayConsumer({root,readOriginalReplay:reader,onWaveEvidence:enriched}):null;
 const reports=[];
 if(commit&&currentFirst){
  const latestDate=[...new Set(dates)].sort().at(-1);
  const folder=path.join(replayRoot,latestDate);
  if(fs.existsSync(folder)){
   const times=fs.readdirSync(folder).filter(t=>/^\d{4}\.json$/.test(t)).map(t=>t.slice(0,4)).sort().reverse();
   const done=new Set(ledger.processedFor(latestDate));
   const latest=times.find(t=>!done.has(latestDate+"/"+t));
   if(latest){
    const result=await consumer.consumeDate({date:latestDate,times:[latest],maxBatch:1});
    totalProcessed+=result.processed??0;
    totalLegacySkipped+=result.legacySkipped??0;
    reports.push({date:latestDate,lane:"CURRENT",...result});
    if(!result.ok)return {ok:false,reason:result.reason,reports,processed:totalProcessed};
   }
  }
 }
 for(const date of [...new Set(dates)].sort()){
  if(commit&&totalProcessed>=maxTotalBatch)break;
  const folder=path.join(replayRoot,date);
  if(!fs.existsSync(folder)){
   if(commit)continue;
   return {ok:false,reason:"REPLAY_DATE_NOT_FOUND",date,reports};
  }
  if(!fs.statSync(folder).isDirectory())return {ok:false,reason:"INVALID_REPLAY_DIRECTORY",date,reports};
  const times=fs.readdirSync(folder).filter(t=>/^([01]\d|2[0-3])[0-5]\d\.json$/.test(t))
   .map(name=>name.slice(0,4)).sort();
  if(commit&&!times.some(time=>!ledger.processedFor(date).includes(date+"/"+time)))continue;
  if(!commit){
   // Unlike a listing-only dry run, verify original bytes and canonical contract
   // for a bounded sample. Never create journal or receipt directories.
   const checked=[];
   for(const time of times.slice(0,maxBatch)){
    const item={date,time,key:date+"/"+time,sourceReplayPath:
      "/var/data/replay/es/"+date+"/"+time+".json"};
    try{
     const {bytes}=await reader(item);
     const snapshot=JSON.parse(bytes.toString("utf8"));
     checked.push({time,valid:snapshot?.schema==="engine12.multiStrategyReplay.v1"&&
       snapshot?.replayContract==="CANONICAL_MULTI_STRATEGY_REPLAY"&&
       typeof snapshot?.snapshotTime==="string"&&Number.isFinite(Date.parse(snapshot.snapshotTime))});
    }catch(error){checked.push({time,valid:false,reason:error?.code??error?.name??"SOURCE_READ_ERROR"});}
   }
   const invalid=checked.filter(x=>!x.valid);
   reports.push({date,mode:"DRY_RUN",filesAvailable:times.length,
    filesChecked:checked.length,invalidCount:invalid.length,invalid:invalid.slice(0,10),
    remainingUnchecked:times.length-checked.length,willWrite:false});
   if(invalid.length)return {ok:false,reason:"DRY_RUN_ORIGINAL_REPLAY_VALIDATION_FAILED",date,reports};
   continue;
  }
  const capacity=Math.min(maxBatch,maxTotalBatch-totalProcessed);
  if(capacity<=0)break;
  const result=await consumer.consumeDate({date,times,maxBatch:capacity});
  totalProcessed+=result.processed??0;
  totalLegacySkipped+=result.legacySkipped??0;
  reports.push({date,mode:"COMMIT",...result});
  if(!result.ok)return {ok:false,reason:result.reason,date,reports};
  if(totalProcessed>=maxTotalBatch)break;
 }
 return {ok:true,productionDeployed:false,dryRun:commit!==true,reports,
  processed:totalProcessed,legacySkipped:totalLegacySkipped};
}
