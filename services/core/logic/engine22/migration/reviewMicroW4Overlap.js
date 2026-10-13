// Engine22 read-only Micro W1/W4 overlap evidence.
// Candle bodies can signal rejection, but cannot cancel intrabar Elliott overlap.
// No structural promotion or persistence is performed here.
const finite = v => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
export function reviewMicroW4Overlap({w1High, w4Low, completed4hBars=[]}={}) {
 const first=finite(w1High), fourth=finite(w4Low);
 const overlap=first!=null && fourth!=null && fourth<=first;
 const bars=Array.isArray(completed4hBars)?completed4hBars:[];
 const evidence=bars.map(bar=>{
   const open=finite(bar?.open??bar?.o), high=finite(bar?.high??bar?.h),
     low=finite(bar?.low??bar?.l), close=finite(bar?.close??bar?.c);
   if([open,high,low,close].some(v=>v==null) || high<Math.max(open,close) || low>Math.min(open,close))
     return null;
   return {timestamp:bar?.time??bar?.t??null,low,bodyLow:Math.min(open,close),close,
     wickBelowW1: first!=null && low<first,bodyBelowW1:first!=null && Math.min(open,close)<first};
 }).filter(Boolean);
 return {
   classification:overlap?"STANDARD_IMPULSE_OVERLAP_REVIEW_REQUIRED":"NO_W1_W4_OVERLAP",
   w1High:first,w4Low:fourth,overlapPoints:overlap?Number((first-fourth).toFixed(2)):0,
   candleBodyEvidenceAvailable:evidence.length>0,
   anyWickBelow:evidence.some(e=>e.wickBelowW1),
   anyBodyBelow:evidence.some(e=>e.bodyBelowW1),
   evidence,
   acceptedAsStandardImpulse:!overlap,
   diagonalConfirmed:false,
   waveCountConfirmed:false,
   reasonCodes:overlap?["MICRO_W4_INTRABAR_OVERLAP_W1_TERRITORY","BODY_RECOVERY_DOES_NOT_CANCEL_ELLIOTT_OVERLAP","ALTERNATE_COUNT_OR_DIAGONAL_SUBDIVISIONS_REQUIRED"]:
     ["NO_OVERLAP_IDENTIFIED"],
 };
}
