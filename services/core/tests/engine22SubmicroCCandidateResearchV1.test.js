import test from "node:test";
import assert from "node:assert/strict";
import {assessSubmicroCCandidateV1} from "../logic/engine22/research/assessSubmicroCCandidateV1.js";
const B={price:7886.25,time:"2026-10-11T21:00:00Z"};
const bar=(low,time,id)=>({low,high:low+12,sourceTimestamp:time,sourceBarId:id,
 completed:true,eligible:true,seriesId:"ESZ6",priceBasis:"RAW_ES"});
test("Submicro C candidate records lowest eligible post-B candle, not a confirmation",()=>{
 const r=assessSubmicroCCandidateV1({ownerB:B,sourceSeriesId:"ESZ6",priceBasis:"RAW_ES",
 bars:[bar(7750,"2026-10-14T14:00:00Z","a"),bar(7740,"2026-10-14T16:00:00Z","b"),
 bar(7770,"2026-10-14T18:00:00Z","c")]});
 assert.equal(r.candidate.price,7740);
 assert.equal(r.candidate.sourceBarId,"b");
 assert.equal(r.candidate.reboundObserved,true);
 assert.equal(r.confirmed,false);
});
test("screenshots and estimated low without eligible bars do not create confirmation",()=>{
 const r=assessSubmicroCCandidateV1({ownerB:B,sourceSeriesId:"ESZ6",priceBasis:"RAW_ES"});
 assert.equal(r.candidate,null);assert.equal(r.confirmed,false);
});
test("wrong series, price basis and bars before B are excluded",()=>{
 const r=assessSubmicroCCandidateV1({ownerB:B,sourceSeriesId:"ESZ6",priceBasis:"RAW_ES",
 bars:[bar(7730,"2026-10-10T14:00:00Z","early"),{...bar(7720,"2026-10-14T14:00:00Z","bad"),seriesId:"ESU6"},
 bar(7740,"2026-10-14T15:00:00Z","valid")]});
 assert.equal(r.candidate.price,7740);
});
