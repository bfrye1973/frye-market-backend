import test from "node:test";
import assert from "node:assert/strict";
import {replayEngine22V3WaveEvidence as replay} from "../logic/engine22/v3/replayWaveEvidence.js";
const bars=[10,12,16,11,9,13,17].map((p,i)=>({
 high:p,low:p-1,closed:true,timeframe:"5m",sourceBarId:"b"+i,
 sourceTimestamp:new Date(Date.UTC(2026,9,11,12,i*5)).toISOString(),
}));
const state=()=>({degreeId:"MICRO",countId:"COUNT-1",activeWave:"W1",
 sequenceDirection:"UP",lifecycle:"DEVELOPING",
 waveStartTimestamp:"2026-10-11T11:55:00Z"});
test("replay evidence arrives only after sufficient subsequent closed bars",()=>{
 const r=replay({degreeState:state(),bars});
 assert.equal(r.ok,true);
 assert.equal(r.events.length,1);
 assert.equal(r.events[0].observedAt,bars[4].sourceTimestamp);
 assert.equal(r.events[0].pivotAt,bars[2].sourceTimestamp);
 assert.equal(r.events[0].predictedCompletion,false);
 assert.equal(r.finalState.activeWave,"W1");
});
test("replay is deterministic and cannot change its supplied state",()=>{
 const s=state(),a=structuredClone(s);
 const first=replay({degreeState:s,bars});
 const second=replay({degreeState:s,bars});
 assert.deepEqual(first,second);
 assert.deepEqual(s,a);
});
test("no future bars means no early pivot identification",()=>{
 const r=replay({degreeState:state(),bars:bars.slice(0,4)});
 assert.equal(r.events.length,0);
});
