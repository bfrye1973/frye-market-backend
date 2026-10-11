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

test("legacy Micro consumer identity must never silently switch to larger V3 Micro",()=>{
 const a=source(),b=structuredClone(a);
 a.microExecutionContext={sourceCountId:"LEGACY-MICRO",activeWave:"W2",automationEligible:false};
 b.microExecutionContext={sourceCountId:"LARGER-MICRO",activeWave:"W5",automationEligible:false};
 const result=compare({legacy:a,candidate:b});
 assert.equal(result.pass,false);
 assert.ok(result.differences.some(x=>x.key==="microExecutionContext"));
});
test("downstream consumers cannot change during Engine22 shadow work",()=>{
 const a=source(),b=structuredClone(a);
 a.engine27Strategies={degree:"MICRO",countId:"old"};
 b.engine27Strategies={degree:"INTRADAY_SUBMICRO",countId:"new"};
 const r=compare({legacy:a,candidate:b});
 assert.equal(r.pass,false);
 assert.deepEqual(r.protectedChanges,["engine27Strategies"]);
});
