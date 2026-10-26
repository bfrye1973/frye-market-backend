// Label only a later, same-contract verified observation; never change T0 evidence.
const finite=x=>typeof x==="number"&&Number.isFinite(x);
export function labelEsOutcome(seed,observations,{thresholdPoints=2,toleranceMs=60000}={}){
 if(!seed?.id||!/^ES[FGHJKMNQUVXZ]\d{1,2}$/.test(seed.resolvedEsContract)||
    !finite(seed.predictionPrice)||!Number.isFinite(Date.parse(seed.predictionTimestampUtc))||
    !finite(thresholdPoints)||thresholdPoints<=0||!finite(toleranceMs)||toleranceMs<0)
  return {available:false,reason:"INVALID_SEED_OR_POLICY"};
 const target=Date.parse(seed.predictionTimestampUtc)+seed.horizonMinutes*60000;
 const candidates=(Array.isArray(observations)?observations:[]).filter(x=>
   x.contract===seed.resolvedEsContract&&finite(x.price)&&x.price>0&&
   Number.isFinite(Date.parse(x.observedAt))&&Date.parse(x.observedAt)>=target&&
   Date.parse(x.observedAt)<=target+toleranceMs).sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
 if(!candidates.length)return {available:false,reason:"INSUFFICIENT_SAME_CONTRACT_OUTCOME_DATA",targetAt:new Date(target).toISOString()};
 const observed=candidates[0],delta=Number((observed.price-seed.predictionPrice).toFixed(4));
 return Object.freeze({schema:"engine27.v3.probabilityOutcome.v1",predictionId:seed.id,
  horizonMinutes:seed.horizonMinutes,targetAt:new Date(target).toISOString(),
  observedAt:observed.observedAt,resolvedEsContract:seed.resolvedEsContract,
  observedPrice:observed.price,returnPoints:delta,
  outcome:delta>thresholdPoints?"UP":delta< -thresholdPoints?"DOWN":"SIDEWAYS",
  thresholdPoints,available:true,noExecution:true});
}
