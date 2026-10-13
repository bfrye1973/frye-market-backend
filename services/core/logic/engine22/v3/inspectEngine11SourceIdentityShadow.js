// Engine22 V3 Phase 3: read-only Engine11 source-identity handoff.
// Research observations are NOT analytical candles. Never upgrade source eligibility.
import {ENGINE22_V3_DEGREES} from "./canonicalStructure.js";
import {DEGREE_CANDLE_TIMEFRAMES} from "./buildIndependentNodeShadow.js";
const normalize=(x)=>String(x??"").trim();
const out=(degree,timeframe,reason,details={})=>({
 degree,sourceTimeframe:timeframe,status:"INSUFFICIENT_HISTORY",
 reasonCodes:[reason],sourceIdentityOnly:true,sourceFinality:"UNKNOWN",
 sourceCount:0,datasetVersion:null,sourceContractIds:[],observationIds:[],
 ...details,shadowOnly:true,structuralEligible:false,coverageComplete:false,
 noExecution:true,noPermissionCreated:true,anchorPromotionAllowed:false,
 officialFibAuthorityChanged:false,
});
export function inspectEngine11V2SourceForEngine22Shadow({
 canonical=null,degree=null,dataset=null,page=null,priceBasis=null,
 rolloverLineage=null,
}={}){
 if(!ENGINE22_V3_DEGREES.includes(degree))return out(degree,null,"DEGREE_NOT_RECOGNIZED");
 const tf=DEGREE_CANDLE_TIMEFRAMES[degree];
 const state=canonical?.degrees?.[degree];
 if(!state?.countId)return out(degree,tf,"CANONICAL_COUNT_REQUIRED");
 if(!dataset||!page)return out(degree,tf,"SOURCE_UNAVAILABLE");
 const version=normalize(dataset.datasetVersion);
 if(!version || version!==normalize(page.datasetVersion))
  return out(degree,tf,"DATASET_VERSION_MISMATCH");
 if(dataset.manifest?.schemaVersion!=="engine11.source-dataset.v2"||
    page.schemaVersion!=="engine11.source-page.v2" ||
    !Array.isArray(page.rows) || !Array.isArray(dataset.rows))
  return out(degree,tf,"ENGINE11_V2_SCHEMA_INVALID");
 if(page.purpose!=="ISOLATED_RESEARCH_ONLY" ||
    dataset.purpose!=="ISOLATED_RESEARCH_ONLY")
  return out(degree,tf,"SOURCE_PURPOSE_MISMATCH");
 const entries=page.rows.filter(row=>dataset.rows.some(original=>
   original.observationId===row?.observationId &&
   original.receiptId===row?.receiptId &&
   original.rowDigest===row?.rowDigest &&
   original.sourceKey===row?.sourceKey &&
   original.sourceRevisionId===row?.sourceRevisionId));
 if(entries.length!==page.rows.length || new Set(entries.map(r=>r.observationId)).size!==entries.length)
  return out(degree,tf,"SOURCE_OBSERVATION_IDENTITY_MISMATCH");
 const resolutions=new Set(entries.map(r=>normalize(r.sourceResolution)));
 const metadata=entries.map(row=>({
   observationId:row.observationId??null,receiptId:row.receiptId??null,
   sourceKey:row.sourceKey??null,sourceRevisionId:row.sourceRevisionId??null,
   sourceTimestampNs:row.sourceTimestampNs??null,
   sessionLabel:row.sourceSessionLabel??null,providerTicker:row.providerTicker??null,
   sourceResolution:row.sourceResolution??null,bindingVersion:row.bindingVersion??null,
   revisionClassification:row.revisionClassification??null,
   identityState:row.identityState??null,
 }));
 const contracts=[...new Set(metadata.map(x=>x.providerTicker).filter(Boolean))];
 const details={datasetVersion:version,sourceCount:entries.length,
   observationIds:metadata.map(x=>x.observationId),
   sourceContractIds:contracts,sourceIdentity:metadata,
   priceBasis:priceBasis?.kind??"UNRESOLVED",
   priceBasisVerified:priceBasis?.accepted===true,
   rolloverLineage:rolloverLineage?.accepted===true?
     {id:rolloverLineage.id,contracts:rolloverLineage.contracts}:null};
 const reasons=[];
 if(entries.length===0)reasons.push("INSUFFICIENT_HISTORY");
 if(entries.some(row=>!row.sourceKey||!row.sourceRevisionId||!row.bindingVersion))
   reasons.push("UNRESOLVED_CONTRACT_BINDING");
 if(resolutions.size!==1 || resolutions.has(""))reasons.push("MIXED_SOURCE_RESOLUTION");
 if(entries.some(row=>row.sourceFinality!=="CONFIRMED"||row.structuralEligible!==true))
   reasons.push("SOURCE_FINALITY_UNACCEPTED");
 if(dataset.structuralEligible!==true||dataset.coverageComplete!==true||
    page.structuralEligible!==true)reasons.push("ENGINE11_RESEARCH_ONLY_NOT_ELIGIBLE");
 if(priceBasis?.accepted!==true)reasons.push("PRICE_BASIS_UNVERIFIED");
 if(rolloverLineage?.accepted!==true)reasons.push("ROLLOVER_LINEAGE_UNVERIFIED");
 // Source V2's native resolution is not certified as analytical timeframe.
 // No observation is converted to OHLC bars or connected to wave completion.
 if(reasons.length===0)reasons.push("ANALYTICAL_INTERVAL_ACCEPTANCE_REQUIRED");
 return {...out(degree,tf,reasons[0],details),reasonCodes:reasons};
}
export function inspectEngine11V2SevenDegreeShadow({
 canonical=null,sourcePagesByDegree=null,
}={}){
 const degrees={};
 for(const degree of ENGINE22_V3_DEGREES){
  const spec=sourcePagesByDegree?.[degree]??{};
  degrees[degree.toLowerCase()]=inspectEngine11V2SourceForEngine22Shadow({
    canonical,degree,dataset:spec.dataset,page:spec.page,
    priceBasis:spec.priceBasis,rolloverLineage:spec.rolloverLineage,
  });
 }
 return {shadowOnly:true,sourceIdentityOnly:true,structuralEligible:false,
   noPermissionCreated:true,noExecution:true,degrees};
}
