// Historical anchor verifier for Engine22 migration. Pure / fail-closed.
// Requires real OHLC observations supplied by canonical replay; it never invents
// candles, infers time zones, or marks Elliott impulse geometry as valid.
import {PROPOSED_MICRO_ANCHORS} from "./proposedSevenDegreeReconciliation.js";
const anchors=["w1Low","w1High","w2Low","w3High","w4Low"];
const rawTime=(a)=>`${a.date} ${a.time}`;
const numeric=(x)=>x===null||x===undefined||x===""?null:Number(x);
export function verifyProposedMicroAnchorsAgainstBars({
 bars=[],timeZoneVerified=false,sourceIdentity=null,tickSize=0.25
}={}){
 const matches={};const reasons=[];
 if(!timeZoneVerified)reasons.push("HISTORICAL_TIMEZONE_UNVERIFIED");
 if(!String(sourceIdentity||"").trim())reasons.push("HISTORICAL_OHLC_SOURCE_ID_REQUIRED");
 if(!Array.isArray(bars)||!bars.length)reasons.push("HISTORICAL_BARS_MISSING");
 for(const key of anchors){
  const mark=PROPOSED_MICRO_ANCHORS.marks[key],expected=rawTime(mark);
  const matched=Array.isArray(bars)?bars.filter(b=>
    String(b?.localTime||"").trim()===expected):[];
  if(matched.length!==1){
    matches[key]={status:"UNVERIFIED",expectedPrice:mark.price,expectedLocalTime:expected};
    reasons.push(`HISTORICAL_${key.toUpperCase()}_BAR_IDENTITY_UNVERIFIED`);
    continue;
  }
  const bar=matched[0],high=numeric(bar.high),low=numeric(bar.low);
  const validBar=Number.isFinite(high)&&Number.isFinite(low)&&high>=low&&
    Number.isFinite(numeric(bar.open))&&Number.isFinite(numeric(bar.close))&&
    high>=Math.max(Number(bar.open),Number(bar.close))&&
    low<=Math.min(Number(bar.open),Number(bar.close));
  const isLow=key.endsWith("Low"),price=isLow?low:high;
  const aligned=validBar&&Math.abs(price-mark.price)<tickSize/2;
  matches[key]={status:aligned?"BAR_MATCHED":"PRICE_OR_OHLC_MISMATCH",
    expectedPrice:mark.price,expectedLocalTime:expected,observedPrice:validBar?price:null,
    sourceBarId:bar.id??null};
  if(!aligned) reasons.push(`HISTORICAL_${key.toUpperCase()}_BAR_PRICE_MISMATCH`);
  if(bar.id==null)reasons.push(`HISTORICAL_${key.toUpperCase()}_BAR_ID_REQUIRED`);
 }
 return {verified:reasons.length===0,reasonCodes:[...new Set(reasons)],marks:matches,
  sourceIdentity:sourceIdentity||null,timeZoneVerified:!!timeZoneVerified,
  doesNotValidateImpulseGeometry:true,publicationEligible:false};
}
