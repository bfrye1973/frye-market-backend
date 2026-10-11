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
 assert.ok(r.blockers.includes("INTRADAY_SUBMICRO_PARENT_WAVE_UNRESOLVED"));
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
 assert.ok(r.blockers.includes("MINUTE_HISTORY_SOURCE_REQUIRED"));
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
