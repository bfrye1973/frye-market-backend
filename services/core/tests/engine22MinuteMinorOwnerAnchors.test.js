import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildSevenDegreeInvalidationsV1} from "../logic/engine22/wave/buildSevenDegreeInvalidationsV1.js";
const make=()=>buildCurrentWavelength({symbol:"ES",currentPrice:7672.5,microBars5m:[]});
test("owner Minute W1 completed anchors and W2 retracements exactly match approved ES geometry",()=>{
  const w=make();
  const minute=w.degrees.minute.ownerMinuteW2Retracement;
  assert.equal(minute.version,"engine22.minuteW2RetracementOwner.v1");
  assert.equal(minute.anchors.w1Low,7419.50);
  assert.equal(minute.anchors.w1High,7908.75);
  assert.equal(minute.anchors.wave1Length,489.25);
  assert.equal(minute.completedWave,"W1");
  assert.equal(minute.activeWave,"W2");
  assert.equal(minute.nextWaveStarted,false);
  assert.deepEqual(minute.levels.map(v=>v.price),[7793.25,7721.75,7664.25,7606.5,7524.25,7419.5]);
  assert.ok(minute.levels.every(v=>v.touchEvidenceAvailable===false && v.status==="WATCH"));
  assert.equal(minute.structuralReference,7419.5);
  assert.equal(w.degrees.minute.activeWave,"W3"); // preserved historical model only
  assert.equal(w.degrees.minute.ownerLargerCDownScenario.version,"engine22.largerCorrectionCDownWatch.v1");
});
test("Minute and Minor owner review references are separate from official permissions",()=>{
  const w=make();
  const registry=buildSevenDegreeInvalidationsV1({currentWavelength:w});
  const minute=registry.degrees.minute.invalidationReadiness;
  const minor=registry.degrees.minor.invalidationReadiness;
  assert.deepEqual([minute.candidateZone.low,minute.candidateZone.high],[7419.5,7419.5]);
  assert.equal(minute.candidateZone.ownerApprovedReference,true);
  assert.deepEqual([minor.candidateZone.low,minor.candidateZone.high],[7398,7398]);
  assert.equal(minor.candidateZone.ownerApprovedReference,true);
  assert.equal(w.degrees.minor.ownerW5StructuralReference.price,7398);
  for(const r of [minute,minor]){
    assert.equal(r.officialInvalidationPrice,null);
    assert.equal(r.confirmedInvalidation,false);
    assert.equal(r.tradePermissionEligible,false);
    assert.equal(r.alertEligible,false);
  }
});
test("missing current Minute owner model does not invent owner boundary",()=>{
  const w=make(); delete w.degrees.minute.ownerMinuteW2Retracement;
  const r=buildSevenDegreeInvalidationsV1({currentWavelength:w});
  assert.equal(r.degrees.minute.invalidationReadiness.candidateZone?.ownerApprovedReference ?? false,false);
});

test("Minor W5 Fib prices reached by ES snapshot expose provenance for green UI",()=>{
 const current=buildCurrentWavelength({symbol:"ES",currentPrice:7672.5,microBars5m:[]});
 const fibs=current.degrees.minor.levels;
 const reached=fibs.filter(x=>x.status==="TOUCHED");
 const waiting=fibs.filter(x=>x.status==="WATCH");
 assert.ok(reached.length>=2);
 assert.ok(waiting.length>=1);
 for(const level of reached){
  assert.equal(level.touchEvidenceAvailable,true);
  assert.equal(level.touchEvidenceType,"ES_CURRENT_SNAPSHOT_AT_OR_ABOVE_LEVEL");
  assert.equal(level.touchEvidence?.verified,false);
  assert.equal(level.touchEvidence?.observedPrice,7672.5);
  assert.equal(level.touchEvidence?.historicTouchUnverified,true);
 }
 for(const level of waiting){
  assert.equal(level.touchEvidenceAvailable,false);
  assert.equal(level.touchEvidenceType,null);
 }
 const lower=buildCurrentWavelength({symbol:"ES",currentPrice:7400,microBars5m:[]});
 assert.ok(lower.degrees.minor.levels.every(x=>x.status==="WATCH"&&x.touchEvidenceAvailable===false));
});
