// Engine 10: read-only planning for an additive Oct 22 classification migration.
// Never rewrites trade IDs, contract IDs, broker identities, or accounting fields.
import {classifyRealCampaignAtEntry,REAL_STRATEGY_CUTOVER_UTC} from "./realAccountClassification.js";
const up=x=>String(x??"").trim().toUpperCase();
const str=x=>String(x??"").trim();
const keys=["tradeId","contractId","brokerTransactionId","brokerFillLegId"];
export function planOctober22Classification(trades=[],verifiedOpenings=[]){
 const errors=[],changes=[],unmatched=[];
 if(!Array.isArray(trades)||!Array.isArray(verifiedOpenings))return {ok:false,errors:["INVALID_INPUT"],changes:[]};
 const known=new Set();
 for(const opening of verifiedOpenings){
  const account=up(opening.brokerAccountLabel),id=str(opening.brokerTransactionId),time=str(opening.fillTime);
  const classification=classifyRealCampaignAtEntry({brokerAccountLabel:account,entryTime:time});
  if(!classification.ok){errors.push({type:"INVALID_BROKER_OPENING",id,reason:classification.error});continue;}
  if(!id){errors.push({type:"MISSING_BROKER_TRANSACTION_ID"});continue;}
  const identity=account+"|"+id+"|"+str(opening.brokerFillLegId);
  if(known.has(identity)){errors.push({type:"DUPLICATE_VERIFIED_OPENING",identity});continue;}
  known.add(identity);
  const matches=trades.filter(t=>{
   if(up(t.accountMode)!=="REAL")return false;
   const label=up(t.brokerAccountLabel||t.realBroker?.brokerAccountLabel);
   if(label!==account)return false;
   const first=str(t.entry?.brokerTransactionId||t.events?.find(e=>e.eventType==="REAL_ENTRY_FILL")?.brokerTransactionId);
   const events=(t.events||[]).filter(e=>["REAL_ENTRY_FILL","REAL_SCALE_IN_FILL"].includes(e.eventType));
   return first===id||events.some(e=>str(e.brokerTransactionId)===id);
  });
  if(matches.length!==1){unmatched.push({identity,count:matches.length});continue;}
  const t=matches[0],entryTime=str(t.entry?.time);
  if(Date.parse(entryTime)>Date.parse(time)){errors.push({type:"FILL_BEFORE_CAMPAIGN_ENTRY",tradeId:t.tradeId});continue;}
  if(Date.parse(entryTime)<Date.parse(REAL_STRATEGY_CUTOVER_UTC)){errors.push({type:"PRE_CUTOVER_CAMPAIGN",tradeId:t.tradeId});continue;}
  const previous=up(t.performanceGroup||t.journalAccount);
  if(t.performanceGroup&&previous!==classification.classification){errors.push({type:"CLASSIFICATION_CONFLICT",tradeId:t.tradeId});continue;}
  if(previous===classification.classification)continue;
  if(!["SWING","INTRADAY"].includes(previous)){errors.push({type:"UNEXPECTED_LEGACY_CLASSIFICATION",tradeId:t.tradeId});continue;}
  if(changes.some(c=>c.tradeId===t.tradeId)){
    const existing=changes.find(c=>c.tradeId===t.tradeId);
    if(existing.performanceGroup!==classification.classification)errors.push({type:"CAMPAIGN_CLASSIFICATION_CONFLICT",tradeId:t.tradeId});
    continue;
  }
  changes.push({tradeId:t.tradeId,brokerAccountLabel:account,brokerTransactionId:id,previousPerformanceGroup:previous,performanceGroup:classification.classification,performanceClassificationSource:"VERIFIED_OCT22_CUTOVER",performanceClassificationVersion:classification.registryVersion});
 }
 return {schema:"engine10.oct22ClassificationPlan.v1",ok:errors.length===0&&unmatched.length===0,changes,errors,unmatched,readOnly:true};
}
export function applyClassificationPlanToCopy(trades,plan){
 if(!plan?.ok)throw Error("CLASSIFICATION_PLAN_NOT_VERIFIED");
 const copy=structuredClone(trades),changes=new Map(plan.changes.map(x=>[x.tradeId,x]));
 if(changes.size!==plan.changes.length)throw Error("DUPLICATE_TRADE_ID_IN_PLAN");
 for(const t of copy){
  const c=changes.get(t.tradeId);
  if(!c)continue;
  if(up(t.brokerAccountLabel||t.realBroker?.brokerAccountLabel)!==c.brokerAccountLabel)throw Error("BROKER_IDENTITY_CHANGED");
  if(up(t.performanceGroup||t.journalAccount)!==c.previousPerformanceGroup)throw Error("STALE_CLASSIFICATION");
  t.performanceGroup=c.performanceGroup;
  t.performanceClassificationSource=c.performanceClassificationSource;
  t.performanceClassificationVersion=c.performanceClassificationVersion;
  changes.delete(t.tradeId);
 }
 if(changes.size)throw Error("MIGRATION_TARGET_MISSING");
 return copy;
}
