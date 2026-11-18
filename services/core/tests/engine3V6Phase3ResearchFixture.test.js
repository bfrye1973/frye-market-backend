import test from "node:test";
import assert from "node:assert/strict";
import {runEngine3V6ResearchFixture as run}
 from "../logic/engine3/v6/runEngine3V6ResearchFixture.js";
const m=60000,t=Date.parse("2026-11-17T17:00:00Z");
const bar=(end,dur,open,high,low,close)=>({
 time:(end-dur)/1000,open,high,low,close});
const z={id:"Z",zoneId:"Z",low:7290,high:7348,midline:7319,widthPoints:58};
const normalized={eligible:true,zone:z,identity:{candidateId:"C",zoneId:"Z"}};
const candidate={symbol:"ES",strategyId:"intraday_scalp@10m",
 candidateId:"C",zoneId:"Z"};
const handoff={candidateId:"C",zoneId:"Z",authorizeEngine3Evaluation:true,
 terminalLifecycle:false,engine3AuthorizationStartedAt:new Date(t-6*m).toISOString(),
 engine3AuthorizationSourceAsOf:new Date(t).toISOString(),
 engine3AuthorizationSourceReady:true,engine3AuthorizationStorageHealthy:true,
 engine3AuthorizationPersisted:true,
 engine3AuthorizationStorageStatus:"WRITE_READBACK_VERIFIED",
 engine3AuthorizationPersistenceMode:"PERSISTENT_MONOTONIC"};
const pre5=Array.from({length:17},(_,i)=>bar(t-(90-i*5)*m,5*m,7330,7335,7325,7330));
const past=bar(t-5*m,5*m,7351,7355,7345,7348);
const one=bar(t-m,m,7347,7352,7346,7348);
test("production-shaped fixture keeps original Engine26/v5 inputs immutable and uses causal lens",()=>{
 const input={normalizedZoneInput:normalized,engine26LocationCandidate:candidate,
  engine26ReactionHandoff:handoff,
  evaluationTimeMs:t,bars5m:[...pre5,past],bars1m:[one],
  v5:{canonical:{canonical:{direction:"LONG"}}},
  policy:{geometry:{atrPeriod:3}}};
 const immutable=JSON.stringify(input);
 const out=run(input);
 assert.equal(JSON.stringify(input),immutable);
 assert.equal(out.mode,"READ_ONLY_FIXTURE");
 assert.equal(out.recordingActivated,false);
 assert.equal(out.noPermissionCreated,true);
 assert.equal(out.trace.noPermissionCreated,true);
 assert.equal(out.causal.v5CanonicalControlReused,false);
 assert.equal(out.evidence.completed5mEligible.length,1);
 assert.equal(out.shadow.establishedNow,false);
 assert.equal(out.readiness.status,"AUTHORITATIVE_TIMESTAMP_VALID");
 assert.equal(out.trace.reaction.engine26Zone.low,7290);
});
test("uncertain observed start is isolated and cannot use prior bars for direction",()=>{
 const out=run({normalizedZoneInput:normalized,engine26LocationCandidate:candidate,
  engine26ReactionHandoff:{...handoff,engine3AuthorizationStartedAt:null},
  evaluationTimeMs:t,bars5m:[...pre5,past],bars1m:[one]});
 assert.equal(out.readiness.status,"FIELD_NOT_YET_PUBLISHED");
 assert.equal(out.evidence.activationSource,"ENGINE3_OBSERVED");
 assert.equal(out.evidence.completed5mEligible.length,0);
 assert.equal(out.shadow.canonicalDirection,"NEUTRAL");
 assert.equal(out.trace.transition,"HOLD");
});
test("deterministic repeated fixture yields identical causal trace without side effects",()=>{
 const args={normalizedZoneInput:normalized,engine26LocationCandidate:candidate,
  engine26ReactionHandoff:handoff,evaluationTimeMs:t,
  bars5m:[...pre5,past],bars1m:[one],policy:{geometry:{atrPeriod:3}}};
 const first=run(args),second=run(args);
 assert.deepEqual(first,second);
});
