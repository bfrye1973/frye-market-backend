import test from "node:test";
import assert from "node:assert/strict";
import {createCandleRequestGate} from "../waveObservation/createCandleRequestGate.js";
import {createWaveEvidenceEnricher} from "../waveObservation/createWaveEvidenceEnricher.js";
test("rate gate permits only two requests per minute, enforces spacing, and resets",async()=>{
 let clock=100000,called=0;
 const g=createCandleRequestGate({maxPerMinute:2,minSpacingMs:15000,now:()=>clock});
 const run=()=>g.execute(async()=>{called++;return {available:true}});
 assert.equal((await run()).available,true);
 clock+=1000;assert.equal((await run()).reason,"CANDLE_REQUEST_BACKPRESSURE");
 clock+=15000;assert.equal((await run()).available,true);
 clock+=15000;assert.equal((await run()).reason,"CANDLE_REQUEST_BACKPRESSURE");
 clock+=60000;assert.equal((await run()).available,true);
 assert.equal(called,3);
});
test("one worker never starts concurrent remote candle calls",async()=>{
 let release;
 const g=createCandleRequestGate({maxPerMinute:2,minSpacingMs:0});
 const first=g.execute(()=>new Promise(resolve=>{release=resolve}));
 const second=await g.execute(async()=>({available:true}));
 assert.equal(second.reason,"CANDLE_REQUEST_BACKPRESSURE");
 release({available:true});await first;
});
