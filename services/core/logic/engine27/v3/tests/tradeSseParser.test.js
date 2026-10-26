import test from "node:test";import assert from "node:assert/strict";
import {createTradeSseParser} from "../livePriceObserver/parseTradeSse.js";
test("parser reassembles chunked JSON and ignores heartbeat",()=>{
 const p=createTradeSseParser();
 assert.equal(p.push("data: {\"type\":\"trade\"").events.length,0);
 let result=p.push(",\"price\":7700}\n\n:heartbeat\n\n");
 assert.equal(result.events[0].price,7700);assert.equal(result.events.length,1);
});
test("malformed JSON fails without fake trade",()=>assert.equal(createTradeSseParser().push("data: {bad}\n\n").error,"INVALID_SSE_JSON"));
test("oversize frame rejected",()=>assert.equal(createTradeSseParser({maxFrameBytes:20}).push("123456789012345678901").error,"SSE_FRAME_OVERSIZED"));
