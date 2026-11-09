import test from "node:test";
import assert from "node:assert/strict";
import {OCT29_TARGETS,planOct29Recovery} from "../logic/journal/oct29ChronologicalRecoveryPlan.js";
function fixture(){
 const trades=[],observations={};
 for(const t of OCT29_TARGETS){
  const entry={broker:"SCHWAB",source:"SCHWAB_BROKER_FILL",eventType:"REAL_ENTRY_FILL",
   ts:t.account==="SCHWAB_0747"?"2026-10-29T13:42:25.000Z":"2026-10-29T13:42:10.000Z",
   brokerTransactionId:t.later,fillQuantity:1,price:t.account==="SCHWAB_0747"?7744:7744.25,
   commission:2.25,futuresExchangeFee:.35,otherFees:0,totalFees:2.6,
   positionEffect:"OPENING",remainingQty:1,readOnlyBrokerObservation:true};
  const id=t.tradeId+"|CTR|"+t.later+"|1";
  const contract={contractId:id,tradeId:t.tradeId,status:"OPEN",direction:"LONG",
   futuresContractCode:t.contract,openingBrokerTransactionId:t.later,entryPrice:entry.price,
   openingFillTime:entry.ts,brokerAccountLabel:t.account};
  const lot={contractId:id,brokerTransactionId:t.later,futuresContractCode:t.contract,
   fillTime:entry.ts,price:entry.price,qty:1};
  trades.push({tradeId:t.tradeId,accountMode:"REAL",brokerAccountLabel:t.account,
   direction:"LONG",status:"OPEN",performanceGroup:t.account==="SCHWAB_0747"?"SUBMICRO":"MICRO",
   futuresContractCode:t.contract,entry:{time:entry.ts,price:entry.price,qty:1},
   realBroker:{brokerAccountLabel:t.account,futuresContractCode:t.contract,
    remainingLots:[lot],contracts:[contract]},
   brokerImport:{remainingLots:[structuredClone(lot)],contracts:[structuredClone(contract)],
    remainingAverageEntry:entry.price,actualFees:2.6,netRealizedTradePnL:-2.6},
   events:[entry],updatedAt:entry.ts,qty:{originalQty:1,remainingQty:1,
    cumulativeOpeningQuantity:1,cumulativeFilledQuantity:1,cumulativeExitQuantity:0},
   summary:{actualFees:2.6,actualCommission:2.25,futuresExchangeFees:.35,otherBrokerFees:0,
    netRealizedPnL:-2.6,grossRealizedPnL:0}});
  observations[t.missing]={delivered:false,normalizedFill:{
   source:"SCHWAB_BROKER_FILL",broker:"SCHWAB",brokerAccountLabel:t.account,
   brokerTransactionId:t.missing,positionEffect:"OPENING",side:"BUY",direction:"LONG",
   futuresContractCode:t.contract,fillTime:t.at,fillPrice:t.price,quantity:1,
   commission:2.25,futuresExchangeFee:.35,otherFees:0,totalFees:2.6}};
 }
 trades.push({tradeId:"HISTORICAL_UNRELATED",accountMode:"REAL",
   summary:{actualFees:999},events:[]});
 return {trades,ledger:{observations}};
}
test("isolated candidate adds exactly two chronological lots without touching original",()=>{
 const {trades,ledger}=fixture(),before=structuredClone(trades);
 const out=planOct29Recovery(trades,ledger);
 assert.equal(out.ok,true,JSON.stringify(out.errors));
 assert.deepEqual(trades,before);
 assert.equal(out.details.length,2);
 assert.deepEqual(out.candidate[2],trades[2]);
 for(let i=0;i<2;i++){
  const c=out.candidate[i],b=trades[i],t=OCT29_TARGETS[i];
  assert.equal(c.tradeId,b.tradeId);
  assert.deepEqual(c.realBroker.contracts.map(x=>x.openingBrokerTransactionId),[t.missing,t.later]);
  assert.deepEqual(c.events.map(x=>x.brokerTransactionId),[t.missing,t.later]);
  assert.equal(c.qty.remainingQty,2);
  assert.equal(c.summary.actualFees,5.2);
  assert.equal(c.summary.netRealizedPnL,-5.2);
  assert.equal(c.realBroker.remainingLots[0].price,t.price);
  assert.equal(c.entry.time,b.entry.time);
 }
});
test("blocks missing broker proof and any closed inventory",()=>{
 const {trades,ledger}=fixture();
 delete ledger.observations[OCT29_TARGETS[0].missing];
 assert.equal(planOct29Recovery(trades,ledger).ok,false);
 const f=fixture();
 f.trades[0].events.push({eventType:"REAL_PARTIAL_EXIT",ts:"2026-10-29T13:50:00Z"});
 assert.equal(planOct29Recovery(f.trades,f.ledger).ok,false);
});
test("blocks mismatched price and duplicate fills",()=>{
 const f=fixture();
 f.ledger.observations[OCT29_TARGETS[0].missing].normalizedFill.fillPrice=7000;
 assert.equal(planOct29Recovery(f.trades,f.ledger).ok,false);
 const g=fixture();
 g.trades[0].events.push({...g.trades[0].events[0],brokerTransactionId:OCT29_TARGETS[0].missing});
 assert.equal(planOct29Recovery(g.trades,g.ledger).ok,false);
});
