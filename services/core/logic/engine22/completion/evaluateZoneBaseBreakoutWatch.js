// Engine 22F — negotiated-zone base -> expansion watch, shadow only.
// An early C-down reversal clue, NOT confirmation of C completion.
// Uses pre-existing zone geometry and only consecutively completed 10m ES bars.
// No prices, zones, count identity, or breakout thresholds are invented from hindsight.
export const ENGINE22_ZONE_BREAKOUT_WATCH_SCHEMA="engine22.zoneBaseBreakoutWatch.v1";
const num=x=>typeof x==="number"&&Number.isFinite(x);
const str=x=>typeof x==="string"&&x.trim().length>0;
function output({status="UNAVAILABLE",reasonCodes=[],evidence=null,available=false}={}){
 return {schema:ENGINE22_ZONE_BREAKOUT_WATCH_SCHEMA,status,available,reasonCodes,evidence,
  cCompletionConfirmed:false,countTransitionAuthorized:false,hardInvalidationConfirmed:false,
  noExecution:true,noPermissionCreated:true,publishAuthorized:false,shadowOnly:true};
}
export function evaluateEngine22ZoneBaseBreakoutWatch({
  bars10m=[],zone=null,degreeId=null,countId=null,
  expectedSequenceDirection="DOWN",minimumBaseBars=5,
  minimumBreakoutBodyTicks=8,tickSize=0.25,
  previous=null,
}={}){
 if(!str(degreeId)||!str(countId)||/^ES-V3-BASELINE-/i.test(countId)||
  expectedSequenceDirection!=="DOWN")return output({reasonCodes:["C_DOWN_COUNT_IDENTITY_REQUIRED"]});
 if(!zone||!str(zone.zoneId)||!str(zone.sourceVersion)||!num(zone.low)||!num(zone.high)||
  zone.low<=0||zone.high<=zone.low||
  !Number.isInteger(minimumBaseBars)||minimumBaseBars<3||
  !Number.isInteger(minimumBreakoutBodyTicks)||minimumBreakoutBodyTicks<1||
  !num(tickSize)||tickSize<=0)return output({reasonCodes:["PREEXISTING_NEGOTIATED_ZONE_REQUIRED"]});
 if(!Array.isArray(bars10m)||bars10m.length<minimumBaseBars+1)
  return output({reasonCodes:["NOT_ENOUGH_COMPLETED_10M_BARS"]});
 let previousTime=null,source=null;
 const ids=new Set();
 for(const b of bars10m){
   const time=Date.parse(b?.sourceTimestamp);
   if(!b||b.closed!==true||b.timeframe!=="10m"||!str(b.sourceBarId)||
     ids.has(b.sourceBarId)||!Number.isFinite(time)||!num(b.open)||
     !num(b.high)||!num(b.low)||!num(b.close)||b.low<=0||
     b.high<b.low||b.open<b.low||b.open>b.high||b.close<b.low||b.close>b.high||
     [b.open,b.high,b.low,b.close].some(x=>Math.abs(x/tickSize-Math.round(x/tickSize))>1e-7)||
     (previousTime!==null&&time-previousTime!==600000))
       return output({reasonCodes:["INVALID_INCOMPLETE_OR_NONCONTIGUOUS_10M_EVIDENCE"]});
   if(!str(b.sourceContract)||!str(b.sourceVendor)||!str(b.sourceSeriesId))
     return output({reasonCodes:["ES_SOURCE_LINEAGE_REQUIRED"]});
   const signature=[b.sourceVendor,b.sourceSeriesId,b.sourceContract].join("|");
   if(source!==null&&signature!==source)
     return output({reasonCodes:["SOURCE_OR_CONTRACT_CHANGED_DURING_BASE"]});
   source=signature;previousTime=time;ids.add(b.sourceBarId);
 }
 // The zone must have existed at or before the first bar of the baseline.
 if(!str(zone.establishedAt)||!Number.isFinite(Date.parse(zone.establishedAt))||
   Date.parse(zone.establishedAt)>Date.parse(bars10m[0].sourceTimestamp))
  return output({reasonCodes:["ZONE_NOT_ESTABLISHED_BEFORE_OBSERVATION"]});
 // The last completed bar is the only breakout candidate: no future lookahead.
 const breakout=bars10m.at(-1),baseline=bars10m.slice(-1-minimumBaseBars,-1);
 const inZone=b=>b.close>=zone.low&&b.close<=zone.high;
 const baseAccepted=baseline.every(inZone);
 if(!baseAccepted) return output({available:true,status:"NO_QUALIFIED_BASE",
   reasonCodes:["MINIMUM_CONSECUTIVE_IN_ZONE_CLOSES_NOT_MET"]});
 const body=breakout.close-breakout.open;
 const bodyThreshold=minimumBreakoutBodyTicks*tickSize;
 const above=breakout.close>zone.high;
 const strong=body>=bodyThreshold&&breakout.close>breakout.open;
 const evidence={
   countId,degreeId,zoneId:zone.zoneId,zoneVersion:zone.sourceVersion,
   sourceContract:breakout.sourceContract,
   minimumBaseBars,baseStartBarId:baseline[0].sourceBarId,
   baseEndBarId:baseline.at(-1).sourceBarId,
   breakoutBarId:breakout.sourceBarId,breakoutTimestamp:breakout.sourceTimestamp,
   zoneHigh:zone.high,zoneLow:zone.low,breakoutClose:breakout.close,
   bodyPoints:body,thresholdPoints:bodyThreshold,completed10mBarsOnly:true
 };
 if(!above||!strong) return output({available:true,status:"BASE_ESTABLISHED",
   reasonCodes:[above?"UPWARD_BREAKOUT_NOT_FORCEFUL":"AWAITING_UPWARD_CLOSE_OUTSIDE_ZONE"],evidence});
 const priorSame=previous?.evidence?.countId===countId&&previous?.evidence?.degreeId===degreeId&&
   previous?.evidence?.zoneId===zone.zoneId&&
   previous?.evidence?.breakoutBarId===breakout.sourceBarId;
 if(priorSame)return output({available:true,status:"C_COMPLETION_EARLY_WATCH",
    reasonCodes:["REPEATED_OBSERVATION_NO_NEW_EVENT"],evidence});
 return output({available:true,status:"C_COMPLETION_EARLY_WATCH",
   reasonCodes:["NEGOTIATED_ZONE_BASE_UPWARD_EXPANSION","NOT_ELLIOTT_COMPLETION_CONFIRMATION"],evidence});
}
