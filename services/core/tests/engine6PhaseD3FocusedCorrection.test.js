import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEngine6Strategy1Phase4Contract } from "../logic/engine6/strategy1PermissionContract.js";
import { evaluateEngine6ZoneRotationDecision } from "../logic/engine6/evaluateZoneRotationDecision.js";

const identity = {laneId:"minute",strategyId:"intraday_scalp@10m",symbol:"ES",candidateId:"C1",zoneId:"Z1",setupClass:"NEGOTIATED_ZONE_ROTATION",identitySetupKey:"NEGOTIATED_ZONE_ROTATION",candidateIdentityVersion:"engine26.strategy1.v2"};
const candidate = { ...identity, direction:"LONG",directionState:"ACTIVE_LONG",currentPrice:5006,entryZone:{mid:5005} };
const reaction = { ...identity,evaluationAuthorized:true,engine3Strategy1QualifiedForEngine6:true,allowed:true,reactionConfirmed:false,authorizedReactionState:"WATCHING_AUTHORIZED_LOCATION",direction:"LONG" };
const participation = { ...identity,participationConfirmed:true,allowed:true,hardBlocked:false,direction:"LONG" };
const phase = ({c=candidate,r=reaction,p=participation,d=r.direction}={})=>evaluateEngine6Strategy1Phase4Contract({symbol:"ES",strategyId:"intraday_scalp@10m",engine26LocationCandidate:c,engine3Reaction:r,engine4Participation:p,direction:d});
test("qualified LONG with diagnostic reactionConfirmed false is accepted",()=>{
 const x=phase();assert.equal(x.allowed,true);assert.equal(x.reaction.reactionConfirmed,false);
 assert.ok(!x.blockers.includes("ENGINE26_NEGOTIATED_MIDLINE_ALREADY_REACHED"));
});
test("qualified SHORT with diagnostic reactionConfirmed false is accepted",()=>{
 const c={...candidate,direction:"SHORT",directionState:"ACTIVE_SHORT",currentPrice:5004};
 const r={...reaction,direction:"SHORT"},p={...participation,direction:"SHORT"};
 assert.equal(phase({c,r,p,d:"SHORT"}).allowed,true);
});
test("explicit unqualified reaction remains denied",()=>{
 const x=phase({r:{...reaction,engine3Strategy1QualifiedForEngine6:false}});
 assert.equal(x.allowed,false);assert.ok(x.blockers.includes("ENGINE3_STRATEGY1_NOT_QUALIFIED"));
});
test("Engine4 disagreement remains denied",()=>{
 const x=phase({p:{...participation,direction:"SHORT"}});
 assert.equal(x.allowed,false);assert.ok(x.blockers.includes("REACTION_PARTICIPATION_DIRECTION_MISMATCH"));
});
test("candidate invalidation remains denied",()=>{
 const x=phase({c:{...candidate,candidateInvalidated:true}});
 assert.equal(x.allowed,false);assert.ok(x.blockers.includes("CANDIDATE_INVALIDATED"));
});
test("old completed candidate is blocked by shadow identity memory",()=>{
 const x=phase();
 const ctx={eligibleForPermissionReview:true,candidateId:"C1",zoneId:"Z1",internals:{directionalAssessment:"SUPPORTIVE",timeframeValidity:["10m","30m","1h"].map(timeframe=>({timeframe,available:true}))}};
 const out=evaluateEngine6ZoneRotationDecision({candidate,reaction,participation,phase4:x,context:ctx,engine25Participation:{freshness:{intraday:{state:"FRESH"}}},completedTrip:{candidateId:"C1",midpointCompleted:true}});
 assert.equal(out.decision,"BLOCK");assert.equal(out.allowed,false);
});
test("fresh candidate after completed parent may requalify",()=>{
 const c={...candidate,priorCandidateId:"OLD",candidateLifecycleStartTime:"2026-10-20T16:00:00Z",zoneMemorySummary:{currentCandidateId:"C1",lifecycleStatus:"ACTIVE",objectiveCompletedAt:"2026-10-20T15:00:00Z"}};
 const x=phase({c});assert.equal(x.allowed,true);
 const ctx={eligibleForPermissionReview:true,candidateId:"C1",zoneId:"Z1",internals:{directionalAssessment:"SUPPORTIVE",timeframeValidity:["10m","30m","1h"].map(timeframe=>({timeframe,available:true}))}};
 const out=evaluateEngine6ZoneRotationDecision({candidate:c,reaction,participation,phase4:x,context:ctx,engine25Participation:{freshness:{intraday:{state:"FRESH"}}},completedTrip:{candidateId:"OLD",midpointCompleted:true}});
 assert.equal(out.decision,"ALLOW");assert.equal(out.allowed,false);
});
test("ALLOW versus REDUCE remain shadow-only with no permission flags",()=>{
 const x=phase();
 const common={candidate,reaction,participation,phase4:x,engine25Participation:{freshness:{intraday:{state:"FRESH"}}}};
 const context=p=>({eligibleForPermissionReview:true,candidateId:"C1",zoneId:"Z1",wave:{submicro:{alignedWithReaction:true},micro:{}},internals:{directionalAssessment:p,timeframeValidity:["10m","30m","1h"].map(timeframe=>({timeframe,available:true}))}});
 const a=evaluateEngine6ZoneRotationDecision({...common,context:context("SUPPORTIVE")});
 const b=evaluateEngine6ZoneRotationDecision({...common,context:context("MIXED")});
 assert.equal(a.decision,"ALLOW");assert.equal(b.decision,"REDUCE");
 for(const o of [a,b]){assert.equal(o.allowed,false);assert.equal(o.paperAllowed,false);assert.equal(o.canCreatePermission,false);assert.equal(o.reducedPermissionActivationAllowed,false);}
});
