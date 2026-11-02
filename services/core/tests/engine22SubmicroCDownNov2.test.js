import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
import {ownerApprovedWorkingSelection} from "../logic/engine22/wave/ownerApprovedWorkingSelectionV1.js";
test("Nov2 Submicro C down owner model selected, older alternatives preserved",()=>{
 const w=buildCurrentWavelength({symbol:"ES",currentPrice:7614});
 const m=w.degrees.submicro.ownerSubmicroCDownNov2;
 assert.equal(ownerApprovedWorkingSelection.selectionRevision,6);
 assert.equal(ownerApprovedWorkingSelection.degrees.submicro.key,"ownerSubmicroCDownNov2");
 assert.equal(m.waveB.high,7692);
 assert.deepEqual(m.levels.map(x=>x.price),[7655.5,7632.75,7614.5,7596.25,7570.25,7537,7494.75,7441.25,7382]);
 assert(w.degrees.submicro.submicroCompare);
 assert.equal(m.waveC.completionConfirmed,false);
});
test("No pre-B history can touch Nov2 C ladder, post-B quote can",()=>{
 const w=buildCurrentWavelength({symbol:"ES",currentPrice:7700});
 const early=applyOwnerPriceTouchesV1({currentWavelength:w,currentPrice:7550,bars10m:[],evaluationTimeMs:Date.parse("2026-11-02T14:59:59Z")});
 assert(early.degrees.submicro.ownerSubmicroCDownNov2.levels.every(l=>l.status==="WATCH"));
 const after=applyOwnerPriceTouchesV1({currentWavelength:w,currentPrice:7614,bars10m:[],evaluationTimeMs:Date.parse("2026-11-02T17:00:00Z")});
 assert.deepEqual(after.degrees.submicro.ownerSubmicroCDownNov2.levels.map(x=>x.status).slice(0,5),["TOUCHED","TOUCHED","TOUCHED","WATCH","WATCH"]);
});

test("post-B completed 10m timestamps in milliseconds or ISO mark levels green",()=>{
 const w=buildCurrentWavelength({symbol:"ES",currentPrice:7700});
 const time=Date.parse("2026-11-02T16:20:00Z");
 const result=applyOwnerPriceTouchesV1({currentWavelength:w,currentPrice:7700,
   evaluationTimeMs:Date.parse("2026-11-02T17:00:00Z"),
   bars10m:[{time,low:7590,high:7635}]});
 const v=result.degrees.submicro.ownerSubmicroCDownNov2.levels;
 assert.deepEqual(v.slice(0,4).map(l=>l.status),["TOUCHED","TOUCHED","TOUCHED","TOUCHED"]);
 assert.equal(v[4].status,"WATCH");
 assert.equal(v[3].touchEvidence.verified,true);
});
test("pre-B candles cannot create Submicro C touches",()=>{
 const w=buildCurrentWavelength({symbol:"ES",currentPrice:7700});
 const result=applyOwnerPriceTouchesV1({currentWavelength:w,currentPrice:7700,
 evaluationTimeMs:Date.parse("2026-11-02T17:00:00Z"),
 bars10m:[{time:Date.parse("2026-10-30T15:00:00Z")/1000,low:7500,high:7700}]});
 assert(result.degrees.submicro.ownerSubmicroCDownNov2.levels.every(l=>l.status==="WATCH"));
});
