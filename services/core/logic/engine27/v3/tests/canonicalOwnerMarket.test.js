import test from "node:test";import assert from "node:assert/strict";
import {assembleCanonicalOwnerMarket as a} from "../marketConfirmation/assembleCanonicalOwnerMarket.js";
const now="2026-10-26T01:00:00Z";
const p={schema:"engine25.participation@1",authority:{owner:"ENGINE25"},
 participation:{breadth:{},stockVolume:{},distributionPressure:{}},
 freshness:{state:"LAST_VALID_EQUITY_READ",reason:"EQUITY_SESSION_CLOSED",
 usableForTrapConfirmation:false,equityScannerSession:{active:false,session:"EQUITY_SESSION_CLOSED"},systemOperatingSession:{session:"ES_GLOBEX"}}};
const data={ok:true,engine25Context:{ok:true,regime:"NEUTRAL_CHOP_WITH_RATE_PRESSURE",updatedAt:"2026-10-26T00:55:00Z"},participationArtifact:p};
const e29={ok:true,data:{version:"engine29.crossMarketStress.v1.phase5",timestamp:"2026-10-26T00:58:00Z",overallState:"NO_ACTIVE_MOVE",dataDegraded:false,dataQuality:{}}};
test("closed equity reads remain contextual not live confirmation",()=>{const x=a({engine25Dashboard:data,engine29Response:e29,now});assert.equal(x.participationState.contextOnly,true);assert.equal(x.participationState.liveConfirmationUsable,false);assert.equal(x.engine29.overallState,"NO_ACTIVE_MOVE")});
test("fresh equity can confirm only when scanner active",()=>{const q=structuredClone(data);q.participationArtifact.freshness={state:"FRESH",usableForTrapConfirmation:true,equityScannerSession:{active:true}};assert.equal(a({engine25Dashboard:q,engine29Response:e29,now}).participationState.liveConfirmationUsable,true)});
test("E29 older than five minutes is unavailable",()=>{const q=structuredClone(e29);q.data.timestamp="2026-10-26T00:53:00Z";assert.equal(a({engine25Dashboard:data,engine29Response:q,now}).engine29,null)});
test("E29 data degraded is unavailable",()=>{const q=structuredClone(e29);q.data.dataDegraded=true;assert.equal(a({engine25Dashboard:data,engine29Response:q,now}).engine29,null)});
test("missing participation never inferred from regime",()=>{const x=a({engine25Dashboard:{engine25Context:data.engine25Context},engine29Response:e29,now});assert.equal(x.participationState.state,"UNAVAILABLE");assert.equal(x.participationState.liveConfirmationUsable,false)});
test("source records remain unchanged",()=>{const d=structuredClone(data),e=structuredClone(e29);a({engine25Dashboard:data,engine29Response:e29,now});assert.deepEqual(data,d);assert.deepEqual(e29,e)});
