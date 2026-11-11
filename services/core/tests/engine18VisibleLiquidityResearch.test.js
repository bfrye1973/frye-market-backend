import test from "node:test";
import assert from "node:assert/strict";
import { reconstructEngine18OrderBook } from "../logic/engine18/orderBookResearch.js";
import { assessEngine18Feed } from "../logic/engine18/rithmicFeedContract.js";
import { summarizeEngine18VisibleLiquidity } from "../logic/engine18/visibleLiquidityResearch.js";
const now=1794300000000,ts="1794300000000000000";
const events=[
 {action:"ADD",sequence:1,eventTimeNs:ts,contractSymbol:"ESZ26",orderId:"b",side:"BID",priceTicks:30000,quantity:50},
 {action:"ADD",sequence:2,eventTimeNs:ts,contractSymbol:"ESZ26",orderId:"a",side:"ASK",priceTicks:30001,quantity:100}
];
const feed=assessEngine18Feed({contractSymbol:"ESZ26",connected:true,authenticated:true,
 entitlementMbo:true,subscriptionActive:true,snapshotSeeded:true,sequenceContinuous:true,
 marketOpen:true,lastMarketEventUnixMs:now-200,nowUnixMs:now});
test("liquidity levels are relative depth, not fabricated target probabilities",()=>{
 const book=reconstructEngine18OrderBook({events,contractSymbol:"ESZ26",seeded:true});
 const r=summarizeEngine18VisibleLiquidity({book,feed,currentPrice:7500.125});
 assert.equal(r.usable,true);
 assert.equal(r.calibratedProbability,false);
 assert.equal(r.levels[0].side,"ASK");
 assert.equal(r.levels[0].quantity,100);
 assert.equal(r.levels[0].relativeDepth,1);
 assert.equal(r.levels[0].isHiddenStopEvidence,false);
});
test("missing entitlement, crossed book, or gapped book fails closed",()=>{
 const book=reconstructEngine18OrderBook({events,contractSymbol:"ESZ26",seeded:true});
 assert.equal(summarizeEngine18VisibleLiquidity({book,feed:{...feed,liquidityDataUsable:false},currentPrice:7500}).usable,false);
 assert.equal(summarizeEngine18VisibleLiquidity({book:{...book,crossedBook:true},feed,currentPrice:7500}).usable,false);
 assert.equal(summarizeEngine18VisibleLiquidity({book:{...book,gapDetected:true},feed,currentPrice:7500}).usable,false);
 assert.throws(()=>summarizeEngine18VisibleLiquidity({book,feed:{...feed,contractSymbol:"ESH27"},currentPrice:7500}),/BASIS_MISMATCH/);
});
