import test from "node:test";
import assert from "node:assert/strict";
import {createCanonicalMicroState} from "../logic/engine22/microV2/canonicalMicroState.js";
import {buildSubmicroMigrationCandidate} from "../logic/engine22/migration/buildSubmicroMigrationCandidate.js";
const state=()=>createCanonicalMicroState({countId:"ES-MICRO-OLD",sequenceId:"ES-MICRO-SEQ",
 sequenceDirection:"UP",origin:{price:7782.75,timestamp:"2026-10-08 07:00",source:"LEGACY"},
 parentDegree:"SUBMINUTE",parentDirection:"UP"});
test("migration preserves all historical source state without modifying it",()=>{
 const original=state(),before=JSON.stringify(original);
 const result=buildSubmicroMigrationCandidate({sourceMicroState:original,parentMicroCountId:"ES-MICRO-NEW"});
 assert.equal(result.ok,true);
 assert.equal(JSON.stringify(original),before);
 const s=result.candidate;
 assert.equal(s.degree,"SUBMICRO");assert.equal(s.parentContext.degree,"MICRO");
 assert.equal(s.parentContext.countId,"ES-MICRO-NEW");
 assert.notEqual(s.countId,original.countId);assert.notEqual(s.sequenceId,original.sequenceId);
 assert.equal(s.sourceProvenance.sourceCountId,original.countId);
 assert.deepEqual(s.waves,original.waves);
 assert.equal(s.publicationEligible,false);
 assert.equal(s.automationEligible,false);
 s.waves.W1.reasonCodes.push("LOCAL_CANDIDATE_ONLY");
 assert.deepEqual(original.waves.W1.reasonCodes,[]);
});
test("migration fails closed if source is invalid or new parent missing",()=>{
 assert.equal(buildSubmicroMigrationCandidate({sourceMicroState:{},parentMicroCountId:"parent"}).ok,false);
 assert.deepEqual(buildSubmicroMigrationCandidate({sourceMicroState:state()}).reasonCodes,["PARENT_MICRO_COUNT_ID_REQUIRED"]);
});

test("migration refuses new Micro parent identical to old source count",()=>{
 const original=state();
 const r=buildSubmicroMigrationCandidate({sourceMicroState:original,parentMicroCountId:original.countId});
 assert.equal(r.ok,false);
 assert.deepEqual(r.reasonCodes,["COUNT_ID_COLLISION"]);
});
test("migration-generated identifier is path-safe and deterministic",()=>{
 const original=state();
 original.countId="OLD/MICRO/ES";
 original.sequenceId="OLD/SEQ/ES";
 const a=buildSubmicroMigrationCandidate({sourceMicroState:original,parentMicroCountId:"NEW-MICRO"});
 const b=buildSubmicroMigrationCandidate({sourceMicroState:original,parentMicroCountId:"NEW-MICRO"});
 assert.equal(a.ok,true);
 assert.equal(a.candidate.countId,b.candidate.countId);
 assert.equal(a.candidate.countId.includes("/"),false);
});
