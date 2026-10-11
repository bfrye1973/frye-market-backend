import test from "node:test";
import assert from "node:assert/strict";
import {ENGINE22_V3_DEGREES,ENGINE22_V3_PARENT,ENGINE22_V3_SCHEMA} from "../logic/engine22/v3/canonicalStructure.js";
import {proposeEngine22V3CanonicalObservation} from "../logic/engine22/v3/proposeCanonicalObservation.js";
const make=()=>({schema:ENGINE22_V3_SCHEMA,symbol:"ES",noPermissionCreated:true,noExecution:true,
 degrees:Object.fromEntries(ENGINE22_V3_DEGREES.map((degree,i)=>[degree,{
 degreeId:degree,countId:"C"+i,sequenceId:"S"+i,parentDegree:ENGINE22_V3_PARENT[degree],
 parentWave:ENGINE22_V3_PARENT[degree]?"W3":null,activeWave:"W1",lifecycle:"DEVELOPING",
 anchors:{},history:[],provenance:{},invalidation:{},fibModel:{},
 lastEvaluatedEvidenceTimestamp:"2026-10-11T12:00:00Z",
 }]))});
const evidence=()=>({completed:true,sourceTimestamp:"2026-10-11T12:05:00Z",
 sourceBarId:"ES-5m-1",sourceTimeframe:"5m",completionCandidate:true});
test("canonical observation produces shadow proposal without changing inputs",()=>{
 const state=make(),original=structuredClone(state);
 const r=proposeEngine22V3CanonicalObservation({canonical:state,degree:"MICRO",evidence:evidence()});
 assert.equal(r.ok,true);assert.equal(r.proposedCanonical.degrees.MICRO.lifecycle,"COMPLETION_CANDIDATE");
 assert.equal(r.publishAuthorized,false);assert.deepEqual(state,original);
});
test("stale evidence cannot change the canonical state",()=>{
 const state=make(),e=evidence();e.sourceTimestamp="2026-10-11T12:00:00Z";
 const r=proposeEngine22V3CanonicalObservation({canonical:state,degree:"MICRO",evidence:e});
 assert.equal(r.ok,false);assert.equal(r.proposedCanonical,null);
});
test("locked structure cannot advance",()=>{
 const state=make();state.degrees.MICRO.lifecycle="LOCKED";
 const r=proposeEngine22V3CanonicalObservation({canonical:state,degree:"MICRO",evidence:evidence()});
 assert.equal(r.ok,false);
});

test("append accepted evidence to durable-history candidate",()=>{
 const base=make();const r=proposeEngine22V3CanonicalObservation({canonical:base,degree:"MICRO",evidence:evidence()});
 assert.equal(r.ok,true);
 assert.equal(r.proposedCanonical.degrees.MICRO.history.length,1);
 assert.equal(r.proposedCanonical.degrees.MICRO.history[0].sourceBarId,"ES-5m-1");
 assert.equal(base.degrees.MICRO.history.length,0);
});
test("reject a wave-completion claim without count-bound proof",()=>{
 const base=make();base.degrees.MICRO.lifecycle="COMPLETION_CANDIDATE";
 const e={...evidence(),completionCandidate:false,completionConfirmed:true,structuralRuleId:"RULE-W1",independentConfirmation:true};
 const r=proposeEngine22V3CanonicalObservation({canonical:base,degree:"MICRO",evidence:e});
 assert.equal(r.ok,false);
 assert.ok(r.reasonCodes.includes("UNBOUND_COMPLETION_PROOF"));
});
test("bound wave-completion proof produces an auditable proposal only",()=>{
 const base=make();base.degrees.MICRO.lifecycle="COMPLETION_CANDIDATE";
 const e={...evidence(),completionCandidate:false,completionConfirmed:true,structuralRuleId:"RULE-W1",independentConfirmation:true};
 e.structuralProof={countId:base.degrees.MICRO.countId,degreeId:"MICRO",
  activeWave:"W1",sourceBarId:e.sourceBarId,sourceTimestamp:e.sourceTimestamp,
  ruleId:e.structuralRuleId,validated:true};
 const r=proposeEngine22V3CanonicalObservation({canonical:base,degree:"MICRO",evidence:e});
 assert.equal(r.ok,true);
 assert.equal(r.proposedCanonical.degrees.MICRO.activeWave,"W2");
 assert.equal(r.publishAuthorized,false);
});
