// Engine22: read-only legacy operational Micro (visible SUBMICRO) W3 touch/W4 candidate.
// Never updates canonical state, marks, execution, or official Fibonacci authority.
export function assessMicroW3TouchW4Shadow({transition=null,bars=[],evaluationTimeMs=null}={}){
 const base={available:false,shadowOnly:true,noPermissionCreated:true,noExecution:true,
   noAnchorPromotion:true,w3OneToOne:null,w4DownCandidate:false,reasonCodes:[]};
 const target=transition?.w3Up?.levels?.find(l=>l.key==="e1000")?.price;
 const anchor=transition?.anchors?.w2Low;
 const countId=transition?.sourceCountId??null;
 if(!transition?.available||!Number.isFinite(target)||!Number.isFinite(anchor)||!countId)
   return {...base,reasonCodes:["CANONICAL_W3_PROJECTION_REQUIRED"]};
 if(!Array.isArray(bars)||!Number.isFinite(evaluationTimeMs))
   return {...base,reasonCodes:["COMPLETED_CANDLE_HISTORY_REQUIRED"]};
 const normalized=bars.map(b=>{
   const t=Number(b?.time??b?.t);
   const ms=t>1e12?t:t*1000;
   const h=Number(b?.high??b?.h),l=Number(b?.low??b?.l),c=Number(b?.close??b?.c);
   return {ms,high:h,low:l,close:c,closed:b?.closed};
 }).filter(b=>Number.isFinite(b.ms)&&Number.isFinite(b.high)&&Number.isFinite(b.low)&&
   Number.isFinite(b.close)&&b.high>=b.low&&b.high>=b.close&&b.low<=b.close&&
   b.closed!==false&&b.ms+600000<=evaluationTimeMs)
   .sort((a,b)=>a.ms-b.ms);
 if(normalized.length<5)return {...base,reasonCodes:["INSUFFICIENT_COMPLETED_10M_HISTORY"]};
 if(normalized.some((b,i)=>i>0&&b.ms<=normalized[i-1].ms))
   return {...base,reasonCodes:["NON_UNIQUE_CANDLE_TIMESTAMPS"]};
 // The canonical record lacks a guaranteed W2 source candle. Do not infer an
 // exact post-W2 touch without its independently established start time.
 const w2Time=transition?.anchors?.w2SourceTimestamp;
 let start=typeof w2Time==="string"?Date.parse(w2Time):NaN;
 let w2SourceQuality="CANONICAL_W2_SOURCE";
 if(!Number.isFinite(start)&&transition?.w2Down?.state==="LOCKED"){
   // Strict observational fallback: one and only one closed 10m local-low
   // candle matching the independently locked W2 price. Not anchor authority.
   const candidates=normalized.filter((b,i)=>i>=2&&i+2<normalized.length&&
     Math.abs(b.low-anchor)<0.001&&
     normalized[i-2].low>b.low&&normalized[i-1].low>b.low&&
     normalized[i+1].low>b.low&&normalized[i+2].low>b.low);
   if(candidates.length===1){
     start=candidates[0].ms;
     w2SourceQuality="INFERRED_UNAPPROVED_PRICE_MATCHED_PIVOT";
   }else return {...base,reasonCodes:[candidates.length===0?
     "W2_SOURCE_CANDLE_TIMESTAMP_REQUIRED":"AMBIGUOUS_W2_PIVOT_IDENTITY"]};
 }
 if(!Number.isFinite(start))return {...base,reasonCodes:["W2_SOURCE_CANDLE_TIMESTAMP_REQUIRED"]};
 const eligible=normalized.filter(b=>b.ms>=start);
 const touch=eligible.find(b=>b.high>=target);
 if(!touch)return {...base,w3OneToOne:{target,touched:false,countId},
   reasonCodes:["W3_TARGET_NOT_TOUCHED_IN_AVAILABLE_COMPLETED_HISTORY"]};
 // Track the highest price after the first 1.000 touch; equal highs form a
 // plateau, not a reason to hide an observed corrective retracement.
 const postTouch=eligible.filter(b=>b.ms>=touch.ms);
 const high=Math.max(...postTouch.map(b=>b.high));
 const peak=postTouch.filter(b=>Math.abs(b.high-high)<0.001).at(-1);
 const following=eligible.filter(b=>b.ms>peak.ms);
 const threshold=(peak.high-anchor)*0.236; // W3 advance retracement watch only
 const minimumClose=following.length?Math.min(...following.map(b=>b.close)):null;
 const retracement=following.length>=2 && minimumClose!=null &&
   minimumClose<=peak.high-threshold;
 const lowerCloses=retracement;
 return {...base,available:true,
   w3OneToOne:{target,touched:true,status:"TOUCHED",w2SourceQuality,
     firstTouchTimestamp:new Date(touch.ms).toISOString(),
     sourceBarId:`ES:10m:${new Date(touch.ms).toISOString()}`,countId},
   w4DownCandidate:lowerCloses,
   w4CandidateEvidence:{retracement,thresholdPoints:Number(threshold.toFixed(2)),
     minimumPostPeakClose:minimumClose,peakHigh:peak.high,
     peakTimestamp:new Date(peak.ms).toISOString(),waveCompletionConfirmed:false},
   reasonCodes:[lowerCloses?"REVERSAL_CANDIDATE_NOT_CONFIRMED":"W3_TARGET_TOUCH_EVIDENCE_ONLY"]};
}
