import test from "node:test";
import assert from "node:assert/strict";
import {normalizeEngine27V3EsTrade as normalize} from "../../../../../streamer/routes/engine27V3TradeContract.js";
const at="2026-10-25T23:00:56.050Z";
const base={ev:"T",sym:"ESZ6",p:7686.25,s:2,t:Date.parse(at)*1000000};
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
