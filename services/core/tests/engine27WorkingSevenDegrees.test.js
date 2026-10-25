import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine27WorkingSevenDegrees,ENGINE27_WORKING_DEGREES} from "../logic/engine27/v2/buildWorkingSevenDegrees.js";
const make=()=>({strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{
 currentWavelength:{degrees:{
  submicro:{activeWave:"W2",ownerSubmicroCDown:{version:"engine22.submicroCDownOwnerWatch.v1",activeWave:"C",direction:"DOWN",stage:"DEVELOPING_CANDIDATE",confirmationStatus:"A_DOWN_DEVELOPING_UNCONFIRMED",levels:[{key:"r236",label:".236",price:7797.75,status:"TOUCHED",touchedAt:"2026-10-24"}]}},
  micro:{activeWave:"W3",microSequence:{activeWave:"W3"},ownerMicroCDown:{version:"engine22.microCDownOwnerWatch.v1",activeWave:"C",direction:"DOWN",stage:"DEVELOPING_CANDIDATE",confirmationStatus:"B_DOWN_WORKING_COUNT_NOT_CONFIRMED",levels:[{key:"r382",label:".382",price:7772.5,status:"WATCH"}]}},
  subminute:{ownerCurrentCDown:{version:"engine22.subminuteCurrentCDownReference.v1",activeWave:"C",direction:"DOWN",stage:"DEVELOPING_CANDIDATE"}},
  minute:{ownerLargerCDownScenario:{version:"engine22.largerCorrectionCDownWatch.v1",status:"PROVISIONAL_WORKING_SCENARIO",levels:[{key:"e100",price:7567.5,status:"WATCH"}]},activeWave:"W3",ownerMinuteW2Hypothesis:{version:"engine22.minuteW2ComplexCorrectionWatch.v1",activeWave:"W2",direction:"CORRECTIVE",activeInternalLeg:"D",activeInternalLegDirection:"UP",confirmationStatus:"OWNER_HYPOTHESIS_UNCONFIRMED",childDegreeContext:{subminute:{currentWorkingStructure:"ABC_UP_INSIDE_MINUTE_D",direction:"UP",waveRecount:"PENDING"}},internalDProjection:{levels:[{key:"r618",price:7813,status:"WATCH"}]}}}
 }},degreeStates:{minor:{activeWave:"W5",direction:"UP"},intermediate:{activeWave:"W3",direction:"UP"},primary:{activeWave:"W5",direction:"UP"}}}
}}});
test("all seven sources independent; old W3 never replaces owner B DOWN",()=>{
 const original=make(),before=structuredClone(original);
 const out=buildEngine27WorkingSevenDegrees({snapshot:original});
 assert.deepEqual(out.degreeOrder,ENGINE27_WORKING_DEGREES);
 assert.equal(out.degrees.submicro.activeWave,"C");
 assert.equal(out.degrees.micro.activeWave,"C");
 assert.equal(out.degrees.micro.waveDirection,"DOWN");
 assert.equal(out.degrees.minute.activeWave,"W2 / C DOWN");
 assert.equal(out.degrees.subminute.activeWave,"C");
 assert.equal(out.degrees.subminute.potentialCompletion.levels.length,1);
 assert.equal(out.degrees.submicro.potentialCompletion.levels[0].status,"TOUCHED");
 assert.deepEqual(original,before);
});
test("version mismatch never falls back to superseded Micro lifecycle",()=>{
 const s=make();
 s.strategies["intraday_scalp@10m"].engine22WaveStrategy.currentWavelength.degrees.micro.ownerMicroCDown.version="wrong";
 const out=buildEngine27WorkingSevenDegrees({snapshot:s});
 assert.equal(out.degrees.micro.available,false);
 assert.equal(out.degrees.micro.activeWave,"NOT_PUBLISHED");
});

test("dynamic seven degree market alignment is derived from Engine22 and reports missing evidence",()=>{
 const sample=make();const out=buildEngine27WorkingSevenDegrees({snapshot:sample});
 assert.equal(out.workingAlignment.alignmentState,"MIXED_INTERNAL_CORRECTION");
 assert.deepEqual(out.workingAlignment.downDegrees,["submicro","micro","subminute","minute"]);
 assert.equal(out.workingAlignment.warnings.includes("SUBMINUTE_ACTIVE_ABC_FIB_NOT_PUBLISHED"),false);
 assert.match(out.workingAlignment.marketStory,/Micro C DOWN/);
 delete sample.strategies["intraday_scalp@10m"].engine22WaveStrategy.currentWavelength.degrees.micro.ownerMicroCDown;
 const changed=buildEngine27WorkingSevenDegrees({snapshot:sample});
 assert.equal(changed.degrees.micro.available,false);
 assert.equal(changed.workingAlignment.alignmentState,"PARTIAL_EVIDENCE");
 assert.ok(changed.workingAlignment.warnings.includes("STRUCTURAL_DEGREES_UNAVAILABLE"));
});
