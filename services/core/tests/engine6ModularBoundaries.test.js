import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateEngine6Strategy1Phase4Contract as a, resolveEngine3Strategy1Qualification as q } from "../logic/engine6/6a-trade-qualification/index.js";
import { evaluateEngine6Strategy1Phase4Contract as originalA, resolveEngine3Strategy1Qualification as originalQ } from "../logic/engine6/strategy1PermissionContract.js";
import { buildEngine6ZoneRotationContext as b } from "../logic/engine6/6b-market-intelligence/index.js";
import { buildEngine6ZoneRotationContext as originalB } from "../logic/engine6/buildZoneRotationContext.js";
import { evaluateEngine6ZoneRotationDecision as c } from "../logic/engine6/6c-trade-decision/index.js";
import { evaluateEngine6ZoneRotationDecision as originalC } from "../logic/engine6/evaluateZoneRotationDecision.js";
import { ENGINE6D_INTERFACE_V1 as d } from "../logic/engine6/6d-paper-permission/index.js";
test("6A/6B/6C are exact function identities, not rewritten logic",()=>{ assert.equal(a,originalA);assert.equal(q,originalQ);assert.equal(b,originalB);assert.equal(c,originalC); });
test("6A/6B/6C preserve representative outputs",()=>{
 assert.deepEqual(a({symbol:"ES",strategyId:"intraday_scalp@10m"}),originalA({symbol:"ES",strategyId:"intraday_scalp@10m"}));
 assert.deepEqual(b({}),originalB({}));
 assert.deepEqual(c({}),originalC({}));
});
test("6D cannot activate PAPER permission or import execution",()=>{
 assert.equal(d.activationAuthorized,false);
 assert.equal(d.mode,"INTERFACE_ONLY");
 assert.equal(d.livePermissionOwner,"buildStrategySnapshot.js");
 assert.equal(Object.isFrozen(d),true);
});
test("existing snapshot wrapper not wired to 6A–6D, new decision remains shadow",()=>{
 const source=readFileSync(new URL("../jobs/buildStrategySnapshot.js",import.meta.url),"utf8");
 for(const fragment of ["6a-trade-qualification","6b-market-intelligence","6c-trade-decision"]) assert.equal(source.includes(fragment),false);
 assert.equal(source.includes("6d-paper-permission/buildApprovedPaperPermissionLock.js"),true);
 assert.equal(source.includes("buildEngine6PaperPermission({"),true);
 assert.equal(source.includes("applyEngine6ApprovedPaperPermissionLock"),true);
 const result=c({});
 assert.equal(result.allowed,false);assert.equal(result.canCreatePermission,false);
});
