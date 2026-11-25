import test from "node:test";import assert from "node:assert/strict";
import {buildEngine27LiveCrossMarketReactionsV1 as build} from "../jobs/buildEngine27LiveCrossMarketReactionsV1.js";
const now=new Date("2026-10-23T20:45:00Z");
const rows=[
 {time:Date.parse("2026-10-23T17:00:00Z"),open:698,high:700,low:697,close:698},
 {time:Date.parse("2026-10-23T18:00:00Z"),open:699,high:702,low:698,close:699},
 {time:Date.parse("2026-10-23T19:00:00Z"),open:700,high:705,low:699,close:704}
];
test("QQQ and direct VIX produce separate verified-source events",async()=>{
 const out=await build({now,apiKey:"TEST",levels:{instruments:{
 QQQ:{available:true,levels:[{low:700,high:703,type:"SUPPORT_CANDIDATE"}]},
 VIX:{available:true,levels:[{low:19,high:20,type:"RESISTANCE_CANDIDATE"}]}
 }},fetchAggregates:async({symbol})=>({ok:true,symbol,bars:symbol==="QQQ"?rows:rows.map(r=>({...r,open:19.4,high:19.8,low:19.2,close:19.4}))})});
 assert.equal(out.instruments.QQQ.events[0].event,"RECLAIM_CONFIRMED");
 assert.equal(out.instruments.VIX.state,"NO_QUALIFIED_EVENT");
 assert.equal(out.noExecution,true);
});
test("missing direct index feed has no proxy fallback",async()=>{
 const out=await build({now,apiKey:"TEST",levels:{instruments:{QQQ:{available:false},VIX:{available:false}}},fetchAggregates:()=>{throw Error("must not fetch")}});
 assert.equal(out.instruments.QQQ.state,"UNAVAILABLE");assert.equal(out.instruments.VIX.state,"UNAVAILABLE");
});
