import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine3V6Phase1Shadow as build} from "../logic/engine3/v6/buildEngine3V6Phase1Shadow.js";
const bar=(start,high,low,close)=>({time:start,open:close,high,low,close});
const t=Date.parse("2026-11-17T17:00:00Z");
const prev=Math.floor((t-300000)/1000);
const v5={stateMachine:{establishedNow:true},validation:{valid:true},
 canonical:{canonical:{direction:"SHORT"},authoritativeDownstream:true},
 evidence:{priceAction:{controlState:"SELLERS_CONTROL",quality:"STRONG"}}};
test("real completed 5m bar can seed a separate v6 shadow only",()=>{
 const out=build({v5,candidateId:"A",zoneId:"Z",evaluationTimeMs:t,
   bars5m:[bar(prev,7353,7336,7338)]});
 assert.equal(out.canonicalDirection,"SHORT");assert.equal(out.establishedNow,true);
 assert.equal(out.reactionAnchor,7353);assert.equal(out.noEngine6Authority,true);
});
test("forming bar cannot become a reaction anchor",()=>{
 const out=build({v5,candidateId:"A",evaluationTimeMs:t,
   bars5m:[bar(Math.floor((t-60000)/1000),7400,7300,7360)]});
 assert.equal(out.canonicalDirection,"NEUTRAL");assert.equal(out.establishedNow,false);
});
test("v5 unconfirmed or invalid cannot seed shadow",()=>{
 const out=build({v5:{...v5,validation:{valid:false}},candidateId:"A",
  evaluationTimeMs:t,bars5m:[bar(prev,7353,7336,7338)]});
 assert.equal(out.canonicalDirection,"NEUTRAL");
});
test("one-minute input cannot manufacture fresh direction",()=>{
 const out=build({candidateId:"A",evaluationTimeMs:t,
  bars1m:[bar(Math.floor((t-60000)/1000),7410,7390,7400)],
  bars5m:[],v5:null});
 assert.equal(out.canonicalDirection,"NEUTRAL");
});
