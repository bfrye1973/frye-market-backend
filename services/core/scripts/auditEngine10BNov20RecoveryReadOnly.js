#!/usr/bin/env node
// Engine 10B November 20 read-only recovery acceptance. Never calls Schwab,
// creates orders, replays transactions, or writes Journal/watermark state.
// Source: Engine 8 Manager Issue #278 comment 7048702843.
import fs from "node:fs";
import crypto from "node:crypto";
import { buildRealPerformanceSections, realCampaignPerformanceGroup } from "../logic/journal/realPerformanceSections.js";

const JOURNAL=process.env.ENGINE10_LIVE_JOURNAL || "/var/data/replay/journal/trade-journal.json";
const LEDGER=process.env.ENGINE8_REAL_LEDGER || "/var/data/replay/engine8-private/engine8-real-fill-observer-state.json";
const TRXS=[
 ["136461393961","SCHWAB_6380","MESZ26","OPENING",2],
 ["136473842155","SCHWAB_6380","MESZ26","CLOSING",1],
 ["136473843797","SCHWAB_6380","MESZ26","CLOSING",1],
 ["136726990814","SCHWAB_6380","MESZ26","OPENING",1],
 ["136729425654","SCHWAB_6380","MESZ26","CLOSING",1],
 ["136853987291","SCHWAB_6380","MESZ26","OPENING",1],
 ["136853987293","SCHWAB_6380","MESH27","OPENING",1],
 ["136496734877","SCHWAB_0747","MESZ26","OPENING",1],
 ["136502493874","SCHWAB_0747","MESZ26","CLOSING",1],
 ["136574836229","SCHWAB_0747","MESZ26","OPENING",2],
 ["136593351127","SCHWAB_0747","MESZ26","CLOSING",2],
 ["136631816801","SCHWAB_0747","MESZ26","OPENING",1],
 ["136631816810","SCHWAB_0747","MESZ26","CLOSING",1],
 ["136659946487","SCHWAB_0747","MESZ26","OPENING",2],
 ["136679341185","SCHWAB_0747","MESZ26","CLOSING",2],
 ["136690669957","SCHWAB_0747","MESZ26","OPENING",2],
];
const expectedOpen=[
 ["SCHWAB_6380","MESH27",1,"TRD-MES-schwab_real_broker-2026-11-19T18-50-08+0000-3b3e"],
 ["SCHWAB_6380","MESZ26",1,"TRD-MES-schwab_real_broker-2026-11-19T18-50-08+0000-5b7c"],
 ["SCHWAB_0747","MESZ26",2,"TRD-MES-schwab_real_broker-2026-11-18T16-20-34+0000-ed5a"],
 ["SCHWAB_5671","MESZ26",1,"TRD-MES-schwab_real_broker-2026-11-13T16-04-50+0000-1a8e"],
 ["SCHWAB_2888","MESZ26",1,"TRD-MES-schwab_real_broker-2026-10-29T17-14-33+0000-3d3d"],
 ["SCHWAB_3914","MESZ26",1,"TRD-MES-schwab_real_broker-2026-10-22T06-29-15+0000-d892"],
];
const reg={SCHWAB_0747:"SUBMICRO",SCHWAB_6380:"MICRO",SCHWAB_7727:"SUBMINUTE",SCHWAB_3914:"MINUTE",SCHWAB_5671:"MINOR",SCHWAB_2888:"INTERMEDIATE",SCHWAB_0144:"PRIMARY"};
const execTypes=new Set(["REAL_ENTRY_FILL","REAL_SCALE_IN_FILL","REAL_PARTIAL_EXIT","REAL_FINAL_EXIT"]);
const S=v=>String(v??"").trim().toUpperCase();
const N=v=>v===null||v===undefined||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const P=v=>{let t=Date.parse(String(v??""));return Number.isFinite(t)?t:null};
const eq=(a,b)=>a!==null&&b!==null&&Math.abs(a-b)<.011;
const round=v=>Math.round((v+Number.EPSILON)*100)/100;
const hash=v=>crypto.createHash("sha256").update(v).digest("hex");
const getAcct=t=>S(t?.brokerAccountLabel||t?.realBroker?.brokerAccountLabel);
const group=t=>S(realCampaignPerformanceGroup(t));
const assess=(label,passed,details={})=>({label,status:passed?"PASS":"FAIL",...details});
const countOpen=t=>(t?.realBroker?.contracts||[]).filter(c=>S(c.status)==="OPEN").length;
const events=t=>(t.events||[]).filter(e=>execTypes.has(S(e.eventType)));
let journalBytes,ledgerBytes,trades,ledger;
try {
 journalBytes=fs.readFileSync(JOURNAL);
 ledgerBytes=fs.readFileSync(LEDGER);
 const doc=JSON.parse(journalBytes);
 trades=Array.isArray(doc)?doc:doc?.trades;
 ledger=JSON.parse(ledgerBytes);
 if(!Array.isArray(trades)||!ledger||typeof ledger!=="object")throw Error("INVALID_SOURCE_SCHEMA");
} catch(e) {
 console.error(JSON.stringify({readOnly:true,status:"HOLD",error:"CANNOT_READ_JOURNAL_OR_LEDGER",reason:String(e.message||e)},null,2));
 process.exit(2);
}
const journalHash=hash(journalBytes),ledgerHash=hash(ledgerBytes);
const real=trades.filter(t=>S(t.accountMode)==="REAL");
const observations=Object.values(ledger.observations||ledger.records||{});
const identity=[];
for(const [tx,acct,contract,effect,qty] of TRXS){
 const matches=real.flatMap(t=>events(t).filter(e=>String(e.brokerTransactionId??"")===tx).map(e=>({t,e})));
 const obs=observations.filter(o=>String(o.normalizedFill?.brokerTransactionId||o.brokerTransactionId||"")===tx &&
  S(o.normalizedFill?.brokerAccountLabel||o.brokerAccountLabel)===acct);
 const row=matches[0]||{}, e=row.e, t=row.t;
 const f=obs[0]?.normalizedFill||null;
 const checks=[
  assess("uniqueExecution",matches.length===1,{count:matches.length}),
  assess("ledgerOne",obs.length===1&&obs[0]?.delivered===true,{count:obs.length,deliveryStatus:obs[0]?.deliveryStatus||null}),
  assess("account",getAcct(t)===acct),
  assess("contract",S(e?.futuresContractCode||t?.futuresContractCode)===contract),
  assess("effect",S(e?.positionEffect)===effect),
  assess("quantity",N(e?.fillQuantity)===qty),
  assess("ledgerQuantity",!!f&&N(f.quantity)===qty&&N(f.quantity)===N(e?.fillQuantity)),
  assess("ledgerContract",!!f&&S(f.futuresContractCode)===contract),
  assess("ledgerEffect",!!f&&S(f.positionEffect)===effect),
  assess("ledgerTime",!!f&&P(f.fillTime)!==null&&P(f.fillTime)===P(e?.ts)),
  assess("ledgerPrice",!!f&&eq(N(f.fillPrice),N(e?.price))),
  assess("ledgerFees",!!f&&eq(N(f.totalFees),N(e?.totalFees))),
 ];
 identity.push({transactionId:tx,account:acct,contract,effect,quantity:qty,
  tradeId:t?.tradeId||null,fillPrice:e?.price??null,fillTime:e?.ts??null,
  fees:e?.totalFees??null,status:checks.every(c=>c.status==="PASS")?"PASS":"FAIL",
  checks:checks.filter(c=>c.status!=="PASS")});
}
const affectedIds=new Set(identity.map(x=>x.tradeId).filter(Boolean));
const campaigns=[];
for(const t of real.filter(t=>affectedIds.has(t.tradeId))){
 const es=events(t).slice().sort((a,b)=>P(a.ts)-P(b.ts));
 let fifo=[],gross=0,fees=0,valid=true,closeEvidence=true,allFeesPresent=true;
 const multiplier=N(t.realBroker?.dollarsPerPoint);
 for(const e of es){
  const q=N(e.fillQuantity),price=N(e.price),fee=N(e.totalFees),effect=S(e.positionEffect),contract=S(e.futuresContractCode||t.futuresContractCode);
  if(!Number.isSafeInteger(q)||q<=0||price===null||P(e.ts)===null){valid=false;break;}
  if(fee===null){allFeesPresent=false;}else fees+=fee;
  if(effect==="OPENING"){
   for(let k=0;k<q;k++)fifo.push({price,contract,tx:e.brokerTransactionId});
  }else if(effect==="CLOSING"){
   for(let k=0;k<q;k++){
    const lot=fifo.shift();
    if(!lot||lot.contract!==contract||multiplier===null){valid=false;break;}
    gross+=(S(t.direction)==="SHORT"?lot.price-price:price-lot.price)*multiplier;
   }
   if(!valid)break;
  }else{valid=false;break;}
 }
 const contracts=t.realBroker?.contracts||[];
 const actualOpen=contracts.filter(c=>S(c.status)==="OPEN");
 const closed=contracts.filter(c=>S(c.status)==="CLOSED");
 closeEvidence=closed.every(c=>c.closingBrokerTransactionId&&c.closingFillTime&&
  es.some(e=>S(e.positionEffect)==="CLOSING"&&
   String(e.brokerTransactionId)===String(c.closingBrokerTransactionId)&&P(e.ts)===P(c.closingFillTime)));
 const checks=[
  assess("fifoValid",valid),
  assess("uniqueContractIds",contracts.length===new Set(contracts.map(c=>c.contractId)).size),
  assess("contractCounts",fifo.length===actualOpen.length&&N(t.qty?.remainingQty)===actualOpen.length),
  assess("fifoMonthInventory",valid&&fifo.every((x,i)=>S(actualOpen[i]?.futuresContractCode||t.futuresContractCode)===x.contract)),
  assess("closingEvidence",closeEvidence),
  assess("grossFIFO",valid&&eq(round(gross),N(t.summary?.grossRealizedPnL)),{replayGross:round(gross),journalGross:t.summary?.grossRealizedPnL??null}),
  assess("feeAccounting",allFeesPresent&&eq(round(fees),N(t.summary?.actualFees)),{replayFees:round(fees),journalFees:t.summary?.actualFees??null}),
  assess("netAccounting",eq(round(gross-fees),N(t.summary?.netRealizedPnL))),
 ];
 campaigns.push({tradeId:t.tradeId,account:getAcct(t),contract:t.futuresContractCode||null,
  group:group(t),status:t.status,openContracts:actualOpen.length,closedContracts:closed.length,
  gross:t.summary?.grossRealizedPnL??null,fees:t.summary?.actualFees??null,
  net:t.summary?.netRealizedPnL??null,statusCheck:checks.every(c=>c.status==="PASS")?"PASS":"FAIL",
  exceptions:checks.filter(c=>c.status!=="PASS")});
}
const open=real.filter(t=>S(t.status)==="OPEN"||countOpen(t)>0);
const opens=expectedOpen.map(([acct,contract,qty,tradeId])=>{
 const same=real.filter(t=>t.tradeId===tradeId);
 const t=same[0];
 const contracts=(t?.realBroker?.contracts||[]).filter(c=>S(c.status)==="OPEN");
 const monthCounts=contracts.reduce((a,c)=>{const m=S(c.futuresContractCode||t.futuresContractCode);a[m]=(a[m]||0)+1;return a},{});
 const checks=[assess("uniqueTradeId",same.length===1),
  assess("account",getAcct(t)===acct),
  assess("contractQuantity",monthCounts[contract]===qty&&contracts.length===qty),
  assess("status",S(t?.status)==="OPEN"),
  assess("remainingQty",N(t?.qty?.remainingQty)===qty),
  assess("strategy",group(t)===reg[acct]||["SWING","INTRADAY"].includes(group(t))&&
   ((acct==="SCHWAB_0747"&&group(t)==="SWING")||(acct==="SCHWAB_6380"&&group(t)==="INTRADAY"))),
  assess("uniqueOpenContractIds",contracts.length===new Set(contracts.map(c=>c.contractId)).size)];
 return {tradeId,account:acct,contract,expectedJournalOpen:qty,
  observedJournalOpen:contracts.length,group:group(t),entryPrice:t?.entry?.price??null,
  checks:checks.filter(c=>c.status!=="PASS"),status:checks.every(c=>c.status==="PASS")?"PASS":"FAIL",
  brokerPositionStatus:"NOT_VERIFIED"};
});
const overall=buildRealPerformanceSections(trades);
const expectedSet=new Set(expectedOpen.map(x=>x[3]));
const extras=open.filter(t=>!expectedSet.has(t.tradeId)).map(t=>({tradeId:t.tradeId,account:getAcct(t),qty:countOpen(t)}));
const totalOpen=real.reduce((s,t)=>s+countOpen(t),0);
const groups=Object.entries(reg).map(([account,strategy])=>({account,strategy,
 totalRealCampaigns:real.filter(t=>getAcct(t)===account).length,
 openContracts:real.filter(t=>getAcct(t)===account).reduce((s,t)=>s+countOpen(t),0)}));
const historical=real.filter(t=>["SWING","INTRADAY"].includes(group(t)));
const errors=identity.filter(x=>x.status!=="PASS").length+campaigns.filter(x=>x.statusCheck!=="PASS").length+
 opens.filter(x=>x.status!=="PASS").length+extras.length+(totalOpen!==7?1:0);
const unchanged=hash(fs.readFileSync(JOURNAL))===journalHash&&hash(fs.readFileSync(LEDGER))===ledgerHash;
const result={schema:"engine10b.nov20RecoveryAccountingReadOnly.v1",generatedAt:new Date().toISOString(),
 readOnly:true,productionMutations:false,originalsUnchanged:unchanged,
 journalSha256:journalHash,engine8LedgerSha256:ledgerHash,
 status:errors===0&&unchanged?"JOURNAL_LEDGER_PASS_BROKER_HOLDINGS_HOLD":"JOURNAL_LEDGER_HOLD",
 counts:{recoveredTransactions:TRXS.length,transactionsPassed:identity.filter(x=>x.status==="PASS").length,
 affectedCampaigns:campaigns.length,campaignsPassed:campaigns.filter(x=>x.statusCheck==="PASS").length,
 journalOpenCampaigns:open.length,journalOpenContracts:totalOpen,unexplainedOpenCampaigns:extras.length},
 recoveredTransactions:identity,affectedCampaigns:campaigns,
 journalOpenCampaigns:opens,extraJournalOpenCampaigns:extras,
 sevenStrategyGroups:groups,historicalCampaigns:historical.length,
 allReal:overall.allReal,unclassified:overall.unknownRealCampaigns,
 brokerComparison:{status:"HOLD",reason:"Independent current Schwab position, statement, forced-margin-liquidation and transaction evidence NOT PROVIDED by the two local files. Do not infer from Journal or recovery window."},
 dashboardVisualVerification:"NOT_VERIFIED",
 cautions:["No broker API called; actual current positions, mark-to-market/unrealized P&L and forced liquidations not independently verified",
 "No transaction replay, dedupe reset, watermarks movement, broker order or Journal write",
 "Hold any live exposure decisions until independently verified on Schwab"]};
console.log(JSON.stringify(result,null,2));
if(errors||!unchanged)process.exitCode=2;
