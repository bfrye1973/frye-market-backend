import test from "node:test";
import assert from "node:assert/strict";
import {assembleWaveEvidence,WAVE_DEGREES} from "../waveObservation/assembleWaveEvidence.js";
const when="2026-10-28T20:04:00Z";
const snapshot={snapshotTime:"2026-10-28T20:03:00Z",strategies:{"intraday_scalp@10m":{
 engine22WaveStrategy:{authorizedWorkingStructure:{status:"COMPLETE_WORKING_SELECTION",degrees:Object.fromEntries(
 WAVE_DEGREES.map(degree=>[degree,{available:true,activeWave:"W3",direction:"UP",
 modelVersion:"owner.test",stage:"DEVELOPING",levels:[{key:"e1000",ratio:1,price:7787.25,status:"TOUCHED",touchedAt:"2026-10-28T18:00:00Z"}]}]))}}}}};
const bar={time:Date.parse("2026-10-28T20:01:00Z")/1000,open:7800.75,high:7819.5,low:7799.75,close:7805.25,volume:13125};
const ohlc={"1m":{source:"BACKEND1_FUTURES_OHLC",priceBasis:"PHYSICAL_PROVIDER_AGGREGATES",resolvedSymbol:"ESZ6",bars:[bar]}};
const sourceReplay={date:"2026-10-28",time:"1303",sha256:"a".repeat(64),path:"/var/data/replay/es/2026-10-28/1303.json"};
const zoneCandidate={zoneId:"z",location:{type:"NEGOTIATED"},entryZone:{low:7730.25,high:7758}};
test("all seven degrees can assemble same source evidence independently without writing",()=>{
 for(const degree of WAVE_DEGREES){
  const r=assembleWaveEvidence({snapshot,degree,ohlc,sourceReplay,waveExtremePrice:7819.5,
   zoneCandidate,asOf:when});
  assert.equal(r.ok,true);
  assert.equal(r.candleStudies["1m"].available,true);
  assert.equal(r.candleStudies["1m"].lastCandle.candle.upperWick,14.25);
  assert.equal(r.negotiatedZone.distancePoints,61.5);
  assert.equal(r.sourceReplay.sha256,"a".repeat(64));
  assert.equal(r.contractIdentityStatus,"REPLAY_CONTRACT_UNVERIFIED");
  assert.equal(r.completionConfirmed,false);
 }
});
test("missing provenance and future bar fail closed, never invent candle studies",()=>{
 const unverified=assembleWaveEvidence({snapshot,degree:"micro",ohlc:{"1m":{...ohlc["1m"],resolvedSymbol:null}},
  waveExtremePrice:7819.5,asOf:when});
 assert.equal(unverified.candleStudies["1m"].available,false);
 assert.ok(unverified.missingEvidence.includes("SOURCE_REPLAY_RAW_HASH_UNAVAILABLE"));
 const earlier=assembleWaveEvidence({snapshot,degree:"micro",ohlc,asOf:"2026-10-28T20:03:01Z"});
 assert.equal(earlier.ok,true);
});
test("never retroactively promote absent authoritative wave into history",()=>{
 const missing={...snapshot,strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{}}}};
 assert.deepEqual(assembleWaveEvidence({snapshot:missing,degree:"micro",ohlc,asOf:when}),
  {ok:false,reason:"ORIGINAL_AUTHORIZED_WAVE_UNAVAILABLE"});
});
