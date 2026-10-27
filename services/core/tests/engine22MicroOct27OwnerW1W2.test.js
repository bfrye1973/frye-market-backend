import test from "node:test";import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
test("owner Micro W1 W2 anchors and extensions use exact W1 high 7739.50",()=>{
 const c=buildCurrentWavelength({symbol:"ES",currentPrice:7752.5,microBars5m:[]});
 const m=c.degrees.micro.ownerMicroW3Up;
 assert.equal(m.wave1.low,7651.75);assert.equal(m.wave1.lowLocalTime,"2026-10-25 15:00");
 assert.equal(m.wave1.high,7739.50);assert.equal(m.wave1.highLocalTime,"2026-10-26 08:00");
 assert.equal(m.wave2.low,7699.5);assert.equal(m.wave2.lowLocalTime,"2026-10-27 01:00");
 assert.equal(m.activeWave,"W3");assert.deepEqual(m.levels.map(l=>l.price),[7733,7743.5,7753.75,7787.25,7811,7841.5,7875]);
 assert.equal(m.fibStatus,"OWNER_PROVISIONAL_MICRO_W3_UP_EXTENSIONS");
 assert.equal(c.degrees.micro.ownerMicroCDown.activeWave,"C");
 assert.equal(c.degrees.submicro.ownerSubmicroCDown.activeWave,"C");
 assert.equal(c.degrees.subminute.ownerCurrentDUp.activeWave,"D");
 assert.equal(c.degrees.minute.ownerMinuteW2Retracement.activeWave,"W2");
 assert.equal(c.degrees.minute.ownerMinuteW2Retracement.nextWaveStarted,false);
 assert.equal(m.noExecution,true);
});

test("Micro W3 upward target touches are separate from preserved C down history",()=>{
 const base=buildCurrentWavelength({symbol:"ES",currentPrice:7755,microBars5m:[]});
 const observed=applyOwnerPriceTouchesV1({currentWavelength:base,currentPrice:7755,
   evaluationTimeMs:Date.parse("2026-10-27T17:00:00Z")});
 const micro=observed.degrees.micro;
 assert.deepEqual(micro.ownerMicroW3Up.levels.map(l=>l.status),
  ["TOUCHED","TOUCHED","TOUCHED","WATCH","WATCH","WATCH","WATCH"]);
 assert.equal(micro.ownerMicroW3Up.levels[0].touchEvidence.verified,false);
 assert.equal(micro.ownerMicroW3Up.levels[0].touchEvidenceType,"ES_CURRENT_PRICE");
 assert.equal(micro.ownerMicroCDown.activeWave,"C");
 assert.equal(micro.ownerMicroCDown.levels.length,9);
 assert.equal(observed.degrees.subminute.ownerCurrentDUp.activeWave,"D");
 assert.equal(observed.degrees.minute.ownerMinuteW2Retracement.nextWaveStarted,false);
});
test("Micro W3 touches persist on subsequent retreat, while timestamps before W2 low cannot touch",()=>{
 const base=buildCurrentWavelength({symbol:"ES",currentPrice:7812,microBars5m:[]});
 const observed=applyOwnerPriceTouchesV1({currentWavelength:base,currentPrice:7812,
  evaluationTimeMs:Date.parse("2026-10-27T17:00:00Z")});
 const after=buildCurrentWavelength({symbol:"ES",currentPrice:7710,microBars5m:[]});
 const retained=applyOwnerPriceTouchesV1({currentWavelength:after,
  previousWavelength:observed,currentPrice:7710,evaluationTimeMs:Date.parse("2026-10-27T17:10:00Z")});
 assert.equal(retained.degrees.micro.ownerMicroW3Up.levels[4].status,"TOUCHED");
 const earlier=buildCurrentWavelength({symbol:"ES",currentPrice:7900,microBars5m:[]});
 const safe=applyOwnerPriceTouchesV1({currentWavelength:earlier,currentPrice:7900,
   evaluationTimeMs:Date.parse("2026-10-27T07:00:00Z")});
 assert.ok(safe.degrees.micro.ownerMicroW3Up.levels.every(l=>l.status==="WATCH"));
});
