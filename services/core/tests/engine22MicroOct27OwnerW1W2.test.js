import test from "node:test";import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
test("owner Micro W1 W2 anchors staged without inventing W1 high or extensions",()=>{
 const c=buildCurrentWavelength({symbol:"ES",currentPrice:7752.5,microBars5m:[]});
 const m=c.degrees.micro.ownerMicroW3Up;
 assert.equal(m.wave1.low,7651.75);assert.equal(m.wave1.lowLocalTime,"2026-10-25 15:00");
 assert.equal(m.wave1.high,null);assert.equal(m.wave1.highLocalTime,"2026-10-26 08:00");
 assert.equal(m.wave2.low,7699.5);assert.equal(m.wave2.lowLocalTime,"2026-10-27 01:00");
 assert.equal(m.activeWave,"W3");assert.deepEqual(m.levels,[]);
 assert.equal(m.fibStatus,"WAITING_FOR_EXACT_W1_HIGH");
 assert.equal(c.degrees.micro.ownerMicroCDown.activeWave,"C");
 assert.equal(c.degrees.submicro.ownerSubmicroCDown.activeWave,"C");
 assert.equal(c.degrees.subminute.ownerCurrentDUp.activeWave,"D");
 assert.equal(c.degrees.minute.ownerMinuteW2Retracement.activeWave,"W2");
 assert.equal(c.degrees.minute.ownerMinuteW2Retracement.nextWaveStarted,false);
 assert.equal(m.noExecution,true);
});
