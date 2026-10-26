// Canonical production ES snapshot -> independent V3 market inputs.
// No inferred positive/neutral signals, no new scanner, no bar input to live price.
const freshIso = s=>typeof s==="string"&&Number.isFinite(Date.parse(s));
export function assembleSnapshotMarketSources(snapshot=null){
 const result={engine25:null,engine29:null,crossMarketLevels:null,crossMarketReactions:null,
  esInstitutionalContext:null,sourceEvidence:{schema:"engine27.v3.snapshotMarketSourceEvidence.v1",
  origin:"ENGINE27_PRODUCTION_ES_SNAPSHOT",available:false,reasonCodes:[]}};
 const evidence=result.sourceEvidence,missing=evidence.reasonCodes;
 if(snapshot?.symbol!=="ES"||snapshot?.ok===false){
  missing.push("CANONICAL_ES_SNAPSHOT_UNAVAILABLE");return result;
 }
 const s=snapshot.engine27Strategies;
 // Engine 25: canonical root data, not the legacy dashboard's derived text label.
 const e25=snapshot.engine25Context;
 if(e25?.ok===true && typeof e25.regime==="string" && freshIso(e25.updatedAt)){
  result.engine25={ok:true,regime:e25.regime,riskLevel:e25.riskLevel??null,
   updatedAt:e25.updatedAt,summary:e25.summary??null};
 }else missing.push("ENGINE25_CANONICAL_FIELDS_UNAVAILABLE");
 // Engine29: production snapshot's published V2 context is a read-only summary.
 // Require explicit availability and freshness; never fabricate a current tactical state.
 const tactic=s?.engine27UnifiedMarketContext?.tactical;
 if(tactic?.source==="ENGINE29_CROSS_MARKET_STRESS"&&tactic.available===true&&
  tactic.fresh===true&&tactic.dataDegraded!==true&&freshIso(tactic.timestamp)&&
  typeof tactic.overallState==="string"&&tactic.overallState!=="UNAVAILABLE"){
  result.engine29={timestamp:tactic.timestamp,overallState:tactic.overallState,dataDegraded:false,
   tacticalState:tactic.oneHour??null,fastTacticalState:tactic.thirtyMinute??null,
   marketCharacter:{liquidity:{state:tactic.liquidity??null},trap:{state:tactic.trap??null}},
   moveCharacter:{underlyingPressure:{state:tactic.underlyingPressure??null}}};
 }else missing.push("ENGINE29_CANONICAL_TACTICAL_SUMMARY_UNAVAILABLE_OR_STALE");
 if(s?.engine27CrossMarketLevels?.schema==="engine27.crossMarketSource.v1"&&
  s.engine27CrossMarketLevels.available===true)
  result.crossMarketLevels=s.engine27CrossMarketLevels;
 else missing.push("QQQ_VIX_CANONICAL_LEVEL_PUBLICATION_UNAVAILABLE");
 if(s?.engine27LiveCrossMarketReactions?.schema==="engine27.liveCrossMarketReactions.v1")
  result.crossMarketReactions=s.engine27LiveCrossMarketReactions;
 else missing.push("QQQ_VIX_DIRECT_HOURLY_REACTIONS_UNAVAILABLE");
 if(s?.engine27EsInstitutionalContext?.symbol==="ES"&&
   s.engine27EsInstitutionalContext?.available===true)
   result.esInstitutionalContext=s.engine27EsInstitutionalContext;
 else missing.push("ENGINE1_ES_INSTITUTIONAL_CONTEXT_UNAVAILABLE");
 evidence.available=true;
 return result;
}
