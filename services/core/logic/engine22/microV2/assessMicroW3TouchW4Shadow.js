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
 const start=typeof w2Time==="string"?Date.parse(w2Time):NaN;
 if(!Number.isFinite(start))return {...base,reasonCodes:["W2_SOURCE_CANDLE_TIMESTAMP_REQUIRED"]};
 const eligible=normalized.filter(b=>b.ms>=start);
 const touch=eligible.find(b=>b.high>=target);
 if(!touch)return {...base,w3OneToOne:{target,touched:false,countId},
   reasonCodes:["W3_TARGET_NOT_TOUCHED_IN_AVAILABLE_COMPLETED_HISTORY"]};
 const following=eligible.filter(b=>b.ms>touch.ms);
 // Reversal candidate only: this is not Elliott W3 completion confirmation.
 const lowerCloses=following.length>=2&&
   following.at(-1).close<following.at(-2).close&&
   following.at(-2).close<touch.close;
 return {...base,available:true,
   w3OneToOne:{target,touched:true,status:"TOUCHED",
     firstTouchTimestamp:new Date(touch.ms).toISOString(),
     sourceBarId:`ES:10m:${new Date(touch.ms).toISOString()}`,countId},
   w4DownCandidate:lowerCloses,
   reasonCodes:[lowerCloses?"REVERSAL_CANDIDATE_NOT_CONFIRMED":"W3_TARGET_TOUCH_EVIDENCE_ONLY"]};
}
