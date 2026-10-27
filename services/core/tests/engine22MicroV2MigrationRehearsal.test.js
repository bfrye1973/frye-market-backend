import test from "node:test";
import assert from "node:assert/strict";
import {createCanonicalMicroState} from "../logic/engine22/microV2/canonicalMicroState.js";
import {rehearseEngine22MicroV2Migration as audit} from "../logic/engine22/history/rehearseMicroV2Migration.js";
const mk=(countId,now="2026-10-26T14:00:00Z")=>createCanonicalMicroState({
 countId,sequenceId:"SEQ-"+countId,sequenceDirection:"DOWN",
 origin:{price:7700,source:"FIXTURE"},sourceTimestamp:now,createdAt:now,
 parentDegree:"SUBMINUTE",parentWave:"C",parentDirection:"DOWN"
});
test("original count and active state are preserved with no invented migration events",()=>{
 const a=mk("ACTUAL_V2_FORMAT_TEST_ID");
 const r=audit({counts:[a],activeCount:a});
 assert.equal(r.ok,true);assert.equal(r.safeToMigrate,true);
 assert.equal(r.originalStates[0].originalCountId,a.countId);
 assert.equal(r.syntheticHistoryCreated,false);
 assert.equal(r.activePointerChangeAuthorized,false);
});
test("unaccounted revision prevents migration readiness without fabricating history",()=>{
 const a=mk("OLD_ID");a.revision=2;
 const r=audit({counts:[a]});
 assert.equal(r.ok,true);assert.equal(r.safeToMigrate,false);
 assert.deepEqual(r.uncertainties.map(x=>x.revision),[1,2]);
});
test("complete revisions qualify as internally consistent",()=>{
 const a=mk("OLD_ID");a.revision=2;
 const transitions=[{countId:a.countId,revision:1},{countId:a.countId,revision:2}];
 const r=audit({counts:[a],transitions});assert.equal(r.safeToMigrate,true);
});
test("foreign transitions, duplicate revisions and synthetic IDs are refused",()=>{
 const a=mk("OLD_ID");
 assert.equal(audit({counts:[a],transitions:[{countId:"OTHER",revision:1}]}).ok,false);
 a.revision=2;
 assert.equal(audit({counts:[a],transitions:[{countId:"OLD_ID",revision:1},{countId:"OLD_ID",revision:1}]}).ok,false);
 assert.equal(audit({counts:[mk("ES-V3-BASELINE-MICRO")]}).ok,false);
});
test("recount maintains old IDs and linked historical relationship",()=>{
 const a=mk("OLD_ID"),b=mk("NEW_ID","2026-10-26T15:00:00Z");
 a.countStatus="HISTORICAL";a.supersededByCountId="NEW_ID";
 const r=audit({counts:[a,b],activeCount:b,recounts:[{oldCountId:"OLD_ID",newCountId:"NEW_ID"}]});
 assert.equal(r.safeToMigrate,true);
 assert.deepEqual(r.verifiedCountIds,["OLD_ID","NEW_ID"]);
});
test("broken recount and conflicting active copy fail closed",()=>{
 const a=mk("OLD_ID"),b=mk("NEW_ID");
 assert.equal(audit({counts:[a,b],recounts:[{oldCountId:"OLD_ID",newCountId:"NEW_ID"}]}).ok,false);
 assert.equal(audit({counts:[a],activeCount:{...a,revision:2}}).ok,false);
});
test("source inputs are not mutated",()=>{
 const a=mk("ORIGINAL"),input={counts:[a],activeCount:a};
 const before=structuredClone(input);audit(input);assert.deepEqual(input,before);
});
