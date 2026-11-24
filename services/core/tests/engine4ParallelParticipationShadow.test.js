import test from "node:test";
import assert from "node:assert/strict";
import { buildParallelParticipationShadow as build, buildEngine3Engine4Agreement as agreement, RESEARCH_POLICY } from "../logic/engine4/parallelShadow/buildParallelParticipationShadow.js";

const T0 = 1795500000000 - (1795500000000 % 300000);
const contractId = "ESZ6";
const zone = { low:7138, high:7210.75, midline:7174.375 };
function base(n=22,volume=10000) {
  return Array.from({length:n}, (_,i)=>{
    const t=T0+i*300000;
    return {time:t/1000,open:7160,high:7164,low:7156,close:7160,volume,
      availableAtMs:t+300000,finalityVerified:true,contractId};
  });
}
function bar(prev, {open=7160,high=7180,low=7120,close=7178,volume=30000}={}) {
  const t=prev.at(-1).time*1000+300000;
  return [...prev,{time:t/1000,open,high,low,close,volume,
    availableAtMs:t+300000,finalityVerified:true,contractId}];
}
const good = bars => ({
  bars5m:bars, candidateId:"c1",zoneId:"z1",zone,contractId,
  authorizationStartedAtMs:T0+20*300000,
  authorizeEngine3Evaluation:true,
  evaluationTimeMs:bars.at(-1).time*1000+300000+1000,
  provenance:{sourceVerified:true,contractVerified:true,finalityVerified:true},
});
const bullish = () => bar(base(),{open:7160,high:7195,low:7120,close:7190,volume:35000});
const bearish = () => bar(base(),{open:7185,high:7230,low:7140,close:7150,volume:35000});

test("causal buyer defense uses completed postauthorization verified 5m",()=>{
  const r=build(good(bullish()));
  assert.equal(r.side,"BUYERS_CONFIRMED");
  assert.equal(r.confirmationState,"CONFIRMED");
  assert.equal(r.evidenceCompleteness,"VERIFIED_AS_OF");
  assert.equal(r.signals.at(-1).signalClass,"TOUCH_DEFENSE");
  assert.equal(r.gate,false);
});
test("missing Engine26 authorization clock never confirms",()=>{
  for(const clock of [undefined,null,0]) {
    const r=build({...good(bullish()),authorizationStartedAtMs:clock});
    assert.equal(r.confirmationState,"UNKNOWN");
    assert.equal(r.evidenceCompleteness,"INCOMPLETE");
    assert.equal(r.signals.length,0);
  }
});
test("preauthorization high-volume defense never confirms",()=>{
  const bars=bullish();
  const r=build({...good(bars), authorizationStartedAtMs:bars.at(-1).time*1000+300000});
  assert.equal(r.confirmationState,"UNKNOWN");
});
test("candidate zone and authorization changes create distinct research episodes",()=>{
  const x=good(bullish()); const a=build(x);
  const changes=[
    {...x,candidateId:"c2"}, {...x,zoneId:"z2"},
    {...x,authorizationStartedAtMs:x.authorizationStartedAtMs+300000},
  ];
  for (const c of changes) assert.notEqual(build(c).episode?.key,a.episode.key);
});
test("Engine3 direction flip never resets or alters independent result",()=>{
  const x=build(good(bullish()));
  const a=agreement({parallel:x,engine3Direction:"NEUTRAL"});
  const b=agreement({parallel:x,engine3Direction:"SHORT"});
  assert.equal(a.label,"PARTICIPATION_LEADS_PRICE");
  assert.equal(b.label,"CONFLICT");
  assert.equal(build(good(bullish())).episode.key,x.episode.key);
});
test("huge volume without absorption or effort never creates direction",()=>{
  const bars=bar(base(),{open:7160,high:7215,low:7150,close:7210,volume:500000});
  const r=build(good(bars));
  assert.equal(r.side,"PARTICIPATION_NEUTRAL");
  assert.equal(r.confirmationState,"NOT_CONFIRMED");
  assert.ok(r.trace.some(x=>x.highVolumeNoSide));
});
test("both-side defenses become unresolved, not arbitrary winner",()=>{
  const bars=bar(bullish(),{open:7185,high:7230,low:7140,close:7150,volume:35000});
  const r=build(good(bars));
  assert.equal(r.side,"TWO_SIDED");
  assert.equal(r.confirmationState,"UNRESOLVED");
  assert.equal(r.signals.length,0);
});
test("seller defense mirrors buyer defense",()=>{
  const r=build(good(bearish()));
  assert.equal(r.side,"SELLERS_CONFIRMED");
  assert.equal(agreement({parallel:r,engine3Direction:"SHORT"}).label,"ALIGNED");
});
test("forming bars cannot confirm or enter causal evidence",()=>{
  const bars=bullish(); const last=bars.at(-1);
  const r=build({...good(bars),evaluationTimeMs:last.time*1000+60000});
  assert.equal(r.side,"PARTICIPATION_NEUTRAL");
  assert.equal(r.signals.length,0);
});
test("unverified REST data remains unknown, not as-of proof",()=>{
  for (const provenance of [null,{sourceVerified:false,contractVerified:true,finalityVerified:true}]) {
    const r=build({...good(bullish()),provenance});
    assert.equal(r.confirmationState,"UNKNOWN");
    assert.equal(r.evidenceCompleteness,"INCOMPLETE");
  }
});
test("no contract roll contamination",()=>{
  const b=bullish(); b.at(-1).contractId="ESH7";
  const r=build(good(b));
  assert.equal(r.side,"PARTICIPATION_NEUTRAL");
});
test("engine29 context cannot change participation or episode",()=>{
  const opts=good(bullish());
  const a=build({...opts,engine29:{state:"BUYING_PRESSURE_INCREASING"}});
  const b=build({...opts,engine29:{state:"SELLING_PRESSURE_INCREASING",dataDegraded:true}});
  assert.equal(a.side,b.side);
  assert.deepEqual(a.signals,b.signals);
  assert.deepEqual(a.episode,b.episode);
});
test("repeat identical snapshot has deterministic idempotent state",()=>{
  const opts=good(bullish());assert.deepEqual(build(opts),build(opts));
});
test("upstream invalidation terminates confirmation",()=>{
  for (const x of [{invalidated:true},{nextZoneReached:true},{authorizeEngine3Evaluation:false}]) {
    assert.equal(build({...good(bullish()),...x}).confirmationState,"UNKNOWN");
  }
});
test("24 bars without a zone retest expires the episode",()=>{
  let bars=bullish();
  for(let i=0;i<24;i++)bars=bar(bars,{open:7250,high:7260,low:7245,close:7255,volume:7000});
  const r=build(good(bars));
  assert.equal(r.episode,null);
  assert.equal(r.confirmationState,"NOT_CONFIRMED");
});
test("touch followthrough retest classified inside episode",()=>{
  let bars=bullish();
  bars=bar(bars,{open:7220,high:7240,low:7215,close:7230,volume:9000});
  bars=bar(bars,{open:7220,high:7230,low:7210,close:7220,volume:9000});
  const r=build(good(bars));
  assert.ok(r.trace.some(x=>x.signalClass==="FOLLOW_THROUGH"));
  assert.ok(r.trace.some(x=>x.signalClass==="RETEST"));
});
test("Nov24 retrospective fixture is exploratory and cannot confirm",()=>{
  const bars=bullish();
  const r=build({...good(bars),provenance:{sourceVerified:false,contractVerified:true,finalityVerified:false}});
  assert.equal(r.evidenceCompleteness,"INCOMPLETE");
  assert.equal(r.confirmationState,"UNKNOWN");
});

test("Phase B research thresholds are frozen and caller policy overrides cannot alter decisions",()=>{
  assert.deepEqual(RESEARCH_POLICY, {
    baselineBars:20, minRelVol:1.5, wickFraction:0.5, maxBarsWithoutRetest:24,
  });
  assert.equal(Object.isFrozen(RESEARCH_POLICY),true);
  const malicious = { baselineBars:1, minRelVol:0, wickFraction:0, maxBarsWithoutRetest:999999 };
  const fixtures = [
    good(bullish()),
    good(bearish()),
    good(bar(base(),{open:7160,high:7215,low:7150,close:7210,volume:500000})),
    good(bar(base(),{open:7160,high:7195,low:7120,close:7190,volume:10000})),
  ];
  for (const input of fixtures) {
    const canonical = build(input);
    assert.deepEqual(build({...input,policy:malicious}),canonical);
    assert.deepEqual(build({...input,policy:{baselineBars:100,minRelVol:999,wickFraction:0.99,maxBarsWithoutRetest:1}}),canonical);
    assert.deepEqual(canonical.policy,RESEARCH_POLICY);
  }
});
