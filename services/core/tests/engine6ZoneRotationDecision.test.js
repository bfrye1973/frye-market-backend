import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEngine6ZoneRotationDecision as decide } from "../logic/engine6/evaluateZoneRotationDecision.js";
const candidate={candidateId:"C1",zoneId:"Z1"};
const reaction={direction:"SHORT",candidateId:"C1",zoneId:"Z1"};
const participation={direction:"SHORT",candidateId:"C1",zoneId:"Z1"};
const phase4={applies:true,allowed:true,paperAllowed:true,planningAllowed:true,blockers:[],identity:{candidateId:"C1",zoneId:"Z1"}};
const context={eligibleForPermissionReview:true,candidateId:"C1",zoneId:"Z1",
 wave:{submicro:{confirmed:false,alignedWithReaction:true},micro:{parentConflict:true}},
 internals:{directionalAssessment:"SUPPORTIVE",timeframeValidity:["10m","30m","1h","4h"].map(timeframe=>({timeframe,available:true}))}};
const engine25Participation={freshness:{intraday:{state:"FRESH"}}};
const good={candidate,reaction,participation,phase4,context,engine25Participation};
const run=x=>decide({...good,...x});
test("supportive SHORT with bullish Micro remains shadow ALLOW, not live permission",()=>{
 const r=run({});assert.equal(r.decision,"ALLOW");assert.equal(r.allowed,false);
 assert.equal(r.canCreatePermission,false);assert.equal(r.evidence.submicroOwnerConfirmed,false);
 assert.ok(r.warnings.includes("MICRO_COUNTERTREND"));
});
test("adverse context is REDUCE proposal, no sizing or GO",()=>{
 const r=run({context:{...context,internals:{...context.internals,directionalAssessment:"CAUTION"}}});
 assert.equal(r.decision,"REDUCE");assert.equal(r.sizingFormula,null);assert.equal(r.paperAllowed,false);
});
test("mixed 10m/30m/1h is REDUCE recommendation only",()=>{
 assert.equal(run({context:{...context,internals:{...context.internals,directionalAssessment:"MIXED"}}}).decision,"REDUCE");
});
test("Phase4 developing Engine3 leads WAIT",()=>{
 const r=run({phase4:{...phase4,allowed:false,blockers:["ENGINE3_REACTION_WAITING"]}});
 assert.equal(r.decision,"WAIT");
});
test("Phase4 identity conflict blocks",()=>{
 assert.equal(run({phase4:{...phase4,allowed:false,blockers:["CANDIDATE_ID_MISMATCH"]}}).decision,"BLOCK");
});
test("Engine4 directional conflict blocks",()=>{
 assert.equal(run({participation:{...participation,direction:"LONG"}}).decision,"BLOCK");
});
test("Engine4 hard block blocks",()=>{
 assert.equal(run({participation:{...participation,hardBlocked:true}}).decision,"BLOCK");
});
test("missing or stale Engine25 never gives ALLOW or REDUCE",()=>{
 assert.equal(run({engine25Participation:null}).decision,"WAIT");
 assert.equal(run({engine25Participation:{freshness:{intraday:{state:"STALE"}}}}).decision,"WAIT");
});
test("missing 30m observation prevents context permission",()=>{
 const invalid={...context,internals:{...context.internals,timeframeValidity:context.internals.timeframeValidity.map(v=>v.timeframe==="30m"?{...v,available:false}:v)}};
 assert.equal(run({context:invalid}).decision,"WAIT");
});
test("4h absent is backdrop warning not automatically disqualifying",()=>{
 const changed={...context,internals:{...context.internals,timeframeValidity:context.internals.timeframeValidity.filter(v=>v.timeframe!=="4h")}};
 const r=run({context:changed});assert.equal(r.decision,"ALLOW");
 assert.ok(r.warnings.includes("ENGINE25_4H_BACKDROP_UNAVAILABLE"));
});
test("completed old trip exact identity is blocked",()=>{
 assert.equal(run({completedTrip:{candidateId:"C1",midpointCompleted:true}}).decision,"BLOCK");
});
test("new ID alone does not prove a fresh candidate generation",()=>{
 const r=run({completedTrip:{candidateId:"PREVIOUS",midpointCompleted:true}});
 assert.equal(r.decision,"WAIT");assert.ok(r.reasons.includes("FRESH_CANDIDATE_LIFECYCLE_PROOF_PENDING"));
});
test("verified promoted generation may qualify with independent fresh reaction",()=>{
 const r=run({completedTrip:{candidateId:"PREVIOUS",midpointCompleted:true},
 candidate:{...candidate,priorCandidateId:"PREVIOUS",promotedFromTargetCompletion:true,candidateLifecycleStartTime:"2026-10-20T16:00:00Z",
 zoneMemorySummary:{currentCandidateId:"C1",candidateLifecycleStartTime:"2026-10-20T16:00:00Z",objectiveCompletedAt:"2026-10-20T15:00:00Z",lifecycleStatus:"ACTIVE"}}});
 assert.equal(r.decision,"ALLOW");
 assert.ok(r.warnings.includes("FRESH_CANDIDATE_AFTER_COMPLETED_TRIP"));
});
test("historical objectiveCompletedAt does not itself terminate a fresh candidate",()=>{
 const r=run({candidate:{...candidate,zoneMemorySummary:{currentCandidateId:"OLD",objectiveCompletedAt:"2026-10-20T15:00:00Z"}}});
 assert.equal(r.decision,"ALLOW");
});
test("current matching memory with terminal lifecycle blocks",()=>{
 assert.equal(run({candidate:{...candidate,zoneMemorySummary:{currentCandidateId:"C1",lifecycleStatus:"COMPLETED",objectiveCompletedAt:"2026-10-20T15:00:00Z"}}}).decision,"BLOCK");
});
test("promoted candidate without old provenance waits",()=>{
 assert.equal(run({candidate:{...candidate,promotedFromTargetCompletion:true}}).decision,"WAIT");
});
test("unconfirmed Fib levels do not become owner confirmation",()=>{
 const r=run({context:{...context,wave:{...context.wave,submicro:{...context.wave.submicro,levels:[{status:"WATCH",price:7700}]}}}});
 assert.equal(r.evidence.submicroOwnerConfirmed,false);assert.equal(r.decision,"ALLOW");
});
test("existing Phase4 fails means never upgrade to GO",()=>{
 const r=run({phase4:{...phase4,allowed:false,blockers:["ENGINE4_PARTICIPATION_WAITING"]},context:{...context,internals:{...context.internals,directionalAssessment:"SUPPORTIVE"}}});
 assert.equal(r.decision,"WAIT");assert.equal(r.allowed,false);
});

test("REDUCE never activates without Engine7 receipt",()=>{
 const adverse={...context,internals:{...context.internals,directionalAssessment:"CAUTION"}};
 const r=run({context:adverse,reduceSizingAcknowledgment:{candidateId:"C1",zoneId:"Z1",decision:"REDUCE",enforced:false,finalContracts:3,engine7SizingOwner:true}});
 assert.equal(r.decision,"REDUCE");assert.equal(r.reduceSizingEnforcementVerified,false);
 assert.equal(r.reducedPermissionActivationAllowed,false);
 assert.ok(r.warnings.includes("REDUCE_NOT_ENFORCED_BY_ENGINE7"));
});
test("hypothetical bounded Engine7 REDUCE receipt remains non-authoritative shadow",()=>{
 const adverse={...context,internals:{...context.internals,directionalAssessment:"CAUTION"}};
 const r=run({context:adverse,reduceSizingAcknowledgment:{candidateId:"C1",zoneId:"Z1",decision:"REDUCE",enforced:true,finalContracts:2,engine7SizingOwner:true}});
 assert.equal(r.decision,"REDUCE");assert.equal(r.reduceSizingEnforcementVerified,true);
 assert.equal(r.paperAllowed,false);assert.equal(r.reducedPermissionActivationAllowed,false);
});
test("REDUCE receipt for wrong candidate fails to verify",()=>{
 const adverse={...context,internals:{...context.internals,directionalAssessment:"MIXED"}};
 const r=run({context:adverse,reduceSizingAcknowledgment:{candidateId:"OLD",zoneId:"Z1",decision:"REDUCE",enforced:true,finalContracts:1,engine7SizingOwner:true}});
 assert.equal(r.reduceSizingEnforcementVerified,false);
});
