import test from "node:test";
import assert from "node:assert/strict";
import {buildNoTradeFunnel} from "../logic/engine6/6e-funnel/buildNoTradeFunnel.js";

function full(){
 return {ok:true,symbol:"ES",generatedAt:"2026-11-11T22:00:00Z",strategies:{"intraday_scalp@10m":{
   engine26LocationCandidate:{candidateId:"candidate",zoneId:"zone",evaluationAuthorized:true,currentPrice:7500},
   confluence:{context:{reaction:{paperScalpReaction:{allowed:true,engine3Strategy1QualifiedForEngine6:true,direction:"LONG"}},
      volume:{engine4AuthorizedReactionParticipation:{allowed:true,participationConfirmed:true,hardBlocked:false,direction:"LONG"}}}},
   permission:{paper:{allowed:true,decision:"FAST_INTRADAY_PAPER_ALLOW",locked:true,direction:"LONG"}},
   engine26ProposedGeometry:{geometryReady:true,geometryFeasible:true},
   engine9OfficialManagementPlan:{managementReady:true},
   engine7PositionSizing:{finalContracts:3,finalSizingReady:true},
   engine8PaperOrder:{status:"READY_TO_CREATE_PAPER_ORDER",executable:true,planId:"P"}
 }}};
}
const s=s=>s.strategies["intraday_scalp@10m"];
const cases=[
 ["G0",x=>{x.ok=false;}],
 ["G1",x=>{s(x).engine26LocationCandidate.candidateInvalidated=true;}],
 ["G2",x=>{s(x).engine26LocationCandidate.evaluationAuthorized=false;}],
 ["G3",x=>{s(x).confluence.context.reaction.paperScalpReaction.allowed=false;}],
 ["G4",x=>{s(x).confluence.context.volume.engine4AuthorizedReactionParticipation.participationConfirmed=false;}],
 ["G5",x=>{s(x).permission.paper.allowed=false;}],
 ["G6",x=>{s(x).permission.paper.locked=false;}],
 ["G7",x=>{s(x).engine26ProposedGeometry.geometryReady=false;}],
 ["G8",x=>{s(x).engine9OfficialManagementPlan.managementReady=false;}],
 ["G9",x=>{s(x).engine7PositionSizing.finalSizingReady=false;}],
 ["G10",x=>{s(x).engine8PaperOrder.status="WAITING";}],
 ["G11",x=>{}]
];
for(const [gate,mutate] of cases){
 test("first stopping gate "+gate,()=>{
   const x=full();mutate(x);
   const v=buildNoTradeFunnel(x);
   assert.equal(v.firstFailedGate,gate);
   assert.notEqual(v.firstFailureState,"PASS");
 });
}
test("all twelve gates pass with independent matching executor order receipt",()=>{
 const x=full();
 const result=buildNoTradeFunnel(x,{executorResult:{ok:true,orderCreated:true,candidateId:"candidate",zoneId:"zone",planId:"P",orderId:"order-123"}});
 assert.equal(result.firstFailedGate,null);
 assert.ok(result.gates.every(g=>g.state==="PASS"));
});
test("unmatched executor candidate cannot manufacture completed order",()=>{
 const x=full();
 const result=buildNoTradeFunnel(x,{executorResult:{ok:true,orderCreated:true,candidateId:"other",zoneId:"zone",planId:"P",orderId:"order-123"}});
 assert.equal(result.firstFailedGate,"G11");
 assert.equal(result.executor.orderCreated,false);
});
