import test from "node:test";
import assert from "node:assert/strict";
import { replayFibTouchHistoryV1 } from "../logic/engine22/research/replayFibTouchHistoryV1.js";
const level={degree:"subminute",countId:"count1",modelKey:"fib1",seriesId:"ESZ6",priceBasis:"RAW",
 key:"e1000",price:7800,direction:"UP",originAt:"2026-10-14T10:00:00Z"};
const bar=(id,time,high)=>({sourceBarId:id,sourceTimestamp:time,seriesId:"ESZ6",priceBasis:"RAW",
 low:7750,high,completed:true,eligible:true});
test("out-of-order replay retains earliest eligible touch",()=>{
 const bars=[bar("later","2026-10-14T10:30:00Z",7770),bar("hit","2026-10-14T10:10:00Z",7801),
 bar("early","2026-10-14T10:05:00Z",7790)];
 const a=replayFibTouchHistoryV1({level,observations:bars});
 const b=replayFibTouchHistoryV1({level,observations:[...bars].reverse()});
 assert.equal(a.status,"TOUCHED");assert.equal(a.firstTouchedBarId,"hit");
 assert.deepEqual(a,b);
});
test("duplicate bars do not double count",()=>{
 const b=bar("hit","2026-10-14T10:10:00Z",7800);
 const r=replayFibTouchHistoryV1({level,observations:[b,b]});
 assert.equal(r.evaluatedBars,1);assert.equal(r.status,"TOUCHED");
});
test("unverified source does not produce touched",()=>{
 const r=replayFibTouchHistoryV1({level,observations:[{...bar("x","2026-10-14T10:10:00Z",7810),eligible:false}]});
 assert.equal(r.status,"WATCH");
});
test("revision gets independent touch history",()=>{
 const b=bar("x","2026-10-14T10:10:00Z",7801);
 const initial=replayFibTouchHistoryV1({level,observations:[b]});
 const revised=replayFibTouchHistoryV1({level:{...level,price:7820,modelKey:"fib2"},observations:[b]});
 assert.equal(initial.status,"TOUCHED");assert.equal(revised.status,"WATCH");
});
