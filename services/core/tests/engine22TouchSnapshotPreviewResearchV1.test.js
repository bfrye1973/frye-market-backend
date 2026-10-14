import test from "node:test";
import assert from "node:assert/strict";
import {previewSevenDegreeTouchSnapshotV1} from "../logic/engine22/research/previewSevenDegreeTouchSnapshotV1.js";
const model=degree=>({activeWave:"W3",countId:degree+"-count",modelKey:degree+"-model",
 seriesId:"ESZ6",priceBasis:"RAW",direction:"UP",originAt:"2026-10-14T10:00:00Z",
 levels:[{key:"e1000",price:7800,status:"WATCH"}]});
const bar=(id,high)=>({sourceBarId:id,sourceTimestamp:"2026-10-14T10:05:00Z",
 seriesId:"ESZ6",priceBasis:"RAW",low:7750,high,eligible:true,completed:true});
test("seven independent degree outputs without mutating input",()=>{
 const input={micro:model("micro"),subminute:model("subminute")};
 const before=structuredClone(input);
 const r=previewSevenDegreeTouchSnapshotV1({degreeModels:input,
 observationsByDegree:{micro:[bar("hit",7801)],subminute:[bar("miss",7790)]}});
 assert.equal(Object.keys(r.degrees).length,7);
 assert.equal(r.degrees.micro.levels[0].touchResearch.status,"TOUCHED");
 assert.equal(r.degrees.subminute.levels[0].touchResearch.status,"WATCH");
 assert.deepEqual(input,before);
});
test("missing or unqualified source never makes a green touch",()=>{
 const r=previewSevenDegreeTouchSnapshotV1({degreeModels:{submicro:{levels:[{price:7780,key:"c1000"}]}}});
 assert.equal(r.degrees.submicro.levels[0].touchResearch.status,"UNAVAILABLE");
 assert.equal(r.sourcePromotionAuthorized,false);
});

test("same-model durable touch stays TOUCHED after fresh bar no longer crosses",()=>{
 const micro=model("micro");
 const first=previewSevenDegreeTouchSnapshotV1({degreeModels:{micro},
 observationsByDegree:{micro:[bar("first",7801)]}});
 const prior=first.degrees.micro.levels[0].touchResearch;
 assert.equal(prior.status,"TOUCHED");
 const next=previewSevenDegreeTouchSnapshotV1({degreeModels:{micro},
 observationsByDegree:{micro:[bar("later",7790)]},
 persistentResults:{degrees:{micro:[{ok:true,result:prior}]}}});
 assert.equal(next.degrees.micro.levels[0].touchResearch.status,"TOUCHED");
 assert.equal(next.degrees.micro.levels[0].touchResearch.firstTouchedBarId,"first");
 assert.equal(next.degrees.micro.levels[0].touchResearch.persisted,true);
});
test("different model cannot borrow prior durable touch",()=>{
 const micro=model("micro");
 const prev=previewSevenDegreeTouchSnapshotV1({degreeModels:{micro},observationsByDegree:{micro:[bar("hit",7801)]}});
 const other={...micro,modelKey:"different-model"};
 const next=previewSevenDegreeTouchSnapshotV1({degreeModels:{micro:other},observationsByDegree:{micro:[bar("miss",7790)]},
 persistentResults:{degrees:{micro:[{ok:true,result:prev.degrees.micro.levels[0].touchResearch}]}}});
 assert.equal(next.degrees.micro.levels[0].touchResearch.status,"WATCH");
});
