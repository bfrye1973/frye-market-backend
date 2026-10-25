import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
test("new downside models are isolated and correctly priced",()=>{
 const wave=buildCurrentWavelength({symbol:"ES",currentPrice:7763.5,microBars5m:[]});
 delete wave.degrees.micro.ownerMicroCDown; // replay the superseded Micro B count without changing the active owner model
 const m=wave.degrees.micro.ownerMicroBDown;
 const s=wave.degrees.submicro.ownerSubmicroADown;
 assert.equal(m.activeWave,"B");
 assert.equal(s.activeWave,"A");
 assert.equal(m.waveA.high,7812.25);
 assert.equal(m.waveA.highLocalTime,"2026-10-21 11:00");
 assert.deepEqual(m.levels.map(x=>x.price),[7787.75,7772.5,7760.25,7747.75,7730.25,7708]);
 assert.deepEqual(s.levels.map(x=>x.price),[7797.75,7788.75,7781.5,7774.25,7764,7750.75]);
 assert.equal(wave.degrees.micro.ownerMicroAbc.version,"engine22.microAbcMinuteD.v1");
 assert.equal(wave.degrees.submicro.ownerSubmicroAbc.version,"engine22.submicroAbcMicroC.v1");
 const t=Date.parse("2026-10-22T02:00:00Z");
 const touched=applyOwnerPriceTouchesV1({currentWavelength:wave,currentPrice:7763.5,evaluationTimeMs:t});
 assert.deepEqual(touched.degrees.micro.ownerMicroBDown.levels.map(x=>x.status),["TOUCHED","TOUCHED","WATCH","WATCH","WATCH","WATCH"]);
 assert.deepEqual(touched.degrees.submicro.ownerSubmicroADown.levels.map(x=>x.status),["TOUCHED","TOUCHED","TOUCHED","TOUCHED","TOUCHED","WATCH"]);
 assert.ok(wave.degrees.micro.ownerMicroAbc.levels.every(x=>x.status==="WATCH"));
});
