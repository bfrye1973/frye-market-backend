import test from "node:test";
import assert from "node:assert/strict";
import {ENGINE22_V3_DEGREES,ENGINE22_V3_PARENT,ENGINE22_V3_SCHEMA} from "../logic/engine22/v3/canonicalStructure.js";
import {projectEngine22V3DegreeFib} from "../logic/engine22/v3/projectDegreeFib.js";
const anchor=(price,time)=>({price,time,status:"CONFIRMED"});
const make=()=>({
 schema:ENGINE22_V3_SCHEMA,symbol:"ES",noPermissionCreated:true,noExecution:true,
 degrees:Object.fromEntries(ENGINE22_V3_DEGREES.map((degree,index)=>[degree,{
 degreeId:degree,countId:"COUNT-"+index,sequenceId:"SEQ-"+index,
 parentDegree:ENGINE22_V3_PARENT[degree],parentWave:ENGINE22_V3_PARENT[degree]?"W3":null,
 activeWave:"W3",lifecycle:"DEVELOPING",history:[],provenance:{source:"TEST"},
 invalidation:{price:null},fibModel:{levels:[]},
 anchors:degree==="MICRO"?{
 W1_LOW:anchor(7675,"2026-10-01 07:00"),
 W1_HIGH:anchor(7805,"2026-10-02 07:00"),
 W2_LOW:anchor(7757.75,"2026-10-05 03:00"),
 }:{}
 }])),
});
test("Micro fibs are sourced from approved degree anchors, no hardcoded numbers",()=>{
 const r=projectEngine22V3DegreeFib({canonical:make(),degree:"MICRO"});
 assert.equal(r.available,true);
 assert.equal(r.wave1Length,130);
 assert.equal(r.levels.find(x=>x.key==="e1000").price,7887.75);
 assert.equal(r.noExecution,true);
});
test("absent Submicro marks do not borrow Micro marks",()=>{
 const r=projectEngine22V3DegreeFib({canonical:make(),degree:"INTRADAY_SUBMICRO"});
 assert.equal(r.available,false);
 assert.ok(r.reasonCodes.includes("W1_W2_ANCHORS_INCOMPLETE"));
});
test("provisional anchors are clearly labeled",()=>{
 const s=make();s.degrees.MICRO.anchors.W2_LOW.status="DEVELOPING";
 const r=projectEngine22V3DegreeFib({canonical:s,degree:"MICRO"});
 assert.equal(r.available,true);
 assert.equal(r.provisional,true);
});

test("owner-confirmed Submicro anchors project W3 independently while W3 develops",()=>{
 const s=make();
 s.degrees.INTRADAY_SUBMICRO.anchors={
  W1_LOW:anchor(7782.50,"2026-10-08 10:00"),
  W1_HIGH:anchor(7853.75,"2026-10-09 05:00"),
  W2_LOW:anchor(7826.25,"2026-10-09 06:00"),
 };
 // Test fixture only: does not construct/approve a migrated production count.
 const r=projectEngine22V3DegreeFib({canonical:s,degree:"INTRADAY_SUBMICRO"});
 assert.equal(r.available,true);
 assert.equal(r.wave1Length,71.25);
 assert.equal(r.projectionBase,7826.25);
 assert.equal(r.levels.find(x=>x.key==="e1000").price,7897.50);
 assert.equal(r.levels.find(x=>x.key==="e1272").price,7917.00);
 assert.equal(r.levels.find(x=>x.key==="e1618").price,7941.50);
 assert.equal(r.levels.find(x=>x.key==="e2000").price,7968.75);
 assert.equal(r.noExecution,true);
 assert.ok(r.levels.every(x=>x.status==="WATCH"));
 assert.equal(s.degrees.INTRADAY_SUBMICRO.lifecycle,"DEVELOPING");
 assert.deepEqual(s.degrees.MICRO.anchors.W1_LOW,anchor(7675,"2026-10-01 07:00"));
});
