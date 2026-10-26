import test from "node:test";import assert from "node:assert/strict";
import {validateLiveZonePublication as validate,observeLiveCrossMarketZones as observe,projectLiveCrossMarketZonesForDisplay as present} from "../livePriceObserver/evaluateLiveCrossMarketZones.js";
const now=Date.parse("2026-10-26T14:15:00Z");
const levels={schema:"engine27.crossMarketSource.v1",available:true,instruments:{
 QQQ:{schema:"engine27.qqqKeyLevels.v1",symbol:"QQQ",available:true,lastCandleTime:"2026-10-23T00:00:00Z",
  levels:[{low:700,high:703,center:701.5,type:"SUPPORT_CANDIDATE",qualification:"DAILY_OHLC_CLUSTER",observationCount:3,distinctReactions:2}]},
 VIX:{schema:"engine27.vixKeyLevels.v1",symbol:"I:VIX",available:true,lastCandleTime:"2026-10-23T00:00:00Z",
  levels:[{low:18.85,high:19.15,center:19,type:"RESISTANCE_CANDIDATE",qualification:"DAILY_OHLC_CLUSTER",observationCount:3,distinctReactions:2}]}}};
const tick=(symbol,price,time=now-2000)=>({symbol,price,sourceTime:new Date(time).toISOString(),sourceMs:time,sourceLatencyQualified:true});
test("existing daily owner zones accepted independently for QQQ and direct VIX",()=>{
 assert.equal(validate(levels,"QQQ",now).ok,true);
 assert.equal(validate(levels,"VIX",now).ok,true);
 assert.equal(validate(levels,"QQQ",now).zones[0].low,700);
});
test("approach is observation not a reversal or confirmation",()=>{
 const r=observe({publication:levels,key:"QQQ",tick:tick("QQQ",703.4),nowMs:now});
 assert.equal(r.state,"APPROACHING");
 assert.equal(r.near.low,700);assert.equal(r.near.high,703);
 assert.equal(r.noTradeConfirmation,true);assert.equal(r.noExecution,true);
});
test("touch from below, exit and range-cross observation are distinct",()=>{
 const a=observe({publication:levels,key:"VIX",tick:tick("VIX",18.5,now-5000),nowMs:now});
 const b=observe({publication:levels,key:"VIX",tick:tick("VIX",18.9,now-4000),previous:a.previous,nowMs:now});
 assert.equal(b.state,"TOUCH_OBSERVED");
 assert.equal(b.observedEvents[0].type,"TOUCH_OBSERVED");
 const c=observe({publication:levels,key:"VIX",tick:tick("VIX",19.4,now-3000),previous:b.previous,nowMs:now});
 assert.equal(c.observedEvents[0].type,"EXITED_ZONE");
 const d=observe({publication:levels,key:"QQQ",tick:tick("QQQ",699,now-5000),nowMs:now});
 const e=observe({publication:levels,key:"QQQ",tick:tick("QQQ",704,now-3000),previous:d.previous,nowMs:now});
 assert.equal(e.observedEvents[0].type,"CROSSED_RANGE_BETWEEN_TICKS");
 assert.equal(e.noTradeConfirmation,true);
});
test("reconnect/time gap never asserts crossing",()=>{
 const a=observe({publication:levels,key:"QQQ",tick:tick("QQQ",699,now-40000),nowMs:now-38000});
 const b=observe({publication:levels,key:"QQQ",tick:tick("QQQ",704,now-2000),previous:a.previous,nowMs:now});
 assert.deepEqual(b.observedEvents,[]);
});
test("invalid or stale levels and live observations fail closed",()=>{
 const old=structuredClone(levels);old.instruments.QQQ.lastCandleTime="2026-10-15T00:00:00Z";
 assert.equal(observe({publication:old,key:"QQQ",tick:tick("QQQ",702),nowMs:now}).available,false);
 const wrong=observe({publication:levels,key:"VIX",tick:tick("QQQ",19),nowMs:now});
 assert.equal(wrong.available,false);
 const delayed=observe({publication:levels,key:"VIX",tick:tick("VIX",19,now-25000),nowMs:now});
 assert.equal(delayed.available,false);
});
test("no zone data never invented and browser projection hides internal tracking",()=>{
 const r=observe({publication:null,key:"QQQ",tick:tick("QQQ",700),nowMs:now});
 assert.equal(r.available,false);assert.equal(present(r).nearest,null);
 const valid=observe({publication:levels,key:"QQQ",tick:tick("QQQ",701),nowMs:now});
 const p=present(valid);assert.equal(p.nearest.low,700);
 assert.equal("previous" in p,false);
});
