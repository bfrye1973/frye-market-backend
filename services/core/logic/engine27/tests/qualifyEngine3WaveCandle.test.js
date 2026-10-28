import test from "node:test";
import assert from "node:assert/strict";
import {qualifyEngine3WaveCandle} from "../waveObservation/qualifyEngine3WaveCandle.js";
const bars=[{time:1793210400,o:7770,h:7780,l:7768,c:7777},{time:1793211000,o:7777,h:7789,l:7770,c:7773}];
const sourceIdentity={providerTicker:"ESZ26",priceBasis:"RAW_PHYSICAL_CONTRACT"};
test("qualified completed bar produces study without wave confirmation",()=>{
 const r=qualifyEngine3WaveCandle({bars,asOf:"2026-10-28T18:30:00Z",physicalContract:"ESZ26",sourceIdentity,direction:"UP"});
 assert.equal(r.available,true);assert.equal(r.study.completionConfirmed,false);
});
test("missing contract, source identity and future bar fail closed",()=>{
 assert.equal(qualifyEngine3WaveCandle({bars,asOf:"2026-10-28T18:30:00Z",sourceIdentity}).available,false);
 assert.equal(qualifyEngine3WaveCandle({bars,asOf:"2026-10-28T18:30:00Z",physicalContract:"ESZ26"}).available,false);
 assert.equal(qualifyEngine3WaveCandle({bars,asOf:"2026-10-28T15:00:00Z",physicalContract:"ESZ26",sourceIdentity}).available,false);
});
