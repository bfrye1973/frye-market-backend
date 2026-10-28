import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildAuthorizedWorkingStructureV1} from "../logic/engine22/wave/buildAuthorizedWorkingStructureV1.js";
test("Oct28 owner ending prices preserved without automatic structural completion",()=>{
 const code=buildCurrentWavelength({symbol:"ES",currentPrice:7788.50});
 const sub=code.degrees.submicro.ownerSubmicroFiveUp;
 const micro=code.degrees.micro.ownerMicroW3Up;
 assert.equal(sub.wave5.high,7788.50);
 assert.equal(sub.wave5.highLocalTime,"2026-10-28 11:00");
 assert.equal(sub.wave5.completionConfirmed,false);
 assert.equal(micro.wave3.ownerEnding.price,7788.50);
 assert.equal(micro.wave3.completionConfirmed,false);
 assert.equal(sub.levels.find(x=>x.key==="e1000").price,7796);
});
