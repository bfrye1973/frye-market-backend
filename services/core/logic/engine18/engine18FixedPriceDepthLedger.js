// Engine18 fixed-price MBP-10 evidence ledger. Offline / DEMO research only.
// A price leaving top-ten coverage is UNKNOWN, never a cancelled/zero resting order.
const KEY=(side,tick)=>side+':'+tick;
const MEDIAN=a=>{const b=[...a].sort((x,y)=>x-y),m=b.length>>1;return b.length?(b.length%2?b[m]:(b[m-1]+b[m])/2):null;};
const STATES=Object.freeze({COVERED:'IN_COVERAGE',OUT:'OUT_OF_COVERAGE',UNKNOWN:'UNKNOWN',ZERO:'OBSERVED_ZERO'});
export function createEngine18FixedPriceLedger({symbol,maxPrices=3000,maxElapsedMs=600000,
 maxFrameGapMs=10000,minDurationMs=30000,minImages=3,depthMultiplier=1.5}={}){
 if(!/^XCME:ES\.[HMUZ]\d{2}$/.test(symbol)||!Number.isInteger(maxPrices)||maxPrices<20||
 !Number.isFinite(maxFrameGapMs)||maxFrameGapMs<=0||!Number.isFinite(minDurationMs)||minDurationMs<0)
  throw Error('ENGINE18_BAD_LEDGER_CONFIG');
 const entries=new Map();let previous=null,frames=0,invalid=0,lastGoodReceiveMs=null;
 const fresh=()=>[...entries.values()];
 const coverage=(l,side,book)=>{
  const levels=side==='BID'?book.bids:book.asks;
  if(!levels.length)return STATES.UNKNOWN;
  if(l.priceTicks>Math.max(...levels.map(x=>x.priceTicks))||
     l.priceTicks<Math.min(...levels.map(x=>x.priceTicks)))return STATES.OUT;
  return STATES.UNKNOWN; // Missing interior tick is not proven removed in aggregated MBP.
 };
 function observe(book,receivedMs){
  if(!book?.ok||book.symbol!==symbol||!Number.isSafeInteger(receivedMs)||receivedMs<=0){
   invalid++;previous=null;for(const e of entries.values()){
   e.coverageState=STATES.UNKNOWN;e.currentContinuousMs=0;
   e.consecutiveObservations=0;
  }
   return;
  }
  frames++;lastGoodReceiveMs=receivedMs;
  const all=[...book.bids,...book.asks,...(book.zeroLevels||[])];
  const byKey=new Map(all.map(l=>[KEY(l.side,l.priceTicks),l]));
  const medians={BID:MEDIAN(book.bids.map(x=>x.size)),ASK:MEDIAN(book.asks.map(x=>x.size))};
  const contiguous=previous!==null&&receivedMs>previous.receivedMs&&
   receivedMs-previous.receivedMs<=maxFrameGapMs;
  for(const e of entries.values()){
   const l=byKey.get(e.key);
   if(l){
    const prev=contiguous?previous.byKey.get(e.key):null;
    const delta=contiguous&&prev?receivedMs-previous.receivedMs:0;
    if(delta>0&&prev.size>0&&l.size>0){
     e.coveredElapsedMs+=delta;e.currentContinuousMs+=delta;
     e.longestContinuousMs=Math.max(e.longestContinuousMs,e.currentContinuousMs);
     e.consecutiveObservations++;
    }else{
     e.currentContinuousMs=0;e.consecutiveObservations=1;
    }
    e.coverageState=l.size===0?STATES.ZERO:STATES.COVERED;
    e.lastSeenMs=receivedMs;e.lastObservedSize=l.size;
    e.lastObservedOrderCount=l.orderCount;
    e.maxObservedSize=Math.max(e.maxObservedSize,l.size);
    e.observedImages++;e.lastCoverageAtMs=receivedMs;
    if(l.size>0)e.lastPositiveMs=receivedMs;
    if(medians[l.side]>0){
     e.relativeSum+=l.size/medians[l.side];e.relativeSamples++;
     if(l.size>=Math.max(1,medians[l.side]*depthMultiplier))e.qualifyingImages++;
    }
   }else{
    e.coverageState=coverage(e,e.side,book);
    e.consecutiveObservations=0;e.currentContinuousMs=0;
   }
  }
  for(const l of all){
   const key=KEY(l.side,l.priceTicks);
   if(entries.has(key))continue;
   entries.set(key,{key,side:l.side,price:l.price,priceTicks:l.priceTicks,
    firstSeenMs:receivedMs,lastSeenMs:receivedMs,lastPositiveMs:l.size>0?receivedMs:null,
    lastCoverageAtMs:receivedMs,observedImages:1,consecutiveObservations:1,
    coveredElapsedMs:0,currentContinuousMs:0,longestContinuousMs:0,coverageState:l.size===0?STATES.ZERO:STATES.COVERED,
    lastObservedSize:l.size,lastObservedOrderCount:l.orderCount,maxObservedSize:l.size,
    relativeSum:medians[l.side]>0?l.size/medians[l.side]:0,
    relativeSamples:medians[l.side]>0?1:0,
    qualifyingImages:l.size>=Math.max(1,(medians[l.side]??Infinity)*depthMultiplier)?1:0});
  }
  previous={byKey,receivedMs};
  // Bounded ledger; evict only entries no longer in current image, oldest first.
  if(entries.size>maxPrices){
   const candidates=fresh().filter(e=>!byKey.has(e.key)).sort((a,b)=>a.lastSeenMs-b.lastSeenMs);
   for(const e of candidates.slice(0,entries.size-maxPrices))entries.delete(e.key);
  }
  // Old evidence is never interpreted as currently resting.
  for(const e of entries.values())if(receivedMs-e.lastSeenMs>maxElapsedMs){
   e.coverageState=STATES.UNKNOWN;e.currentContinuousMs=0;
  }
 }
 function invalidate(){
  invalid++;previous=null;lastGoodReceiveMs=null;
  for(const e of entries.values())e.coverageState=STATES.UNKNOWN;
 }
 function snapshot({nowMs,topN=12}={}){
  if(!Number.isFinite(nowMs)||nowMs<=0)throw Error('ENGINE18_BAD_LEDGER_CLOCK');
  const eligible=fresh().filter(e=>e.qualifyingImages>=minImages&&
    e.observedImages>=minImages&&e.coveredElapsedMs>=minDurationMs&&
    nowMs>=e.lastSeenMs&&nowMs-e.lastSeenMs<=maxElapsedMs);
  const candidates=eligible.filter(e=>e.coverageState===STATES.COVERED &&
    e.currentContinuousMs>=minDurationMs&&e.consecutiveObservations>=minImages&&
    nowMs-e.lastSeenMs<=maxFrameGapMs).sort((a,b)=>b.coveredElapsedMs-a.coveredElapsedMs||
      b.maxObservedSize-a.maxObservedSize||b.qualifyingImages-a.qualifyingImages)
   .slice(0,topN).map(e=>({
    side:e.side,price:e.price,priceTicks:e.priceTicks,
    visibleContracts:e.lastObservedSize,
    lastObservedSize:e.lastObservedSize,
    visibleOrderCount:e.lastObservedOrderCount,
    observedInImages:e.observedImages,
    observationShare:frames?Number((e.observedImages/frames).toFixed(3)):0,
    observedPersistenceMs:e.currentContinuousMs,
    cumulativeCoveredMs:e.coveredElapsedMs,
    longestContinuousMs:e.longestContinuousMs,
    firstObservedAtMs:e.firstSeenMs,lastObservedAtMs:e.lastSeenMs,
    ageSinceObservedMs:nowMs-e.lastSeenMs,
    maxObservedSize:e.maxObservedSize,
    relativeToSideMedian:e.relativeSamples?Number((e.relativeSum/e.relativeSamples).toFixed(2)):null,
    coverageState:e.coverageState,currentRestingLiquidityVerified:e.coverageState===STATES.COVERED,
    currentlyInBook:e.coverageState===STATES.COVERED,
    isHiddenStop:false,individualOrdersIdentified:false,
    evidenceLabel:e.coverageState===STATES.COVERED?'OBSERVED_CURRENT_BOOK':'LAST_SEEN_NOT_CURRENT'
   }));
  const active=fresh().filter(e=>e.coverageState===STATES.COVERED).length;
  const explicitZero=fresh().filter(e=>e.coverageState===STATES.ZERO).length;
  const durationQualified=fresh().filter(e=>e.coveredElapsedMs>=minDurationMs).length;
  const imagesQualified=fresh().filter(e=>e.observedImages>=minImages).length;
  const strengthQualified=fresh().filter(e=>e.qualifyingImages>=minImages).length;
  const age=lastGoodReceiveMs===null?null:nowMs-lastGoodReceiveMs;
  return {zones:candidates,diagnostics:{
   ledgerPrices:entries.size,validImages:frames,rejectedImages:invalid,
   activeObservedPrices:active,explicitZeroPrices:explicitZero,outOfCoveragePrices:fresh().filter(e=>e.coverageState===STATES.OUT).length,
   unknownPrices:fresh().filter(e=>e.coverageState===STATES.UNKNOWN).length,
   durationQualified,imagesQualified,strengthQualified,
   candidateCount:candidates.length,historicalQualifiedPrices:eligible.length,
   lastSeenButOutOfCoverage:eligible.filter(e=>e.coverageState!==STATES.COVERED).length,
   eligibleCurrentStreaks:eligible.filter(e=>e.currentContinuousMs>=minDurationMs&&
     e.consecutiveObservations>=minImages&&e.coverageState===STATES.COVERED).length,
   minDurationMs,minImages,maxFrameGapMs,
   lastValidDepthAgeMs:age,elapsedBasis:'HOST_RECEIVED_MONOTONICITY_UNVERIFIED',
   denominator:'VALID_DISTINCT_DEPTH_IMAGES',
   noCandidateReason:candidates.length?null:!frames?'NO_VALID_DEPTH':
    !imagesQualified?'INSUFFICIENT_PRICE_OBSERVATIONS':
    !durationQualified?'INSUFFICIENT_COVERED_ELAPSED_TIME':
    !strengthQualified?'NO_REPEATED_DISPLAYED_CONCENTRATION':
    eligible.some(e=>e.coverageState===STATES.COVERED)?'CURRENT_PRICE_STREAK_TOO_SHORT':
    eligible.length?'QUALIFIED_LEVELS_NOT_IN_CURRENT_BOOK':'CANDIDATES_EXPIRED_OR_OUTSIDE_WINDOW'}};
 }
 return Object.freeze({observe,invalidate,snapshot});
}
