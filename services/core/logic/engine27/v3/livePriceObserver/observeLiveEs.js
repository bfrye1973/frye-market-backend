import { LIVE_OBSERVER_SCHEMA,LIVE_EVENT_SCHEMA,LIVE_OBSERVER_PERIOD_MS,LIVE_OBSERVER_SOURCE } from "../contracts/livePriceObserver.v1.js";
const goodNumber=n=>typeof n==="number"&&Number.isFinite(n);
const positive=n=>goodNumber(n)&&n>0;
const time=t=>typeof t==="string"&&Number.isFinite(Date.parse(t))?Date.parse(t):NaN;
const resolved=s=>/^ES[FGHJKMNQUVXZ]\d{1,2}$/.test(s??"");
const absent=(reason,previous)=>({
 schema:LIVE_OBSERVER_SCHEMA,mode:"READ_ONLY_SHADOW",state:"UNAVAILABLE",available:false,
 currentPrice:null,priceAsOf:null,provisionalTouches:[],lastCompletedCandle:null,
 reasonCodes:[reason],previousConfirmedTouchCount:previous?.lastCompletedCandle?.touchedLevels?.length??0,
 noPermissionCreated:true,noExecution:true,noJournalWrite:true,noOrderModification:true
});
const validCandle=b=>positive(b?.open)&&positive(b?.high)&&positive(b?.low)&&positive(b?.close)&&
 b.low<=b.high&&b.open>=b.low&&b.open<=b.high&&b.close>=b.low&&b.close<=b.high;
const touches=(bar,levels)=>levels.filter(l=>bar.low<=l.price&&bar.high>=l.price)
 .map(l=>({key:l.key,price:l.price,evidenceClass:"PRICE_TOUCH_ONLY",waveCompletionConfirmed:false}));

export function observeLiveEs({previous=null,event=null,owner=null,observedAt=null,expectedContract=null,maxStreamAgeMs=30000}={}){
 const now=time(observedAt);
 if(!Number.isFinite(now))return absent("OBSERVATION_TIMESTAMP_INVALID",previous);
 if(!resolved(expectedContract))return absent("RESOLVED_ES_CONTRACT_UNVERIFIED",previous);
 if(event?.ok!==true||event?.type!=="bar"||event?.symbol!=="ES"||
 event?.resolvedSymbol!==expectedContract||event?.tf!=="10m"||event?.mode!=="eth")
  return absent("STREAM_SOURCE_IDENTITY_MISMATCH",previous);
 if(owner?.version!=="engine22.microCDownOwnerWatch.v1"||owner?.activeWave!=="C"||
 owner?.direction!=="DOWN"||!Array.isArray(owner.levels)||!owner.levels.length||
 !owner.levels.every(l=>typeof l?.key==="string"&&positive(l.price)&&l.provisional===true))
  return absent("CURRENT_ENGINE22_MICRO_OWNER_UNAVAILABLE",previous);
 const b=event.bar;
 if(!Number.isSafeInteger(b?.time)||b.time<1e9||!validCandle(b))return absent("UNVERIFIED_STREAM_CANDLE_FORMAT",previous);
 const start=b.time*1000,end=start+LIVE_OBSERVER_PERIOD_MS;
 if(start>now||!goodNumber(maxStreamAgeMs)||maxStreamAgeMs<=0||
 (now-start)>LIVE_OBSERVER_PERIOD_MS+maxStreamAgeMs)return absent("STREAM_EVENT_OUTSIDE_OBSERVATION_WINDOW",previous);
 if(previous?.expectedContract&&previous.expectedContract!==expectedContract)
  return absent("CONTRACT_ROLLOVER_REQUIRES_RESET",previous);
 if(previous?.lastBarStartMs!=null&&start<previous.lastBarStartMs)
  return absent("OUT_OF_ORDER_STREAM_BAR",previous);
 const nowPrice=b.close;
 const currentTouches=touches(b,owner.levels);
 let lastCompleted=previous?.lastCompletedCandle??null;
 if(previous?.lastBarStartMs!=null&&start>previous.lastBarStartMs&&previous?.activeBar){
   const prior=previous.activeBar;
   // New bucket alone is insufficient: prior bar must have ended on time axis.
   if(prior.endMs<=now)lastCompleted={
      startTime:new Date(prior.startMs).toISOString(),endTime:new Date(prior.endMs).toISOString(),
      open:prior.open,high:prior.high,low:prior.low,close:prior.close,
      touchedLevels:prior.touchedLevels,confirmation:"PRICE_TOUCH_NOT_WAVE_COMPLETION"
   };
 }
 // The SSE emits interim OHLC updates, not a reliable finalized-candle flag.
 // No inferred completion for the current bar even if the clock is past its end.
 const activeBar={startMs:start,endMs:end,open:b.open,high:b.high,low:b.low,close:b.close,touchedLevels:currentTouches};
 return {
 schema:LIVE_OBSERVER_SCHEMA,eventSchema:LIVE_EVENT_SCHEMA,source:LIVE_OBSERVER_SOURCE,
 mode:"READ_ONLY_SHADOW",available:true,state:"LIVE_PRICE_OBSERVED",
 symbol:"ES",expectedContract,timeframe:"10m",asOf:observedAt,
 currentPrice:nowPrice,priceAsOf:observedAt,lastBarStartMs:start,
 activeBar,provisionalTouches:currentTouches,lastCompletedCandle:lastCompleted,
 priceActionStatus:currentTouches.length?"PROVISIONAL_LEVEL_TOUCHED":"PRICE_OBSERVED_NO_LEVEL_TOUCH",
 nextProvisionalReference:owner.levels.find(l=>l.price<nowPrice)?(({key,price})=>({key,price,provisional:true}))(owner.levels.find(l=>l.price<nowPrice)):null,
 confirmedFibObjective:null,confirmedWaveCompletion:false,
 reasonCodes:lastCompleted?[]:["NO_STREAM_COMPLETED_CANDLE_YET"],
 noPermissionCreated:true,noExecution:true,noJournalWrite:true,noOrderModification:true
 };
}
