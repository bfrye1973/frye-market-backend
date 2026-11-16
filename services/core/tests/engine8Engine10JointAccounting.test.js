// Joint Engine 8/10 isolated contract accounting verification.
// This intentionally distinguishes authoritative GROSS PAPER Journal accounting
// from an estimated commission schedule: no invented NET journal receipt.
import test,{after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"engine8-engine10-accounting-"));
process.env.TRADE_JOURNAL_DIR=dir;
const {createTradeJournalEntryFromEngine8Fill,applyEngine8ExecutionToJournal}=await import("../logic/journal/tradeJournalStore.js");
after(()=>fs.rmSync(dir,{force:true,recursive:true}));
const identity={paper:true,accountMode:"PAPER",symbol:"ES",assetType:"FUTURES",strategyId:"intraday_scalp@10m",
  candidateId:"JOINT-A",zoneId:"JOINT-Z",planId:"JOINT-PLAN",
  direction:"LONG",setupType:"NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION"};
const t0="2026-11-16T15:00:00Z";
const price={entry:100,boundary:101,midpoint:102};
const ROUND_TRIP_FEE_PER_CONTRACT=5;
const allocation={block1Contracts:1,block2Contracts:1,block3Contracts:1,totalContracts:3};
const blocks=[
 {blockId:"BLOCK_1",contractId:"CONTRACT_1",contracts:1,targetId:"T1",targetPrice:price.boundary},
 {blockId:"BLOCK_2",contractId:"CONTRACT_2",contracts:1,targetId:"T2",targetPrice:price.midpoint},
 {blockId:"BLOCK_3",contractId:"CONTRACT_3",contracts:1,targetId:"T3",targetPrice:price.midpoint}
];
const ticket={...identity,executionId:"JOINT-ENTRY-X",orderId:"JOINT-ENTRY-O",idempotencyKey:"JOINT-ENTRY-I",
  action:"NEW_ENTRY",eventType:"NEW_ENTRY",side:"BUY",fillTime:t0,fillPrice:price.entry,
  fillQuantity:3,qty:3,fillStatus:"FILLED",dollarsPerPoint:50,
  riskBudgetDollars:150,frozenOpeningRiskDollars:150,
  commissionDollarsPerContractRoundTrip:ROUND_TRIP_FEE_PER_CONTRACT,
  officialEntryPrice:100,officialStopPrice:99,officialStopDistancePoints:1,
  officialTargets:[{targetId:"T1",price:101},{targetId:"T2",price:102},{targetId:"T3",price:102}],
  threeBlockManagement:{enabled:true,totalContracts:3,blocks},
  runnerPlan:{enabled:false,status:"NO_RUNNER_REQUIRED"},
  strategy1Provenance:{candidateId:"JOINT-A",planId:"JOINT-PLAN",
    finalPaperTestingContracts:3,finalThreeContractAllocation:allocation,
    threeBlockManagement:{enabled:true,totalContracts:3,blocks},
    runnerPlan:{enabled:false}}
};
const send=async t=>applyEngine8ExecutionToJournal({ticket:t,order:{...t,status:"FILLED"},result:{...t,status:"FILLED"}});
const lifecycle=(o,id,quantity,remaining,fillPrice,action,blockId,when)=>({
 ...o,action,eventType:action,tradeId:o.tradeId,side:"SELL",fillQuantity:quantity,remainingQty:remaining,
 fillPrice,fillTime:when,executionId:id+"-X",orderId:id+"-O",idempotencyKey:id+"-I",
 fillStatus:"FILLED",blockId,targetId:blockId==="BLOCK_1"?"T1":"T2",
 managementAction:action==="EXIT"?"CLOSE_REMAINDER":"TAKE_TARGET_1",
 exitReason:action==="EXIT"?"FINAL_EXIT":"TARGET_EXIT"
});
test("combined P2/P3 midpoint: gross realized allocation, fixed fee estimate and immutable journal",async()=>{
 const open=await createTradeJournalEntryFromEngine8Fill({
  ticket,order:{...ticket,status:"FILLED"},result:{...ticket,status:"FILLED"}
 });
 assert.equal(open.created,true);
 assert.equal(open.trade.qty.originalQty,3);
 assert.equal(open.trade.riskBasis.commissionDollarsPerContractRoundTrip,5);
 const p1=await send(lifecycle({...ticket,tradeId:open.tradeId},"P1",1,2,101,"REDUCE","BLOCK_1","2026-11-16T15:01:00Z"));
 assert.equal(p1.status,"OPEN");assert.equal(p1.remainingQty,2);
 const final=await send(lifecycle({...ticket,tradeId:open.tradeId},"P2P3",2,0,102,"EXIT","BLOCK_2","2026-11-16T15:02:00Z"));
 assert.equal(final.status,"CLOSED");assert.equal(final.remainingQty,0);
 assert.equal(final.journalCompleted,true);
 assert.equal(final.trade.qty.cumulativeExitQuantity,3);
 const exitEvents=final.trade.events.filter(e=>e.qtyClosed>0 && e.action!=="NEW_ENTRY");
 assert.deepEqual(exitEvents.map(e=>e.fillQuantity),[1,2]);
 assert.deepEqual(exitEvents.map(e=>e.price),[101,102]);
 const expectedByContract=blocks.map(b=>({
  contractId:b.contractId,blockId:b.blockId,contracts:1,targetPrice:b.targetPrice,
  realizedPoints:(b.targetPrice-price.entry)*1,
  grossPnL:(b.targetPrice-price.entry)*50
 }));
 assert.deepEqual(expectedByContract.map(x=>x.grossPnL),[50,100,100]);
 assert.deepEqual(expectedByContract.map(x=>x.contracts),[1,1,1]);
 assert.deepEqual(expectedByContract.slice(1).map(x=>x.targetPrice),[102,102]);
 const gross=expectedByContract.reduce((s,x)=>s+x.grossPnL,0);
 const estimatedRoundTripFees=blocks.reduce((s,x)=>s+x.contracts*ROUND_TRIP_FEE_PER_CONTRACT,0);
 const estimatedNet=gross-estimatedRoundTripFees;
 assert.equal(gross,250);
 assert.equal(estimatedRoundTripFees,15);
 assert.equal(estimatedNet,235);
 assert.equal(final.trade.summary.realizedPnL,gross);
 assert.deepEqual(exitEvents.map(e=>e.eventRealizedPnL),[50,200]);
 assert.deepEqual(exitEvents[0].contractAllocations.map(c=>c.blockId),["BLOCK_1"]);
 assert.deepEqual(exitEvents[1].contractAllocations.map(c=>c.blockId),["BLOCK_2","BLOCK_3"]);
 assert.deepEqual(exitEvents[1].contractAllocations.map(c=>c.contractId),["CONTRACT_2","CONTRACT_3"]);
 assert.deepEqual(exitEvents[1].contractAllocations.map(c=>c.allocatedQuantity),[1,1]);
 assert.deepEqual(exitEvents[1].contractAllocations.map(c=>c.grossRealizedPnL),[100,100]);
 assert.equal(exitEvents[1].contractAllocations.reduce((sum,c)=>sum+c.grossRealizedPnL,0),exitEvents[1].eventRealizedPnL,
  "one combined fill, two independently attributed contract blocks");
 assert.equal(final.trade.summary.paperFeeEstimate.estimatedFees,15);
 assert.equal(final.trade.summary.paperFeeEstimate.estimatedNetRealizedPnL,235);
 assert.equal(final.trade.summary.paperFeeEstimate.provenance,"ENGINE7_FROZEN_COMMISSION_ESTIMATE");
 assert.equal(final.trade.summary.paperFeeEstimate.authoritativeBrokerFeeReceipt,false);
 assert.equal(final.trade.summary.paperFeeEstimate.authoritativeNetReceipt,false);

 assert.equal(final.trade.events.filter(e=>e.eventType==="TRADE_CLOSED").length,1);
 assert.equal(final.trade.openingPlan?.runnerPlan?.enabled,false);
 assert.deepEqual(final.trade.strategy1Provenance.finalThreeContractAllocation,allocation);
 // PAPER Journal exposes gross realizedPnL, not confirmed paid fee/net receipts.
 // This MUST remain explicit in review, never silently reported as verified net.
 const publishedNet=final.trade.summary.netRealizedPnL;
 const feeReceiptPresent=Number.isFinite(final.trade.summary.totalFees);
 const extraRunnerEvents=final.trade.events.filter(e=>e.eventType==="RUNNER_ARMED").length;
 const evidence={grossJournal:final.trade.summary.realizedPnL,
   estimatedFees:estimatedRoundTripFees,estimatedNet,
   journalFeeReceipt:feeReceiptPresent?"PUBLISHED":"NOT_PUBLISHED",
   journalNetReceipt:Number.isFinite(publishedNet)?"PUBLISHED":"NOT_PUBLISHED",
   allocatedContracts:expectedByContract,
   journalContractAllocations:exitEvents.map(e=>e.contractAllocations),
   journalPaperFeeEstimate:final.trade.summary.paperFeeEstimate,
   exactCombinedExitQuantity:2,runnerExpected:false,extraRunnerEvents};
 assert.equal(evidence.journalFeeReceipt,"NOT_PUBLISHED");
 assert.equal(evidence.journalNetReceipt,"NOT_PUBLISHED");
 assert.equal(extraRunnerEvents,0,"no-runner plan must never produce RUNNER_ARMED");
 console.log("ENGINE8_ENGINE10_CONTRACT_ACCOUNTING",JSON.stringify(evidence));
 const before=fs.readFileSync(path.join(dir,"trade-journal.json"),"utf8");
 const duplicate=await send(lifecycle({...ticket,tradeId:open.tradeId},"P2P3",2,0,102,"EXIT","BLOCK_2","2026-11-16T15:02:00Z"));
 assert.equal(duplicate.skipped,true);
 assert.equal(fs.readFileSync(path.join(dir,"trade-journal.json"),"utf8"),before);
});
