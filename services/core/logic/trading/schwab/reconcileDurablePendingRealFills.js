// Engine 8 durable pending REAL delivery reconciliation.
// Only one process should own the existing REAL watcher. All writes are to
// Engine 8's existing observation ledger after Engine 10 identity/ack evidence.
// No watermark mutation, order placement, or Engine 10 Journal writes directly.
import {getSchwabConfig} from "./schwabConfig.js";
import {readEngine8RealFillObserverState,upsertEngine8RealFillRecord} from "./engine8RealFillStore.js";
import {readEngine10JournalForRealAck,verifyEngine10RealFillIdentity,OCT23_ACK_REPAIR_IDS}
 from "./engine8RealAckVerification.js";

const string=x=>String(x??"").trim();
const retryStatuses=new Set(["PENDING_ENGINE10","ENGINE10_NOT_ACKNOWLEDGED","ENGINE10_DELIVERY_FAILED"]);
const seconds=(d)=>Number.isFinite(Date.parse(String(d??"")))?Date.parse(d):null;
const isAck=(fill,response)=>response?.ok===true&&response?.journalCompleted===true&&
 string(response.brokerTransactionId)===string(fill.brokerTransactionId)&&
 string(response.tradeId)!==""&&
 (!fill.brokerFillLegId||!response.brokerFillLegId||
 string(fill.brokerFillLegId)===string(response.brokerFillLegId));
export function selectDurablePendingRealFills(state,now=new Date(),max=25){
 const pending=Object.values(state?.observations||{}).filter(r=>
  r?.delivered!==true&&retryStatuses.has(r?.deliveryStatus)&&r?.normalizedFill);
 return pending.filter(r=>{
  const attempt=seconds(r.lastAttemptAt);
  const count=Math.min(Math.max(Number(r.attemptCount||0),0),8);
  return attempt===null||now.getTime()-attempt>=Math.min(300000,10000*2**count);
 }).sort((a,b)=>seconds(a.fillTime)-seconds(b.fillTime)).slice(0,max);
}
export async function reconcileDurablePendingRealFills({
 journalReader=readEngine10JournalForRealAck,
 stateReader=readEngine8RealFillObserverState,
 update=upsertEngine8RealFillRecord,
 deliver=null,
 now=new Date(),
 max=25,
}={}){
 const report={readOnlyBroker:true,watermarksChanged:false,
  journalVerified:0,retried:0,acknowledged:0,pending:0,
  heldForExactAudit:0,errors:[]};
 const state=stateReader();
 const candidates=selectDurablePendingRealFills(state,now,max);
 if(!candidates.length)return report;
 let journal;
 try{journal=await journalReader();}
 catch(e){report.errors.push("ENGINE10_JOURNAL_READ_FAILED");report.pending=candidates.length;return report;}
 const config=deliver?null:getSchwabConfig();
 const base=(process.env.ENGINE8_REAL_JOURNAL_BASE_URL||process.env.CORE_BASE||
  "http://127.0.0.1:10000").replace(/\/+$/,"");
 const handler=deliver||(async fill=>{
  if(!config.adminSecret)throw Error("ADMIN_SECRET_MISSING");
  const r=await fetch(base+"/api/v1/trade-journal/real-fill",{
   method:"POST",headers:{"Content-Type":"application/json",
    "X-Engine8-Admin-Secret":config.adminSecret},
   body:JSON.stringify(fill),signal:AbortSignal.timeout(20000)
  });
  return {httpOk:r.ok,body:await r.json()};
 });
 for(const candidate of candidates){
  const fill=candidate.normalizedFill;
  const key=string(candidate.dedupeKey);
  const identity=verifyEngine10RealFillIdentity(journal,fill);
  if(identity.ok&&identity.confirmed){
   update(key,{delivered:true,deliveryStatus:"ENGINE10_ACKNOWLEDGED",
    engine10TradeId:identity.tradeId,engine10Duplicate:true,
    deliveredAt:now.toISOString(),lastError:null,
    reconciliationSource:"EXACT_READ_ONLY_ENGINE10_JOURNAL_IDENTITY"});
   report.journalVerified++;report.acknowledged++;
   continue;
  }
  // The three historical failed-ack records are repair-only; never
  // POST/replay them to correct an acknowledgment state.
  if(OCT23_ACK_REPAIR_IDS.includes(string(fill.brokerTransactionId))){
   report.heldForExactAudit++;report.pending++;
   report.errors.push("EXACT_IDENTITY_NOT_VERIFIED:"+string(fill.brokerTransactionId));
   continue;
  }
  // An ambiguous Journal match must not trigger a duplicate execution.
  if(!identity.ok||identity.reason!=="NOT_IN_JOURNAL"){
   report.pending++;report.errors.push("JOURNAL_IDENTITY_AMBIGUOUS:"+key);continue;
  }
  try{
   const reply=await handler(fill);report.retried++;
   if(reply.httpOk===true&&isAck(fill,reply.body)){
    update(key,{delivered:true,deliveryStatus:"ENGINE10_ACKNOWLEDGED",
      engine10TradeId:string(reply.body.tradeId),engine10Duplicate:reply.body.duplicate===true,
      deliveredAt:now.toISOString(),lastAttemptAt:now.toISOString(),lastError:null,
      reconciliationSource:"AUTHENTICATED_ENGINE10_DELIVERY_ACK"});
    report.acknowledged++;
   }else{
    update(key,{delivered:false,deliveryStatus:"ENGINE10_NOT_ACKNOWLEDGED",
      lastAttemptAt:now.toISOString(),attemptCount:Number(candidate.attemptCount||0)+1,
      lastError:"ENGINE10_RETRY_UNACKNOWLEDGED"});
    report.pending++;
   }
  }catch(e){
   update(key,{delivered:false,deliveryStatus:"ENGINE10_DELIVERY_FAILED",
     lastAttemptAt:now.toISOString(),attemptCount:Number(candidate.attemptCount||0)+1,
     lastError:"ENGINE10_RETRY_FAILED"});
   report.pending++;report.errors.push("ENGINE10_RETRY_FAILED:"+key);
  }
 }
 return report;
}
