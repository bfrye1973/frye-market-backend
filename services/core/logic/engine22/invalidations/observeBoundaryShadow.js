// Engine 22D v1: count-scoped REVIEW observations. No hard invalidation authority.
export const ENGINE22_D_SCHEMA="engine22.boundaryObservation.v1";
export function observeEngine22ReviewBoundary({countId=null,rule=null,bars=[]}={}){
 const fail=reason=>({available:false,reasonCodes:[reason],status:"UNAVAILABLE",hardInvalidationConfirmed:false,alertEligible:false,noExecution:true,shadowOnly:true});
 if(typeof countId!=="string"||!countId||/^ES-V3-BASELINE-/i.test(countId))return fail("CURRENT_COUNT_ID_REQUIRED");
 if(!rule||rule.countId!==countId||!Number.isFinite(rule.price)||rule.price<=0||
   !["ABOVE","BELOW"].includes(rule.comparison)||!["RECOUNT_REVIEW","WARNING"].includes(rule.scope)||
   !["INTRABAR","COMPLETED_CLOSE"].includes(rule.trigger)||!rule.timeframe)return fail("VALID_REVIEW_RULE_REQUIRED");
 if(!Array.isArray(bars)||bars.some((b,i)=>b?.closed!==true||b.timeframe!==rule.timeframe||
   !Number.isFinite(Date.parse(b.sourceTimestamp))||!Number.isFinite(b.close)||!Number.isFinite(b.low)||!Number.isFinite(b.high)||
   b.low>b.high||(i>0&&Date.parse(b.sourceTimestamp)<=Date.parse(bars[i-1].sourceTimestamp))))
   return fail("COMPLETED_SAME_TIMEFRAME_BARS_REQUIRED");
 const match=b=>rule.trigger==="COMPLETED_CLOSE"?
  (rule.comparison==="ABOVE"?b.close>rule.price:b.close<rule.price):
  (rule.comparison==="ABOVE"?b.high>rule.price:b.low<rule.price);
 const first=bars.find(match);
 return {available:true,schema:ENGINE22_D_SCHEMA,countId,scope:rule.scope,
  status:first?"REVIEW_OBSERVED":"NOT_OBSERVED",evidenceBarId:first?.sourceBarId??null,
  evidenceTime:first?.sourceTimestamp??null,referencePrice:rule.price,
  hardInvalidationConfirmed:false,alertEligible:false,tradePermissionEligible:false,
  noExecution:true,noPermissionCreated:true,shadowOnly:true};
}
