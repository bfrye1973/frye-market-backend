import {buildEngine27WorkingSevenDegrees} from "../logic/engine27/v2/buildWorkingSevenDegrees.js";
import test from "node:test";
import assert from "node:assert/strict";
import {readAuthorizedWorkingStructure} from "../logic/engine27/v3/engine22/readAuthorizedWorkingStructure.js";
import {evaluateNeighboringAlignment} from "../logic/engine27/v3/neighboringAlignment/evaluateNeighboringAlignment.js";
import {assembleMicroInputs} from "../logic/engine27/v3/manager/assembleMicroInputs.js";
import {adaptEngine22Micro} from "../logic/engine27/v3/priceActionFib/adaptEngine22Micro.js";
import {buildEngine27TraderIntelligenceV2} from "../logic/engine27/v2/buildTraderIntelligenceV2.js";
const info={
 submicro:["W5","UP","micro","W3","engine22.submicroFiveUpOct27OwnerWatch.v1"],
 micro:["W3","UP","subminute","D","engine22.microW3UpOct27Owner.v1"],
 subminute:["D","UP","minute","W2","engine22.subminuteDUpOwnerWorking.v1"],
 minute:["W2","DOWN","minor",null,"engine22.minuteW2RetracementOwner.v1"],
 minor:["W5","UP","intermediate","W3",null],
 intermediate:["W3","UP","primary","W5",null],
 primary:["W5","UP",null,null,null]
};
function fixture(){
 const degrees={};
 for(const [degree,[activeWave,direction,parentDegree,parentWave,modelVersion]] of Object.entries(info))
 degrees[degree]={degree,available:true,activeWave,direction,parentDegree,parentWave,modelVersion,sourcePath:"currentWavelength.degrees."+degree,selectionStatus:modelVersion?"OWNER_SELECTED_WORKING":"CANONICAL_DEGREE_STATE",stage:"DEVELOPING",levels:[{key:"sample",price:7760,status:"WATCH"}],completionConfirmed:false};
 return {symbol:"ES",now:"2026-10-27T20:30:00Z",strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{authorizedWorkingStructure:{schema:"engine22.authorizedWorkingStructure.v1",mode:"READ_ONLY",status:"COMPLETE_WORKING_SELECTION",noExecution:true,noWaveTransition:true,modelFingerprint:"a".repeat(64),evidenceFingerprint:"b".repeat(64),degrees}}}}};
}
test("seven degree authorized publication passes validation",()=>assert.equal(readAuthorizedWorkingStructure(fixture()).available,true));
test("V2 displays current owner working models including Submicro and preserves Minute W2",()=>{
 const r=buildEngine27TraderIntelligenceV2({snapshot:fixture()});
 for(const [d,[wave,dir]] of Object.entries(info)){assert.equal(r.degrees[d].activeWave,wave);assert.equal(r.degrees[d].waveDirection,dir);}
 assert.match(r.degrees.micro.traderRead.headline,/W3 UP/);
 assert.ok(!r.degrees.micro.traderRead.headline.includes("C DOWN"));
 assert.equal(r.degrees.micro.confirmationNeeded.status,"NOT_CONFIRMED");
});
test("V3 parent links use current authorized models",()=>{
 const a=evaluateNeighboringAlignment({snapshot:fixture()});
 assert.equal(a.available,true);assert.equal(a.micro.activeWave,"W3");assert.equal(a.neighbors.submicro.activeWave,"W5");
 assert.equal(assembleMicroInputs({snapshot:fixture()}).contract.qualified,true);
});
test("wrong model authority fails closed rather than showing C DOWN",()=>{
 const x=fixture();x.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure.degrees.micro.available=false;
 assert.equal(readAuthorizedWorkingStructure(x).available,false);
 assert.equal(buildEngine27TraderIntelligenceV2({snapshot:x}).degrees.micro.currentCondition,"UNAVAILABLE");
 assert.equal(evaluateNeighboringAlignment({snapshot:x}).available,false);
});
test("wrong parent linkage fails closed",()=>{
 const x=fixture();x.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure.degrees.micro.parentWave="C";
 assert.equal(readAuthorizedWorkingStructure(x).reasonCode,"ENGINE22_AUTHORIZED_PARENT_CONFLICT");
});
test("legacy C DOWN-specific Fibonacci adapter cannot interpret authorized Micro W3 UP",()=>{
 const r=adaptEngine22Micro({snapshot:fixture()});assert.equal(r.available,false);
 assert.deepEqual(r.reasonCodes,["LEGACY_C_DOWN_FIB_ADAPTER_MODEL_MISMATCH"]);
});

test("canonical seven working cards follow owner publication, not old bearish selectors",()=>{
 const r=buildEngine27WorkingSevenDegrees({snapshot:fixture()});
 assert.equal(r.degrees.submicro.activeWave,"W5");
 assert.equal(r.degrees.micro.activeWave,"W3");
 assert.equal(r.degrees.subminute.activeWave,"D");
 assert.equal(r.degrees.minute.activeWave,"W2");
 assert.equal(r.degrees.micro.waveDirection,"UP");
 assert.match(r.degrees.micro.traderRead.headline,/W3 UP/);
 assert.ok(!r.workingAlignment.marketStory.includes("Micro C DOWN"));
 assert.equal(r.degrees.micro.provenance.workingSource,"engine22WaveStrategy.authorizedWorkingStructure");
});
test("canonical cards fail closed when publication conflicts",()=>{
 const x=fixture(); x.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure.degrees.subminute.available=false;
 const r=buildEngine27WorkingSevenDegrees({snapshot:x});
 assert.equal(r.degrees.micro.available,false);
 assert.equal(r.degrees.subminute.available,false);
 assert.ok(!r.degrees.micro.traderRead.headline.includes("C DOWN"));
});
