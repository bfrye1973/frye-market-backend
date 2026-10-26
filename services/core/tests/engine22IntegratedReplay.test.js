import test from "node:test";
import assert from "node:assert/strict";
import {replayEngine22CompletionShadow as replay} from "../logic/engine22/integration/replayCompletionShadow.js";
import {ENGINE22_V3_SCHEMA,ENGINE22_V3_DEGREES,ENGINE22_V3_PARENT}
 from "../logic/engine22/v3/canonicalStructure.js";

// RESEARCH FIXTURE ONLY. Prices resemble the October 26 discussion, but are
// NOT authenticated ES market history or proof of any actual C-wave completion.
const b=(i,open,high,low,close)=>({
  sourceTimestamp:new Date(Date.UTC(2026,9,26,12,i*5)).toISOString(),
  sourceBarId:"SIM-ES-5M-"+i,timeframe:"5m",sourceVendor:"SIMULATED",
  sourceSeriesId:"SIM-CONTINUOUS-ES",closed:true,open,high,low,close,
});
const bars=[
  b(0,7661,7665,7658,7661),
  b(1,7656,7659,7654,7656),
  b(2,7653,7657,7651,7653),
  b(3,7649.5,7653,7648.5,7649.5),
  b(4,7650,7651,7649.5,7650),
  b(5,7654,7656,7650.75,7654),
  b(6,7660,7663,7654,7660),
  b(7,7668,7670,7659,7668),
];
const identity="RESEARCH-FIXTURE-MICRO-COUNT";
const owner={
  degreeId:"MICRO",parentDegree:"SUBMINUTE",countId:identity,
  modelVersion:"engine22.microCDownOwnerWatch.v1",
  ownerApprovalRef:"RESEARCH_ONLY_NOT_REAL_APPROVAL",
  sequenceDirection:"DOWN",lifecycle:"DEVELOPING",
  activeWave:null,patternType:"ABC",anchors:{},
};
const t=i=>new Date(Date.UTC(2026,9,1+i)).toISOString();
const mark=(price,i)=>({price,time:t(i),status:"CONFIRMED"});
const canonical={
  schema:ENGINE22_V3_SCHEMA,symbol:"ES",noExecution:true,noPermissionCreated:true,
  degrees:Object.fromEntries(ENGINE22_V3_DEGREES.map((degree,index)=>[
    degree,{
      degreeId:degree,countId:degree==="MICRO"?identity:"FIXTURE-"+degree,
      sequenceId:"SEQ-"+degree,parentDegree:ENGINE22_V3_PARENT[degree],
      parentWave:null,activeWave:"W3",lifecycle:"DEVELOPING",
      anchors:{W1_LOW:mark(7500,0),W1_HIGH:mark(7600,1),W2_LOW:mark(7550,2)},
      history:[],provenance:{source:"SIMULATED_REPLAY"},
      invalidation:{},fibModel:{},sequenceDirection:"UP",
    }
  ])),
};
const args={bars,timeframe:"5m",degree:"MICRO",ownerCount:owner,canonical,
 expectedSource:{sourceVendor:"SIMULATED",sourceSeriesId:"SIM-CONTINUOUS-ES"}};
test("simulated 7648.50 pivot gives watch then candidate, never confirmed count",()=>{
  const r=replay(args);
  assert.equal(r.available,true,JSON.stringify(r.reasonCodes));
  assert.equal(r.chronological[0].status,"TARGET_REACHED_WATCH");
  assert.equal(r.finalStatus,"COMPLETION_CANDIDATE");
  assert.deepEqual(r.events.map(x=>x.status),["TARGET_REACHED_WATCH","COMPLETION_CANDIDATE"]);
  assert.equal(r.publishAuthorized,false);
  assert.equal(r.countTransitionAuthorized,false);
  assert.ok(r.events.every(e=>e.historicalClaim===false&&e.fixtureReplayOnly===true));
});
test("replaying the same fixture is deterministic and never duplicates events",()=>{
  const first=replay(args),again=replay(structuredClone(args));
  assert.deepEqual(again,first);
  assert.equal(new Set(first.events.map(x=>x.eventId)).size,first.events.length);
});
test("truncated replay history cannot invent a confirmation",()=>{
  const first=replay({...args,bars:bars.slice(0,5)});
  assert.equal(first.available,true);
  assert.equal(first.finalStatus,"TARGET_REACHED_WATCH");
  assert.equal(first.countTransitionAuthorized,false);
});
test("missing interval fails closed instead of silently treating sparse bars as continuous",()=>{
  const wrong=bars.filter((_,i)=>i!==2);
  assert.equal(replay({...args,bars:wrong}).available,false);
});
test("forming candle fails closed",()=>{
  assert.equal(replay({...args,bars:bars.map((x,i)=>i===6?{...x,closed:false}:x)}).available,false);
});
test("source identity conflict fails closed",()=>{
  const wrong=bars.map((x,i)=>i===2?{...x,sourceVendor:"OTHER"}:x);
  assert.equal(replay({...args,bars:wrong}).available,false);
});
test("no real current count ID means no autonomous replay claims",()=>{
  assert.equal(replay({...args,ownerCount:{...owner,countId:"ES-V3-BASELINE-MICRO"}}).available,false);
});
test("the replay does not mutate input bars, canonical model or working count",()=>{
  const before=structuredClone(args);
  replay(args);
  assert.deepEqual(args,before);
});
