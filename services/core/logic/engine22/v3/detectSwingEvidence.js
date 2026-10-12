// Engine22 V3 — closed-bar structural swing evidence only.
// This is NOT Elliott-wave confirmation. Pure, deterministic, no state writes.
// The right-hand confirmation bars prevent accepting an unconfirmed live pivot.
const number=v=>typeof v==="number" && Number.isFinite(v);
const stamp=v=>{const n=Date.parse(v);return Number.isFinite(n)?n:null;};
export function detectEngine22V3SwingEvidence({bars=[],left=2,right=2,side="HIGH"}={}){
 if(!Array.isArray(bars)||bars.length<left+right+1 || !Number.isInteger(left) ||
    !Number.isInteger(right)||left<1||right<1||!["HIGH","LOW"].includes(side))
   return {available:false,reasonCodes:["INSUFFICIENT_OR_INVALID_BARS"],candidates:[]};
 const ordered=bars.map((b,i)=>({...b,_index:i,_ms:stamp(b?.sourceTimestamp)}));
 if(ordered.some(b=>b.closed!==true||!number(b.high)||!number(b.low)||
    b.high<b.low||b._ms===null||!b.sourceBarId||!b.timeframe))
   return {available:false,reasonCodes:["INVALID_OR_INCOMPLETE_SOURCE_BAR"],candidates:[]};
 if(ordered.some((b,i)=>i>0 && b._ms<=ordered[i-1]._ms))
   return {available:false,reasonCodes:["NON_MONOTONIC_OR_DUPLICATED_SOURCE_BAR"],candidates:[]};
 const key=side==="HIGH"?"high":"low",candidates=[];
 for(let i=left;i<ordered.length-right;i++){
  const p=ordered[i][key],preceding=ordered.slice(i-left,i);
  const following=ordered.slice(i+1,i+1+right);
  const confirmed=side==="HIGH"?
    preceding.every(b=>p>b.high)&&following.every(b=>p>b.high):
    preceding.every(b=>p<b.low)&&following.every(b=>p<b.low);
  if(confirmed)candidates.push({
    side,price:p,sourceTimestamp:ordered[i].sourceTimestamp,
    sourceBarId:ordered[i].sourceBarId,sourceTimeframe:ordered[i].timeframe,
    confirmationTimestamp:following[following.length-1].sourceTimestamp,
    rightConfirmationBars:right,
    status:"PIVOT_EVIDENCE_ONLY",waveCompletionConfirmed:false,
  });
 }
 return {available:true,reasonCodes:["CLOSED_BAR_PIVOT_EVIDENCE_ONLY"],candidates};
}
