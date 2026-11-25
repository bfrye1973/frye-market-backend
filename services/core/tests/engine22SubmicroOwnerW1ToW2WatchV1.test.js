import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";

test("Submicro W1 is owner locked from C low 7718 to W1 high 7800 and W2 watches retracements",()=>{
 const result=buildCurrentWavelength({symbol:"ES",currentPrice:7790,microBars5m:[]});
 const current=result.degrees.submicro;
 const model=current.ownerSubmicroW2;
 assert.equal(current.activeWave,"W2");
 assert.equal(model.previousWaveEnd,7718);
 assert.deepEqual(model.anchors,{w1Low:7718,w1High:7800});
 assert.equal(model.direction,"DOWN");
 assert.deepEqual(model.levels.map(x=>[x.key,x.price]),[
  ["r236",7780.75],["r382",7768.75],["r500",7759],
  ["r618",7749.25],["r786",7735.5],
 ]);
 assert.equal(model.ownerObservedW2Low,7772.5);
 assert.equal(model.levels[0].status,"OWNER_OBSERVED_TOUCH");
 assert.equal(model.levels[0].touchEvidenceType,"OWNER_CHART_OBSERVATION");
 assert.ok(model.levels.slice(1).every(x=>x.status==="WATCH"));
 assert.ok(model.levels.every(x=>x.provisional===true&&!x.touchEvidenceAvailable));
 assert.equal(model.noExecution,true);
});
