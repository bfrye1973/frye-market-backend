import test from "node:test";
import assert from "node:assert/strict";
import {inspectEngine26AuthorizationContract as inspect}
 from "../logic/engine3/v6/inspectEngine26AuthorizationContract.js";
const t=Date.parse("2026-11-17T17:00:00Z");
const valid={handoff:{candidateId:"C",zoneId:"Z",authorizeEngine3Evaluation:true,
 terminalLifecycle:false,engine3AuthorizationSourceReady:true,
 engine3AuthorizationStorageHealthy:true,engine3AuthorizationPersisted:true,
 engine3AuthorizationStorageStatus:"WRITE_READBACK_VERIFIED",
 engine3AuthorizationPersistenceMode:"PERSISTENT_MONOTONIC",
 engine3AuthorizationSourceAsOf:new Date(t).toISOString()},
 candidate:{candidateId:"C",zoneId:"Z"},
 normalizedZoneInput:{eligible:true,identity:{candidateId:"C",zoneId:"Z"}},
 evaluationTimeMs:t};
test("source field absent -> explicit observed fallback; never infer candidateLifecycleStartTime",()=>{
 const r=inspect({...valid,handoff:{...valid.handoff,candidateLifecycleStartTime:
 new Date(t-3600000).toISOString()}});
 assert.equal(r.status,"FIELD_NOT_YET_PUBLISHED");
 assert.equal(r.observedFallbackAllowed,true);
 assert.equal(r.candidateLifecycleStartTimeAccepted,false);
});
test("valid Engine26 time must be as-of and exact identity",()=>{
 const r=inspect({...valid,handoff:{...valid.handoff,
 engine3AuthorizationStartedAt:new Date(t-60000).toISOString()}});
 assert.equal(r.status,"AUTHORITATIVE_TIMESTAMP_VALID");
 assert.equal(r.authoritativeTimestampMs,t-60000);
 const future=inspect({...valid,handoff:{...valid.handoff,
 engine3AuthorizationStartedAt:new Date(t+60000).toISOString()}});
 assert.equal(future.status,"AUTHORIZATION_TIMESTAMP_IN_FUTURE");
 assert.equal(future.authoritativeTimestampMs,null);
});
test("source conflict, identity mismatch and run reset fail closed",()=>{
 const timestamp=new Date(t-60000).toISOString();
 const conflict=inspect({...valid,handoff:{...valid.handoff,engine3AuthorizationStartedAt:timestamp},
 candidate:{...valid.candidate,engine3AuthorizationStartedAt:new Date(t-120000).toISOString()}});
 assert.equal(conflict.status,"ENGINE26_SOURCE_TIMESTAMP_CONFLICT");
 const mismatch=inspect({...valid,normalizedZoneInput:{eligible:true,
 identity:{candidateId:"OTHER",zoneId:"Z"}}});
 assert.equal(mismatch.status,"AUTHORIZATION_NOT_ELIGIBLE");
 const moved=inspect({...valid,handoff:{...valid.handoff,engine3AuthorizationStartedAt:timestamp},
 priorActivation:{active:true,candidateId:"C",zoneId:"Z",source:"ENGINE26_AUTHORIZED",
 startedAtMs:t-120000}});
 assert.equal(moved.status,"ENGINE26_CONTINUITY_CHANGED_WITHOUT_RUN_RESET");
});

test("authoritative Engine26 timestamp requires source-ready storage-healthy and persisted",()=>{
 const timestamp=new Date(t-60000).toISOString();
 const noReady=inspect({...valid,handoff:{...valid.handoff,
  engine3AuthorizationStartedAt:timestamp,engine3AuthorizationSourceReady:false}});
 assert.equal(noReady.status,"ENGINE26_SOURCE_NOT_READY");
 assert.equal(noReady.authoritativeTimestampMs,null);

 const unhealthy=inspect({...valid,handoff:{...valid.handoff,
  engine3AuthorizationStartedAt:timestamp,engine3AuthorizationStorageHealthy:false}});
 assert.equal(unhealthy.status,"ENGINE26_STORAGE_UNHEALTHY");
 assert.equal(unhealthy.authoritativeTimestampMs,null);

 const unpersisted=inspect({...valid,handoff:{...valid.handoff,
  engine3AuthorizationStartedAt:timestamp,engine3AuthorizationPersisted:false}});
 assert.equal(unpersisted.status,"ENGINE26_AUTHORIZATION_NOT_PERSISTED");
 assert.equal(unpersisted.authoritativeTimestampMs,null);
});
test("future Engine26 source as-of fails closed even when timestamp itself is historical",()=>{
 const r=inspect({...valid,handoff:{...valid.handoff,
  engine3AuthorizationStartedAt:new Date(t-60000).toISOString(),
  engine3AuthorizationSourceAsOf:new Date(t+60000).toISOString()}});
 assert.equal(r.status,"ENGINE26_SOURCE_ASOF_IN_FUTURE");
 assert.equal(r.authoritativeTimestampMs,null);
});

test("Engine26 health booleans cannot override an untrusted persistence mode",()=>{
 const started=new Date(t-60000).toISOString();
 for(const mode of ["READ_ONLY_HISTORICAL","READ_ONLY_STALE_WRITER",
  "FAIL_CLOSED_WRITE_FAILURE","READ_ONLY",null]){
  const r=inspect({...valid,handoff:{...valid.handoff,
   engine3AuthorizationStartedAt:started,engine3AuthorizationPersistenceMode:mode}});
  assert.equal(r.status,"ENGINE26_PERSISTENCE_MODE_UNVERIFIED");
  assert.equal(r.authoritativeTimestampMs,null);
  assert.equal(r.observedFallbackAllowed,true);
 }
});
test("source as-of earlier than authorization cannot be authoritative",()=>{
 const r=inspect({...valid,handoff:{...valid.handoff,
  engine3AuthorizationStartedAt:new Date(t-30000).toISOString(),
  engine3AuthorizationSourceAsOf:new Date(t-60000).toISOString()}});
 assert.equal(r.status,"ENGINE26_SOURCE_ASOF_BEFORE_AUTHORIZATION");
 assert.equal(r.authoritativeTimestampMs,null);
});
