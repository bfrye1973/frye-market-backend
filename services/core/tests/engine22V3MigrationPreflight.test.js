import fs from "node:fs";
import {fileURLToPath} from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { preflightEngine22V3Migration } from "../logic/engine22/v3/preflightMigration.js";
const high={activeWave:"W3",stage:"DEVELOPING",marks:{W1:{low:{price:100,time:"2026-01-01"},high:{price:120,time:"2026-01-02"},status:"CONFIRMED"}}};
const active=()=>({symbol:"ES",updatedAt:"2026-09-28 08:55",schema:"legacy-v9",
 activeStructures:Object.fromEntries(["primary","intermediate","minor","minute","subminute"].map(d=>[d,structuredClone(high)]))});
test("missing smaller degree sources fail closed rather than become placeholders",()=>{
 const r=preflightEngine22V3Migration({activeWaveState:active()});
 assert.equal(r.ready,false);
 assert.ok(r.blockers.includes("MICRO_CANONICAL_SOURCE_MISSING"));
 assert.ok(r.blockers.includes("INTRADAY_SUBMICRO_CANONICAL_SOURCE_MISSING"));
 assert.equal(r.canonical,null);
});
test("preflight does not modify original manual structure",()=>{
 const src=active(),saved=structuredClone(src);
 preflightEngine22V3Migration({activeWaveState:src});
 assert.deepEqual(src,saved);
});
test("all seven degrees require real identities and parent relationships",()=>{
 const src=active();
 const r=preflightEngine22V3Migration({activeWaveState:src,
  micro:{activeWave:"W5",anchors:{}},submicro:{activeWave:"W2",anchors:{}}});
 assert.equal(r.ready,false);
 assert.ok(r.blockers.includes("MICRO_IDENTITY_UNRESOLVED"));
 assert.equal(r.blockers.includes("INTRADAY_SUBMICRO_PARENT_WAVE_UNRESOLVED"),false);
});

test("legacy structures without durable history cannot be silently promoted",()=>{
 const src=active(), identities=Object.fromEntries(
 ["INTRADAY_SUBMICRO","MICRO","SUBMINUTE","MINUTE","MINOR","INTERMEDIATE","PRIMARY"]
 .map((d,i)=>[d,{countId:"C"+i,sequenceId:"S"+i}]));
 const parentWaves=Object.fromEntries(Object.keys(identities).filter(x=>x!=="PRIMARY").map(x=>[x,"W3"]));
 const r=preflightEngine22V3Migration({
  activeWaveState:src,micro:{...high,history:[]},submicro:{...high,history:[]},
  degreeIdentities:identities,parentWaves,sourceTimestamp:"2026-10-11T00:00:00Z"
 });
 assert.equal(r.blockers.includes("MINUTE_HISTORY_SOURCE_REQUIRED"),false);
 assert.equal(r.ready,false);
});

test("real September active wave source must not be promoted with missing Micro history",()=>{
 const filename=fileURLToPath(new URL("../data/waves/active/active-wave-state-es.json",import.meta.url));
 const source=JSON.parse(fs.readFileSync(filename,"utf8"));
 const before=structuredClone(source);
 const result=preflightEngine22V3Migration({activeWaveState:source});
 assert.equal(result.ready,false);
 assert.equal(result.canonical,null);
 assert.ok(result.blockers.includes("MICRO_CANONICAL_SOURCE_MISSING"));
 assert.ok(result.blockers.includes("INTRADAY_SUBMICRO_CANONICAL_SOURCE_MISSING"));
 assert.deepEqual(source,before);
});

test("missing operational Micro history still blocks migration",()=>{
 const src=active(),identities=Object.fromEntries(
 ["INTRADAY_SUBMICRO","MICRO","SUBMINUTE","MINUTE","MINOR","INTERMEDIATE","PRIMARY"]
 .map((d,i)=>[d,{countId:"C"+i,sequenceId:"S"+i}]));
 const parentWaves=Object.fromEntries(Object.keys(identities).filter(x=>x!=="PRIMARY").map(x=>[x,"W3"]));
 const r=preflightEngine22V3Migration({
  activeWaveState:src,micro:{...high},submicro:{...high,history:[]},
  degreeIdentities:identities,parentWaves,sourceTimestamp:"2026-10-11T00:00:00Z"
 });
 assert.ok(r.blockers.includes("MICRO_HISTORY_SOURCE_REQUIRED"));
});

test("documented Submicro migration identity cannot disagree with canonical identity",()=>{
 const src=active(), identities=Object.fromEntries(
 ["INTRADAY_SUBMICRO","MICRO","SUBMINUTE","MINUTE","MINOR","INTERMEDIATE","PRIMARY"]
 .map((d,i)=>[d,{countId:"C"+i,sequenceId:"S"+i}]));
 const parentWaves=Object.fromEntries(Object.keys(identities).filter(x=>x!=="PRIMARY").map(x=>[x,"W3"]));
 const migrated={schema:"engine22.v3.migrationCandidate.v1",degreeId:"INTRADAY_SUBMICRO",
  parentDegree:"MICRO",managerApprovalId:"MANAGER-1",priorIdentity:{degreeId:"MICRO",countId:"OLD"},
  countId:"DIFFERENT",sequenceId:"S0",newIdentity:{countId:"DIFFERENT",sequenceId:"S0"},
  publicationEligible:false,preservedHistory:[{event:"LOCKED"}],preservedAnchors:{}};
 const r=preflightEngine22V3Migration({activeWaveState:src,micro:{...high,history:[{event:"START"}]},
  submicro:migrated,degreeIdentities:identities,parentWaves,
  sourceTimestamp:"2026-10-11T00:00:00Z"});
 assert.equal(r.ready,false);
 assert.ok(r.blockers.includes("SUBMICRO_MIGRATED_COUNT_ID_MISMATCH"));
});

test("Micro V2 nested wave records cannot be silently discarded during migration",()=>{
 const src=active(), identities=Object.fromEntries(
 ["INTRADAY_SUBMICRO","MICRO","SUBMINUTE","MINUTE","MINOR","INTERMEDIATE","PRIMARY"]
 .map((d,i)=>[d,{countId:"C"+i,sequenceId:"S"+i}]));
 const parentWaves=Object.fromEntries(Object.keys(identities).filter(x=>x!=="PRIMARY").map(x=>[x,"W3"]));
 const migrated={
  schema:"engine22.v3.migrationCandidate.v1",degreeId:"INTRADAY_SUBMICRO",
  parentDegree:"MICRO",managerApprovalId:"MANAGER-1",priorIdentity:{degreeId:"MICRO",countId:"OLD"},
  countId:"C0",sequenceId:"S0",newIdentity:{countId:"C0",sequenceId:"S0"},
  publicationEligible:false,preservedHistory:[{event:"LOCKED"}],
  preservedAnchors:{W1:{completion:{state:"LOCKED"},lockedHigh:7852.75}},
 };
 const r=preflightEngine22V3Migration({activeWaveState:src,
  micro:{...high,history:[{event:"START"}],managerApprovalId:"MANAGER-1"},
  submicro:migrated,degreeIdentities:identities,parentWaves,
  sourceTimestamp:"2026-10-11T00:00:00Z"});
 assert.equal(r.ready,false);
 assert.ok(r.blockers.includes("SUBMICRO_WAVE_RECORD_CONVERSION_REQUIRED"));
});

test("preserved legacy Micro locks must agree with Submicro migration lock inventory",()=>{
 const src=active(),identities=Object.fromEntries(
 ["INTRADAY_SUBMICRO","MICRO","SUBMINUTE","MINUTE","MINOR","INTERMEDIATE","PRIMARY"]
 .map((d,i)=>[d,{countId:"C"+i,sequenceId:"S"+i}]));
 const parentWaves=Object.fromEntries(Object.keys(identities).filter(x=>x!=="PRIMARY").map(x=>[x,"W3"]));
 const migrated={schema:"engine22.v3.migrationCandidate.v1",degreeId:"INTRADAY_SUBMICRO",
  parentDegree:"MICRO",managerApprovalId:"MGR-1",
  priorIdentity:{degreeId:"MICRO",countId:"OLD"},
  countId:"C0",sequenceId:"S0",newIdentity:{countId:"C0",sequenceId:"S0"},
  publicationEligible:false,preservedHistory:[{event:"W1_LOCKED"}],
  preservedAnchors:{W1:{lifecycle:"LOCKED",lockedAnchor:7852.75,lockedAt:"2026-10-09T20:00:00Z"}},
  preservedLocks:{W1:{lockedAnchor:7853.0,lockedAt:"2026-10-09T20:00:00Z"}}};
 const result=preflightEngine22V3Migration({activeWaveState:src,
  micro:{...high,history:[{event:"START"}],managerApprovalId:"MGR-1"},
  submicro:migrated,degreeIdentities:identities,parentWaves,
  sourceTimestamp:"2026-10-11T00:00:00Z"});
 assert.equal(result.ready,false);
 assert.ok(result.blockers.includes("SUBMICRO_LOCK_MIGRATION_MISMATCH_W1"));
});

test("owner-confirmed October Submicro anchors are not mistaken for recovered durable history",()=>{
 // Owner observation only, NOT legacy durable history, locks, or an approved countId.
 // Times are retained as supplied local wall-clock times; timezone is not inferred.
 const ownerSubmicro={activeWave:"W2",anchors:{
  W1_LOW:{price:7782.50,time:"2026-10-08 10:00",status:"CONFIRMED"},
  W1_HIGH:{price:7853.75,time:"2026-10-09 05:00",status:"CONFIRMED"},
  W2_LOW:{price:7826.25,time:"2026-10-09 06:00",status:"CONFIRMED"},
 }};
 const original=structuredClone(ownerSubmicro);
 const result=preflightEngine22V3Migration({activeWaveState:active(),submicro:ownerSubmicro});
 assert.equal(result.ready,false);
 assert.ok(result.blockers.includes("INTRADAY_SUBMICRO_HISTORY_SOURCE_REQUIRED"));
 assert.equal(result.canonical,null);
 assert.deepEqual(ownerSubmicro,original);
});
