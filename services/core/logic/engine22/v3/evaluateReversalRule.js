// Deterministic completed-bar reversal evidence for Engine22 V3.
// This is an objective threshold check, NOT independently sufficient to
// establish Elliott sequence identity or parent-wave completion.
const finite=v=>typeof v==="number"&&Number.isFinite(v);
export function evaluateEngine22V3ReversalRule({
  candidate=null,bars=[],minimumReversalTicks=8,tickSize=0.25,
}={}){
  const fail=reason=>({passed:false,reasonCodes:[reason],evidence:null});
  if(!candidate||!["HIGH","LOW"].includes(candidate.side)||
     !finite(candidate.price)||candidate.price<=0)
    return fail("VALID_PIVOT_REQUIRED");
  if(!Number.isInteger(minimumReversalTicks)||minimumReversalTicks<1||
     !finite(tickSize)||tickSize<=0)return fail("INVALID_REVERSAL_CONFIGURATION");
  if(!Array.isArray(bars)||bars.length<3)return fail("CLOSED_BARS_REQUIRED");
  let previous=-Infinity,seenIds=new Set();
  for(const bar of bars){
    const time=Date.parse(bar?.sourceTimestamp);
    if(!bar||bar.closed!==true||!finite(bar.close)||!finite(bar.high)||
       !finite(bar.low)||bar.high<bar.low||bar.close>bar.high||
       bar.close<bar.low||!Number.isFinite(time)||time<=previous||
       !bar.sourceBarId||seenIds.has(bar.sourceBarId))
      return fail("INVALID_OR_DUPLICATE_CLOSED_BAR");
    previous=time;seenIds.add(bar.sourceBarId);
  }
  const index=bars.findIndex(b=>b.sourceBarId===candidate.sourceBarId);
  if(index<0)return fail("CANDIDATE_SOURCE_NOT_FOUND");
  if(bars[index].sourceTimestamp!==candidate.sourceTimestamp)
    return fail("PIVOT_SOURCE_TIMESTAMP_MISMATCH");
  if(candidate.side==="HIGH"&&bars[index].high!==candidate.price||
     candidate.side==="LOW"&&bars[index].low!==candidate.price)
    return fail("PIVOT_PRICE_MISMATCH");
  const after=bars.slice(index+1);
  if(after.length<2)return fail("POST_PIVOT_OBSERVATIONS_REQUIRED");
  const threshold=minimumReversalTicks*tickSize;
  const confirming=after.find(b=>candidate.side==="HIGH"?
    b.close<=candidate.price-threshold:
    b.close>=candidate.price+threshold);
  if(!confirming)return fail("MINIMUM_REVERSAL_NOT_CONFIRMED");
  return {passed:true,reasonCodes:["CLOSED_BAR_REVERSAL_THRESHOLD_MET"],
    evidence:{pivotBarId:candidate.sourceBarId,
      confirmingBarId:confirming.sourceBarId,
      confirmingTimestamp:confirming.sourceTimestamp,
      minimumReversalTicks,tickSize,
      structuralElliottCompletionConfirmed:false}};
}
