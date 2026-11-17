// Engine 6E cross-engine release compatibility: authoritative working-wave publication
// is an observation, never a second market permission or execution authority.
import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine6AdvisoryContext} from "../logic/engine6/6b-market-intelligence/buildEngine6AdvisoryContext.js";
import {buildNoTradeFunnel} from "../logic/engine6/6e-funnel/buildNoTradeFunnel.js";
import {ownerApprovedWorkingSelection} from "../logic/engine22/wave/ownerApprovedWorkingSelectionV1.js";
const candidate=(direction)=>({ok:true,symbol:"ES",generatedAt:"2026-11-16T18:00:00.000Z",strategies:{
 "intraday_scalp@10m":{
 engine26LocationCandidate:{candidateId:"CAND-"+direction,zoneId:"ZONE-"+direction,evaluationAuthorized:true,currentPrice:7700},
 confluence:{context:{reaction:{paperScalpReaction:{allowed:true,engine3Strategy1QualifiedForEngine6:true,direction}},
 volume:{engine4AuthorizedReactionParticipation:{allowed:true,participationConfirmed:true,hardBlocked:false,direction}}}},
 permission:{paper:{allowed:true,decision:"FAST_INTRADAY_PAPER_ALLOW",direction,locked:true}},
 engine26ProposedGeometry:{geometryReady:true,geometryFeasible:true},
 engine9OfficialManagementPlan:{managementReady:true,runnerPlan:{enabled:false}},
 engine7PositionSizing:{finalSizingReady:true,finalContracts:3},
 engine8PaperOrder:{status:"READY_TO_CREATE_PAPER_ORDER",executable:true,planId:"PLAN-"+direction},
 engine25Context:{state:"MIXED",dataDegraded:true},
 engine29CrossMarketStress:{state:"DOWN",dataDegraded:true},
 engine27MinuteDecision:{decisionState:"NOT_READY",readiness:{plannerReady:false}}
 }}});
function selection(){
 const degrees={};
 for(const d of ["primary","intermediate","minor","minute","subminute","micro","submicro"])
 degrees[d]={degree:d,available:true,activeWave:"W3",direction:"UP",
  stage:"DEVELOPING",selectionStatus:"OWNER_SELECTED_WORKING",
  modelVersion:"engine22.owner-working.v1",sourcePath:"strategies/engine22",
  completionConfirmed:false};
 Object.assign(degrees.minute,{activeWave:"W2"});
 Object.assign(degrees.subminute,{activeWave:"W3",parentDegree:"minute",parentWave:"W2"});
 Object.assign(degrees.micro,{activeWave:"W5",direction:"UP",parentDegree:"subminute",parentWave:"W3"});
 Object.assign(degrees.submicro,{activeWave:"W2",direction:"DOWN",parentDegree:"micro",parentWave:"W5"});
 return {schema:"engine22.authorizedWorkingStructure.v1",mode:"READ_ONLY",
  status:"COMPLETE_WORKING_SELECTION",noExecution:true,noWaveTransition:true,
  modelFingerprint:"a".repeat(64),publicationRevision:7,
  selectionApprovalReference:"OWNER_WORKING_W2_W5_TEST_ONLY",
  publishedAt:"2026-11-16T18:00:00Z",degrees};
}
for(const direction of ["LONG","SHORT"]){
 test(`Phase4-qualified ${direction} survives absent, opposed and research-only 22/25/29/27 context`,()=>{
   const x=candidate(direction),before=structuredClone(x);
   let v=buildNoTradeFunnel(x);
   assert.equal(v.firstFailedGate,"G11");
   assert.ok(v.gates.slice(0,11).every(g=>g.state==="PASS"));
   const contextBefore=buildEngine6AdvisoryContext({snapshot:x});
   assert.equal(contextBefore.wave.available,false);
   x.strategies["intraday_scalp@10m"].engine22WaveStrategy={authorizedWorkingStructure:selection()};
   const published=buildEngine6AdvisoryContext({snapshot:x,engine25Participation:{
    timestamp:"2026-11-16T00:00:00Z",freshness:{intraday:{state:"STALE"}},
    participation:{distributionPressure:{state:"CAUTION"}}
   },engine29Stress:{timestamp:"2026-11-16T00:00:00Z",dataDegraded:true,tacticalState:"DOWN"}});
   assert.equal(published.wave.available,true);
   assert.equal(published.wave.ownerRevision,7);
   assert.equal(published.wave.submicro.activeWave,"W2");
   assert.equal(published.wave.submicro.workingDirection,"DOWN");
   assert.equal(published.wave.submicro.stage,"DEVELOPING");
   assert.equal(published.wave.submicro.completionConfirmed,false);
   assert.equal(published.wave.micro.activeWave,"W5");
   assert.equal(published.wave.micro.workingDirection,"UP");
   assert.equal(published.wave.micro.completionConfirmed,false);
   assert.equal(published.marketHealth.intradayFreshness,"STALE");
   assert.equal(published.intraday.dataDegraded,true);
   x.strategies["intraday_scalp@10m"].engine6AdvisoryContext=published;
   v=buildNoTradeFunnel(x);
   assert.equal(v.firstFailedGate,"G11");
   assert.ok(v.gates.slice(0,11).every(g=>g.state==="PASS"));
   // A research-only revision cannot masquerade as authorized working.
   x.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure.degrees.micro.selectionStatus="RESEARCH_ONLY";
   const research=buildEngine6AdvisoryContext({snapshot:x});
   assert.equal(research.wave.available,false);
   assert.equal(research.noEntryVeto,true);
   v=buildNoTradeFunnel(x);
   assert.equal(v.firstFailedGate,"G11");
   assert.equal(v.gates[5].state,"PASS");
   assert.equal(x.strategies["intraday_scalp@10m"].permission.paper.allowed,true);
   assert.equal(before.strategies["intraday_scalp@10m"].permission.paper.locked,true);
 });
}

test("merged Engine22 revision 7 exact owner wave hierarchy is valid read-only Engine6E context",()=>{
 const owner=ownerApprovedWorkingSelection;
 assert.equal(owner.selectionRevision,7);
 assert.equal(owner.approvalReference,"OWNER_20261116_LATEST_MICRO_SUBMINUTE_ABC_SUBMICRO_W2_MINUTE_W2");
 for(const [degree,wave,direction,parentDegree,parentWave] of [
  ["submicro","W2","DOWN","micro","C"],
  ["micro","C","DOWN","subminute","C"],
  ["subminute","C","DOWN","minute","W2"],
  ["minute","W2","DOWN","minor","W3_OWNER_WORKING_RESEARCH"]
 ]){
  const d=owner.degrees[degree];
  assert.equal(d.activeWave,wave,degree);
  assert.equal(d.direction,direction,degree);
  assert.equal(d.parentDegree,parentDegree,degree);
  assert.equal(d.parentWave,parentWave,degree);
  assert.ok(d.stage.includes("DEVELOPING_OWNER_RESEARCH"),degree);
 }
 // Construct a STRICT syntactically valid publication from the actual owner
 // manifest fields. This tests consumer compatibility; the Engine22 publisher
 // and its own CI separately verify the full runtime emitted publication.
 const packet=selection();
 packet.publicationRevision=owner.selectionRevision;
 packet.selectionApprovalReference=owner.approvalReference;
 for(const degree of ["submicro","micro","subminute","minute"]){
  const entry=owner.degrees[degree];
  Object.assign(packet.degrees[degree],{
   activeWave:entry.activeWave,direction:entry.direction,stage:entry.stage,
   modelVersion:entry.modelVersion,
   parentDegree:entry.parentDegree,parentWave:entry.parentWave,
   sourcePath:"currentWavelength.degrees."+degree+"."+entry.key,
   selectionStatus:"OWNER_SELECTED_WORKING",completionConfirmed:false
  });
 }
 packet.degrees.minor.activeWave="W3_OWNER_WORKING_RESEARCH";
 for(const direction of ["LONG","SHORT"]){
  const x=candidate(direction);
  x.strategies["intraday_scalp@10m"].engine22WaveStrategy={authorizedWorkingStructure:structuredClone(packet)};
  const ctx=buildEngine6AdvisoryContext({snapshot:x});
  assert.equal(ctx.wave.available,true);
  assert.equal(ctx.wave.ownerRevision,7);
  assert.equal(ctx.wave.submicro.activeWave,"W2");
  assert.equal(ctx.wave.submicro.workingDirection,"DOWN");
  assert.equal(ctx.wave.submicro.completionConfirmed,false);
  assert.equal(ctx.wave.micro.activeWave,"C");
  assert.equal(ctx.wave.micro.workingDirection,"DOWN");
  assert.equal(ctx.wave.micro.completionConfirmed,false);
  const funnel=buildNoTradeFunnel(x);
  assert.equal(funnel.firstFailedGate,"G11");
  assert.equal(funnel.gates[5].state,"PASS");
 }
});
