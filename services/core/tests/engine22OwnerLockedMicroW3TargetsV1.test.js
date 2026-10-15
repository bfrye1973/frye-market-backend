import test from "node:test";
import assert from "node:assert/strict";
import { buildCurrentWavelength } from "../logic/engine22/wave/buildCurrentWavelength.js";

test("Micro W3 owner-locked anchors project correct ES quarter-tick levels without false touches",()=>{
 const value=buildCurrentWavelength({
  symbol:"ES",currentPrice:7950,
  microBars5m:[], previousMicroSequence:{},
 });
 const micro=value.degrees.micro;
 const model=micro.ownerMicroW3;
 assert.equal(model.version,"engine22.microW3OwnerProjection.v1");
 assert.deepEqual(model.anchors,{
  w1Low:7706.25,w1High:7897.25,w2Low:7718,
  w2LowLocalTime:"2026-10-15 06:30",
  source:"OWNER_LOCKED_MICRO_W3_20261015",
 });
 assert.deepEqual(model.levels.map(x=>[x.key,x.price]),[
  ["e0382",7791],["e0500",7813.5],["e0618",7836],
  ["e1000",7909],["e1272",7961],["e1618",8027],
  ["e2000",8100],
 ]);
 assert.ok(model.levels.every(x=>x.status==="WATCH"&&x.provisional===true&&x.touchEvidenceAvailable===false));
 assert.equal(model.noExecution,true);
});
