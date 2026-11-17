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
   return {close:n(Number(b?.close)),high:n(Number(b?.high)),
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
 const seed=established&&reactionAnchor!==null&&finalFive
   ? {establishedNow:true,direction:v5Direction,reactionAnchor,
       establishedAtMs:finalFive.closeTimeMs}:null;
 const result=evaluateEngine3V6Phase1({
   priorState,candidateId,zoneId,
   observedControl:v5?.evidence?.priceAction?.controlState??"NO_CONTROL",
   observedQuality:v5?.evidence?.priceAction?.quality??"WEAK",
   completed1m:one,completed5m:five,evaluationTimeMs,
   seedFromV5:seed,openTradeActive,lockedTradeDirection,policy,
   evidence:{noProgress:false,highOverlap:false,opposingReaction:false,
     completed5mAbsorption:false},
 });
 return {...result,
   reactionAnchorBasis:result.establishedNow
     ?"PROVISIONAL_LATEST_COMPLETED_5M_EXTREME_PHASE1"
     :priorState?.reactionAnchorBasis??"UNVERIFIED",
   policyStatus:policy?"EXPERIMENTAL_SHADOW_POLICY":"NO_EXPERIMENTAL_POLICY",
   rawBarHistoryArchived:false,
   stage:"PHASE1_SHADOW_ONLY",
   v5CanonicalDirection:v5Direction,
   noCanonicalPromotion:true,noEngine4Authority:true,noEngine6Authority:true};
}
export default buildEngine3V6Phase1Shadow;
