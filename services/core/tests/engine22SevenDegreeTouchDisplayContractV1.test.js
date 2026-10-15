import test from "node:test";
import assert from "node:assert/strict";
import {buildSevenDegreeTouchDisplayV1 as build} from "../logic/engine22/research/buildSevenDegreeTouchDisplayV1.js";
const model={approved:true,provisional:false,activeWave:"W3",countId:"count1",
 modelKey:"model1",seriesId:"ESZ6",priceBasis:"RAW_UNADJUSTED_CONTRACT",
 originAt:"2026-10-14T14:00:00Z",levels:[{key:"e1000",label:"1.000",price:7800}]};
const touched={degrees:{micro:{levels:[{key:"e1000",price:7800,touchResearch:{
 status:"TOUCHED",persisted:true,identity:"count1|model1|ESZ6|RAW_UNADJUSTED_CONTRACT|e1000|micro|7800|2026-10-14T14:00:00Z|UP",firstTouchedAt:"2026-10-14T14:40:00Z",
 firstTouchedBarId:"ESZ6:10m:1791988800"}}]}}};
test("approved same-model persistent touch publishes TOUCHED with provenance",()=>{
 const r=build({models:{micro:model},touchSnapshot:touched});
 assert.equal(r.degrees.micro.levels[0].status,"TOUCHED");
 assert.equal(r.degrees.micro.levels[0].touchEvidence.verified,true);
 assert.equal(r.degreeOrder.length,7);
});
test("unapproved provisional source never publishes green",()=>{
 const r=build({models:{micro:{...model,approved:false,provisional:true}},touchSnapshot:touched});
 assert.equal(r.degrees.micro.levels[0].status,"WATCH");
 assert.equal(r.degrees.micro.available,false);
});
test("missing durable evidence and mismatched level never publish green",()=>{
 const noPersistence=structuredClone(touched);
 noPersistence.degrees.micro.levels[0].touchResearch.persisted=false;
 assert.equal(build({models:{micro:model},touchSnapshot:noPersistence}).degrees.micro.levels[0].status,"WATCH");
 assert.equal(build({models:{micro:{...model,levels:[{key:"e1000",price:7800.25}]}},touchSnapshot:touched}).degrees.micro.levels[0].status,"WATCH");
});
test("seven separate outputs without aliasing degrees",()=>{
 const r=build({models:{micro:model},touchSnapshot:touched});
 assert.equal(r.degrees.submicro.available,false);
 assert.equal(r.degrees.subminute.available,false);
 assert.equal(r.noExecution,true);
});

test("rejects a persisted touch with the wrong complete identity even if key and price match",()=>{
 const bad=structuredClone(touched);
 bad.degrees.micro.levels[0].touchResearch.identity="another-count|model1|ESZ6|RAW_UNADJUSTED_CONTRACT|e1000|micro|7800|2026-10-14T14:00:00Z|UP";
 const r=build({models:{micro:model},touchSnapshot:bad});
 assert.equal(r.degrees.micro.levels[0].status,"WATCH");
 assert.equal(r.degrees.micro.levels[0].touchEvidence,null);
});
