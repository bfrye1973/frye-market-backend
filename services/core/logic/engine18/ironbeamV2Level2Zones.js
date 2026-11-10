// Engine 18: Ironbeam V2 Level 2 displayed-liquidity reader.
// The v2 d stream is aggregate MBP: levels have p, sz, o, t, l (and optional
// implied size is / implied order count ioc). This is NOT Level 3 MBO.
// Only complete bid+ask book images are ranked. Unknown update format fails closed.
// Research only: no execution, no inferred hidden stops or calibrated probabilities.

const ROOT=/^XCME:ES\.[HMUZ]\d{2}$/;
const TICK=0.25;
const MAX_LEVELS=100;
const MAX_OBSERVATIONS=1200;
const n=v=>typeof v==="number"?v:typeof v==="string"&&v.trim()?Number(v):NaN;
const timeMs=v=>{
 const z=n(v);
 return Number.isSafeInteger(z)&&z>=1e12&&z<1e14?z:null;
};
const validSymbol=s=>ROOT.test(s||"");

export function parseIronbeamV2DepthFrame(frame,{symbol="XCME:ES.Z26"}={}){
 if(!validSymbol(symbol))throw Error("ENGINE18_ES_CONTRACT_REQUIRED");
 const payload=frame?.d;
 const rows=Array.isArray(payload)?payload:payload&&typeof payload==="object"?[payload]:[];
 const matching=rows.filter(r=>r?.s===symbol);
 if(matching.length!==1)return {ok:false,reason:"NO_UNAMBIGUOUS_ES_DEPTH",symbol};
 const r=matching[0];
 // Both sides must be present. Missing side may mean partial/delta update;
 // never delete old levels or interpret an incomplete packet as a full book.
 if(!Array.isArray(r.b)||!Array.isArray(r.a))
   return {ok:false,reason:"PARTIAL_OR_UNKNOWN_DEPTH_SHAPE",symbol};
 if(r.b.length>MAX_LEVELS||r.a.length>MAX_LEVELS)
   return {ok:false,reason:"DEPTH_LEVEL_LIMIT",symbol};
 const parseSide=(levels,side)=>{
  const seen=new Set();
  return levels.map(l=>{
   const price=n(l?.p),size=n(l?.sz),count=n(l?.o);
   const t=timeMs(l?.t),ticks=Math.round(price/TICK);
   if(!Number.isFinite(price)||price<=0||Math.abs(ticks*TICK-price)>1e-8||
      !Number.isSafeInteger(size)||size<0||
      !Number.isSafeInteger(count)||count<0||
      t===null||seen.has(ticks))throw Error("ENGINE18_V2_BAD_DEPTH_LEVEL");
   seen.add(ticks);
   const implied=n(l?.is);
   return {side,price,priceTicks:ticks,size,orderCount:count,
     impliedSize:Number.isSafeInteger(implied)&&implied>=0?implied:null,
     eventTimeMs:t,individualOrders:false};
  }).filter(x=>x.size>0).sort((a,b)=>side==="BID"?b.priceTicks-a.priceTicks:a.priceTicks-b.priceTicks);
 };
 let bids,asks;
 try{bids=parseSide(r.b,"BID");asks=parseSide(r.a,"ASK");}
 catch{return {ok:false,reason:"INVALID_DEPTH_LEVEL",symbol};}
 if(!bids.length||!asks.length)return {ok:false,reason:"ONE_SIDED_OR_EMPTY_BOOK",symbol};
 if(bids[0].priceTicks>=asks[0].priceTicks)
   return {ok:false,reason:"CROSSED_OR_LOCKED_BOOK",symbol};
 return {ok:true,schema:"engine18.ironbeam.v2.depth.v1",symbol,
   source:"IRONBEAM_V2_AGGREGATED_LEVEL2",bids,asks,
   eventTimeMs:Math.max(...bids.map(x=>x.eventTimeMs),...asks.map(x=>x.eventTimeMs)),
   bestBid:bids[0].price,bestAsk:asks[0].price,
   noExecution:true,level3:false};
}

export function createEngine18Level2ZoneReader({
 symbol="XCME:ES.Z26",minObservations=3,topN=12,
 maxHistory=180,depthMultiplier=1.5,allowDelayedResearch=true
}={}){
 if(!validSymbol(symbol))throw Error("ENGINE18_ES_CONTRACT_REQUIRED");
 if(!Number.isInteger(minObservations)||minObservations<1||minObservations>1000||
   !Number.isInteger(maxHistory)||maxHistory<minObservations||maxHistory>MAX_OBSERVATIONS||
   !Number.isInteger(topN)||topN<1||topN>100||
   !Number.isFinite(depthMultiplier)||depthMultiplier<1)
   throw Error("ENGINE18_BAD_READER_OPTIONS");
 let images=0,received=0,rejected=0,lastBook=null,lastReceivedMs=null;
 const history=[];let lastZones=[];
 function observe(frame,{receivedAtMs=Date.now()}={}){
  if(!Number.isSafeInteger(receivedAtMs)||receivedAtMs<=0)throw Error("ENGINE18_BAD_RECEIVE_CLOCK");
  received++;
  const parsed=parseIronbeamV2DepthFrame(frame,{symbol});
  if(!parsed.ok){rejected++;return {accepted:false,reason:parsed.reason};}
  // Exchange timestamps must be monotonic. Never rewind live research.
  if(lastBook&&parsed.eventTimeMs<lastBook.eventTimeMs){
   rejected++;return {accepted:false,reason:"OUT_OF_ORDER_BOOK"};
  }
  // Only one observation per unique book image; don't fake persistence from repeats.
  const signature=JSON.stringify([...parsed.bids,...parsed.asks].map(
    x=>[x.side,x.priceTicks,x.size,x.orderCount]));
  if(lastBook?.signature===signature) return {accepted:false,reason:"UNCHANGED_DEPTH"};
  images++;lastReceivedMs=receivedAtMs;lastBook={...parsed,signature};
  history.push({eventTimeMs:parsed.eventTimeMs,receivedAtMs,
    levels:[...parsed.bids,...parsed.asks]});
  if(history.length>maxHistory)history.shift();
  return {accepted:true,images,depthLevels:parsed.bids.length+parsed.asks.length};
 }
 function snapshot({nowMs=Date.now(),maxAgeMs=5000,feedTier="UNVERIFIED"}={}){
  if(!Number.isSafeInteger(nowMs)||nowMs<=0)throw Error("ENGINE18_BAD_CLOCK");
  const result={schema:"engine18.visibleZones.v1",symbol,source:"IRONBEAM_V2_LEVEL2",
   evidence:"VISIBLE_RESTING_DEPTH_ONLY",tier:feedTier,level3:false,
   noExecution:true,calibratedProbability:false,images,framesReceived:received,
   rejectedFrames:rejected,observations:history.length,
   bestBid:lastBook?.bestBid??null,bestAsk:lastBook?.bestAsk??null,
   lastExchangeMs:lastBook?.eventTimeMs??null,lastReceivedMs,
   ageMs:lastBook?nowMs-lastBook.eventTimeMs:null,
   displayOnly:true,usable:false,zones:[],
   limitations:["Large displayed depth can disappear before execution",
   "Level 2 changes cannot identify individual order cancellations",
   "No hidden stops or guaranteed price targets",
   "Requires further feed entitlement and latency verification"]};
  if(!lastBook){result.reason="NO_VALID_DEPTH_IMAGES";return result;}
  if(history.length<minObservations){result.reason="INSUFFICIENT_OBSERVATIONS";return result;}
  const age=result.ageMs;
  const realtimeEligible=feedTier==="LIVE_VERIFIED"&&age>=0&&age<=maxAgeMs;
  if(!realtimeEligible&&!allowDelayedResearch){
   result.reason="FEED_FRESHNESS_NOT_VERIFIED";return result;
  }
  if(age<0){result.reason="FUTURE_EXCHANGE_TIMESTAMP";return result;}
  const all=[...lastBook.bids,...lastBook.asks];
  const sideMedian=side=>{
   const a=all.filter(x=>x.side===side).map(x=>x.size).sort((a,b)=>a-b);
   return a.length?(a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2):null;
  };
  const medians={BID:sideMedian("BID"),ASK:sideMedian("ASK")};
  const qualifying=all.filter(l=>l.size>=Math.max(1,medians[l.side]*depthMultiplier));
  const zones=qualifying.map(level=>{
   let seen=0,first=null,last=null,maxSize=0;
   // Observation frequency, not elapsed time or order-ID persistence.
   for(const item of history){
    const match=item.levels.find(x=>x.side===level.side&&x.priceTicks===level.priceTicks&&x.size>0);
    if(match){seen++;first??=item.eventTimeMs;last=item.eventTimeMs;maxSize=Math.max(maxSize,match.size);}
   }
   return {side:level.side,price:level.price,priceTicks:level.priceTicks,
     visibleContracts:level.size,visibleOrderCount:level.orderCount,
     impliedSize:level.impliedSize,relativeToSideMedian:medians[level.side]>0
       ?Number((level.size/medians[level.side]).toFixed(2)):null,
     observedInImages:seen,observationShare:Number((seen/history.length).toFixed(3)),
     firstObservedExchangeMs:first,lastObservedExchangeMs:last,maxObservedSize:maxSize,
     distanceFromTouchTicks:level.side==="BID"
       ?lastBook.bids[0].priceTicks-level.priceTicks
       :level.priceTicks-lastBook.asks[0].priceTicks,
     isHiddenStop:false,individualOrdersIdentified:false};
  }).filter(z=>z.observedInImages>=minObservations)
   .sort((a,b)=>b.visibleContracts-a.visibleContracts||
      b.observationShare-a.observationShare||
      a.distanceFromTouchTicks-b.distanceFromTouchTicks).slice(0,topN);
  result.usable=true;result.displayOnly=!realtimeEligible;result.reason=realtimeEligible?null:"RESEARCH_ONLY_FRESHNESS_NOT_VERIFIED";
  result.zones=zones;lastZones=zones;
  return result;
 }
 return Object.freeze({observe,snapshot});
}
