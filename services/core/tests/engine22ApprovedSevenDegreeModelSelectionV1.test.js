import test from "node:test";
import assert from "node:assert/strict";
import {selectApprovedSevenDegreeFibModelsV1 as select} from "../logic/engine22/research/selectApprovedSevenDegreeFibModelsV1.js";
const approved={activeWave:"W3",sourceCountId:"count-7",activeFibModel:{
 active:true,approved:true,modelKey:"w3-abc-v1",seriesId:"ESZ6",
 priceBasis:"RAW_UNADJUSTED_CONTRACT",modelOriginTime:"2026-10-14T10:00:00Z",
 direction:"UP",levels:{e0618:7815.75,e1000:7904}}};
test("auto-selects exact-approved model with full degree-specific Fib ladder",()=>{
 const r=select({degreeStates:{subminute:approved},resolvedContract:"ESZ6",priceBasis:"RAW_UNADJUSTED_CONTRACT"});
 assert.equal(r.models.subminute.levels.length,2);
 assert.equal(r.models.subminute.countId,"count-7");
 assert.equal(r.models.micro,undefined);
 assert.equal(r.degreeOrder.length,7);
});
test("never promotes provisional model or arbitrary old fallback",()=>{
 const v=select({degreeStates:{subminute:{...approved,activeFibModel:{...approved.activeFibModel,approved:false}}},resolvedContract:"ESZ6",priceBasis:"RAW_UNADJUSTED_CONTRACT"});
 assert.equal(v.models.subminute,undefined);
 assert.equal(v.reasons.subminute,"MODEL_NOT_APPROVED");
});
test("source mismatch, missing origin or missing count blocks touch",()=>{
 for(const state of [
  {...approved,sourceCountId:null},
  {...approved,activeFibModel:{...approved.activeFibModel,modelOriginTime:null}},
  approved,
 ]) {
  const r=select({degreeStates:{subminute:state},resolvedContract:"ESU6",priceBasis:"RAW_UNADJUSTED_CONTRACT"});
  assert.equal(r.models.subminute,undefined);
 }
});

test("shows missing source approval fields without promoting provisional structural models",()=>{
 const r=select({degreeStates:{subminute:{activeWave:"W3",activeFibModel:{active:true,modelKey:"W3_EXTENSION_LADDER",levels:{e1000:7904},direction:"UP"}}},resolvedContract:"ESZ6",priceBasis:"RAW_UNADJUSTED_CONTRACT"});
 assert.deepEqual(r.models,{});
 assert.ok(r.missingFieldsByDegree.subminute.includes("explicitApproval"));
 assert.ok(r.missingFieldsByDegree.subminute.includes("countId"));
 assert.ok(r.missingFieldsByDegree.subminute.includes("seriesId"));
 assert.ok(r.missingFieldsByDegree.subminute.includes("modelOriginTime"));
});
