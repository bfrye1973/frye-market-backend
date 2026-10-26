import test from "node:test";
import assert from "node:assert/strict";
import {backtestReplayOutcomes} from "../probability/backtestReplayOutcomes.js";
const replay=(minute,price)=>({schema:"engine12.multiStrategyReplay.v1",
 snapshotTime:new Date(Date.parse("2026-10-26T18:00:00Z")+minute*60000).toISOString(),
 currentPrice:price,strategies:{"intraday_scalp@10m":{}}});
test("real-time ordering and exact contract give retrospective labels, not accuracy",()=>{
 const x=backtestReplayOutcomes({snapshots:[replay(10,5804),replay(0,5800),replay(20,5800)],
  contractBySnapshot:()=> "ESZ26"});
 assert.equal(x.eligibleSeeds,3);
 assert.equal(x.labeledOutcomes,2);
 assert.deepEqual(x.outcomeCounts,{UP:1,DOWN:1,SIDEWAYS:0});
 assert.equal(x.accuracy,null);
 assert.equal(x.probabilities.up,null);
 assert.equal(x.wasIssuedLive,false);
});
test("missing contract identity fails closed",()=>{
 const x=backtestReplayOutcomes({snapshots:[replay(0,5800),replay(10,5804)],contractBySnapshot:()=>null});
 assert.equal(x.eligibleSeeds,0);
 assert.equal(x.labeledOutcomes,0);
});
test("different contracts cannot label each other",()=>{
 const x=backtestReplayOutcomes({snapshots:[replay(0,5800),replay(10,5804)],
  contractBySnapshot:r=>r.currentPrice===5800?"ESZ26":"ESH27"});
 assert.equal(x.labeledOutcomes,0);
});
test("missing exact target within tolerance stays missing",()=>{
 const x=backtestReplayOutcomes({snapshots:[replay(0,5800),replay(14,5804)],
  contractBySnapshot:()=> "ESZ26"});
 assert.equal(x.labeledOutcomes,0);
});
