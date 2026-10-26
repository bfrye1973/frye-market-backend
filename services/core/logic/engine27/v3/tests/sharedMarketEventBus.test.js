import test from "node:test";import assert from "node:assert/strict";
import {createSharedMarketEventBus} from "../../../../../streamer/sharedMarketData/createSharedMarketEventBus.js";
test("one owner fans identical SPY trades to multiple isolated consumers",()=>{
 const bus=createSharedMarketEventBus(),seenA=[],seenB=[];
 const offA=bus.subscribe("T.SPY",e=>seenA.push(e));
 bus.subscribe("T.SPY",e=>seenB.push(e));
 const input={ev:"T",sym:"SPY",p:600,t:111};
 const r=bus.publish("T.SPY",input);
 assert.equal(r.accepted,true);assert.equal(r.subscribersNotified,2);
 assert.equal(seenA[0].sequence,seenB[0].sequence);
 offA();bus.publish("T.SPY",input);assert.equal(seenA.length,1);assert.equal(seenB.length,2);
});
test("QQQ, SPY, and direct VIX are isolated topics",()=>{
 const bus=createSharedMarketEventBus();let q=0,v=0;
 bus.subscribe("T.QQQ",()=>q++);bus.subscribe("V.I:VIX",()=>v++);
 bus.publish("T.SPY",{ev:"T",sym:"SPY",p:1});
 bus.publish("T.QQQ",{ev:"T",sym:"QQQ",p:2});
 bus.publish("V.I:VIX",{ev:"V",T:"I:VIX",val:20});
 assert.equal(q,1);assert.equal(v,1);
 assert.equal(bus.publish("T.QQQ",{ev:"T",sym:"SPY",p:2}).accepted,false);
 assert.equal(bus.publish("V.I:VIX",{ev:"T",sym:"QQQ",p:20}).accepted,false);
});
test("listener failures cannot block other consumers",()=>{
 const bus=createSharedMarketEventBus();let delivered=0;
 bus.subscribe("T.QQQ",()=>{throw Error("CLIENT_FAULT")});
 bus.subscribe("T.QQQ",()=>delivered++);
 const r=bus.publish("T.QQQ",{ev:"T",sym:"QQQ",p:4});
 assert.equal(delivered,1);assert.equal(r.subscriberErrors,1);
});
test("bounded listeners and no network startup",()=>{
 const bus=createSharedMarketEventBus({maxListenersPerTopic:1});bus.subscribe("T.QQQ",()=>{});
 assert.throws(()=>bus.subscribe("T.QQQ",()=>{}),/MAX_LISTENERS/);
 assert.equal(bus.diagnostics().subscribers["T.QQQ"],1);
});
