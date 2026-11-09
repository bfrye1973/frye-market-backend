#!/usr/bin/env node
// Engine 10B — November 5–9 outage accounting acceptance.
// READS ONLY persistent Engine 10 Journal and Engine 8 observation ledger.
// No network, Schwab, writes, watermarks, restarts or replay.
import fs from "node:fs";
import crypto from "node:crypto";
import {buildRealPerformanceSections} from "../logic/journal/realPerformanceSections.js";
import {REAL_ACCOUNT_REGISTRY} from "../logic/journal/realAccountClassification.js";

const transactions=Object.freeze([
 ["135614840151","SCHWAB_0747","OPENING"],
 ["135616257481","SCHWAB_6380","OPENING"],
 ["135618152561","SCHWAB_0747","OPENING"],
 ["135638839185","SCHWAB_6380","CLOSING"],
 ["135797535329","SCHWAB_5671","CLOSING"],
 ["135796645954","SCHWAB_0747","CLOSING"],
 ["135796646336","SCHWAB_0747","CLOSING"],
 ["135797545395","SCHWAB_7727","CLOSING"]
]);
const journalFile=process.env.ENGINE10_LIVE_JOURNAL||"/var/data/replay/journal/trade-journal.json";
const ledgerFile=process.env.ENGINE8_REAL_LEDGER||"/var/data/replay/engine8-private/engine8-real-fill-observer-state.json";
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
const S=v=>String(v??"").trim().toUpperCase();
const N=v=>v===null||v===undefined||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const T=v=>v&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
const round=v=>Math.round((v+Number.EPSILON)*100)/100;
const close=(a,b,tolerance=.011)=>a!==null&&b!==null&&Math.abs(a-b)<=tolerance;
const check=(label,condition,reason)=>({check:label,status:condition?"PASS":"FAIL",...(!condition?{reason}:{})});
const results=[],warnings=[];
let raw,ledgerBytes,trades,ledger;
try{
 raw=fs.readFileSync(journalFile);
 ledgerBytes=fs.readFileSync(ledgerFile);
 const parsed=JSON.parse(raw);
 trades=Array.isArray(parsed)?parsed:parsed.trades;
 ledger=JSON.parse(ledgerBytes);
 if(!Array.isArray(trades)||!ledger||typeof ledger!=="object")throw Error("INVALID_READ_ONLY_SOURCES");
}catch(e){
 console.log(JSON.stringify({ok:false,readOnly:true,error:"UNREADABLE_PRODUCTION_JOURNAL_OR_LEDGER",reason:String(e.message||e)},null,2));
 process.exitCode=2;
}
if(trades){
 const beforeJournal=hash(raw),beforeLedger=hash(ledgerBytes);
 const real=trades.filter(x=>S(x.accountMode)==="REAL");
 const observations=Object.values(ledger.observations||ledger.records||{});
 const affected=new Map();
 const rows=[];
 for(const [id,account,effect] of transactions){
  const matches=real.flatMap(trade=>(trade.events||[])
   .filter(e=>String(e.brokerTransactionId||"")===id)
   .map(event=>({trade,event})));
  const located=matches.filter(x=>
   S(x.trade.brokerAccountLabel||x.trade.realBroker?.brokerAccountLabel)===account);
  const evidence=observations.filter(o=>
   String(o.normalizedFill?.brokerTransactionId||o.brokerTransactionId||"")===id &&
   S(o.normalizedFill?.brokerAccountLabel||o.brokerAccountLabel)===account);
  const event=located[0]?.event,trade=located[0]?.trade;
  const fill=evidence[0]?.normalizedFill||null;
  const actualContract=event?.futuresContractCode||trade?.futuresContractCode||null;
  const fields=fill?{
   quantity:close(N(event?.fillQuantity),N(fill.quantity),0),
   price:close(N(event?.price),N(fill.fillPrice)),
   timestamp:T(event?.ts)!==null&&T(event?.ts)===T(fill.fillTime),
   contract:S(actualContract)===S(fill.futuresContractCode),
   account:S(trade?.brokerAccountLabel||trade?.realBroker?.brokerAccountLabel)===S(fill.brokerAccountLabel),
   fee:close(N(event?.totalFees),N(fill.totalFees)),
   effect:S(event?.positionEffect)===effect
  }:null;
  const checks=[
   check("uniqueJournalEvent",matches.length===1&&located.length===1,
    `Expected exactly one event for ${id} in ${account}; got ${matches.length}`),
   check("positionEffect",!!event&&S(event.positionEffect)===effect,
    `Expected ${effect}`),
   {check:"independentBrokerEvidence",status:evidence.length===1&&fill?"PASS":"NOT_VERIFIED",
    ...(!(evidence.length===1&&fill)?{reason:"One matching normalized Engine 8 fill not available"}:{})},
   ...Object.entries(fields||{}).map(([key,valid])=>check(`original_${key}`,valid,`Mismatch between Journal and Engine 8 normalized fill: ${key}`))
  ];
  rows.push({transactionId:id,account,action:effect,tradeId:trade?.tradeId||null,
   journalFillQuantity:event?.fillQuantity??null,
   journalPrice:event?.price??null,journalTime:event?.ts??null,
   journalContract:actualContract,journalTotalFees:event?.totalFees??null,
   ledgerObservationCount:evidence.length,
   checks});
  if(trade)affected.set(trade.tradeId,trade);
 }
 const eventProblems=[];
 const campaignChecks=[];
 for(const trade of affected.values()){
  const contractList=trade.realBroker?.contracts||[];
  const open=contractList.filter(c=>S(c.status)==="OPEN");
  const closed=contractList.filter(c=>S(c.status)==="CLOSED");
  const brokerEvents=(trade.events||[]).filter(e=>
   ["REAL_ENTRY_FILL","REAL_SCALE_IN_FILL","REAL_PARTIAL_EXIT","REAL_FINAL_EXIT"].includes(S(e.eventType)));
  const sorted=brokerEvents.slice().sort((a,b)=>T(a.ts)-T(b.ts));
  const inventory=[];
  let reconstructedGross=0;
  let reconstructedFees=0;
  let replayValid=true;
  for(const e of sorted){
   const qty=N(e.fillQuantity);
   const price=N(e.price);
   const fee=N(e.totalFees);
   if(qty===null||qty<=0||price===null||fee===null||T(e.ts)===null){replayValid=false;break;}
   reconstructedFees+=fee;
   if(S(e.positionEffect)==="OPENING"){
    for(let i=0;i<qty;i++)inventory.push({
     price,contract:e.futuresContractCode||trade.futuresContractCode,time:e.ts,
     brokerTransactionId:e.brokerTransactionId
    });
   }else if(S(e.positionEffect)==="CLOSING"){
    for(let i=0;i<qty;i++){
     const head=inventory.shift();
     if(!head||S(head.contract)!==S(e.futuresContractCode||trade.futuresContractCode)){
      replayValid=false;break;
     }
     const multiplier=N(trade.realBroker?.dollarsPerPoint);
     if(multiplier===null||multiplier<=0){replayValid=false;break;}
     const direction=S(trade.direction);
     reconstructedGross+=(direction==="SHORT"?head.price-price:price-head.price)*multiplier;
    }
    if(!replayValid)break;
   }else{replayValid=false;break;}
  }
  const journalFees=N(trade.summary?.actualFees);
  const journalGross=N(trade.summary?.grossRealizedPnL);
  const journalNet=N(trade.summary?.netRealizedPnL);
  const contractIds=contractList.map(c=>c.contractId);
  const closingIds=closed.map(c=>c.closingBrokerTransactionId);
  const closedIdsMatch=closed.every(c=>c.closingFillTime&&
   brokerEvents.some(e=>String(e.brokerTransactionId)===String(c.closingBrokerTransactionId)&&
    S(e.positionEffect)==="CLOSING"&&T(e.ts)===T(c.closingFillTime)));
  const snapshot={
   tradeId:trade.tradeId,account:trade.brokerAccountLabel||trade.realBroker?.brokerAccountLabel,
   group:trade.performanceGroup,status:trade.status,openContracts:open.length,
   closedContracts:closed.length,remainingQty:trade.qty?.remainingQty,
   gross:journalGross,fees:journalFees,net:journalNet,
   eventCount:brokerEvents.length,
   replayGross:round(reconstructedGross),replayFees:round(reconstructedFees),
   checks:[
    check("campaignClosed",S(trade.status)==="CLOSED","Affected campaign is not CLOSED"),
    check("noOpenContracts",open.length===0&&N(trade.qty?.remainingQty)===0,"Remaining contracts present"),
    check("uniqueContractIds",contractIds.length===new Set(contractIds).size,"Duplicate contract ID"),
    check("closedContractEvidence",closedIdsMatch,"Closing broker identity/time missing or mismatched"),
    check("chronologicalReplayValid",replayValid,"Opening/closing event replay inconsistent"),
    check("FIFOClosedCount",replayValid&&inventory.length===open.length,"Open inventory disagrees with replay"),
    check("FIFO_Gross_PnL",replayValid&&close(round(reconstructedGross),journalGross),"FIFO gross differs from Journal"),
    check("FeeTotal",replayValid&&close(round(reconstructedFees),journalFees),"Execution fees differ from Journal"),
    check("NetAccounting",journalGross!==null&&journalFees!==null&&close(round(journalGross-journalFees),journalNet),
     "Campaign net not equal to gross minus fees")
   ]
  };
  campaignChecks.push(snapshot);
 }
 const historical=real.filter(t=>["SWING","INTRADAY"].includes(S(t.performanceGroup)));
 const historicalInvalid=historical.filter(t=>{
  const group=S(t.performanceGroup),acct=S(t.brokerAccountLabel||t.realBroker?.brokerAccountLabel);
  return (group==="SWING"&&acct!=="SCHWAB_0747")||
   (group==="INTRADAY"&&acct!=="SCHWAB_6380");
 });
 const incorrectlyMapped=real.filter(t=>{
  const account=S(t.brokerAccountLabel||t.realBroker?.brokerAccountLabel);
  const mapped=REAL_ACCOUNT_REGISTRY.find(x=>x.brokerAccountLabel===account);
  if(!mapped)return false;
  const group=S(t.performanceGroup);
  const entryAt=T(t.entry?.time||t.createdAt);
  const cutover=T("2026-10-22T07:00:00.000Z");
  return entryAt>=cutover && group!==mapped.strategy&&
   !["SWING","INTRADAY"].includes(group);
 });
 const report=buildRealPerformanceSections(trades);
 const all=report.allReal;
 const sectionSum=Object.values(report.sections).reduce((tot,s)=>{
  for(const k of ["campaigns","openContracts","closedContracts","grossRealized","fees","netRealized"])
   tot[k]=(tot[k]||0)+Number(s[k]||0);
  return tot;
 },{});
 const totalsChecks=[
  check("allRealGross",close(all.grossRealized,round(sectionSum.grossRealized)),"Group gross totals disagree"),
  check("allRealFees",close(all.fees,round(sectionSum.fees)),"Group fee totals disagree"),
  check("allRealNet",close(all.netRealized,round(sectionSum.netRealized)),"Group net totals disagree"),
  check("allRealCampaigns",all.campaigns===sectionSum.campaigns,"Group campaign counts disagree"),
  check("allRealClosedContracts",all.closedContracts===sectionSum.closedContracts,"Group closed contract counts disagree"),
  check("allRealOpenContracts",all.openContracts===sectionSum.openContracts,"Group open contract counts disagree"),
  check("noUnclassified",report.unknownRealCampaigns.length===0,"Unclassified REAL campaigns present"),
  check("historicalGroupIdentity",historicalInvalid.length===0,"Historical SWING or INTRADAY account mismatch"),
  check("sevenGroupIdentity",incorrectlyMapped.length===0,"Post-cutover campaign strategy mismatch")
 ];
 const txnPass=rows.every(r=>r.checks.every(c=>c.status==="PASS"));
 const fifoPass=campaignChecks.length>0&&campaignChecks.every(x=>x.checks.every(c=>c.status==="PASS"));
 const checks={
  "1_execution_identity_and_fees":txnPass?"PASS":rows.some(r=>r.checks.some(c=>c.status==="FAIL"))?"FAIL":"NOT_VERIFIED",
  "2_FIFO_realized_PnL":fifoPass?"PASS":"FAIL",
  "3_historical_SWING_INTRADAY":totalsChecks.find(x=>x.check==="historicalGroupIdentity").status==="PASS"?
   "PARTIAL_VERIFIED_CURRENT_ONLY":"FAIL",
  "4_seven_strategy_mapping":totalsChecks.find(x=>x.check==="sevenGroupIdentity").status==="PASS"?"PASS":"FAIL",
  "5_aggregate_REAL_Journal":totalsChecks.every(c=>c.status==="PASS")?"PASS":"FAIL",
  "6_dashboard_receives_update":"NOT_VERIFIED_BROWSER_RUNTIME"
 };
 const sameJournal=hash(fs.readFileSync(journalFile))===beforeJournal;
 const sameLedger=hash(fs.readFileSync(ledgerFile))===beforeLedger;
 const output={schema:"engine10b.nov9OutageAccountingAcceptance.v1",
  readOnly:true,generatedAt:new Date().toISOString(),
  journalSha256:beforeJournal,engine8LedgerSha256:beforeLedger,
  journalUnchanged:sameJournal,engine8LedgerUnchanged:sameLedger,
  productionMutations:false,checks,transactionChecks:rows,affectedCampaigns:campaignChecks,
  historical:{campaigns:historical.length,groupTotals:{
   SWING:report.sections.SWING,INTRADAY:report.sections.INTRADAY
  },accountMismatchCount:historicalInvalid.length,
   note:"Current-state preservation checked. Historical before/after file integrity requires a prior baseline backup."},
  aggregates:{journalCampaignCount:trades.length,realCampaigns:real.length,
   allReal:all,groups:report.sections,unclassified:report.unknownRealCampaigns,
   consistencyChecks:totalsChecks},
  note:"No LIVE browser/rendered-screen test is performed. Broker ledger is separate original-fill evidence; no broker API call."};
 console.log(JSON.stringify(output,null,2));
 if(!sameJournal||!sameLedger||Object.values(checks).some(v=>v==="FAIL"))process.exitCode=2;
}
