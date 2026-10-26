// Canonical Engine25 & Engine29 read-only transport adapter.
// Engine25 owns scanner/session rules; Engine29 owns tactical market signals.
const validTime=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
export function assembleCanonicalOwnerMarket({engine25Dashboard=null,engine29Response=null,now=null}={}){
 const reasons=[];
 const participation=engine25Dashboard?.participationArtifact??null;
 const e25=engine25Dashboard?.engine25Context??null;
 const pValid=participation?.schema==="engine25.participation@1"&&participation?.authority?.owner==="ENGINE25"&&
  participation?.freshness&&typeof participation.freshness.usableForTrapConfirmation==="boolean"&&
  participation?.participation?.breadth&&participation?.participation?.stockVolume&&participation?.participation?.distributionPressure;
 const closed=pValid&&participation.freshness.state==="LAST_VALID_EQUITY_READ"&&participation.freshness.reason==="EQUITY_SESSION_CLOSED";
 const active=pValid&&participation.freshness.state==="FRESH"&&participation.freshness.usableForTrapConfirmation===true&&
  participation.freshness.equityScannerSession?.active===true;
 if(!pValid)reasons.push("ENGINE25_CANONICAL_PARTICIPATION_MISSING_OR_INVALID");
 else if(closed)reasons.push("ENGINE25_LAST_VALID_EQUITY_READ_CONTEXT_ONLY");
 else if(!active)reasons.push("ENGINE25_PARTICIPATION_NOT_LIVE_QUALIFIED");
 let engine25=null;
 // Regime is a separate informational context; it never upgrades closed equity participation.
 if(e25?.ok===true&&validTime(e25.updatedAt)&&typeof e25.regime==="string")
  engine25={ok:true,regime:e25.regime,riskLevel:e25.riskLevel??null,updatedAt:e25.updatedAt,summary:e25.summary??null};
 const t=Date.parse(now??""),j=engine29Response?.data;
 let engine29=null;
 const stateTime=Date.parse(j?.timestamp??"");
 if(engine29Response?.ok===true&&typeof j?.overallState==="string"&&validTime(j?.timestamp)&&Number.isFinite(t)&&
 stateTime<=t&&t-stateTime<=300000&&j?.dataDegraded!==true&&j?.dataQuality&&typeof j.dataQuality==="object"){
  engine29=j;
 }else if(j?.dataDegraded===true)reasons.push("ENGINE29_CANONICAL_DATA_DEGRADED");
 else if(engine29Response?.ok!==true||!j)reasons.push("ENGINE29_CANONICAL_SOURCE_UNAVAILABLE");
 else if(!validTime(j.timestamp))reasons.push("ENGINE29_TIMESTAMP_INVALID");
 else if(Number.isFinite(t)&&(stateTime>t||t-stateTime>300000))reasons.push("ENGINE29_CANONICAL_STALE");
 else reasons.push("ENGINE29_CANONICAL_CONTRACT_INVALID");
 return {engine25,engine29,participationState:{
  source:"ENGINE25_PARTICIPATION_CANONICAL",schema:participation?.schema??null,
  state:!pValid?"UNAVAILABLE":closed?"LAST_VALID_EQUITY_READ":active?"FRESH":participation.freshness.state??"UNAVAILABLE",
  reason:participation?.freshness?.reason??null,
  liveConfirmationUsable:!!active,contextOnly:!!closed,
  equityScannerSession:participation?.freshness?.equityScannerSession?.session??null,
  systemOperatingSession:participation?.freshness?.systemOperatingSession?.session??null,
  reasonCodes:reasons.filter(x=>x.startsWith("ENGINE25_"))
 },reasonCodes:reasons};
}
