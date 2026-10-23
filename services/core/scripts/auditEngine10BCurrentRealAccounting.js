#!/usr/bin/env node
// Engine10B: read-only current REAL contracts, fee attribution, and nine-section audit.
// Cannot establish broker execution parity without independent Schwab evidence.
import fs from "node:fs";
import {buildRealPerformanceSections} from "../logic/journal/realPerformanceSections.js";
const file=process.env.ENGINE10_LIVE_JOURNAL||"/var/data/replay/journal/trade-journal.json";
const raw=JSON.parse(fs.readFileSync(file,"utf8"));
const trades=Array.isArray(raw)?raw:raw.trades;
if(!Array.isArray(trades))throw Error("EXPECTED_TRADES_ARRAY");
const real=trades.filter(t=>String(t.accountMode).toUpperCase()==="REAL");
const byAccount={};
const mixed=[];
const noClosedNet=[];
const inconsistencies=[];
const idset=new Set();
for(const t of real){
 const acct=t.brokerAccountLabel||t.realBroker?.brokerAccountLabel||"UNKNOWN";
 const contracts=t.realBroker?.contracts||[];
 const code=t.realBroker?.futuresContractCode||t.entry?.futuresContractCode||
   contracts[0]?.futuresContractCode||"UNKNOWN";
 const direction=t.direction||t.identity?.direction||"UNKNOWN";
 const key=[acct,code,direction].join("|");
 const slot=byAccount[key]??={account:acct,contract:code,direction,open:0,closed:0,
   remainingEntries:[],campaignIds:[]};
 slot.campaignIds.push(t.tradeId);
 let open=0,closed=0;
 for(const c of contracts){
  if(idset.has(c.contractId))inconsistencies.push({reason:"DUPLICATE_CONTRACT_ID",tradeId:t.tradeId});
  idset.add(c.contractId);
  if(c.status==="OPEN"){
   slot.open++;open++;
   const price=Number(c.entryPrice);
   if(Number.isFinite(price))slot.remainingEntries.push(price);
  }else if(c.status==="CLOSED"){
   slot.closed++;closed++;
   if(!Number.isFinite(Number(c.netRealizedPnL))&&!Number.isFinite(Number(c.netPnL)))
     noClosedNet.push({tradeId:t.tradeId,contractId:c.contractId});
  }
 }
 if(Number(t.qty?.remainingQty)!==open)inconsistencies.push({
  reason:"OPEN_QTY_MISMATCH",tradeId:t.tradeId,reported:t.qty?.remainingQty,contracts:open});
 if(open&&closed)mixed.push({tradeId:t.tradeId,account:acct,
  closed,open,gross:t.summary?.grossRealizedPnL,
  totalIncurredFees:t.summary?.actualFees,
  campaignNet:t.summary?.netRealizedPnL});
}
const inventory=Object.values(byAccount).map(x=>({
 account:x.account,contract:x.contract,direction:x.direction,
 open:x.open,closed:x.closed,
 weightedEntry:x.remainingEntries.length?x.remainingEntries.reduce((a,b)=>a+b,0)/x.remainingEntries.length:null
}));
const sections=buildRealPerformanceSections(trades);
const out={schema:"engine10b.currentRealAccountingReadOnlyAudit.v1",readOnly:true,
 campaignCount:trades.length,realCampaigns:real.length,
 inventory,openAndClosedCampaigns:mixed,
 closedContractsWithoutExplicitNetOutcome:noClosedNet,
 inconsistencies,reporting:{
  sections:Object.fromEntries(Object.entries(sections.sections).map(([k,v])=>[k,{
   campaigns:v.campaigns,open:v.openContracts,closed:v.closedContracts,
   gross:v.grossRealized,fees:v.fees,net:v.netRealized}])),
  allReal:sections.allReal,unclassified:sections.unknownRealCampaigns
 },note:"Schwab position endpoint is not authoritative; OPEN inventory here is Journal-derived."};
console.log(JSON.stringify(out,null,2));
