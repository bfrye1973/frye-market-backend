import test from "node:test";
import assert from "node:assert/strict";
import {ENGINE22_V3_SCHEMA,ENGINE22_V3_DEGREES,ENGINE22_V3_PARENT} from "../logic/engine22/v3/canonicalStructure.js";
import {buildEngine22V3ShadowSnapshot} from "../logic/engine22/v3/buildShadowSnapshot.js";
const state=()=>({schema:ENGINE22_V3_SCHEMA,symbol:"ES",sourceTimestamp:"2026-10-11T20:00:00Z",noPermissionCreated:true,noExecution:true,
 degrees:Object.fromEntries(ENGINE22_V3_DEGREES.map((d,i)=>[d,{
  degreeId:d,countId:"C"+i,sequenceId:"S"+i,
  parentDegree:ENGINE22_V3_PARENT[d],parentWave:ENGINE22_V3_PARENT[d]?"W3":null,
  activeWave:"W3",lifecycle:"DEVELOPING",
  anchors:d==="MICRO"?{
   W1_LOW:{price:7675,time:"2026-10-01 07:00",status:"CONFIRMED"},
   W1_HIGH:{price:7805,time:"2026-10-02 07:00",status:"CONFIRMED"},
   W2_LOW:{price:7757.75,time:"2026-10-05 03:00",status:"CONFIRMED"},
  }:{},history:[],provenance:{},invalidation:{},fibModel:{},
 }]))});
test("seven-degree projections share the exact canonical count identity",()=>{
 const s=state(),r=buildEngine22V3ShadowSnapshot({canonical:s});
 assert.equal(r.available,true);
 assert.equal(Object.keys(r.degreeStates.degrees).length,7);
 for(const d of ENGINE22_V3_DEGREES){
  const k=d.toLowerCase();
  assert.equal(r.degreeStates.degrees[k].sourceCountId,s.degrees[d].countId);
  assert.equal(r.currentWavelength.degrees[k].sourceCountId,s.degrees[d].countId);
 }
 assert.equal(r.shadowOnly,true);
 assert.equal(r.microExecutionContext,null);
 assert.equal(r.noExecution,true);
});
test("no canonical state leads to no projection",()=>{
 assert.equal(buildEngine22V3ShadowSnapshot().available,false);
});

test("completed market evidence changes shadow canonical lifecycle and all projections together",()=>{
 const canonical=state();
 canonical.degrees.MICRO.lastEvaluatedEvidenceTimestamp="2026-10-11T12:00:00Z";
 const before=structuredClone(canonical);
 const r=buildEngine22V3ShadowSnapshot({
   canonical,evidenceByDegree:{MICRO:{
     completed:true,sourceTimestamp:"2026-10-11T12:05:00Z",
     sourceBarId:"ES-5m-100",sourceTimeframe:"5m",completionCandidate:true,
   }},
 });
 assert.equal(r.available,true);
 assert.equal(r.degreeStates.degrees.micro.lifecycle,"COMPLETION_CANDIDATE");
 assert.equal(r.currentWavelength.degrees.micro.lifecycle,"COMPLETION_CANDIDATE");
 assert.equal(r.engine22Display.degrees.micro.badge,"COMPLETION_CANDIDATE");
 assert.equal(r.crossDegreeWatch.alerts.some(x=>x.sourceDegree==="MICRO"),true);
 assert.deepEqual(canonical,before);
 assert.equal(r.microExecutionContext,null);
 assert.equal(r.noExecution,true);
});
test("stale market evidence blocks all seven shadow outputs",()=>{
 const canonical=state();
 canonical.degrees.MICRO.lastEvaluatedEvidenceTimestamp="2026-10-11T12:05:00Z";
 const r=buildEngine22V3ShadowSnapshot({
 canonical,evidenceByDegree:{MICRO:{
 completed:true,sourceTimestamp:"2026-10-11T12:05:00Z",
 sourceBarId:"ES-5m-100",sourceTimeframe:"5m",completionCandidate:true,
 }}});
 assert.equal(r.available,false);
 assert.ok(r.reasonCodes.includes("DUPLICATE_OR_OLDER_OBSERVATION"));
});
