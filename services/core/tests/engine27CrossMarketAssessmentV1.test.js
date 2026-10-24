import test from "node:test";import assert from "node:assert/strict";
import {buildEngine27CrossMarketAssessmentV1} from "../logic/engine27/crossMarket/buildCrossMarketAssessmentV1.js";
test("missing QQQ or VIX evidence is unavailable, never bullish",()=>{
 const x=buildEngine27CrossMarketAssessmentV1({publication:{instruments:{QQQ:{available:true,close:704,lastCandleTime:"2026-10-23",levels:[{low:700,high:703,type:"SUPPORT_CANDIDATE",observationCount:3,status:"WATCH"}]}}}});
 assert.equal(x.state,"UNAVAILABLE");assert.equal(x.vix.state,"UNAVAILABLE");assert.equal(x.qqq.state,"OBSERVATION_ONLY");assert.equal(x.noPermissionCreated,true);
});
test("candidate zones alone never create supportive reversal status",()=>{
 const data={instruments:{QQQ:{available:true,close:704,lastCandleTime:"2026-10-23",levels:[{low:700,high:703,type:"SUPPORT_CANDIDATE",observationCount:3,status:"WATCH"}]},VIX:{available:true,close:19.45,lastCandleTime:"2026-10-23",levels:[{low:19,high:20,type:"RESISTANCE_CANDIDATE",observationCount:4,status:"WATCH"}]}}};
 const original=structuredClone(data),result=buildEngine27CrossMarketAssessmentV1({publication:data});
 assert.equal(result.state,"UNCONFIRMED");assert.equal(result.qqq.state,"OBSERVATION_ONLY");assert.equal(result.vix.state,"OBSERVATION_ONLY");assert.deepEqual(data,original);
});
