import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildAuthorizedWorkingStructureV1} from "../logic/engine22/wave/buildAuthorizedWorkingStructureV1.js";
import {ownerApprovedWorkingSelection} from "../logic/engine22/wave/ownerApprovedWorkingSelectionV1.js";
const model=()=>buildCurrentWavelength({symbol:"ES",currentPrice:7325,microBars5m:[]});
test("Minor W2 card ratios are W1 retracements and rounded only at final ES tick",()=>{
  const minor=model().degrees.minor;
  const research=minor.ownerMinorW2Research;
  assert.equal(research.version,"engine22.minorW2ResearchCardNov5.v1");
  assert.equal(research.selectionStatus,"RESEARCH_ONLY");
  assert.equal(research.activeWave,"W2");
  assert.equal(research.anchors.w1Low,6485);
  assert.equal(research.anchors.w1High,7901.75);
  assert.equal(research.anchors.w2CandidateLocalTime,null);
  assert.deepEqual(research.levels.map(x=>x.price),[7567.5,7360.5,7193.5,7026.25,6788.25,6646.5,6485]);
  assert.deepEqual(research.levels.map(x=>x.status),Array(7).fill("WATCH"));
  assert.ok(research.levels.every(x=>x.touchEvidenceAvailable===false));
  assert.equal(research.noExecution,true);
});
test("Old W5 data and high-degree selection are not silently changed",()=>{
  const m=model();
  assert.equal(m.degrees.minor.activeWave,"W5");
  assert.equal(m.degrees.minor.state,"MINOR_W5_ACTIVE_CANDIDATE");
  assert.equal(m.degrees.minor.ownerW5StructuralReference.price,7398);
  assert.equal(ownerApprovedWorkingSelection.selectionRevision,6);
  assert.equal(ownerApprovedWorkingSelection.degrees.minor.source,"degreeStates");
  assert.equal(m.degrees.minor.ownerMinorW2Research.nextWaveStarted,false);
});
test("Minor W2 research card has a review-only reference, not an approved hard invalidation",()=>{
  const r=model().degrees.minor.ownerMinorW2Research;
  assert.equal(r.reviewReference,6485);
  assert.equal(r.reviewOnly,true);
  assert.equal(r.officialInvalidation,null);
  assert.equal(r.priceBasisReconciliation,"PENDING");
});
