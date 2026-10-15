import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";

test("Submicro W1 is owner locked from C low 7718 to W1 high 8000 and W2 watches retracements",()=>{
 const result=buildCurrentWavelength({symbol:"ES",currentPrice:7985,microBars5m:[]});
 const current=result.degrees.submicro;
 const model=current.ownerSubmicroW2;
 assert.equal(current.activeWave,"W2");
 assert.equal(model.previousWaveEnd,7718);
 assert.deepEqual(model.anchors,{w1Low:7718,w1High:8000});
 assert.equal(model.direction,"DOWN");
 assert.deepEqual(model.levels.map(x=>[x.key,x.price]),[
  ["r236",7933.5],["r382",7892.25],["r500",7859],
  ["r618",7825.75],["r786",7778.25],
 ]);
 assert.ok(model.levels.every(x=>x.status==="WATCH"&&x.provisional===true&&!x.touchEvidenceAvailable));
 assert.equal(model.noExecution,true);
});
