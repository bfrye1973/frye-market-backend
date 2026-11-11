import test from "node:test";
import assert from "node:assert/strict";
import {buildNoTradeFunnel} from "../logic/engine6/6e-funnel/buildNoTradeFunnel.js";

const snapshot = () => ({
  ok:true,symbol:"ES",generatedAt:"2026-11-11T22:00:00.000Z",
  strategies:{"intraday_scalp@10m":{
    engine26LocationCandidate:{candidateId:"candidate-A",zoneId:"zone-A",evaluationAuthorized:true,currentPrice:7600},
    confluence:{context:{
      reaction:{paperScalpReaction:{allowed:true,engine3Strategy1QualifiedForEngine6:true,direction:"LONG"}},
      volume:{engine4AuthorizedReactionParticipation:{allowed:true,participationConfirmed:true,direction:"LONG",hardBlocked:false}}
    }},
    permission:{paper:{allowed:true,decision:"FAST_INTRADAY_PAPER_ALLOW",locked:true,direction:"LONG"}},
    engine26ProposedGeometry:{geometryFeasible:true},
    engine9OfficialManagementPlan:{managementReady:true},
    engine7PositionSizing:{finalContracts:3},
    engine8PaperOrder:{status:"READY_TO_CREATE_PAPER_ORDER",executable:true,planId:"plan-A"}
  }}
});
const assess = (s, opts) => buildNoTradeFunnel(s,opts);

test("missing input is non-throwing and makes no permission", () => {
  const result=assess(null);
  assert.equal(result.firstFailedGate,"G0");
  assert.equal(result.firstFailureState,"UNAVAILABLE");
  assert.equal(result.readOnly,true);
  assert.equal(Object.hasOwn(result,"allowed"),false);
});
test("independent qualification failure retains first gate", () => {
  const s=snapshot();
  s.strategies["intraday_scalp@10m"].confluence.context.reaction.paperScalpReaction.allowed=false;
  const result=assess(s);
  assert.equal(result.firstFailedGate,"G3");
  assert.equal(result.gates[4].reached,false);
});
test("READY adapter alone is never an executed order",()=>{
  const result=assess(snapshot());
  assert.equal(result.gates[10].state,"PASS");
  assert.equal(result.gates[11].state,"UNAVAILABLE");
  assert.equal(result.executor.orderCreated,false);
});
test("executor proof requires correlated identity and plan",()=>{
  const correct={ok:true,orderCreated:true,candidateId:"candidate-A",zoneId:"zone-A",planId:"plan-A",orderId:"order-A"};
  const yes=assess(snapshot(),{executorResult:correct});
  assert.equal(yes.gates[11].state,"PASS");
  assert.equal(yes.firstFailedGate,null);
  const wrong=assess(snapshot(),{executorResult:{...correct,planId:"plan-B"}});
  assert.equal(wrong.gates[11].state,"UNAVAILABLE");
});
test("advisory states never alter gate or permission output",()=>{
  const s=snapshot();
  const baseline=assess(s);
  s.strategies["intraday_scalp@10m"].engine25Context={state:"MIXED",dataDegraded:true};
  s.strategies["intraday_scalp@10m"].engine29CrossMarketStress={state:"DOWN"};
  const changed=assess(s);
  assert.deepEqual(changed.gates,baseline.gates);
  assert.deepEqual(changed.firstFailedGate,baseline.firstFailedGate);
});
test("snapshot is not mutated",()=>{
  const s=snapshot();
  const before=structuredClone(s);
  assess(s);
  assert.deepEqual(s,before);
});
