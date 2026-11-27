// #412/#413: pure PAPER fill evidence projection. No IO or execution authority.
// A positive match is evidence, not independent Engine12 certification.
// NO is deliberately unavailable until a trusted coverage producer exists.
const id=v=>typeof v==="string"&&v.trim()!==""?v:null;
const time=v=>typeof v==="string"&&/Z$|[+-]\d\d:\d\d$/.test(v)?Date.parse(v):NaN;
const validFill=v=>Number.isInteger(v?.filledQty)&&v.filledQty>0&&typeof v.avgPrice==="number"&&Number.isFinite(v.avgPrice)&&v.avgPrice>0;
const filled=v=>String(v?.status??"").toUpperCase()==="FILLED";
const keys=["strategyId","action","idempotencyKey"];
export function projectPaperDailyFills({date,orders,executions}={}) {
 const start=typeof date==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(date)?Date.parse(date+"T07:00:00Z"):NaN;
 if(!Number.isFinite(start)||new Date(start).toISOString().slice(0,10)!==date) throw Error("INVALID_ARIZONA_DATE");
 const end=start+86400000, issues=new Set(), rows=[];
 const available=Array.isArray(orders)&&Array.isArray(executions);
 if(!available) issues.add("STORE_UNAVAILABLE");
 const o=Array.isArray(orders)?orders:[], e=Array.isArray(executions)?executions:[];
 const byId=new Map(), seen=new Set();
 for(const x of o){const k=id(x?.orderId);if(!k){issues.add("ORDER_ID_MISSING");continue;}const a=byId.get(k)||[];a.push(x);byId.set(k,a);}
 const execCounts=new Map();for(const x of e){const k=id(x?.orderId);if(k)execCounts.set(k,(execCounts.get(k)||0)+1);}
 for(const x of e){
  const t=time(x?.ts);if(!Number.isFinite(t)){issues.add("EXECUTION_TIME_UNKNOWN");continue;}if(t<start||t>=end)continue;
  const k=id(x?.orderId);if(!k||seen.has(k)||execCounts.get(k)!==1){issues.add("IDENTITY_CONFLICT");continue;}seen.add(k);
  const matches=byId.get(k)||[];
  if(matches.length!==1){issues.add(matches.length?"IDENTITY_CONFLICT":"ORDER_MISSING");continue;}
  const y=matches[0];if(y.paper!==true){issues.add("PAPER_IDENTITY_UNVERIFIED");continue;}
  if(!keys.every(f=>id(x[f])&&x[f]===y[f])||!["NEW_ENTRY","REDUCE","EXIT"].includes(x.action)){issues.add("IDENTITY_CONFLICT");continue;}
  const sig=y.sourceSignal||{}, es=x.sourceSignal??x.ourceSignal??{};
  if(["candidateId","planId","executionId","tradeId"].some(f=>id(sig[f])&&id(es[f])&&sig[f]!==es[f])){issues.add("IDENTITY_CONFLICT");continue;}
  if(!filled(x)||!filled(y)||!validFill(x)||!validFill(y)||x.filledQty!==y.filledQty||x.avgPrice!==y.avgPrice||time(y.filledAt??y.ts)!==t){issues.add("FILL_UNVERIFIED");continue;}
  rows.push({strategyId:y.strategyId,candidateId:id(sig.candidateId),planId:id(sig.planId),executionId:id(sig.executionId),orderId:k,tradeId:null,action:x.action,fillStatus:"FILLED",filledQuantity:x.filledQty,fillPrice:x.avgPrice,fillTime:x.ts,journalStatus:"UNKNOWN"});
 }
 return {schemaVersion:"engine8.dailyFillEvidence.v1",date,timezone:"America/Phoenix",coverage:"UNPROVEN",verdict:rows.length?"YES":"UNKNOWN",verifiedFillCount:rows.length,openingFillCount:rows.filter(x=>x.action==="NEW_ENTRY").length,exitFillCount:rows.filter(x=>x.action!=="NEW_ENTRY").length,issues:[...issues,"INTERVAL_COVERAGE_UNPROVEN"],fills:rows};
}
