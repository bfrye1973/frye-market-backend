import test from "node:test";
import assert from "node:assert/strict";
import {fetchBoundedWaveCandles} from "../waveObservation/fetchBoundedWaveCandles.js";
const fromUtc="2026-10-28T20:00:00Z",toUtc="2026-10-28T20:04:00Z";
const bars=[{time:Date.parse("2026-10-28T20:01:00Z")/1000,open:7800.75,high:7819.5,low:7799.75,close:7805.25,volume:13125},
 {time:Date.parse("2026-10-28T19:01:00Z")/1000,open:7700,high:7701,low:7699,close:7700,volume:1}];
test("bounded source preserves provider contract but not Replay lineage",async()=>{
 let url;
 const request=async u=>{url=u;return {ok:true,json:async()=>({ok:true,resolvedSymbol:"ESZ6",
   requestedSymbol:"ES",bars})}};
 const r=await fetchBoundedWaveCandles({timeframe:"1m",fromUtc,toUtc,request});
 assert.equal(r.available,true);assert.equal(r.bars.length,1);
 assert.equal(r.bars[0].high,7819.5);
 assert.equal(r.originalReplayContractMatch,"UNVERIFIED");
 assert.match(url,/debug=1/);
});
test("rejects excessive windows and unauthorized origins before any fetch",async()=>{
 let calls=0;const request=async()=>{calls++;throw Error("should not call")};
 assert.equal((await fetchBoundedWaveCandles({timeframe:"1m",fromUtc,toUtc:"2026-10-29T00:00:00Z",request})).available,false);
 assert.equal((await fetchBoundedWaveCandles({timeframe:"1m",fromUtc,toUtc,origin:"https://untrusted.example",request})).available,false);
 assert.equal(calls,0);
});
test("missing resolved physical contract fails closed",async()=>{
 const request=async()=>({ok:true,json:async()=>({ok:true,bars,resolvedSymbol:null})});
 assert.equal((await fetchBoundedWaveCandles({timeframe:"1m",fromUtc,toUtc,request})).reason,
  "BACKEND_OHLC_CONTRACT_OR_BARS_UNVERIFIED");
});
