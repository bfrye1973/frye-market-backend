import test from "node:test";
import assert from "node:assert/strict";
import {reviewMicroW4Overlap} from "../logic/engine22/migration/reviewMicroW4Overlap.js";
test("4h body remains above W1 but wick overlap still blocks standard impulse",()=>{
 const r=reviewMicroW4Overlap({w1High:7805,w4Low:7782.75,completed4hBars:[
  {time:1791504000,open:7838,high:7850,low:7782.75,close:7820}
 ]});
 assert.equal(r.overlapPoints,22.25);
 assert.equal(r.anyWickBelow,true);
 assert.equal(r.anyBodyBelow,false);
 assert.equal(r.acceptedAsStandardImpulse,false);
 assert.equal(r.waveCountConfirmed,false);
});
test("no timestamp or candle evidence cannot manufacture 4h recovery",()=>{
 const r=reviewMicroW4Overlap({w1High:7805,w4Low:7782.75});
 assert.equal(r.candleBodyEvidenceAvailable,false);
 assert.equal(r.diagonalConfirmed,false);
});
test("a body below W1 is distinguished from a wick-only overlap",()=>{
 const r=reviewMicroW4Overlap({w1High:7805,w4Low:7782.75,completed4hBars:[
 {time:1791504000,open:7800,high:7820,low:7782.75,close:7815}
 ]});
 assert.equal(r.anyBodyBelow,true);
 assert.equal(r.anyWickBelow,true);
});
