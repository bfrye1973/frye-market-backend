// #412: observational correlation only, never writes Journal or certifies Engine12.
const id=v=>typeof v==="string"&&v.trim()?v:null;
const eqTime=(a,b)=>typeof a==="string"&&typeof b==="string"&&Number.isFinite(Date.parse(a))&&Date.parse(a)===Date.parse(b);
const mode=t=>String(t?.accountMode??"").toUpperCase();
const ident=t=>({strategyId:t.strategyId??t.identity?.strategyId, candidateId:t.identity?.candidateId??t.setup?.candidateId,planId:t.identity?.planId??t.setup?.planId,orderId:t.identity?.orderId??t.orderLink?.orderId,executionId:t.identity?.openingExecutionId??t.identity?.executionId??t.orderLink?.executionId});
const compatible=(a,b,fields)=>fields.every(k=>!id(a[k])||!id(b[k])||a[k]===b[k]);
const unknown=(row,reason)=>({...row,journalStatus:"UNKNOWN",journalMatch:reason});
export function attachPaperJournalEvidence(row,trades){
 if(!Array.isArray(trades))return unknown(row,"JOURNAL_UNAVAILABLE");
 if(!id(row?.orderId)||!id(row?.strategyId))return unknown(row,"IDENTITY_INCOMPLETE");
 const candidates=[];
 for(const t of trades){
  if(mode(t)!=="PAPER")continue;
  const k=ident(t);
  if(row.action==="NEW_ENTRY"){
   if(k.orderId===row.orderId)candidates.push({t,k,event:null});
  }else{
   for(const e of Array.isArray(t.events)?t.events:[]){
    if(e?.orderId===row.orderId&&Number.isInteger(e.qtyClosed)&&e.qtyClosed>0)candidates.push({t,k,event:e});
   }
  }
 }
 if(!candidates.length)return unknown(row,"NO_MATCHING_JOURNAL_EVIDENCE");
 if(candidates.length!==1)return unknown(row,"IDENTITY_CONFLICT");
 const {t,k,event}=candidates[0];
 if(k.strategyId!==row.strategyId||!id(t.tradeId)||!compatible(row,k,["candidateId","planId"])||(id(row.tradeId)&&row.tradeId!==t.tradeId))return unknown(row,"IDENTITY_CONFLICT");
 if(row.action==="NEW_ENTRY"){
  if(!compatible(row,k,["executionId"])||t.entry?.qty!==row.filledQuantity||t.entry?.price!==row.fillPrice||!eqTime(t.entry?.time,row.fillTime))return unknown(row,"JOURNAL_FILL_MISMATCH");
 }else{
  if(!compatible(row,event,["executionId"])||event.qtyClosed!==row.filledQuantity||event.price!==row.fillPrice||!eqTime(event.ts,row.fillTime))return unknown(row,"JOURNAL_FILL_MISMATCH");
 }
 const status=String(t.status??"").toUpperCase();
 if(!["OPEN","CLOSED"].includes(status)||!Number.isInteger(t.qty?.remainingQty)||t.qty.remainingQty<0||(status==="CLOSED"&&t.qty.remainingQty!==0)||(status==="OPEN"&&t.qty.remainingQty===0))return unknown(row,"JOURNAL_LIFECYCLE_UNVERIFIED");
 return {...row,tradeId:t.tradeId,journalStatus:status,journalMatch:"MATCHED",journalRemainingQty:t.qty.remainingQty};
}
export function attachDailyJournalEvidence(projection,trades){
 const fills=projection.fills.map(row=>attachPaperJournalEvidence(row,trades));
 const unique=status=>new Set(fills.filter(x=>x.journalMatch==="MATCHED"&&x.journalStatus===status).map(x=>x.tradeId)).size;
 return {...projection,fills,journalOpenMatched:unique("OPEN"),journalClosedMatched:unique("CLOSED"),journalUnverifiedFillCount:fills.filter(x=>x.journalMatch!=="MATCHED").length};
}
