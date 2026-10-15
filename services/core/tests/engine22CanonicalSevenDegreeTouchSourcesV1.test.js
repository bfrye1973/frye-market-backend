import test from "node:test";
import assert from "node:assert/strict";
import {buildCanonicalSevenDegreeTouchSourcesV1} from "../logic/engine22/research/buildCanonicalSevenDegreeTouchSourcesV1.js";
import {buildEngine22V3OwnerBootstrap} from "../logic/engine22/v3/buildOwnerBootstrap.js";

const empty = () => ({minor:{activeFibModel:null},minute:{activeFibModel:null}});
test("Subminute cannot inherit legacy Micro as touch identity",()=>{
  const output=buildCanonicalSevenDegreeTouchSourcesV1({
    degreeStates:{...empty(),subminute:{
      sourceCountId:"MICRO-LEGACY",activeFibModel:{approved:true,active:true,modelKey:"LEGACY"}
    }},
    activeStructures:{micro:{activeWave:"W2"}},
  });
  assert.equal(output.degrees.subminute.activeFibModel,null);
  assert.equal(output.diagnostics.subminute,"INDEPENDENT_SUBMINUTE_STRUCTURE_MISSING");
  assert.notEqual(output.degrees.micro,output.degrees.subminute);
});
test("V3 source absent must never reuse historical Micro state",()=>{
  const output=buildCanonicalSevenDegreeTouchSourcesV1({degreeStates:{
    micro:{activeFibModel:{approved:true}},
    submicro:{activeFibModel:{approved:true}},
  }});
  assert.equal(output.degrees.micro.activeFibModel,null);
  assert.equal(output.degrees.submicro.activeFibModel,null);
});
test("V3 bootstrap identity does not approve provisional Micro/Submicro Fibonacci",()=>{
  const source={symbol:"ES",activeStructures:{
    minor:{activeWave:"W5",marks:{}},intermediate:{activeWave:"W3",marks:{}},
    primary:{activeWave:"W5",marks:{}},
  }};
  const bootstrap=buildEngine22V3OwnerBootstrap({activeWaveState:source});
  assert.equal(bootstrap.available,true,bootstrap.reasonCodes?.join(","));
  const output=buildCanonicalSevenDegreeTouchSourcesV1({
    degreeStates:empty(),activeStructures:source.activeStructures,
    v3Canonical:bootstrap.canonical,
  });
  for(const degree of ["micro","submicro"]){
    assert.equal(output.degrees[degree].activeFibModel,null);
    assert.equal(output.diagnostics[degree],"V3_COUNT_PRESENT_FIB_APPROVAL_PENDING");
  }
});
test("explicit Subminute structure is never replaced by Micro",()=>{
  const fib={approved:false,active:true,modelKey:"SUBMINUTE",levels:{e100:7800}};
  const output=buildCanonicalSevenDegreeTouchSourcesV1({
    degreeStates:{subminute:{sourceCountId:"SUBMINUTE-COUNT",activeFibModel:fib}},
    activeStructures:{subminute:{activeWave:"W3"},micro:{activeWave:"W2"}},
  });
  assert.equal(output.degrees.subminute.activeFibModel,fib);
  assert.equal(output.diagnostics.subminute,"FIB_APPROVAL_PENDING");
});
