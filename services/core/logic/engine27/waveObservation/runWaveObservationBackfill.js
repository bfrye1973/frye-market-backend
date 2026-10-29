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
  // Recent original Replay is processed in ascending source order, not just
  // the newest file. Keep one worker, journal, ledger and durable OHLC gate.
  const recentDates=[...new Set(dates)].sort().slice(-1);
  let remainingCurrent=Math.min(maxBatch,maxTotalBatch);
  for(const date of recentDates){
   if(remainingCurrent<=0)break;
   const folder=path.join(replayRoot,date);
   if(!fs.existsSync(folder))continue;
   const times=fs.readdirSync(folder).filter(t=>/^([01]\\d|2[0-3])[0-5]\\d\\.json$/.test(t))
    .map(t=>t.slice(0,4)).sort();
   const done=new Set(ledger.processedFor(date));
   // Only the latest 60 source-clock minutes receive priority; process the\n   // oldest pending in that window first to prevent starvation from new arrivals.
   // Older unacknowledged records remain eligible for historical recovery.
   const newest=times.at(-1);
   const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(2));
   const floor=newest?minutes(newest)-60:0;
   const recent=times.filter(t=>minutes(t)>=floor&&!done.has(date+"/"+t));
   if(!recent.length)continue;
   const result=await consumer.consumeDate({date,times:recent,maxBatch:remainingCurrent});
   totalProcessed+=result.processed??0;
   totalLegacySkipped+=result.legacySkipped??0;
   remainingCurrent-=result.processed??0;
   reports.push({date,lane:"CURRENT",...result});
   if(!result.ok)return {ok:false,reason:result.reason,reports,processed:totalProcessed};
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
