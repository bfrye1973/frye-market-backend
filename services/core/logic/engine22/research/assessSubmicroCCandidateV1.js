// Engine22 research-only Submicro C-low candidate observation.
// Never changes the official count, Fib model, status or trading permissions.
// A candidate low is NOT structural completion; Engine22 must separately confirm.
const finite=x=>typeof x==="number"&&Number.isFinite(x)?x:null;
const stamp=x=>typeof x==="string"&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
export function assessSubmicroCCandidateV1({bars=[],ownerB=null,sourceSeriesId=null,priceBasis=null}={}){
 const bPrice=finite(ownerB?.price),bTime=stamp(ownerB?.time);
 if(bPrice===null||bTime===null)return {candidate:null,confirmed:false,reason:"OWNER_B_PRICE_AND_TIME_REQUIRED"};
 const valid=bars.filter(bar=>finite(bar?.low)!==null&&finite(bar?.high)!==null&&bar.low<=bar.high&&
   bar.completed===true&&bar.eligible===true&&bar.seriesId===sourceSeriesId&&
   bar.priceBasis===priceBasis&&stamp(bar.sourceTimestamp)!==null&&
   stamp(bar.sourceTimestamp)>bTime&&typeof bar.sourceBarId==="string"&&bar.sourceBarId.length>0)
   .sort((a,b)=>stamp(a.sourceTimestamp)-stamp(b.sourceTimestamp));
 if(!sourceSeriesId||!priceBasis||!valid.length)return {candidate:null,confirmed:false,reason:"NO_ELIGIBLE_POST_B_CANDLES"};
 const low=Math.min(...valid.map(bar=>bar.low));
 const matching=valid.filter(bar=>bar.low===low);
 const bar=matching[matching.length-1];
 const after=valid.filter(x=>stamp(x.sourceTimestamp)>stamp(bar.sourceTimestamp));
 return {
   candidate:{price:low,sourceTimestamp:bar.sourceTimestamp,sourceBarId:bar.sourceBarId,
     seriesId:sourceSeriesId,priceBasis,postLowBars:after.length,
     reboundObserved:after.some(x=>x.high>low)},
   confirmed:false,
   reason:"C_LOW_CANDIDATE_ONLY_ENGINE22_CONFIRMATION_REQUIRED",
   noExecution:true,noCanonicalPromotion:true,
 };
}
