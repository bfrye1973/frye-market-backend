import test from "node:test";import assert from "node:assert/strict";
import {inspectDirectCrossMarketTick as inspect,applyDirectCrossMarketTick as apply,presentDirectCrossMarketState as show} from "../livePriceObserver/projectDirectCrossMarketTick.js";
const now=Date.parse("2026-10-26T14:00:00Z");
test("QQQ direct stock trade and VIX direct index value are distinct",()=>{
 const q=inspect({ev:"T",sym:"QQQ",p:610.25,t:now-1000},now);
 const v=inspect({ev:"V",T:"I:VIX",val:22.45,t:now-1000},now);
 assert.equal(q.ok,true);assert.equal(q.tick.source,"POLYGON_STOCK_TRADE");
 assert.equal(v.ok,true);assert.equal(v.tick.source,"POLYGON_INDEX_VALUE");
 assert.equal(v.tick.sourceSymbol,"I:VIX");
});
test("wrong symbol, stale and future ticks are rejected or delayed",()=>{
 assert.equal(inspect({ev:"T",sym:"SPY",p:610,t:now},now).ok,false);
 assert.equal(inspect({ev:"V",T:"I:VIX",val:-2,t:now},now).ok,false);
 assert.equal(inspect({ev:"T",sym:"QQQ",p:610,t:now+18000},now).ok,false);
 const delayed=inspect({ev:"T",sym:"QQQ",p:610,t:now-900000},now);
 assert.equal(delayed.ok,true);assert.equal(delayed.tick.sourceLatencyQualified,false);
});
test("move uses successive real observations, not an hourly bar",()=>{
 const a=inspect({ev:"T",sym:"QQQ",p:601,t:now-2000},now);
 const b=inspect({ev:"T",sym:"QQQ",p:602,t:now-1000},now);
 const one=apply(null,a.tick);
 const two=apply(one,b.tick);
 assert.equal(two.movement,"UP");assert.equal(two.lastMovePoints,1);
 assert.equal(show(two,"CONNECTED",now).state,"LIVE");
 assert.equal(apply(two,a.tick),two);
});
test("disconnected source never shows current price as live",()=>{
 const q=inspect({ev:"V",T:"I:VIX",val:18,t:now-1000},now);
 const state=apply(null,q.tick);
 assert.equal(show(state,"DISCONNECTED",now).available,false);
 assert.equal(show(state,"DISCONNECTED",now).price,null);
 assert.equal(show(state,"CONNECTED",now+20000).state,"STALE");
});
test("provider delayed response not called current",()=>{
 const q=inspect({ev:"V",T:"I:VIX",val:18,t:now-900000},now);
 const state=apply(null,q.tick);
 assert.equal(show(state,"CONNECTED",now).state,"DELAYED");
});
