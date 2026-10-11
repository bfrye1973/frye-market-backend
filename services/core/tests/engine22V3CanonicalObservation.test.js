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
  ruleId:e.structuralRuleId,validated:true,anchorKey:"W1_HIGH",
  anchor:{price:7852.75,time:"2026-10-11T12:03:00Z"}};
 const r=proposeEngine22V3CanonicalObservation({canonical:base,degree:"MICRO",evidence:e});
 assert.equal(r.ok,true);
 assert.equal(r.proposedCanonical.degrees.MICRO.activeWave,"W2");
 assert.equal(r.proposedCanonical.degrees.MICRO.anchors.W1_HIGH.price,7852.75);
 assert.equal(r.proposedCanonical.degrees.MICRO.anchors.W1_HIGH.status,"CONFIRMED");
 assert.equal(r.publishAuthorized,false);
});

test("completion evidence without a confirmed structural endpoint is rejected",()=>{
 const base=make();base.degrees.MICRO.lifecycle="COMPLETION_CANDIDATE";
 const e={...evidence(),completionCandidate:false,completionConfirmed:true,structuralRuleId:"RULE-W1",independentConfirmation:true};
 e.structuralProof={countId:base.degrees.MICRO.countId,degreeId:"MICRO",activeWave:"W1",
 sourceBarId:e.sourceBarId,sourceTimestamp:e.sourceTimestamp,ruleId:e.structuralRuleId,validated:true};
 const r=proposeEngine22V3CanonicalObservation({canonical:base,degree:"MICRO",evidence:e});
 assert.equal(r.ok,false);
 assert.ok(r.reasonCodes.includes("UNBOUND_COMPLETION_PROOF"));
});

test("canonical proposal records source pivot identity for deduplication",()=>{
 const base=make();const e=evidence();e.candidatePivotBarId="pivot-42";
 const r=proposeEngine22V3CanonicalObservation({canonical:base,degree:"MICRO",evidence:e});
 assert.equal(r.ok,true);
 assert.equal(r.proposedCanonical.degrees.MICRO.lastCandidateEvidenceId,"pivot-42");
});

test("market candles can independently supply bound completion proof to canonical proposal",()=>{
 const base=make(),degree=base.degrees.MICRO;
 degree.lifecycle="COMPLETION_CANDIDATE";
 degree.sequenceDirection="UP";
 degree.minimumReversalTicks=8;
 degree.confirmationRule={
  id:"W1-CONFIRM",passed:true,countId:degree.countId,wave:"W1",
  evidenceBarId:"confirm",reversalBarId:"confirm"
 };
 const bars=[
  {sourceBarId:"before",sourceTimestamp:"2026-10-11T12:00:00Z",timeframe:"5m",closed:true,high:13,low:9,close:11},
  {sourceBarId:"pivot",sourceTimestamp:"2026-10-11T12:05:00Z",timeframe:"5m",closed:true,high:16,low:10,close:15},
  {sourceBarId:"confirm",sourceTimestamp:"2026-10-11T12:10:00Z",timeframe:"5m",closed:true,high:14,low:8,close:13},
  {sourceBarId:"after",sourceTimestamp:"2026-10-11T12:15:00Z",timeframe:"5m",closed:true,high:13,low:9,close:11}
 ];
 const waveCandidate={
  countId:degree.countId,degreeId:"MICRO",activeWave:"W1",sequenceDirection:"UP",
  side:"HIGH",price:16,sourceBarId:"pivot",sourceTimeframe:"5m",
  sourceTimestamp:bars[1].sourceTimestamp,evidenceConfirmedAt:bars[2].sourceTimestamp,
 };
 const evidence={completed:true,sourceTimestamp:bars[2].sourceTimestamp,
  sourceBarId:"confirm",sourceTimeframe:"5m",completionConfirmed:true,
  structuralRuleId:"W1-CONFIRM",independentConfirmation:true};
 const r=proposeEngine22V3CanonicalObservation({
  canonical:base,degree:"MICRO",evidence,marketBars:bars,waveCandidate
 });
 assert.equal(r.ok,true,JSON.stringify(r.reasonCodes));
 assert.equal(r.proposedCanonical.degrees.MICRO.activeWave,"W2");
 assert.equal(r.proposedCanonical.degrees.MICRO.anchors.W1_HIGH.price,16);
 assert.equal(r.publishAuthorized,false);
 const noReversal=structuredClone(bars);
 noReversal[2].high=16;noReversal[2].close=15;
 noReversal[3].high=16;noReversal[3].close=15;
 const invalid=proposeEngine22V3CanonicalObservation({
  canonical:base,degree:"MICRO",evidence,marketBars:noReversal,waveCandidate
 });
 assert.equal(invalid.ok,false);
 assert.ok(invalid.reasonCodes.includes("MINIMUM_REVERSAL_NOT_CONFIRMED"));
});
