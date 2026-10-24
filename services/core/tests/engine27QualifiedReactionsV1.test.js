import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine27QualifiedReactionsV1 as build} from "../jobs/buildEngine27QualifiedReactionsV1.js";
const now=new Date("2026-10-23T20:40:00Z");
const rows=[
 {time:Date.parse("2026-10-23T20:00:00Z"),open:698,high:700,low:697,close:698},
 {time:Date.parse("2026-10-23T20:10:00Z"),open:699,high:702,low:698,close:699},
 {time:Date.parse("2026-10-23T20:20:00Z"),open:700,high:705,low:699,close:699},
 {time:Date.parse("2026-10-23T20:30:00Z"),open:704,high:709,low:703,close:708}
];
test("a completed QQQ candle confirms reclaim, forming last bar excluded",async()=>{
 const p=[];
 const out=await build({symbol:"QQQ",zones:[{id:"700",low:700,high:703}],now,apiKey:"TEST",
 fetchAggregates:async args=>{p.push(args);return {ok:true,symbol:"QQQ",bars:rows};}});
 assert.equal(out.state,"EVENTS_OBSERVED");
 assert.equal(out.events[0].event,"RECLAIM_CONFIRMED");
 assert.equal(out.completedBars,4);
 assert.equal(out.noExecution,true);
 assert.equal(p[0].timespan,"minute");
});
test("forming bar cannot create a reclaim",async()=>{
 const at=new Date("2026-10-23T20:34:00Z");
 const out=await build({symbol:"QQQ",zones:[{low:700,high:703}],now:at,apiKey:"TEST",
 fetchAggregates:async()=>({ok:true,symbol:"QQQ",bars:rows})});
 assert.equal(out.events.some(x=>x.time==="2026-10-23T20:30:00.000Z"),false);
});
test("index proxy and wrong provider identity fail closed",async()=>{
 const shared={zones:[{low:19,high:20}],now,apiKey:"TEST"};
 assert.equal((await build({...shared,symbol:"UVXY"})).state,"UNAVAILABLE");
 const out=await build({...shared,symbol:"I:VIX",fetchAggregates:async()=>({ok:true,symbol:"UVXY",bars:rows})});
 assert.equal(out.state,"UNAVAILABLE");
 assert.deepEqual(out.reasonCodes,["SOURCE_IDENTITY_OR_DATA_INVALID"]);
});
test("missing API key fails without fetch",async()=>{
 const out=await build({symbol:"QQQ",now,fetchAggregates:()=>{throw Error("must not call");}});
 assert.deepEqual(out.reasonCodes,["PROVIDER_NOT_CONFIGURED"]);
});
