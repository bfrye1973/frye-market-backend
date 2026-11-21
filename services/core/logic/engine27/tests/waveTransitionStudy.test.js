import test from "node:test";
import assert from "node:assert/strict";
import {buildWaveTransitionStudy} from "../waveObservation/buildWaveTransitionStudy.js";
const before={snapshotTime:"2026-10-28T18:16:31Z",strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{authorizedWorkingStructure:{
 status:"COMPLETE_WORKING_SELECTION",degrees:{
 micro:{available:true,activeWave:"W3",direction:"UP",modelVersion:"micro.w3",levels:[{key:"e1000",price:7787.25,status:"TOUCHED",touchedAt:"2026-10-28T16:50:00Z"}]},
 submicro:{available:true,activeWave:"W5",direction:"UP",modelVersion:"sub.w5",levels:[{key:"e618",price:7778.5,status:"TOUCHED",touchedAt:"2026-10-28T17:01:20Z"}]}
}}}}}};
const after={snapshotTime:"2026-10-28T19:31:54Z",strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{authorizedWorkingStructure:{
 status:"COMPLETE_WORKING_SELECTION",degrees:{
 micro:{available:true,activeWave:"W4",direction:"DOWN",modelVersion:"micro.w4"},
 submicro:{available:true,activeWave:"A",direction:"DOWN",modelVersion:"sub.a"}
}}}}}};
const negotiatedCandidate={zoneId:"z1",location:{type:"NEGOTIATED"},entryZone:{low:7730.25,high:7758,midline:7744.25}};
test("Micro W3/W4 transition preserves last touch and 30.50-point zone distance",()=>{
 const s=buildWaveTransitionStudy({before,after,degree:"micro",endingPrice:7788.5,negotiatedCandidate});
 assert.equal(s.ok,true);assert.equal(s.lastPublishedTouch.price,7787.25);
 assert.equal(s.negotiatedZone.distancePoints,30.5);
 assert.equal(s.candleStatus,"OHLC_UNAVAILABLE");
 assert.equal(s.structuralCompletionIndependentlyVerified,false);
});
test("Submicro W5/A transition remains separate and last touch is 0.618",()=>{
 const s=buildWaveTransitionStudy({before,after,degree:"submicro",endingPrice:7788.5,negotiatedCandidate});
 assert.equal(s.lastPublishedTouch.price,7778.5);assert.equal(s.after.activeWave,"A");
 assert.equal(s.contractIdentityStatus,"UNVERIFIED");
});
test("same-model Replay and reverse timestamps cannot invent a new wave transition",()=>{
 const same=buildWaveTransitionStudy({before,after:before,degree:"micro",endingPrice:7788.5});
 assert.equal(same.ok,false);
 const backwards=buildWaveTransitionStudy({before:after,after:before,degree:"micro",endingPrice:7788.5});
 assert.equal(backwards.ok,false);
});
