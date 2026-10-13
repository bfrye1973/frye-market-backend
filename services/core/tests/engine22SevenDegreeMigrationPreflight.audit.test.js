import test from "node:test";
import assert from "node:assert/strict";
import {createCanonicalMicroState} from "../logic/engine22/microV2/canonicalMicroState.js";
import {buildSevenDegreeMigrationPreflight} from "../logic/engine22/migration/buildSevenDegreeMigrationPreflight.js";
test("preflight preserves original Micro and keeps Submicro out of automation",()=>{
 const legacy=createCanonicalMicroState({countId:"LEGACY-MICRO",sequenceId:"LEGACY-SEQ",
 sequenceDirection:"UP",origin:{price:7782.75},parentDegree:"SUBMINUTE",parentDirection:"UP"});
 const before=JSON.stringify(legacy);
 const a=buildSevenDegreeMigrationPreflight({legacyMicroCanonicalState:legacy,parentMicroCountId:"NEW-MICRO"});
 assert.equal(JSON.stringify(legacy),before);
 assert.equal(a.submicroCandidate.degree,"SUBMICRO");
 assert.equal(a.submicroCandidate.sourceProvenance.sourceCountId,"LEGACY-MICRO");
 assert.equal(a.submicroCandidate.parentContext.countId,"NEW-MICRO");
 assert.equal(a.submicroCandidate.automationEligible,false);
 assert.equal(a.overlap.overlapPoints,22.25);
 assert.equal(a.status,"BLOCKED");
 assert.equal(a.publicationEligible,false);
 assert.ok(a.reasonCodes.includes("MICRO_W1_W4_OVERLAP_REQUIRES_APPROVED_ALTERNATE_CLASSIFICATION"));
});
test("preflight cannot be made tradable using unverified flags",()=>{
 const s=createCanonicalMicroState({countId:"M",sequenceId:"Q",sequenceDirection:"UP",
 origin:{price:7782.75}});
 const a=buildSevenDegreeMigrationPreflight({legacyMicroCanonicalState:s,parentMicroCountId:"NEW",
 managerImplementationApproved:true,historicalBarsValidated:true,replayValidated:true,
 microExecutionContext:{countId:"NEW",sequenceId:"FAKE"}});
 assert.equal(a.publicationEligible,false);
 assert.ok(a.reasonCodes.includes("INDEPENDENT_SEQUENCE_IDS_REQUIRED"));
});
test("invalid source cannot turn into a Submicro count",()=>{
 const a=buildSevenDegreeMigrationPreflight({legacyMicroCanonicalState:{},parentMicroCountId:"NEW"});
 assert.equal(a.submicroCandidate,null);
 assert.ok(a.reasonCodes.includes("INVALID_SOURCE_MICRO_CANONICAL_STATE"));
});

test("manual true historical flag cannot bypass missing identified OHLC proof",()=>{
 const legacy=createCanonicalMicroState({countId:"OLD",sequenceId:"OLDSEQ",
 sequenceDirection:"UP",origin:{price:7782.75}});
 const p=buildSevenDegreeMigrationPreflight({legacyMicroCanonicalState:legacy,
 parentMicroCountId:"NEW",historicalBarsValidated:true,replayValidated:true,
 managerImplementationApproved:true});
 assert.equal(p.historicalAnchorProof.verified,false);
 assert.ok(p.reasonCodes.includes("HISTORICAL_BARS_MISSING"));
 assert.ok(p.reasonCodes.includes("HISTORICAL_OHLC_VALIDATION_REQUIRED"));
 assert.equal(p.publicationEligible,false);
});

test("owner accepts overlap as provisional while standard impulse remains invalid",()=>{
 const legacy=createCanonicalMicroState({countId:"OLD-MICRO",sequenceId:"OLD-SEQ",
 sequenceDirection:"UP",origin:{price:7782.75}});
 const p=buildSevenDegreeMigrationPreflight({legacyMicroCanonicalState:legacy,
 parentMicroCountId:"NEW-MICRO",ownerAcceptsOverlap:true});
 assert.equal(p.ownerOverlapDisposition,"ACCEPTED_FOR_PROVISIONAL_REVIEW_NOT_STANDARD_IMPULSE");
 assert.equal(p.overlap.acceptedAsStandardImpulse,false);
 assert.equal(p.reasonCodes.includes("MICRO_W1_W4_OVERLAP_REQUIRES_APPROVED_ALTERNATE_CLASSIFICATION"),false);
 assert.equal(p.publicationEligible,false);
});
