// Phase 1 pure adapter: consumes the exact same 1m/5m bars and v5 result
// already assembled for Strategy 1. It never queries a market or a journal.
import {deriveCandleCompletionTruth} from "../candleCompletionTruth.js";
import {evaluateEngine3V6Phase1} from "./evaluateEngine3V6Phase1.js";

const n=x=>typeof x==="number"&&Number.isFinite(x)?x:null;
function completed(bars,timeframe,evaluationTimeMs){
 const duration=timeframe==="1m"?60000:300000;
 const result=deriveCandleCompletionTruth({bars,timeframe,evaluationTimeMs});
 return (result.completedBars??[]).map(b=>{
   const start=n(Number(b?.time??b?.t??b?.tSec));
   return {open:n(Number(b?.open)),close:n(Number(b?.close)),high:n(Number(b?.high)),
     low:n(Number(b?.low)),closeTimeMs:start!==null?start*1000+duration:null,
     completed:true};
 }).filter(b=>b.close!==null&&b.closeTimeMs!==null);
}
export function buildEngine3V6Phase1Shadow({
 priorState=null,v5=null,candidateId=null,zoneId=null,
 bars1m=[],bars5m=[],evaluationTimeMs=null,openTradeActive=false,
 lockedTradeDirection="NEUTRAL",policy=null,
}={}){
 const one=completed(bars1m,"1m",evaluationTimeMs);
 const five=completed(bars5m,"5m",evaluationTimeMs);
 const v5Direction=v5?.canonical?.canonical?.direction??v5?.canonical?.direction??"NEUTRAL";
 const established=v5?.stateMachine?.establishedNow===true&&
   v5?.validation?.valid===true&&v5?.canonical?.authoritativeDownstream!==false;
 // Phase 1 provisional anchor only. Phase 2 must replace this with a
 // post-zone-activation reaction anchor and a causal evidence proof.
 const finalFive=five.at(-1)??null;
 const reactionAnchor=established&&finalFive
   ? v5Direction==="SHORT"?finalFive.high:v5Direction==="LONG"?finalFive.low:null
   :null;
 const seed=typeof candidateId==="string"&&candidateId.length>0&&
   established&&reactionAnchor!==null&&finalFive
   ? {establishedNow:true,direction:v5Direction,reactionAnchor,
       establishedAtMs:finalFive.closeTimeMs}:null;
 const establishmentTime=n(priorState?.establishedAtMs);
 const recentOne=establishmentTime!==null
   ?one.filter(b=>b.closeTimeMs>establishmentTime).slice(-3):[];
 const overlapRatios=[];
 for(let i=1;i<recentOne.length;i++){
   const first=recentOne[i-1],second=recentOne[i];
   const intersection=Math.max(0,Math.min(first.high,second.high)-Math.max(first.low,second.low));
   // Match canonical v5 sequenceMomentum pair overlap definition:
   // intersection points / smaller candle range.
   const smallerRange=Math.min(first.high-first.low,second.high-second.low);
   if(Number.isFinite(intersection)&&Number.isFinite(smallerRange)&&smallerRange>0)
     overlapRatios.push(intersection/smallerRange);
 }
 const overlap=overlapRatios.length>=2
   ?overlapRatios.reduce((a,b)=>a+b,0)/overlapRatios.length:null;
 const elapsed=n(evaluationTimeMs)!==null&&n(priorState?.lastProgressAtMs)!==null
   ?evaluationTimeMs-priorState.lastProgressAtMs:null;
 const noProgress=elapsed!==null&&elapsed>=6*60000&&
   recentOne.length>=2;
 const completedAbsorption=establishmentTime!==null&&
   five.some(b=>b.closeTimeMs>establishmentTime)&&
   v5?.evidence?.priceAction?.controlState==="ABSORPTION";
 const observedOpposing=establishmentTime!==null&&recentOne.length>=2&&
   ((priorState?.canonicalDirection==="SHORT"&&
     v5?.evidence?.oneMinute?.completed?.reaction?.reactionBias==="UP")||
    (priorState?.canonicalDirection==="LONG"&&
     v5?.evidence?.oneMinute?.completed?.reaction?.reactionBias==="DOWN"));
 const result=evaluateEngine3V6Phase1({
   priorState,candidateId,zoneId,
   observedControl:v5?.evidence?.priceAction?.controlState??"NO_CONTROL",
   observedQuality:v5?.evidence?.priceAction?.quality??"WEAK",
   completed1m:one,completed5m:five,evaluationTimeMs,
   seedFromV5:seed,openTradeActive,lockedTradeDirection,policy,
   evidence:{noProgress,highOverlap:overlap!==null&&overlap>=0.60,
     opposingReaction:observedOpposing,completed5mAbsorption:completedAbsorption},
 });
 return {...result,
   reactionAnchorBasis:result.establishedNow
     ?"PROVISIONAL_LATEST_COMPLETED_5M_EXTREME_PHASE1"
     :priorState?.reactionAnchorBasis??"UNVERIFIED",
   policyStatus:policy?"EXPERIMENTAL_SHADOW_POLICY":"NO_EXPERIMENTAL_POLICY",
   deteriorationEvidenceDiagnostics:{noProgress,oneMinuteOverlapRatio:overlap,
     overlapFormula:"CANONICAL_V5_INTERSECTION_OVER_SMALLER_RANGE",
     completed1mReactionBias:v5?.evidence?.oneMinute?.completed?.reaction?.reactionBias??"NONE",
     opposingReaction:observedOpposing,completed5mAbsorption:completedAbsorption},
   rawBarHistoryArchived:false,
   stage:"PHASE1_SHADOW_ONLY",
   v5CanonicalDirection:v5Direction,
   noCanonicalPromotion:true,noEngine4Authority:true,noEngine6Authority:true};
}
export default buildEngine3V6Phase1Shadow;
