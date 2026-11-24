import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildEngine6AdvisoryContext} from "../logic/engine6/6b-market-intelligence/buildEngine6AdvisoryContext.js";

test("Engine6 sees owner Primary W5 UP as research, not a live entry instruction", () => {
  const currentWavelength=buildCurrentWavelength({symbol:"ES",currentPrice:7272.25});
  const snapshot={symbol:"ES",strategies:{"intraday_scalp@10m":{
    engine22WaveStrategy:{currentWavelength}
  }}};
  const result=buildEngine6AdvisoryContext({snapshot});
  assert.equal(result.wave.ownerResearch.available,true);
  assert.equal(result.wave.ownerResearch.higherDegreeDirection,"UP");
  assert.equal(result.wave.ownerResearch.higherDegreeWave,"W5");
  assert.equal(result.wave.ownerResearch.microStage,"W1_HIGH_CANDIDATE_NOT_CONFIRMED");
  assert.equal(result.wave.ownerResearch.intradayState,"CONSOLIDATION_UNRESOLVED");
  assert.equal(result.wave.ownerResearch.notLive,true);
  assert.equal(result.wave.ownerResearch.noEntryPermission,true);
  assert.equal(result.noPermissionCreated,true);
  assert.equal(result.noEntryVeto,true);
  assert.equal(result.wave.available,false); // older authorized structure is not silently bypassed
});

test("Engine6 does not infer owner direction from missing or forged research object",()=>{
 const base={symbol:"ES",strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{
  currentWavelength:{ownerResearchContext:{schema:"engine22.ownerNov23ResearchContext.v1",primary:{direction:"UP"}}}
 }}}};
 const result=buildEngine6AdvisoryContext({snapshot:base});
 assert.equal(result.wave.ownerResearch.available,false);
 assert.equal(result.wave.ownerResearch.higherDegreeDirection,undefined);
 assert.equal(result.noPermissionCreated,true);
});
