// Engine3 v6 Phase2: independent post-activation causal control.
// v5 evidence algorithms are reused WITHOUT changing Engine26 geometry,
// Engine4, Engine6, or canonical v5 decisions.
import {build1mEvidence} from "../v5/timeframe/build1mEvidence.js";
import {build5mReaction} from "../v5/timeframe/build5mReaction.js";
import {buildPriceActionControl} from "../v5/priceAction/buildPriceActionControl.js";

const toRaw=b=>({time:b.startMs/1000,open:b.open,high:b.high,low:b.low,close:b.close});
const direction=c=>c==="BUYERS_CONTROL"?"LONG":c==="SELLERS_CONTROL"?"SHORT":"NEUTRAL";
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const invalidReason="WIDE_ZONE_REACTION_SITE_UNRESOLVED";

// Construct an Engine3-only lens. Never mutate/replace the upstream Engine26 zone.
export function resolveEngine3V6ControlLens({phase2Evidence=null,normalizedZoneInput=null}={}){
 const original=normalizedZoneInput?.zone;
 const geometry=phase2Evidence?.geometry;
 if(normalizedZoneInput?.eligible!==true||phase2Evidence?.eligible!==true||
    !original||!geometry||geometry.policyAuthority===true){
   return {eligible:false,source:"UNAVAILABLE",reasonCode:"CONTROL_GEOMETRY_UNAVAILABLE",
     originalZone:original??null,controlLens:null,normalizedZoneInput:null};
 }
 // Exact original boundary/midline equality required; otherwise fail closed.
 const recorded=geometry.originalZone;
 if(!recorded||!["low","high","midline"].every(k=>
   finite(original[k])&&finite(recorded[k])&&original[k]===recorded[k])){
   return {eligible:false,source:"UNAVAILABLE",reasonCode:"ENGINE26_ZONE_GEOMETRY_MISMATCH",
     originalZone:original,controlLens:null,normalizedZoneInput:null};
 }
 const wide=geometry.wideZone;
 let controlLens,source;
 if(wide===false){
   source="WHOLE_ZONE";
   controlLens={...original};
 }else if(wide===true){
   const site=phase2Evidence?.reactionSite;
   if(!["upper","lower"].includes(site)){
     return {eligible:false,source:"UNRESOLVED",reasonCode:invalidReason,
       originalZone:original,controlLens:null,normalizedZoneInput:null};
   }
   const band=geometry[site];
   if(!band||!finite(band.low)||!finite(band.high)||band.low>band.high){
     return {eligible:false,source:"UNRESOLVED",reasonCode:"FROZEN_SITE_BAND_INVALID",
       originalZone:original,controlLens:null,normalizedZoneInput:null};
   }
   source=site==="upper"?"UPPER_SITE":"LOWER_SITE";
   controlLens={...original,
     low:band.low,high:band.high,
     midline:Number(((band.low+band.high)/2).toFixed(6)),
     widthPoints:Number((band.high-band.low).toFixed(6)),
     evaluationLensOnly:true,
     evaluationLensSource:source,
   };
 }else{
   return {eligible:false,source:"UNAVAILABLE",reasonCode:"WIDE_ZONE_CLASSIFICATION_UNAVAILABLE",
     originalZone:original,controlLens:null,normalizedZoneInput:null};
 }
 return {eligible:true,source,reasonCode:"ENGINE3_EVALUATION_LENS_SELECTED",
   originalZone:original,controlLens,
   normalizedZoneInput:{...normalizedZoneInput,zone:controlLens}};
}

export function buildEngine3V6CausalControl({
 phase2Evidence=null,normalizedZoneInput=null,evaluationTimeMs=null,
}={}){
 const one=(phase2Evidence?.completed1mEligible||[]).map(toRaw);
 const five=(phase2Evidence?.completed5mEligible||[]).map(toRaw);
 const lens=resolveEngine3V6ControlLens({phase2Evidence,normalizedZoneInput});
 // An unresolved wide site must NEVER revert to full Engine26 zone.
 const zone=lens.eligible?lens.normalizedZoneInput:
   {...normalizedZoneInput,eligible:false,zone:null};
 const observation=build1mEvidence({bars:one,normalizedZoneInput:zone,evaluationTimeMs});
 const validation=build5mReaction({bars:five,normalizedZoneInput:zone,evaluationTimeMs});
 const control=buildPriceActionControl({normalizedZoneInput:zone,
   priceActionEvidence:lens.eligible&&five.length>=2?validation.completed:null,
   sourceResolution:"POST_ACTIVATION_COMPLETED_5M_ONLY"});
 const observedDirection=direction(control.controlState);
 const qualified=lens.eligible&&five.length>=2&&control.eligible===true&&
   control.controlResolved===true&&["GOOD","STRONG"].includes(control.quality)&&
   observedDirection!=="NEUTRAL";
 return {schema:"engine3.v6.causalControl.v1",mode:"SHADOW_READ_ONLY",
  observation1m:observation,validation5m:validation,control,
  engine26Zone:lens.originalZone,
  engine3ControlLens:lens.controlLens,
  controlGeometrySource:lens.source,
  controlGeometryEligible:lens.eligible,
  observedDirection,qualified,postActivationBars1m:one.length,
  postActivationBars5m:five.length,
  controlSource:"POST_ACTIVATION_COMPLETED_5M_EVIDENCE",
  v5CanonicalControlReused:false,
  noPermissionCreated:true,noExecution:true,authoritativeDownstream:false,
  reasonCodes:[
    lens.reasonCode,
    five.length<2?"INSUFFICIENT_POST_ACTIVATION_EVIDENCE":null,
    qualified?"INDEPENDENT_CAUSAL_CONTROL_QUALIFIED":
      "WAITING_FOR_POST_ACTIVATION_MATURE_CONTROL",
  ].filter(Boolean)};
}
export default buildEngine3V6CausalControl;
