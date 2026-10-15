import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
test("Subminute W3 levels use owner-approved 7616.25, 7847.00, 7673.25",()=>{
 const result=buildCurrentWavelength({symbol:"ES",currentPrice:7800});
 const sub=result.degrees.subminute;
 assert.equal(sub.origin,7673.25);
 assert.equal(sub.invalidation,7673.25);
 assert.equal(sub.levels.find(v=>v.key==="e1000").price,7904);
 assert.equal(sub.levels.find(v=>v.key==="e0618").price,7815.75);
 assert.ok(sub.levels.every(v=>v.anchorSource==="OWNER_CONFIRMED_ALL_NODES_SUBMINUTE_20261015"));
});
test("new Fib ladder cannot inherit arbitrary historical 0.618 TOUCHED",()=>{
 const result=buildCurrentWavelength({symbol:"ES",currentPrice:8000});
 assert.ok(result.degrees.subminute.levels.every(x=>x.status==="WATCH"));
 assert.equal(result.degrees.subminute.fibAnchorStatus,"OWNER_COORDINATES_CONFIRMED_PRICE_BASIS_PENDING");
});
