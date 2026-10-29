import test from "node:test";
import assert from "node:assert/strict";
import {extractCompactWaveEvidence} from "../waveObservation/extractCompactWaveEvidence.js";
const base=()=>({schema:"engine12.multiStrategyReplay.v1",replayContract:"CANONICAL_MULTI_STRATEGY_REPLAY",
 snapshotTime:"2026-10-26T15:00:00Z",currentPrice:7739.5,
 strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{currentWavelength:{degrees:{micro:{activeWave:"C"}}}},
 confluence:{context:{volume:{engine4AuthorizedReactionParticipation:{state:"UNAVAILABLE"}}}}}}});
const at="2026-10-28T18:00:00Z";
test("legacy October Replay stays unpromoted; compact evidence retains known missingness",()=>{
 const a=extractCompactWaveEvidence(base(),{ingestedAt:at});
 assert.equal(a.ok,true);
 assert.equal(a.seed.waves.micro,null);
 assert.equal(a.seed.physicalEsContract,null);
 assert.equal(a.seed.price,7739.5);
 assert.ok(a.seed.missing.includes("ORIGINAL_AUTHORIZED_WAVE_PUBLICATION_UNAVAILABLE"));
 assert.equal(a.seed.retrospectiveAnnotation,false);
});
test("original authoritative publication preserves identity without inferred approval time",()=>{
 const x=base();
 x.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure={
 status:"COMPLETE_WORKING_SELECTION",publicationId:null,publicationRevision:1,
 degrees:{micro:{available:true,activeWave:"W3",direction:"UP",stage:"DEVELOPING_CANDIDATE",
 modelVersion:"engine22.microW3UpOct27Owner.v1",parentDegree:"subminute",parentWave:"D"}}};
 const s=extractCompactWaveEvidence(x,{ingestedAt:at}).seed;
 assert.equal(s.waves.micro.activeWave,"W3");
 assert.equal(s.wavePublicationId,null);
 assert.equal(s.waves.micro.publishedAt,null);
});
test("reject invalid schema, source time, and missing strategy",()=>{
 assert.equal(extractCompactWaveEvidence({}, {ingestedAt:at}).ok,false);
 const x=base();delete x.strategies["intraday_scalp@10m"];
 assert.equal(extractCompactWaveEvidence(x,{ingestedAt:at}).ok,false);
 assert.equal(extractCompactWaveEvidence(base(),{ingestedAt:"unknown"}).ok,false);
});
test("identical original Replay features have stable fingerprint despite different ingestion clock",()=>{
 const s=base();
 const a=extractCompactWaveEvidence(s,{ingestedAt:at}).seed;
 const b=extractCompactWaveEvidence(s,{ingestedAt:"2026-10-29T18:00:00Z"}).seed;
 assert.equal(a.featureFingerprint,b.featureFingerprint);
 assert.notEqual(a.engine27IngestedAt,b.engine27IngestedAt);
});
