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
