// Isolated release acceptance: three MES PAPER contracts through the actual Engine 10 durable Journal.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {ES_PAPER_RISK_CONFIG as cfg} from "../config/paperRiskConfig.js";
import {buildEngine7ProposedSizingPreview} from "../logic/engine7/v2/buildProposedSizingPreview.js";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"engine6e-mes-dollar-audit-"));
process.env.TRADE_JOURNAL_DIR=dir;
const {createTradeJournalEntryFromEngine8Fill,applyEngine8ExecutionToJournal}=await import("../logic/journal/tradeJournalStore.js");
function identity(dirName){
 return {paper:true,accountMode:"PAPER",symbol:"ES",assetType:"FUTURES",
 strategyId:"intraday_scalp@10m",candidateId:"MES-"+dirName,zoneId:"MES-ZONE-"+dirName,
 planId:"MES-PLAN-"+dirName,direction:dirName,setupType:"NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION"};
}
function ticket(dirName,movePoints){
 const base={...identity(dirName),candidateId:"MES-"+dirName+"-"+movePoints,planId:"MES-PLAN-"+dirName+"-"+movePoints},long=dirName==="LONG",entry=7600,stop=long?7590:7610,boundary=long?entry+movePoints-5:entry-movePoints+5,midpoint=long?entry+movePoints:entry-movePoints;
 const sizing=buildEngine7ProposedSizingPreview({engine26ProposedGeometry:{...base,proposedEntryPrice:entry,proposedStopPrice:stop,proposedStopDistancePoints:10,proposedTargets:[],snapshotTime:"2026-11-16T22:00:00Z"},riskConfig:cfg});
 assert.equal(sizing.finalContracts,3);
 assert.equal(sizing.dollarsPerPoint,5);
 const blocks=[{blockId:"BLOCK_1",contractId:"CONTRACT_1",contracts:1,targetId:"T1",targetPrice:boundary},
 {blockId:"BLOCK_2",contractId:"CONTRACT_2",contracts:1,targetId:"T2",targetPrice:midpoint},
 {blockId:"BLOCK_3",contractId:"CONTRACT_3",contracts:1,targetId:"T3",targetPrice:midpoint}];
 return {...base,action:"NEW_ENTRY",eventType:"NEW_ENTRY",side:long?"BUY":"SELL",
 executionId:base.candidateId+"-ENTRY-X",orderId:base.candidateId+"-ENTRY-O",idempotencyKey:base.candidateId+"-ENTRY-I",
 fillTime:"2026-11-16T22:00:00Z",fillPrice:entry,fillQuantity:3,qty:3,fillStatus:"FILLED",
 dollarsPerPoint:sizing.dollarsPerPoint,riskBudgetDollars:cfg.riskBudgetDollars,
 frozenOpeningRiskDollars:sizing.estimatedTotalRiskDollars,
 commissionDollarsPerContractRoundTrip:cfg.commissionDollarsPerContractRoundTrip,
 officialEntryPrice:entry,officialStopPrice:stop,officialStopDistancePoints:10,
 officialTargets:[{targetId:"T1",price:boundary},{targetId:"T2",price:midpoint},{targetId:"T3",price:midpoint}],
 threeBlockManagement:{enabled:true,totalContracts:3,blocks},runnerPlan:{enabled:false,status:"NO_RUNNER_REQUIRED"},
 strategy1Provenance:{candidateId:base.candidateId,planId:base.planId,finalPaperTestingContracts:3,
 finalThreeContractAllocation:{block1Contracts:1,block2Contracts:1,block3Contracts:1,totalContracts:3},
 threeBlockManagement:{enabled:true,totalContracts:3,blocks},runnerPlan:{enabled:false}},
 boundary,midpoint};
}
function exit(t,tradeId,id,quantity,remaining,price,action,block,target){
 return {...t,tradeId,action,eventType:action,side:t.direction==="LONG"?"SELL":"BUY",
 fillQuantity:quantity,remainingQty:remaining,fillPrice:price,fillTime:"2026-11-16T22:03:00Z",
 executionId:id+"-X",orderId:id+"-O",idempotencyKey:id+"-I",fillStatus:"FILLED",
 blockId:block,targetId:target,managementAction:action==="EXIT"?"CLOSE_REMAINDER":"TAKE_TARGET_1",
 exitReason:action==="EXIT"?"FINAL_EXIT":"TARGET_EXIT"};
}
for(const direction of ["LONG","SHORT"]){
 for(const movePoints of [30,40,50]){
 test("MES "+direction+" "+movePoints+"-point institutional move: 3→2→0 at $5/pt",async()=>{
  const t=ticket(direction,movePoints);
  const opened=await createTradeJournalEntryFromEngine8Fill({ticket:t,order:{...t,status:"FILLED"},result:{...t,status:"FILLED"}});
  assert.equal(opened.created,true);assert.equal(opened.trade.qty.originalQty,3);
  assert.equal(opened.trade.riskBasis.dollarsPerPoint,5);
  const p1=exit(t,opened.tradeId,direction+"-P1",1,2,t.boundary,"REDUCE","BLOCK_1","T1");
  const first=await applyEngine8ExecutionToJournal({ticket:p1,order:{...p1,status:"FILLED"},result:{...p1,status:"FILLED"}});
  assert.equal(first.remainingQty,2);
  const p23=exit(t,opened.tradeId,direction+"-P2P3",2,0,t.midpoint,"EXIT","BLOCK_2","T2");
  const closed=await applyEngine8ExecutionToJournal({ticket:p23,order:{...p23,status:"FILLED"},result:{...p23,status:"FILLED"}});
  assert.equal(closed.status,"CLOSED");assert.equal(closed.remainingQty,0);
  const expectedGross=(3*movePoints-5)*5;
  assert.equal(closed.trade.summary.realizedPnL,expectedGross);
  assert.equal(closed.trade.summary.paperFeeEstimate.estimatedFees,4.5);
  assert.equal(closed.trade.summary.paperFeeEstimate.estimatedNetRealizedPnL,expectedGross-4.5);
  assert.equal(closed.trade.summary.paperFeeEstimate.authoritativeBrokerFeeReceipt,false);
  const fills=closed.trade.events.filter(e=>e.qtyClosed>0&&e.action!=="NEW_ENTRY");
  assert.deepEqual(fills.map(e=>e.fillQuantity),[1,2]);
  assert.deepEqual(fills.map(e=>e.eventRealizedPnL),[(movePoints-5)*5,movePoints*2*5]);
  assert.deepEqual(fills[1].contractAllocations.map(c=>c.blockId),["BLOCK_2","BLOCK_3"]);
  assert.equal(closed.trade.events.filter(e=>e.eventType==="RUNNER_ARMED").length,0);
  const persisted=JSON.parse(fs.readFileSync(path.join(dir,"trade-journal.json"),"utf8"));
  const matched=persisted.find(x=>x.tradeId===opened.tradeId);
  assert.equal(matched.status,"CLOSED");assert.equal(matched.qty.remainingQty,0);
  console.log("MES_JOURNAL_EVIDENCE",JSON.stringify({direction,movePoints,tradeId:opened.tradeId,originalQty:3,stopDistancePoints:10,firstTargetPoints:movePoints-5,midpointTargetPoints:movePoints,exitQuantities:[1,2],grossUsd:expectedGross,estimatedFees:4.5,estimatedNet:expectedGross-4.5,ratePerPoint:5,brokerCalls:0}));
 });
 }
}
