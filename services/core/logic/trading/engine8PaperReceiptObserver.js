// Private append-only verification evidence; never touches trading state.
// Opt-in observer directory must be explicitly provisioned and private.
import fs from "node:fs/promises";
import path from "node:path";
import {constants} from "node:fs";
import {randomUUID,createHash} from "node:crypto";
import {buildPrivatePaperReceipt,publicPaperReceipt,validatePrivatePaperReceipt} from "./engine8PrivatePaperReceipt.js";
const bool=x=>typeof x==="boolean"?x:null;
export function receiptFromCycle({step,context={},cycleTime,cycleId,createdAt}){
 let p=null;
 try{if(typeof step?.stdout==="string"&&Buffer.byteLength(step.stdout)<=65536)p=JSON.parse(step.stdout);}catch{}
 const a=context.adapter??{},e=p?.execution??{};
 const ids=["candidateId","planId"];
 const conflict=ids.some(k=>a[k]&&e[k]&&a[k]!==e[k]);
 return buildPrivatePaperReceipt({mode:"PAPER",cycleKind:context.cycleKind??"ENTRY",schedulerRunId:context.schedulerRunId,cycleId,cycleTime,strategyId:"intraday_scalp@10m",candidateId:conflict?null:a.candidateId??e.candidateId,planId:conflict?null:a.planId??e.planId,approvalSnapshotTime:context.approvalSnapshotTime,approvalSnapshotHash:context.approvalSnapshotHash,engine6Permission:conflict?null:context.engine6Permission,engine8Eligible:null,engine8Executable:bool(a.executable),executorInvoked:bool(context.executorInvoked),skipReason:conflict?"IDENTITY_CONFLICT":p?.skipped===true?p.reason:null,rejectReason:p?.ok===false?p.reason:!p?"RESULT_UNAVAILABLE":null,blockers:Array.isArray(a.blockers)?a.blockers:null,orderCreated:conflict?null:context.executorInvoked===false&&p?.skipped===true?false:bool(e.orderCreated),orderId:conflict?null:e.orderId,executionId:conflict?null:e.executionId,tradeId:conflict?null:e.tradeId,fillStatus:e.fillCreated===true?"UNKNOWN":e.fillCreated===false?"NOT_FILLED":null,reportedAction:"NEW_ENTRY",reportedOutcome:p?.skipped===true?"SKIPPED":p?.ok===false?"REJECTED":p?.ok===true?"COMPLETED":"UNKNOWN",journalAckStatus:e.journalPending===true?"JOURNAL_PENDING":e.journalCompleted===true?"JOURNAL_COMPLETE":null},createdAt);
}
export async function persistPrivateReceipt(root,receipt){
 if(typeof root!=="string"||!path.isAbsolute(root)||path.resolve(root)!==root||await fs.realpath(root)!==root)throw Error("UNSAFE_RECEIPT_ROOT");
 const stat=await fs.stat(root);if(!stat.isDirectory()||(stat.mode&0o077)!==0)throw Error("UNSAFE_RECEIPT_ROOT");
 const raw=JSON.stringify(receipt);if(Buffer.byteLength(raw)>8192)throw Error("RECEIPT_TOO_LARGE");
 const day=new Date(Date.parse(receipt.cycleTime)-7*3600000).toISOString().slice(0,10);
 const name=day+"-"+createHash("sha256").update(receipt.cycleId).digest("hex")+".json";
 // Bound directory growth without automatic deletion or truncation.
 const dir=await fs.opendir(root);let n=0;try{for await(const entry of dir){if(++n>=50000)throw Error("RECEIPT_CAP_REACHED");}}finally{await dir.close().catch(()=>{});}
 const tmp=path.join(root,"."+randomUUID()+".tmp"),dest=path.join(root,name);
 let file;
 try{file=await fs.open(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await file.writeFile(raw);await file.sync();await file.close();file=null;await fs.link(tmp,dest);const d=await fs.open(root,"r");try{await d.sync();}finally{await d.close();}}finally{if(file)await file.close().catch(()=>{});await fs.unlink(tmp).catch(()=>{});}
}
export async function observeCompletedPaperCycle({step,context,cycleTime,cycleId,root,now=()=>new Date().toISOString(),persist=persistPrivateReceipt,log=()=>{}}){
 try{const receipt=receiptFromCycle({step,context,cycleTime,cycleId,createdAt:now()});const validity=validatePrivatePaperReceipt(receipt,{now:receipt.receiptCreatedAt});await persist(root,receipt);log({event:"ENGINE8_PAPER_VERIFICATION_RECEIPT",status:validity.valid?"RECORDED":"UNKNOWN",...publicPaperReceipt(receipt)});return {status:validity.valid?"RECORDED":"UNKNOWN"};}
 catch{try{log({event:"ENGINE8_PAPER_VERIFICATION_RECEIPT",status:"UNKNOWN",reason:"OBSERVER_FAILED"});}catch{}return {status:"UNKNOWN"};}
}
