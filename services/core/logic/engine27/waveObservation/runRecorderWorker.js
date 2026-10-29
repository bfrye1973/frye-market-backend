// Engine27 V6 controlled worker. NOT installed in production startCommand.
// Explicit flag, singleton lease, bounded loop and graceful signal handling.
import fs from "node:fs";
import path from "node:path";
import {runWaveObservationBackfill} from "./runWaveObservationBackfill.js";
import {writeRecorderHeartbeat} from "./writeRecorderHeartbeat.js";
import {checkRecorderStorage} from "./checkRecorderStorage.js";
const root="/var/data/replay/engine27/wave-observations";
export async function runRecorderWorker({enabled=process.env.ENGINE27_V6_RECORDER_ENABLED==="true",
 replayRoot="/var/data/replay/es",rootDir=root,storagePreflight=checkRecorderStorage,clock=()=>new Date(),retentionDays=14,
 onCycle=runWaveObservationBackfill,signal=null,sleepMs=60000,maxCycles=Infinity}={}){
 if(!enabled)return {ok:true,status:"DISABLED",cycles:0};
 if(!Number.isInteger(retentionDays)||retentionDays<2||retentionDays>14)
  return {ok:false,status:"INVALID_REPLAY_RETENTION_WINDOW"};
 if(!Number.isInteger(sleepMs)||sleepMs<1000||sleepMs>300000)
  return {ok:false,status:"INVALID_RECORDER_INTERVAL"};
 if(!fs.existsSync(replayRoot)||!fs.statSync(replayRoot).isDirectory())
  return {ok:false,status:"REPLAY_DISK_MISSING"};
 fs.mkdirSync(rootDir,{recursive:true});
 const lease=path.join(rootDir,".single-worker-lease");
 try{fs.mkdirSync(lease)}catch(e){if(e?.code==="EEXIST")return {ok:false,status:"ANOTHER_WORKER_OR_STALE_LEASE"};throw e}
 let cycles=0,lastResult=null;
 writeRecorderHeartbeat({root:rootDir,status:"STARTING"});
 try{
  while(!signal?.aborted&&cycles<maxCycles){
   const azParts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Phoenix",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(clock());
   const part=name=>azParts.find(x=>x.type===name)?.value;
   const az=part("year")+"-"+part("month")+"-"+part("day");
   // Sweep the entire retained Arizona calendar window, oldest-first, while
   // accepting at most one Replay file per cycle. Yesterday remains eligible
   // after midnight, including late-arriving files and restarts.
   const dates=Array.from({length:retentionDays},(_,i)=>{
    const day=new Date(Date.UTC(Number(part("year")),Number(part("month"))-1,
      Number(part("day"))-(retentionDays-1-i)));
    return day.toISOString().slice(0,10);
   });
   const space=storagePreflight({root:rootDir,diskMount:path.dirname(replayRoot)});
   if(!space.ok){writeRecorderHeartbeat({root:rootDir,status:"FAILED",cycleCount:cycles,lastErrorCode:space.reason});
    return {ok:false,status:"STORAGE_PREFLIGHT_BLOCKED",cycles,reason:space.reason};}
   const report=await onCycle({replayRoot,root:rootDir,dates,maxBatch:1,maxTotalBatch:1,commit:true});
   cycles++;lastResult=report;
   writeRecorderHeartbeat({root:rootDir,status:report?.ok?"RUNNING":"FAILED",cycleCount:cycles,
    lastErrorCode:report?.ok?null:report?.reason??"CYCLE_FAILED"});
   if(!report?.ok&&report?.reason!=="CANDLE_REQUEST_BACKPRESSURE")
    return {ok:false,status:"CYCLE_FAILED",cycles,reason:report?.reason??"UNKNOWN"};
   if(signal?.aborted||cycles>=maxCycles)break;
   await new Promise(resolve=>{
    const timer=setTimeout(resolve,sleepMs);
    if(signal){signal.addEventListener("abort",()=>{clearTimeout(timer);resolve()},{once:true})}
   });
  }
  writeRecorderHeartbeat({root:rootDir,status:"STOPPED",cycleCount:cycles});
  return {ok:true,status:signal?.aborted?"STOPPED":"CYCLE_LIMIT_REACHED",cycles,lastResult};
 }finally{
  // Controlled exits relinquish ownership. A hard crash cannot run finally,
  // so its lease remains for explicit stale-owner review.
  try{fs.rmdirSync(lease)}catch{}
 }
}
