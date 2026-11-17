import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine3V6Phase2Evidence as run} from "../logic/engine3/v6/buildEngine3V6Phase2Evidence.js";
import {buildEngine3V6Phase1Shadow} from "../logic/engine3/v6/buildEngine3V6Phase1Shadow.js";
const minute=60000,now=Date.parse("2026-11-17T17:00:00Z");
const bar=(start,dur,high,low,close)=>({time:(start-dur)/1000,open:close,high,low,close});
const history=(end,count,atrWidth=4)=>Array.from({length:count},(_,i)=>{
 const close=end-(count-1-i)*5*minute;
 return bar(close,5*minute,110+atrWidth/2,110-atrWidth/2,110);
});
const zone={low:100,high:110,midline:105,zoneId:"Z"};
const base={candidateId:"A",zoneId:"Z",eligible:true,zone,
 evaluationTimeMs:now,policy:{atrPeriod:2,wideMultiplier:2,bandFraction:0.25,bandFloorPoints:1}};
test("Engine26 explicit authorization and prior bars never count as reaction",()=>{
 const start=now-10*minute;
 const five=[...history(now-20*minute,4),bar(now-5*minute,5*minute,110,106,108)];
 const out=run({...base,authorizedStartedAt:start,bars5m:five,bars1m:[
  bar(now-12*minute,minute,111,108,109),
  bar(now-9*minute,minute,111,109,110)]});
 assert.equal(out.activationSource,"ENGINE26_AUTHORIZED");
 assert.equal(out.completed1mEligible.length,1);
 assert.equal(out.preActivation1mCount,1);
 assert.equal(out.slowPathEvidenceState,"INSUFFICIENT_POST_ACTIVATION_EVIDENCE");
});
test("fallback activation is observation time; grace-window bars cannot establish",()=>{
 const out=run({...base,authorizedStartedAt:null,bars5m:history(now,6),
  bars1m:[bar(now-minute,minute,111,109,110)],
  observedDirection:"SHORT",establishingNow:true});
 assert.equal(out.activationSource,"ENGINE3_OBSERVED");
 assert.equal(out.activationStartedAtMs,now);
 assert.equal(out.completed1mEligible.length,0);
 assert.equal(out.reactionAnchor,null);
 assert.equal(out.directionEstablishmentAuthorized,false);
});
test("ATR and both edge-site bands freeze across activation even with volatility change",()=>{
 const start=now-10*minute;
 const first=run({...base,authorizedStartedAt:start,bars5m:[
  ...history(now-15*minute,5),bar(now-5*minute,5*minute,110,106,108)]});
 assert.ok(first.geometry);
 assert.equal(first.geometry.wideZone,true);
 const changed=run({...base,priorActivation:first.activationRun,
  evaluationTimeMs:now+5*minute,bars5m:[
   ...history(now-15*minute,5,45),bar(now+5*minute,5*minute,160,80,115)]});
 assert.deepEqual(changed.geometry,first.geometry);
 assert.equal(changed.activationStartedAtMs,first.activationStartedAtMs);
 const changedZone=run({...base,zoneId:"Z2",zone:{...zone,zoneId:"Z2"},
  priorActivation:first.activationRun,evaluationTimeMs:now+minute});
 assert.equal(changedZone.activationStartedAtMs,now+minute);
});
for(const [direction,extreme] of [["SHORT",113],["LONG",97]]){
 test(direction+" anchor comes from eligible 1m engaged extremes and freezes",()=>{
  const start=now-10*minute;
  const five=[...history(now-15*minute,4),
   bar(now-5*minute,5*minute,112,96,105),
   bar(now,5*minute,113,95,106)];
  const one=[
   bar(now-9*minute,minute,111,99,105),
   bar(now-8*minute,minute,113,97,106),
   bar(now-7*minute,minute,112,98,105),
  ];
  const out=run({...base,authorizedStartedAt:start,bars1m:one,bars5m:five,
   observedDirection:direction,establishingNow:true});
  assert.equal(out.reactionAnchor,extreme);
  assert.equal(out.anchorSource,"POST_ACTIVATION_1M_EXTREME");
  const later=run({...base,priorActivation:out.activationRun,
   bars1m:[...one,bar(now-minute,minute,125,85,105)],bars5m:five,
   observedDirection:direction,priorReactionAnchor:out.reactionAnchor,
   priorAnchorDirection:direction});
  assert.equal(later.reactionAnchor,extreme);
 });
}
test("adverse forming-bar warning cannot alter direction, conviction or permission",()=>{
 const start=now-10*minute;
 const h=history(now-15*minute,5,4);
 const prior=run({...base,authorizedStartedAt:start,bars5m:h});
 assert.ok(prior.geometry);
 const input={...base,priorActivation:prior.activationRun,bars5m:[
  ...h,bar(now+5*minute,5*minute,125,95,110)],
  observedDirection:"SHORT",priorReactionAnchor:110,
  priorAnchorDirection:"SHORT",progressExtreme:106};
 const warning=run(input);
 assert.equal(warning.adverseDisplacementWarning,true);
 assert.equal(warning.adverseWarning,true);
 assert.equal(warning.anchorThreatened,true);
 assert.equal(warning.directionEstablishmentAuthorized,false);
 assert.equal(warning.canonicalDirectionAuthority,false);
 assert.equal(warning.noPermissionCreated,true);
 assert.equal(warning.adverseWarningOnly,true);
 const noWarning=run({...input,bars5m:h});
 assert.equal(noWarning.adverseDisplacementWarning,false);
 assert.equal(warning.directionEstablishmentAuthorized,noWarning.directionEstablishmentAuthorized);
});
test("authorization loss resets run, next eligibility begins new observation run",()=>{
 const first=run({...base,authorizedStartedAt:now-10*minute,bars5m:history(now,7)});
 const stopped=run({...base,eligible:false,priorActivation:first.activationRun});
 assert.equal(stopped.activationRun,null);
 const resumed=run({...base,priorActivation:stopped.activationRun,evaluationTimeMs:now+minute});
 assert.equal(resumed.activationSource,"ENGINE3_OBSERVED");
 assert.equal(resumed.activationStartedAtMs,now+minute);
});

test("future bars, missing ATR and changed candidate do not create synthetic reaction sites",()=>{
 const start=now-10*minute;
 const future=bar(now+minute,minute,140,90,110);
 const result=run({...base,authorizedStartedAt:start,
  bars1m:[future],bars5m:history(now,2),observedDirection:"SHORT",
  establishingNow:true});
 assert.equal(result.completed1mEligible.length,0);
 assert.equal(result.geometry,null);
 assert.equal(result.reactionAnchor,null);
 assert.equal(result.shadowSeedEvidenceEligible,false);
 assert.equal(result.directionEstablishmentAuthorized,false);
});
test("authoritative activation timestamp in the future cannot be trusted",()=>{
 const out=run({...base,authorizedStartedAt:now+minute});
 assert.equal(out.activationSource,"ENGINE3_OBSERVED");
 assert.equal(out.activationStartedAtMs,now);
});

test("forming adverse warning is invariant for actual v6 shadow direction and conviction",()=>{
 const establishedAtMs=now-15*minute;
 const priorState={schema:"engine3.v6.phase1.shadow.v1",mode:"SHADOW_READ_ONLY",
  candidateId:"A",canonicalDirection:"SHORT",convictionState:"HOLDING",
  reactionAnchor:110,establishedAtMs,lastEvaluatedAtMs:now-minute};
 const h=history(now-15*minute,5);
 const forming=bar(now+5*minute,5*minute,125,95,110);
 const context={priorState,candidateId:"A",zoneId:"Z",
  evaluationTimeMs:now,v5:{evidence:{priceAction:{controlState:"CONTESTED",quality:"WEAK"}}},
  bars1m:[],policy:{invalidationCloses1m:2,deteriorationEvidenceCount:2,
    deteriorationTimeoutMs:720000}};
 const without=buildEngine3V6Phase1Shadow({...context,bars5m:h});
 const withWarning=buildEngine3V6Phase1Shadow({...context,bars5m:[...h,forming]});
 assert.equal(withWarning.canonicalDirection,without.canonicalDirection);
 assert.equal(withWarning.convictionState,without.convictionState);
 assert.equal(withWarning.noEngine6Authority,true);
});
