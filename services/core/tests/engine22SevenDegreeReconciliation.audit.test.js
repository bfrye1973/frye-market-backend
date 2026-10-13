import test from "node:test";
import assert from "node:assert/strict";
import {PROPOSED_MICRO_ANCHORS,PROPOSED_SUBMICRO_MIGRATION,
  auditProposedStructuralDegrees} from "../logic/engine22/migration/proposedSevenDegreeReconciliation.js";
test("proposed Micro handwritten anchors are distinct, ES-tick-aligned and ordered",()=>{
 const audit=auditProposedStructuralDegrees();
 assert.equal(audit.ok,true);
 assert.equal(audit.priceTicksValid,true);
 assert.equal(audit.proposedImpulseAnchorOrderValid,true);
 assert.equal(audit.classicImpulseNoOverlap,false);
 assert.equal(audit.w4OverlapsW1Territory,true);
 assert.equal(PROPOSED_MICRO_ANCHORS.marks.w1High.price-PROPOSED_MICRO_ANCHORS.marks.w4Low.price,22.25);
 assert.equal(PROPOSED_MICRO_ANCHORS.marks.w1High.price,7805);
 assert.equal(PROPOSED_MICRO_ANCHORS.marks.w4Low.price,7782.75);
 assert.equal(PROPOSED_MICRO_ANCHORS.activeWaveCandidate,"W5");
 assert.equal(audit.lockedAnchorsPublished,false);
});
test("Submicro migration never inherits Micro count identity or account permission",()=>{
 assert.equal(PROPOSED_SUBMICRO_MIGRATION.parentDegree,"MICRO");
 assert.equal(PROPOSED_MICRO_ANCHORS.parentDegree,"SUBMINUTE");
 assert.match(PROPOSED_SUBMICRO_MIGRATION.countIdRule,/DISTINCT_SUBMICRO_COUNT_ID/);
 assert.equal(PROPOSED_SUBMICRO_MIGRATION.authorization,"NO_TRADING_OR_ACCOUNT_ROUTING_CHANGES");
});
test("proposed new anchors are not represented as historical OHLC-verified or locked",()=>{
 const a=auditProposedStructuralDegrees();
 assert.equal(a.historicalBarsVerified,false);
 assert.equal(a.sourceCountIdsIndependent,false);
 assert.equal(a.replayEquivalenceVerified,false);
});
