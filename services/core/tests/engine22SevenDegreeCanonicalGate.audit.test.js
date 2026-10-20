import test from "node:test";
import assert from "node:assert/strict";
import {E22_DEGREE_ORDER,ENGINE22_SEVEN_DEGREE_OWNERSHIP,validateSevenDegreeCanonicalPublication as gate} from "../logic/engine22/migration/validateSevenDegreeCanonicalPublication.js";
const m={degree:"MICRO",parentDegree:"SUBMINUTE",countId:"M1",sequenceId:"MS1"};
const s={degree:"SUBMICRO",parentDegree:"MICRO",countId:"S1",sequenceId:"SS1"};
test("seven degrees preserve distinct Micro and Submicro identity",()=>{
 assert.deepEqual(E22_DEGREE_ORDER,["SUBMICRO","MICRO","SUBMINUTE","MINUTE","MINOR","INTERMEDIATE","PRIMARY"]);
 assert.notEqual(ENGINE22_SEVEN_DEGREE_OWNERSHIP.microExecutionContext,ENGINE22_SEVEN_DEGREE_OWNERSHIP.durableCount);
});
test("no implementation approval = no publication",()=>{
 const r=gate({micro:m,submicro:s,replayValidated:true,historicalBarsValidated:true});
 assert.equal(r.eligible,false);assert.ok(r.reasonCodes.includes("ENGINE22_MANAGER_IMPLEMENTATION_APPROVAL_REQUIRED"));
});
test("shared count or sequence identity fails closed",()=>{
 assert.equal(gate({micro:m,submicro:{...s,countId:"M1"},managerImplementationApproved:true,replayValidated:true,historicalBarsValidated:true}).eligible,false);
 assert.equal(gate({micro:m,submicro:{...s,sequenceId:"MS1"},managerImplementationApproved:true,replayValidated:true,historicalBarsValidated:true}).eligible,false);
});
test("microExecutionContext cannot substitute competing canonical count",()=>{
 const a=gate({micro:m,submicro:s,managerImplementationApproved:true,replayValidated:true,historicalBarsValidated:true,executionContext:{countId:"FOREIGN",sequenceId:"MS1"}});
 assert.equal(a.eligible,false);
 assert.ok(a.reasonCodes.includes("MICRO_EXECUTION_CONTEXT_MUST_PROJECT_CANONICAL_IDENTITY"));
});
test("eligible when identities parents proof and manager approval are satisfied",()=>{
 assert.equal(gate({micro:m,submicro:s,managerImplementationApproved:true,replayValidated:true,historicalBarsValidated:true,executionContext:{countId:"M1",sequenceId:"MS1"}}).eligible,true);
});
