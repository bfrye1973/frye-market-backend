import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEngine11ClosedBars } from "../logic/engine18/engine11ClosedBarsAdapter.js";
import { analyzeEngine18Candles } from "../logic/engine18/liquidityBaseline.js";
const start=1794240000, tf=300;
const rows=[
{time:start,open:100,high:101,low:99,close:100,volume:12},
{time:start+tf,open:100,high:102,low:99,close:101,volume:10},
{time:start+2*tf,open:101,high:101,low:99,close:100,volume:8},
{time:start+3*tf,open:100,high:102,low:99,close:101,volume:10},
{time:start+4*tf,open:101,high:103,low:100,close:100,volume:21}];
test("only closed 5m ES bars are forwarded; opening bar isn't future information",()=>{
 const a=normalizeEngine11ClosedBars(rows,{asOfUnixSec:start+4*tf+100,timeframeSeconds:tf,contractSymbol:"ESZ26"});
 assert.equal(a.bars.length,4);
 const b=normalizeEngine11ClosedBars(rows,{asOfUnixSec:start+5*tf,timeframeSeconds:tf,contractSymbol:"ESZ26"});
 assert.equal(b.bars.length,5);
 const r=analyzeEngine18Candles({bars:b.bars,lookback:4,contractSymbol:b.contractSymbol});
 assert.equal(r.latestEvent?.type,"BUY_SIDE_SWEEP_CANDIDATE");
 assert.equal(r.contractSymbol,"ESZ26");
});
test("rejects ambiguous rollover contract, invalid clocks and duplicate timestamps",()=>{
 const args={asOfUnixSec:start+5*tf,timeframeSeconds:tf,contractSymbol:"ESZ26"};
 assert.throws(()=>normalizeEngine11ClosedBars(rows,{...args,contractSymbol:"ES"}),/EXPLICIT_ES_CONTRACT/);
 assert.throws(()=>normalizeEngine11ClosedBars(rows,{...args,timeframeSeconds:0}),/TIMEFRAME_REQUIRED/);
 assert.throws(()=>normalizeEngine11ClosedBars([rows[0],rows[0]],args),/DUPLICATE_OR_UNSORTED/);
});
