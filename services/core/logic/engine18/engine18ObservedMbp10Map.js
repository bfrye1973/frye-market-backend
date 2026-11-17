// Engine18 observed MBP-10 v0: pure OFFLINE research. No network, trading, signals or prediction.
// No implicit carry-forward. Raw vendor field semantics remain hypotheses.
export const OBSERVED_MBP10_SCHEMA='engine18.observedMbp10.v0';
export const COVERAGE=Object.freeze({QTY:'OBSERVED_QTY',ZERO:'OBSERVED_ZERO',OUT:'OUT_OF_COVERAGE',INVALID:'FEED_INVALID'});
const bad=reason=>Object.freeze({state:COVERAGE.INVALID,reason});
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const num=x=>typeof x==='number'&&Number.isFinite(x);
const integer=x=>num(x)&&Number.isSafeInteger(x);
const tickAligned=(x,tick)=>Math.abs(Math.round(x/tick)*tick-x)<=1e-7;
const key=(side,price)=>side+':'+price.toFixed(2);
const properties=x=>obj(x)?Object.keys(x).sort():[];
export function parseObservedMbp10(frame,{tick=0.25}={}){
 if(!num(tick)||tick<=0)return bad('INVALID_TICK_CONFIGURATION');
 let data=frame;
 if(typeof frame==='string'){try{data=JSON.parse(frame);}catch{return bad('INVALID_JSON');}}
 if(!obj(data)||!Array.isArray(data.d)||data.d.length!==1||!obj(data.d[0]))
  return bad('PARTIAL_OR_UNKNOWN_DEPTH_ENVELOPE');
 const d=data.d[0];
 if(!Array.isArray(d.b)||!Array.isArray(d.a)||d.b.length!==10||d.a.length!==10)
  return bad('NOT_10_BY_10');
 const parseSide=(arr,side)=>{
  let prior=null;const rows=[];
  for(let i=0;i<arr.length;i++){
   const x=arr[i];
   if(!obj(x)||!num(x.p)||x.p<=0||!tickAligned(x.p,tick)||
     !num(x.sz)||x.sz<0||!num(x.o)||x.o<0||
     !integer(x.l)||x.l<0||!num(x.t)||!num(x.s))
    return null;
   if(prior!==null&&(side==='bid'?x.p>=prior:x.p<=prior))return null;
   prior=x.p;
   rows.push(Object.freeze({side,price:x.p,sz:x.sz,o:x.o,l:x.l,t:x.t,s:x.s,rank:i,
    state:x.sz===0?COVERAGE.ZERO:COVERAGE.QTY}));
  }
  return rows;
 };
 const bids=parseSide(d.b,'bid'),asks=parseSide(d.a,'ask');
 if(!bids||!asks)return bad('INVALID_LEVEL_OR_ORDER');
 if(bids[0].price>=asks[0].price)return bad('CROSSED_OR_LOCKED');
 return Object.freeze({state:'VALID',symbol:typeof d.s==='string'?d.s:null,
  bids:Object.freeze(bids),asks:Object.freeze(asks),bestBid:bids[0].price,bestAsk:asks[0].price,
  levelFields:properties(d.b[0])});
}
function entries(frame){return [...frame.bids,...frame.asks];}
export function coverageAt(frame,side,price){
 if(frame?.state!=='VALID')return Object.freeze({state:COVERAGE.INVALID});
 const found=(side==='bid'?frame.bids:side==='ask'?frame.asks:[])
  .find(r=>r.price===price);
 if(!found)return Object.freeze({state:COVERAGE.OUT});
 return Object.freeze({state:found.state,sz:found.sz,o:found.o,rank:found.rank});
}
function median(values){
 if(!values.length)return null;const a=[...values].sort((x,y)=>x-y);const m=Math.floor(a.length/2);
 return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
export function analyzeObservedMbp10(records,{tick=0.25,maxIntervalMs=1000}={}){
 if(!Array.isArray(records)||!num(maxIntervalMs)||maxIntervalMs<=0)throw Error('bounded offline records required');
 const images=[],fieldCounts={},diagnostics={
  depthFrames:0,validDepthFrames:0,invalidDepthFrames:0,invalidReasons:{},
  zeroSizeLevels:0,nonTickLevels:0,rankPositionAgreement:0,rankZeroBasedMatches:0,rankOneBasedMatches:0,rankPositionTotal:0,
  oGreaterThanSz:0,oLessThanOrEqualSz:0,nonTickLevelValues:0,
  tUnchangedPriceSizeChanged:0,tChangedPriceSizeUnchanged:0,
  previousLevelComparisons:0,consecutiveDisplayedIncrease:0,consecutiveDisplayedDecrease:0,
  consecutiveDisplayedUnchanged:0,tradeItems:0,tradeSqIncreases:0,tradeSqNonIncreasing:0,
  tradeSqGaps:0,tradeSqDuplicates:0,tradeSqFirst:null,tradeSqLast:null,
  tradeIs:{true:0,false:0,missing:0},tradeClx:{true:0,false:0,missing:0},
  quoteFrames:0,quoteCompared:0,quoteBestPriceAgreement:0,quoteBestSizeAgreement:0,
  quoteShapeMissing:0,quotesAfterLastDepth:0,tradesAfterLastDepth:0,
  depthFields:{},quoteFields:{},tradeFields:{},receiveGapHistogram:{under10:0,under100:0,under1000:0,over1000:0},
  controlEvents:{},unverifiedReceiptClock:true
 };
 let previousDepth=null,previousSq=null,previousReceipt=null,latestDepth=null,segment=0;
 const position=new Map(),observedCells=new Set();
 const updateField=(map,x)=>{for(const f of properties(x)){const name=f+':'+(x[f]===null?'null':Array.isArray(x[f])?'array':typeof x[f]);map[name]=(map[name]||0)+1;}};
 const duration=(a,b)=>{
  try{
   if(a==null||b==null)return null;
   const d=BigInt(b)-BigInt(a);
   return d>=0n?Number(d)/1000000:null;
  }catch{return null;}
 };
 for(const record of records){
  if(record?.statusCode){
   diagnostics.controlEvents[record.statusCode]=(diagnostics.controlEvents[record.statusCode]||0)+1;
   if(['GAP','FEED_GAP','DISCONNECTED','RECONNECT','WS_ERROR','SOURCE_CONNECT_FAILED',
       'MALFORMED_FRAME','SOURCE_ERROR'].includes(record.statusCode)){
    segment++;previousDepth=null;latestDepth=null;position.clear();previousReceipt=null;
   }
   continue;
  }
  if(record?.rawEncoding!=='utf8'||typeof record.raw!=='string'){
   segment++;previousDepth=null;latestDepth=null;position.clear();previousReceipt=null;continue;
  }
  let message;try{message=JSON.parse(record.raw);}catch{
   segment++;previousDepth=null;latestDepth=null;position.clear();previousReceipt=null;continue;
  }
  if(!obj(message)){
   segment++;previousDepth=null;latestDepth=null;position.clear();previousReceipt=null;continue;
  }
  const dt=duration(previousReceipt,record.receivedMonoNs);
  if(dt!==null){
   const name=dt<10?'under10':dt<100?'under100':dt<1000?'under1000':'over1000';
   diagnostics.receiveGapHistogram[name]++;
  }
  previousReceipt=record.receivedMonoNs??previousReceipt;
  if(Array.isArray(message.d)){
   diagnostics.depthFrames++;
   const image=parseObservedMbp10(message,{tick});
   images.push({image,monoNs:record.receivedMonoNs??null,seq:record.localSeq,segment});
   if(image.state!=='VALID'){
    diagnostics.invalidDepthFrames++;
    diagnostics.invalidReasons[image.reason]=(diagnostics.invalidReasons[image.reason]||0)+1;
    previousDepth=null;latestDepth=null;position.clear();segment++;
    continue;
   }
   diagnostics.validDepthFrames++;latestDepth=image;
   const current=new Map(entries(image).map(x=>[key(x.side,x.price),x]));
   for(const rawLevel of [...message.d[0].b,...message.d[0].a])updateField(diagnostics.depthFields,rawLevel);
   for(const r of current.values()){
    const id=key(r.side,r.price);observedCells.add(id);
    if(r.sz===0)diagnostics.zeroSizeLevels++;
    diagnostics.rankPositionTotal++;
    if(r.l===r.rank){diagnostics.rankPositionAgreement++;diagnostics.rankZeroBasedMatches++;}
    if(r.l===r.rank+1){diagnostics.rankPositionAgreement++;diagnostics.rankOneBasedMatches++;}
    if(r.o>r.sz)diagnostics.oGreaterThanSz++;else diagnostics.oLessThanOrEqualSz++;
    if(previousDepth?.state==='VALID'){
     const old=position.get(id);
     if(old){
      diagnostics.previousLevelComparisons++;
      if(r.sz>old.sz)diagnostics.consecutiveDisplayedIncrease++;
      else if(r.sz<old.sz)diagnostics.consecutiveDisplayedDecrease++;
      else diagnostics.consecutiveDisplayedUnchanged++;
      if(r.sz!==old.sz&&r.t===old.t)diagnostics.tUnchangedPriceSizeChanged++;
      if(r.sz===old.sz&&r.t!==old.t)diagnostics.tChangedPriceSizeUnchanged++;
     }
    }
    updateField(fieldCounts,r);
   }
   position.clear();for(const [id,r] of current)position.set(id,r);
   previousDepth=image;
  }else if(Array.isArray(message.q)){
   diagnostics.quoteFrames++;
   const q=message.q[0];
   if(obj(q))updateField(diagnostics.quoteFields,q);
   if(latestDepth)diagnostics.quotesAfterLastDepth++;
   if(!obj(q)||!latestDepth||!num(q.b)||!num(q.a)||!num(q.bs)||!num(q.as)){
    diagnostics.quoteShapeMissing++;continue;
   }
   diagnostics.quoteCompared++;
   if(q.b===latestDepth.bestBid&&q.a===latestDepth.bestAsk)diagnostics.quoteBestPriceAgreement++;
   if(q.bs===latestDepth.bids[0].sz&&q.as===latestDepth.asks[0].sz)diagnostics.quoteBestSizeAgreement++;
  }else if(Array.isArray(message.tr)){
   for(const trade of message.tr){
    if(!obj(trade))continue;
    diagnostics.tradeItems++;
    if(latestDepth)diagnostics.tradesAfterLastDepth++;
    updateField(diagnostics.tradeFields,trade);
    for(const f of ['is','clx']){
     const k=typeof trade[f]==='boolean'?String(trade[f]):'missing';diagnostics['trade'+f.charAt(0).toUpperCase()+f.slice(1)][k]++;
    }
    if(integer(trade.sq)){
     if(previousSq!==null){
      if(trade.sq>previousSq){
       diagnostics.tradeSqIncreases++;
       if(trade.sq>previousSq+1)diagnostics.tradeSqGaps++;
      }else{
       diagnostics.tradeSqNonIncreasing++;
       if(trade.sq===previousSq)diagnostics.tradeSqDuplicates++;
      }
     }else diagnostics.tradeSqFirst=trade.sq;
     previousSq=trade.sq;diagnostics.tradeSqLast=trade.sq;
    }
   }
  }
 }
 // Same-side, same-rank median from THIS short recording only. This is a
 // descriptive within-sample reference, not a trained expected-depth baseline.
 const rankSamples=new Map();
 for(const row of images){
  if(row.image.state!=='VALID')continue;
  for(const entry of entries(row.image)){
   const slot=entry.side+':'+entry.rank;
   if(!rankSamples.has(slot))rankSamples.set(slot,[]);
   rankSamples.get(slot).push(entry.sz);
  }
 }
 const rankBaseline=new Map([...rankSamples].map(([k,v])=>[k,median(v)]));
 const grid=new Map();
 for(const row of images){
  if(row.image.state!=='VALID')continue;
  for(const entry of entries(row.image)){
   const id=key(entry.side,entry.price);
   if(!grid.has(id))grid.set(id,{side:entry.side,price:entry.price,observations:0,maxSz:0,maxO:0,
    weightedSz:0,weightedO:0,coverageMs:0,increases:0,decreases:0,unchanged:0,
    zeros:0,residualWeighted:0,residualWeightMs:0,
    residualSampleSum:0,meanDepthTicksFromTouchSum:0});
   const cell=grid.get(id);cell.observations++;
   const medianAtRank=rankBaseline.get(entry.side+':'+entry.rank);
   cell.residualSampleSum+=entry.sz-medianAtRank;
   const touch=entry.side==='bid'?row.image.bestBid:row.image.bestAsk;
   cell.meanDepthTicksFromTouchSum+=Math.abs(entry.price-touch)/tick;
   cell.maxSz=Math.max(cell.maxSz,entry.sz);
   cell.maxO=Math.max(cell.maxO,entry.o);if(entry.sz===0)cell.zeros++;
  }
 }
 // Observed-state intervals never bridge invalid or absent frames. Receipt durations are
 // host-monotonic observations and explicitly NOT certified market-time persistence.
 for(let i=0;i<images.length;i++){
  const a=images[i],b=images[i+1];
  if(a.image.state!=='VALID')continue;
  const current=entries(a.image);
  const next=b?.image.state==='VALID'&&a.segment===b.segment?
   new Map(entries(b.image).map(x=>[key(x.side,x.price),x])):null;
  const ms=next?duration(a.monoNs,b.monoNs):null;
  for(const item of current){
   const id=key(item.side,item.price),cell=grid.get(id),following=next?.get(id);
   if(following){
    if(following.sz>item.sz)cell.increases++;
    else if(following.sz<item.sz)cell.decreases++;
    else cell.unchanged++;
    if(ms!==null&&ms<=maxIntervalMs){
     cell.coverageMs+=ms;cell.weightedSz+=ms*item.sz;cell.weightedO+=ms*item.o;
     cell.residualWeighted+=ms*(item.sz-rankBaseline.get(item.side+':'+item.rank));
     cell.residualWeightMs+=ms;
    }
   }
  }
 }
 const perSide={bid:[],ask:[]};
 for(const x of grid.values()){
  const out={...x,observedCoverageMs:x.coverageMs,
   timeWeightedSz:x.coverageMs>0?x.weightedSz/x.coverageMs:null,
   timeWeightedO:x.coverageMs>0?x.weightedO/x.coverageMs:null,
   timeWeightedResidualSz:x.residualWeightMs>0?x.residualWeighted/x.residualWeightMs:null,
   meanSampleResidualSz:x.observations?x.residualSampleSum/x.observations:null,
   meanDistanceFromTouchTicks:x.observations?x.meanDepthTicksFromTouchSum/x.observations:null};
  delete out.weightedSz;delete out.weightedO;delete out.coverageMs;
  delete out.residualWeighted;delete out.residualWeightMs;
  delete out.residualSampleSum;delete out.meanDepthTicksFromTouchSum;
  perSide[x.side].push(out);
 }
 for(const side of ['bid','ask'])perSide[side].sort((a,b)=>b.observedCoverageMs-a.observedCoverageMs||
  (b.timeWeightedSz??-1)-(a.timeWeightedSz??-1)||b.maxSz-a.maxSz);
 // This return contains licensed absolute prices: KEEP PRIVATE, never log or upload.
 return {schema:OBSERVED_MBP10_SCHEMA,images,coverage:coverageAt,
  privateAbsoluteGrid:perSide,diagnostics,
  summarySafe:{depthFrames:diagnostics.depthFrames,validDepthFrames:diagnostics.validDepthFrames,
   invalidDepthFrames:diagnostics.invalidDepthFrames,invalidReasons:diagnostics.invalidReasons,
   rankZeroBasedMatches:diagnostics.rankZeroBasedMatches,
   rankOneBasedMatches:diagnostics.rankOneBasedMatches,
   rankPositionTotal:diagnostics.rankPositionTotal,
   oGreaterThanSz:diagnostics.oGreaterThanSz,oLessThanOrEqualSz:diagnostics.oLessThanOrEqualSz,
   tUnchangedPriceSizeChanged:diagnostics.tUnchangedPriceSizeChanged,
   tChangedPriceSizeUnchanged:diagnostics.tChangedPriceSizeUnchanged,
   depthFields:diagnostics.depthFields,quoteFields:diagnostics.quoteFields,
   tradeFields:diagnostics.tradeFields,
   distinctSidePriceCells:observedCells.size,zeroSizeLevels:diagnostics.zeroSizeLevels,
   previousLevelComparisons:diagnostics.previousLevelComparisons,
   consecutiveDisplayedIncrease:diagnostics.consecutiveDisplayedIncrease,
   consecutiveDisplayedDecrease:diagnostics.consecutiveDisplayedDecrease,
   consecutiveDisplayedUnchanged:diagnostics.consecutiveDisplayedUnchanged,
   tradeItems:diagnostics.tradeItems,tradeSqIncreases:diagnostics.tradeSqIncreases,
   tradeSqNonIncreasing:diagnostics.tradeSqNonIncreasing,
   tradeSqDuplicates:diagnostics.tradeSqDuplicates,tradeSqGaps:diagnostics.tradeSqGaps,
   quoteCompared:diagnostics.quoteCompared,
   quotesAfterLastDepth:diagnostics.quotesAfterLastDepth,
   tradesAfterLastDepth:diagnostics.tradesAfterLastDepth,
   tradeIs:diagnostics.tradeIs,tradeClx:diagnostics.tradeClx,
   quoteBestPriceAgreement:diagnostics.quoteBestPriceAgreement,
   quoteBestSizeAgreement:diagnostics.quoteBestSizeAgreement,
   receiveGapHistogram:diagnostics.receiveGapHistogram,
   topTwoBidConcentrations:perSide.bid.slice(0,2).map(x=>({observations:x.observations,
    observedCoverageMs:x.observedCoverageMs,maxSz:x.maxSz,
    meanDistanceFromTouchTicks:x.meanDistanceFromTouchTicks,
    timeWeightedResidualSz:x.timeWeightedResidualSz})),
   topTwoAskConcentrations:perSide.ask.slice(0,2).map(x=>({observations:x.observations,
    observedCoverageMs:x.observedCoverageMs,maxSz:x.maxSz,
    meanDistanceFromTouchTicks:x.meanDistanceFromTouchTicks,
    timeWeightedResidualSz:x.timeWeightedResidualSz})),
   limitations:['one minute, nonrepresentative','receipt time UNVERIFIED',
    'top-ten aggregated MBP only','no order IDs, execution/cancellation/replenishment labels',
    'out-of-coverage is UNKNOWN, not zero',
    'within-sample same-rank median is descriptive, nonrepresentative',
    'no probabilities or trading signals']}
 };
}
