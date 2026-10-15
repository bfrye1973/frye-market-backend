import test from "node:test";
import assert from "node:assert/strict";
import {buildFuturesWaveContext} from "../logic/engine22/wave/adapters/buildFuturesWaveContext.js";
test("explicit touch evidence passes through futures context unchanged",()=>{
 const models={micro:{countId:"c1",levels:[{key:"r618",price:7800}]}};
 const observations={micro:[{sourceBarId:"bar-1",eligible:true}]};
 const result=buildFuturesWaveContext({symbol:"ES",currentPrice:7801,engine22TouchResearchModels:models,engine22TouchResearchObservations:observations});
 assert.equal(result.engine22TouchResearchModels,models);
 assert.equal(result.engine22TouchResearchObservations,observations);
 assert.equal(result.currentPrice,7801);
});
test("no research evidence is synthesized from current price or bars",()=>{
 const result=buildFuturesWaveContext({symbol:"ES",currentPrice:7800,barsByTf:{"5m":[{high:7810,low:7790}]}});
 assert.equal(result.engine22TouchResearchModels,null);
 assert.equal(result.engine22TouchResearchObservations,null);
});
