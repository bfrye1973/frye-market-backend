import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine3V6CausalControl as build,
 resolveEngine3V6ControlLens as lens} from "../logic/engine3/v6/buildEngine3V6CausalControl.js";
import {buildEngine3V6Phase2Evidence as phase2} from "../logic/engine3/v6/buildEngine3V6Phase2Evidence.js";

const m=60000,now=Date.parse("2026-11-17T17:00:00Z");
const bar=(end,dur,open,high,low,close)=>({
 time:(end-dur)/1000,open,high,low,close});
const completed=(end,dur,open,high,low,close)=>({
 startMs:end-dur,closeTimeMs:end,open,high,low,close});
const whole={id:"Z",zoneId:"Z",low:100,high:158,midline:129,widthPoints:58};
const zi=zone=>({eligible:true,zone,identity:{candidateId:"C",zoneId:"Z"}});
const geo=(wide,original=whole)=>({schema:"engine3.v6.reactionSites.v1",
 originalZone:{...original},frozenAtr5m:4,wideZone:wide,policyAuthority:false,
 upper:{low:156,high:160,edge:158},lower:{low:98,high:102,edge:100}});
const one=[
 completed(now-3*m,m,158,159,157,158),
 completed(now-2*m,m,157,158,156,157),
 completed(now-m,m,158,159,157,158),
];
const five=[
 completed(now-10*m,5*m,157,159,155,158),
 completed(now-5*m,5*m,158,159,156,157),
 completed(now,5*m,157,159,156,158),
];
const e=(site,wide=true,zone=whole,bars=five)=>({
 eligible:true,activationStartedAtMs:now-20*m,geometry:geo(wide,zone),
 reactionSite:site,completed1mEligible:one,completed5mEligible:bars});
test("narrow LONG and SHORT control uses immutable whole Engine26 zone",()=>{
 const narrow={id:"Z",zoneId:"Z",low:106,high:110,midline:108,widthPoints:4};
 const input=e("whole",false,narrow);
 for(const direction of ["LONG","SHORT"]){
  const before=JSON.stringify(narrow);
  const out=build({phase2Evidence:input,normalizedZoneInput:zi(narrow),evaluationTimeMs:now});
  assert.equal(out.controlGeometrySource,"WHOLE_ZONE",direction);
  assert.deepEqual(out.engine3ControlLens,narrow);
  assert.deepEqual(out.engine26Zone,narrow);
  assert.equal(JSON.stringify(narrow),before);
  assert.equal(out.v5CanonicalControlReused,false);
 }
});
for(const [site,source] of [["upper","UPPER_SITE"],["lower","LOWER_SITE"]]){
 test("wide "+site+" builds real v5 evidence ONLY against frozen "+source+" lens",()=>{
  const before=JSON.stringify(whole);
  const input=e(site);
  const out=build({phase2Evidence:input,normalizedZoneInput:zi(whole),evaluationTimeMs:now});
  assert.equal(out.controlGeometrySource,source);
  assert.equal(out.controlGeometryEligible,true);
  assert.deepEqual(out.engine3ControlLens.low,input.geometry[site].low);
  assert.deepEqual(out.engine3ControlLens.high,input.geometry[site].high);
  assert.equal(out.engine3ControlLens.midline,
   (input.geometry[site].low+input.geometry[site].high)/2);
  assert.deepEqual(out.validation5m.zone,out.engine3ControlLens);
  assert.deepEqual(out.observation1m.zone,out.engine3ControlLens);
  assert.equal(JSON.stringify(whole),before);
  assert.equal(out.noPermissionCreated,true);
  assert.equal(out.authoritativeDownstream,false);
 });
}
test("unresolved wide-zone contact CANNOT fall back to whole-zone control",()=>{
 for(const reactionSite of [null,"both","unknown"]){
  const out=build({phase2Evidence:e(reactionSite),normalizedZoneInput:zi(whole),
   evaluationTimeMs:now});
  assert.equal(out.controlGeometryEligible,false);
  assert.equal(out.qualified,false);
  assert.equal(out.observedDirection,"NEUTRAL");
  assert.equal(out.control.controlState,"NO_CONTROL");
  assert.equal(out.engine3ControlLens,null);
  assert.ok(out.reasonCodes.includes("WIDE_ZONE_REACTION_SITE_UNRESOLVED"));
 }
});
test("simultaneous upper/lower contact is ambiguous, cannot qualify either LONG or SHORT",()=>{
 const barBoth=bar(now-m,m,129,160,98,130);
 const history=Array.from({length:5},(_,i)=>bar(now-(25-i*5)*m,5*m,129,132,126,129));
 const observation=phase2({candidateId:"C",zoneId:"Z",eligible:true,
  zone:whole,authorizedStartedAt:now-10*m,evaluationTimeMs:now,
  bars1m:[barBoth],bars5m:[...history,bar(now,5*m,129,160,98,130)],
  policy:{atrPeriod:2,wideMultiplier:2,bandFraction:0.25,bandFloorPoints:1}});
 assert.equal(observation.reactionSite,null);
 const out=build({phase2Evidence:observation,normalizedZoneInput:zi(whole),evaluationTimeMs:now});
 assert.equal(out.qualified,false);
 assert.equal(out.controlGeometryEligible,false);
});
test("Engine3 lens refuses mismatch, never mutates or repairs Engine26 original",()=>{
 const bad={...whole,midline:128};
 const out=build({phase2Evidence:e("upper"),normalizedZoneInput:zi(bad),evaluationTimeMs:now});
 assert.equal(out.qualified,false);
 assert.equal(out.controlGeometryEligible,false);
 assert.equal(out.engine26Zone,bad);
 assert.ok(out.reasonCodes.includes("ENGINE26_ZONE_GEOMETRY_MISMATCH"));
});
test("whole-zone midpoint is not used after a wide lower site selection",()=>{
 const bars=[
  completed(now-10*m,5*m,127,132,124,130),
  completed(now-5*m,5*m,130,135,128,133),
  completed(now,5*m,133,137,130,135),
 ];
 const input=e("lower",true,whole,bars);
 const edge=build({phase2Evidence:input,normalizedZoneInput:zi(whole),evaluationTimeMs:now});
 const original=build({phase2Evidence:e("whole",false,whole,bars),
  normalizedZoneInput:zi(whole),evaluationTimeMs:now});
 assert.equal(edge.controlGeometrySource,"LOWER_SITE");
 assert.equal(original.controlGeometrySource,"WHOLE_ZONE");
 assert.equal(edge.controlGeometryEligible,true);
 assert.equal(edge.control.reactionState!==original.control.reactionState ||
   edge.control.contactState!==original.control.contactState ||
   edge.control.latestZoneCloseRelation!==original.control.latestZoneCloseRelation,true);
 assert.equal(edge.qualified,false,"far from lower site cannot qualify by whole-zone pressure");
});
