import test from "node:test";
import assert from "node:assert/strict";
import {parseIronbeamV2DepthFrame,createEngine18Level2ZoneReader}
 from "../logic/engine18/ironbeamV2Level2Zones.js";

const symbol="XCME:ES.Z26",now=1794300000000;
const frame=(bidSize=110,askSize=90,t=now)=>({d:{s:symbol,
 b:[{l:0,t,s:"B",p:7500,o:6,sz:bidSize,is:0},{l:1,t,s:"B",p:7499.75,o:2,sz:20,is:0}],
 a:[{l:0,t,s:"A",p:7500.25,o:5,sz:askSize,is:0},{l:1,t,s:"A",p:7500.5,o:2,sz:25,is:0}]
}});
test("v2 compact depth parses Level 2 size/count, never individual orders",()=>{
 const p=parseIronbeamV2DepthFrame(frame());
 assert.equal(p.ok,true);assert.equal(p.bids[0].size,110);
 assert.equal(p.asks[0].orderCount,5);assert.equal(p.level3,false);
 assert.equal(p.bids[0].individualOrders,false);
});
test("persistent visible bid/ask concentration requires multiple distinct images",()=>{
 const reader=createEngine18Level2ZoneReader({minObservations:3});
 assert.equal(reader.observe(frame(110,90,now)).accepted,true);
 assert.equal(reader.snapshot({nowMs:now+200}).usable,false);
 assert.equal(reader.observe(frame(110,90,now)).reason,"UNCHANGED_DEPTH");
 reader.observe(frame(111,91,now+100));reader.observe(frame(112,92,now+200));
 const s=reader.snapshot({nowMs:now+250,feedTier:"UNVERIFIED"});
 assert.equal(s.usable,true);assert.equal(s.displayOnly,true);
 assert.equal(s.zones.length,2);
 assert.equal(s.zones[0].side,"BID");
 assert.equal(s.zones[0].observationShare,1);
 assert.equal(s.zones[0].isHiddenStop,false);
});
test("invalid, gapped/partial, crossed and off-tick books cannot be trusted",()=>{
 const reader=createEngine18Level2ZoneReader();
 assert.equal(reader.observe({d:{s:symbol,b:[{p:7500,sz:3,t:now,o:1}]}}).accepted,false);
 const crossed=frame();crossed.d.a[0].p=7499.75;
 assert.equal(reader.observe(crossed).accepted,false);
 const invalid=frame();invalid.d.b[0].p=7500.12;
 assert.equal(reader.observe(invalid).accepted,false);
 assert.equal(reader.snapshot({nowMs:now+100}).usable,false);
});
test("rejects outdated depth when real-time is required; no hidden stop assertions",()=>{
 const reader=createEngine18Level2ZoneReader({minObservations:1,allowDelayedResearch:false});
 reader.observe(frame());
 const snap=reader.snapshot({nowMs:now+60000,feedTier:"LIVE_VERIFIED"});
 assert.equal(snap.usable,false);assert.equal(snap.reason,"FEED_FRESHNESS_NOT_VERIFIED");
});
test("reject out-of-order event clocks rather than revising historical state",()=>{
 const reader=createEngine18Level2ZoneReader({minObservations:1});
 reader.observe(frame());
 assert.equal(reader.observe(frame(120,90,now-100)).reason,"OUT_OF_ORDER_BOOK");
 assert.equal(reader.snapshot({nowMs:now+100}).images,1);
});
