import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine27CrossMarketSourceV1} from "../jobs/buildEngine27CrossMarketSourceV1.js";
const now=new Date("2026-10-24T19:00:00Z");
const fake=async ({symbol,from,to})=>({ok:true,symbol,from,to,bars:Array.from({length:16},(_,i)=>({
 time:Date.parse("2026-10-06T00:00:00Z")+i*86400000,
 high:symbol==="QQQ"?715+(i%3):20+(i%3)*0.2,
 low:symbol==="QQQ"?700+(i%3):18.9+(i%3)*0.2,
 close:symbol==="QQQ"?704+(i%3):19.2+(i%3)*0.2
}))});
test("source adapter uses real instrument identities and completed past daily bars only",async ()=>{
 const queries=[];const result=await buildEngine27CrossMarketSourceV1({apiKey:"TEST_ONLY",now,fetchBars:async p=>{queries.push(p);return fake(p);}});
 assert.deepEqual(queries.map(q=>q.symbol),["QQQ","I:VIX"]);
 assert.ok(queries.every(q=>q.adjusted===false&&q.to==="2026-10-23"));
 assert.equal(result.instruments.QQQ.available,true);
 assert.equal(result.instruments.VIX.available,true);
 assert.equal(result.instruments.VIX.sourceSymbol,"I:VIX");
 assert.equal(result.noExecution,true);
});
test("independent VIX provider failure does not invent VIX zones or remove QQQ",async ()=>{
 const out=await buildEngine27CrossMarketSourceV1({apiKey:"TEST_ONLY",now,fetchBars:async p=>p.symbol==="I:VIX"?Promise.reject(Error("Unavailable")):fake(p)});
 assert.equal(out.instruments.QQQ.available,true);
 assert.equal(out.instruments.VIX.available,false);
 assert.deepEqual(out.instruments.VIX.reasonCodes,["SOURCE_FETCH_FAILED"]);
});
test("missing API key fails closed without network",async ()=>{
 const out=await buildEngine27CrossMarketSourceV1({now,fetchBars:()=>{throw Error("should not call");}});
 assert.deepEqual(out.reasonCodes,["API_KEY_OR_TIME_UNAVAILABLE"]);
});
