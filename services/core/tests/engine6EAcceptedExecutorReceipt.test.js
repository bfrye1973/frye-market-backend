// Engine6E contract compatibility with the accepted Engine8/Engine10 joint PAPER
// receipt shape. All fixtures are read-only; no real order is placed here.
import test from "node:test";
import assert from "node:assert/strict";
import {buildNoTradeFunnel} from "../logic/engine6/6e-funnel/buildNoTradeFunnel.js";
function snapshot(candidateId="CAND-A"){
 const planId="PLAN-"+candidateId,zoneId="ZONE-"+candidateId;
 return {ok:true,symbol:"ES",generatedAt:"2026-11-16T16:08:00Z",
  strategies:{"intraday_scalp@10m":{
   engine26LocationCandidate:{candidateId,zoneId,currentPrice:7680,evaluationAuthorized:true},
   confluence:{context:{
    reaction:{paperScalpReaction:{allowed:true,engine3Strategy1QualifiedForEngine6:true,direction:"LONG"}},
    volume:{engine4AuthorizedReactionParticipation:{allowed:true,participationConfirmed:true,direction:"LONG",hardBlocked:false}}
   }},
   permission:{paper:{allowed:true,decision:"FAST_INTRADAY_PAPER_ALLOW",locked:true,direction:"LONG"}},
   engine26ProposedGeometry:{geometryReady:true,geometryFeasible:true},
   engine9OfficialManagementPlan:{managementReady:true},
   engine7PositionSizing:{finalSizingReady:true,finalContracts:3},
   engine8PaperOrder:{status:"READY_TO_CREATE_PAPER_ORDER",executable:true,planId}
  }}};
}
const verifiedReceipt=(candidateId="CAND-A")=>({
 status:"AUTO_PAPER_EXECUTION_COMPLETED",
 execution:{ok:true,orderCreated:true,fillCreated:true,journalCompleted:true,journalPending:false,
  candidateId,zoneId:"ZONE-"+candidateId,planId:"PLAN-"+candidateId,
  orderId:"E8O-"+candidateId,executionId:"E8X-"+candidateId,
  tradeId:"TRD-"+candidateId}
});
test("Engine6E G11 recognizes exact Engine8C nested executed receipt after G0-G10 qualification",()=>{
 const x=snapshot(), frozen=structuredClone(x);
 const result=buildNoTradeFunnel(x,{executorResult:verifiedReceipt()});
 assert.equal(result.firstFailedGate,null);
 assert.equal(result.gates.length,12);
 assert.equal(result.gates[11].state,"PASS");
 assert.equal(result.executor.orderCreated,true);
 assert.equal(result.readOnly,true);
 assert.deepEqual(x,frozen);
});
test("Engine6E G11 does not infer execution from an adapter READY or an auto-executor SKIP",()=>{
 const noReceipt=buildNoTradeFunnel(snapshot());
 assert.equal(noReceipt.firstFailedGate,"G11");
 assert.equal(noReceipt.gates[11].state,"UNAVAILABLE");
 const skipped=buildNoTradeFunnel(snapshot(),{executorResult:{
  status:"AUTO_PAPER_EXECUTION_SKIPPED",execution:{candidateId:"CAND-A",planId:"PLAN-CAND-A",
   zoneId:"ZONE-CAND-A",orderCreated:false}}});
 assert.equal(skipped.firstFailedGate,"G11");
 assert.equal(skipped.executor.orderCreated,false);
});
test("Engine6E never credits A's order to B or credits mismatched plan/zone/order snapshot",()=>{
 const a=verifiedReceipt();
 for(const [description,receipt,expected] of [
  ["fresh B using old A receipt",a,"CAND-B"],
  ["wrong plan",{...a,execution:{...a.execution,planId:"WRONG"}},"CAND-A"],
  ["wrong zone",{...a,execution:{...a.execution,zoneId:"WRONG"}},"CAND-A"]
 ]){
  const result=buildNoTradeFunnel(snapshot(expected),{executorResult:receipt});
  assert.equal(result.firstFailedGate,"G11",description);
  assert.equal(result.executor.orderCreated,false,description);
 }
 const b=buildNoTradeFunnel(snapshot("CAND-B"),{executorResult:verifiedReceipt("CAND-B")});
 assert.equal(b.firstFailedGate,null);
});
test("Engine 8/10 safeguards remain evidence, not Engine6 independent market vetoes",()=>{
 const x=snapshot();
 x.strategies["intraday_scalp@10m"].engine25Context={status:"MIXED",dataDegraded:true};
 x.strategies["intraday_scalp@10m"].engine29CrossMarketStress={status:"DOWN"};
 x.strategies["intraday_scalp@10m"].engine27MinuteDecision={decisionState:"BLOCK"};
 const result=buildNoTradeFunnel(x,{executorResult:verifiedReceipt()});
 assert.equal(result.firstFailedGate,null);
 assert.ok(result.gates.every(g=>g.state==="PASS"));
});
