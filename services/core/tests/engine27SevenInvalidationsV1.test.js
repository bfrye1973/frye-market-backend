import test from "node:test";import assert from "node:assert/strict";
import {buildEngine27SevenInvalidationsV1 as build} from "../logic/engine27/v2/buildSevenInvalidationsV1.js";
const snapshot=e22=>({strategies:{"intraday_scalp@10m":{engine22WaveStrategy:e22}}});
test("all seven degree slots fail closed without published owner models",()=>{
 const out=build({snapshot:snapshot({})});
 assert.equal(Object.keys(out.degrees).length,7);assert.equal(out.publishedCount,0);
 assert.equal(out.allPublished,false);assert.equal(out.degrees.minute.price,null);
 assert.equal(out.noExecution,true);
});
test("only canonical working owner level and explicit rule publish; Fib targets do not become invalidation",()=>{
 const out=build({snapshot:snapshot({
 currentWavelength:{degrees:{submicro:{ownerSubmicroADown:{version:"engine22.submicroADownOwnerWatch.v1",levels:[{price:7774}],invalidationLevel:7812.25,invalidationRule:"OWNER_BREAK"}}}},
 degreeStates:{minor:{invalidationLevel:7543.5,invalidationBreached:false}}
 })});
 assert.equal(out.degrees.submicro.price,7812.25);
 assert.equal(out.degrees.submicro.rule,"OWNER_BREAK");
 assert.equal(out.degrees.micro.price,null);
 assert.equal(out.degrees.minor.price,7543.5);
 assert.equal(out.degrees.minor.breached,false);
 assert.equal(out.publishedCount,2);
});
test("old incompatible owner is never substituted and absent invalidation never borrows projection",()=>{
 const out=build({snapshot:snapshot({currentWavelength:{degrees:{micro:{ownerMicroBDown:{version:"superseded",invalidationLevel:9000}}}},
 degreeStates:{primary:{levels:[{price:9000}]}}})});
 assert.equal(out.degrees.micro.status,"OWNER_MODEL_UNAVAILABLE");
 assert.equal(out.degrees.primary.status,"NOT_PUBLISHED");
 assert.equal(out.degrees.primary.price,null);
});
