// Observes completed lifecycle job output only. Never calls execution or Journal.
import {buildPrivatePaperReceipt} from "./engine8PrivatePaperReceipt.js";
import {persistPrivateReceipt} from "./engine8PaperReceiptObserver.js";
const bool=v=>typeof v==="boolean"?v:null;
export function lifecycleReceipts({step,runId,cycleTime,createdAt}){
 let p;
 try{if(Buffer.byteLength(step?.stdout??"")>262144)throw Error();p=JSON.parse(step.stdout);}catch{p=null;}
 const base={mode:"PAPER",cycleKind:"LIFECYCLE",schedulerRunId:runId,cycleTime,strategyId:"intraday_scalp@10m"};
 const rows=[];
 const add=(fields)=>rows.push(buildPrivatePaperReceipt({...base,...fields,cycleId:runId+":lifecycle:"+rows.length},createdAt));
 add({reportedOutcome:p?.skipped===true?"SKIPPED":p?.ok===true?"COMPLETED":p?.ok===false?"REJECTED":"UNKNOWN",skipReason:p?.skipped===true?p.reason:null,rejectReason:p?.ok===false?p.reason??p.status:!p?"RESULT_UNAVAILABLE":null});
 for(const trade of Array.isArray(p?.results)?p.results.slice(0,100):[]){
  for(const a of Array.isArray(trade.actions)?trade.actions.slice(0,20):[]){
   const x=a?.result?.payload??{},conflict=Boolean(x.tradeId&&trade.tradeId&&x.tradeId!==trade.tradeId);
   add({reportedAction:x.action??a.action??(a.type?.startsWith("STOP_EXIT")?"EXIT":null),reportedOutcome:conflict?"UNKNOWN":a.result?.ok===true?"COMPLETED":a.result?.ok===false?"REJECTED":"UNKNOWN",executorInvoked:true,tradeId:conflict?null:x.tradeId??trade.tradeId,candidateId:conflict?null:x.candidateId,planId:conflict?null:x.planId,orderId:conflict?null:x.orderId,executionId:conflict?null:x.executionId,orderCreated:conflict||x.duplicate===true?null:bool(x.orderCreated),fillStatus:"UNKNOWN",journalAckStatus:x.journalPending===true?"JOURNAL_PENDING":x.journalCompleted===true?"JOURNAL_COMPLETE":null,rejectReason:conflict?"IDENTITY_CONFLICT":a.result?.ok===false?a.result.error:null});
  }
 }
 return rows;
}
export async function observeLifecycleOutcome({step,runId,root,now=()=>new Date().toISOString(),persist=persistPrivateReceipt}){
 try{const rows=lifecycleReceipts({step,runId,cycleTime:step.startedAt,createdAt:now()});for(const row of rows)await persist(root,row);return {status:"RECORDED",count:rows.length};}catch{return {status:"UNKNOWN"};}
}
