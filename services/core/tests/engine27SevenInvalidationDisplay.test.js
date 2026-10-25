import test from "node:test";import assert from "node:assert/strict";
import {buildEngine27WorkingSevenDegrees} from "../logic/engine27/v2/buildWorkingSevenDegrees.js";
test("cards expose only canonical current-owner invalidation, not Fib geometry",()=>{
 const snapshot={strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{currentWavelength:{degrees:{
 submicro:{ownerSubmicroCDown:{version:"engine22.submicroCDownOwnerWatch.v1",invalidationLevel:7812.25,levels:[{price:7774}]}},
 micro:{ownerMicroCDown:{version:"engine22.microCDownOwnerWatch.v1",levels:[{price:7750.75}]}},
 }},degreeStates:{minor:{invalidationLevel:7543.5}}}}}};
 const out=buildEngine27WorkingSevenDegrees({snapshot});
 assert.equal(out.degrees.submicro.invalidation.price,7812.25);
 assert.equal(out.degrees.micro.invalidation.price,null);
 assert.equal(out.degrees.minor.invalidation.price,7543.5);
 assert.equal(out.degrees.submicro.invalidation.source.ownerCompatible,true);
 assert.equal(out.noExecution,true);
});
