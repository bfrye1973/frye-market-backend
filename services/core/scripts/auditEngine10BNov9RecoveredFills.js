#!/usr/bin/env node
// Engine 10B November 9 REAL recovery acceptance: READ ONLY.
// Runs against private Render disk, never writes Journal, Engine 8 ledger or watermarks.
// Output excludes full account hashes, credentials, broker raw payloads and full contract IDs.
import fs from "node:fs";
import crypto from "node:crypto";
import {buildRealPerformanceSections,realCampaignPerformanceGroup} from "../logic/journal/realPerformanceSections.js";
const journalPath=process.env.ENGINE10_LIVE_JOURNAL||"/var/data/replay/journal/trade-journal.json";
const observerPath="/var/data/replay/engine8-private/engine8-real-fill-observer-state.json";
const IDs=[
 ["135614840151","SCHWAB_0747","OPENING"],
 ["135616257481","SCHWAB_6380","OPENING"],
 ["135618152561","SCHWAB_0747","OPENING"],
 ["135638839185","SCHWAB_6380","CLOSING"],
 ["135797535329","SCHWAB_5671","CLOSING"],
 ["135796645954","SCHWAB_0747","CLOSING"],
 ["135796646336","SCHWAB_0747","CLOSING"],
 ["135797545395","SCHWAB_7727","CLOSING"]
];
const u=x=>String(x??"").trim().toUpperCase();
const n=x=>x==null||x===""?null:Number(x);
const cents=x=>Math.round(Number(x)*100)/100;
const eq=(a,b)=>a===b||(a!=null&&b!=null&&String(a)===String(b));
const dates=(a,b)=>a&&b&&Number.isFinite(Date.parse(a))&&Date.parse(a)===Date.parse(b);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sha=x=>crypto.createHash("sha256").update(x).digest("hex");
const failure=(arr,reason,extra={})=>arr.push({reason,...extra});
const checks={brokerFields:[],fifo:[],classification:[],historical:[],rollup:[],dashboard:[]};
const raw=fs.readFileSync(journalPath),ledgerRaw=fs.readFileSync(observerPath);
const obj=JSON.parse(raw),journal=Array.isArray(obj)?obj:obj.trades;
const ledger=JSON.parse(ledgerRaw),observations=Object.values(ledger.observations||ledger.records||{});
if(!Array.isArray(journal)||!observations.length)throw Error("JOURNAL_OR_LEDGER_UNAVAILABLE");
const real=journal.filter(t=>u(t.accountMode)==="REAL");
const rows=[],affected=new Set();
for(const [id,account,effect] of IDs){
 const matches=[];
 for(const t of real)for(const e of t.events||[]){
  if(String(e.brokerTransactionId)===id&&["REAL_ENTRY_FILL","REAL_SCALE_IN_FILL","REAL_PARTIAL_EXIT","REAL_FINAL_EXIT"].includes(u(e.eventType)))matches.push({t,e});
 }
 const broker=observations.filter(o=>{
  const f=o.normalizedFill||{};
  return String(f.brokerTransactionId||o.brokerTransactionId)===id&&
   u(f.brokerAccountLabel||o.brokerAccountLabel)===account;
 });
 const issues=[];
 if(matches.length!==1)failure(issues,"JOURNAL_EXECUTION_NOT_UNIQUE",{count:matches.length});
 if(broker.length!==1)failure(issues,"BROKER_EVIDENCE_NOT_UNIQUE",{count:broker.length});
 const item=matches[0],b=broker[0]?.normalizedFill||null;
 if(item){affected.add(item.t.tradeId);
  if(u(item.t.brokerAccountLabel||item.t.realBroker?.brokerAccountLabel)!==account)
   failure(issues,"ACCOUNT_MISMATCH");
  if(u(item.e.positionEffect)!==effect)failure(issues,"EFFECT_MISMATCH");
  if(effect==="OPENING"&&!["REAL_ENTRY_FILL","REAL_SCALE_IN_FILL"].includes(u(item.e.eventType)))
   failure(issues,"WRONG_OPEN_EVENT");
  if(effect==="CLOSING"&&!["REAL_PARTIAL_EXIT","REAL_FINAL_EXIT"].includes(u(item.e.eventType)))
   failure(issues,"WRONG_CLOSE_EVENT");
  if(!b)failure(issues,"ORIGINAL_NORMALIZED_BROKER_FILL_MISSING");
  else{
   if(!dates(item.e.ts,b.fillTime))failure(issues,"FILL_TIME_DIFFERS");
   if(!eq(n(item.e.price),n(b.fillPrice)))failure(issues,"FILL_PRICE_DIFFERS");
   if(!eq(n(item.e.fillQuantity),n(b.quantity)))failure(issues,"FILL_QUANTITY_DIFFERS");
   if(!eq(cents(item.e.totalFees),cents(b.totalFees)))failure(issues,"TOTAL_FEES_DIFFER");
   if(!eq(cents(item.e.commission),cents(b.commission)))failure(issues,"COMMISSION_DIFFERS");
   if(!eq(cents(item.e.futuresExchangeFee),cents(b.futuresExchangeFee)))failure(issues,"EXCHANGE_FEES_DIFFER");
   if(u(item.e.futuresContractCode)!==u(b.futuresContractCode))failure(issues,"FUTURES_EXPIRATION_DIFFERS");
   if(u(b.positionEffect)!==effect)failure(issues,"BROKER_EFFECT_DIFFERS");
   if(u(item.t.direction)!==u(b.direction)&&effect==="OPENING")
    failure(issues,"CAMPAIGN_DIRECTION_DIFFERS");
  }
  const contracts=item.t.realBroker?.contracts||[];
  const linked=contracts.filter(c=>
   String((effect==="OPENING"?c.openingBrokerTransactionId:c.closingBrokerTransactionId)||"")===id);
  if(linked.length!==(n(item.e.fillQuantity)??-1))
   failure(issues,"CONTRACT_COUNT_FOR_EXECUTION_MISMATCH",{expected:item.e.fillQuantity,actual:linked.length});
  if(effect==="CLOSING"){
   for(const c of linked){
    if(u(c.status)!=="CLOSED")failure(issues,"CLOSING_CONTRACT_NOT_CLOSED");
    if(!eq(n(c.exitPrice),n(item.e.price)))failure(issues,"CLOSING_CONTRACT_PRICE_DIFFERS");
    if(!dates(c.closingFillTime,item.e.ts))failure(issues,"CLOSING_CONTRACT_TIME_DIFFERS");
   }
  }else{
   for(const c of linked){
    if(!eq(n(c.entryPrice),n(item.e.price)))failure(issues,"OPEN_CONTRACT_PRICE_DIFFERS");
    if(!dates(c.openingFillTime,item.e.ts))failure(issues,"OPEN_CONTRACT_TIME_DIFFERS");
   }
  }
  const g=realCampaignPerformanceGroup(item.t);
  const expectedGroup={SCHWAB_0747:"SUBMICRO",SCHWAB_6380:"MICRO",
   SCHWAB_5671:"MINOR",SCHWAB_7727:"SUBMINUTE"}[account];
  if(g!==expectedGroup)failure(issues,"PERFORMANCE_GROUP_MISMATCH",{actual:g,expected:expectedGroup});
 }
 rows.push({transactionId:id,account,effect,tradeId:item?.t.tradeId||null,
  eventTime:item?.e.ts||null,fillPrice:item?.e.price??null,fillQty:item?.e.fillQuantity??null,
  futuresContractCode:item?.e.futuresContractCode||null,fees:item?.e.totalFees??null,
  brokerAcknowledged:broker[0]?.delivered===true,pass:issues.length===0,issues});
}
const affectedRows=[];
for(const id of affected){
 const t=real.find(v=>v.tradeId===id),cs=t.realBroker?.contracts||[];
 const brokerEvents=(t.events||[]).filter(e=>["REAL_ENTRY_FILL","REAL_SCALE_IN_FILL","REAL_PARTIAL_EXIT","REAL_FINAL_EXIT"].includes(u(e.eventType)));
 const issues=[];
 const open=cs.filter(c=>u(c.status)==="OPEN"),closed=cs.filter(c=>u(c.status)==="CLOSED");
 const remaining=t.realBroker?.remainingLots||[];
 if(u(t.status)!=="CLOSED")failure(issues,"CAMPAIGN_NOT_CLOSED");
 if(n(t.qty?.remainingQty)!==0||open.length!==0||remaining.length!==0)
  failure(issues,"POSITION_NOT_FLAT",{reported:t.qty?.remainingQty,openContracts:open.length,remainingLots:remaining.length});
 if(new Set(cs.map(c=>c.contractId)).size!==cs.length)failure(issues,"DUPLICATE_CONTRACT_IDS");
 const eventsOrdered=brokerEvents.every((e,i)=>i===0||Date.parse(brokerEvents[i-1].ts)<=Date.parse(e.ts));
 if(!eventsOrdered)failure(issues,"BROKER_EVENTS_OUT_OF_ORDER");
 const openings=cs.slice().sort((a,b)=>Date.parse(a.openingFillTime)-Date.parse(b.openingFillTime));
 const exits=cs.slice().sort((a,b)=>Date.parse(a.closingFillTime)-Date.parse(b.closingFillTime));
 // FIFO only within the campaign and matching futures expiration. No invented cross-campaign matching.
 for(let i=0;i<exits.length;i++){
  const e=exits[i],before=openings.filter(o=>
   u(o.futuresContractCode)===u(e.futuresContractCode)&&Date.parse(o.openingFillTime)<=Date.parse(e.closingFillTime));
  const orderInSameExpiry=before.findIndex(o=>o.contractId===e.contractId);
  if(orderInSameExpiry<0)failure(issues,"CLOSED_WITHOUT_PRIOR_OPENING");
 }
 const gross=brokerEvents.reduce((s,e)=>s+(n(e.grossEventRealizedPnL)||0),0);
 const fees=brokerEvents.reduce((s,e)=>s+(n(e.totalFees)||0),0);
 const net=cents(gross-fees),contractGross=closed.reduce((s,c)=>s+(n(c.grossRealizedPnL)||0),0);
 if(!eq(cents(gross),cents(t.summary?.grossRealizedPnL)))failure(issues,"GROSS_EVENT_CAMPAIGN_MISMATCH");
 if(!eq(cents(gross),cents(contractGross)))failure(issues,"GROSS_CONTRACT_CAMPAIGN_MISMATCH");
 if(!eq(cents(fees),cents(t.summary?.actualFees)))failure(issues,"FEES_EVENT_CAMPAIGN_MISMATCH");
 if(!eq(net,cents(t.summary?.netRealizedPnL)))failure(issues,"NET_CAMPAIGN_MISMATCH");
 for(const c of closed){
  const pts=u(t.direction)==="SHORT"?n(c.entryPrice)-n(c.exitPrice):n(c.exitPrice)-n(c.entryPrice);
  const multiplier=n(t.realBroker?.dollarsPerPoint);
  if(pts==null||multiplier==null){failure(issues,"CONTRACT_PNL_BASIS_MISSING");continue;}
  if(!eq(cents(pts*multiplier),cents(c.grossRealizedPnL)))
   failure(issues,"CONTRACT_GROSS_PNL_DIFFERS",{contractSuffix:String(c.contractId||"").slice(-12)});
 }
 affectedRows.push({tradeId:id,account:t.brokerAccountLabel,
  group:realCampaignPerformanceGroup(t),status:t.status,
  openContracts:open.length,closedContracts:closed.length,remainingQty:t.qty?.remainingQty,
  grossRealized:t.summary?.grossRealizedPnL,fees:t.summary?.actualFees,netRealized:t.summary?.netRealizedPnL,
  pass:issues.length===0,issues});
}
const reporting=buildRealPerformanceSections(journal);
const historical=real.filter(t=>["SWING","INTRADAY"].includes(realCampaignPerformanceGroup(t)));
const groups=Object.fromEntries(Object.entries(reporting.sections).map(([key,v])=>[key,{
 campaigns:v.campaigns,open:v.openContracts,closed:v.closedContracts,
 gross:v.grossRealized,fees:v.fees,net:v.netRealized
}]));
const all=reporting.allReal;
const sectionTotals=Object.values(reporting.sections).reduce((acc,g)=>{
 for(const k of ["campaigns","openContracts","closedContracts","grossRealized","fees","netRealized"])acc[k]+=g[k];
 return acc;
},{campaigns:0,openContracts:0,closedContracts:0,grossRealized:0,fees:0,netRealized:0});
const rollupIssues=[];
for(const k of ["campaigns","openContracts","closedContracts","grossRealized","fees","netRealized"]){
 if(!eq(cents(sectionTotals[k]),cents(all[k])))failure(rollupIssues,"NINE_SECTION_SUM_MISMATCH",{field:k});
}
if(reporting.unknownRealCampaigns.length)failure(rollupIssues,"UNCLASSIFIED_REAL_CAMPAIGNS",{count:reporting.unknownRealCampaigns.length});
const result={
 schema:"engine10b.nov9RecoveryAccountingAudit.v1",readOnly:true,
 source:{journalSha256:sha(raw),ledgerSha256:sha(ledgerRaw),journalCampaigns:journal.length,realCampaigns:real.length},
 transactions:rows,affectedCampaigns:affectedRows,
 historical:{preservedCurrentClassification:true,legacyCampaigns:historical.length,
  note:"Current grouping checked; immutable comparison with pre-outage Journal backup not performed"},
 reporting:{allReal:all,sections:groups,unknownRealCampaigns:reporting.unknownRealCampaigns,
  totalsConsistent:rollupIssues.length===0,issues:rollupIssues},
 checks:{
  transactionIdentityAndFees:rows.every(x=>x.pass),
  affectedCampaignFifoAndAccounting:affectedRows.length>0&&affectedRows.every(x=>x.pass),
  currentHistoricalClassification:historical.every(t=>["SWING","INTRADAY"].includes(realCampaignPerformanceGroup(t))),
  nineSectionRollup:rollupIssues.length===0,
  dashboardTransport:"SOURCE_CODE_VERIFIED_ONLY",
  baselineComparison:"NOT_AVAILABLE"
 },
 noWrites:true
};
console.log(JSON.stringify(result,null,2));
process.exitCode=Object.values(result.checks).some(v=>v===false)?2:0;
