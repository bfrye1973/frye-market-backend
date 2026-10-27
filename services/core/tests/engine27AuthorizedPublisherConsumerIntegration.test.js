import test from "node:test";
import assert from "node:assert/strict";
import {buildAuthorizedWorkingStructureV1} from "../logic/engine22/wave/buildAuthorizedWorkingStructureV1.js";
import {buildEngine27WorkingSevenDegrees} from "../logic/engine27/v2/buildWorkingSevenDegrees.js";
import {buildEngine27TraderIntelligenceV2} from "../logic/engine27/v2/buildTraderIntelligenceV2.js";
import {readAuthorizedWorkingStructure} from "../logic/engine27/v2/readAuthorizedWorkingStructure.js";
const CONFIG={
submicro:["ownerSubmicroFiveUp","engine22.submicroFiveUpOct27OwnerWatch.v1","W5","UP","PROJECTED_W5_WATCH","micro","W3"],
micro:["ownerMicroW3Up","engine22.microW3UpOct27Owner.v1","W3","UP","DEVELOPING_CANDIDATE","subminute","D"],
subminute:["ownerCurrentDUp","engine22.subminuteDUpOwnerWorking.v1","D","UP","DEVELOPING_CANDIDATE","minute","W2"],
minute:["ownerMinuteW2Retracement","engine22.minuteW2RetracementOwner.v1","W2","DOWN","DEVELOPING","minor",null]
};
function source(){
 const degrees={};for(const [d,c] of Object.entries(CONFIG))degrees[d]={[c[0]]:{version:c[1],activeWave:c[2],direction:c[3],stage:c[4],parentDegree:c[5],parentWave:c[6],levels:[{key:"touch",price:7778.5,status:"TOUCHED",touchedAt:"2026-10-27T15:00:00Z"}]},ownerMicroCDown:{version:"old",activeWave:"C",direction:"DOWN"}};
 degrees.minute.activeWave="W3";
 return {currentWavelength:{degrees,currentPrice:7780},degreeStates:{minor:{activeWave:"W5",direction:"UP",stage:"ACTIVE"},intermediate:{activeWave:"W3",direction:"UP",stage:"ACTIVE"},primary:{activeWave:"W5",direction:"UP",stage:"ACTIVE"}},sevenDegreeInvalidations:{degrees:{micro:{invalidationReadiness:{status:"REVIEW_ONLY",candidateZone:{low:7700,high:7710}}}}}};
}
function snapshot(src=source()){const {currentWavelength,degreeStates,sevenDegreeInvalidations}=src;const authorizedWorkingStructure=buildAuthorizedWorkingStructureV1({...src,publicationTime:"2026-10-27T20:45:00Z"});return {symbol:"ES",now:"2026-10-27T20:45:00Z",strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{currentWavelength,degreeStates,sevenDegreeInvalidations,authorizedWorkingStructure}}}};}
test("real Engine22 producer packet validates and both Engine27 card sets synchronize all seven",()=>{
 const x=snapshot(),p=x.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure;
 assert.equal(p.status,"COMPLETE_WORKING_SELECTION");assert.equal(readAuthorizedWorkingStructure(x).available,true);
 const a=buildEngine27WorkingSevenDegrees({snapshot:x}),b=buildEngine27TraderIntelligenceV2({snapshot:x});
 for(const [degree,m] of Object.entries(p.degrees)){
  assert.equal(a.degrees[degree].activeWave,m.activeWave);assert.equal(a.degrees[degree].waveDirection,m.direction);
  assert.equal(b.degrees[degree].activeWave,m.activeWave);assert.equal(b.degrees[degree].waveDirection,m.direction);
  assert.equal(a.degrees[degree].provenance.modelFingerprint,p.modelFingerprint);
  assert.equal(b.degrees[degree].provenance.modelFingerprint,p.modelFingerprint);
  assert.equal(a.degrees[degree].parentContext.parentDegree,m.parentDegree??null);
  assert.equal(b.degrees[degree].parentContext.parentWave,m.parentWave??null);
 }
 assert.equal(a.degrees.minute.activeWave,"W2");
 assert.equal(a.degrees.submicro.potentialCompletion.levels[0].status,"TOUCHED");
 assert.equal(b.degrees.submicro.potentialCompletion.levels[0].status,"TOUCHED");
 assert.equal(a.degrees.micro.confirmationNeeded.status,"NOT_CONFIRMED");
 assert.equal(b.degrees.micro.confirmationNeeded.status,"NOT_CONFIRMED");
 assert.equal(p.degrees.micro.review.low,7700);assert.equal(p.degrees.micro.officialInvalidation,null);
 assert.equal(a.degrees.micro.invalidation.price,null);assert.equal(b.degrees.micro.invalidation.authorized,null);
 assert.equal(p.publicationId,null);assert.equal(p.publicationRevision,null);assert.equal(p.pointInTimeAsOfAvailable,false);
});
test("missing degree or version conflict fails closed in both card sets",()=>{
 for(const change of [x=>delete x.currentWavelength.degrees.micro.ownerMicroW3Up,x=>x.currentWavelength.degrees.micro.ownerMicroW3Up.version="wrong"]){
  const x=snapshot((()=>{let y=source();change(y);return y;})());
  assert.equal(x.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure.status,"PARTIAL_UNAVAILABLE");
  assert.equal(readAuthorizedWorkingStructure(x).available,false);
  for(const cards of [buildEngine27WorkingSevenDegrees({snapshot:x}),buildEngine27TraderIntelligenceV2({snapshot:x})]){
   assert.equal(cards.degrees.micro.available??false,false);
   assert.equal(cards.degrees.micro.activeWave,"NOT_PUBLISHED");
   assert.ok(!cards.degrees.micro.traderRead.headline.includes("C DOWN"));
  }
 }
});
test("present-invalid packet has no historical fallback; packet absent retains legacy interpretation",()=>{
 const x=snapshot();delete x.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure.degrees.micro;
 assert.equal(buildEngine27WorkingSevenDegrees({snapshot:x}).degrees.micro.available,false);
 const old=snapshot();delete old.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure;
 assert.equal(readAuthorizedWorkingStructure(old).available,false);
 assert.equal(buildEngine27WorkingSevenDegrees({snapshot:old}).degrees.micro.available,false);
});
test("later updated levels refresh fingerprint/evidence and card values without false wave completion",()=>{
 const x=snapshot(),s=source();s.currentWavelength.degrees.micro.ownerMicroW3Up.levels[0].price=7789.25;
 const y=snapshot(s);const p=x.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure;
 const q=y.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure;
 assert.notEqual(p.evidenceFingerprint,q.evidenceFingerprint);
 assert.equal(p.modelFingerprint,q.modelFingerprint);
 assert.equal(buildEngine27WorkingSevenDegrees({snapshot:y}).degrees.micro.potentialCompletion.levels[0].price,7789.25);
 assert.equal(buildEngine27TraderIntelligenceV2({snapshot:y}).degrees.micro.confirmationNeeded.status,"NOT_CONFIRMED");
});
