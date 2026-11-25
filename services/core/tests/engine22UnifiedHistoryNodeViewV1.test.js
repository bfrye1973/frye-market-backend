import test from "node:test";
import assert from "node:assert/strict";
import { buildWaveHistoryNodeViewV1, WAVE_HISTORY_NODE_VIEW_SCHEMA } from "../logic/engine22/history/waveHistoryNodeViewV1.js";
const event = {
 schema:"engine22.waveHistoryEvent.v1",revision:8,eventHash:"immutable-history-hash",
 observedAt:"2026-11-08T18:00:00Z",
 content:{schema:"engine22.waveHistoryObservation.v1",
 publishedAt:"2026-11-08T17:59:00Z",selectionApprovalReference:"OWNER_SELECTION_REV6",
 modelFingerprint:"fingerprint",degrees:{
 primary:{available:true,sourcePath:"degreeStates.primary",modelVersion:"primary.v1",
  selection:{activeWave:"W5",direction:"UP"},sourceModel:{activeWave:"W5"}},
 intermediate:{available:true,sourcePath:"degreeStates.intermediate",modelVersion:"intermediate.v1",
  selection:{activeWave:"W3",direction:"UP"},sourceModel:{activeWave:"W3"}},
 minor:{available:true,sourcePath:"degreeStates.minor",modelVersion:"minor.v1",
  selection:{activeWave:"W5",direction:"UP"},sourceModel:{activeWave:"W5"}},
 minute:{available:true,sourcePath:"currentWavelength.degrees.minute.ownerMinuteW2Retracement",modelVersion:"minute.v1",
  selection:{activeWave:"W2",direction:"DOWN"},sourceModel:{activeWave:"W2"}},
 subminute:{available:true,sourcePath:"currentWavelength.degrees.subminute.ownerSubminuteCDownOct31",modelVersion:"subminute.v1",
  selection:{activeWave:"C",direction:"DOWN"},sourceModel:{activeWave:"C"}},
 micro:{available:true,sourcePath:"currentWavelength.degrees.micro.ownerMicroCDownOct31",modelVersion:"micro.v1",
  selection:{activeWave:"C",direction:"DOWN"},sourceModel:{activeWave:"C"}},
 submicro:{available:true,sourcePath:"currentWavelength.degrees.submicro.ownerSubmicroCDownNov2",modelVersion:"submicro.v1",
  selection:{activeWave:"C",direction:"DOWN"},sourceModel:{activeWave:"C"}}
 }}
};
test("read-only view exposes all seven degree selections but never approves fabricated permanent nodes",()=>{
 const view=buildWaveHistoryNodeViewV1(event);
 assert.equal(view.schema,WAVE_HISTORY_NODE_VIEW_SCHEMA);
 assert.deepEqual(view.degreeOrder,["primary","intermediate","minor","minute","subminute","micro","submicro"]);
 assert.equal(view.revision,8);
 assert.equal(view.degrees.primary.activeWave,"W5");
 assert.equal(view.degrees.intermediate.activeWave,"W3");
 assert.equal(view.degrees.minor.activeWave,"W5");
 assert.equal(view.degrees.micro.activeWave,"C");
 assert.ok(Object.values(view.degrees).every(x=>x.plotAllowed===false && x.permanentNodeId===null));
 assert.equal(view.historicalAsOfSupported,false);
 assert.equal(view.noPermissionCreated,true);
});
test("missing degree remains explicit unavailable not a fallback",()=>{
 const e=structuredClone(event);
 delete e.content.degrees.micro;
 const v=buildWaveHistoryNodeViewV1(e);
 assert.equal(v.degrees.micro.available,false);
 assert.equal(v.degrees.micro.plotReason,undefined);
 assert.equal(v.degrees.primary.available,true);
});
test("bad history event and missing revision fail closed",()=>{
 assert.throws(()=>buildWaveHistoryNodeViewV1({}),/ENGINE22_HISTORY_REVISION_UNAVAILABLE/);
 assert.throws(()=>buildWaveHistoryNodeViewV1({...event,revision:0}),/ENGINE22_HISTORY_REVISION_UNAVAILABLE/);
});
test("publication time and observation time are distinct and history remains immutable",()=>{
 const original=structuredClone(event);
 const view=buildWaveHistoryNodeViewV1(event);
 assert.equal(view.publishedAtUtc,"2026-11-08T17:59:00Z");
 assert.equal(view.observedAtUtc,"2026-11-08T18:00:00Z");
 assert.deepEqual(event,original);
});
