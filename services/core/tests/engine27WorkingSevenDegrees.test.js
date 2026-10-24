import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine27WorkingSevenDegrees,ENGINE27_WORKING_DEGREES} from "../logic/engine27/v2/buildWorkingSevenDegrees.js";
const make=()=>({strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{
 currentWavelength:{degrees:{
  submicro:{activeWave:"W2",ownerSubmicroADown:{version:"engine22.submicroADownOwnerWatch.v1",activeWave:"A",direction:"DOWN",stage:"DEVELOPING_CANDIDATE",confirmationStatus:"A_DOWN_DEVELOPING_UNCONFIRMED",levels:[{key:"r236",label:".236",price:7797.75,status:"TOUCHED",touchedAt:"2026-10-24"}]}},
  micro:{activeWave:"W3",microSequence:{activeWave:"W3"},ownerMicroBDown:{version:"engine22.microBDownOwnerWatch.v1",activeWave:"B",direction:"DOWN",stage:"DEVELOPING_CANDIDATE",confirmationStatus:"B_DOWN_WORKING_COUNT_NOT_CONFIRMED",levels:[{key:"r382",label:".382",price:7772.5,status:"WATCH"}]}},
  minute:{activeWave:"W3",ownerMinuteW2Hypothesis:{version:"engine22.minuteW2ComplexCorrectionWatch.v1",activeWave:"W2",direction:"CORRECTIVE",activeInternalLeg:"D",activeInternalLegDirection:"UP",confirmationStatus:"OWNER_HYPOTHESIS_UNCONFIRMED",childDegreeContext:{subminute:{currentWorkingStructure:"ABC_UP_INSIDE_MINUTE_D",direction:"UP",waveRecount:"PENDING"}},internalDProjection:{levels:[{key:"r618",price:7813,status:"WATCH"}]}}}
 }},degreeStates:{minor:{activeWave:"W5",direction:"UP"},intermediate:{activeWave:"W3",direction:"UP"},primary:{activeWave:"W5",direction:"UP"}}}
}}});
test("all seven sources independent; old W3 never replaces owner B DOWN",()=>{
 const original=make(),before=structuredClone(original);
 const out=buildEngine27WorkingSevenDegrees({snapshot:original});
 assert.deepEqual(out.degreeOrder,ENGINE27_WORKING_DEGREES);
 assert.equal(out.degrees.submicro.activeWave,"A");
 assert.equal(out.degrees.micro.activeWave,"B");
 assert.equal(out.degrees.micro.waveDirection,"DOWN");
 assert.equal(out.degrees.minute.activeWave,"W2 / D UP");
 assert.equal(out.degrees.subminute.activeWave,"ABC");
 assert.equal(out.degrees.subminute.potentialCompletion.levels.length,0);
 assert.equal(out.degrees.submicro.potentialCompletion.levels[0].status,"TOUCHED");
 assert.deepEqual(original,before);
});
test("version mismatch never falls back to superseded Micro lifecycle",()=>{
 const s=make();
 s.strategies["intraday_scalp@10m"].engine22WaveStrategy.currentWavelength.degrees.micro.ownerMicroBDown.version="wrong";
 const out=buildEngine27WorkingSevenDegrees({snapshot:s});
 assert.equal(out.degrees.micro.available,false);
 assert.equal(out.degrees.micro.activeWave,"NOT_PUBLISHED");
});
