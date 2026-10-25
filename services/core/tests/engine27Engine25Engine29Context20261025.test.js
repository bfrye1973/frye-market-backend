import test from "node:test";import assert from "node:assert/strict";
import {buildEngine27UnifiedMarketContextV1 as build} from "../logic/engine27/v2/buildUnifiedMarketContextV1.js";
const now=new Date("2026-10-25T17:00:00Z");
test("Engine25/29 remain read-only and stale sources cannot provide fresh confirmation",()=>{
 const result=build({now,engine25:{ok:true,regime:"CAUTION",riskLevel:"HIGH",updatedAt:"2026-10-23T20:00:00Z"},
 engine29:{timestamp:"2026-10-23T20:00:00Z",overallState:"STRONG_DOWNWARD_PRESSURE",tacticalState:"CAUTION",fastTacticalState:"STABILIZING",dataDegraded:false}});
 assert.equal(result.participation.available,true);assert.equal(result.participation.fresh,false);
 assert.equal(result.tactical.fresh,false);assert.equal(result.tactical.oneHour,"CAUTION");
 assert.equal(result.strategyReads.minute.engine25Status,"STALE");
 assert.equal(result.strategyReads.minute.engine29Status,"STALE");
 assert.equal(result.noPermissionCreated,true);assert.equal(result.noExecution,true);
});
test("fresh source timestamps are recognized but do not confirm Elliott invalidation",()=>{
 const result=build({now,engine25:{ok:true,updatedAt:"2026-10-25T16:45:00Z"},
 engine29:{timestamp:"2026-10-25T16:50:00Z",overallState:"CAUTION",dataDegraded:false}});
 assert.equal(result.participation.fresh,true);assert.equal(result.tactical.fresh,true);
 assert.equal(result.warnings.intermediate.structuralInvalidated,false);
});
test("missing sources fail to unavailable",()=>{
 const result=build({now});assert.equal(result.participation.available,false);
 assert.equal(result.tactical.available,false);assert.equal(result.strategyReads.primary.engine29Status,"UNAVAILABLE");
});
