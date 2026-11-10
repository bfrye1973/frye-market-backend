import test from "node:test";
import assert from "node:assert/strict";
import {makeIronbeamV3ReadOnlyClient,normalizeIronbeamDepth,
 normalizeIronbeamTrades,normalizeIronbeamEsSymbol} from "../logic/engine18/ironbeamV3ReadOnly.js";

const symbol="XCME:ES.Z26";
test("Ironbeam depth maps aggregate size and order count without claiming MBO",()=>{
 const d=normalizeIronbeamDepth({depths:[{exchSym:symbol,isSnapshot:true,
  bids:[{price:7500.00,size:75,orderCount:5,time:1794300000000}],
  asks:[{price:7500.25,size:90,orderCount:6,time:1794300000001}]}]},symbol);
 assert.equal(d.usable,true);
 assert.equal(d.levels[0].priceTicks,30000);
 assert.equal(d.levels[0].individualOrderIds,false);
 assert.equal(d.delayedStatus,"NOT_ATTESTED");
 assert.equal(d.noExecution,true);
});
test("Ironbeam trades retain aggressor-side distinction and epoch-ms timestamp",()=>{
 const t=normalizeIronbeamTrades({trades:[{exchSym:symbol,price:7500.25,size:4,
  aggressorSide:1,sendTime:1794300000100,sequenceNumber:42}]},symbol);
 assert.equal(t[0].aggressorSide,"BUY");
 assert.equal(t[0].sendTimeUnixMs,1794300000100);
});
test("missing and crossed depth fail closed",()=>{
 assert.equal(normalizeIronbeamDepth({depths:[]},symbol).usable,false);
 assert.equal(normalizeIronbeamDepth({depths:[{exchSym:symbol,bids:[{price:7501,size:5,orderCount:1,time:1794300000000}],asks:[{price:7500,size:5,orderCount:1,time:1794300000000}]}]},symbol).usable,false);
 assert.throws(()=>normalizeIronbeamEsSymbol("NQ.Z26"),/INVALID_ES_SYMBOL/);
});
test("HTTP client only permits auth and GET market-data routes; secrets never returned",async()=>{
 const calls=[];
 const fake=async(url,opts)=>{
  calls.push({url,method:opts.method,body:opts.body||null,authorization:opts.headers?.Authorization||null});
  return {ok:true,json:async()=>String(url).endsWith("/v3/auth/login")?{status:"OK",token:"PRIVATE_JWT"}:{status:"OK",depths:[]}};
 };
 const c=makeIronbeamV3ReadOnlyClient({apiKey:"PRIVATE_API_KEY",fetchImpl:fake});
 assert.deepEqual(await c.authenticate(),{authenticated:true});
 await c.getDepth(symbol);
 assert.equal(calls.length,2);
 assert.equal(calls[0].method,"POST");
 assert.equal(calls[1].method,"GET");
 assert.equal(calls[1].authorization,"Bearer PRIVATE_JWT");
 assert.equal(typeof c.placeOrder,"undefined");
 assert.equal(JSON.stringify(c).includes("PRIVATE_API_KEY"),false);
});
