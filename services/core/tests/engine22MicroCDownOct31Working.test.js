import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
import {ownerApprovedWorkingSelection} from "../logic/engine22/wave/ownerApprovedWorkingSelectionV1.js";
test("Micro owner ABC anchors, projections, and selection",()=>{
 const w=buildCurrentWavelength({symbol:"ES",currentPrice:7900});
 const m=w.degrees.micro.ownerMicroCDownOct31;
 assert.equal(m.activeWave,"C");
 assert.equal(m.direction,"DOWN");
 assert.equal(m.waveA.startHigh,7810);
 assert.equal(m.waveA.low,7663.25);
 assert.equal(m.priorBEnding.price,7814.75);
 assert.deepEqual(m.levels.map(l=>l.price),[7724,7668,7628,7577.25,7521.25]);
 assert.equal(ownerApprovedWorkingSelection.degrees.micro.key,"ownerMicroCDownOct31");
 assert.ok(w.degrees.micro.ownerMicroW4Down);
 assert.ok(w.degrees.submicro.ownerSubmicroADownInsideMicroW4);
});
test("owner chart Oct30 low marks four touched, final stays watch",()=>{
 const w=buildCurrentWavelength({symbol:"ES",currentPrice:7900});
 const r=applyOwnerPriceTouchesV1({currentWavelength:w,currentPrice:7900,bars10m:[],
 evaluationTimeMs:Date.parse("2026-10-31T18:00:00Z")});
 const m=r.degrees.micro.ownerMicroCDownOct31;
 assert.deepEqual(m.levels.map(l=>l.status),["TOUCHED","TOUCHED","TOUCHED","TOUCHED","WATCH"]);
 assert.equal(m.levels[3].touchEvidenceType,"OWNER_CHART_OBSERVATION");
 assert.equal(m.levels[3].touchEvidence.verified,false);
});
