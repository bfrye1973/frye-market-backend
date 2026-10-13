import test from "node:test";
import assert from "node:assert/strict";
import {ENGINE22_V3_SCHEMA,ENGINE22_V3_DEGREES,ENGINE22_V3_PARENT} from "../logic/engine22/v3/canonicalStructure.js";
import {buildEngine22V3CrossDegreeWatch} from "../logic/engine22/v3/buildCrossDegreeWatch.js";
const make=()=>({schema:ENGINE22_V3_SCHEMA,symbol:"ES",noPermissionCreated:true,noExecution:true,
 degrees:Object.fromEntries(ENGINE22_V3_DEGREES.map((d,i)=>[d,{
  degreeId:d,countId:"C"+i,sequenceId:"S"+i,parentDegree:ENGINE22_V3_PARENT[d],
  parentWave:ENGINE22_V3_PARENT[d]?"W3":null,activeWave:"W3",
  lifecycle:"DEVELOPING",anchors:{},history:[],provenance:{},invalidation:{},fibModel:{},
 }]))});
test("child maturity creates only a parent watch, never parent completion",()=>{
 const s=make();s.degrees.MICRO.lifecycle="COMPLETION_CANDIDATE";
 const before=structuredClone(s),r=buildEngine22V3CrossDegreeWatch({canonical:s});
 assert.equal(r.available,true);
 assert.equal(r.alerts.length,1);
 assert.equal(r.alerts[0].degree,"SUBMINUTE");
 assert.equal(r.alerts[0].requiresParentStructuralConfirmation,true);
 assert.equal(r.alerts[0].noExecution,true);
 assert.deepEqual(s,before);
});
test("unconfirmed children cannot manufacture parent warnings",()=>{
 assert.equal(buildEngine22V3CrossDegreeWatch({canonical:make()}).alerts.length,0);
});
