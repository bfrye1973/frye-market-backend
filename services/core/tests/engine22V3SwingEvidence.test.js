import test from "node:test";
import assert from "node:assert/strict";
import {detectEngine22V3SwingEvidence as detect} from "../logic/engine22/v3/detectSwingEvidence.js";
const prices=[10,12,16,11,9,13,17,12,8];
const bars=prices.map((p,i)=>({sourceTimestamp:new Date(Date.UTC(2026,9,11,12,i*5)).toISOString(),
 sourceBarId:"bar-"+i,timeframe:"5m",closed:true,high:p,low:p-1}));
test("candidate high requires two later closed bars",()=>{
 const r=detect({bars:bars.slice(0,5),left:2,right:2,side:"HIGH"});
 assert.equal(r.available,true);
 assert.equal(r.candidates.length,1);
 assert.equal(r.candidates[0].price,16);
 assert.equal(r.candidates[0].waveCompletionConfirmed,false);
});
test("pivot unavailable without following confirmation bars",()=>{
 const r=detect({bars:bars.slice(0,3),left:2,right:2,side:"HIGH"});
 assert.equal(r.available,false);
});
test("live bars are rejected",()=>{
 const b=structuredClone(bars);b[8].closed=false;
 assert.equal(detect({bars:b,side:"HIGH"}).available,false);
});
test("duplicate source timestamps fail closed",()=>{
 const b=structuredClone(bars);b[1].sourceTimestamp=b[0].sourceTimestamp;
 assert.equal(detect({bars:b,side:"HIGH"}).available,false);
});
