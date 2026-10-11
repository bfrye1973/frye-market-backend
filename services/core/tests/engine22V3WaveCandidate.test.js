import test from "node:test";
import assert from "node:assert/strict";
import {proposeEngine22V3WaveCandidate as propose} from "../logic/engine22/v3/proposeWaveCandidate.js";
const data=[10,12,16,11,9,13,17].map((p,i)=>({
 sourceTimestamp:new Date(Date.UTC(2026,9,11,12,i*5)).toISOString(),
 sourceBarId:"bar-"+i,timeframe:"5m",closed:true,high:p,low:p-1,
}));
const s=(activeWave,sequenceDirection="UP")=>({
 degreeId:"INTRADAY_SUBMICRO",countId:"COUNT-1",activeWave,sequenceDirection,
 lifecycle:"DEVELOPING",waveStartTimestamp:"2026-10-11T12:00:00Z",
});
test("upward W1 yields confirmed-bar high candidate but not wave completion",()=>{
 const r=propose({degreeState:s("W1"),bars:data.slice(0,5)});
 assert.equal(r.available,true);
 assert.equal(r.candidate.price,16);
 assert.equal(r.candidate.waveCompletionConfirmed,false);
});
test("upward W2 looks for low pivot instead of high pivot",()=>{
 const r=propose({degreeState:s("W2"),bars:data});
 assert.equal(r.available,true);
 assert.equal(r.candidate.side,"LOW");
 assert.equal(r.candidate.price,8);
});
test("locked wave cannot receive autonomous pivot candidate",()=>{
 const z=s("W1");z.lifecycle="LOCKED";
 assert.equal(propose({degreeState:z,bars:data}).available,false);
});
test("no inferred start timestamp",()=>{
 const z=s("W1");delete z.waveStartTimestamp;
 assert.ok(propose({degreeState:z,bars:data}).reasonCodes.includes("WAVE_START_TIMESTAMP_REQUIRED"));
});
