import test from "node:test";
import assert from "node:assert/strict";
import {normalizeEngine27V3EsTrade as normalize, inspectEngine27V3EsTrade as inspect} from "../../../../../streamer/routes/engine27V3TradeContract.js";
const at="2026-10-25T23:00:56.050Z";
const base={ev:"T",sym:"ESZ6",p:7686.25,s:2,t:Date.parse(at),q:32599300};
test("normalize actual polygon futures T event into trade-only contract",()=>{
 const r=normalize(base,{resolvedSymbol:"ESZ6",observedAt:at});
 assert.equal(r.type,"trade");assert.equal(r.source,"POLYGON_DIRECT_ES_TRADE");assert.equal(r.price,7686.25);
 assert.equal(r.resolvedSymbol,"ESZ6");assert.equal(r.readOnly,true);
});
test("rejects bar aggregates",()=>assert.equal(normalize({...base,ev:"AM"},{resolvedSymbol:"ESZ6",observedAt:at}),null));
test("rejects mismatched futures contract",()=>assert.equal(normalize({...base,sym:"ESH7"},{resolvedSymbol:"ESZ6",observedAt:at}),null));
test("rejects unqualified timestamp",()=>assert.equal(normalize({...base,t:null},{resolvedSymbol:"ESZ6",observedAt:at}),null));
test("rejects stale provider trades",()=>assert.equal(normalize({...base,t:Date.parse(at)-40000},{resolvedSymbol:"ESZ6",observedAt:at}),null));
test("rejects zero size",()=>assert.equal(normalize({...base,s:0},{resolvedSymbol:"ESZ6",observedAt:at}),null));
test("rejects future events",()=>assert.equal(normalize({...base,t:Date.parse(at)+120000},{resolvedSymbol:"ESZ6",observedAt:at}),null));

test("futures websocket nanoseconds cannot pass as milliseconds",()=>assert.equal(normalize({...base,t:Date.parse(at)*1000000},{resolvedSymbol:"ESZ6",observedAt:at}),null));
test("missing provider q sequence rejected",()=>assert.equal(normalize({...base,q:undefined},{resolvedSymbol:"ESZ6",observedAt:at}),null));
test("sequence passed without exposing credentials",()=>{const r=normalize(base,{resolvedSymbol:"ESZ6",observedAt:at});assert.equal(r.eventId,"32599300");assert.equal(Object.hasOwn(r,"apiKey"),false)});

test("rejects wrong trade price with typed reason and no source fields",()=>{
 const r=inspect({...base,p:"7686.25"},{resolvedSymbol:"ESZ6",observedAt:at});
 assert.equal(r.reasonCode,"INVALID_FUTURES_TRADE_PRICE");
 assert.equal(r.shape.priceType,"string");
 assert.equal(Object.hasOwn(r,"trade"),false);
 assert.equal(Object.hasOwn(r.shape,"price"),false);
});
test("invalid futures trade size distinguishes field types",()=>{
 const r=inspect({...base,s:"2"},{resolvedSymbol:"ESZ6",observedAt:at});
 assert.equal(r.reasonCode,"INVALID_FUTURES_TRADE_SIZE");
 assert.equal(r.shape.sizeType,"string");
});
test("invalid sequence has dedicated reason code",()=>{
 const r=inspect({...base,q:"42"},{resolvedSymbol:"ESZ6",observedAt:at});
 assert.equal(r.reasonCode,"INVALID_FUTURES_TRADE_SEQUENCE");
});
test("documented timestamp test rejects nanoseconds with reason",()=>{
 const r=inspect({...base,t:Date.parse(at)*1e6},{resolvedSymbol:"ESZ6",observedAt:at});
 assert.equal(r.reasonCode,"INVALID_FUTURES_TRADE_TIMESTAMP_MS");
});
test("future source trades remain unqualified with reason",()=>{
 const r=inspect({...base,t:Date.parse(at)+45000},{resolvedSymbol:"ESZ6",observedAt:at});
 assert.equal(r.reasonCode,"FUTURE_FUTURES_TRADE");
});
