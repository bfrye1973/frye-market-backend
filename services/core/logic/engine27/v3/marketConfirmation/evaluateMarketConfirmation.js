import {MARKET_CONFIRMATION_SCHEMA, ENGINE29_ELIGIBLE_DEGREES, QUALIFIED_REACTIONS, CANDIDATE_REACTIONS} from "../contracts/marketConfirmation.v1.js";

const fresh = (when, now, maxAge) => {
  if(typeof when !== "string" || !when.trim()) return false;
  const t = Date.parse(when);
  return Number.isFinite(t) && t <= now && (now-t) <= maxAge;
};
const unavailable = (source,reasonCodes) => ({source,availability:"UNAVAILABLE",state:"UNAVAILABLE",reasonCodes});
const report = (source,record,state,asOf,extra={}) => ({
  source,availability:"CURRENT",state,asOf,reasonCodes:[],...extra
});
function evaluateEngine25(src,now){
  if(src?.ok !== true) return unavailable("ENGINE25_CONTEXT",["ENGINE25_SOURCE_UNAVAILABLE"]);
  if(!fresh(src.updatedAt,now,90*60000)) return unavailable("ENGINE25_CONTEXT",["ENGINE25_STALE_OR_INVALID_TIMESTAMP"]);
  if(typeof src.regime !== "string" || !src.regime.trim()) return unavailable("ENGINE25_CONTEXT",["ENGINE25_REGIME_UNAVAILABLE"]);
  return report("ENGINE25_CONTEXT",src,src.regime,src.updatedAt,{riskLevel:src.riskLevel??null,summary:src.summary??null});
}
function evaluateEngine29(src,degree,now){
  if(!ENGINE29_ELIGIBLE_DEGREES.includes(degree))return {source:"ENGINE29_CROSS_MARKET_STRESS",availability:"NOT_APPLICABLE",state:"NOT_APPLICABLE",reasonCodes:["ENGINE29_AUTHORITY_RESTRICTED"]};
  if(!src || typeof src !== "object")return unavailable("ENGINE29_CROSS_MARKET_STRESS",["ENGINE29_SOURCE_UNAVAILABLE"]);
  if(src.dataDegraded===true || !fresh(src.timestamp,now,90*60000))return unavailable("ENGINE29_CROSS_MARKET_STRESS",["ENGINE29_STALE_OR_DEGRADED"]);
  if(typeof src.overallState!=="string" || !src.overallState.trim())return unavailable("ENGINE29_CROSS_MARKET_STRESS",["ENGINE29_STATE_UNAVAILABLE"]);
  return report("ENGINE29_CROSS_MARKET_STRESS",src,src.overallState,src.timestamp,{
    tacticalState:src.tacticalState??null,fastTacticalState:src.fastTacticalState??null,
    liquidity:src.marketCharacter?.liquidity?.state??null,trap:src.marketCharacter?.trap?.state??null,
    underlyingPressure:src.moveCharacter?.underlyingPressure?.state??null
  });
}
function evaluateCrossMarket(key,levels,reactions,now){
  const symbol=key==="VIX"?"I:VIX":"QQQ";
  const level=levels?.instruments?.[key];
  if(level?.available!==true || level.symbol!==symbol || !Array.isArray(level.levels) || !level.levels.length)
    return unavailable("ENGINE27_"+key+"_LEVELS",["LEVEL_SOURCE_UNAVAILABLE"]);
  // Daily level freshness allows weekend trading breaks; hourly reaction freshness is separate.
  if(!fresh(level.lastCandleTime,now,4*86400000))return unavailable("ENGINE27_"+key+"_LEVELS",["LEVEL_SOURCE_STALE"]);
  const read=reactions?.instruments?.[key];
  if(read?.sourceSymbol!==symbol || read?.timeframe!=="1h" || !Array.isArray(read.events))
    return {source:"ENGINE27_"+key+"_POLYGON_DIRECT_1H",availability:"PARTIAL",state:"REACTIONS_UNAVAILABLE",
      levelCount:level.levels.length,reasonCodes:["COMPLETED_HOURLY_REACTIONS_UNAVAILABLE"]};
  if(!fresh(read.lastCompletedAt,now,90*60000))
    return {source:"ENGINE27_"+key+"_POLYGON_DIRECT_1H",availability:"PARTIAL",state:"REACTIONS_STALE",
      levelCount:level.levels.length,reasonCodes:["REACTION_CANDLE_STALE"]};
  const permitted=read.events.filter(e=>e?.source==="POLYGON_DIRECT_1h" && typeof e?.time==="string" &&
    fresh(e.time,now,90*60000) && [...QUALIFIED_REACTIONS,...CANDIDATE_REACTIONS].includes(e.event));
  const confirmed=permitted.filter(e=>QUALIFIED_REACTIONS.includes(e.event));
  const candidates=permitted.filter(e=>CANDIDATE_REACTIONS.includes(e.event));
  return {source:"ENGINE27_"+key+"_POLYGON_DIRECT_1H",availability:"CURRENT",state:confirmed.length?"CONFIRMED_REACTION_OBSERVED":candidates.length?"CANDIDATE_REACTION_ONLY":"NO_QUALIFIED_REACTION",
    levelCount:level.levels.length,asOf:read.lastCompletedAt,confirmedEvents:confirmed.map(e=>({event:e.event,time:e.time,id:e.id??null})),
    candidateEvents:candidates.map(e=>({event:e.event,time:e.time,id:e.id??null})),
    reasonCodes:confirmed.length?[]:candidates.length?["CANDIDATE_NOT_CONFIRMED"]:["NO_QUALIFIED_REACTION"]};
}
function evaluateEsZones(src){
  if(src?.available!==true || src?.symbol!=="ES" || !Array.isArray(src.institutionalParents) || !Array.isArray(src.negotiatedZones))
    return unavailable("ENGINE1_ES_MANUAL_SMZ",["ES_ZONES_UNAVAILABLE"]);
  const zones=[...src.institutionalParents,...src.negotiatedZones];
  if(!zones.every(z=>Number.isFinite(z?.upper)&&Number.isFinite(z?.lower)&&z.upper>z.lower))
    return unavailable("ENGINE1_ES_MANUAL_SMZ",["ES_ZONE_GEOMETRY_INVALID"]);
  return {source:"ENGINE1_ES_MANUAL_SMZ",availability:"PARTIAL",state:"ZONE_GEOMETRY_ONLY",institutionalCount:src.institutionalParents.length,negotiatedCount:src.negotiatedZones.length,
    reasonCodes:["VERIFIED_ES_ZONE_REACTIONS_NOT_SUPPLIED"]};
}
export function evaluateMarketConfirmation({degree="micro",symbol="ES",evaluatedAt=null,engine25=null,engine29=null,crossMarketLevels=null,crossMarketReactions=null,esInstitutionalContext=null}={}){
  const now=Date.parse(evaluatedAt??"");
  const base={schema:MARKET_CONFIRMATION_SCHEMA,mode:"READ_ONLY",degree,symbol,available:false,state:"UNAVAILABLE",
    authority:{structural:"ENGINE22",primaryPrice:"ES",participation:"ENGINE25",tactical:"ENGINE29_MICRO_SUBMICRO_ONLY",crossMarket:"CONTEXT_ONLY"},
    sources:{},reasonCodes:[],noPermissionCreated:true,noSizingCreated:true,noExecution:true,noJournalWrite:true};
  if(symbol!=="ES" || !Number.isFinite(now))return {...base,reasonCodes:["ES_IDENTITY_OR_EVALUATION_TIME_INVALID"]};
  const sources={engine25:evaluateEngine25(engine25,now),engine29:evaluateEngine29(engine29,degree,now),
    qqq:evaluateCrossMarket("QQQ",crossMarketLevels,crossMarketReactions,now),
    vix:evaluateCrossMarket("VIX",crossMarketLevels,crossMarketReactions,now),
    esZones:evaluateEsZones(esInstitutionalContext)};
  const applicable=Object.values(sources).filter(s=>s.availability!=="NOT_APPLICABLE");
  const current=applicable.filter(s=>s.availability==="CURRENT").length;
  const state=current===0?"UNAVAILABLE":current===applicable.length?"CONTEXT_AVAILABLE":"PARTIAL";
  return {...base,available:current>0,state,sources,reasonCodes:state==="CONTEXT_AVAILABLE"?[]:["MARKET_EVIDENCE_PARTIAL_OR_UNAVAILABLE"]};
}
