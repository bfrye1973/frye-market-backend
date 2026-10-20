import test from "node:test";
import assert from "node:assert/strict";
import {verifyProposedMicroAnchorsAgainstBars as verify} from "../logic/engine22/migration/verifyProposedMicroAnchorsAgainstBars.js";
test("no real historical bars fails closed",()=>{
 const result=verify();
 assert.equal(result.verified,false);
 assert.ok(result.reasonCodes.includes("HISTORICAL_BARS_MISSING"));
 assert.equal(result.publicationEligible,false);
});
test("matching OHLC fixtures alone cannot authorize structural publication",()=>{
 const marks=[
  ["w1Low","2026-10-01 07:00",7675,"low"],
  ["w1High","2026-10-02 07:00",7805,"high"],
  ["w2Low","2026-10-05 03:00",7757.75,"low"],
  ["w3High","2026-10-06 07:00",7897.75,"high"],
  ["w4Low","2026-10-08 07:00",7782.75,"low"],
 ];
 const bars=marks.map(([key,localTime,price,side])=>({
   id:key,localTime,open:side==="low"?price+1:price-1,
   close:side==="low"?price+2:price-2,
   high:side==="low"?price+3:price,
   low:side==="low"?price:price-3
 }));
 const result=verify({bars,timeZoneVerified:true,sourceIdentity:"TEST_FIXTURE_ONLY"});
 assert.equal(result.verified,true);
 assert.equal(result.publicationEligible,false);
 assert.equal(result.doesNotValidateImpulseGeometry,true);
 const broken=verify({bars:[...bars,{...bars[0],id:"duplicate"}],timeZoneVerified:true,sourceIdentity:"TEST_FIXTURE_ONLY"});
 assert.equal(broken.verified,false);
});
