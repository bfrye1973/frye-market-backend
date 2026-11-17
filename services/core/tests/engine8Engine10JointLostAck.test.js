// Combined Engine 8/10 test: Engine10 durable commit succeeded,
// but Engine8 lost acknowledgment. Retry must deliver original fill ONLY.
import test,{after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"engine8-engine10-lost-ack-"));
process.env.NODE_ENV="test";
process.env.ENGINE8_PAPER_DATA_DIR=path.join(root,"paper");
process.env.TRADE_JOURNAL_DIR=path.join(root,"journal");
process.env.ENGINE8_PAPER_ONLY="1";
process.env.ENGINE8_LIVE_TRADING_ENABLED="0";
process.env.ENGINE8_ALLOW_LIVE_FUTURES="0";
process.env.ENGINE8_KILL_SWITCH="0";
const journal=await import("../logic/journal/tradeJournalStore.js");
const paper=await import("../logic/trading/engine8Paper.js");
const durable=await import("../logic/trading/engine8PaperDurableStore.js");
after(()=>fs.rmSync(root,{recursive:true,force:true}));
const ticket={
 paper:true,accountMode:"PAPER",symbol:"ES",assetType:"FUTURES",
 strategyId:"intraday_scalp@10m",candidateId:"ACK-CAND-A",zoneId:"ACK-ZONE-A",
 planId:"ACK-PLAN-A",direction:"LONG",setupType:"NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
 action:"NEW_ENTRY",eventType:"NEW_ENTRY",intent:"ENTRY",side:"BUY",
 executionId:"ACK-X-A",orderId:"ACK-O-A",idempotencyKey:"ACK-I-A",
 qty:3,requestedQuantity:3,contracts:3,entry:{price:100},fillPrice:100,fillQuantity:3,fillStatus:"FILLED",
 snapshotTime:"2026-11-16T15:00:00Z",dollarsPerPoint:50,frozenOpeningRiskDollars:150,
 officialEntryPrice:100,officialStopPrice:99,officialStopDistancePoints:1,
 officialTargets:[{targetId:"T1",price:101},{targetId:"T2",price:102},{targetId:"T3",price:102}],
 threeBlockManagement:{enabled:true,totalContracts:3,blocks:[
  {blockId:"BLOCK_1",contracts:1,targetId:"T1",targetPrice:101},
  {blockId:"BLOCK_2",contracts:1,targetId:"T2",targetPrice:102},
  {blockId:"BLOCK_3",contracts:1,targetId:"T3",targetPrice:102}]},
 runnerPlan:{enabled:false}
};
test("Engine 8 lost ACK after real Engine10 commit: no duplicate order/fill/trade and safe Journal retry",async()=>{
 let authoritativeTradeId=null;
 let journalCalls=0;
 paper.setPaperJournalHooksForTests({create:async delivery=>{
  journalCalls++;
  const receipt=await journal.createTradeJournalEntryFromEngine8Fill(delivery);
  assert.equal(receipt.ok,true);
  assert.equal(receipt.status,"OPEN");
  assert.equal(receipt.remainingQty,3);
  authoritativeTradeId=receipt.tradeId;
  throw new Error("SIMULATED_LOST_ACK_AFTER_DURABLE_COMMIT");
 }});
 const first=await paper.executeTradeTicket(ticket);
 assert.equal(first.journalStatus,"JOURNAL_PENDING");
 assert.ok(authoritativeTradeId);
 const pendingLedger=durable.readPaperStore("paper-idempotency-ledger.json",{});
 assert.equal(pendingLedger[ticket.idempotencyKey].journalStatus,"JOURNAL_PENDING");
 const pendingTrades=(await journal.listTrades({accountMode:"PAPER"})).trades.filter(t=>t.identity?.candidateId==="ACK-CAND-A");
 assert.equal(pendingTrades.length,1);
 assert.equal(pendingTrades[0].qty.remainingQty,3);
 const duplicate=await paper.executeTradeTicket(ticket);
 assert.equal(duplicate.duplicate,true);
 const firstOrders=durable.readPaperStore("paper-orders.json",[]);
 const firstExecutions=durable.readPaperStore("paper-executions.json",[]);
 assert.equal(firstOrders.length,1);assert.equal(firstExecutions.length,1);
 paper.setPaperJournalHooksForTests({create:async delivery=>{
  journalCalls++;
  return journal.createTradeJournalEntryFromEngine8Fill(delivery);
 }});
 const replay=await paper.retryPaperJournalDelivery({idempotencyKey:ticket.idempotencyKey});
 assert.equal(replay.journalStatus,"JOURNAL_COMPLETE",JSON.stringify(replay));
 assert.equal(replay.tradeId,authoritativeTradeId);
 assert.equal(journalCalls,2);
 assert.equal(durable.readPaperStore("paper-orders.json",[]).length,1);
 assert.equal(durable.readPaperStore("paper-executions.json",[]).length,1);
 const afterTrades=(await journal.listTrades({accountMode:"PAPER"})).trades.filter(t=>t.identity?.candidateId==="ACK-CAND-A");
 assert.equal(afterTrades.length,1);
 assert.equal(afterTrades[0].tradeId,authoritativeTradeId);
 assert.equal(afterTrades[0].qty.remainingQty,3);
 const afterAgain=await paper.retryPaperJournalDelivery({idempotencyKey:ticket.idempotencyKey});
 assert.equal(afterAgain.duplicate,true);
 assert.equal(journalCalls,2);
 console.log("ENGINE8_ENGINE10_LOST_ACK_RETRY",JSON.stringify({
  originalTradeId:authoritativeTradeId,orderCount:1,fillCount:1,journalTradeCount:1,
  journalCalls,finalJournalStatus:replay.journalStatus,secondRetryDuplicate:true,realBrokerCalls:0
 }));
 paper.setPaperJournalHooksForTests(null);
});
