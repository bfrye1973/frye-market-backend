import test from "node:test";
import assert from "node:assert/strict";
import {buildSevenDegreeShadowProjection} from "../logic/engine22/migration/buildSevenDegreeShadowProjection.js";
const micro={degree:"MICRO",countId:"M1",sequenceId:"Q1"};
const submicro={degree:"SUBMICRO",countId:"S1",sequenceId:"R1",parentContext:{degree:"MICRO",countId:"M1"}};
test("seven-degree shadow leaves legacy higher degrees unchanged and carries new isolated degrees",()=>{
 const old={subminute:{activeWave:"W3",marks:{W1:{price:7575}}},
 minute:{activeWave:"W3"},minor:{activeWave:"W5"},intermediate:{activeWave:"W3"},primary:{activeWave:"W5"}};
 const before=JSON.stringify(old);
 const r=buildSevenDegreeShadowProjection({legacyDegreeStates:old,microCount:micro,submicroCandidate:submicro});
 assert.equal(r.status,"READ_ONLY_STRUCTURAL_SHADOW");
 assert.deepEqual(r.degreeOrder,["SUBMICRO","MICRO","SUBMINUTE","MINUTE","MINOR","INTERMEDIATE","PRIMARY"]);
 assert.equal(JSON.stringify(old),before);
 assert.deepEqual(r.degrees.subminute,old.subminute);
 assert.equal(r.degrees.micro.countId,"M1");
 assert.equal(r.degrees.submicro.countId,"S1");
 assert.equal(r.publicationEligible,false);
 assert.equal(r.automationEligible,false);
 r.degrees.subminute.marks.W1.price=999;
 assert.equal(old.subminute.marks.W1.price,7575);
});
test("shadow refuses stale parent ID or duplicated count identity",()=>{
 for (const invalid of [{...submicro,parentContext:{degree:"MICRO",countId:"other"}},
 {...submicro,countId:"M1"},{...submicro,sequenceId:"Q1"}]){
  const r=buildSevenDegreeShadowProjection({microCount:micro,submicroCandidate:invalid});
  assert.equal(r.status,"INCOMPLETE");
  assert.equal(r.degrees.submicro,null);
  assert.ok(r.reasonCodes.includes("SUBMICRO_PARENT_OR_IDENTITY_INVALID"));
 }
});
test("shadow never manufactures unknown lower counts from old higher-degree state",()=>{
 const r=buildSevenDegreeShadowProjection({legacyDegreeStates:{minute:{activeWave:"W3"}}});
 assert.equal(r.degrees.submicro,null);
 assert.equal(r.degrees.micro,null);
 assert.equal(r.degrees.minute.activeWave,"W3");
 assert.equal(r.publicationEligible,false);
});
