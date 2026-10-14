import test from "node:test";
import assert from "node:assert/strict";
import {qualifyExistingEsBarsForFibTouchV1 as qualify} from "../logic/engine22/research/qualifyExistingEsBarsForFibTouchV1.js";
const model={seriesId:"ESZ6",priceBasis:"RAW_UNADJUSTED_CONTRACT"};
const args={resolvedSymbol:"ESZ6",priceBasis:"RAW_UNADJUSTED_CONTRACT",model,
  timeframe:"10m",evaluationTimeMs:Date.parse("2026-10-14T15:00:00Z")};
const bars=[{time:1791988800,low:7799,high:7801}];
test("rejects contract or model-basis uncertainty",()=>{
 assert.equal(qualify({...args,resolvedSymbol:null,bars}).eligible,false);
 assert.equal(qualify({...args,model:{...model,seriesId:"ESU6"},bars}).eligible,false);
 assert.equal(qualify({...args,priceBasis:"ES1_BACKADJUSTED",bars}).eligible,false);
});
test("uses exact provider candle-start ID, never a fabricated tick timestamp",()=>{
 const start=Math.floor(Date.parse("2026-10-14T14:40:00Z")/1000);
 const r=qualify({...args,bars:[{time:start,low:7799,high:7801}]});
 assert.equal(r.observations.length,1);
 assert.equal(r.observations[0].sourceBarId,`ESZ6:10m:${start}`);
 assert.equal(r.observations[0].sourceTimestamp,"2026-10-14T14:40:00.000Z");
});
test("excludes forming and malformed candles",()=>{
 const early=Math.floor(Date.parse("2026-10-14T14:40:00Z")/1000);
 const forming=Math.floor(Date.parse("2026-10-14T14:55:00Z")/1000);
 const r=qualify({...args,bars:[{time:early,low:7799,high:7801},{time:forming,low:7780,high:7800},{time:early,low:7820,high:7800}]});
 assert.equal(r.observations.length,1);
});
