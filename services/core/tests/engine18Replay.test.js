import test from "node:test";
import assert from "node:assert/strict";
import { replayEngine18History } from "../logic/engine18/replayEngine18History.js";

const start=1794240000,tf=300;
const prices=[100,101,100,101,100,101,100,101,100,101,100,101];
const bars=prices.map((p,i)=>({
  time:start+i*tf,open:p,high:i===4?105:p+1,low:p-1,
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
 assert.deepEqual(partial.signals,full.signals.filter(s=>s.eventTimeUnixSec<start+(bars.length-1)*tf).map(s=>{
   // The previous output can differ only in ex-post scoring if last bar disappears.
   return { ...s, evaluated: s.eventTimeUnixSec < start+(bars.length-3)*tf && s.evaluated,
     futureClose: s.eventTimeUnixSec < start+(bars.length-3)*tf ? s.futureClose : null,
     signedMovePoints: s.eventTimeUnixSec < start+(bars.length-3)*tf ? s.signedMovePoints : null,
     favorableAtHorizon: s.eventTimeUnixSec < start+(bars.length-3)*tf ? s.favorableAtHorizon : null,
     againstAtHorizon: s.eventTimeUnixSec < start+(bars.length-3)*tf ? s.againstAtHorizon : null };
 }));
});
