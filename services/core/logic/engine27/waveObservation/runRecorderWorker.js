// Engine27 V6 controlled worker. NOT installed in production startCommand.
// Explicit flag, singleton lease, bounded loop and graceful signal handling.
import fs from "node:fs";
import path from "node:path";
import {runWaveObservationBackfill} from "./runWaveObservationBackfill.js";
const root="/var/data/replay/engine27/wave-observations";
export async function runRecorderWorker({enabled=process.env.ENGINE27_V6_RECORDER_ENABLED==="true",
 replayRoot="/var/data/replay/es",rootDir=root,
 onCycle=runWaveObservationBackfill,signal=null,sleepMs=60000,maxCycles=Infinity}={}){
 if(!enabled)return {ok:true,status:"DISABLED",cycles:0};
 if(!Number.isInteger(sleepMs)||sleepMs<1000||sleepMs>300000)
  return {ok:false,status:"INVALID_RECORDER_INTERVAL"};
 if(!fs.existsSync(replayRoot)||!fs.statSync(replayRoot).isDirectory())
  return {ok:false,status:"REPLAY_DISK_MISSING"};
 fs.mkdirSync(rootDir,{recursive:true});
 const lease=path.join(rootDir,".single-worker-lease");
 try{fs.mkdirSync(lease)}catch(e){if(e?.code==="EEXIST")return {ok:false,status:"ANOTHER_WORKER_OR_STALE_LEASE"};throw e}
 let cycles=0,stopped=false,lastResult=null;
 try{
  while(!signal?.aborted&&cycles<maxCycles){
   const az=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Phoenix",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
   const report=await onCycle({replayRoot,root:rootDir,dates:[az],maxBatch:1,commit:true});
   cycles++;lastResult=report;
   if(!report?.ok)return {ok:false,status:"CYCLE_FAILED",cycles,reason:report?.reason??"UNKNOWN"};
   if(signal?.aborted||cycles>=maxCycles)break;
   await new Promise(resolve=>{
    const timer=setTimeout(resolve,sleepMs);
    if(signal){signal.addEventListener("abort",()=>{clearTimeout(timer);resolve()},{once:true})}
   });
  }
  stopped=true;
  return {ok:true,status:signal?.aborted?"STOPPED":"CYCLE_LIMIT_REACHED",cycles,lastResult};
 }finally{
  // Lease release only by owner process; any crash leaves stale lease for review.
  if(stopped||signal?.aborted){try{fs.rmdirSync(lease)}catch{}}
 }
}
