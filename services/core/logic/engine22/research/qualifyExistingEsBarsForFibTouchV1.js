// Converts the existing Engine11 production OHLC shape to qualified Engine22 touch evidence.
// No provider calls, geometry edits, state writes or inferred contract/basis.
export function qualifyExistingEsBarsForFibTouchV1({bars=[],resolvedSymbol=null,priceBasis=null,timeframe="10m",evaluationTimeMs=null,model=null}={}) {
 const validTicker=typeof resolvedSymbol==="string" && /^ES[A-Z][0-9]{1,4}$/.test(resolvedSymbol);
 if(!validTicker||priceBasis!=="RAW_UNADJUSTED_CONTRACT"||model?.seriesId!==resolvedSymbol||model?.priceBasis!==priceBasis)
   return {eligible:false,reason:"CONTRACT_OR_PRICE_BASIS_NOT_VERIFIED",observations:[]};
 const duration={"1m":60,"5m":300,"10m":600,"1h":3600,"4h":14400,"1d":86400}[timeframe];
 if(!duration||!Number.isFinite(evaluationTimeMs))
   return {eligible:false,reason:"TIMEFRAME_OR_EVALUATION_TIME_MISSING",observations:[]};
 const observations=[];
 for(const bar of Array.isArray(bars)?bars:[]){
   const start=Number(bar?.time),high=Number(bar?.high),low=Number(bar?.low);
   if(!Number.isSafeInteger(start)||start<=0||!Number.isFinite(high)||!Number.isFinite(low)||low<=0||low>high)continue;
   // Completed bars only in this implementation; do not claim a forming aggregate
   // is immutable or that bar-start time is the exact tick-touch instant.
   if(start*1000+duration*1000>evaluationTimeMs)continue;
   observations.push({sourceTimestamp:new Date(start*1000).toISOString(),
     sourceBarId:`${resolvedSymbol}:${timeframe}:${start}`,
     sourceTimeframe:timeframe,seriesId:resolvedSymbol,priceBasis,
     high,low,completed:true,eligible:true});
 }
 return {eligible:true,reason:observations.length?"ELIGIBLE_COMPLETED_BARS":"NO_COMPLETED_BARS",
   observations};
}
