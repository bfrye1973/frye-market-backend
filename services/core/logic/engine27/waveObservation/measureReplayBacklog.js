// Read-only Replay backlog gauge, bounded to Engine12's retained 14 dates.
// Does not read Replay contents or expose broker prices or absolute paths.
import fs from "node:fs";
import path from "node:path";
export function measureReplayBacklog({replayRoot="/var/data/replay/es",
 root="/var/data/replay/engine27/wave-observations",now=new Date(),retentionDays=14}={}){
 if(!Number.isInteger(retentionDays)||retentionDays<1||retentionDays>14)
  return {available:false,reason:"INVALID_RETENTION"};
 try{
  const p=new Intl.DateTimeFormat("en-US",{timeZone:"America/Phoenix",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const part=k=>p.find(x=>x.type===k)?.value;
  const base=Date.UTC(Number(part("year")),Number(part("month"))-1,Number(part("day")));
  let remaining=0,processed=0,oldest=null,newest=null;
  for(let i=retentionDays-1;i>=0;i--){
   const date=new Date(base-i*86400000).toISOString().slice(0,10);
   const folder=path.join(replayRoot,date);
   if(!fs.existsSync(folder))continue;
   const received=path.join(root,"replay-intake-receipts",date);
   const done=new Set(fs.existsSync(received)?fs.readdirSync(received).filter(x=>/^\d{4}\.json$/.test(x)):[]);
   for(const file of fs.readdirSync(folder).filter(x=>/^\d{4}\.json$/.test(x)).sort()){
    const stamp=date+"T"+file.slice(0,2)+":"+file.slice(2,4)+":00";
    if(done.has(file)){
     processed++;
     if(newest===null||stamp>newest)newest=stamp;
    }else{
     remaining++;
     if(oldest===null||stamp<oldest)oldest=stamp;
    }
   }
  }
  const oldestUtc=oldest?Date.parse(oldest+"-07:00"):null;
  const newestUtc=newest?Date.parse(newest+"-07:00"):null;
  return {available:true,remainingBacklogCount:remaining,processedRetainedCount:processed,
   oldestUnprocessedReplayArizona:oldest,newestAcknowledgedReplayArizona:newest,
   recordingLagMinutes:newestUtc!==null?Math.max(0,Math.round((now.getTime()-newestUtc)/60000)):null,
   oldestAgeHours:oldestUtc!==null?Math.max(0,Math.round((now.getTime()-oldestUtc)/3600000)):null};
 }catch(e){return {available:false,reason:"BACKLOG_INVENTORY_UNAVAILABLE"}}
}
