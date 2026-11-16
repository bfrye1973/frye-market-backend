// Engine 10B isolated continuous PAPER persistence contract.
// Runs only in a fresh OS temp dir; never touches production Journal/Engine8 PAPER storage.
import test, {after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"engine10b-continuous-paper-"));
process.env.TRADE_JOURNAL_DIR=dir;
const file=path.join(dir,"trade-journal.json");
const {createTradeJournalEntryFromEngine8Fill,applyEngine8ExecutionToJournal,listTrades}=
 await import("../logic/journal/tradeJournalStore.js");
const historical={tradeId:"LEGACY-HISTORICAL-DO-NOT-TOUCH",accountMode:"REAL",
 status:"CLOSED",identity:{candidateId:"HIST-IMMUTABLE"},
 summary:{netRealizedPnL:123.45},events:[]};
beforeEach(()=>fs.writeFileSync(file,JSON.stringify([historical],null,2)));
after(()=>fs.rmSync(dir,{recursive:true,force:true}));

function input({candidate,plan,time="2026-11-16T15:00:00.000Z",prefix=candidate}){
 return {paper:true,accountMode:"PAPER",symbol:"ES",assetType:"FUTURES",
  strategyId:"intraday_scalp@10m",candidateId:candidate,zoneId:"ZONE-X",
  planId:plan,direction:"LONG",setupType:"NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
  action:"NEW_ENTRY",eventType:"NEW_ENTRY",side:"BUY",
  executionId:prefix+"-X",orderId:prefix+"-O",idempotencyKey:prefix+"-I",
  fillTime:time,fillPrice:100,fillQuantity:3,qty:3,fillStatus:"FILLED",
  dollarsPerPoint:50,riskBudgetDollars:150,frozenOpeningRiskDollars:150,
  officialEntryPrice:100,officialStopPrice:99,officialStopDistancePoints:1,
  officialTargets:[{targetId:"T1",price:101},{targetId:"T2",price:102},{targetId:"T3",price:102}],
  runnerPlan:{enabled:false,status:"NO_RUNNER_REQUIRED"},
  strategy1Provenance:{candidateId:candidate,planId:plan,finalPaperTestingContracts:3,
   finalThreeContractAllocation:{block1Contracts:1,block2Contracts:1,block3Contracts:1,totalContracts:3},
   runnerPlan:{enabled:false}}};
}
async function opening(t){
 return createTradeJournalEntryFromEngine8Fill({ticket:t,order:{...t,status:"FILLED"},result:{...t,status:"FILLED"}});
}
async function event(open,tradeId,{id,action,quantity,price,remaining,block,at}){
 const t={...open,tradeId,eventType:action,action,side:"SELL",fillQuantity:quantity,
  fillPrice:price,fillTime:at,remainingQty:remaining,
  blockId:block,targetId:block==="BLOCK_1"?"T1":block==="BLOCK_2"?"T2":"T3",
  executionId:id+"-X",orderId:id+"-O",idempotencyKey:id+"-I",fillStatus:"FILLED"};
 return applyEngine8ExecutionToJournal({ticket:t,order:{...t,status:"FILLED"},result:{...t,status:"FILLED"}});
}
function snapshot(){return JSON.parse(fs.readFileSync(file,"utf8"));}
for(const combined of [false,true]){
 test(`candidate A closes via ${combined?"combined 2":"separate 1+1"} midpoint exits; B opens while A stays immutable`,async()=>{
  const a=input({candidate:"CAND-A",plan:"PLAN-A"});
  const opened=await opening(a);
  assert.equal(opened.ok,true);
  assert.equal(opened.created,true);
  assert.equal(opened.status,"OPEN");
  assert.equal(opened.remainingQty,3);
  assert.equal(opened.trade.accountMode,"PAPER");
  for(const field of ["candidateId","planId","zoneId","executionId","orderId","idempotencyKey"])
   assert.ok(field==="executionId"?opened.trade.identity.openingExecutionId:opened.trade.identity[field],field);
  const p1=await event(a,opened.tradeId,{id:"P1",action:"REDUCE",quantity:1,
   price:101,remaining:2,block:"BLOCK_1",at:"2026-11-16T15:01:00Z"});
  assert.equal(p1.ok,true);
  assert.equal(p1.status,"OPEN");
  assert.equal(p1.remainingQty,2);
  let final;
  if(combined){
   final=await event(a,opened.tradeId,{id:"P2P3",action:"EXIT",quantity:2,
    price:102,remaining:0,block:"BLOCK_2",at:"2026-11-16T15:02:00Z"});
  }else{
   const p2=await event(a,opened.tradeId,{id:"P2",action:"REDUCE",quantity:1,
    price:102,remaining:1,block:"BLOCK_2",at:"2026-11-16T15:02:00Z"});
   assert.equal(p2.status,"OPEN");assert.equal(p2.remainingQty,1);
   final=await event(a,opened.tradeId,{id:"P3",action:"EXIT",quantity:1,
    price:102,remaining:0,block:"BLOCK_3",at:"2026-11-16T15:02:01Z"});
  }
  assert.equal(final.ok,true);assert.equal(final.status,"CLOSED");
  assert.equal(final.remainingQty,0);assert.equal(final.journalCompleted,true);
  assert.equal(final.trade.qty.cumulativeExitQuantity,3);
  assert.equal(final.trade.summary.realizedPnL,250);
  assert.equal(final.trade.events.filter(e=>e.eventType==="TRADE_CLOSED").length,1);
  assert.equal(final.trade.openingPlan?.runnerPlan?.enabled,false);
  assert.equal(final.trade.events.filter(e=>e.eventType==="RUNNER_ARMED").length,0,"no-runner midpoint must stay free of runner events");
  const frozen=JSON.stringify(snapshot().find(t=>t.tradeId===opened.tradeId));
  const retry=await event(a,opened.tradeId,{id:"P1",action:"REDUCE",quantity:1,
   price:101,remaining:2,block:"BLOCK_1",at:"2026-11-16T15:04:00Z"});
  assert.equal(retry.skipped,true);assert.equal(retry.updated,false);
  assert.equal(retry.reason,"EXECUTION_EVENT_ALREADY_RECORDED");
  const stale=await event(a,opened.tradeId,{id:"STALE-FRESH-IDS",action:"EXIT",quantity:1,
   price:102,remaining:0,block:"BLOCK_3",at:"2026-11-16T15:05:00Z"});
  assert.equal(stale.skipped,true);assert.equal(stale.reason,"TRADE_ALREADY_CLOSED");
  const replayOld=await opening({...a,fillTime:"2026-11-16T15:06:00Z",
   executionId:"REPLAY-X",orderId:"REPLAY-O",idempotencyKey:"REPLAY-I"});
  assert.equal(replayOld.created,false);assert.equal(replayOld.skipped,true);
  assert.equal(replayOld.reason,"TRADE_ALREADY_RECORDED");
  assert.equal(replayOld.tradeId,opened.tradeId);
  assert.equal(JSON.stringify(snapshot().find(t=>t.tradeId===opened.tradeId)),frozen);
  const b=input({candidate:"CAND-B",plan:"PLAN-B",prefix:"B",time:"2026-11-16T16:00:00Z"});
  const second=await opening(b);
  assert.equal(second.created,true);
  assert.equal(second.remainingQty,3);
  assert.notEqual(second.tradeId,opened.tradeId);
  const persisted=snapshot();
  assert.equal(persisted.length,3);
  assert.deepEqual(persisted.find(t=>t.tradeId===historical.tradeId),historical);
  assert.equal(persisted.find(t=>t.tradeId===opened.tradeId).status,"CLOSED");
  assert.equal(persisted.find(t=>t.tradeId===second.tradeId).status,"OPEN");
 });
}
test("runner-enabled Strategy 1 still records a genuine RUNNER_ARMED lifecycle marker",async()=>{
 const a=input({candidate:"CAND-LEGIT-RUNNER",plan:"PLAN-LEGIT-RUNNER"});
 a.runnerPlan={enabled:true,blockId:"BLOCK_3",contracts:1,status:"RUNNER_TARGET_SELECTED"};
 a.strategy1Provenance.runnerPlan={enabled:true,blockId:"BLOCK_3",contracts:1};
 const opened=await opening(a);assert.equal(opened.created,true);
 const p1=await event(a,opened.tradeId,{id:"RUNNER-P1",action:"REDUCE",quantity:1,
  price:101,remaining:2,block:"BLOCK_1",at:"2026-11-16T15:01:00Z"});
 assert.equal(p1.remainingQty,2);
 const p2=await event(a,opened.tradeId,{id:"RUNNER-P2",action:"REDUCE",quantity:1,
  price:102,remaining:1,block:"BLOCK_2",at:"2026-11-16T15:02:00Z"});
 assert.equal(p2.remainingQty,1);
 assert.equal(p2.trade.events.filter(e=>e.eventType==="RUNNER_ARMED").length,1,
  "explicit runner-enabled frozen plan should preserve existing runner event");
});
test("mismatched reported remaining, over-exit and noninteger qty fail before any Journal write",async()=>{
 const a=input({candidate:"CAND-MISMATCH",plan:"PLAN-MISMATCH"});
 const opened=await opening(a);assert.equal(opened.created,true);
 const frozen=fs.readFileSync(file,"utf8");
 const incorrect=await event(a,opened.tradeId,{id:"BAD-REMAIN",action:"REDUCE",
  quantity:1,price:101,remaining:0,block:"BLOCK_1",at:"2026-11-16T15:01:00Z"});
 assert.equal(incorrect.ok,false);
 assert.equal(incorrect.error,"EXIT_REMAINING_QUANTITY_MISMATCH");
 assert.equal(incorrect.expectedRemainingQty,2);
 assert.equal(fs.readFileSync(file,"utf8"),frozen);
 const over=await event(a,opened.tradeId,{id:"BAD-OVER",action:"EXIT",
  quantity:4,price:101,remaining:0,block:"BLOCK_3",at:"2026-11-16T15:02:00Z"});
 assert.equal(over.error,"EXIT_QUANTITY_EXCEEDS_REMAINING_QUANTITY");
 assert.equal(fs.readFileSync(file,"utf8"),frozen);
 const fractional=await event(a,opened.tradeId,{id:"BAD-FRACTION",action:"REDUCE",
  quantity:1.5,price:101,remaining:1.5,block:"BLOCK_1",at:"2026-11-16T15:03:00Z"});
 assert.equal(fractional.error,"EXIT_REMAINING_QUANTITY_MISMATCH");
 assert.equal(fs.readFileSync(file,"utf8"),frozen);
});
