import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";

test("Minor W5 daily high reach persists visually below target and cannot confirm completion",()=>{
  const w=buildCurrentWavelength({symbol:"ES",currentPrice:7500});
  const r=applyOwnerPriceTouchesV1({currentWavelength:w,currentPrice:7500,
    evaluationTimeMs:Date.parse("2026-11-02T20:00:00Z"),
    bars1d:[{time:Date.parse("2026-10-05T00:00:00Z")/1000,high:7800,low:7670}]});
  const m=r.degrees.minor;
  assert.equal(m.levels[0].price,7601.25);
  assert.equal(m.levels[0].status,"TOUCHED");
  assert.equal(m.levels[1].status,"TOUCHED");
  assert.equal(m.levels[2].status,"TOUCHED");
  assert.equal(m.levels[3].status,"WATCH");
  assert.equal(m.levels[0].touchEvidence.verified,true);
  assert.equal(m.activeWave,"W5");
});
test("Minor W5 ignores unfinished and pre-W4 candles",()=>{
 const w=buildCurrentWavelength({symbol:"ES",currentPrice:7500});
 const r=applyOwnerPriceTouchesV1({currentWavelength:w,currentPrice:7500,
  evaluationTimeMs:Date.parse("2026-11-02T20:00:00Z"),
  bars1d:[{time:Date.parse("2026-07-29T00:00:00Z")/1000,high:9000},
   {time:Date.parse("2026-11-02T00:00:00Z")/1000,high:9000}]});
 assert(r.degrees.minor.levels.every(l=>l.status==="WATCH"));
});
