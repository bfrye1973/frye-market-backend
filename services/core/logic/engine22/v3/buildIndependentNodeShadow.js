// Engine 22 V3 — independent closed-candle node observation. READ-ONLY.
// Missing history is explicitly unavailable: never substitute another degree's data.
import { detectEngine22V3SwingEvidence } from "./detectSwingEvidence.js";
import { proposeEngine22V3WaveCandidate } from "./proposeWaveCandidate.js";
import { ENGINE22_V3_DEGREES } from "./canonicalStructure.js";

export const DEGREE_CANDLE_TIMEFRAMES = Object.freeze({
  INTRADAY_SUBMICRO:"5m", MICRO:"10m", SUBMINUTE:"1h", MINUTE:"4h",
  MINOR:"1d", INTERMEDIATE:"1w", PRIMARY:"1mo",
});
const DURATION_MS = Object.freeze({"5m":300000,"10m":600000,"1h":3600000,
  "4h":14400000,"1d":86400000,"1w":604800000,"1mo":null});
const finite = v=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v));
function normalize(b,tf,evaluationTimeMs){
  const raw=b?.time??b?.t??b?.tSec??b?.sourceTimestamp;
  let t;
  if(typeof raw==="string"&& !/^\d+$/.test(raw))t=Date.parse(raw);
  else if(finite(raw)){const n=Number(raw);t=n>1e12?n:n*1000;}
  if(!Number.isFinite(t))return null;
  const high=b?.high??b?.h,low=b?.low??b?.l;
  if(!finite(high)||!finite(low)||Number(high)<Number(low))return null;
  // Never infer finality for monthly bars with variable durations.
  const duration=DURATION_MS[tf];
  const completed=b?.closed===true ||
    (b?.closed!==false && duration!=null && Number.isFinite(evaluationTimeMs) &&
       t+duration<=evaluationTimeMs);
  if(!completed)return null;
  const timestamp=new Date(t).toISOString();
  return {sourceTimestamp:timestamp,sourceBarId:`ES:${tf}:${timestamp}`,
    timeframe:tf,high:Number(high),low:Number(low),closed:true};
}
function prepare(bars,tf,evaluationTimeMs){
  if(!Array.isArray(bars)||bars.length===0)return {bars:[],reasons:["SOURCE_HISTORY_UNAVAILABLE"]};
  const normalized=bars.map(b=>normalize(b,tf,evaluationTimeMs)).filter(Boolean)
    .sort((a,b)=>Date.parse(a.sourceTimestamp)-Date.parse(b.sourceTimestamp));
  if(normalized.length<5)return {bars:normalized,reasons:["INSUFFICIENT_COMPLETED_BARS"]};
  if(normalized.some((b,i)=>i>0&&b.sourceTimestamp===normalized[i-1].sourceTimestamp))
    return {bars:[],reasons:["DUPLICATE_SOURCE_CANDLE_IDENTITY"]};
  return {bars:normalized,reasons:[]};
}
function waveStart(state){
  const a=state?.anchors||{};
  const wave=state?.activeWave;
  const key=wave==="W2"?"W1_HIGH":wave==="W3"?"W2_LOW":
    wave==="W4"?"W3_HIGH":wave==="W5"?"W4_LOW":"W1_LOW";
  return a[key]?.time||null;
}
function direction(state){
  const a=state?.anchors||{};
  if(finite(a.W1_LOW?.price)&&finite(a.W1_HIGH?.price))
    return Number(a.W1_HIGH.price)>Number(a.W1_LOW.price)?"UP":"DOWN";
  return null;
}
export function buildEngine22V3IndependentNodeShadow({
  canonical=null,barsByTf=null,evaluationTimeMs=null,
}={}){
  if(!canonical?.degrees)return {available:false,shadowOnly:true,reasonCodes:["CANONICAL_REQUIRED"],degrees:{}};
  const degrees={};
  for(const degree of ENGINE22_V3_DEGREES){
    const tf=DEGREE_CANDLE_TIMEFRAMES[degree],state=canonical.degrees[degree];
    const input=barsByTf?.[tf];
    const {bars,reasons}=prepare(input,tf,evaluationTimeMs);
    const item={degree,sourceTimeframe:tf,sourceCandleCount:bars.length,
      latestCompletedCandle:bars.at(-1)?.sourceTimestamp||null,
      nodeEvidenceAvailable:false,sourceCandleIds:bars.map(b=>b.sourceBarId),
      detectedNodes:{HIGH:[],LOW:[]},waveCandidate:null,
      reasonCodes:[...reasons],shadowOnly:true,noExecution:true,
      noPermissionCreated:true,anchorPromotionAllowed:false,
      officialFibAuthorityChanged:false};
    if(reasons.length===0){
      const highs=detectEngine22V3SwingEvidence({bars,side:"HIGH"});
      const lows=detectEngine22V3SwingEvidence({bars,side:"LOW"});
      item.nodeEvidenceAvailable=highs.available&&lows.available;
      item.detectedNodes={HIGH:highs.candidates,LOW:lows.candidates};
      const c=proposeEngine22V3WaveCandidate({degreeState:{
        ...state,sequenceDirection:direction(state),waveStartTimestamp:waveStart(state),
      },bars});
      item.waveCandidate=c.available?c.candidate:null;
      item.reasonCodes.push(...c.reasonCodes);
    }
    degrees[degree.toLowerCase()]=item;
  }
  return {available:true,shadowOnly:true,noExecution:true,noPermissionCreated:true,
    anchorPromotionAllowed:false,officialFibAuthorityChanged:false,degrees};
}
