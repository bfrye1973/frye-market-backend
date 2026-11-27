// #412: diagnostic coverage projection. Never emits COMPLETE until a trusted
// scheduler/session manifest and durable retention proof are integrated.
// Receipt counts alone cannot prove an entire day's absence of fills.
import {createHash} from "node:crypto";
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
 const runs=new Map();
 for(const r of valid){
  if(!r.schedulerRunId)continue;
  const run=runs.get(r.schedulerRunId)??[];
  run.push(r);runs.set(r.schedulerRunId,run);
 }
 const runGaps=[];
 let completedObservedRuns=0;
 for(const [runId,rows] of runs){
  const starts=rows.filter(x=>x.cycleKind==="SCHEDULER_START"),ends=rows.filter(x=>x.cycleKind==="SCHEDULER_END"),entries=rows.filter(x=>x.cycleKind==="ENTRY"),lifecycle=rows.filter(x=>x.cycleKind==="LIFECYCLE"&&x.reportedAction===null);
  const missing=[];
  for(const [name,group] of [["SCHEDULER_START",starts],["SCHEDULER_END",ends],["ENTRY_RECEIPT",entries],["LIFECYCLE_SUMMARY",lifecycle]]){
   if(group.length===0)missing.push("MISSING_"+name);
   else if(group.length>1)missing.push("DUPLICATE_"+name);
  }
  if(starts.length===1&&ends.length===1&&Date.parse(ends[0].receiptCreatedAt)<Date.parse(starts[0].receiptCreatedAt))missing.push("SCHEDULER_TIME_CONFLICT");
  if(entries.some(x=>x.reportedOutcome==="UNKNOWN")||lifecycle.some(x=>x.reportedOutcome==="UNKNOWN"))missing.push("OUTCOME_UNKNOWN");
  if(!missing.length)completedObservedRuns++;
  else runGaps.push({schedulerRunId:runId,reasons:missing});
 }
 const last=valid.map(r=>r.receiptCreatedAt).sort().at(-1)??null;
 const receiptSetHash=createHash("sha256").update(JSON.stringify(valid.map(r=>r.receiptHash).sort())).digest("hex");
 return {schemaVersion:"engine8.paperVerificationCoverage.v1",timezone:"America/Phoenix",date,intervalStart,intervalEnd,status:"INCOMPLETE",watermarkThrough:null,expectedCycles:null,observedCycles:valid.length,gaps:["TRUSTED_SCHEDULER_MANIFEST_UNAVAILABLE","DURABLE_RETENTION_COVERAGE_UNPROVEN"],duplicates,errors,receiptSetHash,schedulerRunsObserved:runs.size,completedObservedRuns,runGaps,latestReceiptCreatedAt:last,stores:{orders:"UNKNOWN",executions:"UNKNOWN",lifecycle:"UNKNOWN",ledger:"UNKNOWN",journal:"UNKNOWN"},originalApprovalEvidence:"UNKNOWN",latestObservedCycleTime:valid.map(r=>r.cycleTime).sort().at(-1)??null};
}
