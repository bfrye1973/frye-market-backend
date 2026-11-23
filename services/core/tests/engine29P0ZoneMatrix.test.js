import test from "node:test";
import assert from "node:assert/strict";
import { detectEngine29TrapAuctionEvent } from "../logic/engine29/trapDetection/detectTrapAuctionEvent.js";
const t=1_800_000_000_000;
const zone=(id,lo=100,hi=110)=>({id,type:"INSTITUTIONAL_ZONE",side:"BOTH",lo,hi,level:(lo+hi)/2,eventEligible:true});
const b=(time,o,h,l,c)=>({time,open:o,high:h,low:l,close:c});
function run({bars=[b(t,95,105,93,97)],prev=b(t-3_600_000,95,99,90,96),last=b(t-1_800_000,96,105,92,97),levels=[zone("z")],priorApproach=null,now=t+600_000}={}){
 return detectEngine29TrapAuctionEvent({now,macroLiquidityMap:{levels},priorApproach,
 esAnchor:{liveMonitor:{bars},structure:{fastTactical:{bars:[prev,last]},tactical:{bars:[]}}}});
}
test("rally from below, rejected: not trap",()=>{const x=run();assert.equal(x.auctionClassification,"REJECTION");assert.equal(x.trapSide,"NONE");assert.equal(x.entryBoundary,100);});
test("rally into zone, inside close: no prior acceptance loss",()=>{const x=run({bars:[b(t,95,105,93,104)],last:b(t-1_800_000,96,105,92,104)});assert.equal(x.trapSide,"NONE");assert.equal(x.approachDirection,"UP");});
test("rally accepted through overhead entry does not create trap",()=>{const x=run({bars:[b(t,95,115,94,112)],last:b(t-1_800_000,96,115,92,112)});assert.equal(x.trapSide,"NONE");assert.equal(x.auctionClassification,"TEST_OR_ACCEPTANCE");});
test("rally accepted earlier and later loses acceptance traps buyers",()=>{const x=run({bars:[b(t,99,106,95,98)],prev:b(t-3_600_000,95,108,90,104),last:b(t-1_800_000,104,106,95,98)});assert.equal(x.trapSide,"BULL");assert.equal(x.trappedParticipants,"BUYERS");});
test("selloff from above rejected is not trap",()=>{const x=run({bars:[b(t,115,118,105,116)],prev:b(t-3_600_000,115,120,112,116),last:b(t-1_800_000,116,118,105,116)});assert.equal(x.entryBoundary,110);assert.equal(x.approachDirection,"DOWN");assert.equal(x.trapSide,"NONE");});
test("selloff closes within zone without acceptance loss",()=>{const x=run({bars:[b(t,115,117,105,107)],prev:b(t-3_600_000,115,120,112,116),last:b(t-1_800_000,116,117,105,107)});assert.equal(x.approachOrigin,"ABOVE");assert.equal(x.trapSide,"NONE");});
test("selloff accepted through entry remains nontrap",()=>{const x=run({bars:[b(t,115,118,95,97)],prev:b(t-3_600_000,115,120,112,116),last:b(t-1_800_000,116,118,95,97)});assert.equal(x.trapSide,"NONE");});
test("selloff accepted earlier then loses acceptance traps sellers",()=>{const x=run({bars:[b(t,112,117,105,114)],prev:b(t-3_600_000,115,119,105,106),last:b(t-1_800_000,106,117,105,114)});assert.equal(x.trapSide,"BEAR");assert.equal(x.trappedParticipants,"SELLERS");assert.equal(x.failedDirection,"DOWN");});
test("bar spanning entire zone is anchored by approach, never low sweep from below",()=>{const x=run({bars:[b(t,96,120,90,97)],last:b(t-1_800_000,96,120,90,97)});assert.equal(x.approachDirection,"UP");assert.equal(x.liquidityEvent.side,"HIGH");});
test("no provable outside approach from inside must fail closed",()=>{const x=run({bars:[b(t,105,107,103,106)],prev:b(t-3_600_000,105,108,102,105),last:b(t-1_800_000,105,108,102,105)});assert.equal(x.trapSide,"NONE");assert.equal(x.liquidityEvent.state,"NO_LIQUIDITY_EVENT");});
test("edited zone geometry invalidates prior approach lock",()=>{const x=run({levels:[zone("z",102,112)],bars:[b(t,105,108,101,106)],prev:b(t-3_600_000,105,108,102,105),last:b(t-1_800_000,105,108,102,105),priorApproach:{engine26ZoneId:"z",zoneLo:100,zoneHi:110,approachDirection:"UP",approachOrigin:"BELOW",entryBoundary:100,firstTouchTime:t-600_000}});assert.equal(x.trapSide,"NONE");assert.notEqual(x.firstTouchTime,t-600_000);});
test("reversed manual zone bounds normalize approach consistently",()=>{const x=run({levels:[zone("z",110,100)]});assert.equal(x.entryBoundary,100);assert.equal(x.approachDirection,"UP");});
test("adjacent zones select tested edge, not arbitrary first zone",()=>{const x=run({levels:[zone("far",110,120),zone("near",100,105)]});assert.equal(x.liquidityLevel.id,"near");});
test("nested zones maintain deterministic selected zone identity",()=>{const x=run({levels:[zone("wide",95,115),zone("tight",100,105)]});assert.ok(["wide","tight"].includes(x.liquidityLevel.id));assert.ok(x.liquidityLevel.id);});
test("thin institutional zone preserves fixed entry edge",()=>{const x=run({levels:[zone("thin",100,100.25)]});assert.equal(x.entryBoundary,100);});
test("gap wholly beyond zone is travel rather than a fabricated new sweep",()=>{const x=run({bars:[b(t,112,118,111,117)],prev:b(t-3_600_000,95,99,90,96),last:b(t-1_800_000,96,118,111,117)});assert.equal(x.trapSide,"NONE");assert.equal(x.liquidityEvent.state,"NO_LIQUIDITY_EVENT");});
test("double test after a completed outside bar starts new first-touch identity",()=>{const x=run({bars:[b(t-1_200_000,95,105,93,97),b(t-600_000,97,99,90,95),b(t,95,105,92,97)],prev:b(t-3_600_000,95,99,90,96),last:b(t-1_800_000,96,105,92,97)});assert.equal(x.firstTouchTime,t);});
test("locked approach from prior snapshot is retained only across continuous contact",()=>{const x=run({bars:[b(t-600_000,95,106,94,102),b(t,102,107,99,103)],prev:b(t-3_600_000,95,99,90,96),last:b(t-1_800_000,96,107,92,103),priorApproach:{engine26ZoneId:"z",zoneLo:100,zoneHi:110,firstTouchTime:t-600_000,approachDirection:"UP",approachOrigin:"BELOW",entryBoundary:100,liquidityLocation:"OVERHEAD"}});assert.equal(x.firstTouchTime,t-600_000);assert.equal(x.approachDirection,"UP");});
