// Engine27 read-only outcome scoring. Contract continuity must be asserted by
// an original-time accepted provenance, never inferred from root ES or today's resolver.
const ms=x=>typeof x==="string"&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
export function scoreWaveOutcomes({eventClosedAt,eventPrice,bars=[],contractIdentityVerified=false,
  asOf,maximumDelayMinutes=5}={}){
 const start=ms(eventClosedAt),now=ms(asOf);
 if(start===null||now===null||!Number.isFinite(eventPrice)||
  !Number.isInteger(maximumDelayMinutes)||maximumDelayMinutes<0||maximumDelayMinutes>10)
  return {ok:false,reason:"INVALID_OUTCOME_INPUT"};
 const out={};
 const ordered=bars.filter(x=>typeof x.time==="number"&&Number.isFinite(x.close))
  .sort((a,b)=>a.time-b.time);
 for(const horizon of [10,30,60]){
  const target=start+horizon*60000;
  const key=horizon+"m";
  if(target>now){out[key]={status:"PENDING",targetAt:new Date(target).toISOString()};continue}
  const found=ordered.find(b=>b.time*1000>=target&&b.time*1000<=target+maximumDelayMinutes*60000);
  if(!found){out[key]={status:"OUTCOME_MISSING",targetAt:new Date(target).toISOString()};continue}
  out[key]={status:contractIdentityVerified?"QUALIFIED_SAME_CONTRACT":"CONTRACT_CONTINUITY_UNVERIFIED",
   targetAt:new Date(target).toISOString(),observedAt:new Date(found.time*1000).toISOString(),
   delaySeconds:(found.time*1000-target)/1000,observedClose:found.close,
   deltaPoints:Number((found.close-eventPrice).toFixed(4)),
   statisticalEligibility:contractIdentityVerified};
 }
 return {ok:true,schema:"engine27.v6.waveOutcomeStudy.v1",eventClosedAt,eventPrice,
  horizons:out,noExecution:true,noWaveAuthority:true};
}
