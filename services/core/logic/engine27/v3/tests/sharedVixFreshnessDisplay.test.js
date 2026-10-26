import test from "node:test";import assert from "node:assert/strict";
import {presentSharedCrossMarketFeed} from "../../../../../streamer/shadow/createSharedCrossMarketConsumer.js";
const now=Date.parse("2026-10-26T15:00:00Z");
const event=(age)=>({sourceMs:now-age,sourceTime:new Date(now-age).toISOString(),price:17.91,sourceLatencyQualified:true,movement:"DOWN"});
test("fresh direct VIX index value remains current when connected",()=>{
 const s=presentSharedCrossMarketFeed(event(4000),"CONNECTED","VIX",null,now);
 assert.equal(s.available,true);assert.equal(s.connectionState,"CONNECTED");assert.equal(s.freshnessState,"CURRENT");
 assert.equal(s.lastObservedPrice,17.91);
});
test("healthy VIX relay with 22-second gap is connected but not LIVE",()=>{
 const s=presentSharedCrossMarketFeed(event(22000),"CONNECTED","VIX",null,now);
 assert.equal(s.connectionState,"CONNECTED");assert.equal(s.available,false);
 assert.equal(s.freshnessState,"WAITING_FOR_NEXT_UPDATE");
 assert.equal(s.price,null);assert.equal(s.lastObservedPrice,17.91);
 assert.equal(s.lastObservedAgeSeconds,22);
});
test("old VIX last observed value disappears, despite connected socket",()=>{
 const s=presentSharedCrossMarketFeed(event(130000),"CONNECTED","VIX",null,now);
 assert.equal(s.available,false);assert.equal(s.lastObservedPrice,null);
 assert.equal(s.freshnessState,"WAITING_FOR_NEXT_UPDATE");
});
test("lost connection cannot be falsely presented as current",()=>{
 const s=presentSharedCrossMarketFeed(event(2000),"SUBSCRIPTION_LIMIT","VIX","SUBSCRIPTION_LIMIT",now);
 assert.equal(s.available,false);assert.equal(s.connectionState,"SUBSCRIPTION_LIMIT");
 assert.equal(s.freshnessState,"SOURCE_UNAVAILABLE");
});
