// Engine27 V6 read-only distance to an original Engine26 negotiated zone.
// This does not infer wave completion, revise zone geometry, or authorize trades.
const finite=x=>typeof x==="number"&&Number.isFinite(x)?x:null;
export function studyWaveNegotiatedZone({waveExtremePrice=null,engine26Candidate=null,sourceSnapshotTime=null}={}){
 const price=finite(waveExtremePrice);
 const c=engine26Candidate;
 const zone=c?.entryZone;
 const low=finite(zone?.low??zone?.lo),high=finite(zone?.high??zone?.hi);
 const negotiated=String(c?.location?.type??"").toUpperCase()==="NEGOTIATED";
 if(price===null||!negotiated||low===null||high===null||low>high||
    !c?.zoneId||!sourceSnapshotTime||!Number.isFinite(Date.parse(sourceSnapshotTime)))
  return {available:false,reason:"ORIGINAL_ENGINE26_NEGOTIATED_ZONE_EVIDENCE_UNAVAILABLE",noExecution:true};
 const midpoint=(low+high)/2;
 const signedDistance=price<low?price-low:price>high?price-high:0;
 const distancePoints=Math.abs(signedDistance);
 return {schema:"engine27.v6.negotiatedZoneProximity.v1",available:true,
  source:"ORIGINAL_ENGINE26_REPLAY_SNAPSHOT",sourceSnapshotTime,zoneId:c.zoneId,
  candidateId:c.candidateId??null,zoneType:"NEGOTIATED",zoneLow:low,zoneHigh:high,
  midpoint:finite(zone.midline??zone.mid)??midpoint,
  waveExtremePrice:price,distancePoints,signedDistancePoints:signedDistance,
  distanceToMidpointPoints:Math.abs(price-midpoint),
  relation:price<low?"BELOW":price>high?"ABOVE":"INSIDE",
  // Distances are descriptive. There is no newly invented "near" threshold.
  proximityThresholdPoints:finite(c.activationRangePoints),
  waveCompletionConfirmed:false,noZoneAuthority:true,noWaveAuthority:true,noExecution:true};
}
