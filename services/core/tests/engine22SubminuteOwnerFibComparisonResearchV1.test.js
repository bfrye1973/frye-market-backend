import test from "node:test";
import assert from "node:assert/strict";
import {compareSubminuteCandidateFibsV1,SUBMINUTE_OWNER_EVIDENCE_V1,SUBMINUTE_LEGACY_PROVISIONAL_V1} from "../logic/engine22/research/compareSubminuteOwnerFibsV1.js";
test("preserves owner and legacy anchors independently",()=>{
 assert.deepEqual([SUBMINUTE_OWNER_EVIDENCE_V1.w1Low,SUBMINUTE_OWNER_EVIDENCE_V1.w1High,SUBMINUTE_OWNER_EVIDENCE_V1.w2Low],[7616.25,7847,7673.25]);
 assert.deepEqual([SUBMINUTE_LEGACY_PROVISIONAL_V1.w1Low,SUBMINUTE_LEGACY_PROVISIONAL_V1.w1High,SUBMINUTE_LEGACY_PROVISIONAL_V1.w2Low],[7575,7859.25,7671.5]);
});
test("candidate ladders retain separate provenance and are never publish-authorized",()=>{
 const out=compareSubminuteCandidateFibsV1();
 assert.equal(out.owner.length,7);
 assert.equal(out.legacy.length,7);
 assert.equal(out.publishAuthorized,false);
 assert.equal(out.touchEvidenceAvailable,false);
 assert.ok(out.owner.every(l=>l.status==="RESEARCH_ONLY_NOT_APPROVED"));
 assert.ok(out.owner.some((l,i)=>l.price!==out.legacy[i].price));
});
test("every projected research value is a valid ES quarter-tick and numerical difference reconciles",()=>{
 const out=compareSubminuteCandidateFibsV1();
 for(const d of out.differences){
   assert.equal(d.ownerCandidate*4,Math.round(d.ownerCandidate*4));
   assert.equal(d.legacyProvisional*4,Math.round(d.legacyProvisional*4));
   assert.equal(d.difference,+(d.ownerCandidate-d.legacyProvisional).toFixed(2));
 }
});
