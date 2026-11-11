import test from "node:test";
import assert from "node:assert/strict";
import { reconstructEngine18OrderBook } from "../logic/engine18/orderBookResearch.js";
const t="1794240000123456789";
const b=(sequence,action,orderId,extra={})=>({sequence,action,orderId,contractSymbol:"ESZ26",eventTimeNs:t,...extra});
test("MBO order add/modify/fill/cancel reconstructs aggregate depth",()=>{
 const r=reconstructEngine18OrderBook({contractSymbol:"ESZ26",seeded:true,events:[
  b(10,"ADD","a",{side:"BID",priceTicks:30000,quantity:10}),
  b(11,"ADD","b",{side:"BID",priceTicks:30000,quantity:4}),
  b(12,"ADD","c",{side:"ASK",priceTicks:30001,quantity:7}),
  b(13,"FILL","a",{quantity:3}),
  b(14,"MODIFY","b",{quantity:8}),
  b(15,"CANCEL","c")
 ]});
 assert.equal(r.bids[0].quantity,15);
 assert.equal(r.bids[0].price,7500);
 assert.equal(r.asks.length,0);
 assert.equal(r.usableForLiquidityInference,true);
 assert.equal(r.lastEventTimeNs,t);
});
test("An unseeded or sequence-gapped book is not trusted",()=>{
 const events=[b(1,"ADD","a",{side:"BID",priceTicks:30000,quantity:10}),b(3,"FILL","a",{quantity:2})];
 assert.equal(reconstructEngine18OrderBook({events,contractSymbol:"ESZ26",seeded:true}).usableForLiquidityInference,false);
 assert.equal(reconstructEngine18OrderBook({events:events.slice(0,1),contractSymbol:"ESZ26"}).usableForLiquidityInference,false);
});
test("rejects cross-contract data, sequence reversal, overfill, and unsafe numeric nanoseconds",()=>{
 const base=b(1,"ADD","a",{side:"BID",priceTicks:30000,quantity:10});
 assert.throws(()=>reconstructEngine18OrderBook({contractSymbol:"ESZ26",events:[{...base,contractSymbol:"ESH27"}]}),/CONTRACT_MISMATCH/);
 assert.throws(()=>reconstructEngine18OrderBook({contractSymbol:"ESZ26",events:[base,b(1,"FILL","a",{quantity:1})]}),/OUT_OF_ORDER/);
 assert.throws(()=>reconstructEngine18OrderBook({contractSymbol:"ESZ26",events:[base,b(2,"FILL","a",{quantity:11})]}),/INVALID_FILL/);
 assert.throws(()=>reconstructEngine18OrderBook({contractSymbol:"ESZ26",events:[{...base,eventTimeNs:Number(t)}]}),/CLOCK_OR_SEQUENCE/);
});
