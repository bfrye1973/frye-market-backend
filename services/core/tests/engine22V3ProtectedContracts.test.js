import test from "node:test";
import assert from "node:assert/strict";
import {compareEngine22V3ProtectedOutputs as compare} from "../logic/engine22/v3/compareProtectedContracts.js";
const source=()=>({degreeStates:{minute:{activeWave:"W3"}},currentWavelength:{symbol:"ES"},
 microExecutionContext:{automationEligible:false},engine22Display:{degrees:{}},
 waveOpportunity:{},currentLifecycleState:{},activeFibModel:{},
 action:"WAIT",bias:"UP",tradeDecision:{permission:false}});
test("unchanged legacy contract is safe",()=>{
 const a=source();assert.equal(compare({legacy:a,candidate:structuredClone(a)}).pass,true);
});
test("display-only changes are visible, not accepted silently",()=>{
 const a=source(),b=structuredClone(a);b.engine22Display.degrees.submicro={active:true};
 const r=compare({legacy:a,candidate:b});
 assert.equal(r.pass,false);assert.equal(r.differences[0].key,"engine22Display");
});
test("execution-adjacent drift is also rejected",()=>{
 const a=source(),b=structuredClone(a);b.tradeDecision.permission=true;
 const r=compare({legacy:a,candidate:b});
 assert.deepEqual(r.protectedChanges,["tradeDecision"]);
});
