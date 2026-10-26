import test from "node:test";
import assert from "node:assert/strict";
import {projectMarketEvidenceForDisplay as project} from "../marketConfirmation/projectMarketEvidenceForDisplay.js";
const owner={engine25:{regime:"NEUTRAL_CHOP_WITH_RATE_PRESSURE"},engine29:null,
 participationState:{liveConfirmationUsable:false},reasonCodes:["ENGINE29_CANONICAL_DATA_DEGRADED"]};
const e25={participationArtifact:{schema:"engine25.participation@1",
 authority:{owner:"ENGINE25"},freshness:{state:"UNAVAILABLE",reason:"NO_VALID_LAST_EQUITY_OBSERVATION"},
 participation:{breadth:{score:29,label:"BREADTH_PARTICIPATION_WEAK"},
  stockVolume:{intraday:{coveragePct:44.52}},
  sectorParticipation:{intraday:{bullish:3,neutral:5,bearish:3}}}}};
const e29={ok:true,data:{timestamp:"2026-10-26T12:40:00Z",
 overallState:"BROAD_DETERIORATION",tacticalState:"CAUTION",
 dataDegraded:true,missingConfirmations:["CREDIT"]}};
test("data present and qualification absent remain distinct",()=>{
 const r=project({engine25Dashboard:e25,engine29Response:e29,ownerMarket:owner});
 assert.equal(r.engine25.sourcePresent,true);
 assert.equal(r.engine25.liveConfirmationQualified,false);
 assert.equal(r.engine25.breadth.score,29);
 assert.equal(r.engine25.volumeCoveragePct,44.52);
 assert.equal(r.engine29.sourcePresent,true);
 assert.equal(r.engine29.qualified,false);
 assert.equal(r.engine29.dataDegraded,true);
 assert.deepEqual(r.engine29.missingConfirmations,["CREDIT"]);
 assert.equal(r.noExecution,true);
});
test("missing canonical sources do not get fabricated context",()=>{
 const r=project({ownerMarket:{engine25:null,engine29:null,reasonCodes:[]}});
 assert.equal(r.engine25.sourcePresent,false);
 assert.equal(r.engine29.sourcePresent,false);
 assert.equal(r.engine25.liveConfirmationQualified,false);
 assert.equal(r.engine29.qualified,false);
});
test("no mutation of source records",()=>{
 const a=structuredClone(e25),b=structuredClone(e29),o=structuredClone(owner);
 project({engine25Dashboard:e25,engine29Response:e29,ownerMarket:owner});
 assert.deepEqual(e25,a);assert.deepEqual(e29,b);assert.deepEqual(owner,o);
});
