import test from "node:test";import assert from "node:assert/strict";
import {detectEngine27ZoneReactionsV1 as detect} from "../logic/engine27/crossMarket/detectZoneReactionsV1.js";
const make=(close,low,high,time)=>({open:close,close,low,high,time,completed:true});
const zones=[{id:"Z1",low:700,high:703}];
test("two completed QQQ candles document a reclaim without trading permission",()=>{
 const out=detect({symbol:"QQQ",source:"QQQ_10M",zones,candles:[
 make(698,697,700,"2026-10-23T12:00:00Z"),make(699,698,702,"2026-10-23T12:10:00Z"),
 make(704,699,705,"2026-10-23T12:20:00Z")]});
 assert.equal(out.events[0].event,"RECLAIM_CONFIRMED");assert.equal(out.noExecution,true);
});
test("incomplete candles and missing history fail closed",()=>{
 const candles=[make(704,701,705,"2026-10-23T12:00:00Z")];
 assert.equal(detect({symbol:"QQQ",source:"S",zones,candles}).state,"UNAVAILABLE");
 assert.equal(detect({symbol:"ES",source:"S",zones,candles:[...candles,...candles,...candles]}).state,"UNAVAILABLE");
});
test("ordinary proximity cannot trigger a confirmation",()=>{
 const out=detect({symbol:"I:VIX",source:"DIRECT_VIX",zones:[{low:19,high:20}],
 candles:[make(19.45,19.2,19.7,"2026-10-23T12:00:00Z"),make(19.4,19.1,19.7,"2026-10-23T12:10:00Z"),make(19.5,19.2,19.6,"2026-10-23T12:20:00Z")]});
 assert.equal(out.state,"NO_QUALIFIED_EVENT");
});
