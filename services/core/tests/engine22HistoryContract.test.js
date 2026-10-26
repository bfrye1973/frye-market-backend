import test from "node:test";
import assert from "node:assert/strict";
import { validateEngine22HistoryRecord, validateEngine22OwnerWorkingSelection,
  validateEngine22SevenDegreeRegistryCandidate, ENGINE22_HISTORY_CONTRACT_SCHEMA,
  ENGINE22_OWNER_MODELS_20261025 } from "../logic/engine22/history/historyContract.js";
import { classifyEngine22Provenance, isSyntheticV3Identity } from "../logic/engine22/history/provenanceClassifier.js";
import { ENGINE22_V3_DEGREES, ENGINE22_V3_PARENT } from "../logic/engine22/v3/canonicalStructure.js";
const owner = (degree="MINUTE") => ({
  schema:ENGINE22_HISTORY_CONTRACT_SCHEMA,instrument:"ES",degree,
  parentDegree:ENGINE22_V3_PARENT[degree],modelVersion:ENGINE22_OWNER_MODELS_20261025[degree] || "owner.review.v1",
  sourceTimestamp:"2026-10-25T17:00:00Z",countId:null,
  provenance:{status:"OWNER_WORKING",ownerApprovalRef:"OCT25_OWNER_WORKING_BASELINE"},
  verifiedHistorical:false,activationEligible:false,
});
test("Minute W2 working baseline is accepted but not canonical activation",()=>{
 const r=validateEngine22HistoryRecord(owner());
 assert.equal(r.ok,true);assert.equal(r.classification,"OWNER_WORKING");
 assert.equal(validateEngine22OwnerWorkingSelection({degree:"MINUTE",modelVersion:"engine22.minuteW2RetracementOwner.v1"}).ok,true);
});
test("older Minute W3 and competing lower-degree interpretations fail owner selection",()=>{
 for(const [degree,stale] of [["MINUTE","engine22.minuteW3.v1"],["MICRO","engine22.microW3OwnerProjection.v1"],
 ["SUBMINUTE","engine22.subminuteW3Owner.v1"],["INTRADAY_SUBMICRO","engine22.submicroW2OwnerProjection.v1"]]) {
  assert.equal(validateEngine22OwnerWorkingSelection({degree,modelVersion:stale}).ok,false);
 }
 assert.equal(validateEngine22OwnerWorkingSelection({degree:"MINUTE",modelVersion:"engine22.minuteW2RetracementOwner.v1",
 proposedOverrideVersion:"old-minute-W3"}).ok,false);
});
test("V3 synthetic baseline identities can never be verified or activated",()=>{
 assert.equal(isSyntheticV3Identity("ES-V3-BASELINE-MINUTE"),true);
 const record={...owner(),countId:"ES-V3-BASELINE-MINUTE",verifiedHistorical:true,activationEligible:true,
  provenance:{status:"VERIFIED_HISTORICAL",sourceId:"x",sourceHash:"hash",evidenceRef:"bar"}};
 assert.equal(classifyEngine22Provenance(record).classification,"SYNTHETIC_V3_SHADOW");
 assert.equal(validateEngine22HistoryRecord(record).ok,false);
});
test("verified historical classification requires stable identity and provenance",()=>{
 const record={...owner(),countId:"ORIGINAL-MICRO-COUNT",
 provenance:{status:"VERIFIED_HISTORICAL",sourceId:"legacy-count",sourceHash:"sha256:abc",evidenceRef:"event-1"}};
 assert.equal(classifyEngine22Provenance(record).classification,"VERIFIED_HISTORICAL");
 assert.equal(validateEngine22HistoryRecord({...record,verifiedHistorical:true}).ok,true);
 assert.equal(validateEngine22HistoryRecord({...record,activationEligible:true}).ok,false);
});
test("incomplete provenance never becomes verified",()=>{
 const record={...owner(),verifiedHistorical:true,provenance:{status:"VERIFIED_HISTORICAL"}};
 assert.equal(validateEngine22HistoryRecord(record).ok,false);
});
test("parent identity and UTC evidence are required",()=>{
 assert.equal(validateEngine22HistoryRecord({...owner(),parentDegree:"PRIMARY"}).ok,false);
 assert.equal(validateEngine22HistoryRecord({...owner(),sourceTimestamp:"2026-10-25 12:00"}).ok,false);
});
test("seven degree candidate requires unique complete degree set",()=>{
 const records=ENGINE22_V3_DEGREES.map(d=>owner(d));
 assert.equal(validateEngine22SevenDegreeRegistryCandidate(records).ok,true);
 assert.equal(validateEngine22SevenDegreeRegistryCandidate([...records.slice(1),records[1]]).ok,false);
});
test("validation never mutates source records",()=>{
 const r=owner();const before=structuredClone(r);validateEngine22HistoryRecord(r);
 assert.deepEqual(r,before);
});
