// Nominal schedule diagnostics only. A current Render cron configuration is
// not historical configuration evidence; this never certifies COMPLETE.
import {validatePrivatePaperReceipt} from "./engine8PrivatePaperReceipt.js";
const STEP=180000;
export function projectNominalPaperSchedule({date,now,receipts,graceMs=120000}={}){
 if(typeof date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error("INVALID_DATE");
 const start=Date.parse(date+"T07:00:00Z"),at=Date.parse(now);
 if(!Number.isFinite(start)||new Date(start).toISOString().slice(0,10)!==date||!Number.isFinite(at)||!Number.isSafeInteger(graceMs)||graceMs<0)throw Error("INVALID_SCHEDULE_CONTEXT");
 const end=start+86400000,slots=new Map(),issues=new Set();
 for(let t=start;t<end&&t+STEP+graceMs<=at;t+=STEP)slots.set(t,new Set());
 if(!Array.isArray(receipts))issues.add("RECEIPTS_UNAVAILABLE");
 for(const r of Array.isArray(receipts)?receipts:[]){
  if(r?.cycleKind!=="SCHEDULER_START")continue;
  if(!validatePrivatePaperReceipt(r,{start:new Date(start).toISOString(),end:new Date(end).toISOString(),now}).valid||!r.schedulerRunId){issues.add("INVALID_SCHEDULER_START");continue;}
  const t=start+Math.floor((Date.parse(r.cycleTime)-start)/STEP)*STEP;
  if(slots.has(t))slots.get(t).add(r.schedulerRunId);
 }
 const missing=[],multiple=[];
 for(const [t,ids] of slots){if(!ids.size)missing.push(new Date(t).toISOString());if(ids.size>1)multiple.push(new Date(t).toISOString());}
 return {schemaVersion:"engine8.nominalScheduleDiagnostics.v1",date,assumedSchedule:"*/3 * * * *",nominalDaySlots:480,elapsedSlots:slots.size,observedSlots:slots.size-missing.length,missingSlots:missing,multipleRunSlots:multiple,issues:[...issues],status:"UNVERIFIED_SCHEDULE",coverage:"UNPROVEN"};
}
