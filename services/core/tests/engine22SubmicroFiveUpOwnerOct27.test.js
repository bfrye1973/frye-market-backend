import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
import {buildSevenDegreeInvalidationsV1} from "../logic/engine22/wave/buildSevenDegreeInvalidationsV1.js";
test("owner Submicro W1–W4 15m chart anchors retained exactly and W5 is only a watch",()=>{
 const c=buildCurrentWavelength({symbol:"ES",currentPrice:7760,microBars5m:[]});
 const s=c.degrees.submicro.ownerSubmicroFiveUp;
 assert.deepEqual([s.wave1.low,s.wave1.high,s.wave2.low,s.wave3.high,s.wave4.low],
  [7703.75,7749.25,7712.75,7772.25,7750.5]);
 assert.deepEqual([s.wave1.lowLocalTime,s.wave1.highLocalTime,
  s.wave2.lowLocalTime,s.wave3.highLocalTime,s.wave4.lowLocalTime],
  ["2026-10-27 01:45","2026-10-27 05:15","2026-10-27 07:15",
   "2026-10-27 09:00","2026-10-27 11:30"]);
 assert.equal(s.activeWave,"W5");
 assert.equal(s.stage,"PROJECTED_W5_WATCH");
 assert.equal(s.wave5.status,"PROJECTED_NOT_CONFIRMED_COMPLETE");
 assert.equal(s.wave5.high,null);
 assert.deepEqual(s.levels.map(l=>l.price),[7768,7773.25,7778.5,7796,7808.5,7824,7841.5]);
 assert.equal(c.degrees.submicro.ownerSubmicroCDown.version,"engine22.submicroCDownOwnerWatch.v1");
 assert.equal(c.degrees.micro.ownerMicroW3Up.activeWave,"W3");
 assert.equal(c.degrees.subminute.ownerCurrentDUp.activeWave,"D");
 assert.equal(c.degrees.minute.ownerMinuteW2Retracement.nextWaveStarted,false);
});
test("W5 Fib touches are independent of old Submicro C touches and cannot occur before W4",()=>{
 const c=buildCurrentWavelength({symbol:"ES",currentPrice:7780,microBars5m:[]});
 const old=applyOwnerPriceTouchesV1({currentWavelength:c,currentPrice:7780,
   evaluationTimeMs:Date.parse("2026-10-27T17:00:00Z")});
 assert.ok(old.degrees.submicro.ownerSubmicroFiveUp.levels.every(l=>l.status==="WATCH"));
 const updated=applyOwnerPriceTouchesV1({currentWavelength:c,currentPrice:7780,
   evaluationTimeMs:Date.parse("2026-10-27T19:00:00Z")});
 assert.deepEqual(updated.degrees.submicro.ownerSubmicroFiveUp.levels.map(l=>l.status),
   ["TOUCHED","TOUCHED","TOUCHED","WATCH","WATCH","WATCH","WATCH"]);
 assert.equal(updated.degrees.submicro.ownerSubmicroFiveUp.levels[0].touchEvidence.verified,false);
 assert.equal(updated.degrees.submicro.ownerSubmicroCDown.activeWave,"C");
 assert.equal(updated.degrees.micro.ownerMicroW3Up.activeWave,"W3");
});
test("W5 touched status survives retreat without contaminating other degrees",()=>{
 const c=buildCurrentWavelength({symbol:"ES",currentPrice:7809,microBars5m:[]});
 const touched=applyOwnerPriceTouchesV1({currentWavelength:c,currentPrice:7809,
   evaluationTimeMs:Date.parse("2026-10-27T19:00:00Z")});
 const lower=buildCurrentWavelength({symbol:"ES",currentPrice:7760,microBars5m:[]});
 const after=applyOwnerPriceTouchesV1({currentWavelength:lower,
   previousWavelength:touched,currentPrice:7760,
   evaluationTimeMs:Date.parse("2026-10-27T19:10:00Z")});
 assert.equal(after.degrees.submicro.ownerSubmicroFiveUp.levels[4].status,"TOUCHED");
});
test("owner W4 anchor is review only, not a hard invalidation",()=>{
 const c=buildCurrentWavelength({symbol:"ES",currentPrice:7760,microBars5m:[]});
 const r=buildSevenDegreeInvalidationsV1({currentWavelength:c});
 const d=r.degrees.submicro;
 assert.equal(d.waveIdentity,"SUBMICRO_FIVE_UP_WATCH");
 assert.equal(d.parentWave,"W3");
 assert.equal(d.invalidationReadiness.candidateZone.low,7750.5);
 assert.equal(d.invalidationReadiness.candidateZone.reviewOnly,true);
 assert.equal(d.invalidationReadiness.officialInvalidationPrice,null);
 assert.equal(d.invalidationReadiness.confirmedInvalidation,false);
 assert.equal(d.invalidationReadiness.alertEligible,false);
 assert.equal(d.invalidationReadiness.tradePermissionEligible,false);
 assert.equal(r.status,"NO_APPROVED_ACTIVE_INVALIDATIONS");
});
