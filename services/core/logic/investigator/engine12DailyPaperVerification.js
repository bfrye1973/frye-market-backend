// Engine 12 Issue #412: independent PAPER verification consumer.
// Read-only forensic logic. Never places/retries/cancels orders or mutates state.

const STR=v=>typeof v==="string"&&v.trim()?v.trim():null;
const UPPER=v=>STR(v)?.toUpperCase()??null;
const NUM=v=>typeof v==="number"&&Number.isFinite(v)?v:null;
const MS=v=>{const t=typeof v==="string"?Date.parse(v):NaN;return Number.isFinite(t)?t:null;};

function dayBounds(date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||"")))throw Error("INVALID_ARIZONA_DATE");
 const start=Date.parse(date+"T00:00:00-07:00");if(!Number.isFinite(start))throw Error("INVALID_ARIZONA_DATE");
 return {start,end:start+86400000};
}
const vals=(...v)=>[...new Set(v.map(STR).filter(Boolean))];

function identityFrom(order,execution){
 const os=order?.sourceSignal||{},a=execution?.sourceSignal||{},b=execution?.ourceSignal||{};
 const f=k=>vals(order?.[k],execution?.[k],os?.[k],a?.[k],b?.[k]);
 return {candidateId:f("candidateId"),planId:f("planId"),executionId:f("executionId"),tradeId:f("tradeId")};
}
function nonPaper(row){
 if(row?.paper===false)return true;
 return ["REAL","LIVE"].includes(UPPER(row?.accountMode??row?.mode));
}
function verifyPair(order,execution){
 const p=[];
 if(order?.paper!==true||nonPaper(execution))p.push("PAPER_MODE_CONFLICT");
 const oid=STR(order?.orderId),eid=STR(execution?.orderId);if(!oid||!eid||oid!==eid)p.push("ORDER_ID_CONFLICT");
 for(const f of ["strategyId","action","idempotencyKey"]){const a=STR(order?.[f]),b=STR(execution?.[f]);if(!a||!b||a!==b)p.push(f.toUpperCase()+"_CONFLICT");}
 for(const f of ["symbol","side"]){const a=STR(order?.[f]),b=STR(execution?.[f]);if(a&&b&&UPPER(a)!==UPPER(b))p.push(f.toUpperCase()+"_CONFLICT");}
 const ids=identityFrom(order,execution);for(const [k,v] of Object.entries(ids))if(v.length>1)p.push(k.toUpperCase()+"_CONFLICT");
 const oq=NUM(order?.filledQty),eq=NUM(execution?.filledQty),op=NUM(order?.avgPrice),ep=NUM(execution?.avgPrice);
 if(UPPER(order?.status)!=="FILLED"||UPPER(execution?.status)!=="FILLED")p.push("STATUS_NOT_FILLED");
 if(!Number.isInteger(oq)||oq<=0||!Number.isInteger(eq)||eq<=0||oq!==eq)p.push("FILL_QTY_CONFLICT");
 if(op===null||ep===null||op<=0||ep<=0||op!==ep)p.push("FILL_PRICE_CONFLICT");
 const ot=MS(order?.filledAt??order?.ts),et=MS(execution?.ts);if(ot===null||et===null||ot!==et)p.push("FILL_TIME_CONFLICT");
 return {ok:!p.length,problems:p,orderId:oid,fillTimeMs:et,filledQuantity:eq,fillPrice:ep,
  identity:{candidateId:ids.candidateId[0]??null,planId:ids.planId[0]??null,executionId:ids.executionId[0]??null,tradeId:ids.tradeId[0]??null}};
}

function campaignIdentity(trade){
 const id=trade?.identity||{},setup=trade?.setup||{};
 return {strategyId:STR(trade?.strategyId??id.strategyId),candidateId:STR(id.candidateId??setup.candidateId),planId:STR(id.planId??setup.planId),tradeId:STR(trade?.tradeId??id.tradeId)};
}
function openingIdentity(trade){
 const id=trade?.identity||{},link=trade?.orderLink||{};
 return {orderId:STR(id.orderId??link.orderId),executionId:STR(id.openingExecutionId??id.executionId??link.executionId),idempotencyKey:STR(id.idempotencyKey??link.idempotencyKey)};
}
function requiredEqual(a,b,fields){return fields.every(f=>STR(a?.[f])&&STR(b?.[f])&&STR(a[f])===STR(b[f]));}

function journalAck(fill,ledger,tradeId){
 if(!ledger||typeof ledger!=="object"||Array.isArray(ledger)||!fill.idempotencyKey)return {status:"UNKNOWN"};
 const saved=ledger[fill.idempotencyKey];if(!saved||saved.paper!==true)return {status:"UNKNOWN"};
 if(saved.orderId!==fill.orderId||saved.executionId!==fill.executionId||saved.status!=="filled")return {status:"IDENTITY_CONFLICT"};
 const ids=[saved.tradeId,saved.journal?.tradeId].map(STR).filter(Boolean);if(ids.some(v=>tradeId&&v!==tradeId))return {status:"IDENTITY_CONFLICT"};
 if(saved.journalStatus==="JOURNAL_PENDING")return {status:"PENDING_JOURNAL_ACK"};
 if(saved.journalStatus==="JOURNAL_COMPLETE"&&saved.journal?.ok===true&&STR(saved.journal?.tradeId)===tradeId)return {status:"JOURNAL_COMPLETE"};
 return {status:"UNKNOWN"};
}

function matchJournal(fill,trades,ledger){
 if(!Array.isArray(trades))return {status:"UNKNOWN",reason:"JOURNAL_UNAVAILABLE",ackStatus:"UNKNOWN"};
 const c=[];
 for(const trade of trades){
  if(UPPER(trade?.accountMode)!=="PAPER")continue;
  const camp=campaignIdentity(trade);
  if(fill.action==="NEW_ENTRY"){
   const open=openingIdentity(trade);if(open.orderId===fill.orderId)c.push({trade,camp,open,event:null});
  }else{
   for(const event of Array.isArray(trade?.events)?trade.events:[]){
    if(STR(event?.orderId)===fill.orderId&&Number.isInteger(event?.qtyClosed)&&event.qtyClosed>0)c.push({trade,camp,open:null,event});
   }
  }
 }
 if(!c.length)return {status:"UNKNOWN",reason:"NO_MATCHING_JOURNAL_RECORD",ackStatus:"UNKNOWN"};
 if(c.length!==1)return {status:"UNKNOWN",reason:"IDENTITY_CONFLICT",ackStatus:"UNKNOWN"};
 const {trade,camp,open,event}=c[0];
 if(!requiredEqual(fill,camp,["strategyId","candidateId","planId"]))return {status:"UNKNOWN",reason:"CAMPAIGN_IDENTITY_CONFLICT",ackStatus:"UNKNOWN"};
 if(fill.tradeId&&camp.tradeId&&fill.tradeId!==camp.tradeId)return {status:"UNKNOWN",reason:"TRADE_ID_CONFLICT",ackStatus:"UNKNOWN"};
 if(!camp.tradeId)return {status:"UNKNOWN",reason:"TRADE_ID_MISSING",ackStatus:"UNKNOWN"};

 if(!event){
  if(!requiredEqual(fill,open,["orderId","executionId","idempotencyKey"]))return {status:"UNKNOWN",reason:"OPENING_IDENTITY_INCOMPLETE_OR_CONFLICT",ackStatus:"UNKNOWN"};
  if(trade?.entry?.qty!==fill.filledQuantity||trade?.entry?.price!==fill.fillPrice||MS(trade?.entry?.time)!==MS(fill.fillTime))return {status:"UNKNOWN",reason:"JOURNAL_FILL_MISMATCH",ackStatus:"UNKNOWN"};
 }else{
  const own={orderId:STR(event.orderId),executionId:STR(event.executionId),idempotencyKey:STR(event.idempotencyKey)};
  if(!requiredEqual(fill,own,["orderId","executionId","idempotencyKey"]))return {status:"UNKNOWN",reason:"EXIT_EVENT_IDENTITY_INCOMPLETE_OR_CONFLICT",ackStatus:"UNKNOWN"};
  if(UPPER(event?.action)!==fill.action||event?.source!=="engine8_execution"||STR(event?.tradeId)!==camp.tradeId)return {status:"UNKNOWN",reason:"JOURNAL_EVENT_IDENTITY_CONFLICT",ackStatus:"UNKNOWN"};
  if(event.qtyClosed!==fill.filledQuantity||(event.fillQuantity!==undefined&&event.fillQuantity!==fill.filledQuantity)||event.price!==fill.fillPrice||MS(event.ts)!==MS(fill.fillTime))return {status:"UNKNOWN",reason:"JOURNAL_FILL_MISMATCH",ackStatus:"UNKNOWN"};
 }
 const state=UPPER(trade?.status),remaining=trade?.qty?.remainingQty;
 if(!["OPEN","CLOSED"].includes(state)||!Number.isInteger(remaining)||remaining<0||(state==="CLOSED"&&remaining!==0)||(state==="OPEN"&&remaining===0))return {status:"UNKNOWN",reason:"JOURNAL_LIFECYCLE_UNVERIFIED",ackStatus:"UNKNOWN"};
 const ack=journalAck(fill,ledger,camp.tradeId);
 return {status:"MATCHED",reason:null,tradeId:camp.tradeId,currentStatus:state,currentRemainingQty:remaining,historicalEventRemainingQty:event?.remainingQty??null,ackStatus:ack.status};
}

export function validateTrustedArizonaCoverage(a,date){
 const {start,end}=dayBounds(date),fail=reason=>({trusted:false,reason});
 if(!a||typeof a!=="object")return fail("COVERAGE_ATTESTATION_MISSING");
 if(a.schemaVersion!=="engine8.paperVerificationCoverage.v1")return fail("COVERAGE_SCHEMA_UNKNOWN");
 if(a.timezone!=="America/Phoenix"||a.date!==date)return fail("COVERAGE_DATE_OR_TZ_MISMATCH");
 if(MS(a.intervalStart)!==start||MS(a.intervalEnd)!==end)return fail("COVERAGE_INTERVAL_MISMATCH");
 if(a.status!=="COMPLETE")return fail("COVERAGE_NOT_COMPLETE");
 if(MS(a.watermarkThrough)===null||MS(a.watermarkThrough)<end)return fail("COVERAGE_WATERMARK_INCOMPLETE");
 if(!Number.isInteger(a.expectedCycles)||a.expectedCycles<0||!Number.isInteger(a.observedCycles)||a.observedCycles!==a.expectedCycles)return fail("CYCLE_COVERAGE_INCOMPLETE");
 for(const f of ["gaps","duplicates","errors"])if(!Array.isArray(a[f])||a[f].length)return fail("COVERAGE_"+f.toUpperCase());
 if(!a.stores||["orders","executions","lifecycle","ledger","journal"].some(k=>a.stores[k]!=="COVERED"))return fail("STORE_COVERAGE_INCOMPLETE");
 if(a.originalApprovalEvidence!=="COVERED")return fail("APPROVAL_COVERAGE_INCOMPLETE");
 return {trusted:true,reason:null};
}

export function buildDailyPaperVerification({date,evidence,coverageAttestation=null}={}){
 const {start,end}=dayBounds(date),issues=new Set(),v=evidence?.values||{},stores=evidence?.stores||{};
 if(evidence?.stability!=="NO_CHANGE_OBSERVED")issues.add("EVIDENCE_READ_UNSTABLE");
 for(const k of ["orders","executions","journal","ledger"])if(stores?.[k]?.status!=="OK")issues.add(k.toUpperCase()+"_STORE_UNAVAILABLE");
 const orders=Array.isArray(v.orders)?v.orders:[],execs=Array.isArray(v.executions)?v.executions:[],journal=Array.isArray(v.journal)?v.journal:[],ledger=v.ledger;
 const om=new Map(),em=new Map();for(const o of orders){const k=STR(o?.orderId);if(!k){issues.add("ORDER_ID_MISSING");continue;}const a=om.get(k)||[];a.push(o);om.set(k,a);}
 for(const e of execs){const k=STR(e?.orderId);if(!k){issues.add("EXECUTION_ORDER_ID_MISSING");continue;}const a=em.get(k)||[];a.push(e);em.set(k,a);}
 const fills=[];
 for(const e of execs){
  const t=MS(e?.ts);if(t===null){issues.add("EXECUTION_TIME_UNKNOWN");continue;}if(t<start||t>=end)continue;
  const k=STR(e?.orderId),os=k?(om.get(k)||[]):[],es=k?(em.get(k)||[]):[];if(os.length!==1||es.length!==1){issues.add("IDENTITY_CONFLICT");continue;}
  const q=verifyPair(os[0],e);if(!q.ok){q.problems.forEach(x=>issues.add(x));continue;}
  const action=UPPER(e?.action);if(!["NEW_ENTRY","REDUCE","EXIT"].includes(action)){issues.add("ACTION_UNSUPPORTED");continue;}
  const row={strategyId:STR(os[0]?.strategyId),action,idempotencyKey:STR(os[0]?.idempotencyKey),candidateId:q.identity.candidateId,planId:q.identity.planId,executionId:q.identity.executionId,orderId:q.orderId,tradeId:q.identity.tradeId,filledQuantity:q.filledQuantity,fillPrice:q.fillPrice,fillTime:e.ts,approvalLinkStatus:q.identity.candidateId&&q.identity.planId?"IDENTITY_PRESENT":"UNKNOWN"};
  row.journal=matchJournal(row,journal,ledger);fills.push(row);
 }
 const coverage=validateTrustedArizonaCoverage(coverageAttestation,date);
 const verdict=fills.length?"YES":coverage.trusted&&issues.size===0?"NO":"UNKNOWN";
 const unique=s=>new Set(fills.filter(f=>f.journal?.status==="MATCHED"&&f.journal?.currentStatus===s).map(f=>f.journal.tradeId).filter(Boolean)).size;
 return {schemaVersion:"engine12.dailyPaperVerification.v2",date,timezone:"America/Phoenix",intervalStart:new Date(start).toISOString(),intervalEnd:new Date(end).toISOString(),verdict,evidenceReadAt:evidence?.readAt??null,evidenceFinishedAt:evidence?.finishedAt??null,evidenceStability:evidence?.stability??"UNKNOWN",coverage,
  counts:{verifiedFills:fills.length,openingFills:fills.filter(f=>f.action==="NEW_ENTRY").length,exitFills:fills.filter(f=>f.action!=="NEW_ENTRY").length,journalOpen:unique("OPEN"),journalClosed:unique("CLOSED"),journalUnverified:fills.filter(f=>f.journal?.status!=="MATCHED").length,pendingJournalAck:fills.filter(f=>f.journal?.ackStatus==="PENDING_JOURNAL_ACK").length},
  issues:[...issues].sort(),fills,stores,note:"YES requires independently revalidated durable fill evidence. NO requires trusted complete Arizona-day coverage plus zero verified fills. Otherwise UNKNOWN."};
}

function independentlyMatchedFill(daily,candidate){
 if(!candidate)return null;
 const hits=(daily?.fills||[]).filter(f=>f.strategyId===candidate.strategyId&&f.candidateId===candidate.candidateId&&f.planId===candidate.planId);
 return hits.length===1?hits[0]:null;
}

export function buildLatestApprovedCandidateVerification({daily,attempts,approvalReplay=null}={}){
 const candidate=attempts?.latestObservedApprovedCandidate??null;
 if(!candidate)return {schemaVersion:"engine12.latestApprovedPaperVerification.v1",date:daily?.date??attempts?.date??null,status:"UNKNOWN",reason:"NO_REPORTED_APPROVED_CANDIDATE",dailyVerdict:daily?.verdict??"UNKNOWN",reported:null,independent:{approvalReplay:approvalReplay??{status:"UNKNOWN"},fill:null,journal:null}};
 const fill=independentlyMatchedFill(daily,candidate);
 const r=candidate.latestReceipt||{};
 let status="APPROVAL_REPORTED_NOT_INDEPENDENTLY_VERIFIED";
 if(fill)status=fill.journal?.status==="MATCHED"?(fill.journal?.ackStatus==="JOURNAL_COMPLETE"?"FILLED_JOURNALED":"FILLED_JOURNAL_RECORD_MATCHED_ACK_UNVERIFIED"):"FILLED_JOURNAL_UNKNOWN";
 else if(r.orderCreated===true)status="ORDER_REPORTED_NO_INDEPENDENT_FILL";
 else if(r.skipReason)status="APPROVAL_REPORTED_SKIPPED";
 else if(r.rejectReason)status="APPROVAL_REPORTED_REJECTED";
 return {schemaVersion:"engine12.latestApprovedPaperVerification.v1",date:daily?.date??attempts?.date??null,status,dailyVerdict:daily?.verdict??"UNKNOWN",
  reported:{strategyId:candidate.strategyId,candidateId:candidate.candidateId,planId:candidate.planId,firstObservedApprovalTime:candidate.firstObservedApprovalTime,lastObservedCycleTime:candidate.lastObservedCycleTime,attemptCount:candidate.attemptCount,outcome:candidate.outcome,skipReason:r.skipReason??null,rejectReason:r.rejectReason??null,blockers:r.blockers??[],orderCreated:r.orderCreated??null,orderId:r.orderId??null,journalAckStatus:r.journalAckStatus??null,approvalSnapshotTime:r.approvalSnapshotTime??null,approvalSnapshotHash:r.approvalSnapshotHash??null,evidenceKind:r.evidenceKind??null},
  independent:{approvalReplay:approvalReplay??{status:"UNKNOWN",reason:"NOT_CHECKED"},fill:fill??null,journal:fill?.journal??null},
  note:"Reported receipt fields are Engine8 observational evidence, not independent Engine12 certification. Fill/Journal fields are independently revalidated from durable stores."};
}
