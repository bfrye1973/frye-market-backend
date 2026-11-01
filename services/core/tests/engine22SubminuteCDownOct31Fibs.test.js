import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
import test from "node:test";
import assert from "node:assert/strict";
import { buildCurrentWavelength } from "../logic/engine22/wave/buildCurrentWavelength.js";

test("Subminute C DOWN preserves both wick and body Fibonacci research scenarios", () => {
  const s = buildCurrentWavelength({symbol:"ES",currentPrice:7558.25}).degrees.subminute;
  const m = s.ownerSubminuteCDownOct31;
  assert.equal(m.activeWave,"C");
  assert.equal(m.direction,"DOWN");
  assert.equal(m.stage,"DEVELOPING_CANDIDATE");
  assert.equal(m.waveA.startHigh,7901);
  assert.equal(m.waveA.wickLow,7558.75);
  assert.equal(m.waveA.bodyReferenceLow,7617.5);
  assert.equal(m.priorBEnding.price,7895);
  assert.deepEqual(m.fibReferences.wick.levels.map(x=>x.price),[7683.5,7552.75,7459.75,7341.25,7210.5]);
  assert.deepEqual(m.fibReferences.body.levels.map(x=>x.price),[7719.75,7611.5,7534.5,7436.25,7328]);
  assert.equal(m.levels[1].price,7552.75);
  assert.equal(m.noExecution,true);
  assert.equal(m.oldDUpHistoryPreserved,true);
  assert.ok(s.ownerCurrentDUp);
});

test("Micro and Submicro selections remain unchanged in this Fibonacci edit",()=>{
 const w=buildCurrentWavelength({symbol:"ES",currentPrice:7558.25});
 assert.ok(w.degrees.micro.ownerMicroW4Down);
 assert.ok(w.degrees.submicro.ownerSubmicroADownInsideMicroW4);
});

test("completed ES bar marks both model methods independently without inventing a wave ending",()=>{
  const current=buildCurrentWavelength({symbol:"ES",currentPrice:7900});
  const before=applyOwnerPriceTouchesV1({currentWavelength:current,currentPrice:7900,
    evaluationTimeMs:Date.parse("2026-10-08T14:00:00Z"),
    bars10m:[]});
  const clean=before.degrees.subminute.ownerSubminuteCDownOct31;
  assert.equal(clean.fibReferences.wick.levels[0].status,"WATCH");
  assert.equal(clean.fibReferences.body.levels[0].status,"WATCH");
  const after=applyOwnerPriceTouchesV1({currentWavelength:current,currentPrice:7900,
    evaluationTimeMs:Date.parse("2026-10-08T14:00:00Z"),
    bars10m:[{time:Date.parse("2026-10-08T13:30:00Z")/1000,low:7600,high:7710}]});
  const m=after.degrees.subminute.ownerSubminuteCDownOct31;
  assert.equal(m.fibReferences.wick.levels[0].status,"TOUCHED");
  assert.equal(m.fibReferences.body.levels[0].status,"TOUCHED");
  assert.equal(m.fibReferences.wick.levels[1].status,"WATCH"); // 7552.75 not reached
  assert.equal(m.fibReferences.body.levels[1].status,"TOUCHED"); // 7611.50 reached
  assert.equal(m.fibReferences.body.levels[1].touchEvidence.verified,true);
  assert.equal(m.sequence.C,"DOWN_DEVELOPING_COMPLETION_UNCONFIRMED");
});

test("candle before B end cannot record a false C down Fib touch",()=>{
  const current=buildCurrentWavelength({symbol:"ES",currentPrice:7895});
  const result=applyOwnerPriceTouchesV1({currentWavelength:current,currentPrice:7895,
    evaluationTimeMs:Date.parse("2026-10-07T14:00:00Z"),
    bars10m:[{time:Date.parse("2026-10-06T14:00:00Z")/1000,low:7000,high:7900}]});
  const m=result.degrees.subminute.ownerSubminuteCDownOct31;
  assert(m.fibReferences.wick.levels.every(l=>l.status==="WATCH"));
  assert(m.fibReferences.body.levels.every(l=>l.status==="WATCH"));
});
