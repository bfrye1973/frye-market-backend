import test from "node:test";
import assert from "node:assert/strict";
import {proposeEngine22V3SubmicroMigration} from "../logic/engine22/v3/proposeSubmicroMigration.js";
const args=()=>({
  originalMicro:{countId:"LEGACY-1",sequenceId:"SEQ-1",revision:4,
    waves:{W1:{status:"LOCKED",price:7852.75}},
    history:[{event:"W1_LOCKED",id:1}],sourceTimestamp:"2026-10-09T20:00:00Z"},
  parentMicroCountId:"MICRO-PARENT-1",
  managerApprovalId:"MANAGER-TEST-1",
  migrationTimestamp:"2026-10-11T20:00:00Z"
});
test("history and anchors preserved but source is not mutated",()=>{
  const a=args();const original=structuredClone(a.originalMicro);
  const r=proposeEngine22V3SubmicroMigration(a);
  assert.equal(r.ok,true);
  assert.equal(r.candidate.degreeId,"INTRADAY_SUBMICRO");
  assert.equal(r.candidate.parentDegree,"MICRO");
  assert.equal(r.candidate.preservedHistory[0].event,"W1_LOCKED");
  assert.deepEqual(a.originalMicro,original);
  assert.equal(r.candidate.publicationEligible,false);
  assert.equal(r.candidate.noExecution,true);
});
test("requires reviewed migration approval and parent",()=>{
  const a=args();a.managerApprovalId=null;a.parentMicroCountId=null;
  const r=proposeEngine22V3SubmicroMigration(a);
  assert.equal(r.ok,false);
  assert.ok(r.errors.includes("MANAGER_APPROVAL_ID_REQUIRED"));
  assert.ok(r.errors.includes("PARENT_MICRO_ID_REQUIRED"));
});
