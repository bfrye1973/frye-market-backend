import test from "node:test";
import assert from "node:assert/strict";
import { replayEngine18History } from "../logic/engine18/replayEngine18History.js";

const start=1794240000,tf=300;
const prices=[100,101,100,101,100,101,100,101,100,101,100,101];
const bars=prices.map((p,i)=>({
  time:start+i*tf,open:p,high:(i===4||i===11)?105:p+1,low:p-1,
  close:i===4?100:p,volume:10
}));
test("replay records only event-time data, then scores completed forward windows",()=>{
 const out=replayEngine18History({rows:bars,contractSymbol:"ESZ26",timeframeSeconds:300,
  lookback:3,horizonBars:2,asOfUnixSec:start+bars.length*tf});
 assert.equal(out.noExecution,true);
 assert.equal(out.actualMarketData,"UNVERIFIED_INPUT");
 assert.equal(out.provenanceVerified,false);
 assert.ok(out.signals.some(e=>e.type==="BUY_SIDE_SWEEP_CANDIDATE"));
 assert.ok(out.signals.every(e=>e.observedAfterCloseUnixSec===e.eventTimeUnixSec+300));
 assert.equal(out.summary.signals,out.signals.length);
 assert.ok(out.signals.some(e=>!e.evaluated));
 assert.ok(out.signals.filter(e=>!e.evaluated).every(e=>e.favorableAtHorizon===null));
});
test("unclosed candle is not used in replay",()=>{
 const full=replayEngine18History({rows:bars,contractSymbol:"ESZ26",timeframeSeconds:tf,
 lookback:3,horizonBars:2,asOfUnixSec:start+bars.length*tf});
 const partial=replayEngine18History({rows:bars,contractSymbol:"ESZ26",timeframeSeconds:tf,
 lookback:3,horizonBars:2,asOfUnixSec:start+(bars.length-1)*tf+100});
 assert.equal(partial.candles,full.candles-1);
 const completePast = x => x.eventTimeUnixSec < start+(bars.length-3)*tf;
 assert.deepEqual(
   partial.signals.map(({type,eventTimeUnixSec,liquidityLevel,direction,eventClose})=>({type,eventTimeUnixSec,liquidityLevel,direction,eventClose})),
   full.signals.filter(s=>s.eventTimeUnixSec<start+(bars.length-1)*tf)
     .map(({type,eventTimeUnixSec,liquidityLevel,direction,eventClose})=>({type,eventTimeUnixSec,liquidityLevel,direction,eventClose}))
 );
 for(const s of partial.signals){
   const before=full.signals.find(x=>x.type===s.type&&x.eventTimeUnixSec===s.eventTimeUnixSec);
   if(completePast(s)) assert.deepEqual(s,before);
   else assert.equal(s.evaluated,false);
 }
});

test("weekend or maintenance gaps cannot be scored as a continuous horizon",()=>{
 const gapBars=bars.map((b,i)=>({ ...b,
   high:i===8?108:b.high, close:i===8?100:b.close,
   time:i>=9?b.time+3600:b.time }));
 const out=replayEngine18History({rows:gapBars,contractSymbol:"ESZ26",timeframeSeconds:tf,
   lookback:3,horizonBars:2,asOfUnixSec:start+(bars.length+12)*tf});
 assert.ok(out.signals.some(s=>s.evaluationStatus==="SESSION_GAP"));
 assert.ok(out.signals.filter(s=>s.evaluationStatus==="SESSION_GAP").every(s=>!s.evaluated));
});
