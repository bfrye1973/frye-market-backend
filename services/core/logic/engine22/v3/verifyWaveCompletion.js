import {evaluateEngine22V3ReversalRule} from "./evaluateReversalRule.js";
// Engine22 V3: independent structural completion verifier for a confirmed
// closed-bar pivot. This is the evidence gate, not a trade signal.
const validTime=t=>typeof t==="string"&&Number.isFinite(Date.parse(t));
export function verifyEngine22V3WaveCompletion({degreeState=null,candidate=null,bars=[]}={}){
 const errors=[];
 if(!degreeState||!candidate||degreeState.countId!==candidate.countId||
    degreeState.degreeId!==candidate.degreeId||degreeState.activeWave!==candidate.activeWave)
   return {verified:false,reasonCodes:["COUNT_DEGREE_WAVE_IDENTITY_MISMATCH"],proof:null};
 const expectedSide=(["W1","W3","W5"].includes(degreeState.activeWave)) ===
   (degreeState.sequenceDirection==="UP") ? "HIGH" : "LOW";
 if(candidate.side!==expectedSide)errors.push("WAVE_PIVOT_SIDE_MISMATCH");
 if(!["UP","DOWN"].includes(degreeState.sequenceDirection) ||
    candidate.sequenceDirection!==degreeState.sequenceDirection)
   errors.push("DIRECTION_MISMATCH");
 if(!Array.isArray(bars)||bars.length<3)errors.push("CONFIRMATION_BARS_REQUIRED");
 if(!validTime(candidate.sourceTimestamp)||!validTime(candidate.evidenceConfirmedAt))
   errors.push("CANDIDATE_TIME_INVALID");
 if(!Number.isFinite(candidate.price)||candidate.price<=0)errors.push("CANDIDATE_PRICE_INVALID");
 if(errors.length)return {verified:false,reasonCodes:errors,proof:null};
 const pivot=bars.find(b=>b.sourceBarId===candidate.sourceBarId);
 if(bars.some(b=>b.timeframe!==candidate.sourceTimeframe))
   errors.push("MIXED_TIMEFRAME_EVIDENCE");
 if(bars.some((b,i)=>i>0&&Date.parse(b.sourceTimestamp)<=Date.parse(bars[i-1].sourceTimestamp)))
   errors.push("NON_MONOTONIC_EVIDENCE");
 const confirmed=bars.find(b=>b.sourceTimestamp===candidate.evidenceConfirmedAt);
 if(!pivot||!confirmed||pivot.closed!==true||confirmed.closed!==true||
    pivot.timeframe!==candidate.sourceTimeframe||
    confirmed.timeframe!==candidate.sourceTimeframe)
   errors.push("CLOSED_SOURCE_BARS_NOT_FOUND");
 if(!errors.length && (candidate.side==="HIGH"?pivot.high!==candidate.price:pivot.low!==candidate.price))
   errors.push("PIVOT_PRICE_MISMATCH");
 if(!errors.length && Date.parse(confirmed.sourceTimestamp)<=Date.parse(pivot.sourceTimestamp))
   errors.push("CONFIRMATION_NOT_AFTER_PIVOT");
 const reversal=evaluateEngine22V3ReversalRule({
    candidate,bars,minimumReversalTicks:degreeState.minimumReversalTicks ?? 8,
    tickSize:degreeState.tickSize ?? 0.25,
 });
 if(!reversal.passed)errors.push(...reversal.reasonCodes);
 if(reversal.passed && confirmed?.sourceBarId!==reversal.evidence.confirmingBarId)
   errors.push("CONFIRMATION_BAR_NOT_REVERSAL_BAR");
 const wave=degreeState.activeWave;
 const key=(degreeState.sequenceDirection==="UP" ?
   {W1:"W1_HIGH",W2:"W2_LOW",W3:"W3_HIGH",W4:"W4_LOW",W5:"W5_HIGH"} :
   {W1:"W1_LOW",W2:"W2_HIGH",W3:"W3_LOW",W4:"W4_HIGH",W5:"W5_LOW"})[wave];
 // Confirmed swing evidence alone is insufficient for Elliott completion:
 // require a separately established rule/evidence package bound to same count.
 const rule=degreeState.confirmationRule;
 if(!rule||typeof rule.id!=="string"||rule.passed!==true||
    rule.countId!==degreeState.countId||rule.wave!==wave||
    rule.evidenceBarId!==confirmed?.sourceBarId ||
    rule.reversalBarId!==reversal.evidence?.confirmingBarId)
   errors.push("STRUCTURAL_CONFIRMATION_RULE_NOT_MET");
 if(errors.length)return {verified:false,reasonCodes:errors,proof:null};
 return {verified:true,reasonCodes:["STRUCTURAL_COMPLETION_VERIFIED"],proof:{
   validated:true,countId:degreeState.countId,degreeId:degreeState.degreeId,
   activeWave:wave,ruleId:rule.id,anchorKey:key,
   anchor:{price:candidate.price,time:candidate.sourceTimestamp},
   sourceBarId:confirmed.sourceBarId,sourceTimestamp:confirmed.sourceTimestamp,
   reversalEvidence:reversal.evidence,
 }};
}
