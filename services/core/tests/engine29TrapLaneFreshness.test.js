import test from "node:test";
import assert from "node:assert/strict";
import { buildEngine29TrapLaneFreshness } from "../logic/engine29/trapDetection/buildTrapLaneFreshness.js";
import { buildEngine29DownstreamContext } from "../logic/engine29/downstreamContext.js";

const t = Date.parse("2026-11-23T18:00:00.000Z");
function fixture() {
 const quality = {
   esLiveMonitorFreshness:{stale:false,ageMs:60000,reason:"FRESH"},
   esThirtyMinuteFreshness:{stale:false,ageMs:300000,reason:"FRESH"},
   esOneHourFreshness:{stale:false,ageMs:600000,reason:"FRESH"},
 };
 const detection={
   state:"TRAP_FORMING",trapSide:"BULL",
   dataQuality:{tenMinuteAvailable:true,thirtyMinuteAvailable:true,oneHourAvailable:true},
   auctionEvent:{
     tenMinuteEvidence:{completed:true,completedBarTime:t-600_000,formingPresent:false},
     acceptance30m:{time:t-1800000,priorAcceptanceFailure:true},
     engine26ZoneId:"E26-1",
     liquidityLevel:{id:"E26-1",type:"INSTITUTIONAL_ZONE",
       source:"ENGINE26",eventEligible:true,lo:7295.75,hi:7335},
   },
   participation:{
     primary:{available:true,source:{currentTrapConfirmationUsable:true,contractValid:true},
       sourceUpdatedAt:"2026-11-23T17:59:00.000Z",
       freshness:{state:"CURRENT",usableForTrapConfirmation:true}},
     secondary:{blocks:{leadership:{direction:"DOWN"},credit:{direction:"DOWN"}},
       secondarySupportsTrap:true},
   }
 };
 return {quality,detection};
}
function evaluate(change) {
 const {quality,detection}=fixture();
 change?.(quality,detection);
 return buildEngine29TrapLaneFreshness({dataQuality:quality,detection});
}
test("complete sourced evidence is current without changing trade authority",()=>{
 const r=evaluate();
 assert.equal(r.state,"CURRENT");
 assert.equal(r.usableForConfirmation,true);
 assert.equal(r.eligibleForEngine4,false);
 assert.deepEqual(r.confirmationBlockedBy,[]);
 assert.equal(r.sources.completed10m.completed,true);
 assert.equal(r.sources.completed30m.completed,true);
 assert.equal(r.sources.location.zoneId,"E26-1");
});
// A setup can be absent with entirely healthy sources.
for(const [name,change,blocker] of [
 ["forming-only 10m",(_q,d)=>{d.auctionEvent.tenMinuteEvidence.completed=false;},"COMPLETED_10M_REQUIRED"],
 ["missing completed 30m",(_q,d)=>{d.auctionEvent.acceptance30m=null;},"COMPLETED_30M_REQUIRED"],
 ["no proven prior acceptance loss",(_q,d)=>{d.auctionEvent.acceptance30m.priorAcceptanceFailure=false;},"PRIOR_30M_ACCEPTANCE_LOSS_NOT_PROVEN"],
 ["no eligible zone",(_q,d)=>{d.auctionEvent.liquidityLevel.eventEligible=false;},"ELIGIBLE_LOCATION_REQUIRED"],
]) {
 test("missing trap setup is not data degradation: "+name,()=>{
  const r=evaluate(change);
  assert.equal(r.usableForConfirmation,false);
  assert.equal(r.dataDegraded,false);
  assert.deepEqual(r.freshnessBlockedBy,[]);
  assert.ok(r.confirmationBlockedBy.includes(blocker),JSON.stringify(r.confirmationBlockedBy));
  assert.equal(r.eligibleForEngine4,false);
 });
}
for(const [name,change,blocker] of [
 ["stale ES 10m",(q)=>{q.esLiveMonitorFreshness.stale=true;},"SOURCE_STALE"],
 ["stale ES 30m",(q)=>{q.esThirtyMinuteFreshness.stale=true;},"SOURCE_STALE"],
 ["stale Engine29 1H",(q)=>{q.esOneHourFreshness.stale=true;},"SOURCE_STALE"],
 ["Engine25 primary stale",(_q,d)=>{d.participation.primary.source.currentTrapConfirmationUsable=false;},"ENGINE25_PRIMARY_SOURCE_NOT_CURRENT_OR_UNVERIFIED"],
 ["missing secondary",(_q,d)=>{d.participation.secondary.blocks={};},"ENGINE29_SECONDARY_SOURCE_UNAVAILABLE"],
 ["unverified 10m freshness",(q)=>{q.esLiveMonitorFreshness=null;},"FRESHNESS_UNVERIFIED"],
]) {
 test("genuine source invalidity degrades trap lane: "+name,()=>{
  const r=evaluate(change);
  assert.equal(r.usableForConfirmation,false);
  assert.equal(r.dataDegraded,true);
  assert.ok(r.freshnessBlockedBy.includes(blocker),JSON.stringify(r.freshnessBlockedBy));
  assert.equal(r.eligibleForEngine4,false);
 });
}
test("fresh ES 10m alone never makes trap freshness CURRENT",()=>{
 const result=evaluate((q,d)=>{
  q.esThirtyMinuteFreshness=null;
  d.participation.primary.available=false;
  d.participation.secondary=null;
 });
 assert.equal(result.sources.completed10m.current,true);
 assert.equal(result.state,"DEGRADED");
 assert.equal(result.usableForConfirmation,false);
});
test("production-shaped healthy NO_ACTIVE_TRAP is not data-degraded with absent setup",()=>{
 const r=evaluate((_q,d)=>{
  d.state="NO_ACTIVE_TRAP";d.trapSide="NONE";
  d.auctionEvent.acceptance30m=null;
  d.auctionEvent.liquidityLevel=null;
  d.auctionEvent.engine26ZoneId=null;
  d.participation.primary=null;
  d.participation.secondary={blocks:{},secondarySupportsTrap:false};
 });
 assert.equal(r.state,"NO_ACTIVE_TRAP");
 assert.equal(r.dataDegraded,false);
 assert.equal(r.usableForConfirmation,false);
 assert.deepEqual(r.freshnessBlockedBy,[]);
 assert.ok(r.confirmationBlockedBy.includes("PRIOR_30M_ACCEPTANCE_LOSS_NOT_PROVEN"));
 assert.ok(r.confirmationBlockedBy.includes("ELIGIBLE_LOCATION_REQUIRED"));
 assert.equal(r.sources.completed10m.completed,true);
});
test("no trap with stale source remains NO_ACTIVE_TRAP but dataDegraded true",()=>{
 const r=evaluate((q,d)=>{
  d.state="NO_ACTIVE_TRAP";d.trapSide="NONE";
  d.auctionEvent.acceptance30m=null;
  d.auctionEvent.liquidityLevel=null;
  q.esLiveMonitorFreshness.stale=true;
 });
 assert.equal(r.state,"NO_ACTIVE_TRAP");
 assert.equal(r.dataDegraded,true);
 assert.equal(r.usableForConfirmation,false);
 assert.ok(r.freshnessBlockedBy.includes("SOURCE_STALE"));
});
test("published live downstream contract uses same Engine29-owned trap freshness",()=>{
 const {quality,detection}=fixture();
 const ctx=buildEngine29DownstreamContext({
  timestamp:"2026-11-23T18:00:00.000Z",dataQuality:quality,
  trapDetection:detection,
  marketCharacter:{move:{moveCharacter:"UPSIDE_MOVE_ACTIVE",
    parent:{active:true,direction:"UP"}},trap:{state:"TRAP_FORMING",side:"BULL"}}
 });
 assert.equal(ctx.lanes.trap.freshness.owner,"ENGINE29");
 assert.equal(ctx.lanes.trap.freshness.state,"CURRENT");
 assert.equal(ctx.lanes.trap.freshness.sources.engine25Primary.current,true);
 assert.equal(ctx.lanes.trap.eligibleForEngine4,false);
});
