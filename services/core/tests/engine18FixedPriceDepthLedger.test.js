import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine18Level2ZoneReader,parseIronbeamV2DepthFrame} from '../logic/engine18/ironbeamV2Level2Zones.js';
import {createEngine18FixedPriceLedger} from '../logic/engine18/engine18FixedPriceDepthLedger.js';
const SYMBOL='XCME:ES.Z26',T0=1795000000000;
const frame=(t,{bid=7500,big=125,small=15,ask=7500.25,zero=null}={})=>({
 d:{s:SYMBOL,b:[
  {l:0,t,s:'B',p:bid,o:8,sz:big},
  {l:1,t,s:'B',p:bid-.25,o:2,sz:zero==='bid'?0:small}],
 a:[
  {l:0,t,s:'A',p:ask,o:7,sz:105},
  {l:1,t,s:'A',p:ask+.25,o:1,sz:zero==='ask'?0:10}]}
});
test('price-anchored candidate needs distinct actual frames and >=30 seconds of covered elapsed time',()=>{
 const r=createEngine18Level2ZoneReader({minObservations:3,minDurationMs:30000,
  maxFrameGapMs:10000});
 for(let i=0;i<6;i++){
  const t=T0+i*5000;
  const x=frame(t,{big:125+i});
  assert.equal(r.observe(x,{receivedAtMs:t}).accepted,true);
 }
 let s=r.snapshot({nowMs:T0+25001,feedTier:'UNVERIFIED'});
 assert.equal(s.zones.length,0);
 assert.equal(s.diagnostics.noCandidateReason,'INSUFFICIENT_COVERED_ELAPSED_TIME');
 const t=T0+30000;
 r.observe(frame(t,{big:132}),{receivedAtMs:t});
 s=r.snapshot({nowMs:t+10,feedTier:'UNVERIFIED'});
 const b=s.zones.find(z=>z.side==='BID'&&z.price===7500);
 assert.ok(b);
 assert.equal(b.observedPersistenceMs,30000);
 assert.equal(b.observedInImages,7);
 assert.equal(b.currentlyInBook,true);
 assert.equal(b.coverageState,'IN_COVERAGE');
 assert.equal(b.currentRestingLiquidityVerified,true);
 assert.equal(s.diagnostics.elapsedBasis,'HOST_RECEIVED_MONOTONICITY_UNVERIFIED');
});
test('when fixed price leaves moving MBP ladder, it is historical only, NOT resting',()=>{
 const r=createEngine18Level2ZoneReader({minObservations:3,minDurationMs:30000});
 for(let i=0;i<7;i++){
  const t=T0+i*5000;
  r.observe(frame(t,{big:125+i}),{receivedAtMs:t});
 }
 let s=r.snapshot({nowMs:T0+30010});
 assert.ok(s.zones.some(z=>z.price===7500&&z.side==='BID'));
 const shift=T0+35000;
 r.observe(frame(shift,{bid:7501,big:400,small:45,ask:7501.25}),{receivedAtMs:shift});
 s=r.snapshot({nowMs:shift+1});
 assert.equal(s.zones.some(z=>z.price===7500&&z.side==='BID'),false);
 assert.ok(s.diagnostics.historicalQualifiedPrices>=1);
 assert.ok(s.diagnostics.lastSeenButOutOfCoverage>=1);
 assert.equal(s.diagnostics.noCandidateReason,'QUALIFIED_LEVELS_NOT_IN_CURRENT_BOOK');
 // Reappearing positive depth does not retroactively fill the uncovered interval.
 r.observe(frame(shift+5000,{big:135}),{receivedAtMs:shift+5000});
 s=r.snapshot({nowMs:shift+5001});
 assert.equal(s.zones.some(z=>z.side==='BID'&&z.price===7500),false,
  'one returning book image must not inherit the prior 30-second persistence');
 for(let i=1;i<=6;i++){
  const t=shift+5000+i*5000;
  r.observe(frame(t,{big:135+i}),{receivedAtMs:t});
 }
 s=r.snapshot({nowMs:shift+35001});
 const b=s.zones.find(z=>z.side==='BID'&&z.price===7500);
 assert.ok(b);
 assert.equal(b.observedPersistenceMs,30000);
 assert.ok(b.cumulativeCoveredMs>=60000);
 assert.equal(b.visibleContracts,141);
});
test('large temporal gap cannot be counted as resting-time persistence',()=>{
 const r=createEngine18Level2ZoneReader({minObservations:3,minDurationMs:30000});
 for(let i=0;i<3;i++){
  const t=T0+i*5000;
  r.observe(frame(t,{big:100+i}),{receivedAtMs:t});
 }
 const t=T0+90000;
 r.observe(frame(t,{big:120}),{receivedAtMs:t});
 assert.equal(r.snapshot({nowMs:t+1}).zones.length,0);
 assert.equal(r.snapshot({nowMs:t+1}).diagnostics.noCandidateReason,
 'INSUFFICIENT_COVERED_ELAPSED_TIME');
});
test('literal sz=0 is observed zero, missing within depth is UNKNOWN not depletion',()=>{
 const a=parseIronbeamV2DepthFrame(frame(T0,{zero:'bid'}));
 assert.equal(a.ok,true);
 assert.equal(a.zeroLevels.length,1);
 const ledger=createEngine18FixedPriceLedger({symbol:SYMBOL,minImages:1,minDurationMs:0});
 ledger.observe(a,T0);
 let d=ledger.snapshot({nowMs:T0+1});
 assert.equal(d.diagnostics.explicitZeroPrices,1);
 assert.equal(d.diagnostics.outOfCoveragePrices,0);
 // A later image covering a different price range never means the old level is size 0.
 ledger.observe(parseIronbeamV2DepthFrame(frame(T0+1000,{bid:7501,ask:7501.25})),T0+1000);
 d=ledger.snapshot({nowMs:T0+1001});
 assert.equal(d.diagnostics.explicitZeroPrices,0);
 assert.ok(d.diagnostics.outOfCoveragePrices>=1);
});
test('invalid source and reconnect reset unverified continuity and active zone display',()=>{
 const ledger=createEngine18FixedPriceLedger({symbol:SYMBOL,minImages:1,minDurationMs:0});
 ledger.observe(parseIronbeamV2DepthFrame(frame(T0)),T0);
 ledger.invalidate();
 const d=ledger.snapshot({nowMs:T0+1});
 assert.equal(d.zones.length,0);
 assert.ok(d.diagnostics.unknownPrices>0);
 assert.equal(d.diagnostics.lastValidDepthAgeMs,null);
});
test('no duplicate image can fake 30-second longevity',()=>{
 const r=createEngine18Level2ZoneReader({minObservations:2,minDurationMs:30000});
 assert.equal(r.observe(frame(T0),{receivedAtMs:T0}).accepted,true);
 assert.equal(r.observe(frame(T0),{receivedAtMs:T0+1000}).reason,'UNCHANGED_DEPTH');
 const s=r.snapshot({nowMs:T0+1002});
 assert.equal(s.zones.length,0);
});

test('strong historical size does not qualify currently weak depth at same price',()=>{
 const r=createEngine18Level2ZoneReader({minObservations:3,minDurationMs:30000});
 for(let i=0;i<7;i++){
  const t=T0+i*5000;
  r.observe(frame(t,{big:125+i}),{receivedAtMs:t});
 }
 let snap=r.snapshot({nowMs:T0+30001});
 assert.ok(snap.zones.some(z=>z.side==='BID'&&z.price===7500));
 // A new continuous price interval can still be visible but no longer a concentration.
 for(let i=1;i<=7;i++){
  const t=T0+30000+i*5000;
  r.observe(frame(t,{big:20+i}),{receivedAtMs:t});
 }
 snap=r.snapshot({nowMs:T0+65001});
 assert.equal(snap.zones.some(z=>z.side==='BID'&&z.price===7500),false);
 assert.equal(snap.diagnostics.activeObservedPrices>0,true);
});
