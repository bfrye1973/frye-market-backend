// #412: read-only Journal correlation. Current state is not historical event state.
const id=v=>typeof v==="string"&&v.trim()?v:null;
const eqTime=(a,b)=>typeof a==="string"&&typeof b==="string"&&Number.isFinite(Date.parse(a))&&Date.parse(a)===Date.parse(b);
const mode=t=>String(t?.accountMode??"").toUpperCase();
function resolve(fields,sources){
 const out={},conflicts=[];
 for(const k of fields){const v=[...new Set(sources.map(s=>id(s?.[k])).filter(Boolean))];out[k]=v[0]??null;if(v.length>1)conflicts.push(k);}
 return {out,conflicts};
}
const unknown=(row,reason,meta)=>({...row,journalStatus:"UNKNOWN",journalCurrentStatus:"UNKNOWN",journalRecordMatched:false,journalMatch:reason,engine8JournalAckStatus:"UNKNOWN",journalReadAt:meta?.readAt??null,journalSha256:meta?.sha256??null});
export function attachPaperJournalEvidence(row,trades,{ledger,meta}={}){
 const fail=reason=>unknown(row,reason,meta);
 if(!Array.isArray(trades))return fail("JOURNAL_UNAVAILABLE");
 const required=["strategyId","candidateId","planId","orderId","executionId","idempotencyKey"];
 if(required.some(k=>!id(row?.[k])))return fail("IDENTITY_INCOMPLETE");
 if(!["NEW_ENTRY","REDUCE","EXIT"].includes(row.action))return fail("ACTION_UNSUPPORTED");
 const candidates=[];
 for(const t of trades){
  if(mode(t)!=="PAPER")continue;
  const campaign=resolve(["strategyId","candidateId","planId","tradeId"],[t,t.identity,t.setup,t.orderLink]);
  if(row.action==="NEW_ENTRY"){
   const sources=[t.identity,t.orderLink,{orderId:t.orderId,executionId:t.executionId,idempotencyKey:t.idempotencyKey},{executionId:t.identity?.openingExecutionId}];
   const k=resolve(["orderId","executionId","idempotencyKey"],sources);
   if(sources.some(s=>s?.orderId===row.orderId))candidates.push({t,campaign,k,event:null});
  }else{
   for(const e of Array.isArray(t.events)?t.events:[]){
    if(e?.orderId===row.orderId&&Number.isInteger(e.qtyClosed)&&e.qtyClosed>0)candidates.push({t,campaign,k:resolve(["orderId","executionId","idempotencyKey"],[e]),event:e});
   }
  }
 }
 if(!candidates.length)return fail("NO_MATCHING_JOURNAL_EVIDENCE");
 if(candidates.length!==1)return fail("IDENTITY_CONFLICT");
 const {t,campaign,k,event}=candidates[0],j={...campaign.out,...k.out};
 if(campaign.conflicts.length||k.conflicts.length||required.some(f=>id(j[f])&&j[f]!==row[f])||(row.tradeId&&j.tradeId!==row.tradeId))return fail("IDENTITY_CONFLICT");
 if(required.some(f=>!id(j[f]))||!id(j.tradeId)||!id(t.tradeId))return fail("IDENTITY_INCOMPLETE");
 if(event){
  if(!id(event.tradeId)||!id(event.executionId)||!id(event.idempotencyKey))return fail("IDENTITY_INCOMPLETE");
  if(event.action!==row.action||event.source!=="engine8_execution"||event.tradeId!==j.tradeId||["strategyId","candidateId","planId"].some(f=>id(event[f])&&event[f]!==row[f]))return fail("IDENTITY_CONFLICT");
  if(event.qtyClosed!==row.filledQuantity||(event.fillQuantity!==undefined&&event.fillQuantity!==row.filledQuantity)||event.price!==row.fillPrice||!eqTime(event.ts,row.fillTime))return fail("JOURNAL_FILL_MISMATCH");
 }else if(t.entry?.qty!==row.filledQuantity||t.entry?.price!==row.fillPrice||!eqTime(t.entry?.time,row.fillTime))return fail("JOURNAL_FILL_MISMATCH");
 const status=String(t.status??"").toUpperCase(),remaining=t.qty?.remainingQty;
 if(!["OPEN","CLOSED"].includes(status)||!Number.isInteger(remaining)||remaining<0||(status==="CLOSED"&&remaining!==0)||(status==="OPEN"&&remaining===0))return fail("JOURNAL_LIFECYCLE_UNVERIFIED");
 const saved=ledger&&Object.hasOwn(ledger,row.idempotencyKey)?ledger[row.idempotencyKey]:null;
 let ack="UNKNOWN";
 if(saved?.paper===true&&saved.orderId===row.orderId&&saved.executionId===row.executionId&&saved.status==="filled"){
  const ids=[saved.tradeId,saved.journal?.tradeId].filter(id);
  if(ids.some(v=>v!==j.tradeId))ack="IDENTITY_CONFLICT";
  else if(saved.journalStatus==="JOURNAL_PENDING")ack="PENDING_JOURNAL_ACK";
  else if(saved.journalStatus==="JOURNAL_COMPLETE"&&saved.journal?.ok===true&&saved.journal?.tradeId===j.tradeId)ack="JOURNAL_COMPLETE";
 }
 return {...row,tradeId:j.tradeId,journalStatus:status,journalCurrentStatus:status,journalRecordMatched:true,journalMatch:"MATCHED",engine8JournalAckStatus:ack,journalRemainingQty:remaining,journalCurrentRemainingQty:remaining,journalHistoricalEventRemainingQty:event?.remainingQty??(event?null:row.filledQuantity),journalHistoricalEventFillQuantity:row.filledQuantity,journalReadAt:meta?.readAt??null,journalSha256:meta?.sha256??null};
}
export function attachDailyJournalEvidence(projection,trades,options={}){
 const fills=projection.fills.map(row=>attachPaperJournalEvidence(row,trades,options));
 const unique=status=>new Set(fills.filter(x=>x.journalMatch==="MATCHED"&&x.journalStatus===status).map(x=>x.tradeId)).size;
 return {...projection,fills,journalOpenMatched:unique("OPEN"),journalClosedMatched:unique("CLOSED"),journalUnverifiedFillCount:fills.filter(x=>x.journalMatch!=="MATCHED").length,pendingJournalAckCount:fills.filter(x=>x.engine8JournalAckStatus==="PENDING_JOURNAL_ACK").length};
}
