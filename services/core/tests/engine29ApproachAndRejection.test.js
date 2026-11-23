import test from "node:test";
import assert from "node:assert/strict";
import { detectEngine29TrapAuctionEvent } from "../logic/engine29/trapDetection/detectTrapAuctionEvent.js";
const t=1_800_000_000_000;
const zone={id:"E26-test",type:"INSTITUTIONAL_ZONE",side:"BOTH",lo:7295.75,hi:7335,level:7315,eventEligible:true};
const bar=(time,open,high,low,close)=>({time,open,high,low,close});
function detect({ live, previous30, current30, levels=[zone], now=t+600_000 }) {
 return detectEngine29TrapAuctionEvent({now,macroLiquidityMap:{levels},
  esAnchor:{liveMonitor:{bars:[live]},structure:{
   fastTactical:{bars:[previous30,current30]},tactical:{bars:[]}}}});
}
test("Claude #366 rally into overhead zone then rejected is not a low sweep or bear trap",()=>{
 const x=detect({live:bar(t,7300,7317,7270,7276),
 previous30:bar(t-3_600_000,7250,7285,7220,7258),
 current30:bar(t-1_800_000,7258,7317,7233.25,7280)});
 assert.equal(x.engine26ZoneId,"E26-test");
 assert.equal(x.approachOrigin,"BELOW");
 assert.equal(x.approachDirection,"UP");
 assert.equal(x.entryBoundary,7295.75);
 assert.equal(x.liquidityLocation,"OVERHEAD");
 assert.equal(x.liquidityEvent.side,"HIGH");
 assert.equal(x.auctionClassification,"REJECTION");
 assert.equal(x.trapSide,"NONE");
 assert.equal(x.failedAcceptance,false);
 assert.equal(x.reclaimObserved,false);
 assert.equal(x.sweep.extreme,7317);
 assert.ok(x.sweep.excursionPoints < 30);
});
test("rally closing within zone has no prior acceptance loss and cannot become false bear trap",()=>{
 const x=detect({live:bar(t,7290,7317,7280,7305),
 previous30:bar(t-3_600_000,7250,7285,7220,7258),
 current30:bar(t-1_800_000,7258,7317,7233.25,7305)});
 assert.equal(x.approachDirection,"UP");
 assert.equal(x.trapSide,"NONE");
 assert.equal(x.reclaimObserved,false);
 assert.equal(x.failedAcceptance,false);
});
test("previous completed 30m accepted, later completed 30m loses acceptance = BUYERS trapped",()=>{
 const x=detect({live:bar(t,7290,7310,7275,7280),
 previous30:bar(t-3_600_000,7280,7317,7270,7305),
 current30:bar(t-1_800_000,7305,7310,7275,7280)});
 assert.equal(x.approachOrigin,"BELOW");
 assert.equal(x.auctionClassification,"TRAP");
 assert.equal(x.trapSide,"BULL");
 assert.equal(x.trappedParticipants,"BUYERS");
 assert.equal(x.failedDirection,"UP");
 assert.equal(x.failedAcceptance,true);
});
test("reverse input lo hi still produces deterministic zone boundaries",()=>{
 const x=detect({levels:[{...zone,lo:7335,hi:7295.75}],
 live:bar(t,7290,7317,7280,7282),
 previous30:bar(t-3_600_000,7250,7285,7220,7258),
 current30:bar(t-1_800_000,7258,7317,7233.25,7280)});
 assert.equal(x.entryBoundary,7295.75);
 assert.equal(x.liquidityEvent.side,"HIGH");
});
test("approach from above classifies UNDERLYING test with LOW side, no false trap",()=>{
 const x=detect({live:bar(t,7340,7360,7320,7348),
 previous30:bar(t-3_600_000,7360,7380,7340,7350),
 current30:bar(t-1_800_000,7350,7370,7320,7348)});
 assert.equal(x.approachOrigin,"ABOVE");
 assert.equal(x.approachDirection,"DOWN");
 assert.equal(x.entryBoundary,7335);
 assert.equal(x.liquidityLocation,"UNDERLYING");
 assert.equal(x.liquidityEvent.side,"LOW");
 assert.equal(x.trapSide,"NONE");
});
