import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine22Display} from "../logic/engine22/wave/buildEngine22Display.js";
const legacy={subminute:{activeWave:"W3"},minute:{activeWave:"W3"},minor:{activeWave:"W5"},intermediate:{activeWave:"W3"},primary:{activeWave:"W5"}};
test("chart projects seven degrees and Submicro is unavailable absent canonical source",()=>{
 const a=buildEngine22Display({degreeStates:legacy,currentWavelength:{degrees:{micro:{}}}});
 assert.deepEqual(a.degreeOrder,["submicro","micro","subminute","minute","minor","intermediate","primary"]);
 assert.equal(a.degrees.submicro.active,false);
 assert.deepEqual(a.degrees.submicro.levels,[]);
 assert.equal(a.degrees.submicro.noExecution,true);
});
test("shadow migration candidate cannot masquerade as published Submicro",()=>{
 const a=buildEngine22Display({degreeStates:legacy,submicroCanonicalState:{
 degree:"SUBMICRO",countId:"S1",sequenceId:"Q1",parentContext:{degree:"MICRO"},
 publicationEligible:false,origin:{price:7782.75}}});
 assert.equal(a.degrees.submicro.active,false);
 assert.deepEqual(a.degrees.submicro.levels,[]);
});
