#!/usr/bin/env node
// Engine 10B Nov 9–10 (Arizona) read-only broker observer <-> Journal audit.
// Read only: no token refresh, Schwab API, Journal writes, watermark updates, or replay.
import fs from "node:fs";
import crypto from "node:crypto";
import {buildRealPerformanceSections} from "../logic/journal/realPerformanceSections.js";

const PATH_J=process.env.ENGINE10_LIVE_JOURNAL||"/var/data/replay/journal/trade-journal.json";
const PATH_E=process.env.ENGINE8_REAL_LEDGER||"/var/data/replay/engine8-private/engine8-real-fill-observer-state.json";
const START="2026-11-09T07:00:00.000Z"; // Arizona Nov 9 00:00
const END="2026-11-11T07:00:00.000Z";   // Arizona Nov 11 00:00 (exclusive)
const WATCH=["SCHWAB_0747","SCHWAB_6380","SCHWAB_5671"];
const ACCOUNTS=[
 ["SCHWAB_0747","SUBMICRO"],["SCHWAB_6380","MICRO"],["SCHWAB_7727","SUBMINUTE"],
 ["SCHWAB_3914","MINUTE"],["SCHWAB_5671","MINOR"],
 ["SCHWAB_2888","INTERMEDIATE"],["SCHWAB_0144","PRIMARY"]
];
const up=x=>String(x??"").trim().toUpperCase();
const hash=x=>crypto.createHash("sha256").update(x).digest("hex");
const validTime=x=>{const n=Date.parse(x||"");return Number.isFinite(n)?n:null;};
const inside=x=>{const t=validTime(x);return t!==null&&t>=Date.parse(START)&&t<Date.parse(END);};
const qty=x=>{const n=Number(x);return Number.isFinite(n)?n:null;};
const eq=(a,b)=>a!==null&&b!==null&&Math.abs(a-b)<.011;
const exe=new Set(["REAL_ENTRY_FILL","REAL_SCALE_IN_FILL","REAL_PARTIAL_EXIT","REAL_FINAL_EXIT"]);
let jBytes,eBytes,trades,ledger;
try{
 jBytes=fs.readFileSync(PATH_J);eBytes=fs.readFileSync(PATH_E);
 const doc=JSON.parse(jBytes);trades=Array.isArray(doc)?doc:doc?.trades;
 ledger=JSON.parse(eBytes);
 if(!Array.isArray(trades))throw Error("EXPECTED_JOURNAL_TRADES_ARRAY");
 if(!(ledger.observations||ledger.records))throw Error("EXPECTED_LEDGER_OBSERVATIONS");
}catch(e){
 console.error(JSON.stringify({ok:false,readOnly:true,error:String(e.message||e)}));
 process.exitCode=2;
}
if(trades){
 const ledgerRows=Object.values(ledger.observations||ledger.records||{})
   .map(o=>({...o,fill:o.normalizedFill||null}))
   .filter(o=>inside(o.fill?.fillTime||o.fillTime));
 const journalRows=trades.filter(t=>up(t.accountMode)==="REAL").flatMap(t=>
  (t.events||[]).filter(e=>exe.has(up(e.eventType))&&inside(e.ts))
   .map(e=>({trade:t,event:e})));
 const makeKey=(account,id,leg)=>[up(account),String(id||""),String(leg||"")].join("|");
 const journalMap=new Map();
 for(const row of journalRows){
  const e=row.event,t=row.trade;
  const key=makeKey(t.brokerAccountLabel||t.realBroker?.brokerAccountLabel,
   e.brokerTransactionId,e.brokerFillLegId);
  if(!journalMap.has(key))journalMap.set(key,[]);
  journalMap.get(key).push(row);
 }
 const observationMap=new Map();
 for(const o of ledgerRows){
  const f=o.fill||o;
  const key=makeKey(f.brokerAccountLabel||o.brokerAccountLabel,
   f.brokerTransactionId||o.brokerTransactionId,
   f.brokerFillLegId||o.brokerFillLegId);
  if(!observationMap.has(key))observationMap.set(key,[]);
  observationMap.get(key).push(o);
 }
 const accounts=ACCOUNTS.map(([account,strategy])=>{
  const observed=ledgerRows.filter(o=>up(o.fill?.brokerAccountLabel||o.brokerAccountLabel)===account);
  const executed=journalRows.filter(r=>up(r.trade.brokerAccountLabel||r.trade.realBroker?.brokerAccountLabel)===account);
  const missing=observed.filter(o=>{
   const f=o.fill||o;
   return !journalMap.has(makeKey(account,f.brokerTransactionId||o.brokerTransactionId,
    f.brokerFillLegId||o.brokerFillLegId));
  });
  const journalWithoutLedger=executed.filter(r=>
   !observationMap.has(makeKey(account,r.event.brokerTransactionId,r.event.brokerFillLegId)));
  const detail=observed.map(o=>{
   const f=o.fill||o;
   const key=makeKey(account,f.brokerTransactionId||o.brokerTransactionId,
    f.brokerFillLegId||o.brokerFillLegId);
   const match=journalMap.get(key)||[];
   const e=match[0]?.event;
   const fields=e?{
    qty:eq(qty(f.quantity),qty(e.fillQuantity)),
    price:eq(qty(f.fillPrice),qty(e.price)),
    time:validTime(f.fillTime)===validTime(e.ts),
    contract:up(f.futuresContractCode)===up(e.futuresContractCode),
    fees:eq(qty(f.totalFees),qty(e.totalFees)),
    effect:up(f.positionEffect)===up(e.positionEffect)
   }:null;
   return {transactionId:String(f.brokerTransactionId||o.brokerTransactionId||""),
    brokerFillLegId:f.brokerFillLegId||null,at:f.fillTime||o.fillTime,
    effect:f.positionEffect,price:f.fillPrice,quantity:f.quantity,
    fees:f.totalFees,delivered:o.delivered,deliveryStatus:o.deliveryStatus,
    lastError:o.lastError||null,matchingExecutionEvents:match.length,
    checks:fields};
  });
  const current=trades.filter(t=>up(t.accountMode)==="REAL"&&
   up(t.brokerAccountLabel||t.realBroker?.brokerAccountLabel)===account);
  const open=current.flatMap(t=>(t.realBroker?.contracts||[]).filter(c=>up(c.status)==="OPEN")
   .map(c=>({tradeId:t.tradeId,contractId:c.contractId,symbol:c.futuresContractCode,
    entryPrice:c.entryPrice,entryTime:c.openingFillTime,performanceGroup:t.performanceGroup})));
  return {account,strategy,brokerLedgerFillsInWindow:observed.length,
   journalExecutionEventsInWindow:executed.length,
   missingFromJournal:missing.map(o=>({transactionId:o.fill?.brokerTransactionId||o.brokerTransactionId,
    fillTime:o.fill?.fillTime||o.fillTime,positionEffect:o.fill?.positionEffect,
    delivered:o.delivered,deliveryStatus:o.deliveryStatus,lastError:o.lastError||null})),
   journalWithoutEngine8Ledger:journalWithoutLedger.map(r=>({tradeId:r.trade.tradeId,
    transactionId:r.event.brokerTransactionId,at:r.event.ts,effect:r.event.positionEffect})),
   deliveredButNotJournaled:missing.filter(x=>x.delivered===true).length,
   unacknowledged:observed.filter(x=>x.delivered!==true).length,
   mismatched:detail.filter(d=>d.matchingExecutionEvents!==1||
    (d.checks&&Object.values(d.checks).some(x=>!x))),
   observedTransactions:detail,
   currentOpenContracts:open.length,open};
 });
 const allReal=buildRealPerformanceSections(trades);
 const extra=accounts.filter(a=>a.missingFromJournal.length||a.mismatched.length||
  a.deliveredButNotJournaled||a.unacknowledged);
 const unchanged=hash(fs.readFileSync(PATH_J))===hash(jBytes)&&hash(fs.readFileSync(PATH_E))===hash(eBytes);
 console.log(JSON.stringify({
  schema:"engine10b.nov9Nov10ReadOnlyReconciliation.v1",readOnly:true,
  windowArizona:"2026-11-09 00:00 through 2026-11-10 23:59:59",
  windowUtcStart:START,windowUtcEndExclusive:END,
  generatedAt:new Date().toISOString(),
  counts:{journalCampaigns:trades.length,ledgerWindow:ledgerRows.length,
   journalExecutionWindow:journalRows.length,accountsWithDiscrepancies:extra.length},
  summary:accounts.map(({account,strategy,brokerLedgerFillsInWindow,journalExecutionEventsInWindow,
    missingFromJournal,deliveredButNotJournaled,unacknowledged,mismatched,currentOpenContracts})=>({
    account,strategy,brokerLedgerFillsInWindow,journalExecutionEventsInWindow,
    missing:missingFromJournal.length,deliveredButNotJournaled,unacknowledged,
    mismatched:mismatched.length,currentOpenContracts})),
  criticalAccounts:accounts.filter(a=>WATCH.includes(a.account)),
  otherAccountDiscrepancies:accounts.filter(a=>!WATCH.includes(a.account)&&(
   a.missingFromJournal.length||a.mismatched.length||a.unacknowledged)),
  allReal:allReal.allReal,
  unclassified:allReal.unknownRealCampaigns,
  journalSha256:hash(jBytes),ledgerSha256:hash(eBytes),
  originalsUnchanged:unchanged,
  caveat:"A missing transaction from BOTH the Schwab observer ledger and Engine10 Journal cannot be detected by this audit. Engine8 must compare exact broker transaction history across the full two-day window. No OAuth requests made."
 },null,2));
 if(!unchanged||extra.length)process.exitCode=2;
}
