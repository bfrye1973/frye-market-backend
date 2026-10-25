import test from "node:test";
import assert from "node:assert/strict";
import {observeLiveEs as run} from "../livePriceObserver/observeLiveEs.js";
const owner={version:"engine22.microCDownOwnerWatch.v1",activeWave:"C",direction:"DOWN",
 levels:[{key:"e236",price:7761.25,provisional:true},{key:"e382",price:7729.25,provisional:true}]};
const at="2026-10-25T22:31:25Z",s=Math.floor(Date.parse("2026-10-25T22:30:00Z")/1000);
const event={ok:true,type:"bar",symbol:"ES",resolvedSymbol:"ESZ26",tf:"10m",mode:"eth",
 bar:{time:s,open:7768,high:7770,low:7759,close:7760,volume:34}};
const base={owner,event,observedAt:at,expectedContract:"ESZ26"};
test("live bar gives immediate provisional touch only",()=>{const r=run(base);assert.equal(r.available,true);assert.equal(r.priceActionStatus,"PROVISIONAL_LEVEL_TOUCHED");assert.equal(r.provisionalTouches[0].key,"e236");assert.equal(r.confirmedWaveCompletion,false);assert.equal(r.lastCompletedCandle,null)});
test("live current price is not confirmed objective",()=>{const r=run(base);assert.equal(r.currentPrice,7760);assert.equal(r.confirmedFibObjective,null);assert.equal(r.noExecution,true)});
test("in-progress same candle never becomes completed",()=>{const p=run(base);const r=run({...base,previous:p,observedAt:"2026-10-25T22:35:00Z"});assert.equal(r.lastCompletedCandle,null)});
test("next bucket closes prior candle after end",()=>{const p=run(base);const next={...event,bar:{...event.bar,time:s+600,open:7755,high:7760,low:7750,close:7753}};const r=run({...base,previous:p,event:next,observedAt:"2026-10-25T22:41:00Z"});assert.equal(r.lastCompletedCandle.endTime,"2026-10-25T22:40:00.000Z");assert.equal(r.lastCompletedCandle.confirmation,"PRICE_TOUCH_NOT_WAVE_COMPLETION")});
test("reject wrong ES contract",()=>assert.equal(run({...base,event:{...event,resolvedSymbol:"ESH27"}}).state,"UNAVAILABLE"));
test("reject absent verified resolved contract",()=>assert.equal(run({...base,expectedContract:"ES"}).state,"UNAVAILABLE"));
test("reject wrong timeframe",()=>assert.equal(run({...base,event:{...event,tf:"1m"}}).state,"UNAVAILABLE"));
test("reject out-of-order bar",()=>{const p=run(base);const r=run({...base,previous:p,event:{...event,bar:{...event.bar,time:s-600}}});assert.equal(r.reasonCodes[0],"OUT_OF_ORDER_STREAM_BAR")});
test("reject milliseconds silently passed as seconds",()=>assert.equal(run({...base,event:{...event,bar:{...event.bar,time:s*1000}}}).state,"UNAVAILABLE"));
test("reject malformed OHLC",()=>assert.equal(run({...base,event:{...event,bar:{...event.bar,low:7790}}}).state,"UNAVAILABLE"));
test("reject stale event",()=>assert.equal(run({...base,observedAt:"2026-10-25T22:55:00Z"}).state,"UNAVAILABLE"));
test("rollover resets observer rather than mixing contracts",()=>{const p=run(base);const r=run({...base,previous:p,expectedContract:"ESH27",event:{...event,resolvedSymbol:"ESH27"}});assert.equal(r.reasonCodes[0],"CONTRACT_ROLLOVER_REQUIRES_RESET")});
test("owner model missing fails closed",()=>assert.equal(run({...base,owner:{...owner,version:"old"}}).state,"UNAVAILABLE"));
test("readonly and input immutable",()=>{const snapshot=structuredClone(event);run(base);assert.deepEqual(event,snapshot);assert.equal(run(base).noPermissionCreated,true)});
