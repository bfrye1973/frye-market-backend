// #412: private observational cycle receipt contract. No trading or IO.
import {createHash} from "node:crypto";
const allowedReasons=new Set(["PAPER_ACCEPTANCE_STATE_UNAVAILABLE","DUPLICATE_ORDER_BLOCKED","ENGINE6_PAPER_NOT_ALLOWED","ENGINE8_AUTO_PAPER_EXECUTION_DISABLED","ENGINE8_ADAPTER_NOT_READY_ENVIRONMENT_ARMED","ENGINE8_CANONICAL_ADAPTER_NOT_FOUND","ENGINE8_PAPER_ONLY_NOT_SET","ENGINE8_CANONICAL_EXECUTOR_ENABLED_NOT_SET","ENGINE8_KILL_SWITCH_ACTIVE","LIVE_EXECUTION_FLAGS_PRESENT","REPLAY_EXECUTION_FORBIDDEN","ENGINE8_ADMIN_SECRET_NOT_CONFIGURED","ES_STRATEGY_SNAPSHOT_NOT_FOUND","ES_STRATEGY_SNAPSHOT_UNREADABLE","CANONICAL_PAPER_EXECUTION_REQUEST_FAILED","CANONICAL_PAPER_EXECUTION_REJECTED","ENGINE10_JOURNAL_PENDING","RESULT_UNAVAILABLE","UNKNOWN_REASON"]);
const publicReason=v=>v==null?null:allowedReasons.has(v)?v:"UNKNOWN_REASON";
const hash=v=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v)?v:null;
const enumOf=(v,a)=>a.includes(v)?v:null;
const fillStates=["FILLED","PARTIALLY_FILLED","NOT_FILLED","PENDING","REJECTED","UNKNOWN"];
const ackStates=["JOURNAL_COMPLETE","JOURNAL_PENDING","PENDING_JOURNAL_ACK","UNKNOWN"];
const str=v=>typeof v==="string"&&v.length>0&&v.length<=256?v:null;
const bool=v=>typeof v==="boolean"?v:null;
const num=v=>typeof v==="number"&&Number.isFinite(v)?v:null;
const iso=v=>typeof v==="string"&&/Z$|[+-]\d\d:\d\d$/.test(v)&&Number.isFinite(Date.parse(v))?new Date(Date.parse(v)).toISOString():null;
const codes=v=>Array.isArray(v)?v.filter(x=>typeof x==="string"&&/^[A-Z][A-Z0-9_]{0,99}$/.test(x)).slice(0,30):null;
export function buildPrivatePaperReceipt(input={},createdAt){
 const r={schemaVersion:"engine8.paperVerificationReceipt.v1",mode:enumOf(input.mode,["PAPER"]),cycleId:str(input.cycleId),approvalSnapshotTime:iso(input.approvalSnapshotTime),approvalSnapshotHash:hash(input.approvalSnapshotHash),cycleTime:iso(input.cycleTime),strategyId:str(input.strategyId),candidateId:str(input.candidateId),planId:str(input.planId),engine6Permission:bool(input.engine6Permission),engine8Eligible:bool(input.engine8Eligible),engine8Executable:bool(input.engine8Executable),executorInvoked:bool(input.executorInvoked),skipReason:str(input.skipReason),rejectReason:str(input.rejectReason),blockers:codes(input.blockers),orderCreated:bool(input.orderCreated),orderId:str(input.orderId),executionId:str(input.executionId),tradeId:str(input.tradeId),fillStatus:enumOf(input.fillStatus,fillStates),filledQuantity:num(input.filledQuantity),fillPrice:num(input.fillPrice),fillTime:iso(input.fillTime),journalAckStatus:enumOf(input.journalAckStatus,ackStates),receiptCreatedAt:iso(createdAt),evidenceKind:"REPORTED_CYCLE_OUTCOME_NOT_INDEPENDENT_VERIFICATION"};
 return {...r,receiptHash:createHash("sha256").update(JSON.stringify(r)).digest("hex")};
}
// Public/log projection deliberately excludes raw identity, prices and arbitrary text.
export function publicPaperReceipt(r){

 return {schemaVersion:r.schemaVersion,cycleTime:r.cycleTime,engine6Permission:r.engine6Permission,engine8Executable:r.engine8Executable,executorInvoked:r.executorInvoked,skipReason:publicReason(r.skipReason),rejectReason:publicReason(r.rejectReason),blockers:Array.isArray(r.blockers)?r.blockers.slice(0,30).map(publicReason):null,orderCreated:r.orderCreated,fillStatus:enumOf(r.fillStatus,fillStates),journalAckStatus:enumOf(r.journalAckStatus,ackStates),receiptCreatedAt:r.receiptCreatedAt,evidenceKind:r.evidenceKind};
}

 // Validity means receipt shape/integrity only, never authenticated origin or fill proof.
export function validatePrivatePaperReceipt(r,{strategyId,start,end,now}={}){
 const issues=[];
 if(!r||typeof r!=="object"||Array.isArray(r))return {valid:false,issues:["RECEIPT_MISSING"]};
 const rebuilt=buildPrivatePaperReceipt(r,r.receiptCreatedAt);
 if(JSON.stringify(rebuilt)!==JSON.stringify(r))issues.push("RECEIPT_HASH_OR_SCHEMA_MISMATCH");
 if(r.mode!=="PAPER"||!str(r.cycleId)||!str(r.strategyId))issues.push("RECEIPT_IDENTITY_INCOMPLETE");
 if(strategyId&&strategyId!==r.strategyId)issues.push("STRATEGY_CONFLICT");
 const t=Date.parse(r.cycleTime),created=Date.parse(r.receiptCreatedAt),approval=Date.parse(r.approvalSnapshotTime),at=Date.parse(now);
 if(!Number.isFinite(t)||!Number.isFinite(created)||created<t||!Number.isFinite(at)||created>at)issues.push("RECEIPT_TIME_INVALID");
 if(start&&t<Date.parse(start)||end&&t>=Date.parse(end))issues.push("RECEIPT_OUTSIDE_INTERVAL");
 if(r.engine6Permission===true&&(!str(r.candidateId)||!str(r.planId)||!hash(r.approvalSnapshotHash)||!Number.isFinite(approval)||approval>t))issues.push("APPROVAL_LINK_INCOMPLETE");
 if(r.orderCreated===true&&(!str(r.orderId)||r.executorInvoked!==true))issues.push("ORDER_OUTCOME_INCONSISTENT");
 if(["FILLED","PARTIALLY_FILLED"].includes(r.fillStatus)&&(!str(r.orderId)||!str(r.executionId)||r.orderCreated!==true||!Number.isInteger(r.filledQuantity)||r.filledQuantity<=0||!(r.fillPrice>0)||!Number.isFinite(Date.parse(r.fillTime))||Date.parse(r.fillTime)<t||Date.parse(r.fillTime)>created))issues.push("FILL_OUTCOME_INCONSISTENT");
 return {valid:issues.length===0,issues};
}
