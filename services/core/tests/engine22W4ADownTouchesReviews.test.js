import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
import {buildSevenDegreeInvalidationsV1} from "../logic/engine22/wave/buildSevenDegreeInvalidationsV1.js";
const AZ_START=Date.parse("2026-10-28T20:00:00Z");
test("W4 and A down fibs become touched below levels and stay touched on rebound",()=>{
 const base=buildCurrentWavelength({symbol:"ES",currentPrice:7820.00});
 const first=applyOwnerPriceTouchesV1({currentWavelength:base,currentPrice:7750,evaluationTimeMs:AZ_START+3600000});
 const a=first.degrees.submicro.ownerSubmicroADownInsideMicroW4.levels;
 const w=first.degrees.micro.ownerMicroW4Down.levels;
 assert.equal(a.find(x=>x.key==="e500").status,"TOUCHED");
 assert.equal(a.find(x=>x.key==="e618").status,"WATCH");
 assert.equal(w.find(x=>x.key==="r500").status,"TOUCHED");
 assert.equal(w.find(x=>x.key==="r618").status,"WATCH");
 const later=applyOwnerPriceTouchesV1({currentWavelength:base,previousWavelength:first,currentPrice:7800,evaluationTimeMs:AZ_START+7200000});
 assert.equal(later.degrees.submicro.ownerSubmicroADownInsideMicroW4.levels.find(x=>x.key==="e500").status,"TOUCHED");
 assert.equal(later.degrees.micro.ownerMicroW4Down.levels.find(x=>x.key==="r500").status,"TOUCHED");
 assert.equal(first.degrees.micro.ownerMicroW3Up.wave3.ownerEnding.price,7820.00);
});
test("completed 10m bar lows touch without future or pre-start lookahead",()=>{
 const base=buildCurrentWavelength({symbol:"ES",currentPrice:7820.00});
 const b={time:Math.floor((AZ_START+600000)/1000),low:7720,high:7820};
 const now=AZ_START+1200000;
 const yes=applyOwnerPriceTouchesV1({currentWavelength:base,currentPrice:7800,bars10m:[b],evaluationTimeMs:now});
 assert.equal(yes.degrees.micro.ownerMicroW4Down.levels.find(x=>x.key==="r618").status,"TOUCHED");
 const no=applyOwnerPriceTouchesV1({currentWavelength:base,currentPrice:7800,bars10m:[b],evaluationTimeMs:AZ_START+900000});
 assert.equal(no.degrees.micro.ownerMicroW4Down.levels.find(x=>x.key==="r618").status,"WATCH");
});
test("new W4 and A reviews are not hard invalidations",()=>{
 const cw=buildCurrentWavelength({symbol:"ES",currentPrice:7820.00});
 const r=buildSevenDegreeInvalidationsV1({currentWavelength:cw});
 for(const d of ["micro","submicro"]){
  const q=r.degrees[d].invalidationReadiness;
  assert.equal(q.candidateZone.low,7820.00);
  assert.equal(q.candidateZone.reviewOnly,true);
  assert.equal(q.officialInvalidationPrice,null);
  assert.equal(q.isStructuralInvalidation,false);
 }
});
