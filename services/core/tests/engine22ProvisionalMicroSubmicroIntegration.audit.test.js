import test from "node:test";
import assert from "node:assert/strict";
import {buildOwnerAuthorizedProvisionalMicroCount} from "../logic/engine22/migration/buildOwnerAuthorizedProvisionalMicroCount.js";
import {buildSubmicroMigrationCandidate} from "../logic/engine22/migration/buildSubmicroMigrationCandidate.js";
import {buildSevenDegreeShadowProjection} from "../logic/engine22/migration/buildSevenDegreeShadowProjection.js";
import {createCanonicalMicroState} from "../logic/engine22/microV2/canonicalMicroState.js";
test("Manager proposed Micro creates distinct provisional parent with original anchor provenance",()=>{
 const p=buildOwnerAuthorizedProvisionalMicroCount({ownerAcceptsOverlap:true});
 assert.equal(p.ok,true);
 assert.equal(p.count.anchors.w1High.price,7805);
 assert.equal(p.count.anchors.w4Low.price,7782.75);
 assert.equal(p.count.structuralReview.w1w4OverlapPoints,22.25);
 assert.equal(p.count.structuralReview.standardImpulseConfirmed,false);
 assert.equal(p.count.publicationEligible,false);
 assert.equal(p.count.automationEligible,false);
});
test("new Micro parent and old Micro-derived Submicro form separate nontrading seven-degree shadow",()=>{
 const parent=buildOwnerAuthorizedProvisionalMicroCount({ownerAcceptsOverlap:true}).count;
 const source=createCanonicalMicroState({countId:"ORIGINAL-MICRO",sequenceId:"ORIGINAL-SEQ",
 sequenceDirection:"UP",origin:{price:7782.75}});
 const migrated=buildSubmicroMigrationCandidate({sourceMicroState:source,parentMicroCountId:parent.countId});
 assert.equal(migrated.ok,true);
 assert.notEqual(parent.countId,migrated.candidate.countId);
 assert.notEqual(parent.sequenceId,migrated.candidate.sequenceId);
 const projected=buildSevenDegreeShadowProjection({
  legacyDegreeStates:{minute:{activeWave:"W3"}},
  microCount:parent,submicroCandidate:migrated.candidate
 });
 assert.equal(projected.status,"READ_ONLY_STRUCTURAL_SHADOW");
 assert.equal(projected.degrees.micro.anchors.w1High.price,7805);
 assert.equal(projected.degrees.submicro.origin.price,7782.75);
 assert.equal(projected.degrees.submicro.sourceProvenance.sourceCountId,"ORIGINAL-MICRO");
 assert.equal(projected.publicationEligible,false);
 assert.equal(projected.automationEligible,false);
});
test("owner overlap acceptance is required to build provisional Micro",()=>{
 assert.equal(buildOwnerAuthorizedProvisionalMicroCount().ok,false);
});
