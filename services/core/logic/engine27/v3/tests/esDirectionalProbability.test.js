import test from "node:test";
import assert from "node:assert/strict";
import {evaluateEsDirectionalProbability as evaluate} from "../probability/evaluateEsDirectionalProbability.js";
const asOf="2026-10-26T18:00:00Z";
const feature=(direction,observedAt=asOf)=>({direction,observedAt,fresh:true});
test("no evidence produces no invented probabilities",()=>{
 const x=evaluate({asOf});
 assert.equal(x.available,false);
 assert.deepEqual(x.probabilities,{up:null,down:null,sideways:null});
 assert.equal(x.calibration,"NOT_CALIBRATED");
 assert.equal(x.noExecution,true);
});
test("uncalibrated score is clearly not a probability",()=>{
 const x=evaluate({asOf,features:{esPriceAction:feature("UP"),engine22:feature("DOWN"),
  engine25:feature("UP"),engine29:feature("UP"),crossMarket:feature("UP")}});
 assert.equal(x.available,true);
 assert.equal(x.evidenceScore,60);
 assert.equal(x.directionalBias,"UP");
 assert.equal(x.state,"UNCALIBRATED_EVIDENCE_ONLY");
 assert.equal(x.probabilities.up,null);
});
test("future evidence is excluded, never leaked into score",()=>{
 const x=evaluate({asOf,features:{esPriceAction:feature("UP"),
  engine25:feature("UP","2026-10-26T18:05:00Z")}});
 assert.equal(x.evidenceScore,20);
 assert.deepEqual(x.missingSources.includes("engine25"),true);
});
test("stale source cannot masquerade as current",()=>{
 const x=evaluate({asOf,features:{esPriceAction:feature("UP"),crossMarket:{...feature("UP"),fresh:false}}});
 assert.equal(x.evidenceScore,20);
 assert.equal(x.missingSources.includes("crossMarket"),true);
});
test("rejects non-ES, unsupported horizon and invalid clock",()=>{
 assert.equal(evaluate({symbol:"SPY",asOf}).available,false);
 assert.equal(evaluate({asOf,horizonMinutes:5}).available,false);
 assert.equal(evaluate({asOf:"bad"}).available,false);
});
test("sideways and negative evidence are descriptive only",()=>{
 const x=evaluate({asOf,horizonMinutes:30,features:{esPriceAction:feature("DOWN"),engine22:feature("DOWN")}});
 assert.equal(x.directionalBias,"DOWN");
 assert.equal(x.evidenceScore,-40);
 assert.equal(x.probabilities.down,null);
});
