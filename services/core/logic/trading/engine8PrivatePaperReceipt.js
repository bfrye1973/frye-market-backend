// #412: private observational cycle receipt contract. No trading or IO.
import {createHash} from "node:crypto";
const str=v=>typeof v==="string"&&v.length>0&&v.length<=256?v:null;
const bool=v=>typeof v==="boolean"?v:null;
const num=v=>typeof v==="number"&&Number.isFinite(v)?v:null;
const iso=v=>typeof v==="string"&&/Z$|[+-]\d\d:\d\d$/.test(v)&&Number.isFinite(Date.parse(v))?new Date(Date.parse(v)).toISOString():null;
const codes=v=>Array.isArray(v)?v.filter(x=>typeof x==="string"&&/^[A-Z][A-Z0-9_]{0,99}$/.test(x)).slice(0,30):null;
export function buildPrivatePaperReceipt(input={},createdAt){
 const r={schemaVersion:"engine8.paperVerificationReceipt.v1",cycleTime:iso(input.cycleTime),strategyId:str(input.strategyId),candidateId:str(input.candidateId),planId:str(input.planId),engine6Permission:bool(input.engine6Permission),engine8Eligible:bool(input.engine8Eligible),engine8Executable:bool(input.engine8Executable),executorInvoked:bool(input.executorInvoked),skipReason:str(input.skipReason),rejectReason:str(input.rejectReason),blockers:codes(input.blockers),orderCreated:bool(input.orderCreated),orderId:str(input.orderId),executionId:str(input.executionId),tradeId:str(input.tradeId),fillStatus:str(input.fillStatus),filledQuantity:num(input.filledQuantity),fillPrice:num(input.fillPrice),fillTime:iso(input.fillTime),journalAckStatus:str(input.journalAckStatus),receiptCreatedAt:iso(createdAt),evidenceKind:"REPORTED_CYCLE_OUTCOME_NOT_INDEPENDENT_VERIFICATION"};
 return {...r,receiptHash:createHash("sha256").update(JSON.stringify(r)).digest("hex")};
}
// Public/log projection deliberately excludes raw identity, prices and arbitrary text.
export function publicPaperReceipt(r){
 const safe=v=>typeof v==="string"&&/^[A-Z][A-Z0-9_]{0,99}$/.test(v)?v:null;
 return {schemaVersion:r.schemaVersion,cycleTime:r.cycleTime,engine6Permission:r.engine6Permission,engine8Executable:r.engine8Executable,executorInvoked:r.executorInvoked,skipReason:safe(r.skipReason),rejectReason:safe(r.rejectReason),blockers:codes(r.blockers),orderCreated:r.orderCreated,fillStatus:safe(r.fillStatus),journalAckStatus:safe(r.journalAckStatus),receiptCreatedAt:r.receiptCreatedAt,evidenceKind:r.evidenceKind};
}
