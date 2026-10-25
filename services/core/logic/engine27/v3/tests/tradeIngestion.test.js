import test from "node:test";
import assert from "node:assert/strict";
import {initialTradeIngestion,reduceTradeIngestion as reduce} from "../livePriceObserver/reduceTradeIngestion.js";
import {createMicroTradeConsumer} from "../livePriceObserver/createMicroTradeConsumer.js";
const at="2026-10-25T23:00:56.050Z";
const owner={version:"engine22.microCDownOwnerWatch.v1",activeWave:"C",direction:"DOWN",parentDegree:"subminute",parentWave:"C",
 levels:[{key:"e236",price:7761.25,provisional:true},{key:"e382",price:7729.25,provisional:true}]};
const snapshot={symbol:"ES",now:at,strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{currentWavelength:{degrees:{micro:{ownerMicroCDown:owner},submicro:{ownerSubmicroCDown:{version:"engine22.submicroCDownOwnerWatch.v1",direction:"DOWN",activeWave:"C",parentDegree:"micro",parentWave:"C"}},subminute:{ownerCurrentCDown:{version:"engine22.subminuteCurrentCDownReference.v1",direction:"DOWN",activeWave:"C",parentDegree:"minute",parentWave:"W2"}}}}}}}};
const trade=(q="1",price=7762,tradeTime=at)=>({ok:true,type:"trade",source:"POLYGON_DIRECT_ES_TRADE",symbol:"ES",resolvedSymbol:"ESZ6",eventId:q,price,size:2,tradeTime});
const connected=()=>reduce(initialTradeIngestion(),{type:"CONNECTED",contract:"ESZ6"});
const accept=(s,event,receivedAt=at)=>reduce(s,{type:"TRADE",event,receivedAt,owner});
test("connected source accepts trade and keeps bounded trade ID memory",()=>{let s=connected();for(let i=0;i<300;i++)s=accept(s,trade(String(i)),at);assert.equal(s.recentEventIds.length,256);assert.equal(s.accepted,300)});
test("duplicate sequence suppressed before manager",()=>{let s=accept(connected(),trade("8"));const next=accept(s,trade("8"));assert.equal(next.accepted,1);assert.deepEqual(next.reasonCodes,["DUPLICATE_PROVIDER_TRADE_ID"])});
test("same price and size, different q is legitimate trade",()=>{let s=accept(connected(),trade("8"));s=accept(s,trade("9"));assert.equal(s.accepted,2)});
test("out of order timestamps rejected",()=>{let s=accept(connected(),trade("8"));s=accept(s,trade("9",7760,"2026-10-25T23:00:55.000Z"));assert.deepEqual(s.reasonCodes,["OUT_OF_ORDER_TRADE"])});
test("wrong physical contract rejected",()=>assert.equal(accept(connected(),{...trade(),resolvedSymbol:"ESH7"}).accepted,0));
test("disconnect clears price continuity and deauthorizes old observation",()=>{const s=accept(connected(),trade());const d=reduce(s,{type:"DISCONNECTED"});assert.equal(d.previousObservation,null);assert.equal(d.status,"DISCONNECTED");assert.equal(d.lastTradeAt,null)});
test("reconnect requires fresh contract declaration",()=>{const disconnected=reduce(accept(connected(),trade()),{type:"RECONNECTING"});assert.equal(accept(disconnected,trade()).accepted,1);const fresh=reduce(disconnected,{type:"CONNECTED",contract:"ESH7"});assert.equal(fresh.contract,"ESH7");assert.equal(fresh.previousObservation,null)});
test("long observational gap fails closed",()=>{const s=accept(connected(),trade());const x=accept(s,trade("9",7760,"2026-10-25T23:01:30.000Z"),"2026-10-25T23:01:30.050Z");assert.equal(x.status,"STALE");assert.equal(x.previousObservation,null)});
test("stale lifecycle independently clears cached data",()=>{const s=reduce(connected(),{type:"STALE"});assert.equal(s.status,"STALE");assert.equal(s.reasonCodes[0],"SOURCE_STALE")});
test("consumer passes sequential trade observations to Micro manager without orders",()=>{
 const observations=[];const consumer=createMicroTradeConsumer({readInputs:()=>({snapshot}),onObservation:x=>observations.push(x)});
 consumer.connect("ESZ6");
 const one=consumer.ingest(trade("1"),at);
 const two=consumer.ingest(trade("2",7760,"2026-10-25T23:00:56.080Z"),"2026-10-25T23:00:56.100Z");
 assert.equal(one.accepted,true);assert.equal(two.accepted,true);assert.equal(observations.length,2);
 assert.equal(two.intelligence.modules.priceActionFib.state,"UNCONFIRMED_TOUCH");
 assert.equal(two.intelligence.strategyAssessment.entryAuthorized,false);
 assert.equal(two.intelligence.noExecution,true);
});
test("consumer duplicate does not create another manager output",()=>{
 const observations=[];const c=createMicroTradeConsumer({readInputs:()=>({snapshot}),onObservation:x=>observations.push(x)});
 c.connect("ESZ6");c.ingest(trade("1"),at);const r=c.ingest(trade("1"),at);
 assert.equal(r.accepted,false);assert.equal(observations.length,1);
});

test("same-contract reconnect rejects duplicate replay but forgets crossed-price continuity",()=>{
 const a=accept(connected(),trade("18"));
 const d=reduce(a,{type:"DISCONNECTED"});
 const again=reduce(d,{type:"CONNECTED",contract:"ESZ6"});
 assert.equal(again.previousObservation,null);
 const duplicate=accept(again,trade("18"));
 assert.equal(duplicate.accepted,1);
 assert.equal(duplicate.reasonCodes[0],"DUPLICATE_PROVIDER_TRADE_ID");
 const b=accept(duplicate,trade("19",7760,"2026-10-25T23:00:56.080Z"),"2026-10-25T23:00:56.100Z");
 assert.equal(b.accepted,2);
 assert.equal(b.previousObservation.provisionalTouches.length,0);
});
test("rollover cannot reuse previous contract sequence memory",()=>{
 const a=accept(connected(),trade("18"));
 const next=reduce(reduce(a,{type:"DISCONNECTED"}),{type:"CONNECTED",contract:"ESH7"});
 assert.deepEqual(next.recentEventIds,[]);
 assert.equal(next.priorTradeWatermark,null);
});
