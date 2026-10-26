import {LIVE_OBSERVER_SCHEMA,LIVE_EVENT_SCHEMA,LIVE_OBSERVER_SOURCE} from "../contracts/livePriceObserver.v1.js";
const positive=x=>typeof x==="number"&&Number.isFinite(x)&&x>0;
const time=s=>typeof s==="string"&&Number.isFinite(Date.parse(s))?Date.parse(s):NaN;
const contract=s=>typeof s==="string"&&/^ES[FGHJKMNQUVXZ][0-9]{1,2}$/.test(s);
const fail=reason=>({schema:LIVE_OBSERVER_SCHEMA,mode:"READ_ONLY_SHADOW",available:false,state:"UNAVAILABLE",
 currentPrice:null,lastTradeAt:null,provisionalTouches:[],nextProvisionalReference:null,
 confirmedFibObjective:null,confirmedWaveCompletion:false,reasonCodes:[reason],
 noPermissionCreated:true,noExecution:true,noOrderModification:true,noJournalWrite:true});
export function observeLiveEs({previous=null,event=null,owner=null,observedAt=null,expectedContract=null,maxTradeAgeMs=30000}={}){
 const now=time(observedAt);
 if(!Number.isFinite(now))return fail("OBSERVATION_TIMESTAMP_INVALID");
 if(!contract(expectedContract))return fail("ES_CONTRACT_IDENTITY_UNVERIFIED");
 // Reject bar/agg events entirely. The observer processes only individual trade prices.
 if(event?.type!=="trade"||event?.source!==LIVE_OBSERVER_SOURCE||event?.symbol!=="ES"||
    event?.resolvedSymbol!==expectedContract)return fail("VERIFIED_ES_TRADE_EVENT_REQUIRED");
 if(owner?.version!=="engine22.microCDownOwnerWatch.v1"||owner?.activeWave!=="C"||owner?.direction!=="DOWN"||
   !Array.isArray(owner.levels)||!owner.levels.length||!owner.levels.every(l=>typeof l.key==="string"&&positive(l.price)))
   return fail("CURRENT_ENGINE22_OWNER_UNAVAILABLE");
 if(!positive(event.price)||!positive(event.size))return fail("INVALID_ES_TRADE_PRICE_OR_SIZE");
 const at=time(event.tradeTime);
 if(!Number.isFinite(at)||at>now||now-at>maxTradeAgeMs||!Number.isFinite(maxTradeAgeMs)||maxTradeAgeMs<=0)
   return fail("STALE_OR_FUTURE_ES_TRADE");
 if(previous?.expectedContract&&previous.expectedContract!==expectedContract)return fail("ES_CONTRACT_ROLLOVER_REQUIRES_RESET");
 if(previous?.lastTradeAt&&at<Date.parse(previous.lastTradeAt))return fail("OUT_OF_ORDER_ES_TRADE");
 const touched=owner.levels.filter(l=>event.price===l.price).map(l=>({key:l.key,price:l.price,evidenceClass:"TRADE_AT_LEVEL",waveCompletionConfirmed:false}));
 // Crossing a level requires two observations from the exact same contract; a single trade is not an intrabar high/low.
 if(previous?.available===true&&positive(previous.currentPrice)&&previous.expectedContract===expectedContract){
  for(const l of owner.levels)if(!touched.some(t=>t.key===l.key)&&
    Math.min(previous.currentPrice,event.price)<=l.price&&Math.max(previous.currentPrice,event.price)>=l.price)
      touched.push({key:l.key,price:l.price,evidenceClass:"BETWEEN_CONSECUTIVE_TRADES",waveCompletionConfirmed:false});
 }
 const next=owner.levels.find(l=>l.price<event.price)??null;
 return {schema:LIVE_OBSERVER_SCHEMA,eventSchema:LIVE_EVENT_SCHEMA,source:LIVE_OBSERVER_SOURCE,mode:"READ_ONLY_SHADOW",
  available:true,state:"LIVE_TRADE_OBSERVED",symbol:"ES",expectedContract,asOf:observedAt,lastTradeAt:event.tradeTime,
  currentPrice:event.price,tradeSize:event.size,provisionalTouches:touched,
  nextProvisionalReference:next?{key:next.key,price:next.price,provisional:true}:null,
  confirmedFibObjective:null,confirmedWaveCompletion:false,reasonCodes:[],
  noPermissionCreated:true,noExecution:true,noOrderModification:true,noJournalWrite:true};
}
