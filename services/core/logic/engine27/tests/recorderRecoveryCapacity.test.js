import test from "node:test";
import assert from "node:assert/strict";
import {estimateRecorderRecovery} from "../waveObservation/estimateRecorderRecovery.js";
test("14-day mixed source quota establishes floor without claiming live freshness",()=>{
 const r=estimateRecorderRecovery({pendingLegacy:5000,pendingQualified:1600,
  distinctUncachedTenMinuteWindows:1400,minutesUntilOldestExpiry:720});
 assert.equal(r.ok,true);
 assert.equal(r.minimumProviderRequests,1400);
 assert.ok(r.theoreticalFloorMinutes>690);
 assert.equal(r.historicalDeadlineAtRisk,false);
 assert.equal(r.estimatedOperationalMinutes,null);
});
test("more 10m provider windows than remaining time exposes expiry risk",()=>{
 const r=estimateRecorderRecovery({pendingLegacy:1000,pendingQualified:2000,
  distinctUncachedTenMinuteWindows:2000,minutesUntilOldestExpiry:300});
 assert.equal(r.historicalDeadlineAtRisk,true);
 assert.ok(r.theoreticalFloorMinutes>900);
});
test("shared timeframe windows rather than two independent Micro/Submicro requests",()=>{
 const r=estimateRecorderRecovery({pendingLegacy:560,pendingQualified:20,
  distinctUncachedTenMinuteWindows:4});
 assert.equal(r.minimumProviderRequests,4);
 assert.equal(r.ok,true);
 assert.equal(estimateRecorderRecovery({pendingLegacy:10,pendingQualified:10,
  distinctUncachedTenMinuteWindows:10,requestCapPerMinute:3}).ok,false);
});
