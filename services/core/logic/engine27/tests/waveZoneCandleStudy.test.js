import test from "node:test";
import assert from "node:assert/strict";
import {studyWaveZoneCandle} from "../waveObservation/studyWaveZoneCandle.js";
const closedAt="2026-10-28T18:30:00Z",asOf="2026-10-28T18:33:00Z";
const bar={open:7780,high:7788,low:7768,close:7772,closedAt,completed:true};
const levels=[{key:"r500",label:"0.500",price:7770,status:"TOUCHED",touchedAt:"2026-10-28T18:00:00Z"},
 {key:"r618",label:"0.618",price:7778,status:"TOUCHED",touchedAt:"2026-10-28T18:20:00Z"}];
test("captures qualified wick, middle zone, and latest verified touch without completion inference",()=>{
 const r=studyWaveZoneCandle({bar,direction:"UP",levels,asOf});
 assert.equal(r.available,true);assert.equal(r.candle.upperWick,8);
 assert.equal(r.lastPublishedFibTouch.key,"r618");
 assert.equal(r.middleFibBand.closeInside,true);
 assert.equal(r.completionConfirmed,false);assert.equal(r.percentOfCases,null);
});
test("ignores later touch and WATCH levels when researching as-of evidence",()=>{
 const other=[...levels,{key:"late",price:7784,status:"TOUCHED",touchedAt:"2026-10-28T19:00:00Z"}];
 const r=studyWaveZoneCandle({bar,levels:other,asOf});
 assert.equal(r.lastPublishedFibTouch.key,"r618");
});
test("missing completed OHLC, invalid geometry and future bars fail closed",()=>{
 assert.equal(studyWaveZoneCandle({bar:{...bar,completed:false},asOf}).available,false);
 assert.equal(studyWaveZoneCandle({bar:{...bar,low:7790},asOf}).available,false);
 assert.equal(studyWaveZoneCandle({bar,asOf:"2026-10-28T18:00:00Z"}).available,false);
});
test("does not invent touch history from candle proximity",()=>{
 const r=studyWaveZoneCandle({bar,levels:levels.map(x=>({...x,status:"WATCH"})),asOf});
 assert.equal(r.lastPublishedFibTouch,null);
});
