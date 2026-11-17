import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseObservedMbp10,coverageAt,analyzeObservedMbp10,COVERAGE} from '../logic/engine18/engine18ObservedMbp10Map.js';
const book=({cross=false,partial=false,zero=false,malformed=false}={})=>{
 const b=Array.from({length:10},(_,i)=>({l:i,t:1,s:1,p:5000-i*.25,o:2,sz:zero&&i===0?0:100-i}));
 const a=Array.from({length:10},(_,i)=>({l:i,t:1,s:2,p:5000.25+i*.25,o:4,sz:200-i}));
 if(cross)a[0].p=5000;
 if(partial)a.pop();
 if(malformed)b[2].sz=NaN;
 return {d:[{s:'TEST',b,a}]};
};
const record=(raw,seq,ms)=>({raw:JSON.stringify(raw),rawEncoding:'utf8',localSeq:seq,
 receivedMonoNs:String(BigInt(ms)*1000000n),statusCode:null});
test('valid strict 10x10, zero and out-of-coverage stay distinct',()=>{
 const x=parseObservedMbp10(book({zero:true}));
 assert.equal(x.state,'VALID');
 assert.equal(coverageAt(x,'bid',5000).state,COVERAGE.ZERO);
 assert.equal(coverageAt(x,'bid',4990).state,COVERAGE.OUT);
 assert.equal(coverageAt(x,'ask',5000.25).state,COVERAGE.QTY);
 assert.equal(coverageAt({state:'FEED_INVALID'},'bid',5000).state,COVERAGE.INVALID);
});
test('malformed, partial, crossed, unticked and unsorted frames fail closed',()=>{
 for(const opts of [{cross:true},{partial:true},{malformed:true}]){
  assert.equal(parseObservedMbp10(book(opts)).state,COVERAGE.INVALID);
 }
 const bad=book();bad.d[0].b[1].p=4999.9;
 assert.equal(parseObservedMbp10(bad).state,COVERAGE.INVALID);
 const unordered=book();unordered.d[0].a[1].p=5000.25;
 assert.equal(parseObservedMbp10(unordered).state,COVERAGE.INVALID);
 assert.equal(parseObservedMbp10('broken').state,COVERAGE.INVALID);
});
test('observed images do not carry forward absent levels or conflate size changes with execution',()=>{
 const first=book(),second=book();
 second.d[0].b=second.d[0].b.map(x=>({...x,p:x.p-.25,sz:x.sz+1}));
 second.d[0].a=second.d[0].a.map(x=>({...x,p:x.p+.25,sz:x.sz-2}));
 const out=analyzeObservedMbp10([record(first,1,100),record(second,2,120)]);
 assert.equal(out.summarySafe.depthFrames,2);
 assert.equal(out.summarySafe.validDepthFrames,2);
 assert.equal(out.summarySafe.distinctSidePriceCells,22);
 assert.equal(out.images[0].image.bids.length,10);
 assert.equal(coverageAt(out.images[1].image,'bid',5000).state,COVERAGE.OUT);
 assert.equal(out.summarySafe.previousLevelComparisons,18);
 assert.equal(out.summarySafe.consecutiveDisplayedIncrease,9);
 assert.equal(out.summarySafe.consecutiveDisplayedDecrease,9);
 assert.ok(out.summarySafe.topTwoBidConcentrations.length<=2);
});
test('invalid depth prevents carrying previous state into following frame',()=>{
 const first=book(),second=book();second.d[0].b[0].sz=110;
 const records=[record(first,1,100),record(book({partial:true}),2,200),record(second,3,300)];
 const out=analyzeObservedMbp10(records);
 assert.equal(out.summarySafe.invalidDepthFrames,1);
 assert.equal(out.summarySafe.previousLevelComparisons,0);
 assert.equal(out.summarySafe.consecutiveDisplayedIncrease,0);
});
test('trade sq and quote cross-check diagnostics are descriptive and deterministic',()=>{
 const records=[
  record(book(),1,100),
  record({q:[{b:5000,bs:100,a:5000.25,as:200}]},2,102),
  record({tr:[{sq:6,is:true,clx:false},{sq:6,is:false,clx:false},
   {sq:9,is:true,clx:true}]},3,104),
  record(book(),4,110)
 ];
 const a=analyzeObservedMbp10(records),b=analyzeObservedMbp10(records);
 assert.equal(a.summarySafe.quoteBestPriceAgreement,1);
 assert.equal(a.summarySafe.quoteBestSizeAgreement,1);
 assert.equal(a.summarySafe.tradeSqDuplicates,1);
 assert.equal(a.summarySafe.tradeSqGaps,1);
 assert.equal(a.summarySafe.tradeItems,3);
 const sha=x=>createHash('sha256').update(JSON.stringify(x.summarySafe)).digest('hex');
 assert.equal(sha(a),sha(b));
 assert.equal(a.summarySafe.previousLevelComparisons,20);
});

test('GAP and DISCONNECTED invalidate continuity and quote comparisons until new depth',()=>{
 const prior=book(),following=book();following.d[0].b[0].sz+=10;
 const events=[record(prior,1,100),
  {localSeq:2,statusCode:'FEED_GAP',raw:'',receivedMonoNs:'150000000'},
  record({q:[{b:5000,bs:100,a:5000.25,as:200}]},3,155),
  record(following,4,160),
  {localSeq:5,statusCode:'DISCONNECTED',raw:'',receivedMonoNs:'170000000'},
  record(following,6,180)];
 const result=analyzeObservedMbp10(events);
 assert.equal(result.summarySafe.depthFrames,3);
 assert.equal(result.summarySafe.previousLevelComparisons,0);
 assert.equal(result.summarySafe.quoteCompared,0);
 assert.equal(result.summarySafe.consecutiveDisplayedIncrease,0);
 const cells=result.privateAbsoluteGrid.bid;
 assert.ok(cells.every(x=>x.observedCoverageMs===0),'no observed time spans disconnected segments');
});
test('malformed frame invalidates continuity rather than silently carrying forward',()=>{
 const good=book(),bad={d:[{s:'TEST',b:[],a:[]}]};
 const r=analyzeObservedMbp10([record(good,1,100),record(bad,2,110),record(good,3,120)]);
 assert.equal(r.summarySafe.invalidDepthFrames,1);
 assert.equal(r.summarySafe.previousLevelComparisons,0);
 assert.equal(r.summarySafe.quoteCompared,0);
});

test('same-rank baseline is descriptive and zero residual for unchanged images',()=>{
 const one=book(),two=book();
 const result=analyzeObservedMbp10([record(one,1,100),record(two,2,110)]);
 assert.equal(result.summarySafe.validDepthFrames,2);
 assert.equal(result.summarySafe.distinctSidePriceCells,20);
 for(const side of ['bid','ask']){
  assert.equal(result.privateAbsoluteGrid[side].length,10);
  for(const cell of result.privateAbsoluteGrid[side]){
   assert.equal(cell.timeWeightedResidualSz,0);
   assert.equal(cell.meanSampleResidualSz,0);
   assert.equal(cell.observedCoverageMs,10);
   assert.ok(cell.meanDistanceFromTouchTicks>=0);
  }
 }
 assert.deepEqual(result.summarySafe.topTwoBidConcentrations,[]);
 assert.deepEqual(result.summarySafe.topTwoAskConcentrations,[]);
});

test('top concentrations rank positive residual depth, not longest coverage',()=>{
 const one=book(),two=book(),three=book(),four=book();
 // A one-frame spike has positive residual against a 3-of-4 normal baseline.
 two.d[0].b[1].sz=500;
 two.d[0].a[1].sz=600;
 const result=analyzeObservedMbp10([record(one,1,100),record(two,2,110),record(three,3,120),record(four,4,130)]);
 assert.equal(result.summarySafe.topTwoBidConcentrations[0].maxSz,500);
 assert.equal(result.summarySafe.topTwoAskConcentrations[0].maxSz,600);
 assert.ok(result.summarySafe.topTwoBidConcentrations[0].timeWeightedResidualSz>0);
});
