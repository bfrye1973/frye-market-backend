// #412: diagnostic coverage projection. Never emits COMPLETE until a trusted
// scheduler/session manifest and durable retention proof are integrated.
// Receipt counts alone cannot prove an entire day's absence of fills.
import {validatePrivatePaperReceipt} from "./engine8PrivatePaperReceipt.js";
export function projectObservedPaperCoverage({date,receipts,now}={}){
 if(typeof date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error("INVALID_ARIZONA_DATE");
 const start=Date.parse(date+"T07:00:00Z");
 if(!Number.isFinite(start)||new Date(start).toISOString().slice(0,10)!==date)throw Error("INVALID_ARIZONA_DATE");
 const intervalStart=new Date(start).toISOString(),intervalEnd=new Date(start+86400000).toISOString();
 const errors=[],duplicates=[],seen=new Set(),valid=[];
 if(!Array.isArray(receipts))errors.push("RECEIPTS_UNAVAILABLE");
 for(const r of Array.isArray(receipts)?receipts:[]){
  const result=validatePrivatePaperReceipt(r,{start:intervalStart,end:intervalEnd,now});
  if(!result.valid){errors.push(...result.issues);continue;}
  if(seen.has(r.cycleId)){duplicates.push("DUPLICATE_CYCLE_ID");continue;}
  seen.add(r.cycleId);valid.push(r);
 }
 return {schemaVersion:"engine8.paperVerificationCoverage.v1",timezone:"America/Phoenix",date,intervalStart,intervalEnd,status:"INCOMPLETE",watermarkThrough:null,expectedCycles:null,observedCycles:valid.length,gaps:["TRUSTED_SCHEDULER_MANIFEST_UNAVAILABLE","DURABLE_RETENTION_COVERAGE_UNPROVEN"],duplicates,errors,stores:{orders:"UNKNOWN",executions:"UNKNOWN",lifecycle:"UNKNOWN",ledger:"UNKNOWN",journal:"UNKNOWN"},originalApprovalEvidence:"UNKNOWN",latestObservedCycleTime:valid.map(r=>r.cycleTime).sort().at(-1)??null};
}
