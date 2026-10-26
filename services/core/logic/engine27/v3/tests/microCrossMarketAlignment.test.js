import test from "node:test";import assert from "node:assert/strict";
import {createMicroCrossMarketAlignment} from "../marketAlignment/createMicroCrossMarketAlignment.js";
const base=Date.parse("2026-10-26T15:00:00Z");let now=base;
const create=(events=[])=>createMicroCrossMarketAlignment({clock:()=>now,onFiveMinuteEvent:x=>events.push(x)});
function feed(w,bucketOffset,prices){
 now=base+bucketOffset*300000+290000;
 for(const [symbol,price] of Object.entries(prices))assert.equal(w.ingest(symbol,price,now-5000),true);
}
const first={ES:7698,QQQ:712.2,VIX:18.8},second={ES:7732,QQQ:715.5,VIX:17.9};
test("not enough completed 5-minute buckets creates no bullish signal",()=>{
 now=base;const w=create();feed(w,0,first);now=base+300001;
 assert.equal(w.assess().marketAligned,false);
 assert.equal(w.assess().state,"AWAITING_COMPLETED_5M_CLOSES");
});
test("two completed 5m close buckets align and archive one event, not every refresh",()=>{
 const history=[];now=base;const w=create(history);
 feed(w,0,first);feed(w,1,second);now=base+600001;
 const r=w.assess({microDirection:"DOWN",engine25Qualified:false,engine29Qualified:false});
 assert.equal(r.marketAligned,true);
 assert.equal(r.state,"BULLISH_CROSS_MARKET_ALIGNMENT_5M");
 assert.equal(r.fullQualified,false);
 assert.equal(r.executionAuthorized,false);
 assert.ok(r.reasons.includes("ENGINE22_MICRO_DIRECTION_NOT_LONG"));
 assert.equal(r.methodology.comparisonMinutes,5);
 assert.equal(r.evidence.ES.state,"UP");
 assert.equal(r.evidence.QQQ.state,"UP");
 assert.equal(r.evidence.VIX.state,"DOWN");
 assert.equal(history.length,1);
 w.assess();assert.equal(history.length,1);
 assert.equal(history[0].closedAt,new Date(base+600000).toISOString());
 assert.equal(r.recentHistory.length,1);
});
test("all owner checks do not create trading permissions",()=>{
 now=base;const w=create();feed(w,0,first);feed(w,1,second);now=base+600001;
 const r=w.assess({microDirection:"LONG",engine25Qualified:true,engine29Qualified:true});
 assert.equal(r.fullQualified,true);assert.equal(r.executionAuthorized,false);
});
test("VIX rising defeats confirmed bullish trio",()=>{
 now=base;const w=create();feed(w,0,first);feed(w,1,{...second,VIX:19.2});now=base+600001;
 assert.equal(w.assess({microDirection:"LONG"}).state,"NO_BULLISH_TRIO_5M");
});
test("5m assessment stays unchanged while current 5m bucket ticks are arriving",()=>{
 now=base;const w=create();feed(w,0,first);feed(w,1,second);now=base+600001;
 assert.equal(w.assess().marketAligned,true);
 now=base+600150;w.ingest("ES",7600,now);w.ingest("QQQ",700,now);w.ingest("VIX",25,now);
 assert.equal(w.assess().marketAligned,true);
});
test("lost VIX relay fails closed and no retrospective event",()=>{
 now=base;const w=create();feed(w,0,first);feed(w,1,second);now=base+600001;
 const r=w.assess({vixConnected:false});assert.equal(r.marketAligned,false);
 assert.equal(r.evidence.VIX.state,"UNAVAILABLE");assert.equal(r.recentHistory.length,0);
});
test("historical close data ages out instead of inventing previous market readings",()=>{
 now=base;const w=create();feed(w,0,first);feed(w,1,second);now=base+20*60000;
 const r=w.assess();assert.equal(r.marketAligned,false);
});
test("1-minute early warning is independent of 5-minute confirmation",()=>{
 now=base;const w=create();now=base+55000;
 for(const [s,p] of Object.entries(first))w.ingest(s,p,now);
 now=base+115000;
 for(const [s,p] of Object.entries(second))w.ingest(s,p,now);
 now=base+120001;
 const r=w.assess();
 assert.equal(r.earlyWarning,true);assert.equal(r.marketAligned,false);
});
