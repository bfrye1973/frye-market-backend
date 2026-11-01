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
