import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine9OfficialManagementPlan} from "../logic/engine9/v1/buildOfficialManagementPlan.js";

const ID={laneId:"minute",strategyId:"intraday_scalp@10m",candidateId:"E26C-ENGINE6E",
  zoneId:"E26Z-ENTRY",symbol:"ES",setupClass:"NEGOTIATED_ZONE_ROTATION",setupGrade:"A+++",
  identitySetupKey:"NEGOTIATED_ZONE_ROTATION",candidateIdentityVersion:"engine26.strategy1.v2"};
function inputs(direction="LONG") {
  const entry=direction==="LONG"?7490:7490;
  const boundary=direction==="LONG"?7510:7470;
  const midpoint=direction==="LONG"?7520:7460;
  const stop=direction==="LONG"?7482:7498;
  return {
    engine26LocationCandidate:{...ID,direction,snapshotTime:"2026-11-11T22:00:00Z"},
    engine26ProposedGeometry:{...ID,direction,snapshotTime:"2026-11-11T22:00:00Z",
      geometryReady:true,candidateIdentityPreserved:true,proposedEntryPrice:entry,
      proposedStopPrice:stop,proposedStopDistancePoints:8,
      target1Price:boundary,target2Price:midpoint,target3Price:midpoint,
      proposedTargets:[
        {sequence:1,price:boundary},{sequence:2,price:midpoint},
        {sequence:3,price:null,purpose:"THIRD_PROFIT_TARGET_ZONE_MIDLINE_TESTING",runnerHandoffRequired:false}
      ],
      testingExitLifecycle:{active:true,mode:"SIMPLIFIED_THREE_BLOCK_TESTING",
        block1:{price:boundary},block2:{price:midpoint},block3:{price:midpoint},
        remainingRunnerExpected:false}
    },
    engine7SizingPreview:{...ID,direction,threeContractAllocation:{
      block1Contracts:1,block2Contracts:1,block3Contracts:1}},
    engine6PaperPermission:{...ID,direction,allowed:true,locked:true,planningAllowed:true,
      decision:"FAST_INTRADAY_PAPER_ALLOW"},
    engine27MinuteDecision:{...ID,direction,decisionState:"ALMOST_READY",
      readiness:{reactionReady:false,participationReady:false,permissionReady:false,plannerReady:false}},
    snapshotTime:"2026-11-11T22:00:00Z"
  };
}
for(const direction of ["LONG","SHORT"]){
 test(`frozen ${direction} Strategy 1 PAPER exits: one at boundary and two at midpoint`,()=>{
  const x=inputs(direction);
  const plan=buildEngine9OfficialManagementPlan(x);
  assert.equal(plan.phase,"PHASE_8A");
  assert.equal(plan.managementReady,true);
  assert.equal(plan.threeBlockManagement.enabled,true);
  assert.equal(plan.threeBlockManagement.totalContracts,3);
  const blocks=plan.threeBlockManagement.blocks;
  assert.deepEqual(blocks.map(b=>b.contracts),[1,1,1]);
  assert.equal(blocks[0].targetPrice,x.engine26ProposedGeometry.target1Price);
  assert.equal(blocks[1].targetPrice,x.engine26ProposedGeometry.target2Price);
  assert.equal(blocks[2].targetPrice,x.engine26ProposedGeometry.target2Price);
  assert.equal(blocks[0].purpose,"TARGET_1_ZONE_TOUCH");
  assert.equal(blocks[1].purpose,"TARGET_2_ZONE_MIDLINE");
  assert.equal(blocks[2].afterExitAction,"CLOSE_REMAINDER");
  assert.equal(plan.runnerPlan.enabled,false);
  assert.equal(plan.upstreamState.engine27HardGateApplied,false);
 });
}
test("third target drifting away from midpoint fails official management",()=>{
 const x=inputs();
 x.engine26ProposedGeometry.target3Price=7530;
 x.engine26ProposedGeometry.testingExitLifecycle.block3.price=7530;
 const plan=buildEngine9OfficialManagementPlan(x);
 assert.equal(plan.managementReady,false);
 assert.ok(plan.blockers.includes("TARGET_3_INVALID"));
});
test("fresh candidate identity cannot borrow previous candidate's geometry",()=>{
 const x=inputs();
 x.engine26LocationCandidate.candidateId="NEW-CANDIDATE";
 const plan=buildEngine9OfficialManagementPlan(x);
 assert.equal(plan.managementReady,false);
 assert.ok(plan.blockers.some(x=>/IDENTITY|CANDIDATE/.test(x)));
});
