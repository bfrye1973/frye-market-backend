import test from "node:test";
import assert from "node:assert/strict";
import {
  ENGINE22_V3_SCHEMA, ENGINE22_V3_DEGREES, ENGINE22_V3_PARENT,
  validateEngine22V3Canonical, validateEngine22V3Transition,
  buildEngine22V3DegreeProjection,
} from "../logic/engine22/v3/canonicalStructure.js";

const state = () => ({
  schema: ENGINE22_V3_SCHEMA, symbol:"ES",sourceTimestamp:"2026-10-11T00:00:00Z",
  noPermissionCreated:true,noExecution:true,
  degrees:Object.fromEntries(ENGINE22_V3_DEGREES.map((degree,index)=>[
    degree, {
      degreeId:degree, countId:"COUNT-"+index, sequenceId:"SEQUENCE-"+index,
      parentDegree:ENGINE22_V3_PARENT[degree],
      parentWave:ENGINE22_V3_PARENT[degree] ? "W3" : null,
      activeWave:"W1", lifecycle:"DEVELOPING",
      anchors:{W1_LOW:{price:7788.25,time:"2026-10-08 10:30",status:"LOCKED",lockApprovalId:"OWNER-1"}},
      history:[{event:"INITIALIZED",id:index}],
      provenance:{source:"TEST"},invalidation:{price:null},fibModel:{levels:[]},
    }
  ]))
});
test("seven independent degrees produce a safe read-only projection",()=>{
  const s=state();
  assert.equal(validateEngine22V3Canonical(s).ok,true);
  const p=buildEngine22V3DegreeProjection(s);
  assert.equal(p.available,true);
  assert.equal(Object.keys(p.degrees).length,7);
  assert.equal(p.degrees.intraday_submicro.parentDegree,"MICRO");
  assert.equal(p.automationEligible,false);
});
test("reject duplicate count identities",()=>{
  const s=state(); s.degrees.MICRO.countId=s.degrees.INTRADAY_SUBMICRO.countId;
  assert.ok(validateEngine22V3Canonical(s).errors.includes("DUPLICATE_COUNT_ID"));
});
test("reject rewriting locked anchor",()=>{
  const a=state(),b=structuredClone(a);
  b.degrees.MICRO.anchors.W1_LOW.price=7999;
  assert.ok(validateEngine22V3Transition(a,b).errors.includes("MICRO_LOCKED_ANCHOR_CHANGED_W1_LOW"));
});
test("reject count identity change without authorized recount",()=>{
  const a=state(),b=structuredClone(a); b.degrees.MICRO.countId="NEW-COUNT";
  assert.ok(validateEngine22V3Transition(a,b).errors.includes("MICRO_UNAUTHORIZED_RECOUNT"));
});
test("reject lost history",()=>{
  const a=state(),b=structuredClone(a); b.degrees.MICRO.history=[];
  assert.ok(validateEngine22V3Transition(a,b).errors.includes("MICRO_HISTORY_TRUNCATED"));
});
test("allow unchanged locked anchors with growing history",()=>{
  const a=state(),b=structuredClone(a); b.degrees.MICRO.history.push({event:"EVALUATED"});
  assert.equal(validateEngine22V3Transition(a,b).ok,true);
});

test("history cannot be rewritten even when its length is preserved",()=>{
 const a=state(),b=structuredClone(a);
 b.degrees.MICRO.history[0]={event:"REWRITTEN"};
 assert.ok(validateEngine22V3Transition(a,b).errors.includes("MICRO_HISTORY_REWRITTEN"));
});
test("blank recount IDs never authorize count replacement",()=>{
 const a=state(),b=structuredClone(a);
 b.degrees.MICRO.countId="REPLACED";
 b.degrees.MICRO.provenance.managerApprovalId="";
 const r=validateEngine22V3Transition(a,b,{approvedRecountIds:[""]});
 assert.ok(r.errors.includes("MICRO_UNAUTHORIZED_RECOUNT"));
});
test("reject inconsistent parent count identity",()=>{
 const a=state();a.degrees.INTRADAY_SUBMICRO.parentCountId="WRONG-PARENT";
 assert.ok(validateEngine22V3Canonical(a).errors.includes("INTRADAY_SUBMICRO_PARENT_COUNT_ID_MISMATCH"));
});
