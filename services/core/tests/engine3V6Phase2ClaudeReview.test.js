import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine3V6Phase2Evidence as phase2} from "../logic/engine3/v6/buildEngine3V6Phase2Evidence.js";
import {buildEngine3V6CausalControl as causal} from "../logic/engine3/v6/buildEngine3V6CausalControl.js";
import {buildEngine3V6Phase1Shadow as shadow} from "../logic/engine3/v6/buildEngine3V6Phase1Shadow.js";
const minute=60000,now=Date.parse("2026-11-17T17:00:00Z");
const b=(end,duration,high,low,close)=>({time:(end-duration)/1000,open:close,high,low,close});
const oldBars=Array.from({length:5},(_,i)=>b(now-(25-i*5)*minute,5*minute,113,109,112));
const eligible={candidateId:"A",zoneId:"Z",eligible:true,evaluationTimeMs:now,
 zone:{low:100,high:110,midline:105,zoneId:"Z"},
 policy:{atrPeriod:2,wideMultiplier:2,bandFraction:.25,bandFloorPoints:1}};
const zoneInput={eligible:true,zone:eligible.zone,identity:{candidateId:"A",zoneId:"Z"}};
test("Nov17-shaped newly authorized zone ignores old bullish 5m evidence",()=>{
 const activation=now-3*minute;
 const old=[...oldBars,b(now,5*minute,116,111,115)];
 const e=phase2({...eligible,authorizedStartedAt:activation,bars5m:old,
  bars1m:[b(now-minute,minute,112,107,108)],observedDirection:"LONG",
  establishingNow:true});
 const c=causal({phase2Evidence:e,normalizedZoneInput:zoneInput,evaluationTimeMs:now});
 assert.equal(e.completed5mEligible.length,1);
 assert.equal(c.qualified,false);
 assert.equal(c.postActivationBars5m,1);
 assert.equal(c.v5CanonicalControlReused,false);
 const v5={stateMachine:{establishedNow:true},validation:{valid:true},
  canonical:{canonical:{direction:"LONG"},authoritativeDownstream:true},
  evidence:{priceAction:{controlState:"BUYERS_CONTROL",quality:"STRONG"}}};
 const v6=shadow({priorState:null,v5,causalControl:c,phase2Evidence:e,
  candidateId:"A",zoneId:"Z",bars5m:old,evaluationTimeMs:now});
 assert.equal(v6.canonicalDirection,"NEUTRAL");
 assert.equal(v6.establishedNow,false);
 assert.equal(v6.sourceControlRecalculated,true);
});
test("deferred 5m seed can establish later after postactivation evidence matures",()=>{
 const bars5m=[b(now-10*minute,5*minute,113,107,109),
  b(now-5*minute,5*minute,112,104,106),
  b(now,5*minute,109,101,102)];
 const bars1m=[b(now-3*minute,minute,109,106,107),
  b(now-2*minute,minute,108,103,105),
  b(now-minute,minute,107,102,103)];
 const e=phase2({...eligible,authorizedStartedAt:now-11*minute,
  bars5m:[...oldBars,...bars5m],bars1m,
  observedDirection:"SHORT",establishingNow:true});
 assert.ok(e.completed5mEligible.length>=2);
 assert.equal(e.shadowSeedEvidenceEligible,true);
 const control={qualified:true,observedDirection:"SHORT",
  control:{controlState:"SELLERS_CONTROL",quality:"STRONG"}};
 const oldV5={stateMachine:{establishedNow:false},validation:{valid:true},
  canonical:{canonical:{direction:"SHORT"},authoritativeDownstream:true}};
 const v6=shadow({priorState:null,v5:oldV5,causalControl:control,
  phase2Evidence:e,candidateId:"A",zoneId:"Z",bars1m,bars5m,
  evaluationTimeMs:now});
 assert.equal(v6.canonicalDirection,"SHORT");
 assert.equal(v6.establishedNow,true);
 assert.equal(v6.causalControlSource,"POST_ACTIVATION_5M_INDEPENDENT");
});
for(const [direction,site,prices] of [
 ["SHORT","lower",[[103,99,101],[102,98,100]]],
 ["LONG","upper",[[112,108,109],[114,109,112]]]
]){
 test(direction+" can react at the actually engaged "+site+" site",()=>{
  const bars1m=prices.map(([hi,lo,cl],i)=>b(now-(2-i)*minute,minute,hi,lo,cl));
  const e=phase2({...eligible,authorizedStartedAt:now-11*minute,
   bars5m:[...oldBars,b(now-10*minute,5*minute,110,102,105),
    b(now-5*minute,5*minute,110,102,105),b(now,5*minute,110,102,105)],
   bars1m,observedDirection:direction,establishingNow:true});
  assert.equal(e.reactionSite,site);
  assert.equal(e.shadowSeedEvidenceEligible,true);
  assert.ok(e.reactionAnchor!==null);
 });
}
for(const direction of ["SHORT","LONG"]){
 test("narrow zone "+direction+" retains original whole-zone geometry",()=>{
  const z={low:106,high:110,midline:108,zoneId:"Z"};
  const one=[b(now-2*minute,minute,109,107,108),
   b(now-minute,minute,109,107,108)];
  const e=phase2({...eligible,zone:z,authorizedStartedAt:now-11*minute,
   bars5m:[...oldBars,b(now-10*minute,5*minute,112,108,110),
    b(now-5*minute,5*minute,112,108,110),b(now,5*minute,112,108,110)],
   bars1m:one,observedDirection:direction,establishingNow:true});
  assert.equal(e.geometry.wideZone,false);
  assert.equal(e.reactionSite,"whole");
  assert.deepEqual(e.geometry.originalZone,z);
  assert.equal(e.shadowSeedEvidenceEligible,true);
 });
}
test("reversal invalidation cannot inherit old SHORT anchor on later LONG",()=>{
 const early=phase2({...eligible,authorizedStartedAt:now-15*minute,
  bars5m:oldBars,bars1m:[b(now-minute,minute,110,107,108)],
  observedDirection:"SHORT",priorReactionAnchor:113,priorAnchorDirection:"SHORT"});
 const later=phase2({...eligible,priorActivation:early.activationRun,
  bars5m:oldBars,bars1m:[b(now-minute,minute,110,107,108)],
  observedDirection:"LONG",priorReactionAnchor:113,priorAnchorDirection:"SHORT"});
 assert.equal(later.anchorSource,"UNAVAILABLE");
 assert.equal(later.reactionAnchor,null);
});
test("warning and anchor threat are independent, annotation-only switches",()=>{
 const initial=phase2({...eligible,authorizedStartedAt:now-11*minute,bars5m:oldBars});
 const forming=b(now+5*minute,5*minute,112,105,109);
 const x={...eligible,priorActivation:initial.activationRun,bars5m:[...oldBars,forming],
  observedDirection:"SHORT",priorReactionAnchor:113,priorAnchorDirection:"SHORT",
  progressExtreme:103};
 const on=phase2(x),off=phase2({...x,warningEnabled:false});
 assert.equal(on.adverseWarning,true);
 assert.equal(on.anchorThreatened,true);
 assert.equal(off.adverseWarning,false);
 assert.equal(off.anchorThreatened,false);
 assert.equal(on.directionEstablishmentAuthorized,off.directionEstablishmentAuthorized);
 assert.equal(on.canonicalDirectionAuthority,off.canonicalDirectionAuthority);
});

test("post-activation 5m supplies true anchor if eligible 1m engagement is unavailable",()=>{
 const z={low:106,high:110,midline:108,zoneId:"Z"};
 const five=[...oldBars,
  b(now-10*minute,5*minute,110,106,108),
  b(now-5*minute,5*minute,111,107,109),
  b(now,5*minute,112,107,109)];
 const e=phase2({...eligible,zone:z,authorizedStartedAt:now-11*minute,
  bars5m:five,bars1m:[],observedDirection:"SHORT",establishingNow:true});
 assert.equal(e.reactionSite,"whole");
 assert.equal(e.reactionSiteEvidenceSource,"5m");
 assert.equal(e.anchorSource,"POST_ACTIVATION_5M_EXTREME");
 assert.equal(e.reactionAnchor,113);
 assert.equal(e.shadowSeedEvidenceEligible,true);
});
test("held anchor freezes both reaction direction and site even after another edge is touched",()=>{
 const five=[...oldBars,b(now-10*minute,5*minute,111,105,108),
  b(now-5*minute,5*minute,111,105,108),
  b(now,5*minute,111,105,108)];
 const initial=phase2({...eligible,authorizedStartedAt:now-11*minute,
  bars5m:five,bars1m:[b(now-minute,minute,111,109,110)],
  observedDirection:"SHORT",establishingNow:true});
 assert.equal(initial.reactionSite,"upper");
 const next=phase2({...eligible,priorActivation:initial.activationRun,
  bars5m:five,bars1m:[b(now-minute,minute,102,99,100)],
  observedDirection:"SHORT",priorReactionAnchor:initial.reactionAnchor,
  priorAnchorDirection:"SHORT",priorReactionSite:"upper"});
 assert.equal(next.reactionSite,"upper");
 assert.equal(next.reactionAnchor,initial.reactionAnchor);
 const reversed=phase2({...eligible,priorActivation:initial.activationRun,
  bars5m:five,bars1m:[b(now-minute,minute,102,99,100)],
  observedDirection:"LONG",priorReactionAnchor:initial.reactionAnchor,
  priorAnchorDirection:"SHORT",priorReactionSite:"upper"});
 assert.notEqual(reversed.anchorSource,"FROZEN_PREVIOUS");
});
