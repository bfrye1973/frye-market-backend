import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEngine6Strategy1Phase4Contract as phase4 } from "../logic/engine6/6a-trade-qualification/index.js";
import { buildEngine6ZoneRotationContext as contextBuilder } from "../logic/engine6/6b-market-intelligence/index.js";
import { evaluateEngine6ZoneRotationDecision as decide } from "../logic/engine6/6c-trade-decision/index.js";
import { gateNewStrategy1PaperPermission as gate } from "../logic/engine6/6d-paper-permission/buildStrategy1PermissionGate.js";
import { createEngine6ApprovedPaperPermissionLock } from "../logic/engine6/6d-paper-permission/buildApprovedPaperPermissionLock.js";
const id={laneId:"minute",strategyId:"intraday_scalp@10m",symbol:"ES",candidateId:"C7790",zoneId:"Z7790",setupClass:"NEGOTIATED_ZONE_ROTATION",identitySetupKey:"NEGOTIATED_ZONE_ROTATION",candidateIdentityVersion:"engine26.strategy1.v2",setupGrade:"A+++"};
function scene(direction="SHORT"){
 const candidate={...id,active:true,status:"ACTIVE",candidateLifecycleStartTime:"G1",direction,entryZone:{mid:7790},currentPrice:direction==="SHORT"?7789:7791};
 const reaction={...id,evaluationAuthorized:true,engine3Strategy1QualifiedForEngine6:true,allowed:true,reactionConfirmed:false,authorizedReactionState:"WATCHING_AUTHORIZED_LOCATION",direction};
 const participation={...id,participationConfirmed:true,allowed:true,hardBlocked:false,direction};
 const handoff={candidateId:id.candidateId,zoneId:id.zoneId,evaluationAuthorized:true};
 return {candidate,reaction,participation,handoff};
}
const wave={currentWavelength:{degrees:{submicro:{activeWave:"W2",direction:"DOWN",ownerSubmicroW2:{confirmationStatus:"OWNER_COUNT_CANDLE_CONFIRMATION_PENDING",levels:[{status:"WATCH"}]}},micro:{direction:"UP",ownerMicroW3:{direction:"UP"}}}}};
function internals(dir="SHORT"){return {freshness:{intraday:{state:"FRESH"}},participation:{distributionPressure:{state:"DETERIORATING",oneHourTrend:{state:dir==="SHORT"?"RISING":"EASING"},thirtyMinuteConfirmation:{state:dir==="SHORT"?"SELLING_PRESSURE_CONFIRMED":"BUYING_RECOVERY_CONFIRMED"},tenMinuteAcceleration:{state:dir==="SHORT"?"FAST_SELLING_ACCELERATION_CONFIRMED":"FAST_BUYING_RECOVERY_CONFIRMED"},observations:{"10m":{available:true},"30m":{available:true},"1h":{available:true},"4h":{available:false}}}}};}
function evaluate(sceneData=scene(),opts={}){
 const {candidate,reaction,participation}=sceneData;
 const p=phase4({symbol:"ES",strategyId:id.strategyId,engine26LocationCandidate:candidate,engine3Reaction:reaction,engine4Participation:participation,direction:reaction.direction});
 const market=opts.market===undefined?internals(reaction.direction):opts.market;
 const w=opts.wave??wave;
 const ctx=contextBuilder({candidate,reaction,participation,engine22WaveStrategy:w,engine25Participation:market});
 const d=decide({candidate,reaction,participation,phase4:p,context:ctx,engine25Participation:market,completedTrip:opts.completedTrip});
 const raw={paper:{decision:"FAST_INTRADAY_PAPER_ALLOW",allowed:p.allowed,paperAllowed:p.paperAllowed,planningAllowed:p.planningAllowed,direction:reaction.direction,candidateId:id.candidateId,zoneId:id.zoneId,locked:false},permission:"ALLOW"};
 return {p,ctx,d,permission:gate(raw,d)};
}
test("7790 upper negotiated-zone SHORT: bullish Micro does not prohibit supportive SHORT",()=>{
 const r=evaluate();assert.equal(r.p.allowed,true);assert.equal(r.ctx.internals.directionalAssessment,"SUPPORTIVE");assert.equal(r.d.decision,"ALLOW");assert.equal(r.permission.paper.allowed,true);assert.equal(r.ctx.wave.submicro.confirmed,false);assert.ok(r.ctx.warnings.includes("COUNTERTREND_TO_MICRO"));
});
test("fresh lower-zone reversal LONG during bearish broader parent remains eligible",()=>{
 const r=evaluate(scene("LONG"));assert.equal(r.p.allowed,true);assert.equal(r.d.decision,"ALLOW");assert.equal(r.permission.paper.direction,"LONG");assert.equal(r.permission.paper.allowed,true);
});
test("missing 4h observation warns but valid tactical 10m 30m 1h permits",()=>{const r=evaluate();assert.equal(r.d.decision,"ALLOW");assert.equal(r.d.evidence.backdrop,"UNAVAILABLE");});
test("market recovery opposing SHORT classifies REDUCE not three-contract GO",()=>{const s=scene();const r=evaluate(s,{market:internals("LONG")});assert.equal(r.d.decision,"REDUCE");assert.equal(r.permission.paper.allowed,false);});
test("stale tactical market context WAIT no new GO",()=>{const m=internals();m.freshness.intraday.state="STALE";const r=evaluate(scene(),{market:m});assert.equal(r.d.decision,"WAIT");assert.equal(r.permission.paper.allowed,false);});
test("Engine3 vs Engine4 direction conflict blocks",()=>{const s=scene();s.participation.direction="LONG";const r=evaluate(s);assert.equal(r.d.decision,"BLOCK");assert.equal(r.permission.paper.allowed,false);});
test("candidate terminal invalidation blocks",()=>{const s=scene();s.candidate.candidateInvalidated=true;const r=evaluate(s);assert.equal(r.d.decision,"BLOCK");assert.equal(r.permission.paper.allowed,false);});
test("completed old candidate cannot reopen",()=>{const r=evaluate(scene(),{completedTrip:{candidateId:"C7790",midpointCompleted:true}});assert.equal(r.d.decision,"BLOCK");assert.equal(r.permission.paper.allowed,false);});
test("fresh promoted candidate after old completion retains independent entry potential",()=>{
 const s=scene("LONG");s.candidate.priorCandidateId="OLD";s.candidate.promotedFromTargetCompletion=true;s.candidate.zoneMemorySummary={currentCandidateId:"C7790",lifecycleStatus:"ACTIVE",candidateLifecycleStartTime:"G1",objectiveCompletedAt:"EARLIER"};
 const r=evaluate(s,{completedTrip:{candidateId:"OLD",midpointCompleted:true}});assert.equal(r.d.decision,"ALLOW");assert.equal(r.permission.paper.allowed,true);
});
test("existing valid GO remains after weakened context or reaction authorization withdrawn",()=>{
 const s=scene();const l=createEngine6ApprovedPaperPermissionLock(()=> "T");
 const ctx={candidate:s.candidate,reactionHandoff:s.handoff};
 const p={paper:{...evaluate(s).permission.paper,locked:true,candidateLifecycleStartTime:"G1",reasonCodes:[]}};
 l.rememberEngine6ApprovedPaperPermission(p,ctx);
 const later={candidate:{...s.candidate,active:false,status:"TRAVELING"},reactionHandoff:{...s.handoff,evaluationAuthorized:false}};
 assert.equal(l.applyEngine6ApprovedPaperPermissionLock({paper:{allowed:false}},later).paper.allowed,true);
});
test("real and broker execution never enabled by permission gate",()=>{
 for(const s of [scene("SHORT"),scene("LONG")]){const r=evaluate(s);assert.notEqual(r.permission.realExecutionAllowed,true);assert.notEqual(r.permission.brokerExecutionAllowed,true);}
});
