import test from "node:test";
import assert from "node:assert/strict";
import { buildEngine6ZoneRotationContext } from "../logic/engine6/buildZoneRotationContext.js";

const candidate = {candidateId:"C1",zoneId:"Z1"};
const reaction = {candidateId:"C1",zoneId:"Z1",direction:"SHORT",allowed:true,engine3Strategy1QualifiedForEngine6:true};
const participation = {candidateId:"C1",zoneId:"Z1",direction:"SHORT",participationConfirmed:true,allowed:true,hardBlocked:false};
const wave = {currentWavelength:{degrees:{
  submicro:{activeWave:"W2",direction:"DOWN",ownerSubmicroW2:{confirmationStatus:"OWNER_COUNT_CANDLE_CONFIRMATION_PENDING",levels:[{key:"r786",price:7735.5,status:"WATCH"}]}},
  micro:{direction:"UP",ownerMicroW3:{activeWave:"W3",direction:"UP",levels:[{key:"e0382",price:7791}]},microSequence:{w2Completion:{state:"COMPLETION_CANDIDATE"}}}
}}};
const internals = {freshness:{intraday:{state:"FRESH"}},participation:{distributionPressure:{
  state:"DETERIORATING",oneHourTrend:{state:"RISING"},
  thirtyMinuteConfirmation:{state:"SELLING_PRESSURE_CONFIRMED"},
  tenMinuteAcceleration:{state:"FAST_SELLING_ACCELERATION_CONFIRMED"},
  observations:{"10m":{available:true},"30m":{available:true},"1h":{available:true},"4h":{available:true}}
}}};
const inputs={candidate,reaction,participation,engine22WaveStrategy:wave,engine25Participation:internals};

test("qualified zone SHORT can receive supportive context under bullish Micro without auto-approval",()=>{
  const r=buildEngine6ZoneRotationContext(inputs);
  assert.equal(r.eligibleForPermissionReview,true);
  assert.equal(r.allowed,false);
  assert.equal(r.canCreatePermission,false);
  assert.equal(r.internals.directionalAssessment,"SUPPORTIVE");
  assert.ok(r.warnings.includes("COUNTERTREND_TO_MICRO"));
  assert.equal(r.wave.submicro.levels[0].status,"WATCH");
  assert.equal(r.wave.submicro.confirmed,false);
});
test("Engine 3 directional conflict fails closed",()=>{
  const r=buildEngine6ZoneRotationContext({...inputs,reaction:{...reaction,direction:"LONG"}});
  assert.equal(r.eligibleForPermissionReview,false);
  assert.ok(r.blockers.includes("ENGINE3_ENGINE4_DIRECTION_CONFLICT"));
});
test("missing and stale Engine25 data cannot turn into supportive market evidence",()=>{
  const r=buildEngine6ZoneRotationContext({...inputs,engine25Participation:null});
  assert.equal(r.internals.directionalAssessment,"UNAVAILABLE");
  assert.ok(r.warnings.includes("ENGINE25_PARTICIPATION_UNAVAILABLE"));
});
test("recovery evidence cautions against new SHORT",()=>{
  const updating=structuredClone(internals);
  updating.participation.distributionPressure.oneHourTrend.state="EASING";
  updating.participation.distributionPressure.thirtyMinuteConfirmation.state="BUYING_RECOVERY_CONFIRMED";
  updating.participation.distributionPressure.tenMinuteAcceleration.state="FAST_BUYING_RECOVERY_CONFIRMED";
  const r=buildEngine6ZoneRotationContext({...inputs,engine25Participation:updating});
  assert.equal(r.internals.directionalAssessment,"CAUTION");
});
test("Engine 25 alone cannot manufacture a trade without zone and reaction",()=>{
  const r=buildEngine6ZoneRotationContext({engine25Participation:internals,engine22WaveStrategy:wave});
  assert.equal(r.eligibleForPermissionReview,false);
  assert.equal(r.allowed,false);
  assert.ok(r.blockers.includes("ENGINE26A_CANDIDATE_IDENTITY_MISSING"));
});
test("stale intraday observations are flagged, not treated as fresh confirmation",()=>{
  const updating=structuredClone(internals);
  updating.freshness.intraday.state="STALE";
  updating.participation.distributionPressure.observations["10m"].available=false;
  const r=buildEngine6ZoneRotationContext({...inputs,engine25Participation:updating});
  assert.equal(r.internals.intradayFresh,false);
  assert.equal(r.internals.directionalAssessment,"UNAVAILABLE");
  assert.ok(r.warnings.includes("ENGINE25_TIMEFRAME_EVIDENCE_INCOMPLETE"));
  assert.ok(r.warnings.includes("ENGINE25_INTRADAY_FRESHNESS_UNCONFIRMED"));
});

test("Micro W2 completion never proves Micro W3 confirmed",()=>{
  const edited=structuredClone(wave);
  edited.currentWavelength.degrees.micro.microSequence.w2Completion.state="LOCKED";
  const r=buildEngine6ZoneRotationContext({...inputs,engine22WaveStrategy:edited});
  assert.equal(r.wave.micro.w2CompletionLocked,true);
  assert.equal(r.wave.micro.structurallyConfirmed,false);
});
test("10m selling alone is not a fully confirmed supportive market context",()=>{
  const edited=structuredClone(internals);
  edited.participation.distributionPressure.oneHourTrend.state="STABLE";
  edited.participation.distributionPressure.thirtyMinuteConfirmation.state="SELLING_PRESSURE_PENDING";
  const r=buildEngine6ZoneRotationContext({...inputs,engine25Participation:edited});
  assert.equal(r.internals.directionalAssessment,"MIXED");
});
