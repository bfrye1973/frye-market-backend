import test from "node:test";
import assert from "node:assert/strict";
import {evaluateEngine22V3WaveTransition as run} from "../logic/engine22/v3/evaluateWaveTransition.js";
const state=(activeWave="W1",lifecycle="DEVELOPING")=>({activeWave,lifecycle,lastEvaluatedEvidenceTimestamp:"2026-10-10T10:00:00Z"});
const evidence=(overrides={})=>({completed:true,sourceTimestamp:"2026-10-10T10:05:00Z",sourceBarId:"bar-11",sourceTimeframe:"5m",...overrides});
test("reject duplicate or stale observation",()=>{
  const r=run({degreeState:state(),evidence:evidence({sourceTimestamp:"2026-10-10T10:00:00Z"})});
  assert.equal(r.ok,false);
});
test("requires completed identified bar",()=>{
  assert.equal(run({degreeState:state(),evidence:evidence({completed:false})}).ok,false);
});
test("candidate does not advance the wave",()=>{
  const r=run({degreeState:state(),evidence:evidence({completionCandidate:true})});
  assert.equal(r.proposal.activeWave,"W1");
  assert.equal(r.proposal.lifecycle,"COMPLETION_CANDIDATE");
  assert.equal(r.publishAuthorized,false);
});
test("candidate advances only with confirmed structural evidence",()=>{
  const r=run({degreeState:state("W2","COMPLETION_CANDIDATE"),evidence:evidence({
    completionConfirmed:true,independentConfirmation:true,structuralRuleId:"CONFIRM-W2"})});
  assert.equal(r.proposal.activeWave,"W3");
  assert.equal(r.advanceProposed,true);
  assert.equal(r.publishAuthorized,false);
});
test("W5 triggers parent review without inventing a parent wave",()=>{
  const r=run({degreeState:state("W5","COMPLETION_CANDIDATE"),evidence:evidence({
    completionConfirmed:true,independentConfirmation:true,structuralRuleId:"CONFIRM-W5"})});
  assert.equal(r.proposal.activeWave,"W5");
  assert.equal(r.proposal.parentTransitionReviewRequired,true);
});
test("manual locks block progression",()=>{
  const r=run({degreeState:state("W1","LOCKED"),evidence:evidence({completionConfirmed:true})});
  assert.equal(r.ok,false);
});
test("invalidated count requires recount",()=>{
  const r=run({degreeState:state(),evidence:evidence({invalidationConfirmed:true})});
  assert.equal(r.proposal.lifecycle,"RECOUNT_REQUIRED");
});
